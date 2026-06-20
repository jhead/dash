/**
 * `Contents` stream writer (§8 of docs/21-fla-binary-format.md).
 *
 * This is a genuine MFC CArchive serializer whose ONLY contract is byte-level
 * compatibility with real Macromedia Flash 8. The output for a default empty
 * document is byte-identical to `fixtures/flash8-empty.fla`'s `Contents`
 * (17312 bytes), modulo two volatile u32 timestamp fields. See `empty-templates.ts`.
 *
 * Object-by-object structure of a real Flash 8 `Contents`:
 *
 *   1. §8.1 preamble                — 23 bytes, byte0 = contentsVersion 0x3F.
 *   2. one CDocumentPage per SCENE  — NEWCLASS CDocumentPage (schema 1) on the
 *      first, backref thereafter; documentPageVersion 0x17, "Page N" (String),
 *      sceneName (BomString), symbolId/reserved/symbolType, empty BomString, and
 *      the FixedPageTail constant run (§8.7) carrying two volatile timestamps.
 *   3. one CDocumentPage per SYMBOL — same record shape, with the symbol's
 *      one-based id and symbolType, linkage in the AsLinkage block (§8.5).
 *   4. §8.4 stage + document-properties block (model-derived stage geometry).
 *   5. the post-stage default template — property maps, the CColorDef swatch
 *      palette, CQTAudioSettings, publish/print/font defaults, and the version /
 *      mobileSettings XML trailer. These are settings the model does not
 *      represent; the canonical Flash-default record is emitted verbatim, framed
 *      inside the CArchive (CColorDef + CQTAudioSettings are real NEWCLASS objects).
 *
 * Model-derived fields (stage W/H/fps/bg/grid, scene/symbol names + order, symbol
 * ids/types/linkage) are COMPUTED; the unrepresented settings are emitted as the
 * canonical default record. The two are kept distinct, per the format contract.
 */

import { ByteWriter, ClassTable, writeBomString } from "./carchive-write.js";
import { parseHexColor } from "./timeline-write.js";
import {
  CONTENTS_PREAMBLE,
  CONTENTS_SCENE_TAIL,
  CONTENTS_POST_STAGE,
} from "./empty-templates.js";

/**
 * Deterministic value used for every volatile timestamp / ItemID field so the
 * output is reproducible. The real fixture stores 0x6A3377D5; any fixed value
 * keeps Flash happy (these are creation-time stamps Flash resets on resave).
 */
export const FIXED_TIMESTAMP = 0x6a3377d5;

/** Volatile u32 offsets inside CONTENTS_SCENE_TAIL (relative to its start). */
const SCENE_TAIL_TS_OFFSETS = [0x18, 0x5c];

/**
 * writeAsLinkage block offsets INSIDE the FixedPageTail (CONTENTS_SCENE_TAIL),
 * relative to the tail start. Verified byte-for-byte against the genuine
 * `flash8-empty.fla` scene tail AND against `fixtures/golden/golden.fla`'s
 * "Coin" symbol record (a real Flash 8 symbol with `exportForActionScript`
 * linkage). The block layout (matching the `flash8-binary.ts` decoder, which is
 * itself verified against golden.fla's "Coin" record and flacomdoc
 * `FlaConverter.writeAsLinkage`) is:
 *
 *   tail+0x20 (32): UI32 00 00 00 00  zero prefix (decoder anchor)
 *   tail+0x24 (36): UI8 asLinkageVersion (0x07 = Flash 8)
 *   tail+0x25 (37): UI8 flags  (bit0 = exportForActionScript, bit1 = importForRuntimeSharing)
 *   tail+0x26 (38): 00 00 00   (3 zero bytes)
 *   tail+0x29 (41): BomString(linkageIdentifier)   ← empty `FF FE FF 00` in the empty tail
 *   tail+0x2D (45): BomString(linkageURL)           ← empty
 *   tail+0x31 (49): BomString(className)            ← empty in the empty tail; we inject here
 *
 * The UI32 length field at tail+0x1C counts only the linkageIdentifier +
 * linkageURL BomStrings (=0x0C when both are empty), NOT the className, so
 * injecting a className does not change it. We keep linkageIdentifier/URL empty
 * IN THIS BLOCK (the heuristic linkageIdentifier copy decoded elsewhere is
 * unaffected) — exactly the shape golden.fla's "Coin" record carries — and only
 * splice in the className BomString plus set the flags byte. This is a strictly
 * additive change scoped to symbols that actually carry an AS2 className; the
 * empty-linkage tail is emitted byte-identically (preserving the empty-bytematch
 * Flash 8 oracle). See docs/33-as2-classes-vfs.md (export-compat section) for the
 * full byte-level investigation and the limits of this approach.
 */
const TAIL_LINKAGE_FLAGS_OFF = 0x25; // 37 — writeAsLinkage flags byte
const TAIL_CLASSNAME_BOM_OFF = 0x31; // 49 — start of the empty className `FF FE FF 00`
const EMPTY_BOMSTRING_LEN = 4; // FF FE FF 00

export interface ContentsSceneEntry {
  /** "Page N" stream name (creation order). */
  pageStreamName: string;
  /** Scene display name (authored play-order is the emit order). */
  sceneName: string;
}

export interface ContentsSymbolEntry {
  /** "Symbol N" stream number. */
  num: number;
  displayName: string;
  /** 0 = graphic, 1 = button, 2 = movieclip. */
  typeByte: number;
  linkageIdentifier: string;
  className: string;
  exportForActionScript: boolean;
  exportInFirstFrame: boolean;
  exportForRuntimeSharing: boolean;
  importForRuntimeSharing: boolean;
  fullPath: string;
  scale9Grid: { left: number; top: number; right: number; bottom: number } | null;
}

export interface ContentsMediaEntry {
  /** stream number for "Media N". */
  num: number;
  displayName: string;
  /** "bitmap" | "sound" | "video" */
  kind: "bitmap" | "sound" | "video";
}

export interface ContentsInput {
  /** Kept for API compatibility; the real contentsVersion (0x3F) is always emitted. */
  formatVersion: number;
  widthPx: number;
  heightPx: number;
  frameRate: number;
  backgroundHex: string;
  /** Grid color "#rrggbb"; Flash's default is #c0c0c0. */
  gridHex?: string;
  /** Grid spacing in pixels (model gridWidth); default 18. */
  gridSpacingPx?: number;
  scenes: ContentsSceneEntry[];
  symbols: ContentsSymbolEntry[];
  media: ContentsMediaEntry[];
}

/** Write a length-prefixed UTF-16LE String (no BOM), e.g. the "Page 1" pageName. */
function writeUtf16String(w: ByteWriter, name: string): void {
  w.u8(name.length);
  for (let i = 0; i < name.length; i++) w.u16(name.charCodeAt(i));
}

/** Stamp the deterministic timestamp into a tail copy at its volatile u32 offsets. */
function stampTimestamps(tail: Uint8Array): void {
  for (const off of SCENE_TAIL_TS_OFFSETS) {
    tail[off] = FIXED_TIMESTAMP & 0xff;
    tail[off + 1] = (FIXED_TIMESTAMP >>> 8) & 0xff;
    tail[off + 2] = (FIXED_TIMESTAMP >>> 16) & 0xff;
    tail[off + 3] = (FIXED_TIMESTAMP >>> 24) & 0xff;
  }
}

/** Append the CDocumentPage FixedPageTail constant run with deterministic timestamps. */
function writeSceneTail(w: ByteWriter): void {
  const tail = new Uint8Array(CONTENTS_SCENE_TAIL);
  stampTimestamps(tail);
  w.bytes(tail);
}

/**
 * Encode a BomString (`FF FE FF <len> <UTF-16LE>`) as a byte array for splicing
 * into the tail. REUSES the canonical {@link writeBomString} (and thus the shared
 * `writeBomLength` length-prefix escalation: 1 byte for <0xff, `0xff`+UI16 for
 * <0xffff, `0xff`+UI16(0xffff)+UI32 otherwise) so the className encoding can never
 * diverge from the rest of the writer. The previous hand-rolled `s.length & 0xff`
 * single-byte length truncated/corrupted classNames longer than 254 code units.
 */
function bomStringBytes(s: string): Uint8Array {
  const w = new ByteWriter(8 + s.length * 2);
  writeBomString(w, s);
  return w.finish();
}

/**
 * Append the symbol FixedPageTail. For a symbol with NO AS2 className the tail is
 * byte-identical to {@link writeSceneTail} (empty linkage). For a symbol WITH a
 * className the className BomString is spliced into the empty className slot of
 * the writeAsLinkage block and the flags byte is set — see the offset constants
 * above. This is the only place the binary FLA writer encodes the per-symbol
 * `AS 2.0 class` (className) linkage that real Flash 8 reads back from the Symbol
 * stream's CDocumentPage record.
 */
function writeSymbolTail(w: ByteWriter, sym: ContentsSymbolEntry): void {
  const className = sym.className ?? "";
  // No className → emit the exact empty-linkage tail (preserves byte-compat).
  if (className.length === 0) {
    writeSceneTail(w);
    return;
  }

  const base = new Uint8Array(CONTENTS_SCENE_TAIL);
  stampTimestamps(base);

  // Set the writeAsLinkage flags byte (exportForActionScript | importForRuntimeSharing).
  let flags = 0;
  if (sym.exportForActionScript) flags |= 0x01;
  if (sym.importForRuntimeSharing) flags |= 0x02;
  base[TAIL_LINKAGE_FLAGS_OFF] = flags;

  // Splice the className BomString into the empty className slot, keeping every
  // byte before it and after it intact (the length field at +0x1C is unchanged
  // because it counts only linkageIdentifier+linkageURL, both still empty).
  const cn = bomStringBytes(className);
  const head = base.subarray(0, TAIL_CLASSNAME_BOM_OFF);
  const tailAfter = base.subarray(TAIL_CLASSNAME_BOM_OFF + EMPTY_BOMSTRING_LEN);
  w.bytes(head);
  w.bytes(cn);
  w.bytes(tailAfter);
}

export function writeContents(input: ContentsInput): Uint8Array {
  const w = new ByteWriter(20000);
  const ct = new ClassTable();

  // -- §8.1 preamble ---------------------------------------------------------
  w.bytes(CONTENTS_PREAMBLE);

  // -- Scenes (§8.2) as CDocumentPage records --------------------------------
  // Emit order == authored play order. The first CDocumentPage declares the
  // class (NEWCLASS schema 1); later scenes/symbols backref it.
  for (const s of input.scenes) {
    ct.useClass(w, "CDocumentPage", 1);
    w.u8(0x17); // documentPageVersion
    writeUtf16String(w, s.pageStreamName); // "Page N" String (unicode, no BOM)
    writeBomString(w, s.sceneName); // sceneName BomString
    w.u16(0); // symbolId = 0 for a scene
    w.u16(0); // reserved
    w.u8(0); // symbolType = 0 for a scene
    w.u8(0xff).u8(0xfe).u8(0xff).u8(0); // empty BomString
    writeSceneTail(w);
  }

  // -- Symbols (§8.3) as CDocumentPage records -------------------------------
  for (const sym of input.symbols) {
    ct.useClass(w, "CDocumentPage", 1);
    w.u8(0x17);
    writeUtf16String(w, `Symbol ${sym.num}`);
    writeBomString(w, sym.displayName);
    w.u16(sym.num); // symbolId (one-based)
    w.u16(0);
    w.u8(sym.typeByte); // 0 graphic, 1 button, 2 movieclip
    w.u8(0xff).u8(0xfe).u8(0xff).u8(0); // empty BomString
    // FixedPageTail: empty-linkage symbols emit the constant run byte-for-byte;
    // symbols with an AS2 className get the className spliced into the
    // writeAsLinkage block (the per-symbol "AS 2.0 class" Flash 8 reads back).
    writeSymbolTail(w, sym);
  }

  // -- §8.4 stage + document properties block --------------------------------
  writeStageBlock(w, input);

  // -- Post-stage default template (§8.4 tail .. trailer) --------------------
  w.bytes(CONTENTS_POST_STAGE);

  return w.finish();
}

/**
 * §8.4 stage + document-properties block (75 bytes). Model-derived: stage
 * width/height (twips), grid spacing/color, background, frame rate. The constant
 * runs match the genuine empty fixture byte-for-byte.
 */
function writeStageBlock(w: ByteWriter, input: ContentsInput): void {
  const bg = parseHexColor(input.backgroundHex);
  const grid = parseHexColor(input.gridHex ?? "#c0c0c0");
  const w20 = Math.round(input.widthPx) * 20;
  const h20 = Math.round(input.heightPx) * 20;
  const gridSpacing20 = Math.round((input.gridSpacingPx ?? 18) * 20);
  const fpsInt = Math.floor(input.frameRate);
  const fpsFrac = Math.round((input.frameRate - fpsInt) * 256) & 0xff;

  w.u8(5).u8(0x00).u8(0).u8(0x00); // rulerUnitType=pixels(5), 00, gridVisible=0, 00   @+0
  w.raw(0x00, 0x00, 0x00); //                                                            @+4 skip(3)
  w.u16(w20); //                                                                         @+7 width*20
  w.raw(0, 0, 0, 0, 0, 0); //                                                            @+9 skip(6)
  w.u16(h20); //                                                                         @+15 height*20
  w.raw(0, 0, 0, 0); //                                                                  @+17 skip(4)
  w.u16(gridSpacing20); //                                                               @+21 gridSpacingX*20
  w.u8(3).u8(0).u8(0); //                                                                @+23 previewMode=3, rulerVisible=0, pageTabs=0
  w.u8(0x8d); //                                                                         @+26 playOptions<<4|viewOptions (Flash 8 default)
  // 29-byte constant run                                                                @+27
  w.raw(
    0x00, 0x68, 0x01, 0x00, 0x00, 0x68, 0x01, 0x00, 0x00, 0x68, 0x01, 0x00, 0x00, 0x68,
    0x01, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
  );
  w.u8(bg.r).u8(bg.g).u8(bg.b).u8(0xff); //                                              @+56 background + 0xFF
  w.u8(grid.r).u8(grid.g).u8(grid.b); //                                                 @+60 grid color
  w.u8(0xff); //                                                                         @+63
  w.u8(0x00); //                                                                         @+64
  w.u8(fpsFrac).u8(fpsInt); //                                                           @+65 fps 8.8 (frac, int)
  w.raw(0x00, 0x00); //                                                                  @+67
  w.raw(0x00, 0x03, 0xb4, 0x00, 0x00, 0x00); //                                          @+69 anchor
}
