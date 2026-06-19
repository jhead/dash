/**
 * @flash/swf — SWF v8 compiler
 *
 * Public API:
 *  - compileDocument(doc): Uint8Array   Compile a FlashDocument → SWF binary
 *  - SwfWriter                          Low-level SWF tag assembler
 *  - BitWriter                          Bit-level binary writer
 */
export { compileDocument } from "./compile.js";
export { analyzeFrameSizes } from "./profiler.js";
export type { FrameSizeReport } from "./profiler.js";
export type { CompileOptions } from "./compile.js";
export { generateHtmlWrapper } from "./html.js";
export type { HtmlPublishSettings } from "./html.js";
export { exportSWF, triggerDownload } from "./export.js";
export { SwfWriter } from "./writer.js";
export { BitWriter } from "./bits.js";
export { Tag } from "./tags.js";
export type { TagCode } from "./tags.js";
export { encodeDefineShape4, encodePlaceObject2 } from "./shapes.js";
export { encodeDefineBitsLossless2 } from "./bitmaps.js";
export {
  encodeDefineVideoStream,
  encodeVideoFrame,
  demuxFlv,
  probeFlv,
  videoCodecName,
  flvCodecToSwfCodec,
  VideoCodec,
} from "./video.js";
export type { FlvVideoFrame, FlvVideoStream, VideoProbe, VideoCodecId } from "./video.js";
export {
  resolveFontGlyphSources,
  bundledGlyphSource,
  glyphSourceFromFontBytes,
  resolveSystemGlyphSource,
  pickLocalFace,
  hasLocalFontAccess,
} from "./font-extract.js";
export type { GlyphSource, FontFaceRequest } from "./font-extract.js";
export { collectFontFaceRequests } from "./compile.js";
