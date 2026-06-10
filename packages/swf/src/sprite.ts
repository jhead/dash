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
import { layerFrameCount, compileAS2 } from "@flash/core";
import { BitWriter } from "./bits.js";
import { encodeDefineShape4, encodeBitmapFillShape, encodePlaceObject2, encodePlaceObject2Move } from "./shapes.js";
import { encodeDefineEditText, encodePlaceObject2ForText } from "./text.js";
import { Tag } from "./tags.js";
import { dataUriToBytes } from "./bitmaps.js";

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
            const imageBytes = dataUriToBytes(bitmapItem.dataUri);
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

  // Per-depth display-list state (last placed objId and position)
  interface DepthState {
    objId: string;
    x: number;
    y: number;
  }
  const depthState = new Map<number, DepthState>();

  // Collect all sprite body bytes: only control tags per frame
  const spriteTags: Uint8Array[] = [];

  for (let frameIdx = 0; frameIdx < maxFrames; frameIdx++) {
    // Collect what should be on screen this frame
    const thisFrameDepths = new Map<number, { objId: string; x: number; y: number }>();

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const keyframe = findGoverningKeyframe(layer, frameIdx);
      // Do not skip on isEmpty — the flag can be stale; use actual displayObjects length.
      if (!keyframe || keyframe.displayObjects.length === 0) continue;

      for (const obj of keyframe.displayObjects) {
        const depth = getOrAssignDepth(li, obj.id);
        const x = "x" in obj ? (obj as { x: number }).x ?? 0 : 0;
        const y = "y" in obj ? (obj as { y: number }).y ?? 0 : 0;
        thisFrameDepths.set(depth, { objId: obj.id, x, y });
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
    for (const [depth, { objId, x, y }] of thisFrameDepths) {
      const prev = depthState.get(depth);
      const isFirst = !prev;
      const posChanged = prev && (prev.x !== x || prev.y !== y || prev.objId !== objId);

      if (!isFirst && !posChanged) {
        // Unchanged — emit nothing
        depthState.set(depth, { objId, x, y });
        continue;
      }

      // Find the display object
      let displayObj: import("@flash/core").DisplayObject | undefined;
      outer: for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        const keyframe = findGoverningKeyframe(layer, frameIdx);
        // Do not skip on isEmpty — the flag can be stale; check displayObjects directly.
        if (!keyframe || keyframe.displayObjects.length === 0) continue;
        for (const obj of keyframe.displayObjects) {
          if (obj.id === objId) {
            displayObj = obj;
            break outer;
          }
        }
      }
      if (!displayObj) continue;

      if (isFirst) {
        if (displayObj.type === "shape" || displayObj.type === "drawing-object") {
          const charId = objCharIdMap.get(objId)!;
          const objTransform = displayObj.type === "shape" ? {
            scaleX: displayObj.scaleX,
            scaleY: displayObj.scaleY,
            rotation: displayObj.rotation,
          } : undefined;
          spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2(charId, depth, x, y, objTransform)));
        } else if (displayObj.type === "text") {
          const charId = objCharIdMap.get(objId)!;
          spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2ForText(charId, depth, x, y)));
        } else if (displayObj.type === "bitmap") {
          const charId = objCharIdMap.get(objId);
          if (charId !== undefined) {
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2(charId, depth, x, y)));
          }
        } else if (displayObj.type === "instance") {
          const refCharId = charIdMap.get(displayObj.symbolId);
          if (refCharId !== undefined) {
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2(refCharId, depth, x, y)));
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
          spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2Move(charId, depth, x, y, objTransform, replaceChar)));
        } else if (displayObj.type === "text") {
          const charId = objCharIdMap.get(objId)!;
          spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2Move(charId, depth, x, y, undefined, replaceChar)));
        } else if (displayObj.type === "bitmap") {
          const charId = objCharIdMap.get(objId);
          if (charId !== undefined) {
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2Move(charId, depth, x, y, undefined, replaceChar)));
          }
        } else if (displayObj.type === "instance") {
          const refCharId = charIdMap.get(displayObj.symbolId);
          if (refCharId !== undefined) {
            spriteTags.push(encodeTag(Tag.PlaceObject2, encodePlaceObject2Move(refCharId, depth, x, y, undefined, replaceChar)));
          }
        }
      }

      depthState.set(depth, { objId, x, y });
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
