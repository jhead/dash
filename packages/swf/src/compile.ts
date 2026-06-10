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
import type { BitmapItem, DisplayObject, FlashDocument, FontItem, SoundItem, Symbol } from "@flash/core";
import { layerFrameCount, compileAS2, getTweenedFrame, getTweenSpans } from "@flash/core";
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
import { encodeDefineText, encodeDefineEditText, encodePlaceObject2ForText } from "./text.js";
import { encodeDefineFont2, fontKey } from "./fonts.js";
import {
  encodePlaceObject3WithFilters,
  encodePlaceObject3WithBlendMode,
  hasEnabledFilters,
} from "./filters.js";
import { colorEffectToCXForm } from "./cxform.js";
import { BitWriter } from "./bits.js";
import { writeRect, px } from "./helpers.js";
import { encodeDefineSprite } from "./sprite.js";
import { encodeDefineButton2 } from "./buttons.js";
import {
  encodeDefineSound,
  encodeSoundStreamHead,
  encodeSoundStreamBlock,
  soundFormat,
  soundRate,
} from "./audio.js";
import { encodeStartSound } from "./sounds.js";
import { dataUriToBytes, encodeDefineBitsLossless2, encodeDefineBitsJpeg3 } from "./bitmaps.js";
import { encodeDoInitAction } from "./doInitAction.js";
import { encodeFrameLabel } from "./framelabel.js";
import { encodeSceneAndFrameLabelData, hasAnyLabels } from "./scenelabels.js";
import { buildXmpMetadata, type MetadataOptions } from "./metadata.js";

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

  // 1c. Protect tag (24) — marks SWF as password-protected (empty body).
  if (options?.protect) {
    writer.writeTag(Tag.Protect, new Uint8Array(0));
  }

  // 1d. EnableDebugger2 tag (64) — stores debugger password.
  //     Body: uint16 reserved=0, null-terminated password string.
  if (options?.debugPassword) {
    const encoder = new TextEncoder();
    const pwBytes = encoder.encode(options.debugPassword);
    const body = new Uint8Array(2 + pwBytes.length + 1); // 2 reserved + pw + null
    // body[0] and body[1] are already 0x00 (reserved uint16 = 0)
    body.set(pwBytes, 2);
    // body[2 + pwBytes.length] is already 0x00 (null terminator)
    writer.writeTag(Tag.EnableDebugger2, body);
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

  // 3. Compile library symbols → DefineSprite tags
  //    Build charIdMap: symbolId → SWF character ID
  const rawSymbols = doc.library.items.filter(
    (item): item is Symbol => item.itemType === "symbol"
  );

  // Sort symbols topologically so dependencies are emitted first
  const symbols = topoSortSymbols(rawSymbols);

  const charIdMap = new Map<string, number>();
  // Assign character IDs to all symbols up front (so nested instances resolve)
  for (const sym of symbols) {
    charIdMap.set(sym.id, writer.nextCharId());
  }

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

  // 3b. Collect ExportAssets entries for symbols with exportForActionScript=true.
  // These will be emitted inside the first SWF frame (after FrameLabel, before DoInitAction).
  const exportEntries: { charId: number; name: string }[] = [];
  for (const sym of symbols) {
    if (sym.linkage.exportForActionScript && sym.linkage.linkageIdentifier) {
      const charId = charIdMap.get(sym.id);
      if (charId !== undefined) {
        exportEntries.push({ charId, name: sym.linkage.linkageIdentifier });
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
  }

  // 4. Frames — iterate ALL scenes' timelines.
  //    Each scene gets a FrameLabel tag (scene name) at its first frame.
  //    Between scenes we emit RemoveObject2 for all occupied depths to reset
  //    the display list so each scene starts with a clean stage.

  // Per-depth: last placed state (objId, x, y, scaleX, scaleY, rotation, ratio)
  interface DepthState {
    objId: string;
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    /** Last placed morph ratio (0..65535); -1 if not a morph shape. */
    ratio: number;
  }
  const depthState = new Map<number, DepthState>();

  // Track display list per depth: depth → current display-object id
  const depthToObjId = new Map<number, string>();
  // Track the depth assigned to each (sceneIdx:layerIdx:objId) triple
  const layerObjDepth = new Map<string, number>();
  let nextDepth = 1;

  // Map from display-object id → stable SWF character ID (global across scenes)
  const objCharIdMap = new Map<string, number>();

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
  }

  // morphShapeObjIds: set of object IDs that have been encoded as DefineMorphShape.
  // Used during the frame loop to detect morph shapes and use ratio-based placement.
  const morphShapeObjIds = new Set<string>();

  // morphObjSpanInfo: maps objId → array of {startFrame, endFrame, spanLength} spans.
  // Used during the frame loop to compute the morph ratio for a given frameIdx.
  const morphObjSpanInfo = new Map<
    string,
    Array<{ startFrame: number; endFrame: number; spanLength: number }>
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
          existing.push({ startFrame: span.startFrame, endFrame: span.endFrame, spanLength });
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
            const charId = writer.nextCharId();
            objCharIdMap.set(obj.id, charId);
            const shapeBody = encodeDefineShape4(charId, obj.shape);
            writer.writeTag(Tag.DefineShape4, shapeBody);
          } else if (obj.type === "text") {
            const charId = writer.nextCharId();
            objCharIdMap.set(obj.id, charId);
            const key = fontKey(obj.fontFamily, obj.bold, obj.italic);
            const embeddedFontId = fontCharIdMap.get(key);
            if (obj.textType === "static") {
              // Static text: use DefineText (tag 11) with glyph-indexed rendering
              const fontSizeTwips = Math.round(obj.fontSize * 20);
              const colorHex = `#${obj.color.r.toString(16).padStart(2, "0")}${obj.color.g.toString(16).padStart(2, "0")}${obj.color.b.toString(16).padStart(2, "0")}`;
              const textBody = encodeDefineText(
                charId,
                obj.text,
                embeddedFontId ?? 0,
                fontSizeTwips,
                colorHex,
                0,
                fontSizeTwips // Y offset = font height so baseline is visible
              );
              writer.writeTag(Tag.DefineText, textBody);
            } else {
              // Dynamic and input text: use DefineEditText (tag 37)
              const textBody = encodeDefineEditText(charId, obj, embeddedFontId);
              writer.writeTag(Tag.DefineEditText, textBody);
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
                const imageBytes = dataUriToBytes(bitmapItem.dataUri);
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

      const maxFrames = sceneFrameCount(scene.timeline);

      // Emit FrameLabel (tag 43) for this scene at its first frame
      writer.writeTag(Tag.FrameLabel, encodeSceneLabel(scene.name));

      // Emit ExportAssets (tag 56) in the first SWF frame (scene 0, frame 0).
      // Must appear BEFORE DoInitAction so the character IDs are mapped before
      // registerClass is called.
      if (sceneIdx === 0 && exportEntries.length > 0) {
        writer.writeTag(Tag.ExportAssets, encodeExportAssets(exportEntries));
      }

      // Emit DoInitAction tags at the start of the very first SWF frame (scene 0, frame 0).
      // These must appear before any PlaceObject tags in the frame.
      if (sceneIdx === 0 && doInitActionBodies.length > 0) {
        for (const body of doInitActionBodies) {
          writer.writeTag(Tag.DoInitAction, body);
        }
      }

      for (let frameIdx = 0; frameIdx < maxFrames; frameIdx++) {
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
          const frame = getTweenedFrame(layer, frameIdx);
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
            const mFrame = getTweenedFrame(ml, frameIdx);
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
          if ("x" in displayObj) x = (displayObj as { x: number }).x ?? 0;
          if ("y" in displayObj) y = (displayObj as { y: number }).y ?? 0;
          if ("scaleX" in displayObj)
            scaleX = (displayObj as { scaleX: number }).scaleX ?? 1;
          if ("scaleY" in displayObj)
            scaleY = (displayObj as { scaleY: number }).scaleY ?? 1;
          if ("rotation" in displayObj)
            rotation = (displayObj as { rotation: number }).rotation ?? 0;

          // Compute morph ratio if this is a morph shape object
          let morphRatio = -1;
          if (morphShapeObjIds.has(objId)) {
            const spanInfoList = morphObjSpanInfo.get(objId);
            if (spanInfoList) {
              for (const spanInfo of spanInfoList) {
                if (frameIdx >= spanInfo.startFrame && frameIdx <= spanInfo.endFrame) {
                  const spanLen = spanInfo.endFrame - spanInfo.startFrame + 1;
                  const frameOffset = frameIdx - spanInfo.startFrame;
                  morphRatio = spanLen <= 1
                    ? 0
                    : Math.round((frameOffset / (spanLen)) * 65535);
                  break;
                }
              }
              // If not in any span (e.g. at the end keyframe itself), use 65535
              if (morphRatio === -1) morphRatio = 65535;
            }
          }

          const isFirst = !prev;
          const posChanged =
            prev &&
            (prev.x !== x ||
              prev.y !== y ||
              prev.scaleX !== scaleX ||
              prev.scaleY !== scaleY ||
              prev.rotation !== rotation ||
              prev.objId !== objId ||
              prev.ratio !== morphRatio);

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
              const placeBody = encodePlaceObject2ForText(charId, depth, x, y);
              writer.writeTag(Tag.PlaceObject2, placeBody);
            } else if (displayObj.type === "bitmap") {
              const charId = objCharIdMap.get(objId)!;
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
            } else if (displayObj.type === "instance") {
              const charId = charIdMap.get(displayObj.symbolId);
              if (charId !== undefined) {
                const hasBlend = !!displayObj.blendMode && displayObj.blendMode !== 'normal';
                const hasClipActions = !!displayObj.clipActions && displayObj.clipActions.length > 0;
                if (hasBlend || hasEnabledFilters(displayObj.filters)) {
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
                } else if (hasClipActions) {
                  // Clip actions: encode CLIPACTIONRECORD block in PlaceObject2
                  const transform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0)
                    ? { scaleX, scaleY, rotation }
                    : undefined;
                  const placeBody = encodePlaceObject2WithClipActions(
                    charId,
                    depth,
                    x,
                    y,
                    displayObj.clipActions!,
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
                    const placeBody = encodePlaceObject2WithCXForm(
                      charId,
                      depth,
                      x,
                      y,
                      cxform
                    );
                    writer.writeTag(Tag.PlaceObject2, placeBody);
                  } else {
                    const instanceName = displayObj.instanceName;
                    if (instanceName && instanceName.length > 0) {
                      const placeBody = encodePlaceObject2WithName(
                        charId,
                        depth,
                        x,
                        y,
                        instanceName
                      );
                      writer.writeTag(Tag.PlaceObject2, placeBody);
                    } else {
                      const placeBody = encodePlaceObject2(charId, depth, x, y);
                      writer.writeTag(Tag.PlaceObject2, placeBody);
                    }
                  }
                }
              }
            }
            depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, ratio: morphRatio });
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
                depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, ratio: morphRatio });
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
              const placeBody = encodePlaceObject2Move(
                charId,
                depth,
                x,
                y,
                undefined,
                prev!.objId !== objId
              );
              writer.writeTag(Tag.PlaceObject2, placeBody);
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
            } else if (displayObj.type === "instance") {
              const charId = charIdMap.get(displayObj.symbolId);
              if (charId !== undefined) {
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
            }
            depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, ratio: morphRatio });
          }
          // else: unchanged — emit nothing
        }

        // Emit sound tags for any keyframes at exactly this frame index that have sound.
        // For stream mode: emit SoundStreamHead + SoundStreamBlock.
        // For other modes (event/start/stop): emit StartSound.
        for (const layer of layers) {
          for (const frame of layer.frames) {
            if (
              frame.isKeyframe &&
              frame.index === frameIdx &&
              frame.sound !== null
            ) {
              const soundId = soundIdMap.get(frame.sound.libraryItemId);
              if (soundId !== undefined) {
                if (frame.sound.syncMode === "stream") {
                  // Find the SoundItem to get audio parameters
                  const soundItem = soundItems.find(
                    (si) => si.id === frame.sound!.libraryItemId
                  );
                  if (soundItem) {
                    const fmt = soundFormat(soundItem.compressionType);
                    const rate = soundRate(soundItem.sampleRate);
                    const sizeBit = (soundItem.sampleSize === 16 ? 1 : 0) as 0 | 1;
                    const stereoBit = (soundItem.isStereo ? 1 : 0) as 0 | 1;

                    // Emit SoundStreamHead before first streaming block
                    const streamHeadBody = encodeSoundStreamHead({
                      playbackRate: rate,
                      playbackSize: sizeBit,
                      playbackStereo: stereoBit,
                      streamFormat: fmt,
                      streamRate: rate,
                      streamSize: sizeBit,
                      streamStereo: stereoBit,
                      streamSampleCount: 0,
                    });
                    writer.writeTag(Tag.SoundStreamHead, streamHeadBody);

                    // Emit SoundStreamBlock with all audio bytes
                    // Import helper inline to decode data URI
                    function dataUriToBytesLocal(dataUri: string): Uint8Array {
                      const commaIdx = dataUri.indexOf(",");
                      if (commaIdx === -1) return new Uint8Array(0);
                      const meta = dataUri.slice(0, commaIdx);
                      const data = dataUri.slice(commaIdx + 1);
                      if (meta.includes(";base64")) {
                        const binary = atob(data);
                        const bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) {
                          bytes[i] = binary.charCodeAt(i);
                        }
                        return bytes;
                      }
                      const decoded = decodeURIComponent(data);
                      const bytes = new Uint8Array(decoded.length);
                      for (let i = 0; i < decoded.length; i++) {
                        bytes[i] = decoded.charCodeAt(i);
                      }
                      return bytes;
                    }
                    const audioBytes = dataUriToBytesLocal(soundItem.dataUri);
                    const streamBlockBody = encodeSoundStreamBlock(audioBytes);
                    writer.writeTag(Tag.SoundStreamBlock, streamBlockBody);
                  }
                } else {
                  const startSoundBody = encodeStartSound(soundId, {
                    loops: frame.sound.repeatCount,
                    stop: frame.sound.syncMode === "stop",
                    noMultiple: frame.sound.syncMode === "start",
                  });
                  writer.writeTag(Tag.StartSound, startSoundBody);
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
      : doc.scenes.reduce((sum, s) => sum + sceneFrameCount(s.timeline), 0);

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
