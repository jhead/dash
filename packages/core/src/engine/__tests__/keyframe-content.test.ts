/**
 * Tests for insertKeyframe content-copying behaviour and insertBlankKeyframe
 * empty-keyframe behaviour.
 *
 * Verifies:
 *  - insertKeyframe copies display objects from the governing keyframe
 *  - insertKeyframe between two keyframes copies from the previous keyframe
 *  - insertKeyframe creates a real (non-blank) keyframe when source has content
 *  - insertBlankKeyframe always creates an empty keyframe (isEmpty=true, no objects)
 *  - blank vs regular keyframes differ in content
 */

import { describe, it, expect } from "vitest";
import {
  createLayer,
  createFrame,
  createTimeline,
  insertKeyframe,
  insertBlankKeyframe,
} from "../../model/timeline.js";
import type { ShapeDisplayObject } from "../types.js";
import type { Timeline } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Shape for use in ShapeDisplayObject fixtures. */
const emptyShape = { id: "shape-1", paths: [] } as const;

/** Build a ShapeDisplayObject at the given coordinates. */
function makeShapeDO(id: string, x: number, y: number): ShapeDisplayObject {
  return { type: "shape", id, shape: emptyShape, x, y };
}

/** Build a Timeline with one layer whose frame 0 is a keyframe with the given display objects. */
function makeTimelineWithContent(
  displayObjects: readonly ShapeDisplayObject[]
): Timeline {
  const frame0 = createFrame(0, {
    isKeyframe: true,
    isEmpty: displayObjects.length === 0,
    displayObjects,
  });
  const layer = createLayer("Layer 1", "normal", { frames: [frame0], frameCount: 1 });
  return createTimeline({ layers: [layer] });
}

/** Get the only layer from the timeline. */
function layer0(tl: Timeline) {
  return tl.layers[0]!;
}

/** Find the frame at the given index in the only layer. */
function frameAt(tl: Timeline, idx: number) {
  return layer0(tl).frames.find((f) => f.index === idx);
}

// ---------------------------------------------------------------------------
// 1. insertKeyframe copies content from the governing keyframe
// ---------------------------------------------------------------------------

describe("insertKeyframe — copies content from governing keyframe", () => {
  it("new keyframe at position 2 has the same display objects as frame 0", () => {
    const shape = makeShapeDO("do-1", 10, 20);
    const tl = makeTimelineWithContent([shape]);
    const layerId = layer0(tl).id;

    const result = insertKeyframe(tl, layerId, 2);
    const newFrame = frameAt(result, 2);

    expect(newFrame).toBeDefined();
    expect(newFrame!.isKeyframe).toBe(true);
    expect(newFrame!.displayObjects).toHaveLength(1);

    const copied = newFrame!.displayObjects[0] as ShapeDisplayObject;
    expect(copied.type).toBe("shape");
    expect(copied.x).toBe(10);
    expect(copied.y).toBe(20);
  });

  it("copied display objects are independent from the original (deep copy)", () => {
    const shape = makeShapeDO("do-1", 10, 20);
    const tl = makeTimelineWithContent([shape]);
    const layerId = layer0(tl).id;

    const result = insertKeyframe(tl, layerId, 2);

    // The object at frame 2 should not be the same reference as frame 0's object
    const original = frameAt(result, 0)!.displayObjects[0];
    const copied = frameAt(result, 2)!.displayObjects[0];
    expect(copied).not.toBe(original);
  });
});

// ---------------------------------------------------------------------------
// 2. insertKeyframe between two existing keyframes copies from the previous one
// ---------------------------------------------------------------------------

describe("insertKeyframe — between two keyframes copies from previous", () => {
  it("inserts at frame 2 between frame 0 (with content) and frame 4 (with different content)", () => {
    const shapeAtFrame0 = makeShapeDO("do-0", 5, 5);
    const shapeAtFrame4 = makeShapeDO("do-4", 100, 100);

    const frame0 = createFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      displayObjects: [shapeAtFrame0],
    });
    const frame4 = createFrame(4, {
      isKeyframe: true,
      isEmpty: false,
      displayObjects: [shapeAtFrame4],
    });
    const layer = createLayer("Layer 1", "normal", {
      frames: [frame0, frame4],
      frameCount: 5,
    });
    const tl = createTimeline({ layers: [layer] });
    const layerId = layer0(tl).id;

    const result = insertKeyframe(tl, layerId, 2);
    const newFrame = frameAt(result, 2);

    expect(newFrame).toBeDefined();
    expect(newFrame!.isKeyframe).toBe(true);
    // Should copy from frame 0 (the governing keyframe), not frame 4
    expect(newFrame!.displayObjects).toHaveLength(1);
    const copied = newFrame!.displayObjects[0] as ShapeDisplayObject;
    expect(copied.x).toBe(5);
    expect(copied.y).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 3. insertKeyframe creates a non-blank keyframe (isEmpty=false when source has content)
// ---------------------------------------------------------------------------

describe("insertKeyframe — creates a non-blank keyframe", () => {
  it("new keyframe has isEmpty=false when governing keyframe has content", () => {
    const shape = makeShapeDO("do-1", 10, 20);
    const tl = makeTimelineWithContent([shape]);
    const layerId = layer0(tl).id;

    const result = insertKeyframe(tl, layerId, 3);
    const newFrame = frameAt(result, 3);

    expect(newFrame!.isKeyframe).toBe(true);
    expect(newFrame!.isEmpty).toBe(false);
  });

  it("new keyframe inherits isEmpty=true when governing keyframe is empty", () => {
    // Frame 0 is empty (default)
    const tl = makeTimelineWithContent([]);
    const layerId = layer0(tl).id;

    const result = insertKeyframe(tl, layerId, 3);
    const newFrame = frameAt(result, 3);

    expect(newFrame!.isKeyframe).toBe(true);
    expect(newFrame!.isEmpty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. insertBlankKeyframe always creates an empty keyframe
// ---------------------------------------------------------------------------

describe("insertBlankKeyframe — always creates an empty keyframe", () => {
  it("new blank keyframe at position 2 has isEmpty=true and no display objects", () => {
    const shape = makeShapeDO("do-1", 10, 20);
    const tl = makeTimelineWithContent([shape]);
    const layerId = layer0(tl).id;

    const result = insertBlankKeyframe(tl, layerId, 2);
    const newFrame = frameAt(result, 2);

    expect(newFrame).toBeDefined();
    expect(newFrame!.isKeyframe).toBe(true);
    expect(newFrame!.isEmpty).toBe(true);
    expect(newFrame!.displayObjects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. insertBlankKeyframe vs insertKeyframe differ in content
// ---------------------------------------------------------------------------

describe("insertBlankKeyframe vs insertKeyframe — different content", () => {
  it("blank keyframe has no objects while regular keyframe copies them", () => {
    const shape = makeShapeDO("do-1", 10, 20);
    const tl = makeTimelineWithContent([shape]);
    const layerId = layer0(tl).id;

    const regularResult = insertKeyframe(tl, layerId, 2);
    const blankResult = insertBlankKeyframe(tl, layerId, 2);

    const regularFrame = frameAt(regularResult, 2)!;
    const blankFrame = frameAt(blankResult, 2)!;

    // Regular keyframe copies content
    expect(regularFrame.displayObjects).toHaveLength(1);
    expect(regularFrame.isEmpty).toBe(false);

    // Blank keyframe is empty
    expect(blankFrame.displayObjects).toHaveLength(0);
    expect(blankFrame.isEmpty).toBe(true);
  });
});
