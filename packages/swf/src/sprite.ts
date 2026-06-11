/**
 * SWF DefineSprite (tag 39) encoding for Symbol library items.
 *
 * A DefineSprite wraps a self-contained timeline of control tags.
 * Structure:
 *   RecordHeader (type=39)
 *   SpriteID: UI16
 *   FrameCount: UI16
 *   ControlTags: sequence of PlaceObject2/ShowFrame/etc., terminated by End (tag 0)
 *
 * SWF spec forbids definition tags (DefineShape4, DefineEditText, etc.) inside
 * a DefineSprite body. All such tags must appear at the top level *before* the
 * DefineSprite tag. Callers should collect hoisted definitions via the
 * `hoistedDefs` out-parameter and emit them before the sprite tag.
 */
import type { BitmapItem, ButtonHandler, ClipAction, DisplayObject, FlashDocument, Symbol, VideoDisplayObject } from "@flash/core";
import { layerFrameCount, compileAS2, getTweenedFrame, getTweenSpans, applyEase } from "@flash/core";
import { BitWriter } from "./bits.js";
import {
  encodeDefineShape4,
  encodeBitmapFillShape,
  encodePlaceObject2,
  encodePlaceObject2Move,
  encodePlaceObject2WithCXForm,
  encodePlaceObject2WithName,
  encodePlaceObject2WithClipActions,
  encodePlaceObject2MoveWithClipActions,
  encodePlaceObject2WithClipDepth,
} from "./shapes.js";
import {
  encodePlaceObject3WithFilters,
  encodePlaceObject3WithBlendMode,
  hasEnabledFilters,
} from "./filters.js";
import { encodeDefineEditText, encodePlaceObject2ForText, encodeCSMTextSettings } from "./text.js";
import { Tag } from "./tags.js";
import { dataUriToBytes, ensureJpegEOI } from "./bitmaps.js";
import { colorEffectToCXForm } from "./cxform.js";
import { fontKey } from "./fonts.js";
import { encodeStartSound, encodeStartSound2 } from "./sounds.js";
import { encodeDefineButton2 } from "./buttons.js";
import { encodeDefineMorphShape2, encodePlaceObject2WithRatio } from "./morphshape.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode a SWF tag record header + body into a Uint8Array.
 * Short form: (type << 6) | length  when length < 63
 * Long form:  (type << 6) | 0x3F, then SI32 length
 */
function encodeTag(tagType: number, body: Uint8Array): Uint8Array {
  const bw = new BitWriter();
  if (body.length < 63) {
    bw.writeUI16LE((tagType << 6) | body.length);
  } else {
    bw.writeUI16LE((tagType << 6) | 0x3f);
    bw.writeSI32LE(body.length);
  }
  bw.writeBytes(body);
  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// flattenDisplayObjects
// ---------------------------------------------------------------------------

/**
 * Recursively expand GroupObject containers into a flat list of non-group
 * DisplayObjects, merging each group's x/y offset into its children.
 * Mirrors the same helper in compile.ts (task 1128).
 */
function flattenDisplayObjects(
  objs: readonly DisplayObject[],
  dx = 0,
  dy = 0
): DisplayObject[] {
  const result: DisplayObject[] = [];
  for (const obj of objs) {
    if (obj.type === "group") {
      result.push(...flattenDisplayObjects(obj.children, dx + obj.x, dy + obj.y));
    } else if (dx !== 0 || dy !== 0) {
      result.push({ ...obj, x: (obj.x ?? 0) + dx, y: (obj.y ?? 0) + dy } as DisplayObject);
    } else {
      result.push(obj);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// videoFitTransform
// ---------------------------------------------------------------------------

/**
 * Compute a fit-transform for a VideoDisplayObject placement.
 * The DefineVideoStream character has the stream's native pixel dimensions, so we
 * scale it to the requested display width/height, then apply the object's own
 * scaleX/scaleY/rotation on top. Returns `undefined` when the resulting
 * transform is the identity (avoids emitting a redundant HasScale/HasRotate).
 */
function videoFitTransform(
  vdo: VideoDisplayObject,
  videoStreams: ReadonlyArray<{ itemId: string; width: number; height: number }>
): { scaleX?: number; scaleY?: number; rotation?: number } | undefined {
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a DefineSprite tag for a Symbol.
 *
 * @param spriteId     SWF character ID for this sprite
 * @param symbol       The Symbol library item to encode
 * @param doc          The full FlashDocument (for resolving nested symbols)
 * @param charIdMap    Map from symbolId → SWF character ID (for nested instances)
 * @param nextCharId   Allocate a new character ID for shapes defined inside this sprite
 * @param hoistedDefs  Out-parameter: definition tags that must be emitted at top level
 *                     *before* this DefineSprite tag (spec forbids definition tags inside sprites)
 * @returns            Raw bytes of the DefineSprite tag *body* (SpriteID + FrameCount + inner tags).
 *                     The caller wraps this with writer.writeTag(Tag.DefineSprite, body).
 */
export function encodeDefineSprite(
  spriteId: number,
  symbol: Symbol,
  doc: FlashDocument,
  charIdMap: Map<string, number>,
  nextCharId: () => number,
  hoistedDefs: Array<{ tagType: number; body: Uint8Array }>,
  /** Maps fontKey(name, bold, italic) → SWF character ID for embedded fonts.
   *  When provided, text objects inside this sprite will have HasFont=1 and
   *  use the authored fontSize (matching the buttons.ts pattern from task 1083). */
  fontCharIdMap?: Map<string, number>,
  /** Maps SoundItem id → SWF character ID. When provided, keyframes with a
   *  non-null `sound` field will emit StartSound (tag 15) tags inside the
   *  sprite body (task 1123). Stream-mode sounds are skipped (need
   *  SoundStreamHead/Block — out of scope). */
  soundIdMap?: Map<string, number>,
  /** Maps VideoItem id → SWF character ID for video streams. Needed for
   *  VideoDisplayObject placement inside symbol timelines. */
  videoCharIdMap?: Map<string, number>,
  /** Video stream info (dimensions) for computing fit-transform for video objects. */
  videoStreams?: ReadonlyArray<{ itemId: string; width: number; height: number }>
): Uint8Array {
  const timeline = symbol.timeline;
  const layers = timeline.layers;

  // Bug 1 fix: use layerFrameCount() instead of layer.frames.length so that
  // sparse keyframe arrays (e.g. keyframes at 0 and 9) yield 10 frames, not 2.
  let maxFrames = 1;
  for (const layer of layers) {
    const count = layerFrameCount(layer);
    if (count > maxFrames) maxFrames = count;
  }

  // Bug 2 fix: define each character once (hoisted) and track display-list
  // state to emit PlaceObject2/Move/RemoveObject2 correctly across frames.
  //
  // Map from display-object id → stable SWF character ID
  const objCharIdMap = new Map<string, number>();

  // Morph-shape tracking: ids of objects encoded as DefineMorphShape2
  const morphShapeObjIds = new Set<string>();
  const morphObjSpanInfo = new Map<string, Array<{
    startFrame: number;
    endFrame: number;
    spanLength: number;
    ease: number;
    easeCurve?: { x1: number; y1: number; x2: number; y2: number } | null;
  }>>();

  // Shape-tween pre-pass: emit DefineMorphShape2 for each shape-tween span.
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    if (layer.type === "guide" || layer.type === "folder") continue;

    const spans = getTweenSpans(layer);
    for (const span of spans) {
      if (span.tweenType !== "shape") continue;

      const startKf = layer.frames.find((f) => f.isKeyframe && f.index === span.startFrame);
      const endKf = layer.frames.find((f) => f.isKeyframe && f.index === span.endFrame + 1);
      if (!startKf || !endKf) continue;
      if (startKf.displayObjects.length === 0) continue;

      for (let oi = 0; oi < startKf.displayObjects.length; oi++) {
        const startObj = startKf.displayObjects[oi];
        if (startObj.type !== "shape" && startObj.type !== "drawing-object") continue;
        const endObj = endKf.displayObjects[oi];
        if (!endObj || (endObj.type !== "shape" && endObj.type !== "drawing-object")) continue;

        if (!objCharIdMap.has(startObj.id)) {
          const morphCharId = nextCharId();
          objCharIdMap.set(startObj.id, morphCharId);
          morphShapeObjIds.add(startObj.id);
          const morphBody = encodeDefineMorphShape2(
            morphCharId,
            startObj.shape.paths,
            endObj.shape.paths,
            startKf.shapeHints ?? null,
            endKf.shapeHints ?? null,
            undefined
          );
          hoistedDefs.push({ tagType: Tag.DefineMorphShape2, body: morphBody });
        }

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

  // Pre-pass: assign character IDs and collect hoisted definition tags.
  // All DefineShape4 / DefineEditText tags are emitted at the top level
  // (Bug 3 fix) via hoistedDefs — never inside the sprite body.
  for (const layer of layers) {
    // Task 1125: skip guide and folder layers — guide layer content is
    // motion-guide artwork (not rendered), folder layers are grouping-only.
    // 'guided' layers (the actual animated layers beneath a guide) are kept.
    if (layer.type === "guide" || layer.type === "folder") continue;
    for (const frame of layer.frames) {
      // Do not skip on isEmpty — the flag can be stale; iterate displayObjects directly.
      if (!frame.isKeyframe) continue;
      for (const obj of flattenDisplayObjects(frame.displayObjects)) {
        if (objCharIdMap.has(obj.id)) continue;
        if (obj.type === "shape" || obj.type === "drawing-object") {
          const charId = nextCharId();
          objCharIdMap.set(obj.id, charId);
          // Hoist DefineShape4 to top level (Bug 3)
          hoistedDefs.push({ tagType: Tag.DefineShape4, body: encodeDefineShape4(charId, obj.shape) });
        } else if (obj.type === "text") {
          const charId = nextCharId();
          objCharIdMap.set(obj.id, charId);
          // Hoist DefineEditText to top level (Bug 3)
          // Task 1119 fix: look up font char ID so HasFont=1 and authored fontSize is honoured.
          const embeddedFontId = fontCharIdMap?.get(fontKey(obj.fontFamily, obj.bold, obj.italic));
          hoistedDefs.push({ tagType: Tag.DefineEditText, body: encodeDefineEditText(charId, obj, embeddedFontId) });
          const aa = (obj as { antiAlias?: string }).antiAlias;
          if (aa === 'readability') {
            hoistedDefs.push({ tagType: Tag.CSMTextSettings, body: encodeCSMTextSettings(charId, 0, 0) });
          } else if (aa === 'custom') {
            const csm = (obj as { csm?: { thickness: number; sharpness: number } }).csm;
            if (csm) {
              hoistedDefs.push({ tagType: Tag.CSMTextSettings, body: encodeCSMTextSettings(charId, csm.thickness, csm.sharpness) });
            }
          }
        } else if (obj.type === "bitmap") {
          // Look up the BitmapItem from the library
          const bitmapItem = doc.library.items.find(
            (item): item is BitmapItem =>
              item.itemType === "bitmap" && item.id === obj.libraryItemId
          );
          if (bitmapItem && bitmapItem.dataUri) {
            const imageBytes = ensureJpegEOI(dataUriToBytes(bitmapItem.dataUri));
            if (imageBytes.length > 0) {
              // Hoist DefineBitsJPEG2 to top level
              const bitmapCharId = nextCharId();
              const imgPayload = new Uint8Array(2 + imageBytes.length);
              imgPayload[0] = bitmapCharId & 0xff;
              imgPayload[1] = (bitmapCharId >> 8) & 0xff;
              imgPayload.set(imageBytes, 2);
              hoistedDefs.push({ tagType: Tag.DefineBitsJPEG2, body: imgPayload });

              // Hoist DefineShape4 (bitmap fill shape) to top level
              const shapeCharId = nextCharId();
              objCharIdMap.set(obj.id, shapeCharId);
              hoistedDefs.push({
                tagType: Tag.DefineShape4,
                body: encodeBitmapFillShape(
                  shapeCharId,
                  bitmapCharId,
                  obj.width,
                  obj.height,
                  bitmapItem.allowSmoothing
                ),
              });
            } else {
              // Empty data — assign char ID without emitting
              const shapeCharId = nextCharId();
              objCharIdMap.set(obj.id, shapeCharId);
            }
          } else {
            // No BitmapItem or no data
            const shapeCharId = nextCharId();
            objCharIdMap.set(obj.id, shapeCharId);
          }
        }
        // instance: no character definition needed here (uses charIdMap)
      }
    }
  }

  // Per-layer object→depth assignment
  const layerObjDepth = new Map<string, number>(); // key = `${layerIdx}:${objId}`
  let nextDepth = 1;

  function getOrAssignDepth(layerIdx: number, objId: string): number {
    const key = `${layerIdx}:${objId}`;
    let depth = layerObjDepth.get(key);
    if (depth === undefined) {
      depth = nextDepth++;
      layerObjDepth.set(key, depth);
    }
    return depth;
  }

  // Identify which layer indices are "masked" (belong to a mask group).
  // Used both in the depth pre-pass and in the frame loop.
  const isMaskedLi = new Set<number>();
  for (let li = 0; li < layers.length; li++) {
    if (layers[li]!.type === "mask") {
      for (let mli = li + 1; mli < layers.length; mli++) {
        if (layers[mli]!.type !== "masked") break;
        isMaskedLi.add(mli);
      }
    }
  }

  // Bug 1101 fix: pre-pass to seed depth assignments in correct visual order.
  // Iterate from li=layers.length-1 (background/bottommost) down to li=0 (foreground/topmost).
  // This ensures background layers get lower depths (rendered behind) and foreground
  // layers get higher depths (rendered in front), matching compile.ts lines ~1327-1346.
  //
  // Task 1126 fix: mask groups need special ordering — the mask layer must get a
  // LOWER depth than its masked children (SWF constraint: mask at depth D clips
  // D+1..clipDepth). Within each mask group we assign the mask first (lower depth)
  // then the masked layers (higher depths), even though the mask is visually above
  // the masked layers. Mirror compile.ts lines ~1353-1403.
  const registerLayerDepths = (li: number) => {
    for (const frame of layers[li]!.frames) {
      if (!frame.isKeyframe) continue;
      for (const obj of flattenDisplayObjects(frame.displayObjects)) {
        getOrAssignDepth(li, obj.id);
      }
    }
  };

  for (let li = layers.length - 1; li >= 0; li--) {
    const layer = layers[li]!;
    // Skip guide and folder layers
    if (layer.type === "guide" || layer.type === "folder") continue;
    // Skip masked layers — they are handled when their owning mask is encountered
    if (isMaskedLi.has(li)) continue;

    registerLayerDepths(li);

    // Immediately after registering a mask layer, register its consecutive
    // masked children. This ensures the mask gets a LOWER depth than the
    // masked layers it clips.
    if (layer.type === "mask") {
      for (let mli = li + 1; mli < layers.length; mli++) {
        if (layers[mli]!.type !== "masked") break;
        registerLayerDepths(mli);
      }
    }
  }

  // Per-depth display-list state (last placed objId and position)
  // Bug 1102 fix: track scaleX/scaleY/rotation/skewX/skewY and colorEffectKey.
  interface DepthState {
    objId: string;
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    skewX: number;
    skewY: number;
    colorEffectKey: string | null;
    morphRatio: number;
  }
  const depthState = new Map<number, DepthState>();

  // Collect all sprite body bytes: only control tags per frame
  const spriteTags: Uint8Array[] = [];

  for (let frameIdx = 0; frameIdx < maxFrames; frameIdx++) {
    // Collect what should be on screen this frame
    // Bug 1100 fix: use getTweenedFrame (not findGoverningKeyframe) so tween
    // interpolation is applied for each frame within a motion-tween span.
    // Task 1126: also track layerIdx so mask layers can be identified.
    const thisFrameDepths = new Map<number, { objId: string; displayObj: import("@flash/core").DisplayObject; layerIdx: number }>();
    const letterSpacingActions: string[] = [];
    const restrictActions: string[] = [];
    const tabOrderActions: string[] = [];

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      // Task 1125: skip guide and folder layers — guide layer artwork is invisible;
      // folder layers are organisational groupings with no display content.
      if (layer.type === "guide" || layer.type === "folder") continue;
      const keyframe = getTweenedFrame(layer, frameIdx, timeline);
      // Do not skip on isEmpty — the flag can be stale; use actual displayObjects length.
      if (!keyframe || keyframe.displayObjects.length === 0) continue;

      for (const obj of flattenDisplayObjects(keyframe.displayObjects)) {
        const depth = getOrAssignDepth(li, obj.id);
        thisFrameDepths.set(depth, { objId: obj.id, displayObj: obj, layerIdx: li });
      }
    }

    // Task 1126: compute clipDepth for each mask layer.
    // For mask layer at li, clipDepth = max depth among objects on consecutive
    // 'masked' layers immediately following it (li+1, li+2, …).
    const maskClipDepths = new Map<number, number>();
    for (let li = 0; li < layers.length; li++) {
      if (layers[li]!.type !== "mask") continue;
      let maxDepth = 0;
      for (let mli = li + 1; mli < layers.length; mli++) {
        const ml = layers[mli]!;
        if (ml.type !== "masked") break;
        const mFrame = getTweenedFrame(ml, frameIdx, timeline);
        if (!mFrame || mFrame.displayObjects.length === 0) continue;
        for (const obj of flattenDisplayObjects(mFrame.displayObjects)) {
          const d = getOrAssignDepth(mli, obj.id);
          if (d > maxDepth) maxDepth = d;
        }
      }
      if (maxDepth > 0) {
        maskClipDepths.set(li, maxDepth);
      }
    }

    // Emit RemoveObject2 for depths no longer occupied
    for (const [depth] of depthState) {
      if (!thisFrameDepths.has(depth)) {
        const bw = new BitWriter();
        bw.writeUI16LE(depth);
        spriteTags.push(encodeTag(Tag.RemoveObject2, bw.getBytes()));
        depthState.delete(depth);
      }
    }

    // Emit PlaceObject2 / PlaceObject2+Move for each object this frame
    for (const [depth, { objId, displayObj, layerIdx }] of thisFrameDepths) {
      // Task 1126: determine if this object is on a mask layer (HasClipDepth)
      const clipDepth = maskClipDepths.get(layerIdx);
      // Bug 1102 fix: extract full transform from the (possibly tweened) display object
      let x = 0;
      let y = 0;
      let scaleX = 1;
      let scaleY = 1;
      let rotation = 0;
      let skewX = 0;
      let skewY = 0;
      if ("x" in displayObj) x = (displayObj as { x: number }).x ?? 0;
      if ("y" in displayObj) y = (displayObj as { y: number }).y ?? 0;
      if ("scaleX" in displayObj) scaleX = (displayObj as { scaleX: number }).scaleX ?? 1;
      if ("scaleY" in displayObj) scaleY = (displayObj as { scaleY: number }).scaleY ?? 1;
      if ("rotation" in displayObj) rotation = (displayObj as { rotation: number }).rotation ?? 0;
      if ("skewX" in displayObj) skewX = (displayObj as { skewX: number }).skewX ?? 0;
      if ("skewY" in displayObj) skewY = (displayObj as { skewY: number }).skewY ?? 0;

      // Apply registrationPoint offset for symbol instances (matches compile.ts)
      if (displayObj.type === "instance") {
        const inst = displayObj as import("@flash/core").SymbolInstance;
        if (inst.registrationPoint) {
          x -= inst.registrationPoint.x;
          y -= inst.registrationPoint.y;
        }
      }

      // Bug 1103 fix: compute colorEffectKey for change detection
      const thisColorEffectKey = (() => {
        if (
          (displayObj.type === "instance" || displayObj.type === "text" || displayObj.type === "bitmap") &&
          (displayObj as { visible?: boolean }).visible === false
        ) {
          return "visible:false";
        }
        if (displayObj.type !== "instance" && displayObj.type !== "text" && displayObj.type !== "bitmap") return null;
        const ce = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect;
        if (ce && ce.type !== "none") return JSON.stringify(ce);
        return null;
      })();

      const prev = depthState.get(depth);

      // Compute morph ratio for shape-tween objects
      let morphRatio = -1;
      if (morphShapeObjIds.has(objId)) {
        const spanInfoList = morphObjSpanInfo.get(objId);
        if (spanInfoList) {
          for (const spanInfo of spanInfoList) {
            if (frameIdx >= spanInfo.startFrame && frameIdx <= spanInfo.endFrame) {
              const spanLen = spanInfo.endFrame - spanInfo.startFrame + 1;
              const frameOffset = frameIdx - spanInfo.startFrame;
              const linearT = spanLen <= 1 ? 0 : frameOffset / (spanLen - 1);
              const easedT = applyEase(linearT, spanInfo.ease, spanInfo.easeCurve);
              morphRatio = Math.round(easedT * 65535);
              break;
            }
          }
          if (morphRatio === -1) morphRatio = 65535;
        }
      }

      const isFirst = !prev;
      // Bug 1102 fix: posChanged now includes all transform components + colorEffectKey
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
          prev.colorEffectKey !== thisColorEffectKey ||
          prev.morphRatio !== morphRatio);

      if (!isFirst && !posChanged) {
        // Unchanged — emit nothing
        depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, skewX, skewY, colorEffectKey: thisColorEffectKey, morphRatio });
        continue;
      }

      if (isFirst) {
        if (displayObj.type === "shape" || displayObj.type === "drawing-object") {
          const charId = objCharIdMap.get(objId)!;
          const objTransform = displayObj.type === "shape" ? {
            scaleX: displayObj.scaleX,
            scaleY: displayObj.scaleY,
            rotation: displayObj.rotation,
          } : undefined;
          if (morphRatio >= 0) {
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithRatio(charId, depth, x, y, morphRatio, false)));
          } else if (clipDepth !== undefined) {
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithClipDepth(charId, depth, x, y, clipDepth, objTransform)));
          } else if (displayObj.type === "shape" && displayObj.visible === false) {
            const zeroCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(charId, depth, x, y, zeroCXForm, objTransform)));
          } else if (hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
            let shapeCXForm = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
              ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect) ?? undefined
              : undefined;
            if (!shapeCXForm && displayObj.type === "shape" && (displayObj as { alpha?: number }).alpha !== undefined && (displayObj as { alpha: number }).alpha !== 1) {
              shapeCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: Math.round(Math.max(0, Math.min(1, (displayObj as { alpha: number }).alpha)) * 256), redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            }
            const placeBody = encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!, objTransform, undefined, undefined, undefined, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap, shapeCXForm);
            spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
          } else if (displayObj.type === "shape" && !!(displayObj as { blendMode?: string }).blendMode && (displayObj as { blendMode: string }).blendMode !== "normal") {
            // Bug 1139 fix: blend mode on first placement requires PlaceObject3
            const placeBody = encodePlaceObject3WithBlendMode(charId, depth, x, y, (displayObj as { blendMode: string }).blendMode, (displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters, objTransform, undefined, undefined, false, undefined, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap);
            spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
          } else {
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2(charId, depth, x, y, objTransform)));
          }
        } else if (displayObj.type === "text") {
          const charId = objCharIdMap.get(objId)!;
          // Task 1110 fix: filters require PlaceObject3
          if (hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
            const textName = (displayObj as { instanceName?: string }).instanceName;
            let textFilterCXForm = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
              ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect) ?? undefined
              : undefined;
            if (!textFilterCXForm && (displayObj as { visible?: boolean }).visible === false) {
              textFilterCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            }
            const placeBody = encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!, undefined, textName && textName.length > 0 ? textName : undefined, undefined, undefined, undefined, textFilterCXForm);
            spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
          } else {
            // Bug 1103 fix: encode colorEffect / visible=false
            const textName = (displayObj as { instanceName?: string }).instanceName;
            let cxform = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
              ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect)
              : null;
            if (cxform === null && (displayObj as { visible?: boolean }).visible === false) {
              cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            }
            if (cxform !== null) {
              // Task 1157 fix: carry instanceName in CXForm path
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(charId, depth, x, y, cxform, undefined, false, textName && textName.length > 0 ? textName : undefined)));
            } else {
              // Task 1157 fix: carry instanceName so AS2 paths like myMc.myField.text resolve
              const placeBody = textName && textName.length > 0
                ? encodePlaceObject2WithName(charId, depth, x, y, textName)
                : encodePlaceObject2ForText(charId, depth, x, y);
              spriteTags.push(encodeTag(Tag.PlaceObject2, placeBody));
            }
          }
          // Collect letterSpacing DoAction for text fields with non-zero spacing
          {
            const textName = (displayObj as { instanceName?: string }).instanceName;
            const ls = (displayObj as { letterSpacing?: number }).letterSpacing;
            if (ls != null && ls !== 0 && textName && textName.length > 0) {
              letterSpacingActions.push(
                `var _tf=new TextFormat();_tf.letterSpacing=${ls};this.${textName}.setTextFormat(_tf);`
              );
            }
            // Collect restrict DoAction for input text fields
            const restrict = (displayObj as { restrict?: string }).restrict;
            if (restrict != null && restrict.length > 0 && textName && textName.length > 0) {
              const escaped = restrict.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
              restrictActions.push(`this.${textName}.restrict = "${escaped}";`);
            }
          }
        } else if (displayObj.type === "bitmap") {
          const charId = objCharIdMap.get(objId);
          if (charId !== undefined) {
            // Task 1110 fix: blendMode or filters require PlaceObject3
            const hasBlend = !!(displayObj as { blendMode?: string }).blendMode && (displayObj as { blendMode: string }).blendMode !== "normal";
            if (hasBlend || hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
              const bmpCXForm = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
                ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect) ?? undefined
                : undefined;
              const placeBody = hasBlend
                ? encodePlaceObject3WithBlendMode(charId, depth, x, y, (displayObj as { blendMode: string }).blendMode, (displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters, undefined, undefined, bmpCXForm, undefined, undefined, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap)
                : encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!, undefined, undefined, undefined, undefined, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap, bmpCXForm);
              spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
            } else {
              // Bug 1103 fix: encode colorEffect / visible=false
              const isHidden = (displayObj as { visible?: boolean }).visible === false;
              let cxform = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
                ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect)
                : null;
              if (cxform === null && isHidden) {
                cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
              }
              if (cxform !== null) {
                spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(charId, depth, x, y, cxform)));
              } else {
                spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2(charId, depth, x, y)));
              }
            }
          }
        } else if (displayObj.type === "video") {
          if (videoCharIdMap) {
            const vdo = displayObj as VideoDisplayObject;
            const charId = videoCharIdMap.get(vdo.videoItemId);
            if (charId !== undefined) {
              const transform = videoFitTransform(vdo, videoStreams ?? []);
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2(charId, depth, x, y, transform)));
            }
          }
        } else if (displayObj.type === "instance") {
          let refCharId = charIdMap.get(displayObj.symbolId);
          if (refCharId !== undefined) {
            // Button instances with instance-level on() handlers need a unique DefineButton2 character.
            const hasButtonHandlers = !!(displayObj as { buttonHandlers?: ButtonHandler[] }).buttonHandlers?.length;
            if (hasButtonHandlers) {
              const sym = doc.library.items.find(item => item.itemType === "symbol" && item.id === displayObj.symbolId) as Symbol | undefined;
              if (sym && sym.symbolType === "button") {
                const instCharId = nextCharId();
                const instHoisted: Array<{ tagType: number; body: Uint8Array }> = [];
                const buttonBody = encodeDefineButton2(
                  instCharId,
                  sym,
                  doc,
                  charIdMap,
                  nextCharId,
                  instHoisted,
                  (displayObj as { buttonHandlers: readonly ButtonHandler[] }).buttonHandlers,
                  (displayObj as { trackAsMenu?: boolean }).trackAsMenu,
                  fontCharIdMap
                );
                for (const def of instHoisted) {
                  hoistedDefs.push(def);
                }
                hoistedDefs.push({ tagType: Tag.DefineButton2, body: buttonBody });
                refCharId = instCharId;
              }
            }
            const instanceTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
              ? { scaleX, scaleY, rotation, skewX, skewY }
              : undefined;
            const instName = (displayObj as { instanceName?: string }).instanceName ?? undefined;

            // Task 1124: synthesize clip actions for loopMode / firstFrame / explicit clipActions
            const loopMode = (displayObj as { loopMode?: string }).loopMode ?? "loop";
            const instanceFirstFrame = (displayObj as { firstFrame?: number }).firstFrame ?? 0;
            let effectiveClipActions: ClipAction[] = (displayObj as { clipActions?: ClipAction[] }).clipActions ?? [];
            if (loopMode === "play-once") {
              effectiveClipActions = [...effectiveClipActions, {
                event: "enterFrame",
                script: "if (this._currentframe >= this._totalframes) { this.stop(); }",
              }];
            }
            if (loopMode === "single-frame") {
              effectiveClipActions = [...effectiveClipActions, {
                event: "load",
                script: `this.gotoAndStop(${instanceFirstFrame + 1});`,
              }];
            }
            if ((loopMode === "loop" || loopMode === "play-once") && instanceFirstFrame > 0) {
              effectiveClipActions = [...effectiveClipActions, {
                event: "load",
                script: `this.gotoAndPlay(${instanceFirstFrame + 1});`,
              }];
            }
            const hasClipActions = effectiveClipActions.length > 0;

            // Task 1126: mask layer — place instance with HasClipDepth
            if (clipDepth !== undefined) {
              const placeBody = encodePlaceObject2WithClipDepth(refCharId, depth, x, y, clipDepth, instanceTransform);
              spriteTags.push(encodeTag(Tag.PlaceObject2, placeBody));
            } else {
            // Bug 1103 fix: encode colorEffect / visible=false / filters / blend mode
            const hasBlend = !!(displayObj as { blendMode?: string }).blendMode && (displayObj as { blendMode: string }).blendMode !== "normal";
            if (hasBlend || hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
              const instCXForm = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
                ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect) ?? undefined
                : undefined;
              const placeBody = hasBlend
                ? encodePlaceObject3WithBlendMode(refCharId, depth, x, y, (displayObj as { blendMode: string }).blendMode, (displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters, instanceTransform, undefined, instCXForm, undefined, instName, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap)
                : encodePlaceObject3WithFilters(refCharId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!, instanceTransform, instName, undefined, undefined, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap, instCXForm);
              spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
              // Attach clip actions as a PlaceObject2 Move on the same depth (matches compile.ts pattern)
              if (hasClipActions) {
                spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2MoveWithClipActions(depth, effectiveClipActions)));
              }
            } else if (hasClipActions) {
              // Task 1124: place with HasClipActions via PlaceObject2
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithClipActions(refCharId, depth, x, y, effectiveClipActions, instanceTransform, instName)));
            } else {
              let cxform = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
                ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect)
                : null;
              if (cxform === null && (displayObj as { visible?: boolean }).visible === false) {
                cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
              }
              if (cxform !== null) {
                spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(refCharId, depth, x, y, cxform, instanceTransform, false, instName)));
              } else if (instName) {
                spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithName(refCharId, depth, x, y, instName, instanceTransform)));
              } else {
                spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2(refCharId, depth, x, y, instanceTransform)));
              }
            }
            }
          }
          // Collect tab-order DoAction for instances with accessibility.tabIndex
          {
            const instName = (displayObj as { instanceName?: string }).instanceName;
            const acc = (displayObj as { accessibility?: { tabIndex?: number; enabled?: boolean } }).accessibility;
            if (instName && instName.length > 0 && acc?.tabIndex != null) {
              const tabEnabled = acc.enabled !== false;
              tabOrderActions.push(
                `this.${instName}.tabEnabled = ${tabEnabled};this.${instName}.tabIndex = ${acc.tabIndex};`
              );
            }
          }
        }
      } else {
        // posChanged — emit with PlaceFlagMove
        const replaceChar = prev!.objId !== objId;
        if (displayObj.type === "shape" || displayObj.type === "drawing-object") {
          const charId = objCharIdMap.get(objId)!;
          const objTransform = displayObj.type === "shape" ? {
            scaleX: displayObj.scaleX,
            scaleY: displayObj.scaleY,
            rotation: displayObj.rotation,
          } : undefined;
          // Bug 1103 fix: encode colorEffect / visible=false / filters / blend on move
          const hasShapeBlend = displayObj.type === "shape" && !!(displayObj as { blendMode?: string }).blendMode && (displayObj as { blendMode: string }).blendMode !== "normal";
          if (morphRatio >= 0) {
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithRatio(charId, depth, x, y, morphRatio, true)));
          } else if (hasShapeBlend) {
            // Blend mode requires PlaceObject3 with move=true to preserve blend mode across moves
            const placeBody = encodePlaceObject3WithBlendMode(charId, depth, x, y, (displayObj as { blendMode: string }).blendMode, (displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters, objTransform, undefined, undefined, true, undefined, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap);
            spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
          } else if (displayObj.type === "shape" && displayObj.visible === false) {
            const zeroCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(charId, depth, x, y, zeroCXForm, objTransform, true)));
          } else if (hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
            let shapeMoveCXForm = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
              ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect) ?? undefined
              : undefined;
            if (!shapeMoveCXForm && displayObj.type === "shape" && (displayObj as { alpha?: number }).alpha !== undefined && (displayObj as { alpha: number }).alpha !== 1) {
              shapeMoveCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: Math.round(Math.max(0, Math.min(1, (displayObj as { alpha: number }).alpha)) * 256), redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            }
            const placeBody = encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!, objTransform, undefined, undefined, true, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap, shapeMoveCXForm);
            spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
          } else {
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2Move(charId, depth, x, y, objTransform, replaceChar)));
          }
        } else if (displayObj.type === "text") {
          const charId = objCharIdMap.get(objId)!;
          // Task 1110 fix: filters require PlaceObject3 on move too
          if (hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
            const textName = (displayObj as { instanceName?: string }).instanceName;
            let textMoveCXForm = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
              ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect) ?? undefined
              : undefined;
            if (!textMoveCXForm && (displayObj as { visible?: boolean }).visible === false) {
              textMoveCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            }
            const placeBody = encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!, undefined, textName && textName.length > 0 ? textName : undefined, undefined, true, undefined, textMoveCXForm);
            spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
          } else {
            // Task 1157 fix: carry instanceName in move paths too
            const textMoveName = (displayObj as { instanceName?: string }).instanceName;
            let cxform = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
              ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect)
              : null;
            if (cxform === null && (displayObj as { visible?: boolean }).visible === false) {
              cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            }
            if (cxform !== null) {
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(charId, depth, x, y, cxform, undefined, true, textMoveName && textMoveName.length > 0 ? textMoveName : undefined)));
            } else {
              const placeBody = textMoveName && textMoveName.length > 0
                ? encodePlaceObject2WithName(charId, depth, x, y, textMoveName)
                : encodePlaceObject2Move(charId, depth, x, y, undefined, replaceChar);
              spriteTags.push(encodeTag(Tag.PlaceObject2, placeBody));
            }
          }
        } else if (displayObj.type === "bitmap") {
          const charId = objCharIdMap.get(objId);
          if (charId !== undefined) {
            // Task 1110 fix: blendMode or filters require PlaceObject3 on move too
            const hasBlend = !!(displayObj as { blendMode?: string }).blendMode && (displayObj as { blendMode: string }).blendMode !== "normal";
            if (hasBlend || hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
              const bmpCXForm = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
                ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect) ?? undefined
                : undefined;
              const placeBody = hasBlend
                ? encodePlaceObject3WithBlendMode(charId, depth, x, y, (displayObj as { blendMode: string }).blendMode, (displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters, undefined, undefined, bmpCXForm, true, undefined, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap)
                : encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!, undefined, undefined, undefined, true, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap, bmpCXForm);
              spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
            } else {
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2Move(charId, depth, x, y, undefined, replaceChar)));
            }
          }
        } else if (displayObj.type === "instance") {
          const refCharId = charIdMap.get(displayObj.symbolId);
          if (refCharId !== undefined) {
            const instanceTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
              ? { scaleX, scaleY, rotation, skewX, skewY }
              : undefined;
            const instName = (displayObj as { instanceName?: string }).instanceName ?? undefined;

            // Task 1124: synthesize clip actions for loopMode / firstFrame / explicit clipActions (move path)
            const loopModeMove = (displayObj as { loopMode?: string }).loopMode ?? "loop";
            const instanceFirstFrameMove = (displayObj as { firstFrame?: number }).firstFrame ?? 0;
            let effectiveMoveClipActions: ClipAction[] = (displayObj as { clipActions?: ClipAction[] }).clipActions ?? [];
            if (loopModeMove === "play-once") {
              effectiveMoveClipActions = [...effectiveMoveClipActions, {
                event: "enterFrame",
                script: "if (this._currentframe >= this._totalframes) { this.stop(); }",
              }];
            }
            if (loopModeMove === "single-frame") {
              effectiveMoveClipActions = [...effectiveMoveClipActions, {
                event: "load",
                script: `this.gotoAndStop(${instanceFirstFrameMove + 1});`,
              }];
            }
            if ((loopModeMove === "loop" || loopModeMove === "play-once") && instanceFirstFrameMove > 0) {
              effectiveMoveClipActions = [...effectiveMoveClipActions, {
                event: "load",
                script: `this.gotoAndPlay(${instanceFirstFrameMove + 1});`,
              }];
            }
            const hasMoveClipActions = effectiveMoveClipActions.length > 0;

            // Bug 1103 fix: encode colorEffect / visible=false on move
            const hasBlend = !!(displayObj as { blendMode?: string }).blendMode && (displayObj as { blendMode: string }).blendMode !== "normal";
            if (hasBlend || hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
              const instCXForm = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
                ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect) ?? undefined
                : undefined;
              const placeBody = hasBlend
                ? encodePlaceObject3WithBlendMode(refCharId, depth, x, y, (displayObj as { blendMode: string }).blendMode, (displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters, instanceTransform, undefined, instCXForm, true, instName, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap)
                : encodePlaceObject3WithFilters(refCharId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!, instanceTransform, instName, undefined, true, !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap, instCXForm);
              spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
              // Attach clip actions as a PlaceObject2 Move on the same depth (matches compile.ts pattern)
              if (hasMoveClipActions) {
                spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2MoveWithClipActions(depth, effectiveMoveClipActions)));
              }
            } else if (hasMoveClipActions) {
              // Task 1124: move with HasClipActions via PlaceObject2 Move
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2MoveWithClipActions(depth, effectiveMoveClipActions)));
            } else {
              let cxform = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
                ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect)
                : null;
              if (cxform === null && (displayObj as { visible?: boolean }).visible === false) {
                cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
              }
              if (cxform !== null) {
                spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(refCharId, depth, x, y, cxform, instanceTransform, true, instName)));
              } else {
                spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2Move(refCharId, depth, x, y, instanceTransform, replaceChar)));
              }
            }
          }
        } else if (displayObj.type === "video") {
          if (videoCharIdMap) {
            const vdo = displayObj as VideoDisplayObject;
            const charId = videoCharIdMap.get(vdo.videoItemId);
            if (charId !== undefined) {
              const transform = videoFitTransform(vdo, videoStreams ?? []);
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2Move(charId, depth, x, y, transform, replaceChar)));
            }
          }
        }
      }

      depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, skewX, skewY, colorEffectKey: thisColorEffectKey, morphRatio });
    }

    // Emit FrameLabel (tag 43) if any keyframe at this frame index has a label
    let frameLabel: string | null = null;
    let frameLabelType: string = "name";
    outerLabel: for (const layer of layers) {
      if (layer.type === "guide" || layer.type === "folder") continue;
      for (const frame of layer.frames) {
        if (frame.index === frameIdx && frame.isKeyframe && frame.label) {
          frameLabel = frame.label;
          frameLabelType = frame.labelType;
          break outerLabel;
        }
      }
    }
    if (frameLabel) {
      const bw = new BitWriter();
      bw.writeString(frameLabel);
      if (frameLabelType === "anchor") bw.writeUI8(1);
      spriteTags.push(encodeTag(Tag.FrameLabel, bw.getBytes()));
    }

    // Emit DoAction for any keyframes with scripts at exactly this frame index
    // DoAction must appear BEFORE ShowFrame so actions execute on frame entry
    for (const layer of layers) {
      if (layer.type === "guide" || layer.type === "folder") continue;
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
            spriteTags.push(encodeTag(Tag.DoAction, doActionBody));
          }
        }
      }
    }

    // Emit StartSound (tag 15) for any keyframes at this frame index that have
    // a non-stream sound reference (task 1123).
    // Mirror the main-timeline pattern in compile.ts; skip stream-mode sounds
    // (those require SoundStreamHead/Block — out of scope here).
    if (soundIdMap) {
      for (const layer of layers) {
        if (layer.type === "guide" || layer.type === "folder") continue;
        for (const frame of layer.frames) {
          if (
            frame.isKeyframe &&
            frame.index === frameIdx &&
            frame.sound !== null &&
            frame.sound.syncMode !== "stream"
          ) {
            const soundId = soundIdMap.get(frame.sound.libraryItemId);
            if (soundId !== undefined) {
              const soundInfoOpts = {
                loops: frame.sound.repeatCount,
                stop: frame.sound.syncMode === "stop",
                noMultiple: frame.sound.syncMode === "start",
                effect: frame.sound.customEnvelope ? undefined : frame.sound.effect,
                envelope: frame.sound.customEnvelope,
                inPoint: frame.sound.inPoint,
                outPoint: frame.sound.outPoint,
              };
              // Use StartSound2 (by class name) when the sound has an AS2 linkage identifier
              const soundItem = doc.library.items.find(
                item => item.itemType === "sound" && item.id === frame.sound!.libraryItemId
              ) as import("@flash/core").SoundItem | undefined;
              if (soundItem?.linkageIdentifier) {
                spriteTags.push(encodeTag(Tag.StartSound2, encodeStartSound2(soundItem.linkageIdentifier, soundInfoOpts)));
              } else {
                spriteTags.push(encodeTag(Tag.StartSound, encodeStartSound(soundId, soundInfoOpts)));
              }
            }
          }
        }
      }
    }

    // Emit letterSpacing DoActions
    for (const script of letterSpacingActions) {
      const actionBytes = compileAS2(script);
      if (actionBytes.length > 0) {
        const doActionBody = new Uint8Array(actionBytes.length + 1);
        doActionBody.set(actionBytes);
        spriteTags.push(encodeTag(Tag.DoAction, doActionBody));
      }
    }
    // Emit restrict DoActions
    for (const script of restrictActions) {
      const actionBytes = compileAS2(script);
      if (actionBytes.length > 0) {
        const doActionBody = new Uint8Array(actionBytes.length + 1);
        doActionBody.set(actionBytes);
        spriteTags.push(encodeTag(Tag.DoAction, doActionBody));
      }
    }
    // Emit tabOrder DoActions
    for (const script of tabOrderActions) {
      const actionBytes = compileAS2(script);
      if (actionBytes.length > 0) {
        const doActionBody = new Uint8Array(actionBytes.length + 1);
        doActionBody.set(actionBytes);
        spriteTags.push(encodeTag(Tag.DoAction, doActionBody));
      }
    }

    // ShowFrame (tag 1, length 0)
    spriteTags.push(encodeTag(Tag.ShowFrame, new Uint8Array(0)));
  }

  // End tag (tag 0, length 0)
  spriteTags.push(encodeTag(Tag.End, new Uint8Array(0)));

  // Build the sprite body: SpriteID (UI16) + FrameCount (UI16) + control tags
  // This is the DefineSprite tag *body* (without the outer record header).
  // The caller (compile.ts) wraps it with writer.writeTag(Tag.DefineSprite, body).
  const bodyBw = new BitWriter();
  bodyBw.writeUI16LE(spriteId);
  bodyBw.writeUI16LE(maxFrames);
  for (const tagBytes of spriteTags) {
    bodyBw.writeBytes(tagBytes);
  }
  return bodyBw.getBytes();
}

/**
 * Hoist all character definition tags from a symbol's sprite body to the
 * top level. This is a no-op shim kept for API compatibility — the hoisting
 * is now done inline in encodeDefineSprite via the hoistedDefs parameter.
 */
export function hoistSpriteDefinitions(
  _symbol: Symbol,
  _charIdMap: Map<string, number>
): void {
  // No-op — hoisting is handled inside encodeDefineSprite via hoistedDefs.
}
