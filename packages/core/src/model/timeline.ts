import type { EaseCurve, Frame, Layer, LayerType, Timeline } from "./types.js";
import type { DisplayObject, ObjectAccessibility, ShapeDisplayObject } from "../engine/types.js";

import type { FlashFilter } from "../engine/filters.js";

/** Widened update type that covers both shape transforms and text fields. */
type DisplayObjectUpdates = Partial<
  Pick<ShapeDisplayObject, "x" | "y" | "scaleX" | "scaleY" | "rotation" | "skewX" | "skewY" | "shape"> & {
    text: string;
    width: number;
    height: number;
    filters: readonly FlashFilter[];
    // Text-specific formatting fields
    bold: boolean;
    italic: boolean;
    underline: boolean;
    align: "left" | "center" | "right" | "justify";
    letterSpacing: number;
    scrollable: boolean;
    textType: "static" | "dynamic" | "input";
    fontFamily: string;
    fontSize: number;
    // Accessibility (_accProps) — instance-level accessibility override
    accessibility: ObjectAccessibility;
  }
>;

let _layerIdCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}-${++_layerIdCounter}-${Date.now().toString(36)}`;
}

/**
 * Create a blank keyframe at the given index.
 * By default it is an empty keyframe with no tween, label, or script.
 */
export function createFrame(index: number, overrides?: Partial<Frame>): Frame {
  return {
    index,
    isKeyframe: true,
    isEmpty: true,
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionEaseCurve: null,
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: true,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects: [],
    ...overrides,
  };
}

/**
 * Create a layer with sensible Flash 8 defaults.
 * A new layer always starts with one blank keyframe at frame 0.
 */
export function createLayer(
  name: string,
  type: LayerType = "normal",
  overrides?: Partial<Omit<Layer, "frames">> & { frames?: readonly Frame[] }
): Layer {
  const defaultFrame = createFrame(0);
  return {
    id: nextId("layer"),
    name,
    type,
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#0000ff",
    height: 20,
    parentFolderId: null,
    frames: [defaultFrame],
    frameCount: 1,
    ...overrides,
  };
}

/**
 * Create an empty Timeline with one normal layer ("Layer 1").
 */
export function createTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    layers: [createLayer("Layer 1")],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Timeline mutation helpers (pure functions — return new state)
// ---------------------------------------------------------------------------

/**
 * Add a new layer to the timeline (appended at top, index 0 in Flash convention).
 */
export function addLayer(timeline: Timeline, name?: string): Timeline {
  const layerCount = timeline.layers.length;
  const layerName = name ?? `Layer ${layerCount + 1}`;
  const newLayer = createLayer(layerName);
  return {
    ...timeline,
    layers: [newLayer, ...timeline.layers],
  };
}

/**
 * Add a new folder layer to the timeline (appended at top, index 0 in Flash convention).
 * Folder layers group child layers underneath them.
 */
export function addLayerFolder(timeline: Timeline, name?: string): Timeline {
  const folderCount = timeline.layers.filter((l) => l.type === "folder").length;
  const folderName = name ?? `Folder ${folderCount + 1}`;
  const newFolder = createLayer(folderName, "folder", { collapsed: false });
  return {
    ...timeline,
    layers: [newFolder, ...timeline.layers],
  };
}

/**
 * Delete a layer by ID.
 */
export function deleteLayer(timeline: Timeline, layerId: string): Timeline {
  // Don't allow deleting the last layer
  if (timeline.layers.length <= 1) return timeline;
  return {
    ...timeline,
    layers: timeline.layers.filter((l) => l.id !== layerId),
  };
}

/**
 * Duplicate a layer by ID, inserting the copy immediately after the source.
 * The copy gets a new unique ID and has " copy" appended to its name.
 */
export function duplicateLayer(timeline: Timeline, layerId: string): Timeline {
  const idx = timeline.layers.findIndex((l) => l.id === layerId);
  if (idx < 0) return timeline;
  const source = timeline.layers[idx];
  const copy: Layer = { ...source, id: nextId("layer"), name: `${source.name} copy` };
  const layers = [...timeline.layers];
  layers.splice(idx + 1, 0, copy);
  return { ...timeline, layers };
}

/**
 * Move a layer to a new index position.
 */
export function moveLayer(
  timeline: Timeline,
  layerId: string,
  newIndex: number
): Timeline {
  const layers = [...timeline.layers];
  const oldIndex = layers.findIndex((l) => l.id === layerId);
  if (oldIndex === -1) return timeline;
  const [layer] = layers.splice(oldIndex, 1);
  const clampedIndex = Math.max(0, Math.min(newIndex, layers.length));
  layers.splice(clampedIndex, 0, layer);
  return { ...timeline, layers };
}

/**
 * Toggle or set layer visibility.
 */
export function setLayerVisible(
  timeline: Timeline,
  layerId: string,
  visible: boolean
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((l) =>
      l.id === layerId ? { ...l, visible } : l
    ),
  };
}

/**
 * Toggle or set layer lock state.
 */
export function setLayerLocked(
  timeline: Timeline,
  layerId: string,
  locked: boolean
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((l) =>
      l.id === layerId ? { ...l, locked } : l
    ),
  };
}

/**
 * Rename a layer.
 */
export function renameLayer(
  timeline: Timeline,
  layerId: string,
  name: string
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((l) =>
      l.id === layerId ? { ...l, name } : l
    ),
  };
}

/**
 * Set the type of a layer (normal / guide / guided / mask / masked / folder).
 */
export function setLayerType(
  timeline: Timeline,
  layerId: string,
  type: LayerType
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((l) =>
      l.id === layerId ? { ...l, type } : l
    ),
  };
}

// ---------------------------------------------------------------------------
// Frame helpers
// ---------------------------------------------------------------------------

/**
 * Get the total number of frames in a layer.
 * Uses the explicit frameCount field when available; falls back to
 * max-keyframe-index + 1 for legacy layers that predate the field.
 * Minimum 1.
 */
export function layerFrameCount(layer: Layer): number {
  if (layer.frameCount !== undefined) return Math.max(1, layer.frameCount);
  if (layer.frames.length === 0) return 1;
  const maxIndex = layer.frames.reduce(
    (max, f) => Math.max(max, f.index),
    0
  );
  return maxIndex + 1;
}

/**
 * Insert a regular frame at the given 0-based frameIndex (Flash F5).
 *
 * Flash F5 semantics:
 * - If frameIndex is on a keyframe: shifts that keyframe (and all later
 *   keyframes) right by 1, extending the preceding span.
 * - If frameIndex is within a span or at/past the end: extends the layer
 *   duration by 1 without moving any keyframe before frameIndex.
 *
 * In both cases all keyframes at >= frameIndex shift right by 1, and
 * frameCount increases by 1.  If frameIndex is beyond the current duration
 * the layer is extended to frameIndex + 1 (Flash allows clicking on a grey
 * cell and pressing F5 to extend the layer to that position).
 */
export function insertFrame(
  timeline: Timeline,
  layerId: string,
  frameIndex: number
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const currentCount = layerFrameCount(layer);
      // If the target index is beyond the current end, extend to frameIndex + 1
      // instead of just +1 so a single F5 on a distant grey cell works.
      const newCount = Math.max(currentCount + 1, frameIndex + 1);
      const newFrames = layer.frames.map((f) =>
        f.index >= frameIndex ? { ...f, index: f.index + 1 } : f
      );
      return { ...layer, frames: newFrames, frameCount: newCount };
    }),
  };
}

/**
 * Insert a keyframe at frameIndex (Flash F6).
 *
 * Flash F6 semantics:
 * - Converts frame N into a keyframe IN PLACE — no shifting of later keyframes.
 * - Copies displayObjects (deep) from the governing keyframe for that frame.
 * - If frameIndex already has a keyframe, this is a no-op.
 * - If frameIndex is beyond the current layer duration, extends the layer to
 *   frameIndex + 1 (same as clicking on a grey cell and pressing F6).
 *
 * Does NOT shift any existing keyframe indices.
 */
export function insertKeyframe(
  timeline: Timeline,
  layerId: string,
  frameIndex: number
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;

      // No-op if frameIndex already has a keyframe
      const existing = layer.frames.find((f) => f.index === frameIndex);
      if (existing?.isKeyframe) return layer;

      // Find the governing keyframe to copy content from
      const governing = [...layer.frames]
        .filter((f) => f.isKeyframe && f.index <= frameIndex)
        .sort((a, b) => b.index - a.index)[0];

      // Deep-copy the displayObjects so the new keyframe is independent
      const copiedObjects: readonly import("../engine/types.js").DisplayObject[] =
        governing ? governing.displayObjects.map((o) => ({ ...o })) : [];

      const newKeyframe = createFrame(frameIndex, {
        isKeyframe: true,
        isEmpty: governing ? governing.isEmpty : true,
        displayObjects: copiedObjects,
      });

      const currentCount = layerFrameCount(layer);
      const newCount = Math.max(currentCount, frameIndex + 1);

      const sorted = [...layer.frames, newKeyframe].sort(
        (a, b) => a.index - b.index
      );
      return { ...layer, frames: sorted, frameCount: newCount };
    }),
  };
}

/**
 * Insert a blank keyframe at frameIndex (Flash F7).
 *
 * Flash F7 semantics:
 * - Like F6 but always creates an empty keyframe (no copied content).
 * - Converts frame N into a blank keyframe IN PLACE — no shifting.
 * - If frameIndex already has a keyframe, this is a no-op.
 * - If frameIndex is beyond the current layer duration, extends the layer.
 *
 * Does NOT shift any existing keyframe indices.
 */
export function insertBlankKeyframe(
  timeline: Timeline,
  layerId: string,
  frameIndex: number
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;

      // No-op if frameIndex already has a keyframe
      const existing = layer.frames.find((f) => f.index === frameIndex);
      if (existing?.isKeyframe) return layer;

      const newKeyframe = createFrame(frameIndex, {
        isKeyframe: true,
        isEmpty: true,
      });

      const currentCount = layerFrameCount(layer);
      const newCount = Math.max(currentCount, frameIndex + 1);

      const sorted = [...layer.frames, newKeyframe].sort(
        (a, b) => a.index - b.index
      );
      return { ...layer, frames: sorted, frameCount: newCount };
    }),
  };
}

/**
 * Remove a frame at frameIndex (Flash Shift+F5).
 *
 * Flash Shift+F5 semantics:
 * - Decreases the layer duration by 1.
 * - If frameIndex has a keyframe, that keyframe is deleted and subsequent
 *   keyframes shift left by 1.
 * - If frameIndex is a regular frame in a span, just shrinks the span.
 * - Flash always preserves a keyframe at frame 0. Removing frame 0 when it
 *   is a keyframe shifts everything left, which would put the next keyframe
 *   at index 0 — allowed. But if the layer would be left with no frame 0
 *   keyframe, one is inserted (blank).
 * - No-op if the layer has only 1 frame (cannot reduce below 1).
 */
export function removeFrame(
  timeline: Timeline,
  layerId: string,
  frameIndex: number
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;

      const currentCount = layerFrameCount(layer);
      // No-op: cannot reduce a 1-frame layer further
      if (currentCount <= 1) return layer;

      // Remove keyframe at this index if it exists
      const withoutFrame = layer.frames.filter((f) => f.index !== frameIndex);
      // Shift subsequent keyframes left by 1
      const shifted = withoutFrame.map((f) =>
        f.index > frameIndex ? { ...f, index: f.index - 1 } : f
      );

      const newCount = currentCount - 1;

      // Ensure there is always a keyframe at frame 0
      const hasFrameZero = shifted.some((f) => f.isKeyframe && f.index === 0);
      const finalFrames = hasFrameZero
        ? shifted
        : [createFrame(0), ...shifted];

      return { ...layer, frames: finalFrames, frameCount: newCount };
    }),
  };
}

/**
 * Clear the keyframe at frameIndex (convert it to a regular frame).
 */
export function clearKeyframe(
  timeline: Timeline,
  layerId: string,
  frameIndex: number
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      // Don't remove the very first keyframe
      if (frameIndex === 0) return layer;
      const newFrames = layer.frames.filter((f) => f.index !== frameIndex);
      return { ...layer, frames: newFrames };
    }),
  };
}

/**
 * Set a frame label at the given frameIndex.
 */
export function setFrameLabel(
  timeline: Timeline,
  layerId: string,
  frameIndex: number,
  label: string
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const newFrames = layer.frames.map((f) =>
        f.index === frameIndex ? { ...f, label } : f
      );
      return { ...layer, frames: newFrames };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tween helpers
// ---------------------------------------------------------------------------

/**
 * Set motion tween on the keyframe at startFrameIndex in the given layer.
 * Optionally update the ease value (−100..100) and/or a custom Bézier ease curve.
 * Passing easeCurve=null clears the custom curve and falls back to the integer ease.
 * Returns a new Timeline.
 */
export function setMotionTween(
  timeline: Timeline,
  layerId: string,
  startFrameIndex: number,
  ease?: number,
  easeCurve?: EaseCurve | null
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const newFrames = layer.frames.map((f) => {
        if (f.index !== startFrameIndex || !f.isKeyframe) return f;
        return {
          ...f,
          tweenType: "motion" as const,
          motionEase: ease !== undefined ? ease : f.motionEase,
          motionEaseCurve: easeCurve !== undefined ? easeCurve : f.motionEaseCurve,
        };
      });
      return { ...layer, frames: newFrames };
    }),
  };
}

/**
 * Update motion tween properties (rotate, scale, orientToPath, sync) on a
 * keyframe without changing its tweenType. Use setMotionTween to also change
 * the ease value. Returns a new Timeline.
 */
export function updateMotionTweenProps(
  timeline: Timeline,
  layerId: string,
  frameIndex: number,
  props: {
    motionRotate?: "none" | "auto" | "cw" | "ccw";
    motionRotateCount?: number;
    motionOrientToPath?: boolean;
    motionSync?: boolean;
    motionScale?: boolean;
  }
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const newFrames = layer.frames.map((f) => {
        if (f.index !== frameIndex || !f.isKeyframe) return f;
        return {
          ...f,
          motionRotate: props.motionRotate !== undefined ? props.motionRotate : f.motionRotate,
          motionRotateCount: props.motionRotateCount !== undefined ? props.motionRotateCount : f.motionRotateCount,
          motionOrientToPath: props.motionOrientToPath !== undefined ? props.motionOrientToPath : f.motionOrientToPath,
          motionSync: props.motionSync !== undefined ? props.motionSync : f.motionSync,
          motionScale: props.motionScale !== undefined ? props.motionScale : f.motionScale,
        };
      });
      return { ...layer, frames: newFrames };
    }),
  };
}

/**
 * Set shape tween on the keyframe at startFrameIndex in the given layer.
 * Optionally update ease (−100..100) and blend mode.
 * Returns a new Timeline.
 */
export function setShapeTween(
  timeline: Timeline,
  layerId: string,
  startFrameIndex: number,
  options?: { ease?: number; blend?: "distributive" | "angular" }
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const newFrames = layer.frames.map((f) => {
        if (f.index !== startFrameIndex || !f.isKeyframe) return f;
        return {
          ...f,
          tweenType: "shape" as const,
          shapeEase: options?.ease !== undefined ? options.ease : f.shapeEase,
          shapeBlend: options?.blend !== undefined ? options.blend : f.shapeBlend,
        };
      });
      return { ...layer, frames: newFrames };
    }),
  };
}

// ---------------------------------------------------------------------------
// Shape hint helpers
// ---------------------------------------------------------------------------

/**
 * Add a shape hint to the governing keyframe at or before frameIndex in the
 * given layer. The next available letter ('a'–'z') is chosen automatically.
 * Returns the new Timeline, or the unchanged Timeline if all 26 letters are used
 * or if there is no governing keyframe.
 * The default placement is the centre of the stage (stageWidth/2, stageHeight/2)
 * which callers can override via x/y.
 */
export function addShapeHint(
  timeline: Timeline,
  layerId: string,
  frameIndex: number,
  x = 0,
  y = 0,
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const kf = findGoverningKeyframe(layer, frameIndex);
      if (!kf) return layer;
      const existing = kf.shapeHints ?? [];
      // Find the first unused letter
      const used = new Set(existing.map((h) => h.id));
      const letters = "abcdefghijklmnopqrstuvwxyz";
      const nextLetter = [...letters].find((l) => !used.has(l));
      if (!nextLetter) return layer; // all 26 used
      const newHint: import("./types.js").ShapeHint = { id: nextLetter, x, y };
      const newFrames = layer.frames.map((f) =>
        f === kf ? { ...f, shapeHints: [...existing, newHint] } : f
      );
      return { ...layer, frames: newFrames };
    }),
  };
}

/**
 * Update the position of an existing shape hint on the governing keyframe.
 * Returns the unchanged Timeline if the hint id is not found.
 */
export function updateShapeHint(
  timeline: Timeline,
  layerId: string,
  frameIndex: number,
  hintId: string,
  x: number,
  y: number,
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const kf = findGoverningKeyframe(layer, frameIndex);
      if (!kf) return layer;
      const existing = kf.shapeHints ?? [];
      if (!existing.some((h) => h.id === hintId)) return layer;
      const newHints = existing.map((h) =>
        h.id === hintId ? { ...h, x, y } : h
      );
      const newFrames = layer.frames.map((f) =>
        f === kf ? { ...f, shapeHints: newHints } : f
      );
      return { ...layer, frames: newFrames };
    }),
  };
}

/**
 * Remove a single shape hint by id from the governing keyframe.
 * Returns the unchanged Timeline if the hint id is not found.
 */
export function removeShapeHint(
  timeline: Timeline,
  layerId: string,
  frameIndex: number,
  hintId: string,
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const kf = findGoverningKeyframe(layer, frameIndex);
      if (!kf) return layer;
      const existing = kf.shapeHints ?? [];
      const newHints = existing.filter((h) => h.id !== hintId);
      const newFrames = layer.frames.map((f) =>
        f === kf ? { ...f, shapeHints: newHints } : f
      );
      return { ...layer, frames: newFrames };
    }),
  };
}

/**
 * Remove all shape hints from the governing keyframe (e.g. when clearing a tween).
 */
export function clearShapeHints(
  timeline: Timeline,
  layerId: string,
  frameIndex: number,
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const kf = findGoverningKeyframe(layer, frameIndex);
      if (!kf) return layer;
      const newFrames = layer.frames.map((f) =>
        f === kf ? { ...f, shapeHints: [] } : f
      );
      return { ...layer, frames: newFrames };
    }),
  };
}

/**
 * Clear any tween on the keyframe at frameIndex in the given layer.
 * Sets tweenType back to "none".
 * Returns a new Timeline.
 */
export function clearTween(
  timeline: Timeline,
  layerId: string,
  frameIndex: number
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const newFrames = layer.frames.map((f) => {
        if (f.index !== frameIndex || !f.isKeyframe) return f;
        return { ...f, tweenType: "none" as const };
      });
      return { ...layer, frames: newFrames };
    }),
  };
}

// ---------------------------------------------------------------------------
// Sound helper
// ---------------------------------------------------------------------------

/**
 * Set (or clear) the sound linkage on the keyframe at frameIndex in layerIndex.
 * Returns a new Timeline with updated sound field.
 */
export function setSoundOnFrame(
  timeline: Timeline,
  layerIndex: number,
  frameIndex: number,
  sound: import("./types.js").SoundLinkage | null
): Timeline {
  const layer = timeline.layers[layerIndex];
  if (!layer) return timeline;
  const newFrames = layer.frames.map((f) =>
    f.index === frameIndex && f.isKeyframe ? { ...f, sound } : f
  );
  const newLayers = timeline.layers.map((l, i) =>
    i === layerIndex ? { ...l, frames: newFrames } : l
  );
  return { ...timeline, layers: newLayers };
}

// ---------------------------------------------------------------------------
// Script helper
// ---------------------------------------------------------------------------

/**
 * Set the AS2 script on the governing keyframe at or before frameIndex.
 * Returns a new Timeline.
 */
export function setFrameScript(
  timeline: Timeline,
  layerId: string,
  frameIndex: number,
  script: string
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const kf = findGoverningKeyframe(layer, frameIndex);
      if (!kf) return layer;
      const newFrames = layer.frames.map((f) =>
        f.index === kf.index ? { ...f, script } : f
      );
      return { ...layer, frames: newFrames };
    }),
  };
}

// ---------------------------------------------------------------------------
// Display object helpers (pure — return new Timeline)
// ---------------------------------------------------------------------------

/**
 * Convert all span frames in the range [start, end] (inclusive) to keyframes.
 *
 * Flash "Convert to Keyframes" semantics:
 * - Each frame index in [start, end] that is not already a keyframe becomes one.
 * - The new keyframe inherits a deep copy of the display objects from the
 *   governing keyframe at or before that index (same as insertKeyframe / F6).
 * - Frames that are already keyframes are left unchanged.
 * - Frame indices and frameCount are not shifted.
 */
export function convertToKeyframes(
  timeline: Timeline,
  layerId: string,
  start: number,
  end: number
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;

      let frames = [...layer.frames];
      let newCount = layerFrameCount(layer);

      for (let i = start; i <= end; i++) {
        const existing = frames.find((f) => f.index === i);
        if (existing?.isKeyframe) continue;

        // Find governing keyframe among the current (mutating) frames
        const governing = [...frames]
          .filter((f) => f.isKeyframe && f.index <= i)
          .sort((a, b) => b.index - a.index)[0];

        const copiedObjects = governing
          ? governing.displayObjects.map((o) => ({ ...o }))
          : [];

        const newKeyframe = createFrame(i, {
          isKeyframe: true,
          isEmpty: governing ? governing.isEmpty : true,
          displayObjects: copiedObjects,
        });

        newCount = Math.max(newCount, i + 1);
        frames = [...frames, newKeyframe].sort((a, b) => a.index - b.index);
      }

      return { ...layer, frames, frameCount: newCount };
    }),
  };
}

/**
 * Reverse the keyframe content in the range [start, end] (inclusive).
 *
 * Flash "Reverse Frames" semantics:
 * - First, all non-keyframe positions in [start, end] are promoted to
 *   keyframes (same as convertToKeyframes).
 * - Then the content (displayObjects, tweenType, label, script, sound,
 *   isEmpty, and all tween properties) of the keyframes in [start, end]
 *   is reversed: the first keyframe's content is swapped with the last,
 *   the second with the second-to-last, and so on.
 * - Frame indices remain stable — only frame content is swapped.
 */
export function reverseFrames(
  timeline: Timeline,
  layerId: string,
  start: number,
  end: number
): Timeline {
  // Step 1: promote all span frames in range to keyframes
  const promoted = convertToKeyframes(timeline, layerId, start, end);

  return {
    ...promoted,
    layers: promoted.layers.map((layer) => {
      if (layer.id !== layerId) return layer;

      // Collect keyframes in [start, end] sorted by index
      const rangeKeyframes = layer.frames
        .filter((f) => f.isKeyframe && f.index >= start && f.index <= end)
        .sort((a, b) => a.index - b.index);

      if (rangeKeyframes.length <= 1) return layer;

      // Build a map: index -> reversed content
      type FrameContent = Pick<
        Frame,
        | "displayObjects"
        | "isEmpty"
        | "tweenType"
        | "label"
        | "labelType"
        | "script"
        | "sound"
        | "motionEase"
        | "motionEaseCurve"
        | "motionRotate"
        | "motionRotateCount"
        | "motionOrientToPath"
        | "motionSync"
        | "motionScale"
        | "shapeEase"
        | "shapeBlend"
      >;

      const contentOf = (f: Frame): FrameContent => ({
        displayObjects: f.displayObjects,
        isEmpty: f.isEmpty,
        tweenType: f.tweenType,
        label: f.label,
        labelType: f.labelType,
        script: f.script,
        sound: f.sound,
        motionEase: f.motionEase,
        motionEaseCurve: f.motionEaseCurve,
        motionRotate: f.motionRotate,
        motionRotateCount: f.motionRotateCount,
        motionOrientToPath: f.motionOrientToPath,
        motionSync: f.motionSync,
        motionScale: f.motionScale,
        shapeEase: f.shapeEase,
        shapeBlend: f.shapeBlend,
      });

      // Build index -> reversed content mapping
      const reversedContents = rangeKeyframes.map((f) => contentOf(f)).reverse();
      const contentMap = new Map<number, FrameContent>();
      rangeKeyframes.forEach((f, i) => {
        contentMap.set(f.index, reversedContents[i]!);
      });

      const newFrames = layer.frames.map((f) => {
        const reversed = contentMap.get(f.index);
        if (reversed === undefined) return f;
        return { ...f, ...reversed };
      });

      return { ...layer, frames: newFrames };
    }),
  };
}

/**
 * Find the governing keyframe at or before frameIndex for the given layer.
 * Returns the keyframe or undefined.
 */
function findGoverningKeyframe(
  layer: { frames: readonly Frame[] },
  frameIndex: number
): Frame | undefined {
  return [...layer.frames]
    .filter((f) => f.isKeyframe && f.index <= frameIndex)
    .sort((a, b) => b.index - a.index)[0];
}

/**
 * Add a DisplayObject to the governing keyframe of the given layer/frame.
 */
export function addDisplayObject(
  timeline: Timeline,
  layerId: string,
  frameIndex: number,
  object: DisplayObject
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const kf = findGoverningKeyframe(layer, frameIndex);
      if (!kf) return layer;
      const newFrames = layer.frames.map((f) =>
        f.index === kf.index
          ? { ...f, displayObjects: [...f.displayObjects, object], isEmpty: false }
          : f
      );
      return { ...layer, frames: newFrames };
    }),
  };
}

/**
 * Remove a DisplayObject by id from the governing keyframe.
 */
export function removeDisplayObject(
  timeline: Timeline,
  layerId: string,
  frameIndex: number,
  objectId: string
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const kf = findGoverningKeyframe(layer, frameIndex);
      if (!kf) return layer;
      const newFrames = layer.frames.map((f) => {
        if (f.index !== kf.index) return f;
        const newObjs = f.displayObjects.filter((o) => o.id !== objectId);
        return { ...f, displayObjects: newObjs, isEmpty: newObjs.length === 0 };
      });
      return { ...layer, frames: newFrames };
    }),
  };
}

/**
 * Update transform properties (and optionally text fields) of a DisplayObject
 * by id in the governing keyframe.
 */
export function updateDisplayObject(
  timeline: Timeline,
  layerId: string,
  frameIndex: number,
  objectId: string,
  updates: DisplayObjectUpdates
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const kf = findGoverningKeyframe(layer, frameIndex);
      if (!kf) return layer;
      const newFrames = layer.frames.map((f) => {
        if (f.index !== kf.index) return f;
        const newObjs = f.displayObjects.map((o) =>
          o.id === objectId ? { ...o, ...updates } : o
        );
        return { ...f, displayObjects: newObjs };
      });
      return { ...layer, frames: newFrames };
    }),
  };
}
