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
 * Confidence: the catalog structure is reconstructed to satisfy the importer's
 * scanners. It is [O]-faithful (parses cleanly + round-trips), NOT byte-verified
 * against a Win7 Flash 8 oracle.
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

  // -- Preamble (§8.1): formatVersion byte + a small fixed header. ------------
  w.u8(input.formatVersion);
  // A short padding/header run. The reader anchors everything else by pattern,
  // so the exact bytes here are not significant beyond formatVersion at [0].
  w.raw(0x00, 0x00, 0x00);

  // -- Stage dimensions block. The reader looks for: u16 w*20, 6 zero bytes,
  //    u16 h*20, 4 zero bytes within 256 bytes before the bg/fps anchor. ------
  const w20 = Math.round(input.widthPx) * 20;
  const h20 = Math.round(input.heightPx) * 20;
  w.u16(w20);
  w.raw(0, 0, 0, 0, 0, 0); // 6 zero bytes
  w.u16(h20);
  w.raw(0, 0, 0, 0); // 4 zero bytes

  // A few filler bytes between dims and the bg/fps anchor (must stay < 256 and
  // must not accidentally form another dims match closer to the anchor).
  w.raw(0x01, 0x02, 0x03, 0x04);

  // -- Background color + frame rate, ending in the `03 B4 00 00 00` anchor. --
  // Reader reads backwards from the anchor:
  //   bgR bgG bgB FF  gridR gridG gridB FF  00  fpsFrac fpsInt  00 00 00  anchor
  const bg = parseHexColor(input.backgroundHex);
  const fpsInt = Math.floor(input.frameRate);
  const fpsFrac = Math.round((input.frameRate - fpsInt) * 256) & 0xff;
  w.u8(bg.r).u8(bg.g).u8(bg.b).u8(0xff); // background RGB + FF
  w.u8(0xc0).u8(0xc0).u8(0xc0).u8(0xff); // grid color RGB + FF
  w.u8(0x00);
  w.u8(fpsFrac).u8(fpsInt);
  w.raw(0x00, 0x00, 0x00);
  w.raw(0x03, 0xb4, 0x00, 0x00, 0x00); // anchor

  // -- Scenes (§8.2). Each: length-prefixed UTF-16 "Page N" + BomString name.
  //    Emit order == authored play order (the reader keys sceneNames Map by it).
  for (const s of input.scenes) {
    writeUtf16StreamName(w, s.pageStreamName);
    writeBomString(w, s.sceneName);
    // A couple of separator bytes so adjacent scene names don't run together in
    // a way that confuses the scanner.
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
