/**
 * Flash 8 (and MX/MX2004/CS-era) binary FLA document payload parser.
 *
 * Real Macromedia Flash .fla files are OLE2 compound documents whose streams
 * ("Contents", "Page N", "Symbol N", "Media N") contain MFC CArchive-style
 * serialized C++ objects (CPicPage, CPicLayer, CPicFrame, CPicShape,
 * CPicSprite, CPicButton, CPicText, ...).
 *
 * The wire protocol implemented here is based on:
 *  - JPEXS "flacomdoc" (XFL -> binary FLA writer, byte-verified against real
 *    Flash output): field order/semantics for frames, layers, fills, strokes.
 *  - The "fla-decoder" reverse-engineering effort (Ghidra decompilation of
 *    flash.exe Serialize methods): schema-conditional field layout, shape
 *    edge encoding, recovery scanning.
 *
 * Anything not understood is skipped explicitly with a console.warn — never
 * silently mis-parsed. Write-back is out of scope.
 *
 * Capability map (what IS imported):
 *  - stage size / frame rate / background color (Contents stream)
 *  - scene list with display names; library symbol names + types
 *  - layers: name, type (normal/guide/guided/folder/mask), visibility,
 *    lock state, outline color
 *  - frames: span durations, labels (+comment flag), AS2 frame scripts as
 *    source text, tween-kind detection (motion / shape) from the key mode,
 *    shape tween start/end shapes extracted from the start and end keyframes
 *  - shapes: solid/gradient fills, solid strokes (width/caps/joins/miter),
 *    full edge geometry (lines + quadratic curves) with per-edge styles
 *  - symbol instances (sprite/button/graphic): placement matrix, library
 *    reference, instance name, color transform (CXFORM), Flash 8 filter list
 *    (drop-shadow/blur/glow/bevel/gradient-glow/gradient-bevel/color-matrix),
 *    and — for movieclip instances — onClipEvent() handler ActionScript
 *  - text fields: static/dynamic/input, content, font, size, color,
 *    bold/italic, alignment, wrap, instance name
 *
 * Explicitly NOT imported (warned at parse time):
 *  - Media N payloads (bitmaps, sounds, video) and bitmap placements
 *  - button instance on() handlers (no instance-level model field; the raw
 *    script is parsed but dropped by the mapper with a warning)
 *  - (blend modes are now decoded from the byte after the filter list)
 *  - bitmap and text-field filters (skipped; only symbol-instance filters are decoded)
 *  - convolution filters (no model type; silently dropped from the filter list)
 *  - sound attachments and envelopes
 *  - components, fonts library items, accessibility metadata
 *  - Flash 4-and-older frame scripts (stored as action records, not source)
 *
 * Units:
 *  - matrix a/b/c/d: 16.16 fixed point; tx/ty: twips (1/20 px)
 *  - shape edge coordinates: 8.8 fixed-point twips (1 px = 5120 units)
 */

// ---------------------------------------------------------------------------
// Parsed-data types (intermediate representation, converted to the document
// model by ole.ts)
// ---------------------------------------------------------------------------

export interface Fla8Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  /** px */
  readonly tx: number;
  /** px */
  readonly ty: number;
}

export interface Fla8Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface Fla8GradientStop {
  /** 0-255 */
  readonly position: number;
  readonly color: Fla8Color;
}

export type Fla8Fill =
  | { kind: "solid"; color: Fla8Color }
  | {
      kind: "linear-gradient" | "radial-gradient";
      matrix: Fla8Matrix;
      stops: Fla8GradientStop[];
      focalRatio: number;
    }
  | {
      kind: "bitmap";
      matrix: Fla8Matrix;
      bitmapId: number;
      /** true = tiled (repeating), false = clipped (no-repeat). SWF 0x40/0x42 = tiled, 0x41/0x43 = clipped. */
      repeat: boolean;
      /** true = smoothed (bilinear), false = aliased. SWF 0x42/0x43 = smoothed, 0x40/0x41 = aliased. */
      smooth: boolean;
    }
  | { kind: "unknown" };

export interface Fla8Stroke {
  readonly color: Fla8Color;
  /** px */
  readonly width: number;
  readonly cap: "none" | "round" | "square";
  readonly join: "miter" | "round" | "bevel";
  readonly miterLimit: number;
}

export interface Fla8Edge {
  readonly kind: "line" | "curve";
  /** px, shape-local */
  readonly fromX: number;
  readonly fromY: number;
  readonly ctrlX: number;
  readonly ctrlY: number;
  readonly toX: number;
  readonly toY: number;
  /** 1-based style indices; 0 = none */
  readonly fill0: number;
  readonly fill1: number;
  readonly line: number;
}

export interface Fla8Shape {
  readonly type: "shape";
  readonly matrix: Fla8Matrix;
  readonly fills: Fla8Fill[];
  readonly strokes: Fla8Stroke[];
  readonly edges: Fla8Edge[];
}

/**
 * Decoded CXFORM-style color transform from a symbol instance. Multipliers are
 * 8.8 fixed point (256 = 1.0); offsets are signed 0..255-scale additions.
 */
export interface Fla8ColorEffect {
  readonly rMult: number;
  readonly rOff: number;
  readonly gMult: number;
  readonly gOff: number;
  readonly bMult: number;
  readonly bOff: number;
  readonly aMult: number;
  readonly aOff: number;
}

export interface Fla8Instance {
  readonly type: "instance";
  readonly kind: "sprite" | "button" | "graphic" | "unknown";
  readonly matrix: Fla8Matrix;
  /** 1-based "Symbol N" library stream number; 0 = unresolved */
  readonly libraryIndex: number;
  readonly instanceName: string;
  /** color transform applied to the instance, or null when identity/absent */
  readonly colorEffect: Fla8ColorEffect | null;
  /** Flash 8+ filters applied to the instance (empty array when none) */
  readonly filters: Fla8Filter[];
  /**
   * Flash 8 blend mode raw byte value (0–14).
   * 0 and 1 both mean "normal"; see BLEND_MODE_MAP in flash8-import.ts.
   */
  readonly blendMode: number;
  /**
   * Raw instance ActionScript source. For a movieclip (sprite) instance this is
   * the concatenated `onClipEvent(...) { ... }` blocks; for a button instance
   * the `on(...) { ... }` blocks. Empty string when the instance has no handler.
   */
  readonly script: string;
  /**
   * trackAsMenu flag for button instances (kind === "button" only).
   * When true the button behaves like a menu item: pressing and dragging onto it
   * activates it; releasing elsewhere still counts as a release.
   * Maps to the TrackAsMenu bit in the DefineButton2 SWF tag.
   */
  readonly trackAsMenu?: boolean;
  /**
   * Which frame of the symbol to start on (0-based). Only meaningful for
   * graphic symbols (kind === "graphic"). Default: 0.
   */
  readonly firstFrame: number;
  /**
   * How the graphic symbol animates on the parent timeline.
   * 0 = loop, 1 = play-once, 2 = single-frame.
   * Only meaningful for graphic symbols (kind === "graphic").
   */
  readonly loopMode: number;
}

export interface Fla8TextRun {
  readonly text: string;
  readonly fontName: string;
  /** pt */
  readonly fontSize: number;
  readonly color: Fla8Color;
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface Fla8Text {
  readonly type: "text";
  readonly matrix: Fla8Matrix;
  /** px */
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly fontName: string;
  /** pt */
  readonly fontSize: number;
  readonly color: Fla8Color;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly align: "left" | "center" | "right" | "justify";
  readonly instanceName: string;
  readonly textType: "static" | "dynamic" | "input";
  readonly wordWrap: boolean;
  /** Whether this is a multiline text field (bit 0x10 of CPicText textFlags). */
  readonly multiline: boolean;
  /** Whether characters are masked as password dots (bit 0x04 of CPicText textFlags). */
  readonly password: boolean;
  /** Maximum number of characters the user can enter; 0 means unlimited. */
  readonly maxChars: number;
  /** Whether a border rectangle is drawn around the text field (bit 0x40 of CPicText textFlags). */
  readonly hasBorder: boolean;
  /** AS2 variable name bound to this text field (legacy ActionScript 1/2 binding). */
  readonly as2VariableName: string;
  /** Flash 8+ filters (empty array when none). */
  readonly filters: Fla8Filter[];
  /**
   * Instance-level color transform applied to this text field placement, or
   * null when identity/absent. Populated when a color effect block is present
   * in the CPicText record (Flash 8+ binary FLA schema ts >= 0x0d).
   */
  readonly colorEffect: Fla8ColorEffect | null;
  /**
   * All formatting runs in the text field. When a field has multiple runs
   * with different styling, this array has more than one entry. When empty
   * or containing a single entry, per-run styling is captured in the top-level
   * fontName/fontSize/color/bold/italic fields.
   */
  readonly runs: readonly Fla8TextRun[];
}

export interface Fla8BitmapRef {
  readonly type: "bitmap";
  readonly matrix: Fla8Matrix;
  readonly mediaId: number;
  /** Flash 8+ filters (empty array when none). */
  readonly filters: Fla8Filter[];
}

export interface Fla8VideoRef {
  readonly type: "video";
  readonly matrix: Fla8Matrix;
  /** Index into the "Media N" stream that carries the FLV payload. */
  readonly mediaId: number;
}

/**
 * CPicSwf — a placed embedded-SWF element on the timeline.
 *
 * Flash authoring lets users embed external SWF files as library symbols via
 * File > Import.  CPicSwf records the placement on stage.  The full byte layout
 * is variable-length (AS2 clip-event scripts, color transforms, instance names)
 * and not fully decoded; only the placement matrix is extracted.
 */
export interface Fla8SwfRef {
  readonly type: "swf";
  /** Approximate placement matrix extracted from the record header. */
  readonly matrix: Fla8Matrix;
}

export type Fla8Element = Fla8Shape | Fla8Instance | Fla8Text | Fla8BitmapRef | Fla8VideoRef | Fla8SwfRef;

/**
 * Custom cubic-Bézier ease curve decoded from the CPicFrame binary tail
 * (Flash 8+, frameVersionB >= 0x18). Coordinates follow the CSS cubic-bezier
 * convention: x1/x2 ∈ [0,1] (time), y1/y2 unconstrained (value progress).
 */
export interface Fla8EaseCurve {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface Fla8Frame {
  /** span length in frames (>= 1) */
  readonly duration: number;
  readonly label: string;
  readonly labelIsComment: boolean;
  readonly script: string;
  readonly keyMode: number;
  /** signed ease value: -100 (ease in, slow start) to +100 (ease out, fast start); 0 = linear */
  readonly motionEase: number;
  /**
   * Custom cubic-Bézier ease curve (Flash 8+). null = use `motionEase` instead.
   * Decoded from `useSingleEaseCurve` + `hasCustomEase` + per-property point data
   * in the CPicFrame tail when frameVersionB >= 0x18 (24).
   */
  readonly motionEaseCurve: Fla8EaseCurve | null;
  /** rotation mode: "none" | "auto" | "cw" | "ccw" */
  readonly motionRotate: "none" | "auto" | "cw" | "ccw";
  /** extra full rotations beyond the shortest-path interpolation */
  readonly motionRotateCount: number;
  /** orient to path: rotate the object to follow the motion-guide path tangent */
  readonly motionOrientToPath: boolean;
  readonly soundId: number;
  /** raw sync byte: 0=event, 1=start, 2=stop, 3=stream; -1 when not present */
  readonly soundSync: number;
  /** number of times to repeat (0 = loop indefinitely); -1 when not present */
  readonly soundLoop: number;
  /** in-point sample offset (44100 Hz); undefined when not present */
  readonly inPoint?: number;
  /** out-point sample offset (44100 Hz); undefined when not present */
  readonly outPoint?: number;
  /** custom volume envelope points */
  readonly envelopePoints?: Array<{ pos: number; leftLevel: number; rightLevel: number }>;
  readonly elements: Fla8Element[];
}

export interface Fla8Layer {
  readonly name: string;
  /** 0=normal 1=guide 2=guided 3=folder 4=mask (5=masked in some versions) */
  readonly layerType: number;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly outlineColor: Fla8Color | null;
  readonly frames: Fla8Frame[];
}

export interface Fla8Timeline {
  readonly layers: Fla8Layer[];
}

export interface Fla8SymbolInfo {
  readonly name: string;
  /** 0=graphic 1=button 2=movieclip per observed Contents records */
  readonly typeByte: number | null;
  /**
   * AS2 linkage identifier (for attachMovie / ExportAssets).
   * Stored as a BomString immediately after the typeByte in the Contents stream.
   * Empty string when not set.
   */
  readonly linkageIdentifier: string;
  /**
   * AS2 class name (for `new ClassName()` / `Object.registerClass()`).
   * Decoded from the writeAsLinkage block in the Contents stream.
   * The writeAsLinkage block starts at a fixed offset of 41 bytes after the
   * end of the display-name BomString (s.end + 41) for MX2004+ unicode FLAs:
   *   +0: UI32 zero prefix (00 00 00 00)
   *   +4: asLinkageVersion byte (5 for MX2004, 7 for Flash 8/CS3)
   *   +5: flags byte (exportForAS | importForRS)
   *   +6: 3 zero bytes
   *   +9: BomString(linkageIdentifier) [real, may differ from heuristic one]
   *   after: BomString(linkageURL)
   *   after: BomString(className)   ← this field
   * Empty string when not set.
   */
  readonly className: string;
  /**
   * Whether the symbol is exported for ActionScript (Export for ActionScript checkbox).
   * Stored as a UI8 boolean flag after the linkageIdentifier BomString.
   * The exact byte order in the Contents stream (observed from real Flash 8 binaries):
   *   BomString: linkageIdentifier
   *   UI8: exportInFirstFrame (defaults to 1; only meaningful when exportForActionScript=1)
   *   UI8: exportForActionScript
   *   UI8: exportForRuntimeSharing
   *   UI8: importForRuntimeSharing
   */
  readonly exportForActionScript: boolean;
  readonly exportInFirstFrame: boolean;
  readonly exportForRuntimeSharing: boolean;
  readonly importForRuntimeSharing: boolean;
}

export interface Fla8SoundInfo {
  readonly name: string;
}

export interface Fla8VideoInfo {
  /** Library display name of the video item. */
  readonly name: string;
}

export interface Fla8ContentsInfo {
  readonly formatVersion: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly frameRate: number | null;
  readonly backgroundColor: Fla8Color | null;
  /** page stream name -> scene display name */
  readonly sceneNames: Map<string, string>;
  /** symbol stream number -> info */
  readonly symbols: Map<number, Fla8SymbolInfo>;
  /** sound stream number -> info */
  readonly sounds: Map<number, Fla8SoundInfo>;
  /** video/media stream number -> info (for "Video N" or "Media N" FLV entries) */
  readonly videos: Map<number, Fla8VideoInfo>;
}

// ---------------------------------------------------------------------------
// Low-level reader
// ---------------------------------------------------------------------------

class FlaEofError extends Error {}

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new FlaEofError(
        `need ${n} bytes at 0x${this.pos.toString(16)}, only ${this.remaining()} left`,
      );
    }
  }
  u8(): number {
    this.need(1);
    return this.buf[this.pos++]!;
  }
  u16(): number {
    this.need(2);
    const v = this.buf[this.pos]! | (this.buf[this.pos + 1]! << 8);
    this.pos += 2;
    return v;
  }
  s16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  u32(): number {
    this.need(4);
    const v =
      this.buf[this.pos]! |
      (this.buf[this.pos + 1]! << 8) |
      (this.buf[this.pos + 2]! << 16) |
      (this.buf[this.pos + 3]! << 24);
    this.pos += 4;
    return v >>> 0;
  }
  s32(): number {
    const v = this.u32();
    return v >= 0x80000000 ? v - 0x100000000 : v;
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }
  remaining(): number {
    return this.buf.length - this.pos;
  }
  eof(): boolean {
    return this.pos >= this.buf.length;
  }
}

function utf16le(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8));
  }
  return s;
}

function ascii(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

/**
 * Read an MFC/Flash CString. Handles all observed encodings:
 *  - u8 len + ASCII bytes                      (pre-MX2004 non-unicode)
 *  - FF FE FF + u8 len + UTF-16LE chars        (unicode "BomString")
 *  - FF FE FF FF + u16 len + UTF-16LE chars    (long unicode)
 *  - FF + u16 len + ASCII bytes                (long ASCII)
 */
function readCString(r: Reader): string {
  const b = r.u8();
  if (b === 0) return "";
  if (b < 0xff) return ascii(r.bytes(b));
  const ext = r.u16();
  if (ext === 0xfffe) {
    // unicode marker FF FE FF; next is the unicode length prefix
    let len = r.u8();
    if (len === 0xff) {
      len = r.u16();
      if (len === 0xffff) len = r.u32();
    }
    return len > 0 ? utf16le(r.bytes(len * 2)) : "";
  }
  if (ext === 0xffff) {
    const len = r.u32();
    return ascii(r.bytes(len));
  }
  return ascii(r.bytes(ext));
}

// ---------------------------------------------------------------------------
// MFC CArchive class-tag reader
// ---------------------------------------------------------------------------

type ClassTag =
  | { kind: "null" }
  | { kind: "class"; name: string; schema: number }
  | { kind: "object-backref" }
  | { kind: "bad"; tag: number };

/**
 * MFC CArchive class/object reference table.
 *
 * The serialization assigns each *referenceable* item a 1-based index drawn
 * from a SINGLE monotonically-increasing counter that advances on every object
 * header (every class-tag read). This is the exact inverse of flacomdoc's
 * writer (`AbstractConverter.useClass`):
 *
 *   // on first use of a class:
 *   definedClasses.put(className, 1 + definedClasses.size() + totalObjectCount);
 *   // on EVERY useClass call (NEWCLASS or backref):
 *   totalObjectCount++;
 *
 * So a class first declared after N earlier objects and C earlier class
 * declarations gets reference index `1 + C + N`, and that index is reused by
 * every later backref to the class — even though the running object counter
 * keeps climbing. Earlier implementations modelled a fixed "two slots per
 * class" table, which only happens to be correct while no objects have been
 * serialized between class declarations; in real streams (e.g. a CPicShape
 * first declared after several CPicFrame/CPicBitmap objects) the class index
 * is much higher (CPicShape = 16, not 9, in Magnet.fla Symbol 13), so its
 * backref tag `0x8010` was mis-read as an unrecognised tag.
 */
class ArchiveReader {
  /** className -> assigned 1-based reference index (fixed at first declaration) */
  private classIndex = new Map<string, number>();
  /** reference index -> className, for resolving backref tags */
  private nameByIndex = new Map<number, string>();
  /** number of class declarations seen so far */
  private definedCount = 0;
  /** running object counter (advances on every object header) */
  private objectCount = 0;
  readonly classNames: string[] = [];

  constructor(readonly r: Reader) {}

  registerClass(name: string): void {
    // Index assigned at declaration time, mirroring flacomdoc's useClass:
    //   1 + (classes defined before) + (objects written before)
    const index = 1 + this.definedCount + this.objectCount;
    if (!this.classIndex.has(name)) {
      this.classIndex.set(name, index);
      this.nameByIndex.set(index, name);
    }
    this.classNames.push(name);
    this.definedCount += 1;
    this.objectCount += 1;
  }

  /** Backref tag value for an already-declared class, or null. */
  classBackrefTag(name: string): number | null {
    const idx = this.classIndex.get(name);
    return idx === undefined ? null : 0x8000 | idx;
  }

  /** True if `idx` (1-based reference index) refers to a declared class. */
  isClassIndex(idx: number): boolean {
    return this.nameByIndex.has(idx);
  }

  readClassTag(): ClassTag {
    const tag = this.r.u16();
    if (tag === 0x0000) return { kind: "null" };
    if (tag === 0xffff) {
      const schema = this.r.u16();
      const nameLen = this.r.u16();
      if (nameLen === 0 || nameLen > 64) {
        throw new Error(`implausible class name length ${nameLen}`);
      }
      const name = ascii(this.r.bytes(nameLen));
      this.registerClass(name);
      return { kind: "class", name, schema };
    }
    if (tag === 0x7fff) {
      // extended backref: u32 index. Still counts as one object header.
      const idx = this.r.u32();
      this.objectCount += 1;
      const name = this.nameByIndex.get(idx);
      if (name !== undefined) return { kind: "class", name, schema: 0 };
      return { kind: "object-backref" };
    }
    if (tag & 0x8000) {
      const idx = tag & 0x7fff;
      this.objectCount += 1;
      const name = this.nameByIndex.get(idx);
      if (name !== undefined) return { kind: "class", name, schema: 0 };
      return { kind: "object-backref" };
    }
    // Unrecognised tag value — not a known MFC CArchive sentinel. Return a
    // "bad" marker so the caller can attempt recovery rather than throwing.
    return { kind: "bad", tag };
  }
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function fp1616(raw: number): number {
  const s = raw >= 0x80000000 ? raw - 0x100000000 : raw;
  return s / 65536;
}

function readMatrix(r: Reader): Fla8Matrix {
  const a = fp1616(r.u32());
  const b = fp1616(r.u32());
  const c = fp1616(r.u32());
  const d = fp1616(r.u32());
  const tx = r.s32() / 20;
  const ty = r.s32() / 20;
  return { a, b, c, d, tx, ty };
}

function readColorRGBA(r: Reader): Fla8Color {
  // byte order on the wire: R, G, B, A (verified against flacomdoc writeSolidFill)
  const cr = r.u8();
  const cg = r.u8();
  const cb = r.u8();
  const ca = r.u8();
  return { r: cr, g: cg, b: cb, a: ca };
}

/**
 * Edge coordinates are 8.8 fixed-point twips (verified against SWF shape
 * bounds published from the same FLAs): 1 px = 20 twips * 256 = 5120 units.
 */
const UTW = 5120;

// 10-byte object-tail signature: NULL child tag + 2x INT_MIN point sentinel.
const END_MARKER = [0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80] as const;

function findEndMarker(buf: Uint8Array, from: number): number {
  outer: for (let i = Math.max(0, from); i <= buf.length - END_MARKER.length; i++) {
    for (let j = 0; j < END_MARKER.length; j++) {
      if (buf[i + j] !== END_MARKER[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Skip the unparsed tail of an object by scanning forward for the next
 * object-tail signature, so the parent's children loop can resume at the
 * NULL tag. Used for classes whose trailing fields are not fully decoded.
 */
function skipToEndMarker(r: Reader): void {
  const idx = findEndMarker(r.buf, r.pos);
  if (idx >= 0 && idx < r.buf.length - 12) r.pos = idx;
  else r.pos = r.buf.length;
}

/**
 * Reposition after an element whose tail could not be fully consumed. Scans
 * for the nearest of:
 *   - a NEWCLASS tag followed by a plausible class declaration
 *   - a backref tag to a known class followed by a plausible CPicObj header
 *   - the parent's object-tail signature (NULL tag + INT_MIN point)
 * This avoids the failure mode of a bare end-marker scan landing inside a
 * SIBLING object whose registration point happens to be the INT_MIN sentinel.
 */
function skipToNextBoundary(ctx: ParseCtx): void {
  const { r, ar } = ctx;
  for (let i = r.pos; i <= r.buf.length - 2; i++) {
    const v = r.buf[i]! | (r.buf[i + 1]! << 8);
    if (v === 0xffff && i + 7 < r.buf.length) {
      const schema = r.buf[i + 2]! | (r.buf[i + 3]! << 8);
      const nameLen = r.buf[i + 4]! | (r.buf[i + 5]! << 8);
      const first = r.buf[i + 6]!;
      if (schema <= 0xff && nameLen >= 4 && nameLen <= 32 && first >= 0x41 && first <= 0x5a) {
        r.pos = i;
        return;
      }
    } else if ((v & 0x8000) !== 0 && v !== 0xffff && ar.isClassIndex(v & 0x7fff) && i + 4 < r.buf.length) {
      const schema = r.buf[i + 2]!;
      const flags = r.buf[i + 3]!;
      if (schema <= 0x10 && flags <= 0x40) {
        r.pos = i;
        return;
      }
    } else if (v === 0) {
      let match = true;
      for (let j = 2; j < END_MARKER.length; j++) {
        if (r.buf[i + j] !== END_MARKER[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        r.pos = i;
        return;
      }
    }
  }
  r.pos = r.buf.length;
}

/**
 * After an exact tail parse, verify the reader sits on a plausible boundary
 * (a class tag or the parent's NULL terminator); otherwise rescan.
 */
function verifyBoundary(ctx: ParseCtx): void {
  const { r, ar } = ctx;
  if (r.remaining() === 0) return;
  if (r.remaining() >= 2) {
    const v = r.buf[r.pos]! | (r.buf[r.pos + 1]! << 8);
    if (v === 0 || v === 0xffff) return;
    if ((v & 0x8000) !== 0 && ar.isClassIndex(v & 0x7fff)) return;
  }
  skipToNextBoundary(ctx);
}

/**
 * Optional accessibility block (writeAccessibleData): absent entirely when
 * the object has no accessibility data; otherwise starts with a nonzero
 * version byte.
 */
function readAccessibilityMaybe(ctx: ParseCtx, mx2004Plus: boolean): void {
  const { r } = ctx;
  if (r.remaining() < 1 || r.buf[r.pos] === 0) return;
  r.skip(8); // version, reserved, silent flag, reserved
  readCString(r); // accName
  readCString(r); // description
  readCString(r); // shortcut
  if (mx2004Plus) {
    readCString(r); // tabIndex
    readCString(r);
  }
  r.skip(4); // forceSimple + reserved
}

// ---------------------------------------------------------------------------
// Per-class deserializers
// ---------------------------------------------------------------------------

interface ParseCtx {
  ar: ArchiveReader;
  r: Reader;
  warnings: Set<string>;
}

function warnOnce(ctx: ParseCtx, msg: string): void {
  if (!ctx.warnings.has(msg)) {
    ctx.warnings.add(msg);
    console.warn(`[FLA import] ${msg}`);
  }
}

interface CPicObjBase {
  schema: number;
  flags: number;
  children: ParsedNode[];
}

type ParsedNode =
  | { cls: "CPicPage"; layers: ParsedLayerNode[] }
  | ParsedLayerNode
  | ParsedFrameNode
  | { cls: "element"; element: Fla8Element }
  | { cls: "skipped"; name: string };

interface ParsedLayerNode {
  cls: "CPicLayer";
  layer: Fla8Layer;
}

interface ParsedFrameNode {
  cls: "CPicFrame";
  frame: Fla8Frame;
}

/**
 * CPicObj::Serialize base — schema, flags, children loop, registration point,
 * schema-conditional extras. Children are dispatched by class name.
 */
function readCPicObjBase(ctx: ParseCtx): CPicObjBase {
  const { r } = ctx;
  const schema = r.u8();
  const flags = r.u8();
  const children: ParsedNode[] = [];
  let badTag = false;
  for (;;) {
    let tag: ClassTag;
    try {
      tag = ctx.ar.readClassTag();
    } catch (err) {
      // EOF mid-children: treat as truncated stream (same as a premature null).
      if (err instanceof FlaEofError) {
        badTag = true;
        break;
      }
      throw err;
    }
    if (tag.kind === "null") break;
    if (tag.kind === "object-backref") {
      // Reuse of an existing object — rare; nothing to read for it.
      continue;
    }
    if (tag.kind === "bad") {
      // Unrecognised class tag — stream is misaligned or uses an unknown
      // encoding variant (e.g. 0x204 seen in real Flash 8 FLAs). Re-sync
      // to the next plausible object boundary. The post-loop registration-
      // point skips are skipped so the caller can resume from wherever the
      // re-sync landed.
      warnOnce(
        ctx,
        `unrecognised class tag 0x${tag.tag.toString(16)} @ 0x${(r.pos - 2).toString(16)} — skipping remaining children`,
      );
      skipToNextBoundary(ctx);
      badTag = true;
      break;
    }
    children.push(deserializeClass(tag.name, ctx));
  }
  if (!badTag) {
    if (schema > 0) r.skip(8); // 2 x s32 registration point (often INT_MIN sentinel)
    if (schema > 2) r.skip(1);
    if (schema > 3) r.skip(1);
  }
  return { schema, flags, children };
}

function deserializeClass(name: string, ctx: ParseCtx): ParsedNode {
  try {
    switch (name) {
      case "CPicPage":
        return readCPicPage(ctx);
      case "CPicLayer":
        return readCPicLayer(ctx);
      case "CPicFrame":
        return readCPicFrameNode(ctx);
      case "CPicShape":
        return { cls: "element", element: readCPicShape(ctx).shape };
      case "CPicSprite":
        return { cls: "element", element: readCPicSprite(ctx) };
      case "CPicButton":
        return { cls: "element", element: readCPicButton(ctx) };
      case "CPicShapeObj":
      case "CPicSymbol":
        return { cls: "element", element: readCPicSymbolInstance(ctx, "graphic") };
      case "CPicText":
        return { cls: "element", element: readCPicText(ctx) };
      case "CPicBitmap":
        return { cls: "element", element: readCPicBitmapRef(ctx) };
      case "CPicVideo":
        return { cls: "element", element: readCPicVideo(ctx) };
      case "CPicSwf":
        return { cls: "element", element: readCPicSwf(ctx) };
      default: {
        // Unknown CPic*/CMorph* class: consume the CPicObj base if plausible,
        // then skip to the next object-tail signature.
        warnOnce(ctx, `class "${name}" is not supported; skipping its data`);
        try {
          readCPicObjBase(ctx);
        } catch (err) {
          if (!(err instanceof FlaEofError)) throw err;
        }
        skipToNextBoundary(ctx);
        return { cls: "skipped", name };
      }
    }
  } catch (err) {
    if (err instanceof FlaEofError) {
      warnOnce(ctx, `stream truncated while reading ${name}: ${String(err)}`);
      return { cls: "skipped", name };
    }
    throw err;
  }
}

// --- CPicPage ---------------------------------------------------------------

function readCPicPage(ctx: ParseCtx): ParsedNode {
  const { r } = ctx;
  const base = readCPicObjBase(ctx);
  try {
    const ps = r.u8();
    if (ps !== 4) r.skip(2);
    if (ps >= 5) r.skip(2);
    if (ps >= 7) r.skip(4);
    if (ps >= 3) {
      const cnt = r.u32();
      if (cnt > 0 && cnt < 10000) r.skip(cnt * 8);
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  const layers: ParsedLayerNode[] = [];
  for (const c of base.children) {
    if (c.cls === "CPicLayer") layers.push(c);
  }
  return { cls: "CPicPage", layers };
}

// --- CPicLayer ---------------------------------------------------------------

function readCPicLayer(ctx: ParseCtx): ParsedLayerNode {
  const { r } = ctx;
  const base = readCPicObjBase(ctx);

  let name = "";
  let layerType = 0;
  let hidden = false;
  let locked = false;
  let outlineColor: Fla8Color | null = null;

  try {
    const ls = r.u8();
    name = readCString(r);
    if (ls <= 3) {
      // F1-F3: single state byte (0=hidden, 1=locked, 2=normal, 3=current)
      const state = r.u8();
      hidden = state === 0;
      locked = state === 1;
    } else {
      // F4+ layout (verified against flacomdoc writeLayerContents):
      // isSelected, hidden, locked, u32 sentinel(FFFFFFFF), RGBA outline color,
      // showOutlines, 7 bytes (heightMultiplier at [3]), layerType
      r.skip(1); // isSelected
      hidden = r.u8() !== 0;
      locked = r.u8() !== 0;
      r.skip(4); // 0xFFFFFFFF sentinel
      outlineColor = readColorRGBA(r);
      r.skip(1); // showOutlines
      r.skip(7); // 00 00 00 heightMultiplier 00 00 00
      layerType = r.u8();
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }

  // Trailer (parent-layer ref / open / autoNamed encoding) is small and
  // version-dependent; rather than decoding it, scan forward (bounded) for
  // the nearest continuation: another CPicLayer backref tag, a NEWCLASS tag,
  // or the page object-tail signature.
  repositionAfterLayerTrailer(ctx);

  const frames: Fla8Frame[] = [];
  for (const c of base.children) {
    if (c.cls === "CPicFrame") frames.push(c.frame);
  }
  return {
    cls: "CPicLayer",
    layer: { name, layerType, hidden, locked, outlineColor, frames },
  };
}

function repositionAfterLayerTrailer(ctx: ParseCtx): void {
  const { r, ar } = ctx;
  const layerTag = ar.classBackrefTag("CPicLayer");
  const limit = Math.min(r.buf.length - 2, r.pos + 96);
  for (let i = r.pos; i <= limit; i++) {
    const lo = r.buf[i]!;
    const hi = r.buf[i + 1]!;
    const v = lo | (hi << 8);
    if (layerTag !== null && v === layerTag) {
      r.pos = i;
      return;
    }
    if (v === 0xffff && i + 6 < r.buf.length) {
      // plausible NEWCLASS: u16 schema (<= 0xff) + u16 short name length + ASCII
      const schema = r.buf[i + 2]! | (r.buf[i + 3]! << 8);
      const nameLen = r.buf[i + 4]! | (r.buf[i + 5]! << 8);
      const first = r.buf[i + 6]!;
      if (schema <= 0xff && nameLen >= 4 && nameLen <= 32 && first >= 0x41 && first <= 0x5a) {
        r.pos = i;
        return;
      }
    }
    // page object-tail: NULL tag + INT_MIN point
    if (lo === 0 && hi === 0 && i + END_MARKER.length <= r.buf.length) {
      let match = true;
      for (let j = 2; j < END_MARKER.length; j++) {
        if (r.buf[i + j] !== END_MARKER[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        r.pos = i;
        return;
      }
    }
  }
  // Fallback: skip to the last plausible end marker (single-layer case).
  skipToEndMarker(r);
}

// --- CPicShape / shape geometry ----------------------------------------------

interface ShapeReadResult {
  shape: Fla8Shape;
  shapeSchema: number;
}

function readCPicShape(ctx: ParseCtx): ShapeReadResult {
  const { r } = ctx;
  readCPicObjBase(ctx);
  const shapeSchema = r.u8();
  const matrix = readMatrix(r);
  const { fills, strokes, edges } = readShapeData(ctx, shapeSchema > 2);
  // Verify the reader is on a valid object boundary after shape data so that
  // any leftover version-specific bytes do not misalign subsequent reads.
  verifyBoundary(ctx);
  return { shape: { type: "shape", matrix, fills, strokes, edges }, shapeSchema };
}

function readFillStyle(ctx: ParseCtx, caps: boolean): Fla8Fill {
  const { r } = ctx;
  const color = readColorRGBA(r);
  const subtype = r.u8();
  r.skip(1); // more_flags
  if (subtype & 0x10) {
    // gradient; bit 0x02 distinguishes radial (0x12) from linear (0x10)
    const matrix = readMatrix(r);
    const numStops = r.u8();
    let focalRatio = 0;
    if (caps) {
      // F8+ gradient extras: focal*255, 0,0,0, flow|linearRGB, 0,0,0
      const focalByte = r.u8();
      focalRatio = focalByte > 127 ? (focalByte - 256) / 255 : focalByte / 255;
      r.skip(7);
    }
    const stops: Fla8GradientStop[] = [];
    for (let i = 0; i < Math.min(numStops, 15); i++) {
      const position = r.u8();
      stops.push({ position, color: readColorRGBA(r) });
    }
    return {
      kind: subtype & 0x02 ? "radial-gradient" : "linear-gradient",
      matrix,
      stops,
      focalRatio,
    };
  }
  if (subtype & 0x40) {
    const matrix = readMatrix(r);
    const bitmapId = r.u32();
    // SWF bitmap fill subtypes: 0x40=tiled/aliased, 0x41=clipped/aliased,
    // 0x42=tiled/smoothed, 0x43=clipped/smoothed.
    // Bit 0 set → clipped (no-repeat); bit 1 set → smoothed.
    const repeat = (subtype & 0x01) === 0;
    const smooth = (subtype & 0x02) !== 0;
    return { kind: "bitmap", matrix, bitmapId, repeat, smooth };
  }
  if (subtype & 0x20) {
    // Subtype 0x20 (bit 5 set, not a gradient (0x10) or bitmap (0x40)) is a
    // Flash-internal fill variant with a fixed-size header:
    //   gradient transform matrix (24 bytes via readMatrix) +
    //   4 bytes (likely an internal object ID or paint parameters) +
    //   8 bytes (likely F8 gradient extras or additional transform flags).
    //
    // Investigation (task 0858): this subtype appears in real Flash 8 FLA files
    // as the paint fill of a stroke (inside readLineStyle), but not as a shape
    // fill.  Analysis of worms.fla shows the 0x20 byte being encountered during
    // misaligned stream reads (parser reads frame-script text bytes as shape
    // data), so no confirmed binary specimen of a legitimately-stored 0x20 fill
    // was found.  Without a reference specimen the exact semantics are unknown.
    //
    // Best-effort mapping: treat as a solid fill using the base color that was
    // already read at the top of this function (the same color the authoring
    // tool would display for an undefined fill type).  The matrix and 12-byte
    // trailer are consumed to maintain stream alignment.
    readMatrix(r);
    r.skip(4 + 8);
    return { kind: "solid", color };
  }
  return { kind: "solid", color };
}

const CAP_STYLES = ["round", "none", "square"] as const;
const JOIN_STYLES = ["round", "bevel", "miter"] as const;

function readLineStyle(ctx: ParseCtx, caps: boolean): Fla8Stroke {
  const { r } = ctx;
  // Layout from flacomdoc writeStrokeBegin + writeSolidFill:
  //   RGBA, u16 width twips, u16 styleParam1, u16 styleParam2,
  //   F8+: pixelHinting, scaleMode, capStyle, joinStyle, miterFrac, miterInt
  //   then a full fill style (solid for plain strokes)
  const color = readColorRGBA(r);
  const widthTwips = r.u16();
  r.skip(4); // styleParam1 + styleParam2 (dash/dot/ragged parameters)
  let cap: Fla8Stroke["cap"] = "round";
  let join: Fla8Stroke["join"] = "round";
  let miterLimit = 3;
  let finalColor = color;
  if (caps) {
    // F8+ extras: pixel hinting, scale mode, caps/joins, miter, then the
    // stroke's paint as a full fill style. Pre-F8 strokes stop at the params.
    r.skip(1); // pixelHinting
    r.skip(1); // scaleMode
    const capStyle = r.u8();
    const joinStyle = r.u8();
    const miterFrac = r.u8();
    const miterInt = r.u8();
    cap = CAP_STYLES[capStyle] ?? "round";
    join = JOIN_STYLES[joinStyle] ?? "round";
    miterLimit = miterInt + miterFrac / 256;
    const fill = readFillStyle(ctx, caps);
    if (fill.kind === "solid") finalColor = fill.color;
  }
  return { color: finalColor, width: widthTwips / 20, cap, join, miterLimit };
}

function readCoordDelta(r: Reader, type: number): [number, number] {
  switch (type) {
    case 0:
      return [0, 0];
    case 1:
      return [r.s16(), r.s16()];
    case 2:
      return [r.s32(), r.s32()];
    case 3:
      return [r.s16() << 7, r.s16() << 7];
    default:
      throw new Error(`bad coord delta type ${type}`);
  }
}

function readShapeData(
  ctx: ParseCtx,
  caps: boolean,
): { fills: Fla8Fill[]; strokes: Fla8Stroke[]; edges: Fla8Edge[] } {
  const { r } = ctx;
  const schema = r.u8();
  r.skip(4); // edge count hint
  const fillCount = r.u16();
  const fills: Fla8Fill[] = [];
  for (let i = 0; i < fillCount; i++) {
    if (schema < 3) {
      // legacy: u32 color + u16 flags
      fills.push({ kind: "solid", color: readColorRGBA(r) });
      r.skip(2);
    } else {
      fills.push(readFillStyle(ctx, caps));
    }
  }
  const lineCount = r.u16();
  const strokes: Fla8Stroke[] = [];
  for (let i = 0; i < lineCount; i++) {
    strokes.push(readLineStyle(ctx, caps));
  }

  const edges: Fla8Edge[] = [];
  if (schema >= 2) {
    let curX = 0;
    let curY = 0;
    let fill0 = 0;
    let fill1 = 0;
    let line = 0;
    for (;;) {
      if (r.eof()) {
        warnOnce(ctx, "unexpected EOF inside shape edge stream");
        break;
      }
      const flags = r.u8();
      if (flags === 0) break;
      if (flags & 0x40) {
        // Style-change record. Order is stroke, fill0, fill1 (flacomdoc
        // FlaWriter.writeEdge). Bit 0x80 = "no selection info": bare u8
        // values; otherwise each u8 value is followed by a selection byte.
        if (flags & 0x80) {
          line = r.u8();
          fill0 = r.u8();
          fill1 = r.u8();
        } else {
          line = r.u8();
          r.skip(1);
          fill0 = r.u8();
          r.skip(1);
          fill1 = r.u8();
          r.skip(1);
        }
      }
      const t1 = flags & 3;
      const t2 = (flags >> 2) & 3;
      const t3 = (flags >> 4) & 3;
      const [dx1, dy1] = readCoordDelta(r, t1);
      const [dx2, dy2] = readCoordDelta(r, t2);
      const [dx3, dy3] = readCoordDelta(r, t3);
      const fromX = curX + dx1;
      const fromY = curY + dy1;
      let ctrlX = fromX + dx2;
      let ctrlY = fromY + dy2;
      const toX = fromX + dx3;
      const toY = fromY + dy3;
      let kind: Fla8Edge["kind"] = "curve";
      if (t2 === 0) {
        kind = "line";
        ctrlX = (fromX + toX) / 2;
        ctrlY = (fromY + toY) / 2;
      }
      edges.push({
        kind,
        fromX: fromX / UTW,
        fromY: fromY / UTW,
        ctrlX: ctrlX / UTW,
        ctrlY: ctrlY / UTW,
        toX: toX / UTW,
        toY: toY / UTW,
        fill0,
        fill1,
        line,
      });
      curX = toX;
      curY = toY;
    }
  }
  if (schema > 4 && r.remaining() >= 4) {
    // cubic-bezier post-stream: s32 count + 32 bytes per entry
    const cubicCount = r.s32();
    if (cubicCount > 0 && cubicCount * 32 <= r.remaining()) {
      r.skip(cubicCount * 32);
    } else if (cubicCount !== 0) {
      r.pos -= 4;
    }
  }
  return { fills, strokes, edges };
}

// --- Filter list (Flash 8+) ---------------------------------------------------
//
// Filters in the FLA binary use the same wire encoding as SWF §23:
//   u8 filterType, then filter-specific fields.
// Fixed16 = i32 little-endian (value / 65536.0).
// Fixed8  = i16 little-endian (value / 256.0).
// Angles in the SWF filter format are in radians stored as Fixed16.

export interface Fla8FilterDropShadow {
  readonly kind: "drop-shadow";
  readonly r: number; readonly g: number; readonly b: number; readonly a: number;
  readonly blurX: number; readonly blurY: number;
  /** radians */
  readonly angle: number;
  readonly distance: number;
  readonly strength: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly hideObject: boolean;
  readonly passes: number;
}

export interface Fla8FilterBlur {
  readonly kind: "blur";
  readonly blurX: number; readonly blurY: number;
  readonly passes: number;
}

export interface Fla8FilterGlow {
  readonly kind: "glow";
  readonly r: number; readonly g: number; readonly b: number; readonly a: number;
  readonly blurX: number; readonly blurY: number;
  readonly strength: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly passes: number;
}

export interface Fla8FilterBevel {
  readonly kind: "bevel";
  readonly highlightR: number; readonly highlightG: number;
  readonly highlightB: number; readonly highlightA: number;
  readonly shadowR: number; readonly shadowG: number;
  readonly shadowB: number; readonly shadowA: number;
  readonly blurX: number; readonly blurY: number;
  /** radians */
  readonly angle: number;
  readonly distance: number;
  readonly strength: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly onTop: boolean;
  readonly passes: number;
}

export interface Fla8FilterGradientStop {
  readonly r: number; readonly g: number; readonly b: number; readonly a: number;
  readonly ratio: number;
}

export interface Fla8FilterGradientGlow {
  readonly kind: "gradient-glow";
  readonly stops: Fla8FilterGradientStop[];
  readonly blurX: number; readonly blurY: number;
  /** radians */
  readonly angle: number;
  readonly distance: number;
  readonly strength: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly onTop: boolean;
  readonly compositeSource: boolean;
  readonly passes: number;
}

export interface Fla8FilterGradientBevel {
  readonly kind: "gradient-bevel";
  readonly stops: Fla8FilterGradientStop[];
  readonly blurX: number; readonly blurY: number;
  /** radians */
  readonly angle: number;
  readonly distance: number;
  readonly strength: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly onTop: boolean;
  readonly compositeSource: boolean;
  readonly passes: number;
}

export interface Fla8FilterColorMatrix {
  readonly kind: "color-matrix";
  /** 20-element 4×5 color matrix in row-major order */
  readonly matrix: readonly number[];
}

export interface Fla8FilterConvolution {
  readonly kind: "convolution";
  readonly matrixX: number;
  readonly matrixY: number;
  readonly matrix: readonly number[];
  readonly divisor: number;
  readonly bias: number;
  readonly defaultR: number;
  readonly defaultG: number;
  readonly defaultB: number;
  readonly defaultA: number;
  readonly clamp: boolean;
  readonly preserveAlpha: boolean;
}

export type Fla8Filter =
  | Fla8FilterDropShadow
  | Fla8FilterBlur
  | Fla8FilterGlow
  | Fla8FilterBevel
  | Fla8FilterGradientGlow
  | Fla8FilterGradientBevel
  | Fla8FilterColorMatrix
  | Fla8FilterConvolution;

/** SWF/FLA Fixed16: i32 little-endian, value = bits / 65536 */
function readFixed16(r: Reader): number {
  return r.s32() / 65536;
}

/** SWF/FLA Fixed8: i16 little-endian, value = bits / 256 */
function readFixed8(r: Reader): number {
  return r.s16() / 256;
}

function readOneFilter(r: Reader): Fla8Filter | null {
  const type = r.u8();
  switch (type) {
    case 0: { // DropShadow
      const cr = r.u8(); const cg = r.u8(); const cb = r.u8(); const ca = r.u8();
      const blurX = readFixed16(r);
      const blurY = readFixed16(r);
      const angle = readFixed16(r);
      const distance = readFixed16(r);
      const strength = readFixed8(r);
      const flags = r.u8();
      return {
        kind: "drop-shadow",
        r: cr, g: cg, b: cb, a: ca,
        blurX, blurY, angle, distance, strength,
        inner: (flags & 0x80) !== 0,
        knockout: (flags & 0x40) !== 0,
        hideObject: (flags & 0x20) === 0, // compositeSource=0x20 means "show" object; absent = hide
        passes: flags & 0x1f,
      };
    }
    case 1: { // Blur
      const blurX = readFixed16(r);
      const blurY = readFixed16(r);
      const flags = r.u8();
      return {
        kind: "blur",
        blurX, blurY,
        passes: (flags & 0xf8) >> 3,
      };
    }
    case 2: { // Glow
      const cr = r.u8(); const cg = r.u8(); const cb = r.u8(); const ca = r.u8();
      const blurX = readFixed16(r);
      const blurY = readFixed16(r);
      const strength = readFixed8(r);
      const flags = r.u8();
      return {
        kind: "glow",
        r: cr, g: cg, b: cb, a: ca,
        blurX, blurY, strength,
        inner: (flags & 0x80) !== 0,
        knockout: (flags & 0x40) !== 0,
        passes: flags & 0x1f,
      };
    }
    case 3: { // Bevel — SWF wire order is highlight then shadow (spec note)
      const hr = r.u8(); const hg = r.u8(); const hb = r.u8(); const ha = r.u8();
      const sr = r.u8(); const sg = r.u8(); const sb = r.u8(); const sa = r.u8();
      const blurX = readFixed16(r);
      const blurY = readFixed16(r);
      const angle = readFixed16(r);
      const distance = readFixed16(r);
      const strength = readFixed8(r);
      const flags = r.u8();
      return {
        kind: "bevel",
        highlightR: hr, highlightG: hg, highlightB: hb, highlightA: ha,
        shadowR: sr, shadowG: sg, shadowB: sb, shadowA: sa,
        blurX, blurY, angle, distance, strength,
        inner: (flags & 0x80) !== 0,
        knockout: (flags & 0x40) !== 0,
        onTop: (flags & 0x10) !== 0,
        passes: flags & 0x0f,
      };
    }
    case 4: // GradientGlow
    case 7: { // GradientBevel
      const numColors = r.u8();
      const colors: Array<{ r: number; g: number; b: number; a: number }> = [];
      for (let i = 0; i < numColors; i++) {
        colors.push({ r: r.u8(), g: r.u8(), b: r.u8(), a: r.u8() });
      }
      const stops: Fla8FilterGradientStop[] = [];
      for (let i = 0; i < numColors; i++) {
        const ratio = r.u8();
        stops.push({ ...colors[i]!, ratio });
      }
      const blurX = readFixed16(r);
      const blurY = readFixed16(r);
      const angle = readFixed16(r);
      const distance = readFixed16(r);
      const strength = readFixed8(r);
      const flags = r.u8();
      const gf = {
        stops, blurX, blurY, angle, distance, strength,
        inner: (flags & 0x80) !== 0,
        knockout: (flags & 0x40) !== 0,
        compositeSource: (flags & 0x20) !== 0,
        onTop: (flags & 0x10) !== 0,
        passes: flags & 0x0f,
      };
      return type === 4
        ? { kind: "gradient-glow" as const, ...gf }
        : { kind: "gradient-bevel" as const, ...gf };
    }
    case 5: { // ConvolutionFilter
      const matrixX = r.u8();
      const matrixY = r.u8();
      const readF32 = (): number => {
        const b = r.bytes(4);
        return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);
      };
      const divisor = readF32();
      const bias = readF32();
      const matrix: number[] = [];
      for (let i = 0; i < matrixX * matrixY; i++) matrix.push(readF32());
      const defaultR = r.u8();
      const defaultG = r.u8();
      const defaultB = r.u8();
      const defaultA = r.u8();
      const flags = r.u8();
      return {
        kind: "convolution" as const,
        matrixX,
        matrixY,
        matrix,
        divisor,
        bias,
        defaultR,
        defaultG,
        defaultB,
        defaultA,
        clamp: (flags & 0x01) !== 0,
        preserveAlpha: (flags & 0x02) !== 0,
      };
    }
    case 6: { // ColorMatrix
      const matrix: number[] = [];
      for (let i = 0; i < 20; i++) {
        const bytes = r.bytes(4);
        const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
        matrix.push(view.getFloat32(0, true));
      }
      return { kind: "color-matrix", matrix };
    }
    default:
      // Unknown filter type — cannot safely skip unknown-length data.
      return null;
  }
}

/**
 * Read the SWF-format filter list. `filterCount` is passed in (already consumed
 * by the caller). Returns the parsed filters; on a parse error the list is
 * truncated and the reader is positioned at EOF to trigger recovery.
 */
function readFilterList(r: Reader, filterCount: number): Fla8Filter[] {
  const filters: Fla8Filter[] = [];
  for (let i = 0; i < filterCount; i++) {
    if (r.eof()) break;
    try {
      const f = readOneFilter(r);
      if (f !== null) filters.push(f);
    } catch {
      // Parse error inside a filter record — can't safely continue.
      r.pos = r.buf.length;
      break;
    }
  }
  return filters;
}

// --- CPicSymbol / CPicSprite / CPicButton -------------------------------------

interface SymbolBaseFields {
  matrix: Fla8Matrix;
  libraryIndex: number;
  /** symbol schema byte: 8=F5, 0x0A=MX, 0x0E=MX2004, 0x13=F8/CS3, 0x16=CS4 */
  symbolSchema: number;
  /**
   * When true a filter parse error occurred so the remaining instance fields
   * (name, script, etc.) cannot be located reliably — callers should skip them.
   */
  filtersPresent: boolean;
  /** decoded color transform, or null if absent / identity-only */
  colorEffect: Fla8ColorEffect | null;
  /** Flash 8+ filters parsed from the filter list, or empty array */
  filters: Fla8Filter[];
  /** Flash 8 blend mode byte (0–14); 0 and 1 both mean "normal" */
  blendMode: number;
  /** Which frame of the symbol to start on (0-based). Default: 0. */
  firstFrame: number;
  /** How the graphic animates: 0=loop, 1=play-once, 2=single-frame. */
  loopMode: number;
}

/**
 * CPicSymbol base fields (shared by CPicSprite / CPicButton / CPicShapeObj).
 * Layout verified against flacomdoc's symbol-instance writer:
 *   u8 symbolSchema, matrix, u16 firstFrame, u8 loopMode, u8 0,
 *   (>=F4) u8 1, (>=F2) color-effect block, (>=F3) CString "",
 *   u16 libraryIndex, u16 0, (>=MX2004) 3 bytes,
 *   (>=F8) u8 filterCount (+ filterCount×filterRecord) + u8 blend + 2 bytes,
 *   (>=CS4) 3D matrix block (102 bytes)
 */
function readCPicSymbolFields(ctx: ParseCtx): SymbolBaseFields {
  const { r } = ctx;
  readCPicObjBase(ctx);
  const symbolSchema = r.u8();
  const matrix = readMatrix(r);
  const firstFrame = r.u16(); // first frame (0-based)
  const loopMode = r.u8(); // loop mode: 0=loop, 1=play-once, 2=single-frame
  r.skip(1);
  if (symbolSchema >= 7) r.skip(1);
  let colorEffect: Fla8ColorEffect | null = null;
  if (symbolSchema >= 4) {
    // Color transform block (flacomdoc CPicSymbol color xform). Per channel a
    // u16 multiplier in 8.8 fixed point (0x0100 = 1.0) and an s16 offset
    // (-255..255). Channel order: (alpha,) red, green, blue. The alpha pair is
    // only present from schema 6 (MX) onward.
    let aMult = 256;
    let aOff = 0;
    if (symbolSchema >= 6) {
      aMult = r.u16();
      aOff = r.s16();
    }
    const rMult = r.u16();
    const rOff = r.s16();
    const gMult = r.u16();
    const gOff = r.s16();
    const bMult = r.u16();
    const bOff = r.s16();
    r.skip(2); // effect type + reserved (UI mode hint, redundant with the xform)
    r.skip(2); // value percent (UI slider value, redundant with the xform)
    r.skip(4); // effect color (UI tint color, redundant with the xform)
    colorEffect = { rMult, rOff, gMult, gOff, bMult, bOff, aMult, aOff };
  }
  if (symbolSchema >= 6) readCString(r); // always-empty string
  const libraryIndex = r.u16();
  r.skip(2);
  if (symbolSchema >= 0x0e) r.skip(3);
  let filtersPresent = false;
  let filters: Fla8Filter[] = [];
  let blendMode = 0;
  if (symbolSchema >= 0x13) {
    // filterCount byte: 0 = no filters; >0 = that many SWF-format filter records.
    const filterCount = r.u8();
    if (filterCount > 0) {
      const savedPos = r.pos;
      try {
        filters = readFilterList(r, filterCount);
        // After filters: blend mode (u8) + 2 reserved bytes.
        blendMode = r.u8();
        r.skip(2); // 2 reserved bytes
        // If filterList parsing left the reader at EOF, recovery is needed.
        if (r.eof() && savedPos < r.buf.length) {
          filtersPresent = true; // signal that the trailer may be misaligned
        }
      } catch {
        filtersPresent = true; // parse error; trailing fields unreliable
      }
    } else {
      blendMode = r.u8(); // blend mode byte
      r.skip(2); // 2 reserved bytes
    }
  }
  if (!filtersPresent && symbolSchema >= 0x16) {
    r.skip(102); // CS4 3D transform block
  }
  return { matrix, libraryIndex, symbolSchema, filtersPresent, colorEffect, filters, blendMode, firstFrame, loopMode };
}

const DEFAULT_FIELDS: SymbolBaseFields = {
  matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  libraryIndex: 0,
  symbolSchema: 0,
  filtersPresent: false,
  colorEffect: null,
  filters: [],
  blendMode: 0,
  firstFrame: 0,
  loopMode: 0,
};

function readCPicSymbolInstance(ctx: ParseCtx, kind: Fla8Instance["kind"]): Fla8Instance {
  let fields = DEFAULT_FIELDS;
  try {
    fields = readCPicSymbolFields(ctx);
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  // Graphic instances end right after the symbol base fields.
  verifyBoundary(ctx);
  return {
    type: "instance",
    kind,
    matrix: fields.matrix,
    libraryIndex: fields.libraryIndex,
    instanceName: "",
    colorEffect: fields.colorEffect,
    filters: fields.filters,
    blendMode: fields.blendMode,
    script: "",
  };
}

function plausibleName(name: string): boolean {
  return name.length < 64 && /^[\x20-\x7e]*$/.test(name);
}

function readCPicSprite(ctx: ParseCtx): Fla8Instance {
  const { r } = ctx;
  let fields = DEFAULT_FIELDS;
  let instanceName = "";
  let script = "";
  try {
    fields = readCPicSymbolFields(ctx);
    if (!fields.filtersPresent) {
      const g = r.u8(); // sprite trailer version (3=F5, 6=MX, 8=MX2004+)
      if (g >= 3) {
        const sub = readTimelineSubObject(r); // instance id block + script
        if (sub.script) script = sub.script;
      }
      const name = readCString(r);
      if (plausibleName(name)) instanceName = name;
      if (g >= 6) {
        r.skip(9); // reserved block
        readAccessibilityMaybe(ctx, g >= 8);
        r.skip(8);
        if (g >= 8) {
          r.skip(5);
          readCString(r); // component metadata XML
        }
      } else if (g >= 3) {
        r.skip(5);
      }
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  verifyBoundary(ctx);
  return {
    type: "instance",
    kind: "sprite",
    matrix: fields.matrix,
    libraryIndex: fields.libraryIndex,
    instanceName,
    colorEffect: fields.colorEffect,
    filters: fields.filters,
    blendMode: fields.blendMode,
    script,
  };
}

function readCPicButton(ctx: ParseCtx): Fla8Instance {
  const { r } = ctx;
  let fields = DEFAULT_FIELDS;
  let instanceName = "";
  let script = "";
  let trackAsMenu = false;
  try {
    fields = readCPicSymbolFields(ctx);
    if (!fields.filtersPresent) {
      const b = r.u8(); // button trailer version (5=F5, 8=MX, 0x0B=MX2004+)
      if (b >= 5) {
        const sub = readTimelineSubObject(r);
        if (sub.script) script = sub.script;
        trackAsMenu = r.u8() !== 0;
        const name = readCString(r);
        if (plausibleName(name)) instanceName = name;
        if (b >= 8) readAccessibilityMaybe(ctx, b >= 0x0b);
        r.skip(4);
      }
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  verifyBoundary(ctx);
  return {
    type: "instance",
    kind: "button",
    matrix: fields.matrix,
    libraryIndex: fields.libraryIndex,
    instanceName,
    colorEffect: fields.colorEffect,
    filters: fields.filters,
    blendMode: fields.blendMode,
    script,
    ...(trackAsMenu ? { trackAsMenu } : {}),
  };
}

// --- CPicBitmap ----------------------------------------------------------------

function readCPicBitmapRef(ctx: ParseCtx): Fla8BitmapRef {
  const { r } = ctx;
  readCPicObjBase(ctx);
  let matrix: Fla8Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  let mediaId = 0;
  let filters: Fla8Filter[] = [];
  try {
    const schema = r.u8();
    matrix = readMatrix(r);
    mediaId = r.u16();
    if (schema >= 2) {
      // filterCount byte: 0 = no filters; >0 = SWF-format filter records (same
      // layout as symbol-instance filters).
      const filterCount = r.u8();
      if (filterCount > 0) {
        try {
          filters = readFilterList(r, filterCount);
        } catch {
          // Parse error inside filter data — skip to the record boundary.
          skipToNextBoundary(ctx);
        }
      }
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  verifyBoundary(ctx);
  return { type: "bitmap", matrix, mediaId, filters };
}

// --- CPicVideo ----------------------------------------------------------------
//
// CPicVideo is a video object placed on the timeline, analogous to CPicBitmap
// for bitmap instances. The binary layout (inferred from flacomdoc and the
// fla-decoder reference; no fixture FLA with video was available to verify):
//
//   CPicObjBase  (schema byte + flags byte + null child tag)
//   UI8          schema  (version byte, same pattern as CPicBitmap)
//   4×4 matrix   (16.16 fixed-point + tx/ty in twips)
//   UI16         mediaId — matches the "Media N" OLE stream with the FLV payload
//
// No filter fields are documented for CPicVideo in Flash 8; if future evidence
// shows otherwise, add filter parsing here (same as readCPicBitmapRef).

function readCPicVideo(ctx: ParseCtx): Fla8VideoRef {
  const { r } = ctx;
  readCPicObjBase(ctx);
  let matrix: Fla8Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  let mediaId = 0;
  try {
    r.skip(1); // schema version byte
    matrix = readMatrix(r);
    mediaId = r.u16();
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  verifyBoundary(ctx);
  return { type: "video", matrix, mediaId };
}

// --- CPicSwf ------------------------------------------------------------------
//
// CPicSwf is a placed embedded-SWF element.  Flash authoring lets users embed
// external SWF files as library symbols via File > Import; CPicSwf records the
// placement on the timeline.
//
// Binary layout (CS2 FLA, verified against Magnet.fla which has four instances):
//   CPicObjBase     (schema byte + flags byte + null child tag + registration point)
//   UI8             symbolSchema (observed: 6 or 7 in CS2 FLAs)
//   4×4 matrix      (16.16 fixed-point + tx/ty in twips, 24 bytes via readMatrix)
//   <variable tail> AS2 clip-event scripts (BomStrings), color transforms,
//                   instance name, loop/frame options — NOT fully decoded.
//
// The variable tail is 950-5500 bytes per instance (depending on embedded AS2
// scripts).  skipToNextBoundary() re-syncs the reader after the fixed header.

function readCPicSwf(ctx: ParseCtx): Fla8SwfRef {
  const { r } = ctx;
  let matrix: Fla8Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  try {
    readCPicObjBase(ctx);
    r.skip(1); // symbolSchema version byte (observed: 6 or 7 in CS2 FLAs)
    matrix = readMatrix(r);
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  // Skip the variable-length tail to re-sync at the next sibling element.
  skipToNextBoundary(ctx);
  return { type: "swf", matrix };
}

// --- CPicText ------------------------------------------------------------------

interface TextRun {
  fontName: string;
  sizePt: number;
  color: Fla8Color;
  bold: boolean;
  italic: boolean;
  align: number;
}

/** writeString: u8 length (with 0xFF/0xFFFF extensions) + chars, no BOM. */
function readPlainString(r: Reader, unicode: boolean): string {
  let len = r.u8();
  if (len === 0xff) {
    len = r.u16();
    if (len === 0xffff) len = r.u32();
  }
  if (len === 0) return "";
  return unicode ? utf16le(r.bytes(len * 2)) : ascii(r.bytes(len));
}

/**
 * One text run's formatting block. Layout from flacomdoc handleText:
 *   u8 runVersion, u16 size*20, String fontFamily, RGBA color,
 *   u16 fontCategory, u8 bold, u8 italic, u8 0, u8 autoKern, u8 charPos,
 *   u8 alignment, 4 x u16 spacing/indent/margins, u16 letterSpacing (F5+),
 *   String url, (MX+) vertical/rtl/rotation bytes + (MX2004+) bitmapRender +
 *   String target, (F8+) 0x02 + renderMode + 2 floats + String url
 * `ts` is the CPicText schema (5=F5, 9=MX, 0x0C=MX2004, 0x0D=F8/CS3, 0x0E=CS4).
 */
function readTextRunFields(r: Reader, ts: number): TextRun {
  const unicode = ts >= 0x0c;
  const cs4 = ts >= 0x0e;
  r.skip(1); // run version
  const sizePt = r.u16() / 20;
  const fontName = cs4 ? readCString(r) : readPlainString(r, unicode);
  if (cs4) {
    readCString(r); // CS4 face name
    r.skip(4);
  }
  const color = readColorRGBA(r);
  r.skip(2); // font category
  const bold = r.u8() !== 0;
  const italic = r.u8() !== 0;
  r.skip(1);
  r.skip(1); // autoKern
  r.skip(1); // character position
  const align = r.u8();
  r.skip(8); // line spacing, indent, left margin, right margin
  if (ts >= 5) r.skip(2); // letter spacing
  else r.skip(1);
  if (cs4) readCString(r);
  else readPlainString(r, unicode); // url
  if (ts >= 9) {
    r.skip(3); // vertical, right-to-left, rotation
    if (ts >= 0x0c) r.skip(1); // bitmap-render flag
    if (cs4) readCString(r);
    else readPlainString(r, unicode); // link target
  }
  if (ts >= 0x0d) {
    r.skip(2); // 0x02 marker + font rendering mode
    r.skip(8); // antialias thickness + sharpness (2 floats)
    if (cs4) readCString(r);
    else readPlainString(r, unicode); // url (repeated)
  }
  return { fontName, sizePt, color, bold, italic, align };
}

function readCPicText(ctx: ParseCtx): Fla8Text {
  const { r } = ctx;
  readCPicObjBase(ctx);
  const ts = r.u8(); // CPicText schema ("textVersion": 5=F5, 9=MX, 0xC=MX2004, 0xD=F8)
  const unicode = ts >= 0x0c;
  const matrix = readMatrix(r);
  const left = r.s32();
  const right = r.s32();
  const top = r.s32();
  const bottom = r.s32();
  r.skip(1); // autoExpand
  if (ts >= 4) r.skip(1); // reserved (F3+)
  let textFlags = 0;
  let embedFlag = 0;
  if (ts >= 4) {
    // bit 0x01 = editable (dynamic or input), 0x02 = dynamic, 0x04 = password,
    // 0x08 = wrap, 0x10 = multiline, 0x40 = border
    textFlags = r.u8();
    embedFlag = r.u8();
  }
  if (ts >= 5) r.skip(2); // selectable flags + reserved
  let maxChars = 0;
  let as2VariableName = "";
  if (ts >= 4) {
    maxChars = r.u16(); // maxCharacters
    as2VariableName = readCString(r); // AS1/2 variable name
  }
  if (embedFlag & 0x20) readCString(r); // embedded characters
  if (ts >= 0x0e) r.skip(1); // CS4 reserved

  let run: TextRun | null = null;
  let text = "";
  const runs: Fla8TextRun[] = [];
  try {
    if (embedFlag & 0x40) {
      // empty text: a single formatting run with no character-count prefix
      run = readTextRunFields(r, ts);
    } else {
      for (;;) {
        const charCount = r.u16();
        if (charCount === 0) break;
        if (charCount > 65000) throw new FlaEofError(`implausible run length ${charCount}`);
        const thisRun = readTextRunFields(r, ts);
        if (!run) run = thisRun;
        const runText = unicode ? utf16le(r.bytes(charCount * 2)) : ascii(r.bytes(charCount));
        text += runText;
        runs.push({
          text: runText,
          fontName: thisRun.fontName,
          fontSize: thisRun.sizePt,
          color: thisRun.color,
          bold: thisRun.bold,
          italic: thisRun.italic,
        });
      }
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
    warnOnce(ctx, "text record truncated; text content may be incomplete");
  }
  let instanceName = "";
  let filters: Fla8Filter[] = [];
  try {
    if (ts >= 9) {
      const name = readCString(r);
      if (plausibleName(name)) instanceName = name;
      readAccessibilityMaybe(ctx, ts >= 0x0c);
      r.skip(8); // reserved + scrollable flag + reserved
      if (ts >= 0x0c) {
        readCString(r); // reserved
        readCString(r); // font embed ranges
      }
      if (ts >= 0x0d) {
        // filterCount byte: 0 = no filters + 2 trailing bytes; >0 = SWF-format
        // filter records (same layout as symbol-instance filters) + 2 trailing bytes.
        const filterCount = r.u8();
        if (filterCount > 0) {
          try {
            filters = readFilterList(r, filterCount);
            r.skip(2); // 2 trailing bytes (blend mode hint + reserved)
          } catch {
            // Parse error inside filter data — skip to the record boundary.
            skipToNextBoundary(ctx);
          }
        } else {
          r.skip(2); // 2 trailing bytes present even when no filters
        }
      }
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  verifyBoundary(ctx);
  const alignNames = ["left", "right", "center", "justify"] as const;
  return {
    type: "text",
    // fold the local bounds origin into the placement translation
    matrix: { ...matrix, tx: matrix.tx + left / 20, ty: matrix.ty + top / 20 },
    width: (right - left) / 20,
    height: (bottom - top) / 20,
    text,
    fontName: run?.fontName ?? "",
    fontSize: run?.sizePt ?? 12,
    color: run?.color ?? { r: 0, g: 0, b: 0, a: 255 },
    bold: run?.bold ?? false,
    italic: run?.italic ?? false,
    align: alignNames[run?.align ?? 0] ?? "left",
    instanceName,
    textType: (textFlags & 0x01) === 0 ? "static" : textFlags & 0x02 ? "dynamic" : "input",
    wordWrap: (textFlags & 0x08) !== 0,
    multiline: (textFlags & 0x10) !== 0,
    password: (textFlags & 0x04) !== 0,
    maxChars,
    hasBorder: (textFlags & 0x40) !== 0,
    as2VariableName,
    filters,
    // Instance color effect for text fields is not yet decoded from the binary
    // (no confirmed fixture for the exact byte layout in CPicText). The field is
    // populated by callers that construct Fla8Text directly (e.g. unit tests).
    colorEffect: null,
    runs,
  };
}

// --- CPicFrame -----------------------------------------------------------------

/**
 * Timeline sub-object (FUN_8facd0). For frames this carries the frame's
 * ActionScript source; for sprites it carries loop/firstFrame metadata.
 */
function readTimelineSubObject(r: Reader): { script: string } {
  // typeId is the per-version "frameVersionC": 0=Flash5, 1=MX, 4=MX2004/F8,
  // 5=CS3/CS4. formatType is 1 for frames written by the authoring tool.
  const typeId = r.u32();
  const formatType = r.u32();
  let script = "";
  if (formatType === 1) {
    if (typeId >= 1) {
      // MX+: random frame id (u16) + zeros, then an id-list count
      r.skip(4);
      const count = r.u32();
      if (count > 0 && count < 10000) r.skip(count * 4);
    }
    if (typeId >= 5) r.skip(4); // CS3+: four extra reserved bytes
    script = readCString(r);
  } else if (formatType === 0) {
    r.skip(4);
    const pfCount = r.u32();
    if (pfCount > 0 && pfCount < 10000) r.skip(pfCount * 4);
  }
  return { script };
}

/**
 * CPicFrame : CPicShape : CPicObj. Children of the frame's CPicObj base are
 * the display objects placed on this keyframe. The frame's inherited
 * CPicShape body is read inline (rather than via readCPicShape) because the
 * children must be kept.
 */
function readCPicFrameNode(ctx: ParseCtx): ParsedFrameNode {
  const { r } = ctx;
  const base = readCPicObjBase(ctx);
  // inherited CPicShape body
  const shapeSchema = r.u8();
  const matrix = readMatrix(r);
  const ownShape = readShapeData(ctx, shapeSchema > 2);

  let duration = 1;
  let keyMode = 0;
  let label = "";
  let labelIsComment = false;
  let script = "";
  let motionEase = 0;
  let motionEaseCurve: Fla8EaseCurve | null = null;
  let motionRotate: "none" | "auto" | "cw" | "ccw" = "none";
  let motionRotateCount = 0;
  let motionOrientToPath = false;
  let soundId = 0;
  let soundSync = -1;
  let soundLoop = -1;
  let inPoint: number | undefined;
  let outPoint: number | undefined;
  let envelopePoints: Array<{ pos: number; leftLevel: number; rightLevel: number }> | undefined;

  try {
    const fs = r.u8();
    duration = Math.max(1, r.u16());
    if (fs > 2) keyMode = r.u16();
    else r.skip(1);
    if (fs > 1) motionEase = r.s16(); // signed ease value: -100 (ease in) to +100 (ease out)
    if (fs > 4) soundId = r.u16();
    if (fs > 5) {
      const cnt = r.u16();
      if (cnt > 0 && cnt < 10000) {
        envelopePoints = [];
        for (let i = 0; i < cnt; i++) {
          const pos = r.u32();
          const leftLevel = r.u16();
          const rightLevel = r.u16();
          envelopePoints.push({ pos, leftLevel, rightLevel });
        }
      }
    }
    if (fs > 6) {
      soundLoop = r.u16();
      soundSync = r.u8();
      inPoint = r.u32();   // inPoint44: sample offset at 44100 Hz
      outPoint = r.u32();  // outPoint44: sample offset at 44100 Hz
    }
    if (fs > 7) r.skip(2); // soundZoomLevel
    if (fs > 8) {
      label = readCString(r); // frame label ("name" in XFL)
      if (fs >= 19) {
        // MX+ frame tail: frameVersionC block + frameId + BomString script
        script = readTimelineSubObject(r).script;
        // post-script fields (flacomdoc order): motionTweenRotate u32,
        // rotateTimes u32, comment flag u32, morph tag, ...
        if (fs > 10) {
          const rotateFlaValue = r.u32(); // 1=none, 2=auto, 3=CW, 4=CCW
          const rotateMap: Record<number, "none" | "auto" | "cw" | "ccw"> = {
            1: "none",
            2: "auto",
            3: "cw",
            4: "ccw",
          };
          motionRotate = rotateMap[rotateFlaValue] ?? "none";
          motionRotateCount = r.u32(); // extra full rotations beyond normal interpolation
          if (fs > 11) {
            labelIsComment = r.u32() === 1;
          }
          if (fs > 12) {
            const morphTag = r.u16();
            if (morphTag !== 0) {
              // Back up so skipMorphData can re-read the class tag, then skip
              // the entire CPicMorphShape object (including CMorphSegment/
              // CMorphCurve children). The reader is repositioned at the next
              // sibling CPicFrame's class tag (end keyframe) or at the null
              // terminator of the parent CPicLayer's children list.
              // We return immediately rather than reading the remaining frame-
              // tail fields, which would otherwise advance the reader past the
              // correctly-positioned next CPicFrame class tag.
              r.pos -= 2;
              skipMorphData(ctx);
              return finishFrame();
            }
          }
          if (fs > 13) motionOrientToPath = r.u32() !== 0; // motionTweenSnap / orient-to-path flag
          if (fs > 14) {
            const oblistTag = r.u16();
            if (oblistTag !== 0) {
              r.pos -= 2;
              frameTailEndScan(r);
              return finishFrame();
            }
          }
          if (fs > 15) readCString(r); // field_298 (tween instance name)
          if (fs > 19) r.skip(4);
          if (fs > 20) r.skip(4);
          if (fs >= 22) r.skip(4);
          if (fs >= 24) {
            // Flash 8+ ease curve data: useSingleEaseCurve (u32) + hasCustomEase (u32)
            // followed by 6 per-property point arrays when hasCustomEase != 0.
            // Properties in order: position(0), rotation(1), scale(2), color(3),
            // filters(4), all(5).
            // Each point array: u32 numPoints, then for each point:
            //   - if first or last: f64 x, f64 y, f64 x, f64 y  (32 bytes — written twice)
            //   - otherwise:        f64 x, f64 y                 (16 bytes)
            const useSingleEaseCurve = r.u32();
            const hasCustomEase = r.u32();
            if (hasCustomEase !== 0) {
              const PROP_COUNT = 6;
              const curves: Array<Fla8EaseCurve | null> = [];
              for (let p = 0; p < PROP_COUNT; p++) {
                const numPoints = r.u32();
                if (numPoints === 0) {
                  curves.push(null);
                  continue;
                }
                const pts: Array<{ x: number; y: number }> = [];
                for (let i = 0; i < numPoints; i++) {
                  const x = r.f64();
                  const y = r.f64();
                  if (i === 0 || i === numPoints - 1) {
                    // anchor endpoints are written twice; consume the duplicate
                    r.f64();
                    r.f64();
                  }
                  pts.push({ x, y });
                }
                // A 4-point bezier: pts[0]=(0,0), pts[1]=c1, pts[2]=c2, pts[3]=(1,1)
                if (pts.length >= 4) {
                  curves.push({
                    x1: Math.max(0, Math.min(1, pts[1]!.x)),
                    y1: pts[1]!.y,
                    x2: Math.max(0, Math.min(1, pts[2]!.x)),
                    y2: pts[2]!.y,
                  });
                } else {
                  curves.push(null);
                }
              }
              // When useSingleEaseCurve is set, the "all" property (index 5) applies
              // to every property; otherwise use "position" (index 0) falling back to "all".
              if (useSingleEaseCurve !== 0) {
                motionEaseCurve = curves[5] ?? null;
              } else {
                motionEaseCurve = curves[0] ?? curves[5] ?? null;
              }
            }
          }
        }
      } else {
        // Flash 5/MX-era frame tail (schemas 9..18) is only partially
        // understood; skip to the next frame/layer boundary.
        warnOnce(
          ctx,
          `frame schema ${fs}: frame scripts beyond the label are not extracted for this FLA version`,
        );
        frameTailEndScan(r);
      }
    } else if (fs > 2 && fs <= 8) {
      // F1-F4: script stored as serialized action records, not source text.
      warnOnce(ctx, `frame schema ${fs} (Flash 4 or older): scripts not extracted`);
      frameTailEndScan(r);
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }

  return finishFrame();

  function finishFrame(): ParsedFrameNode {
    const elements: Fla8Element[] = [];
    // The frame's own shape body (merge-drawing strokes/fills drawn directly
    // on the stage live on the inherited CPicShape, not a child object).
    if (ownShape.edges.length > 0) {
      elements.push({
        type: "shape",
        matrix,
        fills: ownShape.fills,
        strokes: ownShape.strokes,
        edges: ownShape.edges,
      });
    }
    for (const c of base.children) {
      if (c.cls === "element") elements.push(c.element);
    }
    return {
      cls: "CPicFrame",
      frame: { duration, label, labelIsComment, script, keyMode, motionEase, motionEaseCurve, motionRotate, motionRotateCount, motionOrientToPath, soundId, soundSync, soundLoop, inPoint, outPoint, envelopePoints, elements },
    };
  }
}

/**
 * Reposition after an undecodable frame tail: find the next object-tail
 * signature whose following byte looks like the start of another record.
 */
function frameTailEndScan(r: Reader): void {
  let search = r.pos;
  while (search < r.buf.length - 14) {
    const idx = findEndMarker(r.buf, search);
    if (idx < 0 || idx >= r.buf.length - 14) break;
    const after = idx + 10;
    const schemaByte = r.buf[after]!;
    if (schemaByte <= 30) {
      r.pos = idx;
      return;
    }
    search = idx + 1;
  }
  r.pos = r.buf.length;
}

/**
 * Skip the CPicMorphShape (and its CMorphSegment/CMorphCurve children) that
 * follows the morph-tag field in a shape-tweened CPicFrame.
 *
 * The morph object is serialized inline in the CPicFrame tail — it is NOT a
 * child of the CPicFrame in the CArchive children list. After skipping, the
 * reader is positioned either:
 *   - at the next sibling CPicFrame's CArchive class tag (the end keyframe),
 *   - or at the null terminator that ends the parent CPicLayer's children list.
 *
 * Strategy: scan forward looking for a CPicFrame class backref (because the
 * end keyframe is the next sibling), then fall back to `frameTailEndScan` if
 * no such tag is found within a reasonable window.
 *
 * We also read the morph class tag properly (so the CArchive class table stays
 * consistent for any subsequent backref resolution in this stream).
 */
function skipMorphData(ctx: ParseCtx): void {
  const { r, ar } = ctx;
  // Consume the class tag (NEWCLASS or backref) so the ArchiveReader class
  // table is updated and subsequent class-tag reads remain consistent.
  try {
    const morphClassTag = ar.readClassTag();
    if (morphClassTag.kind === "class") {
      warnOnce(ctx, `shape tween morph data (${morphClassTag.name}) skipped — end keyframe will supply end shape`);
    }
  } catch {
    // readClassTag can throw for malformed data; proceed with position scan.
  }

  // Look for the next CPicFrame class tag (sibling end keyframe) or a valid
  // frame-boundary end marker within a generous lookahead window.
  const cpicFrameTag = ar.classBackrefTag("CPicFrame");
  const limit = Math.min(r.buf.length - 4, r.pos + 8192);
  for (let i = r.pos; i < limit; i++) {
    const lo = r.buf[i]!;
    const hi = r.buf[i + 1]!;
    const v = lo | (hi << 8);

    // Check for CPicFrame class backref (sibling end keyframe).
    if (cpicFrameTag !== null && v === cpicFrameTag) {
      // Verify the byte after the class tag looks like a plausible CPicObjBase
      // schema byte (0–10 is safe; values above 30 indicate a false positive).
      const schemaByte = r.buf[i + 2]!;
      if (schemaByte <= 10) {
        r.pos = i;
        return;
      }
    }

    // Check for NULL class tag followed by the INT_MIN registration-point
    // sentinel — this is the end of the parent CPicLayer's children list.
    if (v === 0x0000 && i + END_MARKER.length <= r.buf.length) {
      let matchEndMarker = true;
      for (let j = 2; j < END_MARKER.length; j++) {
        if (r.buf[i + j] !== END_MARKER[j]) { matchEndMarker = false; break; }
      }
      if (matchEndMarker) {
        r.pos = i;
        return;
      }
    }
  }

  // Final fallback: use the original end-marker scan.
  frameTailEndScan(r);
}

// ---------------------------------------------------------------------------
// Timeline stream entry point
// ---------------------------------------------------------------------------

/**
 * Parse a "Page N" / "Symbol N" timeline stream into layers/frames/elements.
 * Throws on structurally-unreadable input.
 */
export function parseFla8Timeline(bytes: Uint8Array): Fla8Timeline {
  const r = new Reader(bytes);
  const ar = new ArchiveReader(r);
  const ctx: ParseCtx = { r, ar, warnings: new Set() };

  const rootMarker = r.u8();
  if (rootMarker !== 0x01) {
    throw new Error(`unexpected root marker 0x${rootMarker.toString(16)} (expected 0x01)`);
  }
  const tag = ar.readClassTag();
  if (tag.kind !== "class") {
    throw new Error("expected a class tag at the root of the timeline stream");
  }
  if (tag.name !== "CPicPage") {
    throw new Error(`unexpected root class "${tag.name}" (expected CPicPage)`);
  }
  const page = readCPicPage(ctx);
  if (page.cls !== "CPicPage") throw new Error("internal: root did not parse as a page");
  return { layers: page.layers.map((l) => l.layer) };
}

// ---------------------------------------------------------------------------
// Contents stream parsing (document-level info)
// ---------------------------------------------------------------------------

function findBytes(buf: Uint8Array, pattern: number[], from: number): number {
  outer: for (let i = Math.max(0, from); i <= buf.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (buf[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function utf16Pattern(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    out.push(s.charCodeAt(i) & 0xff, s.charCodeAt(i) >> 8);
  }
  return out;
}

/** Read an FF FE FF BomString at `pos`; returns null if not present. */
function tryReadBomStringAt(buf: Uint8Array, pos: number): { value: string; end: number } | null {
  if (pos + 4 > buf.length) return null;
  if (buf[pos] !== 0xff || buf[pos + 1] !== 0xfe || buf[pos + 2] !== 0xff) return null;
  let len = buf[pos + 3]!;
  let p = pos + 4;
  if (len === 0xff) {
    if (p + 2 > buf.length) return null;
    len = buf[p]! | (buf[p + 1]! << 8);
    p += 2;
  }
  if (p + len * 2 > buf.length) return null;
  return { value: utf16le(buf.subarray(p, p + len * 2)), end: p + len * 2 };
}

/**
 * Extract document-level info from the "Contents" stream. All extraction is
 * best-effort: missing pieces come back as null/empty and are logged.
 */
export function parseFla8Contents(bytes: Uint8Array): Fla8ContentsInfo {
  const formatVersion = bytes.length > 0 ? bytes[0]! : 0;
  const unicode = formatVersion >= 0x38; // MX2004 and later store UTF-16 strings

  const info: {
    width: number | null;
    height: number | null;
    frameRate: number | null;
    backgroundColor: Fla8Color | null;
  } = { width: null, height: null, frameRate: null, backgroundColor: null };

  // -- background color + frame rate -----------------------------------------
  // flacomdoc writes a fixed run ending in:
  //   bgR bgG bgB FF gridR gridG gridB FF 00 fpsFrac fpsInt 00 00 00 03 B4 00 00 00
  // Anchor on "03 B4 00 00 00" and read backwards.
  let anchor = -1;
  {
    anchor = findBytes(bytes, [0x03, 0xb4, 0x00, 0x00, 0x00], 0);
    if (anchor >= 14) {
      const fpsInt = bytes[anchor - 4]!;
      const fpsFrac = bytes[anchor - 5]!;
      const fps = fpsInt + fpsFrac / 256;
      if (fps >= 1 && fps <= 120) {
        info.frameRate = fps;
        info.backgroundColor = {
          r: bytes[anchor - 14]!,
          g: bytes[anchor - 13]!,
          b: bytes[anchor - 12]!,
          a: 255,
        };
      }
    }
  }

  // -- stage dimensions --------------------------------------------------------
  // Written as u16 width*20, six zero bytes, u16 height*20, four zero bytes,
  // shortly before the background/frame-rate block. Search the window before
  // the anchor and prefer the match closest to it.
  {
    const searchEnd = anchor > 0 ? anchor : Math.min(bytes.length - 14, 8192);
    const searchStart = anchor > 0 ? Math.max(0, anchor - 256) : 0;
    for (let i = searchEnd - 14; i >= searchStart; i--) {
      const w20 = bytes[i]! | (bytes[i + 1]! << 8);
      if (w20 < 20 || w20 > 8192 * 20 || w20 % 20 !== 0) continue;
      let zeros = true;
      for (let j = 2; j < 8; j++) {
        if (bytes[i + j] !== 0) {
          zeros = false;
          break;
        }
      }
      if (!zeros) continue;
      const h20 = bytes[i + 8]! | (bytes[i + 9]! << 8);
      if (h20 < 20 || h20 > 8192 * 20 || h20 % 20 !== 0) continue;
      if (bytes[i + 10] !== 0 || bytes[i + 11] !== 0 || bytes[i + 12] !== 0 || bytes[i + 13] !== 0)
        continue;
      info.width = w20 / 20;
      info.height = h20 / 20;
      break;
    }
    if (info.width === null) {
      console.warn("[FLA import] could not locate stage dimensions in Contents stream");
    }
  }

  // -- scene names ---------------------------------------------------------------
  // Each CDocumentPage record carries the page stream name ("Page 1") as a
  // plain length-prefixed string followed by the scene display name as a
  // BomString.
  const sceneNames = new Map<string, string>();
  if (unicode) {
    for (const prefix of ["Page ", "P "]) {
      const pat = utf16Pattern(prefix);
      let pos = 0;
      for (;;) {
        const idx = findBytes(bytes, pat, pos);
        if (idx < 0) break;
        pos = idx + 1;
        const lenByte = idx >= 1 ? bytes[idx - 1]! : 0;
        if (lenByte < prefix.length || lenByte > 64) continue;
        const end = idx + lenByte * 2;
        if (end > bytes.length) continue;
        const streamName = utf16le(bytes.subarray(idx, end));
        if (!/^(Page \d+|P \d+ \d+)$/.test(streamName)) continue;
        const scene = tryReadBomStringAt(bytes, end);
        if (scene && scene.value.length > 0 && scene.value.length < 128) {
          sceneNames.set(streamName, scene.value);
        }
      }
    }
  } else {
    // Pre-MX2004: ASCII CString format (u8 len + chars). Scan for "Page N" or
    // "P N N" stream names followed immediately by the scene display name as
    // another ASCII CString. This matches the MFC CArchive CDocumentPage
    // serialisation used by Flash 5 and MX.
    for (const prefix of ["Page ", "P "]) {
      const prefixBytes = Array.from(prefix).map((c) => c.charCodeAt(0));
      let pos = 0;
      for (;;) {
        const idx = findBytes(bytes, prefixBytes, pos);
        if (idx < 0) break;
        pos = idx + 1;
        // The length byte immediately precedes the string data
        if (idx < 1) continue;
        const lenByte = bytes[idx - 1]!;
        if (lenByte < prefix.length || lenByte > 64) continue;
        const end = idx + lenByte;
        if (end > bytes.length) continue;
        const streamName = ascii(bytes.subarray(idx, end));
        if (!/^(Page \d+|P \d+ \d+)$/.test(streamName)) continue;
        // Scene display name follows as the next ASCII CString
        if (end >= bytes.length) continue;
        const nameLen = bytes[end]!;
        if (nameLen === 0 || nameLen >= 0xff) continue; // empty or long-form
        const nameEnd = end + 1 + nameLen;
        if (nameEnd > bytes.length) continue;
        const sceneName = ascii(bytes.subarray(end + 1, nameEnd));
        if (sceneName.length > 0 && sceneName.length < 128) {
          // Normalise to "Page N" key (pre-MX uses full form in practice)
          if (!sceneNames.has(streamName)) {
            sceneNames.set(streamName, sceneName);
          }
        }
      }
    }
  }

  // -- symbol library table ---------------------------------------------------
  // Contents stream layout for each symbol entry (unicode/MX2004+ format):
  //   length-prefixed UTF-16 stream name ("Symbol N")
  //   BomString: library display name
  //   UI32LE: stream number (redundant cross-check)
  //   UI8: symbol type (0=graphic, 1=button, 2=movieclip)
  //   BomString: linkageIdentifier (empty when not set)
  //   UI8: exportInFirstFrame (1 = export in first frame, Flash default)
  //   UI8: exportForActionScript (1 = exported for AS2 attachMovie/new ClassName)
  //   UI8: exportForRuntimeSharing
  //   UI8: importForRuntimeSharing
  // Then, at a fixed offset of 41 bytes after s.end (the end of the display-name
  // BomString), the writeAsLinkage block begins:
  //   s.end+41: UI32 zero prefix (00 00 00 00)
  //   s.end+45: asLinkageVersion (1 byte: 5=MX2004, 7=Flash8/CS3)
  //   s.end+46: flags byte (exportForAS | importForRS)
  //   s.end+47: 3 zero bytes
  //   s.end+50: BomString(linkageIdentifier) [real, authoritative copy]
  //   after:    BomString(linkageURL)
  //   after:    BomString(className)          ← AS2 class name
  // (verified against flacomdoc FlaConverter.writeAsLinkage() and real fixtures)
  const symbols = new Map<number, Fla8SymbolInfo>();
  if (unicode) {
    for (const prefix of ["Symbol ", "S "]) {
      const pat = utf16Pattern(prefix);
      let pos = 0;
      for (;;) {
        const idx = findBytes(bytes, pat, pos);
        if (idx < 0) break;
        pos = idx + 1;
        const lenByte = idx >= 1 ? bytes[idx - 1]! : 0;
        if (lenByte < prefix.length || lenByte > 64) continue;
        const end = idx + lenByte * 2;
        if (end > bytes.length) continue;
        const streamName = utf16le(bytes.subarray(idx, end));
        const m = /^(?:Symbol (\d+)|S (\d+) \d+)$/.exec(streamName);
        if (!m) continue;
        const num = parseInt(m[1] ?? m[2]!, 10);
        // The library display name follows as the next BomString within a
        // short window; the symbol-type byte sits 4 bytes after the name.
        let search = end;
        const windowEnd = Math.min(bytes.length - 4, end + 120);
        while (search < windowEnd) {
          const s = tryReadBomStringAt(bytes, search);
          if (s) {
            const name = s.value;
            if (name.length > 0 && !name.includes("/") && !name.startsWith(".\\")) {
              // s.end+0..3 = UI32LE stream number (skip — we already know num)
              // s.end+4    = typeByte
              let typeByte: number | null = null;
              if (s.end + 5 <= bytes.length) typeByte = bytes[s.end + 4]!;

              // s.end+5: BomString linkageIdentifier (if present)
              let linkageIdentifier = "";
              let exportInFirstFrame = false;
              let exportForActionScript = false;
              let exportForRuntimeSharing = false;
              let importForRuntimeSharing = false;
              // linkageFlagsEnd: byte offset right after the 4 linkage flag bytes.
              // Used below as the scan-start for the scale9Grid block.
              let linkageFlagsEnd = s.end + 5;
              if (s.end + 5 < bytes.length) {
                const lnk = tryReadBomStringAt(bytes, s.end + 5);
                if (lnk !== null) {
                  linkageIdentifier = lnk.value;
                  // After linkageIdentifier: 4 boolean bytes
                  // Observed layout from real Flash 8 binaries (no-linkage case):
                  //   [0]=exportInFirstFrame(1=default), [1]=exportForActionScript(0),
                  //   [2]=exportForRuntimeSharing(0),    [3]=importForRuntimeSharing(0)
                  const flagBase = lnk.end;
                  if (flagBase + 4 <= bytes.length) {
                    exportInFirstFrame     = bytes[flagBase]!     !== 0;
                    exportForActionScript  = bytes[flagBase + 1]! !== 0;
                    exportForRuntimeSharing = bytes[flagBase + 2]! !== 0;
                    importForRuntimeSharing = bytes[flagBase + 3]! !== 0;
                    linkageFlagsEnd = flagBase + 4;
                  }
                }
              }

              // Read className from the writeAsLinkage block at s.end + 41.
              // Layout (flacomdoc FlaConverter.writeAsLinkage, MX2004+ unicode):
              //   [s.end+41..44]: 00 00 00 00 (zero prefix — validates the offset)
              //   [s.end+45]:     asLinkageVersion (5 or 7)
              //   [s.end+46]:     flags
              //   [s.end+47..49]: 00 00 00
              //   [s.end+50]:     BomString(linkageIdentifier)
              //                   BomString(linkageURL)
              //                   BomString(className)  ← target
              let className = "";
              const laStart = s.end + 41;
              if (
                laStart + 9 < bytes.length &&
                bytes[laStart]!     === 0 &&
                bytes[laStart + 1]! === 0 &&
                bytes[laStart + 2]! === 0 &&
                bytes[laStart + 3]! === 0
              ) {
                // skip 9-byte header: UI32 zero + version + flags + 3×zero
                const laIdent = tryReadBomStringAt(bytes, laStart + 9);
                if (laIdent !== null) {
                  const laUrl = tryReadBomStringAt(bytes, laIdent.end);
                  if (laUrl !== null) {
                    const laCn = tryReadBomStringAt(bytes, laUrl.end);
                    if (laCn !== null) className = laCn.value;
                  }
                }
              }

              // Decode the scale9Grid block (Flash 8+ only, formatVersion >= 0x3F).
              //
              // The block lives in the CDocumentPage symbol entry in the Contents
              // stream, immediately after the F5 pre-scale9Grid anchor pattern:
              //   [FF FE FF 00][FF FE FF 00][00 00 00 00][FF FE FF 00]  (16 bytes)
              //     empty BomString  empty BomString  4 zeros  empty BomString
              // Followed by 20 bytes (flacomdoc FlaConverter.writeSymbols, F8):
              //   UI32 toggle  (1=enabled, 0=disabled)
              //   UI32 right   (twips = px * 20)
              //   UI32 left    (twips = px * 20)
              //   UI32 bottom  (twips = px * 20)
              //   UI32 top     (twips = px * 20)
              // Disabled: toggle=0, all values=0x80000000 (INT_MIN sentinel).
              let scale9Grid: Fla8SymbolInfo["scale9Grid"] = null;
              if (formatVersion >= 0x3f) {
                const prePattern = [
                  0xff, 0xfe, 0xff, 0x00, // empty BomString
                  0xff, 0xfe, 0xff, 0x00, // empty BomString
                  0x00, 0x00, 0x00, 0x00, // 4 zero bytes (F5 padding)
                  0xff, 0xfe, 0xff, 0x00, // empty BomString
                ];
                // Scan within a bounded window from after the linkage flag bytes.
                // The scale9Grid block is typically 300-600 bytes past the flags.
                const scanLimit = Math.min(bytes.length - 36, linkageFlagsEnd + 2000);
                const gridPrePos = findBytes(bytes, prePattern, linkageFlagsEnd);
                if (gridPrePos >= linkageFlagsEnd && gridPrePos < scanLimit) {
                  const gridPos = gridPrePos + prePattern.length; // skip 16-byte anchor
                  if (gridPos + 20 <= bytes.length) {
                    const dv = new DataView(bytes.buffer, bytes.byteOffset + gridPos, 20);
                    const toggle = dv.getUint32(0, true);
                    const right  = dv.getUint32(4, true);
                    const left   = dv.getUint32(8, true);
                    const bottom = dv.getUint32(12, true);
                    const top    = dv.getUint32(16, true);
                    if (toggle === 1) {
                      scale9Grid = {
                        left:   left   / 20,
                        top:    top    / 20,
                        right:  right  / 20,
                        bottom: bottom / 20,
                      };
                    }
                  }
                }
              }

              if (!symbols.has(num)) {
                symbols.set(num, {
                  name,
                  typeByte,
                  linkageIdentifier,
                  className,
                  exportForActionScript,
                  exportInFirstFrame,
                  exportForRuntimeSharing,
                  importForRuntimeSharing,
                  scale9Grid,
                });
              }
            }
            break;
          }
          search++;
        }
      }
    }
  }

  // -- sound library table ----------------------------------------------------
  // Sounds in the Contents stream appear as stream names like "Sound N" or
  // short-form "So N N", followed by the display name as a BomString.
  const sounds = new Map<number, Fla8SoundInfo>();
  if (unicode) {
    for (const prefix of ["Sound ", "So "]) {
      const pat = utf16Pattern(prefix);
      let pos = 0;
      for (;;) {
        const idx = findBytes(bytes, pat, pos);
        if (idx < 0) break;
        pos = idx + 1;
        const lenByte = idx >= 1 ? bytes[idx - 1]! : 0;
        if (lenByte < prefix.length || lenByte > 64) continue;
        const end = idx + lenByte * 2;
        if (end > bytes.length) continue;
        const streamName = utf16le(bytes.subarray(idx, end));
        const m = /^(?:Sound (\d+)|So (\d+) \d+)$/.exec(streamName);
        if (!m) continue;
        const num = parseInt(m[1] ?? m[2]!, 10);
        // The library display name follows as the next BomString within a short window.
        let search = end;
        const windowEnd = Math.min(bytes.length - 2, end + 120);
        while (search < windowEnd) {
          const s = tryReadBomStringAt(bytes, search);
          if (s) {
            const name = s.value;
            if (name.length > 0 && !name.includes("/") && !name.startsWith(".\\")) {
              if (!sounds.has(num)) sounds.set(num, { name });
            }
            break;
          }
          search++;
        }
      }
    }
  }

  // -- video library table ----------------------------------------------------
  // Video items in the Contents stream appear as stream names "Video N" or
  // short-form "Vi N N", followed by the library display name as a BomString.
  // The media stream number in "Video N" matches the mediaId stored in each
  // CPicVideo stage element and the corresponding "Media N" OLE stream that
  // carries the FLV payload.
  const videos = new Map<number, Fla8VideoInfo>();
  if (unicode) {
    for (const prefix of ["Video ", "Vi "]) {
      const pat = utf16Pattern(prefix);
      let pos = 0;
      for (;;) {
        const idx = findBytes(bytes, pat, pos);
        if (idx < 0) break;
        pos = idx + 1;
        const lenByte = idx >= 1 ? bytes[idx - 1]! : 0;
        if (lenByte < prefix.length || lenByte > 64) continue;
        const end = idx + lenByte * 2;
        if (end > bytes.length) continue;
        const streamName = utf16le(bytes.subarray(idx, end));
        const m = /^(?:Video (\d+)|Vi (\d+) \d+)$/.exec(streamName);
        if (!m) continue;
        const num = parseInt(m[1] ?? m[2]!, 10);
        // The library display name follows as the next BomString within a short window.
        let search = end;
        const windowEnd = Math.min(bytes.length - 2, end + 120);
        while (search < windowEnd) {
          const s = tryReadBomStringAt(bytes, search);
          if (s) {
            const name = s.value;
            if (name.length > 0 && !name.includes("/") && !name.startsWith(".\\")) {
              if (!videos.has(num)) videos.set(num, { name });
            }
            break;
          }
          search++;
        }
      }
    }
  }

  return {
    formatVersion,
    width: info.width,
    height: info.height,
    frameRate: info.frameRate,
    backgroundColor: info.backgroundColor,
    sceneNames,
    symbols,
    sounds,
    videos,
  };
}
