import { describe, it, expect } from "vitest";
import {
  createLayer,
  createFrame,
  insertFrame,
  insertKeyframe,
  insertBlankKeyframe,
  removeFrame,
  layerFrameCount,
  createTimeline,
  convertToKeyframes,
  reverseFrames,
} from "../timeline.js";
import type { Timeline } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTimeline(layer: ReturnType<typeof createLayer>): Timeline {
  return { layers: [layer] };
}

// ---------------------------------------------------------------------------
// layerFrameCount
// ---------------------------------------------------------------------------

describe("layerFrameCount", () => {
  it("returns frameCount field when present", () => {
    const layer = createLayer("L", "normal", { frameCount: 10 });
    expect(layerFrameCount(layer)).toBe(10);
  });

  it("falls back to max keyframe index + 1 when frameCount is missing", () => {
    // Simulate a legacy layer without explicit frameCount by constructing manually
    const layer = createLayer("L");
    const legacyLayer = {
      ...layer,
      frames: [
        createFrame(0),
        createFrame(4),
        createFrame(9),
      ],
      frameCount: undefined as unknown as number,
    };
    expect(layerFrameCount(legacyLayer)).toBe(10); // max index 9 + 1
  });

  it("returns 1 at minimum for an empty frames array", () => {
    const layer = createLayer("L");
    const emptyLayer = {
      ...layer,
      frames: [],
      frameCount: undefined as unknown as number,
    };
    expect(layerFrameCount(emptyLayer)).toBe(1);
  });

  it("returns at least 1 even if frameCount is 0", () => {
    const layer = createLayer("L", "normal", { frameCount: 0 });
    expect(layerFrameCount(layer)).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// insertFrame (F5)
// ---------------------------------------------------------------------------

describe("insertFrame (F5)", () => {
  it("extends frameCount by 1 when inserting at end", () => {
    const layer = createLayer("L"); // frameCount=1, keyframe at 0
    const tl = makeTimeline(layer);
    const result = insertFrame(tl, layer.id, 0);
    const resultLayer = result.layers[0]!;
    expect(layerFrameCount(resultLayer)).toBe(2);
  });

  it("shifts keyframes at or after the insert index", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(5)],
      frameCount: 10,
    });
    const tl = makeTimeline(layer);
    const result = insertFrame(tl, layer.id, 3);
    const resultLayer = result.layers[0]!;
    // Keyframe at 0 should stay; keyframe at 5 should move to 6
    const indices = resultLayer.frames.map((f) => f.index);
    expect(indices).toContain(0);
    expect(indices).toContain(6);
    expect(indices).not.toContain(5);
  });

  it("does not shift keyframes before the insert index", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(3), createFrame(7)],
      frameCount: 10,
    });
    const tl = makeTimeline(layer);
    const result = insertFrame(tl, layer.id, 5);
    const resultLayer = result.layers[0]!;
    const indices = resultLayer.frames.map((f) => f.index);
    // Frame at 0 and 3 stay; frame at 7 shifts to 8
    expect(indices).toContain(0);
    expect(indices).toContain(3);
    expect(indices).toContain(8);
    expect(indices).not.toContain(7);
  });

  it("extending past layer end sets frameCount correctly", () => {
    const layer = createLayer("L"); // frameCount=1
    const tl = makeTimeline(layer);
    // Insert at index 9 (well beyond current end)
    const result = insertFrame(tl, layer.id, 9);
    const resultLayer = result.layers[0]!;
    expect(layerFrameCount(resultLayer)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// insertKeyframe (F6)
// ---------------------------------------------------------------------------

describe("insertKeyframe (F6)", () => {
  it("does not shift existing keyframes", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(5)],
      frameCount: 10,
    });
    const tl = makeTimeline(layer);
    const result = insertKeyframe(tl, layer.id, 3);
    const resultLayer = result.layers[0]!;
    const indices = resultLayer.frames.map((f) => f.index);
    // Original keyframes at 0 and 5 must not shift
    expect(indices).toContain(0);
    expect(indices).toContain(5);
    // New keyframe at 3
    expect(indices).toContain(3);
  });

  it("copies display objects from governing keyframe", () => {
    const obj = { type: "shape" as const, id: "s1", shape: { id: "sh1", paths: [] }, x: 10, y: 20 };
    const startFrame = createFrame(0, { displayObjects: [obj], isEmpty: false });
    const layer = createLayer("L", "normal", {
      frames: [startFrame],
      frameCount: 5,
    });
    const tl = makeTimeline(layer);
    const result = insertKeyframe(tl, layer.id, 3);
    const resultLayer = result.layers[0]!;
    const kf3 = resultLayer.frames.find((f) => f.index === 3);
    expect(kf3).toBeDefined();
    expect(kf3!.isKeyframe).toBe(true);
    // Display objects should be copied (shallow copy — same structure)
    expect(kf3!.displayObjects).toHaveLength(1);
    expect(kf3!.displayObjects[0]!.id).toBe("s1");
  });

  it("is a no-op if frame already has a keyframe", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(3)],
      frameCount: 5,
    });
    const tl = makeTimeline(layer);
    const result = insertKeyframe(tl, layer.id, 3);
    const resultLayer = result.layers[0]!;
    // Frame count should be unchanged
    expect(resultLayer.frames).toHaveLength(2);
  });

  it("extends frameCount when inserting beyond current duration", () => {
    const layer = createLayer("L"); // frameCount=1
    const tl = makeTimeline(layer);
    const result = insertKeyframe(tl, layer.id, 9);
    const resultLayer = result.layers[0]!;
    expect(layerFrameCount(resultLayer)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// insertBlankKeyframe (F7)
// ---------------------------------------------------------------------------

describe("insertBlankKeyframe (F7)", () => {
  it("creates empty keyframe at index, does not shift existing keyframes", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(5)],
      frameCount: 10,
    });
    const tl = makeTimeline(layer);
    const result = insertBlankKeyframe(tl, layer.id, 3);
    const resultLayer = result.layers[0]!;
    const indices = resultLayer.frames.map((f) => f.index);
    expect(indices).toContain(0);
    expect(indices).toContain(3);
    expect(indices).toContain(5);
    // New keyframe should be empty
    const kf3 = resultLayer.frames.find((f) => f.index === 3);
    expect(kf3!.isEmpty).toBe(true);
    expect(kf3!.displayObjects).toHaveLength(0);
  });

  it("extends frameCount if beyond current layer end", () => {
    const layer = createLayer("L"); // frameCount=1
    const tl = makeTimeline(layer);
    const result = insertBlankKeyframe(tl, layer.id, 7);
    const resultLayer = result.layers[0]!;
    expect(layerFrameCount(resultLayer)).toBe(8);
  });

  it("is a no-op if frame already has a keyframe", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(3)],
      frameCount: 5,
    });
    const tl = makeTimeline(layer);
    const result = insertBlankKeyframe(tl, layer.id, 3);
    const resultLayer = result.layers[0]!;
    expect(resultLayer.frames).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// removeFrame (Shift+F5)
// ---------------------------------------------------------------------------

describe("removeFrame (Shift+F5)", () => {
  it("decrements frameCount", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(3)],
      frameCount: 5,
    });
    const tl = makeTimeline(layer);
    const result = removeFrame(tl, layer.id, 4);
    const resultLayer = result.layers[0]!;
    expect(layerFrameCount(resultLayer)).toBe(4);
  });

  it("is a no-op on single-frame layer", () => {
    const layer = createLayer("L"); // frameCount=1
    const tl = makeTimeline(layer);
    const result = removeFrame(tl, layer.id, 0);
    const resultLayer = result.layers[0]!;
    expect(layerFrameCount(resultLayer)).toBe(1);
    expect(resultLayer.frames).toHaveLength(1);
  });

  it("keyframe at 0 is always preserved", () => {
    // Layer with only one keyframe at frame 0, 3 frames total
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0)],
      frameCount: 3,
    });
    const tl = makeTimeline(layer);
    // Remove frame 0 — shifts everything left, keyframe at 0 should still exist
    const result = removeFrame(tl, layer.id, 0);
    const resultLayer = result.layers[0]!;
    const frame0kf = resultLayer.frames.find((f) => f.index === 0 && f.isKeyframe);
    expect(frame0kf).toBeDefined();
  });

  it("shifts keyframes after removed index left by 1", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(3), createFrame(6)],
      frameCount: 8,
    });
    const tl = makeTimeline(layer);
    const result = removeFrame(tl, layer.id, 3);
    const resultLayer = result.layers[0]!;
    const indices = resultLayer.frames.map((f) => f.index);
    expect(indices).toContain(0);
    // keyframe at 6 should shift to 5
    expect(indices).toContain(5);
    expect(indices).not.toContain(6);
  });
});

// ---------------------------------------------------------------------------
// convertToKeyframes
// ---------------------------------------------------------------------------

describe("convertToKeyframes", () => {
  it("converts span frames in range to keyframes", () => {
    // Layer: keyframe at 0 and 5; span frames 1-4 are implicit
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(5)],
      frameCount: 8,
    });
    const tl = makeTimeline(layer);
    const result = convertToKeyframes(tl, layer.id, 1, 3);
    const resultLayer = result.layers[0]!;
    const indices = resultLayer.frames.map((f) => f.index);
    // Span frames 1, 2, 3 should now be keyframes
    expect(indices).toContain(1);
    expect(indices).toContain(2);
    expect(indices).toContain(3);
    // All should be keyframes
    for (const i of [1, 2, 3]) {
      const f = resultLayer.frames.find((fr) => fr.index === i);
      expect(f?.isKeyframe).toBe(true);
    }
    // Existing keyframes unchanged
    expect(indices).toContain(0);
    expect(indices).toContain(5);
  });

  it("copies display objects from governing keyframe", () => {
    const obj = { type: "shape" as const, id: "s1", shape: { id: "sh1", paths: [] }, x: 0, y: 0 };
    const kf0 = createFrame(0, { displayObjects: [obj], isEmpty: false });
    const layer = createLayer("L", "normal", {
      frames: [kf0],
      frameCount: 5,
    });
    const tl = makeTimeline(layer);
    const result = convertToKeyframes(tl, layer.id, 2, 3);
    const resultLayer = result.layers[0]!;
    for (const i of [2, 3]) {
      const f = resultLayer.frames.find((fr) => fr.index === i);
      expect(f?.displayObjects).toHaveLength(1);
      expect(f?.displayObjects[0]?.id).toBe("s1");
    }
  });

  it("is a no-op for frames that are already keyframes", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(1), createFrame(2)],
      frameCount: 5,
    });
    const tl = makeTimeline(layer);
    const result = convertToKeyframes(tl, layer.id, 0, 2);
    const resultLayer = result.layers[0]!;
    // Frame count should not change — all were already keyframes
    expect(resultLayer.frames).toHaveLength(3);
  });

  it("does not affect frames outside the range", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(5)],
      frameCount: 8,
    });
    const tl = makeTimeline(layer);
    const result = convertToKeyframes(tl, layer.id, 1, 2);
    const resultLayer = result.layers[0]!;
    // Frame 3 and 4 should still not be keyframes
    const f3 = resultLayer.frames.find((f) => f.index === 3);
    const f4 = resultLayer.frames.find((f) => f.index === 4);
    expect(f3).toBeUndefined();
    expect(f4).toBeUndefined();
  });

  it("does not shift frame indices or change frameCount for in-range conversion", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(5)],
      frameCount: 6,
    });
    const tl = makeTimeline(layer);
    const result = convertToKeyframes(tl, layer.id, 2, 4);
    const resultLayer = result.layers[0]!;
    expect(layerFrameCount(resultLayer)).toBe(6);
    // Frame 5 must not shift
    const f5 = resultLayer.frames.find((f) => f.index === 5);
    expect(f5?.isKeyframe).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reverseFrames
// ---------------------------------------------------------------------------

describe("reverseFrames", () => {
  it("reverses display objects across a keyframe range", () => {
    const obj1 = { type: "shape" as const, id: "a", shape: { id: "sh1", paths: [] }, x: 0, y: 0 };
    const obj2 = { type: "shape" as const, id: "b", shape: { id: "sh2", paths: [] }, x: 1, y: 1 };
    const kf0 = createFrame(0, { displayObjects: [obj1], isEmpty: false });
    const kf2 = createFrame(2, { displayObjects: [obj2], isEmpty: false });
    const layer = createLayer("L", "normal", {
      frames: [kf0, kf2],
      frameCount: 4,
    });
    const tl = makeTimeline(layer);
    const result = reverseFrames(tl, layer.id, 0, 2);
    const resultLayer = result.layers[0]!;
    // After reversal: frame 0 should have obj2, frame 2 should have obj1
    const f0 = resultLayer.frames.find((f) => f.index === 0);
    const f2 = resultLayer.frames.find((f) => f.index === 2);
    expect(f0?.displayObjects[0]?.id).toBe("b");
    expect(f2?.displayObjects[0]?.id).toBe("a");
  });

  it("promotes span frames to keyframes before reversing", () => {
    const obj = { type: "shape" as const, id: "x", shape: { id: "sh1", paths: [] }, x: 0, y: 0 };
    const kf0 = createFrame(0, { displayObjects: [obj], isEmpty: false });
    const layer = createLayer("L", "normal", {
      frames: [kf0],
      frameCount: 3,
    });
    const tl = makeTimeline(layer);
    // Frame 1 and 2 are span frames. reverseFrames should promote them first.
    const result = reverseFrames(tl, layer.id, 0, 2);
    const resultLayer = result.layers[0]!;
    // All three indices should be keyframes
    for (const i of [0, 1, 2]) {
      const f = resultLayer.frames.find((fr) => fr.index === i);
      expect(f?.isKeyframe).toBe(true);
    }
  });

  it("is a no-op for a single keyframe (nothing to reverse)", () => {
    const obj = { type: "shape" as const, id: "z", shape: { id: "sh1", paths: [] }, x: 5, y: 5 };
    const kf0 = createFrame(0, { displayObjects: [obj], isEmpty: false });
    const layer = createLayer("L", "normal", {
      frames: [kf0],
      frameCount: 1,
    });
    const tl = makeTimeline(layer);
    const result = reverseFrames(tl, layer.id, 0, 0);
    const resultLayer = result.layers[0]!;
    const f0 = resultLayer.frames.find((f) => f.index === 0);
    expect(f0?.displayObjects[0]?.id).toBe("z");
  });

  it("does not affect frames outside the reversed range", () => {
    const obj1 = { type: "shape" as const, id: "p", shape: { id: "sh1", paths: [] }, x: 0, y: 0 };
    const obj2 = { type: "shape" as const, id: "q", shape: { id: "sh2", paths: [] }, x: 1, y: 1 };
    const obj3 = { type: "shape" as const, id: "r", shape: { id: "sh3", paths: [] }, x: 2, y: 2 };
    const kf0 = createFrame(0, { displayObjects: [obj1], isEmpty: false });
    const kf2 = createFrame(2, { displayObjects: [obj2], isEmpty: false });
    const kf4 = createFrame(4, { displayObjects: [obj3], isEmpty: false });
    const layer = createLayer("L", "normal", {
      frames: [kf0, kf2, kf4],
      frameCount: 5,
    });
    const tl = makeTimeline(layer);
    // Reverse only frames 0-2
    const result = reverseFrames(tl, layer.id, 0, 2);
    const resultLayer = result.layers[0]!;
    // Frame 4 should be unchanged
    const f4 = resultLayer.frames.find((f) => f.index === 4);
    expect(f4?.displayObjects[0]?.id).toBe("r");
  });

  it("reverses tween type along with displayObjects", () => {
    const kf0 = createFrame(0, { tweenType: "motion" });
    const kf3 = createFrame(3, { tweenType: "none" });
    const layer = createLayer("L", "normal", {
      frames: [kf0, kf3],
      frameCount: 4,
    });
    const tl = makeTimeline(layer);
    const result = reverseFrames(tl, layer.id, 0, 3);
    const resultLayer = result.layers[0]!;
    const f0 = resultLayer.frames.find((f) => f.index === 0);
    const f3 = resultLayer.frames.find((f) => f.index === 3);
    expect(f0?.tweenType).toBe("none");
    expect(f3?.tweenType).toBe("motion");
  });
});
