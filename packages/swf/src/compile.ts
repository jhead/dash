/**
 * Document model → SWF binary compiler.
 *
 * Emits a valid SWF v8 with:
 *  - FileAttributes, SetBackgroundColor
 *  - DefineShape4 + PlaceObject2 per shape (defined once, placed per-frame with Move semantics)
 *  - DefineEditText + PlaceObject2 per text field
 *  - PlaceObject3 (with FILTERLIST) for objects with Flash 8 filters
 *  - RemoveObject2 when objects leave the display list
 *  - ShowFrame per frame, End
 */
import type { BitmapFill, BitmapItem, ButtonHandler, ButtonSounds, ClipAction, DisplayObject, FlashDocument, FontItem, Shape, SoundItem, Symbol, VideoDisplayObject, VideoItem } from "@flash/core";
import { layerFrameCount, compileAS2, getTweenedFrame, getTweenSpans, applyEase } from "@flash/core";
import { deflateSync } from "fflate";
import { Tag } from "./tags.js";
import { SwfWriter } from "./writer.js";
import {
  encodeDefineShape4,
  encodeBitmapFillShape,
  encodePlaceObject2,
  encodePlaceObject2Move,
  encodePlaceObject2WithAlpha,
  encodePlaceObject2WithName,
  encodePlaceObject2WithCXForm,
  encodePlaceObject2WithClipDepth,
  encodePlaceObject2WithClipActions,
} from "./shapes.js";
import {
  encodeDefineMorphShape2,
  encodePlaceObject2WithRatio,
} from "./morphshape.js";
import { encodeDefineEditText, encodePlaceObject2ForText, encodeCSMTextSettings } from "./text.js";
import { encodeDefineFont2, encodeDefineFontAlignZones, fontKey } from "./fonts.js";
import {
  encodePlaceObject3WithFilters,
  encodePlaceObject3WithBlendMode,
  encodePlaceObject3WithCacheAsBitmap,
  hasEnabledFilters,
} from "./filters.js";
import { colorEffectToCXForm } from "./cxform.js";
import { BitWriter } from "./bits.js";
import { writeRect, px } from "./helpers.js";
import { encodeDefineSprite } from "./sprite.js";
import { encodeDefineButton2, encodeDefineButtonSound } from "./buttons.js";
import {
  encodeDefineSound,
  encodeSoundStreamHead,
  encodeSoundStreamBlock,
  encodeSoundStreamBlockMp3,
  soundFormat,
  soundRate,
} from "./audio.js";
import { encodeStartSound, encodeStartSound2 } from "./sounds.js";
import { dataUriToBytes, encodeDefineBitsLossless2, encodeDefineBitsJpeg3, ensureJpegEOI } from "./bitmaps.js";
import {
  encodeDefineVideoStream,
  encodeVideoFrame,
  demuxFlv,
  flvCodecToSwfCodec,
  VideoCodec,
  type FlvVideoFrame,
} from "./video.js";
import { encodeDoInitAction } from "./doInitAction.js";
import { encodeFrameLabel } from "./framelabel.js";
import { encodeSceneAndFrameLabelData, hasAnyLabels } from "./scenelabels.js";
import { buildXmpMetadata, type MetadataOptions } from "./metadata.js";

// ---------------------------------------------------------------------------
// Video placement helpers
// ---------------------------------------------------------------------------

/**
 * Computes the PlaceObject2 transform for a VideoDisplayObject. The
 * DefineVideoStream character has the stream's native pixel dimensions, so we
 * scale it to the requested display width/height, then apply the object's own
 * scaleX/scaleY/rotation on top. Returns `undefined` when the resulting
 * transform is the identity (avoids emitting a redundant HasScale/HasRotate).
 */
function videoFitTransform(
  vdo: VideoDisplayObject,
  videoStreams: ReadonlyArray<{ itemId: string; width: number; height: number }>
):
  | { scaleX?: number; scaleY?: number; rotation?: number }
  | undefined {
  const stream = videoStreams.find((s) => s.itemId === vdo.videoItemId);
  const nativeW = stream && stream.width > 0 ? stream.width : vdo.width;
  const nativeH = stream && stream.height > 0 ? stream.height : vdo.height;
  const fitX = nativeW > 0 ? vdo.width / nativeW : 1;
  const fitY = nativeH > 0 ? vdo.height / nativeH : 1;
  const scaleX = fitX * (vdo.scaleX ?? 1);
  const scaleY = fitY * (vdo.scaleY ?? 1);
  const rotation = vdo.rotation ?? 0;
  if (scaleX === 1 && scaleY === 1 && rotation === 0) return undefined;
  return { scaleX, scaleY, rotation };
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/** Parse a CSS hex color string like "#rrggbb" → { r, g, b }. */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

// ---------------------------------------------------------------------------
// Tag body builders
// ---------------------------------------------------------------------------

/**
 * FileAttributes (tag 69) — MUST be the first tag in SWF v8+.
 * 4-byte UI32 flags:
 *   bit 0: useNetwork (0 = local/sandbox, 1 = network)
 *   bit 3: actionScript3
 *   bit 4: hasMetadata (set when a Metadata tag (77) is present)
 * For AS2, local sandbox: 0x00000000
 */
function buildFileAttributes(hasMetadata?: boolean): Uint8Array {
  const bw = new BitWriter();
  const flags = hasMetadata ? 0x00000010 : 0x00000000;
  bw.writeUI32LE(flags);
  return bw.getBytes();
}

/**
 * SetBackgroundColor (tag 9) — 3 bytes: R G B.
 */
function buildSetBackgroundColor(hex: string): Uint8Array {
  const { r, g, b } = parseHexColor(hex);
  const bw = new BitWriter();
  bw.writeUI8(r);
  bw.writeUI8(g);
  bw.writeUI8(b);
  return bw.getBytes();
}

/**
 * ProductInfo (tag 41) — identifies the authoring tool that produced the SWF.
 * Body layout (26 bytes):
 *   UI32 productId    = 8  (Flash 8 authoring tool)
 *   UI32 edition      = 0  (Standard)
 *   UI8  majorVersion = 8
 *   UI8  minorVersion = 0
 *   UI64 buildNumber  = 0  (two UI32s LE)
 *   UI64 compileTime  = 0  (milliseconds since 1 Jan 1970 UTC, two UI32s LE)
 */
function buildProductInfo(): Uint8Array {
  // 4 + 4 + 1 + 1 + 8 + 8 = 26 bytes
  const buf = new ArrayBuffer(26);
  const view = new DataView(buf);
  view.setUint32(0, 8, true);  // productId = 8 (Flash 8)
  view.setUint32(4, 0, true);  // edition   = 0
  view.setUint8(8, 8);         // majorVersion = 8
  view.setUint8(9, 0);         // minorVersion = 0
  // buildNumber UI64 @ offset 10 — low/high UI32, both zero
  view.setUint32(10, 0, true);
  view.setUint32(14, 0, true);
  // compileTime UI64 @ offset 18 — low/high UI32, both zero
  view.setUint32(18, 0, true);
  view.setUint32(22, 0, true);
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// Encode ExportAssets (tag 56)
// ---------------------------------------------------------------------------

/**
 * Encode an ExportAssets (tag 56) tag body.
 *
 * Format (SWF spec):
 *   UI16  Count
 *   For each symbol:
 *     UI16    CharacterId
 *     STRING  Name (null-terminated UTF-8)
 */
export function encodeExportAssets(symbols: Array<{ charId: number; name: string }>): Uint8Array {
  // Calculate total byte length: 2 (count) + per-symbol: 2 (UI16 charId) + name bytes + 1 (NUL)
  let totalLen = 2;
  for (const s of symbols) {
    totalLen += 2 + s.name.length + 1;
  }
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  view.setUint16(0, symbols.length, true /* LE */);
  let offset = 2;
  for (const s of symbols) {
    view.setUint16(offset, s.charId, true /* LE */);
    offset += 2;
    for (let i = 0; i < s.name.length; i++) {
      buf[offset++] = s.name.charCodeAt(i);
    }
    buf[offset++] = 0; // NUL terminator
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Encode ImportAssets2 (tag 71) — runtime-shared library imports
// ---------------------------------------------------------------------------

/**
 * Encode an ImportAssets2 (tag 71) tag body.
 *
 * Format (SWF spec):
 *   STRING  URL (null-terminated)
 *   UI8     Reserved = 1
 *   UI8     Reserved = 0
 *   UI16    Count
 *   For each symbol:
 *     UI16    CharacterId
 *     STRING  Name (null-terminated UTF-8)
 */
export function encodeImportAssets2(url: string, symbols: Array<{ charId: number; name: string }>): Uint8Array {
  // Calculate total byte length:
  // url bytes + 1 (NUL) + 2 (reserved) + 2 (count) + per-symbol: 2 (UI16 charId) + name bytes + 1 (NUL)
  let totalLen = url.length + 1 + 2 + 2;
  for (const s of symbols) {
    totalLen += 2 + s.name.length + 1;
  }
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  let offset = 0;
  // Write URL null-terminated
  for (let i = 0; i < url.length; i++) {
    buf[offset++] = url.charCodeAt(i);
  }
  buf[offset++] = 0; // NUL terminator
  // Reserved bytes
  buf[offset++] = 1;
  buf[offset++] = 0;
  // Count
  view.setUint16(offset, symbols.length, true /* LE */);
  offset += 2;
  // Each symbol: charId + name
  for (const s of symbols) {
    view.setUint16(offset, s.charId, true /* LE */);
    offset += 2;
    for (let i = 0; i < s.name.length; i++) {
      buf[offset++] = s.name.charCodeAt(i);
    }
    buf[offset++] = 0; // NUL terminator
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Encode DefineScalingGrid (tag 78) — 9-slice grid for a sprite character
// ---------------------------------------------------------------------------

/**
 * Encode a DefineScalingGrid (tag 78) body.
 *
 * Format (SWF spec §12.34):
 *   UI16   SpriteID (the DefineSprite character ID)
 *   RECT   Splitter (the 9-slice grid rectangle in twips)
 *
 * The RECT defines the inner rectangle of the 9-slice grid:
 *   xMin = left boundary, xMax = right boundary
 *   yMin = top boundary,  yMax = bottom boundary
 */
function encodeDefineScalingGrid(
  spriteId: number,
  grid: { x: number; y: number; width: number; height: number }
): Uint8Array {
  const bw = new BitWriter();
  bw.writeUI16LE(spriteId);
  writeRect(
    bw,
    px(grid.x),
    px(grid.x + grid.width),
    px(grid.y),
    px(grid.y + grid.height)
  );
  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// Encode RemoveObject2 (tag 28) — just UI16 depth
// ---------------------------------------------------------------------------

function encodeRemoveObject2(depth: number): Uint8Array {
  const bw = new BitWriter();
  bw.writeUI16LE(depth);
  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// Timeline helpers
// ---------------------------------------------------------------------------

/**
 * Return the number of frames in a Timeline (max layer frameCount, min 1).
 */
function sceneFrameCount(timeline: import("@flash/core").Timeline): number {
  if (!timeline.layers.length) return 1;
  let max = 1;
  for (const layer of timeline.layers) {
    const count = layerFrameCount(layer);
    if (count > max) max = count;
  }
  return max;
}

/**
 * Encode a FrameLabel (tag 43) body for a scene: null-terminated name string.
 */
function encodeSceneLabel(name: string): Uint8Array {
  const bw = new BitWriter();
  bw.writeString(name);
  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// Topological sort of symbols
// ---------------------------------------------------------------------------

/**
 * Sort symbols so that each symbol appears after all symbols it references
 * (dependencies come first). This ensures DefineSprite tags are emitted in
 * dependency order so referenced sprites are always defined before use.
 */
function topoSortSymbols(symbols: Symbol[]): Symbol[] {
  const idToSymbol = new Map<string, Symbol>(symbols.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const result: Symbol[] = [];

  function visit(sym: Symbol): void {
    if (visited.has(sym.id)) return;
    visited.add(sym.id);

    // Walk all frames in all layers looking for SymbolInstance references
    for (const layer of sym.timeline.layers) {
      for (const frame of layer.frames) {
        for (const obj of frame.displayObjects) {
          if (obj.type === "instance") {
            const dep = idToSymbol.get(obj.symbolId);
            if (dep) visit(dep);
          }
        }
      }
    }

    result.push(sym);
  }

  for (const sym of symbols) {
    visit(sym);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Bitmap fill helpers
// ---------------------------------------------------------------------------

/**
 * Collect all unique BitmapFill.bitmapId values referenced in a shape's paths.
 */
function collectBitmapFillIds(shape: Shape): string[] {
  const ids = new Set<string>();
  for (const path of shape.paths) {
    if (path.fill?.type === "bitmap") {
      ids.add((path.fill as BitmapFill).bitmapId);
    }
  }
  return Array.from(ids);
}

/**
 * For a shape that may contain BitmapFill paths, emit DefineBits tags for any
 * referenced bitmaps not yet emitted, and return a map from library item id
 * to SWF character ID.  Returns undefined if the shape has no bitmap fills.
 */
function emitBitmapFillTags(
  shape: Shape,
  doc: FlashDocument,
  writer: SwfWriter,
  emittedBitmapCharIds: Map<string, number>,
  options?: CompileOptions
): Map<string, number> | undefined {
  const ids = collectBitmapFillIds(shape);
  if (ids.length === 0) return undefined;

  for (const bitmapId of ids) {
    if (emittedBitmapCharIds.has(bitmapId)) continue;
    const bitmapItem = doc.library.items.find(
      (item): item is BitmapItem =>
        item.itemType === "bitmap" && item.id === bitmapId
    );
    if (!bitmapItem) continue;

    const pixelData = options?.bitmapPixels?.get(bitmapItem.id);
    if (pixelData && bitmapItem.compressionType === "lossless") {
      const charId = writer.nextCharId();
      const losslessTag = encodeDefineBitsLossless2(
        charId,
        pixelData.width,
        pixelData.height,
        pixelData.pixels
      );
      writer.writeRaw(losslessTag);
      emittedBitmapCharIds.set(bitmapId, charId);
    } else if (bitmapItem.dataUri) {
      const rawBytes = dataUriToBytes(bitmapItem.dataUri);
      const imageBytes = ensureJpegEOI(rawBytes);
      if (imageBytes.length > 0) {
        const charId = writer.nextCharId();
        const pixelDataForAlpha = options?.bitmapPixels?.get(bitmapItem.id);
        const hasTransparency =
          bitmapItem.compressionType === "photo" &&
          pixelDataForAlpha !== undefined &&
          pixelDataForAlpha.pixels.some((_, i) => i % 4 === 0 && pixelDataForAlpha.pixels[i] < 255);

        if (hasTransparency && pixelDataForAlpha) {
          const pixelCount = pixelDataForAlpha.width * pixelDataForAlpha.height;
          const alphaBytes = new Uint8Array(pixelCount);
          for (let i = 0; i < pixelCount; i++) {
            alphaBytes[i] = pixelDataForAlpha.pixels[i * 4];
          }
          const jpeg3Tag = encodeDefineBitsJpeg3(charId, imageBytes, alphaBytes);
          writer.writeRaw(jpeg3Tag);
        } else {
          const imgPayload = new Uint8Array(2 + imageBytes.length);
          imgPayload[0] = charId & 0xff;
          imgPayload[1] = (charId >> 8) & 0xff;
          imgPayload.set(imageBytes, 2);
          writer.writeTag(Tag.DefineBitsJPEG2, imgPayload);
        }
        emittedBitmapCharIds.set(bitmapId, charId);
      }
    }
  }

  return emittedBitmapCharIds;
}

// ---------------------------------------------------------------------------
// Compile options
// ---------------------------------------------------------------------------

export interface CompileOptions {
  /**
   * Optional pre-decoded pixel data for lossless bitmaps.
   * Key: BitmapItem.id → { width, height, pixels: ARGB Uint8Array }
   * When present for a bitmap with compressionType "lossless", a
   * DefineBitsLossless2 tag (36) is emitted instead of DefineBitsJPEG2 (21).
   */
  bitmapPixels?: Map<string, { width: number; height: number; pixels: Uint8Array }>;
  /**
   * When true, emit a Protect tag (24) to mark the SWF as password-protected.
   * The tag body is empty.
   */
  protect?: boolean;
  /**
   * When set, emit an EnableDebugger2 tag (64) with this password string
   * (stored as a null-terminated string after a reserved uint16 = 0).
   */
  debugPassword?: string;
  /**
   * When set, emit a Metadata tag (77) with XMP XML metadata.
   * Also sets the HasMetadata bit (bit 4) in the FileAttributes flags.
   */
  metadata?: MetadataOptions;
  /**
   * When true (the default for SWF v8), emit font definitions as DefineFont3
   * (tag 75, UTF-16 encoding) instead of DefineFont2 (tag 48, UCS-2 encoding).
   * The tag body format is identical — only the tag code differs.
   * Defaults to true.
   */
  useFont3?: boolean;
  /**
   * When true, compress the SWF body using zlib deflate and emit a CWS header
   * (compressed SWF) instead of the standard FWS header.
   * Requires Flash Player 6 or later. Defaults to false.
   */
  compress?: boolean;
}

// ---------------------------------------------------------------------------
// Main compiler
// ---------------------------------------------------------------------------

/**
 * Compile a FlashDocument into a binary SWF v8 byte array.
 *
 * The produced SWF is valid and playable in Ruffle.
 */
export function compileDocument(doc: FlashDocument, options?: CompileOptions): Uint8Array {
  const props = doc.properties;
  const writer = new SwfWriter();

  // 1. FileAttributes — MUST be first tag in SWF 8
  writer.writeTag(Tag.FileAttributes, buildFileAttributes(!!options?.metadata));

  // 1b. SceneAndFrameLabelData (tag 86) — emitted right after FileAttributes
  //     when there are multiple scenes or any named frame labels.
  if (doc.scenes.length > 1 || hasAnyLabels(doc)) {
    const sceneData = encodeSceneAndFrameLabelData(doc);
    writer.writeRaw(sceneData);
  }

  // 1c-pre. ProductInfo (tag 41) — authoring tool identity; always emitted.
  writer.writeTag(Tag.ProductInfo, buildProductInfo());

  // 1c. Protect tag (24) — marks SWF as password-protected (empty body).
  if (options?.protect) {
    writer.writeTag(Tag.Protect, new Uint8Array(0));
  }

  // 1d. EnableDebugger2 tag (64) — stores debugger password.
  //     Body: uint16 reserved=0, null-terminated password string.
  //     DebugId (tag 63) — 16-byte UUID linking SWF to debug symbols; emitted
  //     alongside EnableDebugger2 (zero UUID = no real debug session).
  if (options?.debugPassword) {
    const encoder = new TextEncoder();
    const pwBytes = encoder.encode(options.debugPassword);
    const body = new Uint8Array(2 + pwBytes.length + 1); // 2 reserved + pw + null
    // body[0] and body[1] are already 0x00 (reserved uint16 = 0)
    body.set(pwBytes, 2);
    // body[2 + pwBytes.length] is already 0x00 (null terminator)
    writer.writeTag(Tag.EnableDebugger2, body);
    // DebugId (tag 63): 16-byte zero UUID
    writer.writeTag(Tag.DebugId, new Uint8Array(16));
  }

  // 1e. Metadata tag (77) — emits XMP metadata when options.metadata is set.
  if (options?.metadata) {
    const xml = buildXmpMetadata(options.metadata);
    const body = new TextEncoder().encode(xml); // UTF-8, no null terminator
    writer.writeTag(Tag.Metadata, body);
  }

  // 2. SetBackgroundColor
  writer.writeTag(
    Tag.SetBackgroundColor,
    buildSetBackgroundColor(props.backgroundColor)
  );

  // 2b. StageScaleMode (tag 65) — AllowScaling=1 (showAll), Alignment=0 (center).
  //     Flash Professional always emits this tag; without it some players default to
  //     "noScale" which breaks layouts.
  writer.writeTag(Tag.StageScaleMode, new Uint8Array([1, 0]));

  // 3. Compile library symbols → DefineSprite tags
  //    Build charIdMap: symbolId → SWF character ID
  const rawSymbols = doc.library.items.filter(
    (item): item is Symbol => item.itemType === "symbol"
  );

  // Sort symbols topologically so dependencies are emitted first
  const symbols = topoSortSymbols(rawSymbols);

  // Quick lookup: symbolId → Symbol (for instance-level overrides in compile loop)
  const symbolById = new Map<string, Symbol>(symbols.map((s) => [s.id, s]));

  const charIdMap = new Map<string, number>();
  // Assign character IDs to all symbols up front (so nested instances resolve)
  for (const sym of symbols) {
    charIdMap.set(sym.id, writer.nextCharId());
  }

  // Collect pending DefineButtonSound emissions: { charId, sounds }.
  // These must be emitted AFTER DefineSound tags (which build soundIdMap) so all
  // SoundId references are valid. Populated during the symbol definition pass below.
  const pendingButtonSounds: Array<{ charId: number; sounds: ButtonSounds }> = [];

  // Emit DefineSprite for each symbol (using the pre-assigned IDs).
  // encodeDefineSprite returns the tag *body* (SpriteID + FrameCount + inner tags);
  // writeTag wraps it with the DefineSprite record header.
  // Bug 3 fix: hoist character definitions (DefineShape4, DefineEditText) that
  // were embedded inside sprite bodies to the top level *before* their sprite tag.
  for (const sym of symbols) {
    const symCharId = charIdMap.get(sym.id)!;

    // Collect hoisted definition tags (DefineShape4, DefineEditText, etc.) that must
    // appear at top level before the symbol definition tag.
    const hoistedDefs: Array<{ tagType: number; body: Uint8Array }> = [];

    if (sym.symbolType === "button") {
      // Button symbols: emit DefineButton2 (tag 34) instead of DefineSprite (tag 39).
      const buttonBody = encodeDefineButton2(
        symCharId,
        sym,
        doc,
        charIdMap,
        () => writer.nextCharId(),
        hoistedDefs
      );

      // Emit hoisted shape/text definition tags first
      for (const def of hoistedDefs) {
        writer.writeTag(def.tagType, def.body);
      }

      writer.writeTag(Tag.DefineButton2, buttonBody);

      // Collect for deferred DefineButtonSound emit (needs soundIdMap, built below)
      if (sym.buttonSounds) {
        pendingButtonSounds.push({ charId: symCharId, sounds: sym.buttonSounds });
      }
    } else {
      const spriteBody = encodeDefineSprite(
        symCharId,
        sym,
        doc,
        charIdMap,
        () => writer.nextCharId(),
        hoistedDefs
      );

      // Emit hoisted definition tags first
      for (const def of hoistedDefs) {
        writer.writeTag(def.tagType, def.body);
      }

      writer.writeTag(Tag.DefineSprite, spriteBody);

      // Emit DefineScalingGrid (tag 78) immediately after DefineSprite when
      // the symbol has a non-null 9-slice grid.
      if (sym.scale9Grid !== null) {
        const gridBody = encodeDefineScalingGrid(symCharId, sym.scale9Grid);
        writer.writeTag(Tag.DefineScalingGrid, gridBody);
      }
    }
  }

  // 3b. Collect ExportAssets entries for symbols with exportForActionScript=true
  // or exportForRuntimeSharing=true.
  // These will be emitted inside the first SWF frame (after FrameLabel, before DoInitAction).
  const exportEntries: { charId: number; name: string }[] = [];
  for (const sym of symbols) {
    const shouldExport =
      (sym.linkage.exportForActionScript && sym.linkage.linkageIdentifier) ||
      (sym.linkage.exportForRuntimeSharing && sym.linkage.linkageIdentifier);
    if (shouldExport && sym.linkage.linkageIdentifier) {
      const charId = charIdMap.get(sym.id);
      if (charId !== undefined) {
        exportEntries.push({ charId, name: sym.linkage.linkageIdentifier });
      }
    }
  }

  // 3b2. Collect ImportAssets2 entries grouped by sharedUrl for symbols with
  // importForRuntimeSharing=true and a non-empty sharedUrl and linkageIdentifier.
  // These will be emitted in the first SWF frame, after ExportAssets.
  const importsByUrl = new Map<string, Array<{ charId: number; name: string }>>();
  for (const sym of symbols) {
    if (
      sym.linkage.importForRuntimeSharing &&
      sym.linkage.sharedUrl &&
      sym.linkage.linkageIdentifier
    ) {
      const charId = charIdMap.get(sym.id);
      if (charId !== undefined) {
        const group = importsByUrl.get(sym.linkage.sharedUrl) ?? [];
        group.push({ charId, name: sym.linkage.linkageIdentifier });
        importsByUrl.set(sym.linkage.sharedUrl, group);
      }
    }
  }

  // 3c-init. Collect DoInitAction bodies for symbols with exportForActionScript=true
  // and a className. These will be emitted at the start of the first SWF frame.
  const doInitActionBodies: Uint8Array[] = [];
  for (const sym of symbols) {
    if (sym.linkage.exportForActionScript && sym.linkage.className) {
      const charId = charIdMap.get(sym.id);
      if (charId !== undefined) {
        const linkageId = sym.linkage.linkageIdentifier || sym.linkage.className;
        doInitActionBodies.push(encodeDoInitAction(charId, sym.linkage.className, linkageId));
      }
    }
  }

  // 3c. Emit DefineSound tags for all SoundItems with audio data.
  //     Build soundIdMap: soundItemId → SWF character ID
  const soundItems = doc.library.items.filter(
    (item): item is SoundItem => item.itemType === "sound"
  );
  const soundIdMap = new Map<string, number>();
  for (const soundItem of soundItems) {
    if (!soundItem.dataUri) continue;
    const soundId = writer.nextCharId();
    soundIdMap.set(soundItem.id, soundId);
    const soundBody = encodeDefineSound(soundId, soundItem);
    writer.writeTag(Tag.DefineSound, soundBody);
    // If the sound has an AS2 linkage identifier, add it to ExportAssets.
    if (soundItem.exportForActionScript && soundItem.linkageIdentifier) {
      exportEntries.push({ charId: soundId, name: soundItem.linkageIdentifier });
    }
  }

  // Emit deferred DefineButtonSound tags now that soundIdMap is populated.
  for (const { charId, sounds } of pendingButtonSounds) {
    const soundBody = encodeDefineButtonSound(charId, sounds, soundIdMap);
    writer.writeTag(Tag.DefineButtonSound, soundBody);
  }

  // 3d. Emit DefineVideoStream (tag 60) for each VideoItem in the library.
  //     The actual per-frame VideoFrame (tag 61) tags are emitted in the frame
  //     loop so they interleave with ShowFrame in playback order. Each video is
  //     placed on its own depth on the first SWF frame.
  interface VideoStreamInfo {
    /** Library VideoItem id this stream was built from. */
    itemId: string;
    charId: number;
    width: number;
    height: number;
    /** Per-SWF-frame video payloads (one entry per VideoFrame tag to emit). */
    payloads: Uint8Array[];
  }
  const videoItems = doc.library.items.filter(
    (item): item is VideoItem => item.itemType === "video"
  );
  const videoStreams: VideoStreamInfo[] = [];
  // Map library VideoItem id → its DefineVideoStream character ID, so
  // VideoDisplayObject placement can resolve the stream to place.
  const videoCharIdMap = new Map<string, number>();
  for (const videoItem of videoItems) {
    // Attempt to demux the FLV payload from the data URI; fall back to an
    // empty stream so authoring still produces a valid character.
    let flvFrames: FlvVideoFrame[] = [];
    let codecId: number = VideoCodec.H263;
    if (videoItem.dataUri) {
      try {
        const bytes = dataUriToBytes(videoItem.dataUri);
        const flv = demuxFlv(bytes);
        if (flv) {
          flvFrames = flv.frames;
          codecId = flvCodecToSwfCodec(flv.codecId);
        }
      } catch {
        // Malformed data URI — emit an empty stream so compile still succeeds.
      }
    }

    // Build the per-frame payload list. With real demuxed FLV frames we use the
    // decoded video payloads directly. When demux yields nothing (e.g. a stub
    // data URI in authoring), fall back to driving `frameCount` empty-payload
    // VideoFrame tags so the stream is still advanced one frame per ShowFrame.
    let payloads: Uint8Array[];
    if (flvFrames.length > 0) {
      payloads = flvFrames.map((f) => f.data);
    } else {
      const n = Math.max(0, Math.floor(videoItem.frameCount));
      payloads = Array.from({ length: n }, () => new Uint8Array(0));
    }

    const numFrames = payloads.length;
    const charId = writer.nextCharId();
    const width = Math.max(0, Math.round(videoItem.width));
    const height = Math.max(0, Math.round(videoItem.height));
    writer.writeTag(
      Tag.DefineVideoStream,
      encodeDefineVideoStream(charId, numFrames, width, height, codecId)
    );
    videoCharIdMap.set(videoItem.id, charId);
    videoStreams.push({ itemId: videoItem.id, charId, width, height, payloads });
  }

  // 4. Frames — iterate ALL scenes' timelines.
  //    Each scene gets a FrameLabel tag (scene name) at its first frame.
  //    Between scenes we emit RemoveObject2 for all occupied depths to reset
  //    the display list so each scene starts with a clean stage.

  /**
   * Serialize a ColorEffect to a string key for change detection.
   * Returns null when there is no active color effect.
   */
  function colorEffectKey(displayObj: DisplayObject): string | null {
    if (displayObj.type !== "instance" && displayObj.type !== "text") return null;
    const ce = (displayObj as import("@flash/core").SymbolInstance | import("@flash/core").TextDisplayObject).colorEffect;
    if (!ce || ce.type === "none") return null;
    return JSON.stringify(ce);
  }

  // Per-depth: last placed state (objId, x, y, scaleX, scaleY, rotation, skewX, skewY, ratio)
  interface DepthState {
    objId: string;
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    skewX: number;
    skewY: number;
    /** Last placed morph ratio (0..65535); -1 if not a morph shape. */
    ratio: number;
    /** Serialized color effect key for change detection (null = no effect). */
    colorEffectKey: string | null;
  }
  const depthState = new Map<number, DepthState>();

  // Track display list per depth: depth → current display-object id
  const depthToObjId = new Map<number, string>();
  // Track the depth assigned to each (sceneIdx:layerIdx:objId) triple
  const layerObjDepth = new Map<string, number>();
  let nextDepth = 1;

  // Determine which library video streams are explicitly placed via a
  // VideoDisplayObject on the timeline. Those are positioned model-driven
  // through the normal per-layer depth/placement path below. Any stream NOT
  // referenced keeps the legacy fixed placement so a bare library video still
  // appears on the stage.
  const referencedVideoItemIds = new Set<string>();
  for (const scene of doc.scenes) {
    for (const layer of scene.timeline.layers) {
      for (const frame of layer.frames) {
        for (const obj of frame.displayObjects) {
          if (obj.type === "video") {
            referencedVideoItemIds.add((obj as VideoDisplayObject).videoItemId);
          }
        }
      }
    }
  }

  // Video streams are placed on high, dedicated depths (above any shape/text
  // depth) so they never collide with the per-layer depth assignment below.
  // Only streams NOT placed via a VideoDisplayObject get this legacy fixed
  // placement; the rest are placed model-driven in the frame loop.
  const videoDepthBase = 50000;
  const videoDepths = videoStreams
    .filter((vs) => !referencedVideoItemIds.has(vs.itemId))
    .map((vs, i) => ({
      depth: videoDepthBase + i,
      charId: vs.charId,
      width: vs.width,
      height: vs.height,
      payloads: vs.payloads,
    }));
  // VideoFrame (tag 61) advancement applies to EVERY stream — both the
  // legacy fixed-placed ones and those placed via a VideoDisplayObject — so
  // each placed stream character receives its decoded frames.
  const videoFrameAdvancers = videoStreams.map((vs) => ({
    charId: vs.charId,
    payloads: vs.payloads,
  }));

  // Longest video, in frames — the SWF must run at least this many frames so
  // every VideoFrame tag has a ShowFrame to land before.
  const maxVideoFrames = videoFrameAdvancers.reduce(
    (m, v) => Math.max(m, v.payloads.length),
    0
  );

  // Map from display-object id → stable SWF character ID (global across scenes)
  const objCharIdMap = new Map<string, number>();

  // Map from BitmapFill.bitmapId (library item id) → SWF character ID.
  // Tracks bitmaps that have already been emitted as DefineBits tags so we
  // don't duplicate them when multiple shapes reference the same bitmap fill.
  const emittedBitmapFillCharIds = new Map<string, number>();

  // Font pre-pass: collect all unique font faces from TextDisplayObjects across
  // all scenes and emit font definition tags before any DefineEditText tags that
  // reference them.  Key = fontKey(name, bold, italic) → SWF character ID.
  //
  // For SWF v8 we prefer DefineFont3 (tag 75, UTF-16) over DefineFont2 (tag 48,
  // UCS-2). The tag body format is identical — only the tag code differs.
  // useFont3 defaults to true; pass useFont3: false to emit DefineFont2 instead.
  const useFont3 = options?.useFont3 !== false;
  const fontTagCode = useFont3 ? Tag.DefineFont3 : Tag.DefineFont2;
  // DefineFont3 stores glyph coordinates in a 20×-larger EM square than
  // DefineFont2; emit glyph outlines at the matching scale so Ruffle renders
  // them at the correct size.
  const fontCoordScale = useFont3 ? 20 : 1;
  const fontCharIdMap = new Map<string, number>();

  for (const s of doc.scenes) {
    for (const layer of s.timeline.layers) {
      if (layer.type === "guide") continue;
      for (const frame of layer.frames) {
        // Do not skip on isEmpty — the flag can be stale; iterate displayObjects directly.
        if (!frame.isKeyframe) continue;
        for (const obj of frame.displayObjects) {
          if (obj.type !== "text") continue;
          const key = fontKey(obj.fontFamily, obj.bold, obj.italic);
          if (fontCharIdMap.has(key)) continue;
          const fontId = writer.nextCharId();
          fontCharIdMap.set(key, fontId);
          const fontBody = encodeDefineFont2(fontId, obj.fontFamily, obj.bold, obj.italic, fontCoordScale);
          writer.writeTag(fontTagCode, fontBody);
          // Emit DefineFontAlignZones (tag 73) immediately after DefineFont3
          // for all embedded fonts. Provides per-glyph stem-width hint zones
          // that enable the FlashType sub-pixel rendering path in Ruffle.
          // Harmlessly ignored for non-FlashType anti-alias modes.
          if (useFont3) {
            const alignZonesBody = encodeDefineFontAlignZones(fontId, 95, fontCoordScale);
            writer.writeTag(Tag.DefineFontAlignZones, alignZonesBody);
          }
        }
      }
    }
  }

  // Font library items pre-pass: emit DefineFont3 (or DefineFont2) tags for
  // FontItem library items. These represent explicitly embedded fonts defined
  // in the library panel. Any font already emitted by the text pre-pass above
  // is skipped to avoid duplicate font definitions.
  const fontLibraryItems = doc.library.items.filter(
    (item): item is FontItem => item.itemType === "font"
  );
  for (const fontItem of fontLibraryItems) {
    const key = fontKey(fontItem.fontName, fontItem.bold, fontItem.italic);
    if (fontCharIdMap.has(key)) continue; // already emitted from text pre-pass
    const fontId = writer.nextCharId();
    fontCharIdMap.set(key, fontId);
    const fontBody = encodeDefineFont2(fontId, fontItem.fontName, fontItem.bold, fontItem.italic, fontCoordScale);
    writer.writeTag(fontTagCode, fontBody);
    // Emit DefineFontAlignZones (tag 73) immediately after DefineFont3.
    if (useFont3) {
      const alignZonesBody = encodeDefineFontAlignZones(fontId, 95, fontCoordScale);
      writer.writeTag(Tag.DefineFontAlignZones, alignZonesBody);
    }
  }

  // morphShapeObjIds: set of object IDs that have been encoded as DefineMorphShape.
  // Used during the frame loop to detect morph shapes and use ratio-based placement.
  const morphShapeObjIds = new Set<string>();

  // morphObjSpanInfo: maps objId → array of span records used to compute the
  // morph ratio (including ease) for each frame during the frame loop.
  const morphObjSpanInfo = new Map<
    string,
    Array<{
      startFrame: number;
      endFrame: number;
      spanLength: number;
      ease: number;
      easeCurve?: { x1: number; y1: number; x2: number; y2: number } | null;
    }>
  >();

  // Character pre-pass: define all characters across ALL scenes' timelines.
  // This ensures objects defined in scene 1 can be referenced in scene 2.
  //
  // Shape tween pre-pass: for each layer with shape tween spans, emit
  // DefineMorphShape (tag 46) for each span, then mark all object IDs in
  // that span so the general per-frame pass below skips them.
  for (let si = 0; si < doc.scenes.length; si++) {
    const s = doc.scenes[si];
    for (let li = 0; li < s.timeline.layers.length; li++) {
      const layer = s.timeline.layers[li];
      if (layer.type === "guide") continue;

      const spans = getTweenSpans(layer);
      for (const span of spans) {
        if (span.tweenType !== "shape") continue;

        // Find the start and end keyframes for this span
        const startKf = layer.frames.find(
          (f) => f.isKeyframe && f.index === span.startFrame
        );
        const endKf = layer.frames.find(
          (f) => f.isKeyframe && f.index === span.endFrame + 1
        );
        if (!startKf || !endKf) continue;
        if (startKf.displayObjects.length === 0) continue;

        // Emit one DefineMorphShape per shape object in the start keyframe
        for (let oi = 0; oi < startKf.displayObjects.length; oi++) {
          const startObj = startKf.displayObjects[oi];
          if (startObj.type !== "shape" && startObj.type !== "drawing-object") continue;

          const endObj = endKf.displayObjects[oi];
          if (!endObj || (endObj.type !== "shape" && endObj.type !== "drawing-object")) continue;

          // Skip if already handled (same objId in multiple spans)
          if (objCharIdMap.has(startObj.id)) {
            // Already emitted — just record span info if missing
          } else {
            const morphCharId = writer.nextCharId();

            // Mark the start object ID as handled (morph char ID)
            objCharIdMap.set(startObj.id, morphCharId);
            morphShapeObjIds.add(startObj.id);

            // Emit DefineMorphShape2 tag (tag 84 — required for Flash 8 to
            // preserve LINESTYLE2 cap/join data via MORPHLINESTYLE2 records).
            const morphBody = encodeDefineMorphShape2(
              morphCharId,
              startObj.shape.paths,
              endObj.shape.paths
            );
            writer.writeTag(Tag.DefineMorphShape2, morphBody);
          }

          // Record span info for ratio computation during frame loop
          const spanLength = span.endFrame - span.startFrame + 1;
          const existing = morphObjSpanInfo.get(startObj.id) ?? [];
          existing.push({
            startFrame: span.startFrame,
            endFrame: span.endFrame,
            spanLength,
            ease: span.ease,
            easeCurve: span.easeCurve,
          });
          morphObjSpanInfo.set(startObj.id, existing);
        }
      }
    }
  }

  for (const s of doc.scenes) {
    for (const layer of s.timeline.layers) {
      // Guide layers are authoring-only — skip in SWF pre-pass too
      if (layer.type === "guide") continue;
      for (const frame of layer.frames) {
        // Do not skip on isEmpty — the flag can be stale; iterate displayObjects directly.
        if (!frame.isKeyframe) continue;
        for (const obj of frame.displayObjects) {
          if (objCharIdMap.has(obj.id)) continue;
          if (obj.type === "shape" || obj.type === "drawing-object") {
            // Emit DefineBits tags for any bitmap fills referenced by this shape
            emitBitmapFillTags(obj.shape, doc, writer, emittedBitmapFillCharIds, options);
            const charId = writer.nextCharId();
            objCharIdMap.set(obj.id, charId);
            const shapeBody = encodeDefineShape4(
              charId,
              obj.shape,
              emittedBitmapFillCharIds.size > 0 ? emittedBitmapFillCharIds : undefined
            );
            writer.writeTag(Tag.DefineShape4, shapeBody);
          } else if (obj.type === "text") {
            const charId = writer.nextCharId();
            objCharIdMap.set(obj.id, charId);
            const key = fontKey(obj.fontFamily, obj.bold, obj.italic);
            const embeddedFontId = fontCharIdMap.get(key);
            // Use DefineEditText (tag 37) for ALL text types. Pass the embedded font
            // ID so HasFont is set and Ruffle honours the font SIZE — but UseOutlines
            // is deliberately NOT set, so Ruffle renders with device fonts (real Arial,
            // etc.) rather than our custom 5×7 pixel-art embedded glyphs. This gives
            // correctly-sized, legible text that matches MC text behaviour.
            const textBody = encodeDefineEditText(charId, obj, embeddedFontId);
            writer.writeTag(Tag.DefineEditText, textBody);
            // Emit CSMTextSettings (tag 74) immediately after DefineEditText for
            // FlashType anti-alias modes (readability and custom).
            // For "readability": UseFlashType=1, GridFit=1, thickness=0, sharpness=0.
            // For "custom": UseFlashType=1, GridFit=1, with user-specified values.
            // Other modes (device, bitmap, animation) do not need a CSMTextSettings tag.
            const aa = obj.antiAlias;
            if (aa === "readability") {
              const csmBody = encodeCSMTextSettings(charId, 0, 0);
              writer.writeTag(Tag.CSMTextSettings, csmBody);
            } else if (aa === "custom" && obj.csm) {
              const csmBody = encodeCSMTextSettings(charId, obj.csm.thickness, obj.csm.sharpness);
              writer.writeTag(Tag.CSMTextSettings, csmBody);
            }
          } else if (obj.type === "bitmap") {
            // Look up the BitmapItem from the library
            const bitmapItem = doc.library.items.find(
              (item): item is BitmapItem =>
                item.itemType === "bitmap" && item.id === obj.libraryItemId
            );
            if (bitmapItem) {
              // Check for pre-decoded lossless pixel data
              const pixelData = options?.bitmapPixels?.get(bitmapItem.id);
              if (pixelData && bitmapItem.compressionType === "lossless") {
                // 1. Emit DefineBitsLossless2 (tag 36) for ARGB pixel data
                const bitmapCharId = writer.nextCharId();
                const losslessTag = encodeDefineBitsLossless2(
                  bitmapCharId,
                  pixelData.width,
                  pixelData.height,
                  pixelData.pixels
                );
                writer.writeRaw(losslessTag);

                // 2. Emit DefineShape4 with bitmap fill
                const shapeCharId = writer.nextCharId();
                objCharIdMap.set(obj.id, shapeCharId);
                const shapeBody = encodeBitmapFillShape(
                  shapeCharId,
                  bitmapCharId,
                  obj.width,
                  obj.height,
                  bitmapItem.allowSmoothing
                );
                writer.writeTag(Tag.DefineShape4, shapeBody);
              } else if (bitmapItem.dataUri) {
                const rawBytes = dataUriToBytes(bitmapItem.dataUri);
                const imageBytes = ensureJpegEOI(rawBytes);
                if (imageBytes.length > 0) {
                  const bitmapCharId = writer.nextCharId();

                  // Check if this is a photo bitmap with transparent pixel data
                  const pixelDataForAlpha = options?.bitmapPixels?.get(bitmapItem.id);
                  const hasTransparency =
                    bitmapItem.compressionType === "photo" &&
                    pixelDataForAlpha !== undefined &&
                    pixelDataForAlpha.pixels.some((_, i) => i % 4 === 0 && pixelDataForAlpha.pixels[i] < 255);

                  if (hasTransparency && pixelDataForAlpha) {
                    // Extract alpha channel: ARGB pixels → one alpha byte per pixel
                    const pixelCount = pixelDataForAlpha.width * pixelDataForAlpha.height;
                    const alphaBytes = new Uint8Array(pixelCount);
                    for (let i = 0; i < pixelCount; i++) {
                      alphaBytes[i] = pixelDataForAlpha.pixels[i * 4]; // A channel at offset 0
                    }
                    // 1. Emit DefineBitsJPEG3 (tag 35) with JPEG + compressed alpha
                    const jpeg3Tag = encodeDefineBitsJpeg3(bitmapCharId, imageBytes, alphaBytes);
                    writer.writeRaw(jpeg3Tag);
                  } else {
                    // 1. Emit DefineBitsJPEG2 for the raw image data
                    const imgPayload = new Uint8Array(2 + imageBytes.length);
                    imgPayload[0] = bitmapCharId & 0xff;
                    imgPayload[1] = (bitmapCharId >> 8) & 0xff;
                    imgPayload.set(imageBytes, 2);
                    writer.writeTag(Tag.DefineBitsJPEG2, imgPayload);
                  }

                  // 2. Emit DefineShape4 with bitmap fill
                  const shapeCharId = writer.nextCharId();
                  objCharIdMap.set(obj.id, shapeCharId);
                  const shapeBody = encodeBitmapFillShape(
                    shapeCharId,
                    bitmapCharId,
                    obj.width,
                    obj.height,
                    bitmapItem.allowSmoothing
                  );
                  writer.writeTag(Tag.DefineShape4, shapeBody);
                } else {
                  // Empty data URI — assign a char ID without emitting
                  const shapeCharId = writer.nextCharId();
                  objCharIdMap.set(obj.id, shapeCharId);
                }
              } else {
                // No data — assign a char ID without emitting
                const shapeCharId = writer.nextCharId();
                objCharIdMap.set(obj.id, shapeCharId);
              }
            } else {
              // No BitmapItem found — assign a char ID without emitting
              const shapeCharId = writer.nextCharId();
              objCharIdMap.set(obj.id, shapeCharId);
            }
          }
          // "instance" uses charIdMap (symbol char IDs), not objCharIdMap
        }
      }
    }
  }

  // Helper to get or assign a stable depth for an object in a specific scene+layer
  function getOrAssignDepth(sceneIdx: number, layerIdx: number, objId: string): number {
    const key = `${sceneIdx}:${layerIdx}:${objId}`;
    let depth = layerObjDepth.get(key);
    if (depth === undefined) {
      depth = nextDepth++;
      layerObjDepth.set(key, depth);
    }
    return depth;
  }

  // Depth pre-pass: assign SWF depths in the correct visual order so that the
  // layer at the TOP of the panel (li=0) renders ON TOP in the SWF (highest depth),
  // and the layer at the BOTTOM of the panel (li=n-1) renders at the back (lowest
  // depth). Flash convention: layers[0] is the topmost (front) layer.
  //
  // Special-case for mask groups: the mask must have a LOWER depth than the masked
  // layers it clips (SWF constraint: mask at depth D clips objects at depths D+1..clipDepth).
  // So within each mask group we assign the mask first (lower depth) then the masked
  // layers (higher depths), even though the mask is visually above the masked layers.
  for (let preSceneIdx = 0; preSceneIdx < doc.scenes.length; preSceneIdx++) {
    const preLayers = doc.scenes[preSceneIdx]!.timeline.layers;

    // Identify which layer indices are "masked" (belong to a mask group) so they
    // can be deferred and processed immediately after their owning mask layer.
    const isMaskedLi = new Set<number>();
    for (let li = 0; li < preLayers.length; li++) {
      if (preLayers[li]!.type === "mask") {
        for (let mli = li + 1; mli < preLayers.length; mli++) {
          if (preLayers[mli]!.type !== "masked") break;
          isMaskedLi.add(mli);
        }
      }
    }

    // Register all object IDs for a layer across every keyframe it has.
    const registerLayerDepths = (li: number) => {
      for (const frame of preLayers[li]!.frames) {
        if (!frame.isKeyframe) continue;
        for (const obj of frame.displayObjects) {
          getOrAssignDepth(preSceneIdx, li, obj.id);
        }
      }
    };

    // Iterate from bottom layer (li=n-1) to top (li=0) so bottom layers get lower
    // depth numbers (rendered first / behind) and top layers get higher numbers
    // (rendered last / in front).
    for (let li = preLayers.length - 1; li >= 0; li--) {
      const layer = preLayers[li]!;
      if (layer.type === "guide") continue;
      if (isMaskedLi.has(li)) continue; // handled when its owning mask is encountered

      registerLayerDepths(li);

      // Immediately follow a mask with its masked layers so the mask's depth is
      // lower than all of the depths assigned to the masked layers.
      if (layer.type === "mask") {
        for (let mli = li + 1; mli < preLayers.length; mli++) {
          if (preLayers[mli]!.type !== "masked") break;
          registerLayerDepths(mli);
        }
      }
    }
  }

  if (doc.scenes.length === 0) {
    // No scenes — emit at least one ShowFrame for a valid 1-frame SWF
    writer.writeTag(Tag.ShowFrame, new Uint8Array(0));
  } else {
    for (let sceneIdx = 0; sceneIdx < doc.scenes.length; sceneIdx++) {
      const scene = doc.scenes[sceneIdx];
      const layers = scene.timeline.layers;

      // Between scenes: emit RemoveObject2 for every occupied depth to clear
      // the display list so the next scene starts with a clean stage.
      // (Skip for the very first scene — nothing to clear yet.)
      if (sceneIdx > 0) {
        for (const [depth] of depthState) {
          writer.writeTag(Tag.RemoveObject2, encodeRemoveObject2(depth));
          depthToObjId.delete(depth);
        }
        depthState.clear();
      }

      // Scene 0 must run long enough to deliver every video frame (one
      // VideoFrame tag lands before each ShowFrame).
      const maxFrames =
        sceneIdx === 0
          ? Math.max(sceneFrameCount(scene.timeline), maxVideoFrames)
          : sceneFrameCount(scene.timeline);

      // Pre-compute per-frame stream sound chunks for this scene.
      // SWF spec requires one SoundStreamBlock per ShowFrame, carrying only
      // that frame's samples, interleaved: SoundStreamHead → (Block → ShowFrame)×N.
      //
      // Structure: for each stream sound found in this scene's layers, split
      // the audio bytes into per-frame chunks and store the metadata needed to
      // emit SoundStreamHead before the first block.
      interface StreamSoundState {
        startFrame: number;
        chunks: Uint8Array[];       // one entry per frame starting at startFrame
        samplesPerFrame: number;    // used in SoundStreamHead.streamSampleCount
        isMP3: boolean;
        // SoundStreamHead tag body — emitted once at the stream's start frame
        headBody: Uint8Array;
      }
      const streamSounds: StreamSoundState[] = [];

      for (const layer of layers) {
        for (const frame of layer.frames) {
          if (
            frame.isKeyframe &&
            frame.sound !== null &&
            frame.sound.syncMode === "stream"
          ) {
            const soundItem = soundItems.find(
              (si) => si.id === frame.sound!.libraryItemId
            );
            if (!soundItem) continue;

            const fps = props.frameRate;
            const samplesPerFrame = Math.floor(soundItem.sampleRate / fps);
            const isMP3 = soundItem.compressionType === "mp3";
            const audioBytes = dataUriToBytes(soundItem.dataUri);

            // Estimate number of frames this sound spans. For raw PCM we can
            // calculate exactly; for MP3 we estimate from durationSeconds.
            let totalAudioFrames: number;
            if (isMP3) {
              // Estimate from declared duration; fall back to covering maxFrames
              const estimatedFrames = soundItem.durationSeconds > 0
                ? Math.ceil(soundItem.durationSeconds * fps)
                : maxFrames - frame.index;
              totalAudioFrames = Math.max(1, estimatedFrames);
            } else {
              // For raw PCM: exact calculation from byte count
              const bytesPerSample = soundItem.sampleSize === 16 ? 2 : 1;
              const channels = soundItem.isStereo ? 2 : 1;
              const bytesPerFrame = samplesPerFrame * bytesPerSample * channels;
              totalAudioFrames = bytesPerFrame > 0
                ? Math.max(1, Math.ceil(audioBytes.length / bytesPerFrame))
                : Math.max(1, maxFrames - frame.index);
            }

            // Split audio bytes into per-frame chunks.
            const chunks: Uint8Array[] = [];
            if (audioBytes.length === 0) {
              // No audio data — emit one empty block per frame
              for (let i = 0; i < totalAudioFrames; i++) {
                chunks.push(new Uint8Array(0));
              }
            } else {
              const bytesPerChunk = Math.max(
                1,
                Math.floor(audioBytes.length / totalAudioFrames)
              );
              let offset = 0;
              for (let i = 0; i < totalAudioFrames; i++) {
                const isLast = i === totalAudioFrames - 1;
                const end = isLast
                  ? audioBytes.length
                  : Math.min(offset + bytesPerChunk, audioBytes.length);
                chunks.push(audioBytes.slice(offset, end));
                offset = end;
                if (offset >= audioBytes.length) {
                  // Remaining frames get empty blocks
                  for (let j = i + 1; j < totalAudioFrames; j++) {
                    chunks.push(new Uint8Array(0));
                  }
                  break;
                }
              }
            }

            // Build SoundStreamHead body — emitted at the stream's start frame
            const fmt = soundFormat(soundItem.compressionType);
            const rate = soundRate(soundItem.sampleRate);
            const sizeBit = (soundItem.sampleSize === 16 ? 1 : 0) as 0 | 1;
            const stereoBit = (soundItem.isStereo ? 1 : 0) as 0 | 1;
            const headBody = encodeSoundStreamHead({
              playbackRate: rate,
              playbackSize: sizeBit,
              playbackStereo: stereoBit,
              streamFormat: fmt,
              streamRate: rate,
              streamSize: sizeBit,
              streamStereo: stereoBit,
              streamSampleCount: samplesPerFrame,
            });

            streamSounds.push({
              startFrame: frame.index,
              chunks,
              samplesPerFrame,
              isMP3,
              headBody,
            });
          }
        }
      }

      // Emit FrameLabel (tag 43) for this scene at its first frame
      writer.writeTag(Tag.FrameLabel, encodeSceneLabel(scene.name));

      // Emit ExportAssets (tag 56) in the first SWF frame (scene 0, frame 0).
      // Must appear BEFORE DoInitAction so the character IDs are mapped before
      // registerClass is called.
      if (sceneIdx === 0 && exportEntries.length > 0) {
        writer.writeTag(Tag.ExportAssets, encodeExportAssets(exportEntries));
      }

      // Emit ImportAssets2 (tag 71) in the first SWF frame, one tag per sharedUrl.
      // These must appear after ExportAssets but before DoInitAction.
      if (sceneIdx === 0 && importsByUrl.size > 0) {
        for (const [url, entries] of importsByUrl) {
          writer.writeTag(Tag.ImportAssets2, encodeImportAssets2(url, entries));
        }
      }

      // Emit DoInitAction tags at the start of the very first SWF frame (scene 0, frame 0).
      // These must appear before any PlaceObject tags in the frame.
      if (sceneIdx === 0 && doInitActionBodies.length > 0) {
        for (const body of doInitActionBodies) {
          writer.writeTag(Tag.DoInitAction, body);
        }
      }

      for (let frameIdx = 0; frameIdx < maxFrames; frameIdx++) {
        // Collect letterSpacing DoAction scripts for text fields placed this frame.
        // Each entry is a compiled AS2 snippet:
        //   var _tf=new TextFormat();_tf.letterSpacing=N;_root.name.setTextFormat(_tf);
        const letterSpacingActions: string[] = [];

        // Collect tab-order DoAction scripts for instances with accessibility.tabIndex
        // set. On scene 0 / frame 0, also emit the global _root.tabChildren = false when
        // doc.accessibility.useCustomTabOrder is true.
        const tabOrderActions: string[] = [];
        if (sceneIdx === 0 && frameIdx === 0 && doc.accessibility?.useCustomTabOrder) {
          tabOrderActions.push("_root.tabChildren = false;");
        }

        // Video streams: placed once on scene 0 / frame 0, then advanced one
        // VideoFrame (tag 61) per ShowFrame. VideoFrame tags are emitted just
        // before this frame's ShowFrame (see below).
        if (sceneIdx === 0 && frameIdx === 0) {
          for (const v of videoDepths) {
            writer.writeTag(
              Tag.PlaceObject2,
              encodePlaceObject2(v.charId, v.depth, 0, 0)
            );
          }
        }

        // Collect the set of (depth, displayObj) that should be on-screen this frame.
        // Use getTweenedFrame to get interpolated positions during tween spans.
        const thisFrameDepths = new Map<
          number,
          { objId: string; displayObj: DisplayObject; layerIdx: number }
        >();

        // Pass 1: assign depths for all layers in natural order (li=0 first).
        // This ensures mask layers (typically lower li) receive lower depth values
        // than the masked layers below them, which is required by the SWF spec:
        // a PlaceObject2 with HasClipDepth at depth D clips layers D+1..clipDepth.
        for (let li = 0; li < layers.length; li++) {
          const layer = layers[li];
          if (layer.type === "guide") continue;
          const frame = getTweenedFrame(layer, frameIdx, scene.timeline);
          // Do not skip on isEmpty — the flag can be stale; use actual displayObjects length.
          if (!frame || frame.displayObjects.length === 0) continue;

          for (const obj of frame.displayObjects) {
            const depth = getOrAssignDepth(sceneIdx, li, obj.id);
            thisFrameDepths.set(depth, { objId: obj.id, displayObj: obj, layerIdx: li });
          }
        }

        // Pass 2: compute clipDepth for each mask layer now that all depths are known.
        // For mask layer at li, the clipDepth = max depth among all objects on the
        // consecutive run of 'masked' layers immediately following it (li+1, li+2, …).
        //
        // maskClipDepths: li → clipDepth value to use for objects on that layer
        const maskClipDepths = new Map<number, number>();

        for (let li = 0; li < layers.length; li++) {
          if (layers[li]!.type !== "mask") continue;

          let maxDepth = 0;
          for (let mli = li + 1; mli < layers.length; mli++) {
            const ml = layers[mli]!;
            if (ml.type !== "masked") break;
            const mFrame = getTweenedFrame(ml, frameIdx, scene.timeline);
            // Do not skip on isEmpty — the flag can be stale; use actual displayObjects length.
            if (!mFrame || mFrame.displayObjects.length === 0) continue;
            for (const obj of mFrame.displayObjects) {
              // Depths already assigned in pass 1 — getOrAssignDepth is idempotent
              const d = getOrAssignDepth(sceneIdx, mli, obj.id);
              if (d > maxDepth) maxDepth = d;
            }
          }

          if (maxDepth > 0) {
            maskClipDepths.set(li, maxDepth);
          }
        }

        // 1) Emit RemoveObject2 for depths that had something last frame but not this frame
        for (const [depth] of depthState) {
          if (!thisFrameDepths.has(depth)) {
            writer.writeTag(Tag.RemoveObject2, encodeRemoveObject2(depth));
            depthState.delete(depth);
            depthToObjId.delete(depth);
          }
        }

        // 2) Emit PlaceObject2 (new or update) for each object in this frame
        for (const [depth, { objId, displayObj, layerIdx }] of thisFrameDepths) {
          // Determine if this object belongs to a mask layer (HasClipDepth)
          const clipDepth = maskClipDepths.get(layerIdx);
          const prev = depthState.get(depth);

          // Extract transform from the (possibly interpolated) display object
          let x = 0;
          let y = 0;
          let scaleX = 1;
          let scaleY = 1;
          let rotation = 0;
          let skewX = 0;
          let skewY = 0;
          if ("x" in displayObj) x = (displayObj as { x: number }).x ?? 0;
          if ("y" in displayObj) y = (displayObj as { y: number }).y ?? 0;
          if ("scaleX" in displayObj)
            scaleX = (displayObj as { scaleX: number }).scaleX ?? 1;
          if ("scaleY" in displayObj)
            scaleY = (displayObj as { scaleY: number }).scaleY ?? 1;
          if ("rotation" in displayObj)
            rotation = (displayObj as { rotation: number }).rotation ?? 0;
          if ("skewX" in displayObj)
            skewX = (displayObj as { skewX: number }).skewX ?? 0;
          if ("skewY" in displayObj)
            skewY = (displayObj as { skewY: number }).skewY ?? 0;

          // Compute morph ratio if this is a morph shape object
          let morphRatio = -1;
          if (morphShapeObjIds.has(objId)) {
            const spanInfoList = morphObjSpanInfo.get(objId);
            if (spanInfoList) {
              for (const spanInfo of spanInfoList) {
                if (frameIdx >= spanInfo.startFrame && frameIdx <= spanInfo.endFrame) {
                  const spanLen = spanInfo.endFrame - spanInfo.startFrame + 1;
                  const frameOffset = frameIdx - spanInfo.startFrame;
                  const linearT = spanLen <= 1 ? 0 : frameOffset / spanLen;
                  const easedT = applyEase(linearT, spanInfo.ease, spanInfo.easeCurve);
                  morphRatio = Math.round(easedT * 65535);
                  break;
                }
              }
              // If not in any span (e.g. at the end keyframe itself), use 65535
              if (morphRatio === -1) morphRatio = 65535;
            }
          }

          const thisColorEffectKey = colorEffectKey(displayObj);

          const isFirst = !prev;
          const posChanged =
            prev &&
            (prev.x !== x ||
              prev.y !== y ||
              prev.scaleX !== scaleX ||
              prev.scaleY !== scaleY ||
              prev.rotation !== rotation ||
              prev.skewX !== skewX ||
              prev.skewY !== skewY ||
              prev.objId !== objId ||
              prev.ratio !== morphRatio ||
              prev.colorEffectKey !== thisColorEffectKey);

          if (isFirst) {
            // First placement at this depth
            if (
              displayObj.type === "shape" ||
              displayObj.type === "drawing-object"
            ) {
              const charId = objCharIdMap.get(objId)!;
              // Morph shape: use PlaceObject2WithRatio
              if (morphRatio >= 0) {
                const placeBody = encodePlaceObject2WithRatio(
                  charId,
                  depth,
                  x,
                  y,
                  morphRatio,
                  false
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              } else {
                const objTransform =
                  displayObj.type === "shape"
                    ? {
                        scaleX: displayObj.scaleX,
                        scaleY: displayObj.scaleY,
                        rotation: displayObj.rotation,
                      }
                    : undefined;
                if (clipDepth !== undefined) {
                  // Mask layer: place with HasClipDepth so the shape clips the layers below
                  const placeBody = encodePlaceObject2WithClipDepth(
                    charId,
                    depth,
                    x,
                    y,
                    clipDepth
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                } else if (hasEnabledFilters(displayObj.filters)) {
                  const placeBody = encodePlaceObject3WithFilters(
                    charId,
                    depth,
                    x,
                    y,
                    displayObj.filters!,
                    objTransform
                  );
                  writer.writeTag(Tag.PlaceObject3, placeBody);
                } else if (displayObj.type === "shape" && displayObj.cacheAsBitmap) {
                  // cacheAsBitmap requires PlaceObject3 (tag 70) with HasCacheAsBitmap bit set.
                  const placeBody = encodePlaceObject3WithCacheAsBitmap(
                    charId,
                    depth,
                    x,
                    y,
                    objTransform
                  );
                  writer.writeTag(Tag.PlaceObject3, placeBody);
                } else {
                  const placeBody = encodePlaceObject2(
                    charId,
                    depth,
                    x,
                    y,
                    objTransform
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                }
              }
            } else if (displayObj.type === "text") {
              const charId = objCharIdMap.get(objId)!;
              // Named text fields (dynamic/input) must carry the instance name
              // in PlaceObject2 so AS2 can address them (_root.<name>.text = ...).
              const textName = displayObj.instanceName;
              if (hasEnabledFilters(displayObj.filters)) {
                // Filters require PlaceObject3 (tag 70). If the field also has
                // a name, pass it so both HasName and HasFilterList are set.
                const placeBody = encodePlaceObject3WithFilters(
                  charId,
                  depth,
                  x,
                  y,
                  displayObj.filters!,
                  undefined,
                  textName && textName.length > 0 ? textName : undefined
                );
                writer.writeTag(Tag.PlaceObject3, placeBody);
              } else {
                // Check for color effect (CXFormWithAlpha)
                const cxform = displayObj.colorEffect
                  ? colorEffectToCXForm(displayObj.colorEffect)
                  : null;
                if (cxform !== null) {
                  const placeBody = encodePlaceObject2WithCXForm(
                    charId,
                    depth,
                    x,
                    y,
                    cxform
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                } else {
                  const placeBody = textName && textName.length > 0
                    ? encodePlaceObject2WithName(charId, depth, x, y, textName)
                    : encodePlaceObject2ForText(charId, depth, x, y);
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                }
              }
              // If the text field has non-zero letterSpacing and a named instance,
              // emit a DoAction that calls setTextFormat to apply the spacing at runtime.
              // DefineEditText has no letterSpacing field — it must be set via AS2.
              const ls = displayObj.letterSpacing;
              if (ls != null && ls !== 0 && textName && textName.length > 0) {
                letterSpacingActions.push(
                  `var _tf=new TextFormat();_tf.letterSpacing=${ls};_root.${textName}.setTextFormat(_tf);`
                );
              }
            } else if (displayObj.type === "bitmap") {
              const charId = objCharIdMap.get(objId)!;
              if (hasEnabledFilters(displayObj.filters)) {
                // Filters require PlaceObject3 (tag 70).
                const placeBody = encodePlaceObject3WithFilters(
                  charId,
                  depth,
                  x,
                  y,
                  displayObj.filters!
                );
                writer.writeTag(Tag.PlaceObject3, placeBody);
              } else {
                const hasAlpha =
                  displayObj.alpha !== undefined && displayObj.alpha !== 1;
                if (hasAlpha) {
                  const placeBody = encodePlaceObject2WithAlpha(
                    charId,
                    depth,
                    x,
                    y,
                    displayObj.alpha!
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                } else {
                  const placeBody = encodePlaceObject2(charId, depth, x, y);
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                }
              }
            } else if (displayObj.type === "video") {
              const vdo = displayObj as VideoDisplayObject;
              const charId = videoCharIdMap.get(vdo.videoItemId);
              if (charId !== undefined) {
                const transform = videoFitTransform(vdo, videoStreams);
                const placeBody = encodePlaceObject2(charId, depth, x, y, transform);
                writer.writeTag(Tag.PlaceObject2, placeBody);
              }
            } else if (displayObj.type === "instance") {
              let charId = charIdMap.get(displayObj.symbolId);
              if (charId !== undefined) {
                // Button instances with instance-level on() handlers need a
                // unique DefineButton2 character (the handlers live in the tag,
                // not in PlaceObject2). Emit an inline DefineButton2 with the
                // instance's handlers and use its char ID for placement.
                const hasButtonHandlers =
                  !!displayObj.buttonHandlers && displayObj.buttonHandlers.length > 0;
                if (hasButtonHandlers) {
                  const sym = symbolById.get(displayObj.symbolId);
                  if (sym && sym.symbolType === "button") {
                    const instCharId = writer.nextCharId();
                    const instHoisted: Array<{ tagType: number; body: Uint8Array }> = [];
                    const buttonBody = encodeDefineButton2(
                      instCharId,
                      sym,
                      doc,
                      charIdMap,
                      () => writer.nextCharId(),
                      instHoisted,
                      displayObj.buttonHandlers as readonly ButtonHandler[],
                      displayObj.trackAsMenu
                    );
                    for (const def of instHoisted) {
                      writer.writeTag(def.tagType, def.body);
                    }
                    writer.writeTag(Tag.DefineButton2, buttonBody);
                    charId = instCharId;
                  }
                }

                // Resolve loopMode and firstFrame for graphic symbol instances.
                // loopMode defaults to "loop" (no extra encoding needed).
                const loopMode = displayObj.loopMode ?? "loop";
                const instanceFirstFrame = displayObj.firstFrame ?? 0;

                const hasBlend = !!displayObj.blendMode && displayObj.blendMode !== 'normal';
                const hasCacheAsBitmap = !!displayObj.cacheAsBitmap;
                // For play-once mode, add an enterFrame clip action that calls stop()
                // when the instance reaches its last frame. Merge with any existing clipActions.
                let effectiveClipActions = displayObj.clipActions ?? [];
                if (loopMode === "play-once" && !hasBlend && !hasEnabledFilters(displayObj.filters)) {
                  const playOnceAction: ClipAction = {
                    event: "enterFrame",
                    script: "if (this._currentframe >= this._totalframes) { this.stop(); }",
                  };
                  effectiveClipActions = [...effectiveClipActions, playOnceAction];
                }
                const hasClipActions = effectiveClipActions.length > 0;

                // For single-frame mode, compute a PlaceObject2 ratio so the sprite
                // is positioned at firstFrame. Ratio field: 0 = frame 1, 65535 = last frame.
                // Only applies when the instance has no blend/filter (those use PO3).
                if (loopMode === "single-frame" && !hasBlend && !hasEnabledFilters(displayObj.filters)) {
                  const sym = symbolById.get(displayObj.symbolId);
                  const totalFrames = sym ? sceneFrameCount(sym.timeline) : 1;
                  const ratio = totalFrames <= 1
                    ? 0
                    : Math.round(instanceFirstFrame / (totalFrames - 1) * 65535);
                  const placeBody = encodePlaceObject2WithRatio(charId, depth, x, y, ratio, false);
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                } else if (hasBlend || hasEnabledFilters(displayObj.filters)) {
                  const placeBody = hasBlend
                    ? encodePlaceObject3WithBlendMode(
                        charId,
                        depth,
                        x,
                        y,
                        displayObj.blendMode!,
                        displayObj.filters
                      )
                    : encodePlaceObject3WithFilters(
                        charId,
                        depth,
                        x,
                        y,
                        displayObj.filters!
                      );
                  writer.writeTag(Tag.PlaceObject3, placeBody);
                } else if (hasCacheAsBitmap) {
                  // cacheAsBitmap requires PlaceObject3 (tag 70) with HasCacheAsBitmap bit set.
                  const instanceTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                    ? { scaleX, scaleY, rotation, skewX, skewY }
                    : undefined;
                  const placeBody = encodePlaceObject3WithCacheAsBitmap(
                    charId,
                    depth,
                    x,
                    y,
                    instanceTransform
                  );
                  writer.writeTag(Tag.PlaceObject3, placeBody);
                } else if (hasClipActions) {
                  // Clip actions: encode CLIPACTIONRECORD block in PlaceObject2
                  const transform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                    ? { scaleX, scaleY, rotation, skewX, skewY }
                    : undefined;
                  const placeBody = encodePlaceObject2WithClipActions(
                    charId,
                    depth,
                    x,
                    y,
                    effectiveClipActions,
                    transform,
                    displayObj.instanceName
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                } else {
                  // Check for color effect (CXFormWithAlpha)
                  const cxform = displayObj.colorEffect
                    ? colorEffectToCXForm(displayObj.colorEffect)
                    : null;
                  if (cxform !== null) {
                    const transform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                      ? { scaleX, scaleY, rotation, skewX, skewY }
                      : undefined;
                    const placeBody = encodePlaceObject2WithCXForm(
                      charId,
                      depth,
                      x,
                      y,
                      cxform,
                      transform,
                      false,
                      displayObj.instanceName ?? undefined
                    );
                    writer.writeTag(Tag.PlaceObject2, placeBody);
                  } else {
                    const instanceName = displayObj.instanceName;
                    const instanceTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                      ? { scaleX, scaleY, rotation, skewX, skewY }
                      : undefined;
                    if (instanceName && instanceName.length > 0) {
                      const placeBody = encodePlaceObject2WithName(
                        charId,
                        depth,
                        x,
                        y,
                        instanceName,
                        instanceTransform
                      );
                      writer.writeTag(Tag.PlaceObject2, placeBody);
                    } else {
                      const placeBody = encodePlaceObject2(charId, depth, x, y, instanceTransform);
                      writer.writeTag(Tag.PlaceObject2, placeBody);
                    }
                  }
                }
              }
            }

            // If this is a newly-placed instance with an accessibility.tabIndex,
            // queue a DoAction to set tabEnabled and tabIndex via AS2.
            // Requires an instanceName so AS2 can address the object (_root.name).
            if (
              displayObj.type === "instance" &&
              displayObj.instanceName &&
              displayObj.instanceName.length > 0 &&
              displayObj.accessibility?.tabIndex != null
            ) {
              const name = displayObj.instanceName;
              const idx = displayObj.accessibility.tabIndex;
              // tabEnabled defaults to true for objects with a set tabIndex,
              // but emit it explicitly so Flash Player custom tab order works.
              const tabEnabled = displayObj.accessibility.enabled !== false;
              tabOrderActions.push(
                `_root.${name}.tabEnabled = ${tabEnabled};` +
                `_root.${name}.tabIndex = ${idx};`
              );
            }

            depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, skewX, skewY, ratio: morphRatio, colorEffectKey: thisColorEffectKey });
          } else if (posChanged) {
            // Object moved, scaled, rotated, or replaced — emit PlaceObject2+Move
            if (
              displayObj.type === "shape" ||
              displayObj.type === "drawing-object"
            ) {
              const charId = objCharIdMap.get(objId)!;
              // Morph shape: use PlaceObject2WithRatio (move variant)
              if (morphRatio >= 0) {
                const placeBody = encodePlaceObject2WithRatio(
                  charId,
                  depth,
                  x,
                  y,
                  morphRatio,
                  true
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
                depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, skewX, skewY, ratio: morphRatio, colorEffectKey: thisColorEffectKey });
                continue; // skip the generic depthState.set below
              }
              const objTransform =
                displayObj.type === "shape"
                  ? {
                      scaleX: displayObj.scaleX,
                      scaleY: displayObj.scaleY,
                      rotation: displayObj.rotation,
                    }
                  : undefined;
              if (hasEnabledFilters(displayObj.filters)) {
                // Filters require PlaceObject3 — re-emit full placement with filter list
                const placeBody = encodePlaceObject3WithFilters(
                  charId,
                  depth,
                  x,
                  y,
                  displayObj.filters!,
                  objTransform
                );
                writer.writeTag(Tag.PlaceObject3, placeBody);
              } else {
                // Character changed at same depth — use Move+Character flags
                const newCharId =
                  prev!.objId !== objId ? charId : undefined;
                const placeBody = encodePlaceObject2Move(
                  charId,
                  depth,
                  x,
                  y,
                  objTransform,
                  newCharId !== undefined
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              }
            } else if (displayObj.type === "text") {
              const charId = objCharIdMap.get(objId)!;
              const cxform = displayObj.colorEffect
                ? colorEffectToCXForm(displayObj.colorEffect)
                : null;
              if (cxform !== null) {
                // Move + HasMatrix + HasColorTransform (no HasCharacter unless replacing)
                const placeBody = encodePlaceObject2WithCXForm(
                  charId,
                  depth,
                  x,
                  y,
                  cxform,
                  undefined,
                  true  // move = true
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              } else {
                const placeBody = encodePlaceObject2Move(
                  charId,
                  depth,
                  x,
                  y,
                  undefined,
                  prev!.objId !== objId
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              }
            } else if (displayObj.type === "bitmap") {
              const charId = objCharIdMap.get(objId)!;
              const hasAlpha =
                displayObj.alpha !== undefined && displayObj.alpha !== 1;
              if (hasAlpha) {
                // Move with color transform — emit Move+HasMatrix+HasColorTransform
                const placeBody = encodePlaceObject2WithAlpha(
                  charId,
                  depth,
                  x,
                  y,
                  displayObj.alpha!,
                  undefined,
                  true
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              } else {
                const placeBody = encodePlaceObject2Move(
                  charId,
                  depth,
                  x,
                  y,
                  undefined,
                  prev!.objId !== objId
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              }
            } else if (displayObj.type === "video") {
              const vdo = displayObj as VideoDisplayObject;
              const charId = videoCharIdMap.get(vdo.videoItemId);
              if (charId !== undefined) {
                const transform = videoFitTransform(vdo, videoStreams);
                const placeBody = encodePlaceObject2Move(
                  charId,
                  depth,
                  x,
                  y,
                  transform,
                  prev!.objId !== objId
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              }
            } else if (displayObj.type === "instance") {
              const charId = charIdMap.get(displayObj.symbolId);
              if (charId !== undefined) {
                const cxform = displayObj.colorEffect
                  ? colorEffectToCXForm(displayObj.colorEffect)
                  : null;
                if (cxform !== null) {
                  const transform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                    ? { scaleX, scaleY, rotation, skewX, skewY }
                    : undefined;
                  // Move + HasMatrix + HasColorTransform (no HasCharacter unless replacing)
                  const placeBody = encodePlaceObject2WithCXForm(
                    charId,
                    depth,
                    x,
                    y,
                    cxform,
                    transform,
                    true  // move = true
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                } else {
                  const moveTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                    ? { scaleX, scaleY, rotation, skewX, skewY }
                    : undefined;
                  const placeBody = encodePlaceObject2Move(
                    charId,
                    depth,
                    x,
                    y,
                    moveTransform,
                    prev!.objId !== objId
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                }
              }
            }
            depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, skewX, skewY, ratio: morphRatio, colorEffectKey: thisColorEffectKey });
          }
          // else: unchanged — emit nothing
        }

        // Emit sound tags for any keyframes at exactly this frame index that have sound.
        // For stream mode: SoundStreamHead + first SoundStreamBlock are handled by the
        // streamSounds pre-computation above; per-frame blocks are emitted just before
        // ShowFrame below. Here we only handle event/start/stop sounds.
        // For sounds with a linkageIdentifier: emit StartSound2 (tag 89) by class name.
        // For other modes (event/start/stop): emit StartSound (tag 15) by char ID.
        for (const layer of layers) {
          for (const frame of layer.frames) {
            if (
              frame.isKeyframe &&
              frame.index === frameIdx &&
              frame.sound !== null
            ) {
              const soundId = soundIdMap.get(frame.sound.libraryItemId);
              if (soundId !== undefined) {
                if (frame.sound.syncMode !== "stream") {
                  // Find the SoundItem to check for AS2 linkage class name.
                  const soundItem = soundItems.find(
                    (si) => si.id === frame.sound!.libraryItemId
                  );
                  const soundInfoOpts = {
                    loops: frame.sound.repeatCount,
                    stop: frame.sound.syncMode === "stop",
                    noMultiple: frame.sound.syncMode === "start",
                    effect: frame.sound.customEnvelope ? undefined : frame.sound.effect,
                    envelope: frame.sound.customEnvelope,
                    inPoint: frame.sound.inPoint,
                    outPoint: frame.sound.outPoint,
                  };
                  if (soundItem?.linkageIdentifier) {
                    // StartSound2 (tag 89): trigger by AS2 linkage class name.
                    const startSound2Body = encodeStartSound2(
                      soundItem.linkageIdentifier,
                      soundInfoOpts
                    );
                    writer.writeTag(Tag.StartSound2, startSound2Body);
                  } else {
                    const startSoundBody = encodeStartSound(soundId, soundInfoOpts);
                    writer.writeTag(Tag.StartSound, startSoundBody);
                  }
                }
              }
            }
          }
        }

        // Emit per-frame FrameLabel (tag 43) if any keyframe at this index has a
        // non-empty label of type "name" or "anchor".
        // For frameIdx 0 the scene-name label was already emitted above; skip it here
        // to avoid duplicate FrameLabel tags at the same frame position.
        // Comment-type labels (labelType === "comment") are NOT emitted as FrameLabel.
        if (frameIdx > 0) {
          let frameLabel: string | null = null;
          let frameLabelType: string = "name";
          outerLabel: for (const layer of layers) {
            for (const frame of layer.frames) {
              if (
                frame.index === frameIdx &&
                frame.isKeyframe &&
                frame.label !== "" &&
                (frame.labelType === "name" || frame.labelType === "anchor")
              ) {
                frameLabel = frame.label;
                frameLabelType = frame.labelType;
                break outerLabel;
              }
            }
          }
          if (frameLabel) {
            writer.writeTag(
              Tag.FrameLabel,
              encodeFrameLabel(frameLabel, frameLabelType === "anchor")
            );
          }
        }

        // Emit DoAction for any keyframes with scripts at exactly this frame index
        // DoAction must appear BEFORE ShowFrame so actions execute on frame entry
        for (const layer of layers) {
          for (const frame of layer.frames) {
            if (
              frame.index === frameIdx &&
              frame.isKeyframe &&
              frame.script?.trim()
            ) {
              const actionBytes = compileAS2(frame.script);
              if (actionBytes.length > 0) {
                // DoAction payload = AVM1 bytecode + EndAction (0x00)
                const doActionBody = new Uint8Array(actionBytes.length + 1);
                doActionBody.set(actionBytes);
                // doActionBody[actionBytes.length] is already 0x00 (EndAction)
                writer.writeTag(Tag.DoAction, doActionBody);
              }
            }
          }
        }

        // Emit DoAction for any text fields with non-zero letterSpacing placed this frame.
        // Each script: var _tf=new TextFormat();_tf.letterSpacing=N;_root.name.setTextFormat(_tf);
        for (const script of letterSpacingActions) {
          const actionBytes = compileAS2(script);
          if (actionBytes.length > 0) {
            const doActionBody = new Uint8Array(actionBytes.length + 1);
            doActionBody.set(actionBytes);
            // doActionBody[actionBytes.length] is already 0x00 (EndAction)
            writer.writeTag(Tag.DoAction, doActionBody);
          }
        }

        // Emit DoAction for tab-order scripts (accessibility.tabIndex / useCustomTabOrder).
        // Global script (_root.tabChildren = false) is first, then per-object scripts.
        for (const script of tabOrderActions) {
          const actionBytes = compileAS2(script);
          if (actionBytes.length > 0) {
            const doActionBody = new Uint8Array(actionBytes.length + 1);
            doActionBody.set(actionBytes);
            // doActionBody[actionBytes.length] is already 0x00 (EndAction)
            writer.writeTag(Tag.DoAction, doActionBody);
          }
        }

        // Emit one VideoFrame (tag 61) per video stream for this SWF frame,
        // advancing through the demuxed FLV frames. Only on scene 0 (videos are
        // global characters placed once on the first scene's timeline).
        if (sceneIdx === 0) {
          for (const v of videoFrameAdvancers) {
            const payload = v.payloads[frameIdx];
            if (payload !== undefined) {
              writer.writeTag(
                Tag.VideoFrame,
                encodeVideoFrame(v.charId, frameIdx, payload)
              );
            }
          }
        }

        // Emit per-frame SoundStreamBlock tags for active stream sounds.
        // SWF spec requires one SoundStreamBlock per ShowFrame, interleaved
        // just before each ShowFrame tag. Each block carries only that frame's
        // audio samples. SoundStreamHead is emitted once at the stream's start
        // frame (chunkIdx===0), then one SoundStreamBlock per subsequent frame.
        for (const ss of streamSounds) {
          const chunkIdx = frameIdx - ss.startFrame;
          if (chunkIdx === 0) {
            // Emit SoundStreamHead just before the first SoundStreamBlock
            writer.writeTag(Tag.SoundStreamHead, ss.headBody);
          }
          if (chunkIdx >= 0 && chunkIdx < ss.chunks.length) {
            const chunk = ss.chunks[chunkIdx];
            let blockBody: Uint8Array;
            if (ss.isMP3) {
              // MP3 SoundStreamBlock: SampleCount UI16 + SeekSamples SI16 + data
              // SeekSamples is 0 for all blocks (no seek offset needed)
              blockBody = encodeSoundStreamBlockMp3(ss.samplesPerFrame, 0, chunk);
            } else {
              blockBody = encodeSoundStreamBlock(chunk);
            }
            writer.writeTag(Tag.SoundStreamBlock, blockBody);
          }
        }

        writer.writeTag(Tag.ShowFrame, new Uint8Array(0));
      }
    }
  }

  // 5. End
  writer.writeTag(Tag.End, new Uint8Array(0));

  // Assemble the final binary.
  // FrameCount in the SWF header = total frames across ALL scenes.
  const frameCount =
    doc.scenes.length === 0
      ? 1
      : doc.scenes.reduce((sum, s, i) => {
          const sceneFrames = sceneFrameCount(s.timeline);
          // Scene 0 is extended to cover the longest embedded video stream.
          return sum + (i === 0 ? Math.max(sceneFrames, maxVideoFrames) : sceneFrames);
        }, 0);

  const result = writer.assemble(
    props.frameRate,
    frameCount,
    props.width,
    props.height,
    false
  );

  if (options?.compress) {
    // Compress the SWF body (bytes 8 onward) with zlib deflate and emit CWS header.
    // Bytes 0-7 are the SWF header (signature + version + uncompressed file length).
    const header = result.slice(0, 8);
    const body = result.slice(8);
    const compressed = deflateSync(body);
    const out = new Uint8Array(8 + compressed.length);
    out.set(header);
    out.set(compressed, 8);
    out[0] = 0x43; // 'C' — CWS signature
    return out;
  }

  return result;
}
