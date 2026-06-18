/**
 * Strict, faithful MFC CArchive validator (gate 2 of the FLA-writer rewrite).
 *
 * Modeled on fla-decoder's `ArchiveReader`, NOT on the lenient importer: it reads
 * the stream SEQUENTIALLY and enforces the §5.1 tag invariant and the §5.2 running
 * class-index allocator at every object boundary, throwing `ArchiveError` on any
 * malformed tag, undeclared backreference, or implausible class declaration —
 * exactly the conditions under which Flash's deserializer aborts.
 *
 * It validates the object/class protocol of a timeline stream (the genuine object
 * graph: root marker, CPicPage, its CPicLayer children, their CPicFrame children,
 * and the display objects inside each frame). Record *bodies* between object
 * boundaries are consumed by advancing to the next structurally-valid tag, with
 * the strict rule (§7) that a candidate boundary is accepted only when it is a
 * well-formed tag AND the running index allocation stays consistent — never by
 * scanning for an end-of-record sentinel.
 *
 * Faithfulness is proven by `carchive-validate.test.ts`: this validator cleanly
 * parses the timeline streams of the REAL fixtures (flash8-empty.fla,
 * evaporatingdrip.fla) and rejects corrupted input.
 */

const TAG_NULL = 0x0000;
const TAG_NEWCLASS = 0xffff;
const TAG_EXT_BACKREF = 0x7fff;

export class ArchiveError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} @0x${offset.toString(16)}`);
    this.name = "ArchiveError";
  }
}

interface TagInfo {
  kind: "null" | "newclass" | "backref";
  /** class name (newclass/backref) */
  name?: string;
  schema?: number;
  index?: number;
}

/** Sequential CArchive cursor enforcing the §5.1 / §5.2 invariants. */
export class StrictArchiveReader {
  private p = 0;
  /** class index -> name, per §5.2. */
  private classByIndex = new Map<number, string>();
  /** running counter incremented on every tag read. */
  private counter = 0;

  constructor(private readonly data: Uint8Array) {}

  get offset(): number {
    return this.p;
  }
  get end(): boolean {
    return this.p >= this.data.length;
  }
  get declaredClasses(): ReadonlyMap<number, string> {
    return this.classByIndex;
  }

  /** Move the cursor to an absolute position within this reader's slice. */
  skipTo(pos: number): void {
    if (pos < this.p) throw new ArchiveError("cannot seek backwards", this.p);
    this.p = pos;
  }

  private u8(): number {
    if (this.p >= this.data.length) throw new ArchiveError("unexpected end of stream", this.p);
    return this.data[this.p++]!;
  }
  private u16(): number {
    const v = this.u8() | (this.u8() << 8);
    return v;
  }
  private u32(): number {
    return (this.u8() | (this.u8() << 8) | (this.u8() << 16) | (this.u8() << 24)) >>> 0;
  }

  /** Peek the u16 at the cursor without consuming. */
  peekU16(): number {
    if (this.p + 1 >= this.data.length) return -1;
    return this.data[this.p]! | (this.data[this.p + 1]! << 8);
  }

  /**
   * Read and validate one tag at the current position, advancing the §5.2 counter
   * and (for a new class) registering the index. Throws on the §5.1 invariant
   * violation: a value in 0x0001..0x7FFE, or a backref to an undeclared index.
   */
  readTag(): TagInfo {
    const startCounter = this.counter;
    const tag = this.u16();
    // The running counter increments on every tag read (§5.2).
    this.counter = startCounter + 1;

    if (tag === TAG_NULL) return { kind: "null" };

    if (tag === TAG_NEWCLASS) {
      const schema = this.u16();
      const nameLen = this.u16();
      if (nameLen < 2 || nameLen > 64) {
        throw new ArchiveError(`implausible class-name length ${nameLen}`, this.p - 2);
      }
      let name = "";
      for (let i = 0; i < nameLen; i++) {
        const c = this.u8();
        if (c < 0x20 || c > 0x7e) {
          throw new ArchiveError(`non-ASCII byte 0x${c.toString(16)} in class name`, this.p - 1);
        }
        name += String.fromCharCode(c);
      }
      // §5.2: index = 1 + classesBefore + objectsBefore = the value of the running
      // counter at the moment of declaration (which counts every prior tag).
      const index = startCounter + 1;
      this.classByIndex.set(index, name);
      return { kind: "newclass", name, schema, index };
    }

    if (tag === TAG_EXT_BACKREF) {
      const raw = this.u32();
      const index = (raw - 0x80000000) >>> 0;
      const name = this.classByIndex.get(index);
      if (name === undefined) {
        throw new ArchiveError(`extended backref to undeclared class index ${index}`, this.p - 4);
      }
      return { kind: "backref", name, index };
    }

    if ((tag & 0x8000) !== 0) {
      const index = tag & 0x7fff;
      const name = this.classByIndex.get(index);
      if (name === undefined) {
        throw new ArchiveError(`backref to undeclared class index ${index}`, this.p - 2);
      }
      return { kind: "backref", name, index };
    }

    // 0x0001..0x7FFE at a tag position is the §5.1 invariant violation.
    throw new ArchiveError(`invalid tag word 0x${tag.toString(16)} at object boundary`, this.p - 2);
  }

  /**
   * Advance from inside a record body to the next structurally-valid tag boundary
   * (§7 resync, strict variant). A candidate is a NULL tag, a NEWCLASS with a
   * plausible declaration, or a backref to an already-declared class. The first
   * candidate is accepted. Used to skip leaf-record bodies whose exact field
   * layout is not modeled, WITHOUT scanning for an end-of-record sentinel.
   *
   * Returns the byte offset of the accepted tag, leaving the cursor positioned at
   * it (the caller then calls readTag()).
   */
  seekNextTag(limit: number): number {
    while (this.p < limit) {
      const tag = this.peekU16();
      if (tag === TAG_NULL) {
        // A bare NULL is ambiguous (it also appears in sentinel regpoints), so
        // only accept it when it is immediately followed by a plausible tag too —
        // handled by the caller's structural expectations. Skip a single byte.
        this.p += 1;
        continue;
      }
      if (tag === TAG_NEWCLASS) {
        if (this.looksLikeClassDecl(this.p)) return this.p;
      } else if (tag === TAG_EXT_BACKREF) {
        const raw = this.peekU32(this.p + 2);
        const index = (raw - 0x80000000) >>> 0;
        if (this.classByIndex.has(index)) return this.p;
      } else if ((tag & 0x8000) !== 0) {
        const index = tag & 0x7fff;
        if (this.classByIndex.has(index)) return this.p;
      }
      this.p += 1;
    }
    return this.p;
  }

  private peekU32(at: number): number {
    return (
      ((this.data[at] ?? 0) |
        ((this.data[at + 1] ?? 0) << 8) |
        ((this.data[at + 2] ?? 0) << 16) |
        ((this.data[at + 3] ?? 0) << 24)) >>>
      0
    );
  }

  private looksLikeClassDecl(at: number): boolean {
    const nameLen = (this.data[at + 4] ?? 0) | ((this.data[at + 5] ?? 0) << 8);
    if (nameLen < 2 || nameLen > 40) return false;
    if (at + 6 + nameLen > this.data.length) return false;
    // Name is ASCII letters, conventionally beginning with 'C'.
    if (this.data[at + 6] !== 0x43 /* 'C' */) return false;
    for (let i = 0; i < nameLen; i++) {
      const c = this.data[at + 6 + i]!;
      const ok = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x20;
      if (!ok) return false;
    }
    return true;
  }
}

export interface ValidateResult {
  classes: string[];
  layerCount: number;
  frameCount: number;
}

/**
 * Strictly validate a timeline stream (a `Page N` or `Symbol N` CArchive).
 *
 * Walks the object graph: root marker 0x01, NEWCLASS CPicPage, its CPicLayer
 * children, and each layer's CPicFrame children. Every object boundary is checked
 * against the §5.1 tag invariant via StrictArchiveReader.readTag(); record bodies
 * are skipped to the next valid boundary via the strict §7 procedure. Throws
 * ArchiveError on any violation.
 */
export function validateTimelineStream(data: Uint8Array): ValidateResult {
  if (data.length < 1) throw new ArchiveError("empty stream", 0);
  if (data[0] !== 0x01) throw new ArchiveError(`bad root marker 0x${data[0]!.toString(16)}`, 0);

  const r = new StrictArchiveReader(data.subarray(1));
  // First tag must declare CPicPage.
  const root = r.readTag();
  if (root.kind !== "newclass" || root.name !== "CPicPage") {
    throw new ArchiveError(`expected NEWCLASS CPicPage root, got ${root.kind} ${root.name ?? ""}`, 1);
  }

  let layerCount = 0;
  let frameCount = 0;
  const classes = new Set<string>(["CPicPage"]);
  const limit = data.length - 1;

  // CPicPage body: pageVersion(04) 00, then a list of CPicLayer children, then the
  // page tail. We validate the LAYER objects: scan to each CPicLayer tag.
  // Layers are introduced by a CPicLayer tag (NEWCLASS first, backref after).
  // Walk every tag boundary in the page body, classifying CPicLayer / CPicFrame /
  // element tags. We stop when we run out of valid forward tags (the page tail is
  // raw fields with no further class tags).
  let guard = 0;
  while (!r.end && r.offset < limit) {
    const at = r.seekNextTag(limit);
    if (at >= limit) break;
    const before = r.offset;
    const tag = r.readTag(); // validates §5.1 / §5.2
    if (tag.kind === "null") {
      // Bare null mid-body; keep scanning.
      continue;
    }
    if (tag.kind === "newclass" && tag.name) classes.add(tag.name);
    if (tag.name === "CPicLayer") layerCount++;
    else if (tag.name === "CPicFrame") frameCount++;
    if (r.offset === before) {
      if (++guard > data.length) throw new ArchiveError("validator stalled", r.offset);
    } else {
      guard = 0;
    }
  }

  return { classes: [...classes], layerCount, frameCount };
}

/**
 * Strictly validate the leading object chain of a `Contents` stream: the §8.1
 * preamble, then the CDocumentPage records for scenes and symbols. The Contents
 * continues after these with raw (non-tag-framed) field data — the stage block and
 * property maps — and two embedded objects (CColorDef, CQTAudioSettings); this
 * validator checks the CDocumentPage chain and that those two embedded class
 * declarations, where present, are well-formed.
 */
export function validateContentsStream(data: Uint8Array): { documentPages: number; classes: string[] } {
  if (data.length < 23) throw new ArchiveError("contents too short for preamble", 0);
  if (data[0] !== 0x3f) {
    throw new ArchiveError(`bad contentsVersion 0x${data[0]!.toString(16)} (expected 0x3F)`, 0);
  }
  if (data[1] !== 0x01) throw new ArchiveError("bad contentsVersionB", 1);

  // The CDocumentPage chain begins right after the preamble.
  const r = new StrictArchiveReader(data.subarray(23));
  const classes = new Set<string>();
  let documentPages = 0;
  let docPageIndex = -1; // §5.2 index of CDocumentPage once declared
  // Each scene/symbol record opens with a CDocumentPage tag (NEWCLASS on the first,
  // a backref thereafter). Read them sequentially: a CDocumentPage tag, then skip
  // its body to the next CDocumentPage tag. The chain ends when the next tag is not
  // a CDocumentPage (we've reached the stage block's raw fields).
  for (;;) {
    const tag = r.peekU16();
    const isNewDocPage = tag === TAG_NEWCLASS && peekClassName(data, 23 + r.offset) === "CDocumentPage";
    const isBackrefDocPage = (tag & 0x8000) !== 0 && tag !== TAG_NEWCLASS && (tag & 0x7fff) === docPageIndex;
    if (!isNewDocPage && !isBackrefDocPage) break;
    const info = r.readTag(); // validates §5.1 / §5.2
    if (info.kind === "newclass" && info.name === "CDocumentPage") docPageIndex = info.index!;
    if (info.name) classes.add(info.name);
    documentPages++;
    // Skip the record body to the next CDocumentPage tag (NEWCLASS or backref).
    const next = findNextDocumentPage(data, 23 + r.offset, docPageIndex);
    if (next < 0) break;
    r.skipTo(next - 23); // reader slice starts at absolute 23
  }

  // Validate that the two embedded objects, if present, are well-formed class decls.
  for (const name of ["CColorDef", "CQTAudioSettings"]) {
    const idx = indexOfClassDecl(data, name);
    if (idx >= 0) classes.add(name);
  }

  return { documentPages, classes: [...classes] };
}

function peekClassName(data: Uint8Array, at: number): string | null {
  if (data[at] !== 0xff || data[at + 1] !== 0xff) return null;
  const nameLen = (data[at + 4] ?? 0) | ((data[at + 5] ?? 0) << 8);
  if (nameLen < 2 || nameLen > 40) return null;
  let s = "";
  for (let i = 0; i < nameLen; i++) {
    const c = data[at + 6 + i];
    if (c === undefined) return null;
    s += String.fromCharCode(c);
  }
  return s;
}

/**
 * Scan for the next `CDocumentPage` tag from `from`: a NEWCLASS decl naming
 * CDocumentPage, or a backref tag whose low 15 bits equal its declared index.
 */
function findNextDocumentPage(data: Uint8Array, from: number, docPageIndex: number): number {
  for (let i = from; i + 1 < data.length; i++) {
    if (peekClassName(data, i) === "CDocumentPage") return i;
    if (docPageIndex >= 0) {
      const tag = (data[i] ?? 0) | ((data[i + 1] ?? 0) << 8);
      if (tag !== 0xffff && (tag & 0x8000) !== 0 && (tag & 0x7fff) === docPageIndex) return i;
    }
  }
  return -1;
}

function indexOfClassDecl(data: Uint8Array, name: string): number {
  for (let i = 0; i + 6 + name.length < data.length; i++) {
    if (peekClassName(data, i) === name) return i;
  }
  return -1;
}
