import type { Frame, Layer, Timeline } from "./types.js";
import type { DisplayObject, ShapeDisplayObject, SymbolInstance } from "../engine/types.js";
import { interpolateTween, interpolateShapeTween } from "../tween/interpolate.js";
import type { TweenTarget } from "../tween/types.js";
import { layerFrameCount } from "./timeline.js";
import { samplePath, getGuideLayerPath } from "../engine/guidepath.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Represents a single tween span between two keyframes.
 */
export interface TweenSpan {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly tweenType: "motion" | "shape";
  readonly ease: number;
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Find the governing keyframe for a given frame index in a layer.
 * The governing keyframe is the latest keyframe at or before frameIndex.
 * Returns the first frame if no keyframe exists before frameIndex.
 */
export function getGoverningKeyframe(
  layer: Layer,
  frameIndex: number
): Frame | null {
  let governing: Frame | null = null;
  for (const frame of layer.frames) {
    if (frame.index <= frameIndex && frame.isKeyframe) {
      governing = frame;
    }
  }
  return governing ?? (layer.frames[0] ?? null);
}

/**
 * Get all keyframe positions (frame indices) for a layer, in ascending order.
 */
export function getKeyframeIndices(layer: Layer): number[] {
  return layer.frames
    .filter((f) => f.isKeyframe)
    .map((f) => f.index)
    .sort((a, b) => a - b);
}

/**
 * Get the total frame count across all layers.
 * Uses each layer's explicit frameCount (the authoritative span length) so
 * regular-frame spans that extend beyond the last keyframe are counted.
 */
export function getFrameCount(timeline: Timeline): number {
  if (timeline.layers.length === 0) return 1;
  return Math.max(...timeline.layers.map((l) => layerFrameCount(l)));
}

/**
 * Find a layer by its id. Returns null if not found.
 */
export function findLayerById(
  timeline: Timeline,
  layerId: string
): Layer | null {
  return timeline.layers.find((l) => l.id === layerId) ?? null;
}

/**
 * Get all frames between start and end (inclusive) from a layer.
 * Returns frames in the layer whose index falls within [startFrame, endFrame].
 */
export function getFramesBetween(
  layer: Layer,
  startFrame: number,
  endFrame: number
): Frame[] {
  return layer.frames.filter(
    (f) => f.index >= startFrame && f.index <= endFrame
  );
}

/**
 * Get all tween spans in a layer: each span is { startFrame, endFrame, tweenType, ease }.
 */
export function getTweenSpans(layer: Layer): TweenSpan[] {
  const spans: TweenSpan[] = [];
  const keyframeFrames = layer.frames.filter((f) => f.isKeyframe);
  for (let i = 0; i < keyframeFrames.length - 1; i++) {
    const kf = keyframeFrames[i];
    if (kf.tweenType !== "none") {
      spans.push({
        startFrame: kf.index,
        endFrame: keyframeFrames[i + 1].index - 1,
        tweenType: kf.tweenType as "motion" | "shape",
        ease: kf.tweenType === "motion" ? kf.motionEase : kf.shapeEase,
      });
    }
  }
  return spans;
}

/**
 * Find the guide layer that is directly above the given guided layer in the
 * timeline's layer array.  In Flash, layers are stored so that index 0 is the
 * topmost layer in the UI — so a guide layer appears at an earlier index than
 * the guided layer it controls.
 *
 * @param timeline     The timeline containing both layers.
 * @param guidedLayer  The layer with type === 'guided'.
 * @returns            The adjacent guide layer, or null if none is found.
 */
export function findGuideLayerAbove(
  timeline: Timeline,
  guidedLayer: Layer
): Layer | null {
  const idx = timeline.layers.indexOf(guidedLayer);
  if (idx <= 0) return null;
  const above = timeline.layers[idx - 1];
  if (above && above.type === 'guide') return above;
  return null;
}

/**
 * Extract a TweenTarget from a DisplayObject for motion tween interpolation.
 * Falls back to zero values for missing fields.
 */
function displayObjectToTweenTarget(obj: DisplayObject): TweenTarget {
  const shaped = obj as ShapeDisplayObject;
  // Extract colorEffect from SymbolInstance if present
  const colorEffect = (obj.type === "instance")
    ? ((obj as SymbolInstance).colorEffect ?? null)
    : null;
  return {
    x: shaped.x ?? 0,
    y: shaped.y ?? 0,
    scaleX: shaped.scaleX ?? 1,
    scaleY: shaped.scaleY ?? 1,
    rotation: shaped.rotation ?? 0,
    alpha: 100,
    colorEffect,
  };
}

/**
 * Get a synthetic Frame for a given frameIndex in a layer, with display objects
 * interpolated if within a motion or shape tween span.
 * Returns null if frameIndex is outside the layer's frame range.
 *
 * @param layer       The layer to evaluate.
 * @param frameIndex  The frame to evaluate (0-based).
 * @param timeline    Optional timeline — required for guide-layer path following.
 *                    When supplied, guided layers whose motion tween lies below
 *                    a guide layer will have their position overridden by the
 *                    path sampled from the guide layer.
 */
export function getTweenedFrame(
  layer: Layer,
  frameIndex: number,
  timeline?: Timeline
): Frame | null {
  if (layer.frames.length === 0) return null;

  // Check if frameIndex is within the layer's range
  const layerLen = layerFrameCount(layer);
  if (frameIndex < 0 || frameIndex >= layerLen) return null;

  const spans = getTweenSpans(layer);

  // Check if frameIndex falls within a tween span
  const span = spans.find(
    (s) => frameIndex >= s.startFrame && frameIndex <= s.endFrame
  );

  if (!span) {
    // No tween — return the governing keyframe as-is
    return getGoverningKeyframe(layer, frameIndex);
  }

  // Find start and end keyframes for the span
  const startKf = layer.frames.find(
    (f) => f.isKeyframe && f.index === span.startFrame
  );
  const endKf = layer.frames.find(
    (f) => f.isKeyframe && f.index === span.endFrame + 1
  );

  if (!startKf || !endKf) {
    return getGoverningKeyframe(layer, frameIndex);
  }

  let interpolatedObjects: DisplayObject[];

  if (span.tweenType === "motion") {
    // Resolve guide path if this is a guided layer with an adjacent guide layer.
    // guidedPathSample is pre-computed once for the frame and shared across all
    // display objects in the layer (Flash moves the whole layer, not individual objects).
    let guidedPathSample: { x: number; y: number; angle: number } | null = null;
    let orientToPath = false;
    if (layer.type === 'guided' && timeline) {
      const guideLayer = findGuideLayerAbove(timeline, layer);
      if (guideLayer) {
        const guidePath = getGuideLayerPath(guideLayer);
        if (guidePath) {
          // t ranges from 0 (at the start keyframe) to 1 (at the end keyframe)
          const spanLength = span.endFrame - span.startFrame + 2; // frames incl. end kf
          const t = spanLength > 1
            ? (frameIndex - span.startFrame) / (spanLength - 1)
            : 0;
          guidedPathSample = samplePath(guidePath, Math.max(0, Math.min(1, t)));
          orientToPath = startKf.motionOrientToPath;
        }
      }
    }

    // For motion tween, interpolate each display object's transform independently
    interpolatedObjects = startKf.displayObjects.map((startObj, i) => {
      const endObj = endKf.displayObjects[i];
      if (!endObj) return startObj;

      const from = displayObjectToTweenTarget(startObj);
      const to = displayObjectToTweenTarget(endObj);
      const result = interpolateTween(
        from,
        to,
        frameIndex,
        span.startFrame,
        span.endFrame + 1,
        {
          ease: span.ease,
          motionRotate: startKf.motionRotate,
          motionRotateCount: startKf.motionRotateCount,
        }
      );

      let x = result.x;
      let y = result.y;
      let rotation = result.rotation;

      // Override position (and optionally rotation) with guide path sample
      if (guidedPathSample !== null) {
        x = guidedPathSample.x;
        y = guidedPathSample.y;
        if (orientToPath) {
          rotation = guidedPathSample.angle * (180 / Math.PI);
        }
      }

      // Apply interpolated colorEffect back (only meaningful for SymbolInstance)
      const interpolatedColorEffect = result.colorEffect !== undefined
        ? result.colorEffect
        : undefined;

      return {
        ...startObj,
        x,
        y,
        scaleX: result.scaleX,
        scaleY: result.scaleY,
        rotation,
        ...(interpolatedColorEffect !== undefined
          ? { colorEffect: interpolatedColorEffect ?? undefined }
          : {}),
      } as DisplayObject;
    });
  } else {
    // Shape tween
    const linearT =
      span.endFrame >= span.startFrame
        ? (frameIndex - span.startFrame) / (span.endFrame - span.startFrame + 1)
        : 0;

    interpolatedObjects = interpolateShapeTween(
      startKf.displayObjects,
      endKf.displayObjects,
      linearT,
      span.ease,
      startKf.shapeBlend
    );
  }

  // Return a synthetic frame with interpolated objects
  return {
    ...startKf,
    index: frameIndex,
    isKeyframe: false,
    displayObjects: interpolatedObjects,
  };
}

/**
 * Get all display objects visible at a given frame index across all layers.
 * Respects layer visibility. For tweened frames, returns interpolated objects.
 * Layer order: layer 0 = top of display stack; last layer = bottom.
 */
export function getDisplayObjectsAtFrame(
  timeline: Timeline,
  frameIndex: number
): DisplayObject[] {
  const result: DisplayObject[] = [];

  // Reverse so that the last layer in the array is processed first (bottom of stack),
  // and layer 0 is processed last (top of stack) — result array is bottom-to-top.
  const reversed = [...timeline.layers].reverse();

  for (const layer of reversed) {
    if (!layer.visible) continue;

    const frame = getTweenedFrame(layer, frameIndex, timeline);
    if (!frame) continue;

    for (const obj of frame.displayObjects) {
      result.push(obj);
    }
  }

  return result;
}

/**
 * Get the total duration of the timeline in seconds given a frame rate.
 */
export function getTimelineDuration(
  timeline: Timeline,
  frameRate: number
): number {
  if (frameRate <= 0) return 0;
  return getFrameCount(timeline) / frameRate;
}

/**
 * Get the total duration of a scene in frames.
 * Returns the maximum frameCount across all layers, or 0 if the scene has no layers.
 * In Flash, layers within a scene can have different lengths; the scene duration
 * is the length of the longest layer.
 */
export function getSceneDuration(scene: import("./types.js").Scene): number {
  return Math.max(...scene.timeline.layers.map((l) => layerFrameCount(l)), 0);
}
