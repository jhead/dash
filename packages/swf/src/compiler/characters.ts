/**
 * Character-definition helpers for bitmap fills.
 *
 * (The full per-display-object character-definition pass is threaded through
 * CompileContext by the orchestrator; this module currently owns the standalone
 * bitmap-fill emission used by that pass.)
 */
import type { BitmapFill, BitmapItem, FlashDocument, Shape } from "@flash/core";
import { getTweenSpans } from "@flash/core";
import { Tag } from "../tags.js";
import { SwfWriter } from "../writer.js";
import { dataUriToBytes, encodeDefineBitsLossless2, encodeDefineBitsJpeg3, ensureJpegEOI } from "../bitmaps.js";
import { encodeDefineShape4, encodeBitmapFillShape } from "../shapes.js";
import { encodeDefineMorphShape2 } from "../morphshape.js";
import { encodeDefineText, encodeDefineEditText, encodeCSMTextSettings, alignXOffsetTwips } from "../text.js";
import { fontKey } from "../fonts.js";
import { flattenDisplayObjects } from "./display.js";
import type { CompileOptions } from "./options.js";

/** A shape-tween span record used to compute the per-frame morph ratio. */
export interface MorphSpanInfo {
  startFrame: number;
  endFrame: number;
  spanLength: number;
  ease: number;
  easeCurve?: { x1: number; y1: number; x2: number; y2: number } | null;
}

/** Inputs the character-definition pass needs from earlier pre-passes. */
export interface CharacterPassInput {
  writer: SwfWriter;
  doc: FlashDocument;
  options?: CompileOptions;
  fontCharIdMap: Map<string, number>;
  glyphIndexMapForKey: (key: string) => ReadonlyMap<number, number>;
  embedCodePointsByKey: Map<string, number[]>;
}

/** Outputs the frame loop consumes (object → character ID + morph metadata). */
export interface CharacterPassResult {
  /** Display-object id → its DefineShape4/Text/EditText/bitmap-shape char ID. */
  objCharIdMap: Map<string, number>;
  /** Object ids encoded as DefineMorphShape (use ratio-based placement). */
  morphShapeObjIds: Set<string>;
  /** Object id → shape-tween span records (for per-frame ratio computation). */
  morphObjSpanInfo: Map<string, MorphSpanInfo[]>;
}

/**
 * Collect all unique BitmapFill.bitmapId values referenced in a shape's paths.
 */
export function collectBitmapFillIds(shape: Shape): string[] {
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
export function emitBitmapFillTags(
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

/**
 * Character pre-pass: define every display-object character across ALL scenes'
 * timelines (so an object defined in scene 1 can be referenced in scene 2).
 *
 * First a shape-tween sub-pass emits a DefineMorphShape2 (84) per shape-tween
 * span and records ratio metadata; then a general sub-pass emits DefineShape4
 * (83), DefineText (11) / DefineEditText (37) + CSMTextSettings (74), and bitmap
 * DefineBits* (+ a DefineShape4 bitmap-fill wrapper) for every other object.
 *
 * Returns the {objCharIdMap, morphShapeObjIds, morphObjSpanInfo} the frame loop
 * consumes. emittedBitmapFillCharIds is pass-internal (dedup only).
 */
export function runCharacterPass(input: CharacterPassInput): CharacterPassResult {
  const { writer, doc, options, fontCharIdMap, glyphIndexMapForKey, embedCodePointsByKey } = input;

  const objCharIdMap = new Map<string, number>();
  // Map from BitmapFill.bitmapId (library item id) → SWF character ID. Tracks
  // bitmaps already emitted as DefineBits so duplicate references aren't re-emitted.
  const emittedBitmapFillCharIds = new Map<string, number>();
  // morphShapeObjIds: object IDs encoded as DefineMorphShape (ratio placement).
  const morphShapeObjIds = new Set<string>();
  // morphObjSpanInfo: objId → span records used to compute the morph ratio.
  const morphObjSpanInfo = new Map<string, MorphSpanInfo[]>();

  // Shape tween pre-pass: for each layer with shape tween spans, emit
  // DefineMorphShape (tag 46) for each span, then mark all object IDs in
  // that span so the general per-frame pass below skips them.
  for (let si = 0; si < doc.scenes.length; si++) {
    const s = doc.scenes[si];
    for (let li = 0; li < s.timeline.layers.length; li++) {
      const layer = s.timeline.layers[li];
      if (layer.type === "guide") continue;
      if (layer.type === "folder") continue;

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
            // Already emitted — just record span info for endObj.id too
            const morphCharId = objCharIdMap.get(startObj.id)!;
            objCharIdMap.set(endObj.id, morphCharId);
            morphShapeObjIds.add(endObj.id);
          } else {
            const morphCharId = writer.nextCharId();

            // Mark both start and end object IDs (morph char ID)
            objCharIdMap.set(startObj.id, morphCharId);
            objCharIdMap.set(endObj.id, morphCharId);
            morphShapeObjIds.add(startObj.id);
            morphShapeObjIds.add(endObj.id);

            // Emit DefineBits tags for any bitmap fills in the morph shape paths.
            // Both start and end shapes may reference bitmaps; emit once per unique id.
            emitBitmapFillTags(startObj.shape, doc, writer, emittedBitmapFillCharIds, options);
            emitBitmapFillTags(endObj.shape, doc, writer, emittedBitmapFillCharIds, options);

            // Emit DefineMorphShape2 tag (tag 84 — required for Flash 8 to
            // preserve LINESTYLE2 cap/join data via MORPHLINESTYLE2 records).
            const morphBody = encodeDefineMorphShape2(
              morphCharId,
              startObj.shape.paths,
              endObj.shape.paths,
              startKf.shapeHints ?? null,
              endKf.shapeHints ?? null,
              emittedBitmapFillCharIds.size > 0 ? emittedBitmapFillCharIds : undefined
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
          // Also map endObj.id so the end keyframe gets ratio=65535
          const endExisting = morphObjSpanInfo.get(endObj.id) ?? [];
          endExisting.push({
            startFrame: span.startFrame,
            endFrame: span.endFrame,
            spanLength,
            ease: span.ease,
            easeCurve: span.easeCurve,
          });
          morphObjSpanInfo.set(endObj.id, endExisting);
        }
      }
    }
  }

  for (const s of doc.scenes) {
    for (const layer of s.timeline.layers) {
      // Guide layers are authoring-only — skip in SWF pre-pass too
      if (layer.type === "guide") continue;
      if (layer.type === "folder") continue;
      for (const frame of layer.frames) {
        // Do not skip on isEmpty — the flag can be stale; iterate displayObjects directly.
        if (!frame.isKeyframe) continue;
        for (const obj of flattenDisplayObjects(frame.displayObjects)) {
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
            // A static field carrying a hyperlink must render as HTML so the
            // anchor is clickable; glyph-indexed DefineText cannot hold an <a>.
            // Route those through DefineEditText (HTML) instead.
            const hasLink = (obj.linkUrl ?? "").trim().length > 0;
            if (obj.textType === "static" && embeddedFontId !== undefined && !hasLink) {
              // Static text: emit DefineText (tag 11) with glyph-indexed rendering.
              // When "Auto kern" is on, kerning is baked into the per-glyph
              // advances (Flash 8 stores kerned advances directly in DefineText
              // for static text rather than using a runtime KerningTable).
              // The x/y in the TEXTRECORD are the layout offsets within the character;
              // actual stage position is applied via PlaceObject2 as usual.
              const fontSizeTwips = Math.round(obj.fontSize * 20);
              // Use fontSize as the Y baseline offset so glyphs sit above the origin.
              // Glyph-index map for the (possibly subsetted) font so DefineText
              // glyph indices point at the right entries. Only non-default when
              // the user has chosen embed ranges for this font.
              const glyphIndexByCode = embedCodePointsByKey.has(key)
                ? glyphIndexMapForKey(key)
                : undefined;
              // Horizontal alignment within the text box. Flash bakes the start
              // offset of the glyph run into the TEXTRECORD XOffset: centered text
              // starts at (boxWidth - textWidth)/2, right-aligned at
              // (boxWidth - textWidth). Left-aligned stays at 0. The box width is
              // the authored field width (px → twips).
              const xOffsetTwips = alignXOffsetTwips(
                obj.align,
                obj.width,
                obj.text,
                fontSizeTwips,
                obj.autoKern === true
              );
              const textBody = encodeDefineText(
                charId,
                obj.text,
                embeddedFontId,
                fontSizeTwips,
                `#${obj.color.r.toString(16).padStart(2, "0")}${obj.color.g.toString(16).padStart(2, "0")}${obj.color.b.toString(16).padStart(2, "0")}`,
                xOffsetTwips,
                fontSizeTwips,
                obj.autoKern === true,
                glyphIndexByCode
              );
              writer.writeTag(Tag.DefineText, textBody);
            } else {
              // Dynamic/input text (or static without an embedded font): emit DefineEditText (tag 37).
              // Pass the embedded font ID so HasFont is set and Ruffle honours the font SIZE —
              // but UseOutlines is deliberately NOT set, so Ruffle renders with device fonts
              // (real Arial, etc.) rather than our custom embedded glyphs. This gives
              // correctly-sized, legible text that matches MC text behaviour.
              const textBody = encodeDefineEditText(charId, obj, embeddedFontId);
              writer.writeTag(Tag.DefineEditText, textBody);
            }
            // Emit CsmTextSettings (tag 74) immediately after EVERY text definition
            // (both DefineText and DefineEditText). Flash 8 always emits this tag
            // after each text character definition. Matches sprite.ts behaviour.
            // For "readability": UseFlashType=1, GridFit=1, thickness=0, sharpness=0.
            // For "custom": UseFlashType=1, GridFit=1, with user-specified values.
            // For all other modes, emit defaults (UseFlashType=1, GridFit=1, 0, 0).
            {
              const aa = obj.antiAlias;
              if (aa === "custom" && obj.csm) {
                writer.writeTag(Tag.CSMTextSettings, encodeCSMTextSettings(charId, obj.csm.thickness, obj.csm.sharpness));
              } else {
                writer.writeTag(Tag.CSMTextSettings, encodeCSMTextSettings(charId, 0, 0));
              }
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

  return { objCharIdMap, morphShapeObjIds, morphObjSpanInfo };
}
