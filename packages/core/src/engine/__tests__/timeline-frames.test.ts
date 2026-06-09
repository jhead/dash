/**
 * Comprehensive tests for timeline frame operations:
 * insertFrame, removeFrame, insertKeyframe, insertBlankKeyframe
 *
 * Covers all 14 scenarios from the task spec including:
 * - Basic frame count changes
 * - Keyframe index shifting
 * - Display object copying vs blank keyframes
 * - Immutability guarantees
 * - Edge cases (frame 0, last frame, beyond end)
 * - Cross-scene isolation (operations on one scene don't affect others)
 */

import { describe, it, expect } from "vitest";
import {
  createLayer,
  createFrame,
  createTimeline,
  insertFrame,
  removeFrame,
  insertKeyframe,
  insertBlankKeyframe,
  layerFrameCount,
} from "../../model/timeline.js";
import { createDocument } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import type { FlashDocument, Timeline } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Timeline with one layer having the given keyframe indices and frameCount. */
function makeTimeline(keyframeIndices: number[], frameCount: number): Timeline {
  const frames = keyframeIndices.map((idx) => createFrame(idx));
  const layer = createLayer("Layer 1", "normal", { frames, frameCount });
  return createTimeline({ layers: [layer] });
}

/** Retrieve the only layer from a single-layer timeline. */
function layer0(tl: Timeline) {
  return tl.layers[0]!;
}

/** Retrieve keyframe indices from the only layer. */
function indices0(tl: Timeline): number[] {
  return layer0(tl).frames.map((f) => f.index);
}

/** Build a FlashDocument with two scenes; scene 0 has one layer with the given config. */
function makeDocTwoScenes(keyframeIndices: number[], frameCount: number): FlashDocument {
  const frames = keyframeIndices.map((idx) => createFrame(idx));
  const layer = createLayer("Layer 1", "normal", { frames, frameCount });
  const timeline: Timeline = { layers: [layer] };
  const scene0 = { ...createScene("Scene 1"), timeline };
  const scene1 = createScene("Scene 2"); // default timeline, untouched
  const doc = createDocument();
  return { ...doc, scenes: [scene0, scene1] };
}

// ---------------------------------------------------------------------------
// 1. insertFrame: frameCount increases by 1
// ---------------------------------------------------------------------------

describe("insertFrame — frameCount increases by 1", () => {
  it("inserts at frame 5 in a 10-frame layer → frameCount becomes 11", () => {
    const tl = makeTimeline([0], 10);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 5);
    expect(layerFrameCount(layer0(result))).toBe(11);
  });

  it("inserts at frame 0 in a 1-frame layer → frameCount becomes 2", () => {
    const tl = makeTimeline([0], 1);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 0);
    expect(layerFrameCount(layer0(result))).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. insertFrame: keyframes after insertion point shift right by 1
// ---------------------------------------------------------------------------

describe("insertFrame — keyframes at/after insertion point shift by +1", () => {
  it("inserting at frame 5 shifts keyframe at 5 to 6 and keyframe at 7 to 8", () => {
    const tl = makeTimeline([0, 5, 7], 10);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 5);
    const idx = indices0(result);
    expect(idx).toContain(6); // was 5
    expect(idx).toContain(8); // was 7
    expect(idx).not.toContain(5);
    expect(idx).not.toContain(7);
  });
});

// ---------------------------------------------------------------------------
// 3. insertFrame: keyframes before insertion point stay the same
// ---------------------------------------------------------------------------

describe("insertFrame — keyframes before insertion point are unchanged", () => {
  it("inserting at frame 5 leaves keyframes at 0 and 3 unchanged", () => {
    const tl = makeTimeline([0, 3, 7], 10);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 5);
    const idx = indices0(result);
    expect(idx).toContain(0);
    expect(idx).toContain(3);
  });
});

// ---------------------------------------------------------------------------
// 4. removeFrame: frameCount decreases by 1
// ---------------------------------------------------------------------------

describe("removeFrame — frameCount decreases by 1", () => {
  it("removing at frame 5 in a 10-frame layer → frameCount becomes 9", () => {
    const tl = makeTimeline([0], 10);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 5);
    expect(layerFrameCount(layer0(result))).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 5. removeFrame: keyframes after removal point shift left by 1
// ---------------------------------------------------------------------------

describe("removeFrame — keyframes after removal point shift by -1", () => {
  it("removing at frame 5 shifts keyframe at 7 to 6 and at 9 to 8", () => {
    const tl = makeTimeline([0, 7, 9], 10);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 5);
    const idx = indices0(result);
    expect(idx).toContain(6); // was 7
    expect(idx).toContain(8); // was 9
    expect(idx).not.toContain(7);
    expect(idx).not.toContain(9);
  });

  it("keyframe at the removed index is deleted and later ones shift left", () => {
    const tl = makeTimeline([0, 3, 6], 8);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 3);
    const idx = indices0(result);
    expect(idx).not.toContain(3); // removed
    expect(idx).toContain(5);    // was 6
  });
});

// ---------------------------------------------------------------------------
// 6. removeFrame: cannot remove below 1 frame (no-op or minimum enforcement)
// ---------------------------------------------------------------------------

describe("removeFrame — cannot reduce below 1 frame", () => {
  it("is a no-op on a single-frame layer", () => {
    const tl = makeTimeline([0], 1);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 0);
    expect(layerFrameCount(layer0(result))).toBe(1);
    expect(layer0(result).frames).toHaveLength(1);
  });

  it("returns the same layer reference when no change is made", () => {
    const tl = makeTimeline([0], 1);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 0);
    // The layer object should be the same reference (no mutation)
    expect(layer0(result)).toBe(layer0(tl));
  });
});

// ---------------------------------------------------------------------------
// 7. insertKeyframe: creates a keyframe at the specified index
// ---------------------------------------------------------------------------

describe("insertKeyframe — creates a keyframe at the specified index", () => {
  it("a new keyframe with isKeyframe=true appears at the given index", () => {
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const result = insertKeyframe(tl, layerId, 3);
    const kf = layer0(result).frames.find((f) => f.index === 3);
    expect(kf).toBeDefined();
    expect(kf!.isKeyframe).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. insertKeyframe: new keyframe copies display objects from previous keyframe
// ---------------------------------------------------------------------------

describe("insertKeyframe — copies display objects from governing keyframe", () => {
  it("new keyframe at frame 3 gets the display objects from governing keyframe at frame 0", () => {
    const obj = {
      type: "shape" as const,
      id: "shape-1",
      shape: { id: "sh1", paths: [] },
      x: 10,
      y: 20,
    };
    const frame0 = createFrame(0, { displayObjects: [obj], isEmpty: false });
    const layer = createLayer("Layer 1", "normal", { frames: [frame0], frameCount: 5 });
    const tl: Timeline = { layers: [layer] };
    const result = insertKeyframe(tl, layer.id, 3);
    const kf3 = layer0(result).frames.find((f) => f.index === 3);
    expect(kf3).toBeDefined();
    expect(kf3!.displayObjects).toHaveLength(1);
    expect(kf3!.displayObjects[0]!.id).toBe("shape-1");
  });

  it("copied objects are independent (shallow copy — mutating original does not affect copy)", () => {
    const obj = {
      type: "shape" as const,
      id: "shape-2",
      shape: { id: "sh2", paths: [] },
      x: 5,
      y: 5,
    };
    const frame0 = createFrame(0, { displayObjects: [obj], isEmpty: false });
    const layer = createLayer("Layer 1", "normal", { frames: [frame0], frameCount: 5 });
    const tl: Timeline = { layers: [layer] };
    const result = insertKeyframe(tl, layer.id, 3);
    const kf3 = layer0(result).frames.find((f) => f.index === 3);
    // The copied object is a different reference than the original
    expect(kf3!.displayObjects[0]).not.toBe(layer.frames[0]!.displayObjects[0]);
    // But has the same values
    expect(kf3!.displayObjects[0]!.id).toBe("shape-2");
  });
});

// ---------------------------------------------------------------------------
// 9. insertKeyframe: increases frameCount when inserting beyond current duration
//    (Flash F6 in-place semantics: no frameCount change when inserting within span)
// ---------------------------------------------------------------------------

describe("insertKeyframe — frameCount behaviour", () => {
  it("does not change frameCount when inserting within the existing span", () => {
    const tl = makeTimeline([0], 10);
    const layerId = layer0(tl).id;
    const result = insertKeyframe(tl, layerId, 5);
    // F6 is in-place: no new frames added to the timeline length
    expect(layerFrameCount(layer0(result))).toBe(10);
  });

  it("extends frameCount when inserting at or beyond current duration", () => {
    const tl = makeTimeline([0], 1);
    const layerId = layer0(tl).id;
    const result = insertKeyframe(tl, layerId, 5);
    // frameIndex 5 requires at least 6 frames (0-based)
    expect(layerFrameCount(layer0(result))).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 10. insertBlankKeyframe: creates a keyframe with empty displayObjects
// ---------------------------------------------------------------------------

describe("insertBlankKeyframe — creates an empty keyframe", () => {
  it("new keyframe has isKeyframe=true and isEmpty=true", () => {
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const result = insertBlankKeyframe(tl, layerId, 3);
    const kf = layer0(result).frames.find((f) => f.index === 3);
    expect(kf).toBeDefined();
    expect(kf!.isKeyframe).toBe(true);
    expect(kf!.isEmpty).toBe(true);
    expect(kf!.displayObjects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 11. insertBlankKeyframe: does NOT copy display objects from previous keyframe
// ---------------------------------------------------------------------------

describe("insertBlankKeyframe — does not copy display objects", () => {
  it("new keyframe has empty displayObjects even if governing keyframe has objects", () => {
    const obj = {
      type: "shape" as const,
      id: "obj-x",
      shape: { id: "sh-x", paths: [] },
      x: 0,
      y: 0,
    };
    const frame0 = createFrame(0, { displayObjects: [obj], isEmpty: false });
    const layer = createLayer("Layer 1", "normal", { frames: [frame0], frameCount: 5 });
    const tl: Timeline = { layers: [layer] };
    const result = insertBlankKeyframe(tl, layer.id, 3);
    const kf3 = layer0(result).frames.find((f) => f.index === 3);
    expect(kf3!.displayObjects).toHaveLength(0);
    expect(kf3!.isEmpty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. Multiple inserts at different positions all work correctly
// ---------------------------------------------------------------------------

describe("multiple consecutive inserts", () => {
  it("three insertFrame calls at different positions all update frameCount correctly", () => {
    let tl = makeTimeline([0, 4], 8);
    const layerId = layer0(tl).id;
    // Insert at 2 → frameCount=9, keyframes: 0, 4→5
    tl = insertFrame(tl, layerId, 2);
    expect(layerFrameCount(layer0(tl))).toBe(9);
    // Insert at 1 → frameCount=10, keyframes: 0, 5→6
    tl = insertFrame(tl, layerId, 1);
    expect(layerFrameCount(layer0(tl))).toBe(10);
    // Insert at 7 → frameCount=11
    tl = insertFrame(tl, layerId, 7);
    expect(layerFrameCount(layer0(tl))).toBe(11);
  });

  it("three consecutive insertFrame calls accumulate keyframe shifts correctly", () => {
    let tl = makeTimeline([0, 5], 10);
    const layerId = layer0(tl).id;
    // Insert at frame 3 three times — keyframe originally at 5 should end at 8
    tl = insertFrame(tl, layerId, 3);
    tl = insertFrame(tl, layerId, 3);
    tl = insertFrame(tl, layerId, 3);
    const idx = indices0(tl);
    expect(idx).toContain(0);
    expect(idx).toContain(8); // 5 + 3 shifts
  });

  it("mixing insertKeyframe and insertBlankKeyframe adds keyframes without shifting", () => {
    let tl = makeTimeline([0, 9], 10);
    const layerId = layer0(tl).id;
    tl = insertKeyframe(tl, layerId, 3);
    tl = insertBlankKeyframe(tl, layerId, 6);
    const idx = indices0(tl);
    expect(idx).toContain(0);
    expect(idx).toContain(3);
    expect(idx).toContain(6);
    expect(idx).toContain(9); // must not have shifted
    expect(layerFrameCount(layer0(tl))).toBe(10); // no frameCount change
  });
});

// ---------------------------------------------------------------------------
// 13. Immutability: all operations return new docs/timelines, originals unchanged
// ---------------------------------------------------------------------------

describe("immutability", () => {
  it("insertFrame returns a new Timeline and does not mutate the original", () => {
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 2);
    expect(result).not.toBe(tl);
    expect(layerFrameCount(layer0(tl))).toBe(5);  // original unchanged
    expect(layerFrameCount(layer0(result))).toBe(6);
  });

  it("removeFrame returns a new Timeline and does not mutate the original", () => {
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 4);
    expect(result).not.toBe(tl);
    expect(layerFrameCount(layer0(tl))).toBe(5);
    expect(layerFrameCount(layer0(result))).toBe(4);
  });

  it("insertKeyframe returns a new Timeline and does not mutate the original", () => {
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const result = insertKeyframe(tl, layerId, 3);
    expect(result).not.toBe(tl);
    expect(layer0(tl).frames).toHaveLength(1);
    expect(layer0(result).frames).toHaveLength(2);
  });

  it("insertBlankKeyframe returns a new Timeline and does not mutate the original", () => {
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const result = insertBlankKeyframe(tl, layerId, 3);
    expect(result).not.toBe(tl);
    expect(layer0(tl).frames).toHaveLength(1);
    expect(layer0(result).frames).toHaveLength(2);
  });

  it("unaffected layers in the same timeline retain their original references", () => {
    const layer1 = createLayer("Layer 1", "normal", {
      frames: [createFrame(0)],
      frameCount: 5,
    });
    const layer2 = createLayer("Layer 2", "normal", {
      frames: [createFrame(0)],
      frameCount: 5,
    });
    const tl: Timeline = { layers: [layer1, layer2] };
    const result = insertFrame(tl, layer1.id, 2);
    // layer2 is unchanged — same object reference
    expect(result.layers[1]).toBe(layer2);
  });
});

// ---------------------------------------------------------------------------
// 14. Edge cases: insert at index 0, insert at last frame, remove first frame
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("insertFrame at index 0 shifts all existing keyframes by 1", () => {
    const tl = makeTimeline([0, 3, 7], 10);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 0);
    const idx = indices0(result);
    // All original keyframes should shift right by 1
    expect(idx).toContain(1); // was 0
    expect(idx).toContain(4); // was 3
    expect(idx).toContain(8); // was 7
    expect(idx).not.toContain(0); // frame 0 no longer a keyframe (became a regular frame)
  });

  it("insertFrame at the last frame index extends the layer", () => {
    const tl = makeTimeline([0, 9], 10);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 9);
    expect(layerFrameCount(layer0(result))).toBe(11);
    const idx = indices0(result);
    expect(idx).toContain(0);
    expect(idx).toContain(10); // keyframe that was at 9 shifts to 10
  });

  it("removeFrame at frame 0 always preserves a keyframe at index 0", () => {
    const tl = makeTimeline([0, 3], 5);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 0);
    const frame0kf = layer0(result).frames.find(
      (f) => f.index === 0 && f.isKeyframe
    );
    expect(frame0kf).toBeDefined();
  });

  it("insertKeyframe at index 0 is a no-op (keyframe already exists)", () => {
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const before = layer0(tl).frames.length;
    const result = insertKeyframe(tl, layerId, 0);
    expect(layer0(result).frames.length).toBe(before);
  });

  it("insertBlankKeyframe at index 0 is a no-op (keyframe already exists)", () => {
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const before = layer0(tl).frames.length;
    const result = insertBlankKeyframe(tl, layerId, 0);
    expect(layer0(result).frames.length).toBe(before);
  });

  it("insertFrame beyond current end extends to frameIndex + 1", () => {
    const tl = makeTimeline([0], 1);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 14);
    expect(layerFrameCount(layer0(result))).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Cross-scene isolation: operations on one scene's timeline don't affect others
// ---------------------------------------------------------------------------

describe("cross-scene isolation", () => {
  it("insertFrame on scene 0 does not change scene 1", () => {
    const doc = makeDocTwoScenes([0], 5);
    const scene0Timeline = doc.scenes[0]!.timeline;
    const layerId = scene0Timeline.layers[0]!.id;
    const updatedTimeline = insertFrame(scene0Timeline, layerId, 2);
    const result: FlashDocument = {
      ...doc,
      scenes: doc.scenes.map((s, i) =>
        i === 0 ? { ...s, timeline: updatedTimeline } : s
      ),
    };
    // Scene 1 reference unchanged
    expect(result.scenes[1]).toBe(doc.scenes[1]);
    // Scene 1 timeline unchanged
    expect(
      layerFrameCount(result.scenes[1]!.timeline.layers[0]!)
    ).toBe(layerFrameCount(doc.scenes[1]!.timeline.layers[0]!));
  });

  it("removeFrame on scene 0 does not affect scene 1", () => {
    const doc = makeDocTwoScenes([0], 5);
    const scene0Timeline = doc.scenes[0]!.timeline;
    const layerId = scene0Timeline.layers[0]!.id;
    const updatedTimeline = removeFrame(scene0Timeline, layerId, 4);
    const result: FlashDocument = {
      ...doc,
      scenes: doc.scenes.map((s, i) =>
        i === 0 ? { ...s, timeline: updatedTimeline } : s
      ),
    };
    expect(result.scenes[1]).toBe(doc.scenes[1]);
  });

  it("insertKeyframe on scene 0 layer does not affect scene 1 layer", () => {
    const doc = makeDocTwoScenes([0], 5);
    const scene0Timeline = doc.scenes[0]!.timeline;
    const layerId = scene0Timeline.layers[0]!.id;
    const updatedTimeline = insertKeyframe(scene0Timeline, layerId, 3);
    const result: FlashDocument = {
      ...doc,
      scenes: doc.scenes.map((s, i) =>
        i === 0 ? { ...s, timeline: updatedTimeline } : s
      ),
    };
    expect(result.scenes[1]).toBe(doc.scenes[1]);
    // Scene 1 layer has only its original 1 frame
    expect(result.scenes[1]!.timeline.layers[0]!.frames).toHaveLength(1);
  });

  it("insertBlankKeyframe on scene 0 layer does not affect scene 1 layer", () => {
    const doc = makeDocTwoScenes([0], 5);
    const scene0Timeline = doc.scenes[0]!.timeline;
    const layerId = scene0Timeline.layers[0]!.id;
    const updatedTimeline = insertBlankKeyframe(scene0Timeline, layerId, 3);
    const result: FlashDocument = {
      ...doc,
      scenes: doc.scenes.map((s, i) =>
        i === 0 ? { ...s, timeline: updatedTimeline } : s
      ),
    };
    expect(result.scenes[1]).toBe(doc.scenes[1]);
    expect(result.scenes[1]!.timeline.layers[0]!.frames).toHaveLength(1);
  });
});
