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
import type { BitmapItem, FlashDocument, Symbol, Layer, Frame } from "@flash/core";
import { layerFrameCount, compileAS2, getTweenedFrame } from "@flash/core";
import { BitWriter } from "./bits.js";
import {
  encodeDefineShape4,
  encodeBitmapFillShape,
  encodePlaceObject2,
  encodePlaceObject2Move,
  encodePlaceObject2WithCXForm,
} from "./shapes.js";
import {
  encodePlaceObject3WithFilters,
  encodePlaceObject3WithBlendMode,
  hasEnabledFilters,
} from "./filters.js";
import { encodeDefineEditText, encodePlaceObject2ForText } from "./text.js";
import { Tag } from "./tags.js";
import { dataUriToBytes, ensureJpegEOI } from "./bitmaps.js";
import { colorEffectToCXForm } from "./cxform.js";

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

/**
 * Find the governing keyframe for a layer at the given frame index.
 * The governing keyframe is the last keyframe at or before `frameIdx`.
 */
function findGoverningKeyframe(layer: Layer, frameIdx: number): Frame | null {
  let governing: Frame | null = null;
  for (const frame of layer.frames) {
    if (frame.isKeyframe && frame.index <= frameIdx) {
      if (governing === null || frame.index > governing.index) {
        governing = frame;
      }
    }
  }
  return governing;
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
  hoistedDefs: Array<{ tagType: number; body: Uint8Array }>
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

  // Pre-pass: assign character IDs and collect hoisted definition tags.
  // All DefineShape4 / DefineEditText tags are emitted at the top level
  // (Bug 3 fix) via hoistedDefs — never inside the sprite body.
  for (const layer of layers) {
    for (const frame of layer.frames) {
      // Do not skip on isEmpty — the flag can be stale; iterate displayObjects directly.
      if (!frame.isKeyframe) continue;
      for (const obj of frame.displayObjects) {
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
          hoistedDefs.push({ tagType: Tag.DefineEditText, body: encodeDefineEditText(charId, obj) });
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

  // Bug 1101 fix: pre-pass to seed depth assignments in correct visual order.
  // Iterate from li=layers.length-1 (background/bottommost) down to li=0 (foreground/topmost).
  // This ensures background layers get lower depths (rendered behind) and foreground
  // layers get higher depths (rendered in front), matching compile.ts lines ~1327-1346.
  for (let li = layers.length - 1; li >= 0; li--) {
    const layer = layers[li];
    for (const frame of layer.frames) {
      if (!frame.isKeyframe) continue;
      for (const obj of frame.displayObjects) {
        getOrAssignDepth(li, obj.id);
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
  }
  const depthState = new Map<number, DepthState>();

  // Collect all sprite body bytes: only control tags per frame
  const spriteTags: Uint8Array[] = [];

  for (let frameIdx = 0; frameIdx < maxFrames; frameIdx++) {
    // Collect what should be on screen this frame
    // Bug 1100 fix: use getTweenedFrame (not findGoverningKeyframe) so tween
    // interpolation is applied for each frame within a motion-tween span.
    const thisFrameDepths = new Map<number, { objId: string; displayObj: import("@flash/core").DisplayObject }>();

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const keyframe = getTweenedFrame(layer, frameIdx, timeline);
      // Do not skip on isEmpty — the flag can be stale; use actual displayObjects length.
      if (!keyframe || keyframe.displayObjects.length === 0) continue;

      for (const obj of keyframe.displayObjects) {
        const depth = getOrAssignDepth(li, obj.id);
        thisFrameDepths.set(depth, { objId: obj.id, displayObj: obj });
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
    for (const [depth, { objId, displayObj }] of thisFrameDepths) {
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
          prev.colorEffectKey !== thisColorEffectKey);

      if (!isFirst && !posChanged) {
        // Unchanged — emit nothing
        depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, skewX, skewY, colorEffectKey: thisColorEffectKey });
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
          // Bug 1103 fix: encode colorEffect / visible=false via CXForm
          if (displayObj.type === "shape" && displayObj.visible === false) {
            const zeroCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(charId, depth, x, y, zeroCXForm, objTransform)));
          } else if (hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
            const placeBody = encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!, objTransform);
            spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
          } else {
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2(charId, depth, x, y, objTransform)));
          }
        } else if (displayObj.type === "text") {
          const charId = objCharIdMap.get(objId)!;
          // Task 1110 fix: filters require PlaceObject3
          if (hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
            const placeBody = encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!);
            spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
          } else {
            // Bug 1103 fix: encode colorEffect / visible=false
            let cxform = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
              ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect)
              : null;
            if (cxform === null && (displayObj as { visible?: boolean }).visible === false) {
              cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            }
            if (cxform !== null) {
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(charId, depth, x, y, cxform)));
            } else {
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2ForText(charId, depth, x, y)));
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
                ? encodePlaceObject3WithBlendMode(charId, depth, x, y, (displayObj as { blendMode: string }).blendMode, (displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters, undefined, undefined, bmpCXForm)
                : encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!);
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
        } else if (displayObj.type === "instance") {
          const refCharId = charIdMap.get(displayObj.symbolId);
          if (refCharId !== undefined) {
            const instanceTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
              ? { scaleX, scaleY, rotation, skewX, skewY }
              : undefined;
            // Bug 1103 fix: encode colorEffect / visible=false / filters / blend mode
            const hasBlend = !!(displayObj as { blendMode?: string }).blendMode && (displayObj as { blendMode: string }).blendMode !== "normal";
            if (hasBlend || hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
              const instCXForm = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
                ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect) ?? undefined
                : undefined;
              const placeBody = hasBlend
                ? encodePlaceObject3WithBlendMode(refCharId, depth, x, y, (displayObj as { blendMode: string }).blendMode, (displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters, instanceTransform, undefined, instCXForm)
                : encodePlaceObject3WithFilters(refCharId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!, instanceTransform);
              spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
            } else {
              let cxform = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
                ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect)
                : null;
              if (cxform === null && (displayObj as { visible?: boolean }).visible === false) {
                cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
              }
              if (cxform !== null) {
                spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(refCharId, depth, x, y, cxform, instanceTransform)));
              } else {
                spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2(refCharId, depth, x, y, instanceTransform)));
              }
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
          // Bug 1103 fix: encode colorEffect / visible=false / filters on move
          if (displayObj.type === "shape" && displayObj.visible === false) {
            const zeroCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(charId, depth, x, y, zeroCXForm, objTransform, true)));
          } else if (hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
            const placeBody = encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!, objTransform);
            spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
          } else {
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2Move(charId, depth, x, y, objTransform, replaceChar)));
          }
        } else if (displayObj.type === "text") {
          const charId = objCharIdMap.get(objId)!;
          // Task 1110 fix: filters require PlaceObject3 on move too
          if (hasEnabledFilters((displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters)) {
            const placeBody = encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!);
            spriteTags.push(encodeTag(Tag.PlaceObject3, placeBody));
          } else {
            let cxform = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
              ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect)
              : null;
            if (cxform === null && (displayObj as { visible?: boolean }).visible === false) {
              cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            }
            if (cxform !== null) {
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(charId, depth, x, y, cxform, undefined, true)));
            } else {
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2Move(charId, depth, x, y, undefined, replaceChar)));
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
                ? encodePlaceObject3WithBlendMode(charId, depth, x, y, (displayObj as { blendMode: string }).blendMode, (displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters, undefined, undefined, bmpCXForm)
                : encodePlaceObject3WithFilters(charId, depth, x, y, (displayObj as { filters: readonly import("@flash/core").FlashFilter[] }).filters!);
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
            // Bug 1103 fix: encode colorEffect / visible=false on move
            let cxform = (displayObj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect
              ? colorEffectToCXForm((displayObj as { colorEffect: import("@flash/core").ColorEffect }).colorEffect)
              : null;
            if (cxform === null && (displayObj as { visible?: boolean }).visible === false) {
              cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
            }
            if (cxform !== null) {
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2WithCXForm(refCharId, depth, x, y, cxform, instanceTransform, true)));
            } else {
              spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2Move(refCharId, depth, x, y, instanceTransform, replaceChar)));
            }
          }
        }
      }

      depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, skewX, skewY, colorEffectKey: thisColorEffectKey });
    }

    // Emit FrameLabel (tag 43) if any keyframe at this frame index has a label
    let frameLabel: string | null = null;
    let frameLabelType: string = "name";
    outerLabel: for (const layer of layers) {
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
