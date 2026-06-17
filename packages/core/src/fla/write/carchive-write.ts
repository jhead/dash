/**
 * MFC CArchive object-protocol *writer* + primitive encoders (§4, §5 of
 * docs/21-fla-binary-format.md).
 *
 * This is the inverse of `ArchiveReader` / the primitive readers in
 * `flash8-binary.ts`. A `ByteWriter` accumulates little-endian bytes; a
 * `ClassTable` reproduces the running ref-index allocator (§5.2) so that the
 * reader's `ArchiveReader.registerClass` assigns the identical indices.
 */

// ---------------------------------------------------------------------------
// ByteWriter — little-endian byte sink
// ---------------------------------------------------------------------------

export class ByteWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(initial = 256) {
    this.buf = new Uint8Array(initial);
  }

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len), 0);
    this.buf = next;
  }

  get length(): number {
    return this.len;
  }

  u8(v: number): this {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    return this;
  }

  s16(v: number): this {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }

  u32(v: number): this {
    this.ensure(4);
    const u = v >>> 0;
    this.buf[this.len++] = u & 0xff;
    this.buf[this.len++] = (u >>> 8) & 0xff;
    this.buf[this.len++] = (u >>> 16) & 0xff;
    this.buf[this.len++] = (u >>> 24) & 0xff;
    return this;
  }

  s32(v: number): this {
    return this.u32(v < 0 ? v + 0x100000000 : v);
  }

  f32(v: number): this {
    this.ensure(4);
    const dv = new DataView(this.buf.buffer, this.len, 4);
    dv.setFloat32(0, v, true);
    this.len += 4;
    return this;
  }

  f64(v: number): this {
    this.ensure(8);
    const dv = new DataView(this.buf.buffer, this.len, 8);
    dv.setFloat64(0, v, true);
    this.len += 8;
    return this;
  }

  bytes(b: ArrayLike<number>): this {
    this.ensure(b.length);
    this.buf.set(b as Uint8Array, this.len);
    this.len += b.length;
    return this;
  }

  /** Emit a [V*] constant byte run verbatim. */
  raw(...b: number[]): this {
    return this.bytes(b);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

// ---------------------------------------------------------------------------
// Primitives (§4)
// ---------------------------------------------------------------------------

/** 16.16 fixed point. */
export function toFixed16(v: number): number {
  return Math.round(v * 65536) | 0;
}

/** A placement / shape matrix (§4.2): a,b,c,d (16.16) + tx,ty (s32 twips). */
export interface WMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number; // pixels
  ty: number; // pixels
}

export const IDENTITY_MATRIX: WMatrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export function writeMatrix(w: ByteWriter, m: WMatrix): void {
  w.s32(toFixed16(m.a));
  w.s32(toFixed16(m.b));
  w.s32(toFixed16(m.c));
  w.s32(toFixed16(m.d));
  w.s32(Math.round(m.tx * 20)); // px -> twips
  w.s32(Math.round(m.ty * 20));
}

export interface WColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** RGBA, wire order R,G,B,A (§4.3). */
export function writeRGBA(w: ByteWriter, c: WColor): void {
  w.u8(c.r).u8(c.g).u8(c.b).u8(c.a);
}

/**
 * Write a CString in the unicode "BomString" form: FF FE FF then a length
 * prefix (code units) then UTF-16LE chars. Empty string -> `FF FE FF 00`
 * (the importer's `tryReadBomStringAt` and `readCString` both accept this).
 *
 * Flash 8 documents are unicode (formatVersion >= 0x38), so all CStrings in the
 * timeline/Contents streams use this encoding. Matches `readCString`'s
 * `ext === 0xfffe` branch.
 */
export function writeBomString(w: ByteWriter, s: string): void {
  w.u8(0xff).u8(0xfe).u8(0xff);
  writeBomLength(w, s.length);
  for (let i = 0; i < s.length; i++) w.u16(s.charCodeAt(i));
}

function writeBomLength(w: ByteWriter, len: number): void {
  if (len < 0xff) {
    w.u8(len);
  } else if (len < 0xffff) {
    w.u8(0xff).u16(len);
  } else {
    w.u8(0xff).u16(0xffff).u32(len);
  }
}

/**
 * Write a "plain" unicode string (no BOM marker) as used inside CPicText runs:
 * a length prefix (code units) then UTF-16LE chars. Matches
 * `readPlainString(r, true)`.
 */
export function writePlainStringUnicode(w: ByteWriter, s: string): void {
  writeBomLength(w, s.length);
  for (let i = 0; i < s.length; i++) w.u16(s.charCodeAt(i));
}

// ---------------------------------------------------------------------------
// MFC CArchive class/object table (§5.1, §5.2)
// ---------------------------------------------------------------------------

const TAG_NULL = 0x0000;
const TAG_NEWCLASS = 0xffff;

/**
 * Running ref-index allocator. Mirrors `ArchiveReader.registerClass`:
 *
 *   index(class) = 1 + (#classes declared before) + (#objects serialized before)
 *
 * `objectCount` increments on EVERY object header written (NEWCLASS or backref);
 * `definedCount` increments on each first class declaration. A class's index is
 * fixed at first declaration and reused by every later backref `0x8000 | index`.
 */
export class ClassTable {
  private classIndex = new Map<string, number>();
  private definedCount = 0;
  private objectCount = 0;

  /**
   * Emit the class/object tag for `name`, declaring it (NEWCLASS) on first use
   * or referencing it (backref) thereafter. `schema` is only written on the
   * first declaration. Call this immediately before serializing the object body.
   */
  useClass(w: ByteWriter, name: string, schema: number): void {
    const existing = this.classIndex.get(name);
    if (existing === undefined) {
      const index = 1 + this.definedCount + this.objectCount;
      this.classIndex.set(name, index);
      this.definedCount += 1;
      this.objectCount += 1;
      w.u16(TAG_NEWCLASS);
      w.u16(schema);
      w.u16(name.length);
      for (let i = 0; i < name.length; i++) w.u8(name.charCodeAt(i));
    } else {
      this.objectCount += 1;
      w.u16(0x8000 | existing);
    }
  }

  /** Write a NULL tag (end of a children list). */
  writeNull(w: ByteWriter): void {
    w.u16(TAG_NULL);
  }
}
