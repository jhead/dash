/**
 * `Contents` stream writer (§8 of docs/21-fla-binary-format.md).
 *
 * The importer reads the Contents stream by byte-pattern search + fixed offsets
 * (`parseFla8Contents`), not a structured CDocument* walk. This writer therefore
 * emits exactly the anchored byte patterns the reader scans for:
 *
 *   - formatVersion = Contents[0]  (0x49 => Flash 8; >= 0x38 enables unicode,
 *     >= 0x3F enables scale9Grid)
 *   - the stage/bg/fps block ending in the `03 B4 00 00 00` anchor
 *   - each scene: a length-prefixed UTF-16 "Page N" stream name + BomString
 *     scene display name (in authored play order)
 *   - each symbol: length-prefixed UTF-16 "Symbol N" + BomString display name,
 *     stream number, type byte, linkage block (§8.5 writeAsLinkage), scale9Grid
 *
 * Confidence:
 *   - §8.1 preamble (23 bytes) and §8.4 stage/document-properties block are
 *     byte-exact to flacomdoc FlaConverter.writeStage and decode cleanly with
 *     the spec-faithful tools/flashdrv/flaparse.py (stage W/H/fps/bg) — [V].
 *   - Scenes/symbols are emitted as real CDocumentPage records (documentPageVersion
 *     0x17 + String name + BomString display name + symbolId/type trailer), which
 *     flaparse.py's catalog walker recognises AND the importer's forward scan
 *     resolves. The CArchive object structure of the property maps, color table,
 *     QuickTime settings, font/folder lists and version trailer that real Flash
 *     writes AFTER the stage block (§8.4 tail) is NOT reproduced — only the
 *     library catalog the importer consumes. So the catalog is [V] for what is
 *     emitted but does not reproduce the full post-stage tail.
 */

import { ByteWriter, writeBomString } from "./carchive-write.js";
import { parseHexColor } from "./timeline-write.js";

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
  formatVersion: number;
  widthPx: number;
  heightPx: number;
  frameRate: number;
  backgroundHex: string;
  scenes: ContentsSceneEntry[];
  symbols: ContentsSymbolEntry[];
  media: ContentsMediaEntry[];
}

/** Write a length-prefixed UTF-16LE stream-name string (e.g. "Page 1"). */
function writeUtf16StreamName(w: ByteWriter, name: string): void {
  w.u8(name.length); // length byte (chars) — the reader reads bytes[idx-1]
  for (let i = 0; i < name.length; i++) w.u16(name.charCodeAt(i));
}

export function writeContents(input: ContentsInput): Uint8Array {
  const w = new ByteWriter(512);

  // -- Preamble (§8.1): contentsVersion byte. -------------------------------
  // formatVersion is Contents[0]; the importer keys 0x49 => Flash 8 (>= 0x38
  // unicode, >= 0x3F scale9). The remaining 22 bytes of the 23-byte Flash 8
  // preamble are zero (the per-release skip + version-gated u32 zeros of §8.1).
  // §8.1: contentsVersion(=formatVersion), contentsVersionB=1, skip(3),
  // F3 skip(1), F4 skip(1), then F5/MX/MX2004/F8 each a u32 0. Total 23 bytes.
  w.u8(input.formatVersion); // 0x49 for Flash 8
  w.u8(1); // contentsVersionB
  w.raw(0x00, 0x00, 0x00); // skip(3)
  w.u8(0x00); // F3 skip(1)
  w.u8(0x00); // F4 skip(1)
  w.u32(0).u32(0).u32(0).u32(0); // F5, MX, MX2004, F8 -> 4 x u32 0

  // -- Stage + document properties block (§8.4), byte-exact to flacomdoc
  //    FlaConverter.writeStage. Offsets in the comments are relative to the
  //    start of this block (the rulerUnits descriptor). ----------------------
  const bg = parseHexColor(input.backgroundHex);
  const grid = { r: 0x94, g: 0x94, b: 0x94 }; // flacomdoc default grid color
  const w20 = Math.round(input.widthPx) * 20;
  const h20 = Math.round(input.heightPx) * 20;
  const gridSpacingX = 10;
  const previewMode = 3; // "anti alias text" (flacomdoc default)
  const rulerVisible = 0;
  const pageTabsVisible = 0;
  const viewOptions = 1 + 4; // animation control + pasteboard (flacomdoc default)
  const playOptions = 1 + 2 + 4 + 8; // loop + play pages + frame actions + sounds
  const fpsInt = Math.floor(input.frameRate);
  const fpsFrac = Math.round((input.frameRate - fpsInt) * 256) & 0xff;

  w.u8(5).u8(0x00).u8(0).u8(0x00); // rulerUnitType=pixels(5), 00, gridVisible?3:0=0, 00  @+0
  w.raw(0x00, 0x00, 0x00); //                                                         @+4
  w.u16(w20); //                                                                      @+7
  w.raw(0, 0, 0, 0, 0, 0); //                                                         @+9
  w.u16(h20); //                                                                      @+15
  w.raw(0, 0, 0, 0); //                                                               @+17
  w.u16(gridSpacingX * 20); //                                                        @+21
  w.u8(previewMode).u8(rulerVisible).u8(pageTabsVisible); //                          @+23
  w.u8(((playOptions << 4) | viewOptions) & 0xff); //                                 @+26
  // 29-byte constant run (§8.4 skip(29)).                                            @+27
  w.raw(
    0x00, 0x68, 0x01, 0x00, 0x00, 0x68, 0x01, 0x00, 0x00, 0x68, 0x01, 0x00, 0x00, 0x68,
    0x01, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
  );
  w.u8(bg.r).u8(bg.g).u8(bg.b).u8(0xff); // background + alpha constant            @+56
  w.u8(grid.r).u8(grid.g).u8(grid.b).u8(0xff); // grid color + FF                  @+60
  w.u8(0x00); //                                                                   @+64
  w.u8(fpsFrac).u8(fpsInt); // frame rate 8.8 (fraction first)                     @+65
  w.raw(0x00, 0x00); //                                                            @+67
  w.raw(0x00, 0x03, 0xb4, 0x00, 0x00, 0x00); // trailing anchor                    @+69

  // -- Scenes (§8.2). A scene is a CDocumentPage record:
  //      u8  documentPageVersion = 0x17
  //      String    pageName    ("Page N", u8 len + UTF-16LE)
  //      BomString sceneName
  //      u16 symbolId = 0, u16 0, u8 symbolType = 0
  //    Emit order == authored play order (the reader keys sceneNames Map by it).
  //    The leading 0x17 + the symbolId/type trailer make the record a real
  //    CDocumentPage that flaparse.py recognises; the importer's forward
  //    string-scan still resolves the "Page N" name + BomString unchanged.
  for (const s of input.scenes) {
    w.u8(0x17); // documentPageVersion
    writeUtf16StreamName(w, s.pageStreamName);
    writeBomString(w, s.sceneName);
    w.u16(0); // symbolId = 0 for a scene
    w.u16(0); // reserved
    w.u8(0); // symbolType = 0 for a scene
    // Trailing separator so adjacent records don't run together for the scanner.
    w.raw(0x00, 0x00);
  }

  // -- Symbols (§8.3). ---------------------------------------------------------
  for (const sym of input.symbols) {
    writeSymbolEntry(w, sym, input.formatVersion);
  }

  // -- Media catalog entries (bitmaps / sounds / video). ----------------------
  for (const m of input.media) {
    writeMediaEntry(w, m);
  }

  return w.finish();
}

function writeSymbolEntry(w: ByteWriter, sym: ContentsSymbolEntry, formatVersion: number): void {
  // CDocumentPage symbol record (§8.3). Leading documentPageVersion byte makes
  // it a real CDocumentPage for flaparse.py; the importer's forward scan keys on
  // the "Symbol N" string and the BomString name that follow.
  w.u8(0x17); // documentPageVersion
  // length-prefixed UTF-16 "Symbol N"
  writeUtf16StreamName(w, `Symbol ${sym.num}`);
  // BomString display name. The reader then reads, at name.end:
  //   +0 u32 stream number
  //   +4 u8 typeByte
  //   +5 BomString linkageIdentifier
  //      4 flag bytes
  //   ... and at name.end + 41 the writeAsLinkage block.
  // We must lay the bytes out so name.end (the offset right after the display
  // BomString) lands exactly where the reader expects. Capture that offset by
  // emitting the BomString, then padding to the fixed offsets.
  writeBomString(w, sym.displayName);
  // name.end is "here". Layout from this point:
  w.u32(sym.num); // +0 stream number
  w.u8(sym.typeByte); // +4 type byte
  // +5: BomString linkageIdentifier + 4 flag bytes.
  const beforeLinkage = w.length;
  writeBomString(w, sym.linkageIdentifier);
  w.u8(sym.exportInFirstFrame ? 1 : 0);
  w.u8(sym.exportForActionScript ? 1 : 0);
  w.u8(sym.exportForRuntimeSharing ? 1 : 0);
  w.u8(sym.importForRuntimeSharing ? 1 : 0);
  const afterFlags = w.length;

  // The writeAsLinkage block must begin at (name.end + 41). name.end corresponds
  // to the `beforeLinkage - 5` position (since +0..+4 are 5 bytes before the
  // linkage id). Compute padding to reach name.end + 41.
  const nameEnd = beforeLinkage - 5;
  const targetLinkageStart = nameEnd + 41;
  let pad = targetLinkageStart - afterFlags;
  if (pad < 0) pad = 0; // if the linkage id was long, the offset can't be hit; reader gracefully skips
  for (let i = 0; i < pad; i++) w.u8(0);

  // writeAsLinkage block (§8.5):
  //   u32 = 0  | u8 version | u8 flags | u8[3]=0 | BomString id | BomString url
  //   | BomString className | u8 versionIndicator | u32=2 | BomString srcFla
  //   | BomString fullLibPath
  w.u32(0); // zero prefix (validates the offset)
  w.u8(7); // asLinkageVersion (F8/CS3)
  let laFlags = 0;
  if (sym.exportForActionScript) laFlags |= 0x01;
  if (sym.importForRuntimeSharing) laFlags |= 0x02;
  w.u8(laFlags);
  w.u8(0).u8(0).u8(0);
  writeBomString(w, sym.linkageIdentifier);
  writeBomString(w, ""); // linkageURL
  writeBomString(w, sym.className);
  w.u8(0); // version indicator
  w.u32(2); // observed constant
  writeBomString(w, ""); // sourceFlaPath
  writeBomString(w, sym.fullPath); // fullLibraryPath

  // scale9Grid (§8.3, formatVersion >= 0x3F). The reader scans forward from the
  // linkage flags for the 16-byte anchor, then reads 20 bytes.
  if (formatVersion >= 0x3f) {
    // 16-byte anchor: empty BomString, empty BomString, 4 zeros, empty BomString.
    w.raw(0xff, 0xfe, 0xff, 0x00);
    w.raw(0xff, 0xfe, 0xff, 0x00);
    w.raw(0x00, 0x00, 0x00, 0x00);
    w.raw(0xff, 0xfe, 0xff, 0x00);
    if (sym.scale9Grid) {
      const g = sym.scale9Grid;
      w.u32(1); // toggle = enabled
      w.u32(Math.round(g.right * 20));
      w.u32(Math.round(g.left * 20));
      w.u32(Math.round(g.bottom * 20));
      w.u32(Math.round(g.top * 20));
    } else {
      w.u32(0); // toggle = disabled
      w.u32(0x80000000).u32(0x80000000).u32(0x80000000).u32(0x80000000);
    }
  }

  // Separator.
  w.raw(0x00, 0x00);
}

function writeMediaEntry(w: ByteWriter, m: ContentsMediaEntry): void {
  // The reader discovers bitmaps via "Media N" inside CMedia* CArchive objects,
  // and sounds/videos via "Sound N"/"Video N" stream names. For the round-trip
  // tests we only need bitmaps to resolve (so bitmap placements find a library
  // item). The simplest reliable path the importer takes for bitmaps is the
  // "Media N" -> library bitmap mapping built directly from the Media streams in
  // buildFla8Document (bitmapIdByIndex), which does NOT require a Contents entry.
  // We still emit a Video/Sound stream-name entry so those display names import.
  if (m.kind === "video") {
    writeUtf16StreamName(w, `Video ${m.num}`);
    writeBomString(w, m.displayName);
    w.raw(0x00, 0x00);
  } else if (m.kind === "sound") {
    writeUtf16StreamName(w, `Sound ${m.num}`);
    writeBomString(w, m.displayName);
    w.u32(m.num); // stream number
    writeBomString(w, ""); // linkage id
    w.u8(0); // exportForActionScript
    w.raw(0x00, 0x00);
  }
  // bitmaps: no Contents entry needed (resolved from the Media stream itself).
}
