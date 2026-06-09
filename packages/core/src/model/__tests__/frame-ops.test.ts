/**
 * Comprehensive tests for frame-level timeline operations:
 * insertFrame, removeFrame, insertKeyframe, insertBlankKeyframe
 *
 * Uses a document-level helper pattern: (doc, sceneIdx, layerIdx, atFrame)
 * matching the signature style described in the task spec.
 */

import { describe, it, expect } from "vitest";
import {
  createDocument,
  createFrame,
  createLayer,
  createScene,
  insertFrame,
  removeFrame,
  insertKeyframe,
  insertBlankKeyframe,
  layerFrameCount,
  addLayer,
} from "../index.js";
import type { FlashDocument, Timeline } from "../types.js";

// ---------------------------------------------------------------------------
// Document-level helpers that mirror the (doc, sceneIdx, layerIdx, atFrame) API
// ---------------------------------------------------------------------------

function getLayer(doc: FlashDocument, sceneIdx: number, layerIdx: number) {
  return doc.scenes[sceneIdx]!.timeline.layers[layerIdx]!;
}

function docInsertFrame(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  atFrame: number
): FlashDocument {
  const layer = getLayer(doc, sceneIdx, layerIdx);
  const updatedTimeline = insertFrame(
    doc.scenes[sceneIdx]!.timeline,
    layer.id,
    atFrame
  );
  return {
    ...doc,
    scenes: doc.scenes.map((s, i) =>
      i === sceneIdx ? { ...s, timeline: updatedTimeline } : s
    ),
  };
}

function docRemoveFrame(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  atFrame: number
): FlashDocument {
  const layer = getLayer(doc, sceneIdx, layerIdx);
  const updatedTimeline = removeFrame(
    doc.scenes[sceneIdx]!.timeline,
    layer.id,
    atFrame
  );
  return {
    ...doc,
    scenes: doc.scenes.map((s, i) =>
      i === sceneIdx ? { ...s, timeline: updatedTimeline } : s
    ),
  };
}

function docInsertKeyframe(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  atFrame: number
): FlashDocument {
  const layer = getLayer(doc, sceneIdx, layerIdx);
  const updatedTimeline = insertKeyframe(
    doc.scenes[sceneIdx]!.timeline,
    layer.id,
    atFrame
  );
  return {
    ...doc,
    scenes: doc.scenes.map((s, i) =>
      i === sceneIdx ? { ...s, timeline: updatedTimeline } : s
    ),
  };
}

function docInsertBlankKeyframe(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  atFrame: number
): FlashDocument {
  const layer = getLayer(doc, sceneIdx, layerIdx);
  const updatedTimeline = insertBlankKeyframe(
    doc.scenes[sceneIdx]!.timeline,
    layer.id,
    atFrame
  );
  return {
    ...doc,
    scenes: doc.scenes.map((s, i) =>
      i === sceneIdx ? { ...s, timeline: updatedTimeline } : s
    ),
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Create a document with a single scene and a layer that has the given
 * keyframe indices and a specified frameCount.
 */
function makeDocWithLayer(keyframeIndices: number[], frameCount: number): FlashDocument {
  const frames = keyframeIndices.map((idx) => createFrame(idx));
  const layer = createLayer("Layer 1", "normal", { frames, frameCount });
  const timeline: Timeline = { layers: [layer] };
  const scene = createScene("Scene 1");
  const sceneWithLayer = { ...scene, timeline };
  const doc = createDocument();
  return { ...doc, scenes: [sceneWithLayer] };
}

// ---------------------------------------------------------------------------
// insertFrame
// ---------------------------------------------------------------------------

describe("insertFrame", () => {
  it("increases frameCount by 1", () => {
    const doc = makeDocWithLayer([0], 5);
    const result = docInsertFrame(doc, 0, 0, 2);
    expect(layerFrameCount(getLayer(result, 0, 0))).toBe(6);
  });

  it("shifts keyframes at or after atFrame right by 1", () => {
    const doc = makeDocWithLayer([0, 3, 7], 10);
    const result = docInsertFrame(doc, 0, 0, 3);
    const indices = getLayer(result, 0, 0).frames.map((f) => f.index);
    // 0 stays; 3 shifts to 4; 7 shifts to 8
    expect(indices).toContain(0);
    expect(indices).toContain(4);
    expect(indices).toContain(8);
    expect(indices).not.toContain(3);
    expect(indices).not.toContain(7);
  });

  it("does not shift keyframes before atFrame", () => {
    const doc = makeDocWithLayer([0, 3], 6);
    const result = docInsertFrame(doc, 0, 0, 5);
    const indices = getLayer(result, 0, 0).frames.map((f) => f.index);
    expect(indices).toContain(0);
    expect(indices).toContain(3);
  });

  it("extends layer to atFrame + 1 when atFrame is beyond current end", () => {
    const doc = makeDocWithLayer([0], 1);
    const result = docInsertFrame(doc, 0, 0, 9);
    expect(layerFrameCount(getLayer(result, 0, 0))).toBe(10);
  });

  it("returns a new FlashDocument (immutable — original unchanged)", () => {
    const doc = makeDocWithLayer([0], 5);
    const result = docInsertFrame(doc, 0, 0, 2);
    // Top-level references differ
    expect(result).not.toBe(doc);
    // Original is unchanged
    expect(layerFrameCount(getLayer(doc, 0, 0))).toBe(5);
    expect(layerFrameCount(getLayer(result, 0, 0))).toBe(6);
  });

  it("does not mutate other scenes", () => {
    const doc = makeDocWithLayer([0], 3);
    // Add a second scene
    const scene2 = createScene("Scene 2");
    const docWithTwo = { ...doc, scenes: [doc.scenes[0]!, scene2] };
    const result = docInsertFrame(docWithTwo, 0, 0, 1);
    // Scene 2 is unchanged reference
    expect(result.scenes[1]).toBe(docWithTwo.scenes[1]);
  });
});

// ---------------------------------------------------------------------------
// removeFrame
// ---------------------------------------------------------------------------

describe("removeFrame", () => {
  it("decreases frameCount by 1", () => {
    const doc = makeDocWithLayer([0], 5);
    const result = docRemoveFrame(doc, 0, 0, 4);
    expect(layerFrameCount(getLayer(result, 0, 0))).toBe(4);
  });

  it("is a no-op on a single-frame layer (minimum 1 frame)", () => {
    const doc = makeDocWithLayer([0], 1);
    const result = docRemoveFrame(doc, 0, 0, 0);
    expect(layerFrameCount(getLayer(result, 0, 0))).toBe(1);
  });

  it("removes the keyframe at atFrame if it is a keyframe", () => {
    const doc = makeDocWithLayer([0, 3, 6], 8);
    const result = docRemoveFrame(doc, 0, 0, 3);
    const indices = getLayer(result, 0, 0).frames.map((f) => f.index);
    expect(indices).not.toContain(3);
  });

  it("shifts keyframes after atFrame left by 1", () => {
    const doc = makeDocWithLayer([0, 3, 6], 8);
    const result = docRemoveFrame(doc, 0, 0, 3);
    const indices = getLayer(result, 0, 0).frames.map((f) => f.index);
    // 6 shifts to 5; 0 stays
    expect(indices).toContain(0);
    expect(indices).toContain(5);
    expect(indices).not.toContain(6);
  });

  it("always preserves a keyframe at index 0 after removal", () => {
    const doc = makeDocWithLayer([0], 3);
    const result = docRemoveFrame(doc, 0, 0, 0);
    const frame0kf = getLayer(result, 0, 0).frames.find(
      (f) => f.index === 0 && f.isKeyframe
    );
    expect(frame0kf).toBeDefined();
  });

  it("returns a new FlashDocument (immutable — original unchanged)", () => {
    const doc = makeDocWithLayer([0], 5);
    const result = docRemoveFrame(doc, 0, 0, 4);
    expect(result).not.toBe(doc);
    expect(layerFrameCount(getLayer(doc, 0, 0))).toBe(5);
    expect(layerFrameCount(getLayer(result, 0, 0))).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// insertKeyframe
// ---------------------------------------------------------------------------

describe("insertKeyframe", () => {
  it("creates a keyframe at atFrame", () => {
    const doc = makeDocWithLayer([0], 5);
    const result = docInsertKeyframe(doc, 0, 0, 3);
    const kf = getLayer(result, 0, 0).frames.find((f) => f.index === 3);
    expect(kf).toBeDefined();
    expect(kf!.isKeyframe).toBe(true);
  });

  it("copies display objects from the governing keyframe", () => {
    const obj = {
      type: "shape" as const,
      id: "obj1",
      shape: { id: "sh1", paths: [] },
      x: 0,
      y: 0,
    };
    const frame0 = createFrame(0, { displayObjects: [obj], isEmpty: false });
    const layer = createLayer("Layer 1", "normal", {
      frames: [frame0],
      frameCount: 5,
    });
    const scene = { ...createScene("Scene 1"), timeline: { layers: [layer] } };
    const doc = { ...createDocument(), scenes: [scene] };

    const result = docInsertKeyframe(doc, 0, 0, 3);
    const kf3 = getLayer(result, 0, 0).frames.find((f) => f.index === 3);
    expect(kf3!.displayObjects).toHaveLength(1);
    expect(kf3!.displayObjects[0]!.id).toBe("obj1");
  });

  it("does NOT shift existing keyframes (Flash F6 in-place semantics)", () => {
    const doc = makeDocWithLayer([0, 5], 10);
    const result = docInsertKeyframe(doc, 0, 0, 3);
    const indices = getLayer(result, 0, 0).frames.map((f) => f.index);
    expect(indices).toContain(0);
    expect(indices).toContain(3);
    expect(indices).toContain(5); // 5 must NOT shift to 6
    expect(indices).not.toContain(6);
  });

  it("does not change frameCount when inserting within the existing span", () => {
    const doc = makeDocWithLayer([0], 10);
    const result = docInsertKeyframe(doc, 0, 0, 5);
    expect(layerFrameCount(getLayer(result, 0, 0))).toBe(10);
  });

  it("extends frameCount when inserting beyond current duration", () => {
    const doc = makeDocWithLayer([0], 1);
    const result = docInsertKeyframe(doc, 0, 0, 9);
    expect(layerFrameCount(getLayer(result, 0, 0))).toBe(10);
  });

  it("is a no-op if atFrame already has a keyframe", () => {
    const doc = makeDocWithLayer([0, 3], 5);
    const before = getLayer(doc, 0, 0).frames.length;
    const result = docInsertKeyframe(doc, 0, 0, 3);
    expect(getLayer(result, 0, 0).frames.length).toBe(before);
  });

  it("returns a new FlashDocument (immutable — original unchanged)", () => {
    const doc = makeDocWithLayer([0], 5);
    const result = docInsertKeyframe(doc, 0, 0, 3);
    expect(result).not.toBe(doc);
    // Original has 1 frame; result has 2
    expect(getLayer(doc, 0, 0).frames).toHaveLength(1);
    expect(getLayer(result, 0, 0).frames).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// insertBlankKeyframe
// ---------------------------------------------------------------------------

describe("insertBlankKeyframe", () => {
  it("creates a keyframe at atFrame", () => {
    const doc = makeDocWithLayer([0], 5);
    const result = docInsertBlankKeyframe(doc, 0, 0, 3);
    const kf = getLayer(result, 0, 0).frames.find((f) => f.index === 3);
    expect(kf).toBeDefined();
    expect(kf!.isKeyframe).toBe(true);
  });

  it("new keyframe has empty displayObjects array", () => {
    const doc = makeDocWithLayer([0], 5);
    const result = docInsertBlankKeyframe(doc, 0, 0, 3);
    const kf = getLayer(result, 0, 0).frames.find((f) => f.index === 3);
    expect(kf!.displayObjects).toHaveLength(0);
    expect(kf!.isEmpty).toBe(true);
  });

  it("does NOT copy display objects from governing keyframe", () => {
    const obj = {
      type: "shape" as const,
      id: "obj1",
      shape: { id: "sh1", paths: [] },
      x: 0,
      y: 0,
    };
    const frame0 = createFrame(0, { displayObjects: [obj], isEmpty: false });
    const layer = createLayer("Layer 1", "normal", {
      frames: [frame0],
      frameCount: 5,
    });
    const scene = { ...createScene("Scene 1"), timeline: { layers: [layer] } };
    const doc = { ...createDocument(), scenes: [scene] };

    const result = docInsertBlankKeyframe(doc, 0, 0, 3);
    const kf3 = getLayer(result, 0, 0).frames.find((f) => f.index === 3);
    // Blank keyframe — should have NO display objects even though frame 0 has one
    expect(kf3!.displayObjects).toHaveLength(0);
  });

  it("does NOT shift existing keyframes (Flash F7 in-place semantics)", () => {
    const doc = makeDocWithLayer([0, 5], 10);
    const result = docInsertBlankKeyframe(doc, 0, 0, 3);
    const indices = getLayer(result, 0, 0).frames.map((f) => f.index);
    expect(indices).toContain(0);
    expect(indices).toContain(3);
    expect(indices).toContain(5); // must not shift
  });

  it("extends frameCount when inserting beyond current duration", () => {
    const doc = makeDocWithLayer([0], 1);
    const result = docInsertBlankKeyframe(doc, 0, 0, 7);
    expect(layerFrameCount(getLayer(result, 0, 0))).toBe(8);
  });

  it("is a no-op if atFrame already has a keyframe", () => {
    const doc = makeDocWithLayer([0, 3], 5);
    const before = getLayer(doc, 0, 0).frames.length;
    const result = docInsertBlankKeyframe(doc, 0, 0, 3);
    expect(getLayer(result, 0, 0).frames.length).toBe(before);
  });

  it("returns a new FlashDocument (immutable — original unchanged)", () => {
    const doc = makeDocWithLayer([0], 5);
    const result = docInsertBlankKeyframe(doc, 0, 0, 3);
    expect(result).not.toBe(doc);
    expect(getLayer(doc, 0, 0).frames).toHaveLength(1);
    expect(getLayer(result, 0, 0).frames).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Multi-layer isolation: operations on one layer don't affect other layers
// ---------------------------------------------------------------------------

describe("layer isolation", () => {
  it("insertFrame on layerIdx=0 does not change layerIdx=1", () => {
    const doc = createDocument();
    // Add a second layer (addLayer prepends, so new layer is at index 0)
    const tl = addLayer(doc.scenes[0]!.timeline, "Layer 2");
    const scene = { ...doc.scenes[0]!, timeline: tl };
    const twoLayerDoc = { ...doc, scenes: [scene] };

    const before1 = twoLayerDoc.scenes[0]!.timeline.layers[1]!;
    const result = docInsertFrame(twoLayerDoc, 0, 0, 0);
    // Layer at index 1 should be unchanged reference
    expect(result.scenes[0]!.timeline.layers[1]).toBe(before1);
  });

  it("removeFrame on layerIdx=0 does not change layerIdx=1", () => {
    const doc = createDocument();
    const tl1 = insertFrame(doc.scenes[0]!.timeline, doc.scenes[0]!.timeline.layers[0]!.id, 0);
    const tl2 = addLayer(tl1, "Layer 2");
    const scene = { ...doc.scenes[0]!, timeline: tl2 };
    const twoLayerDoc = { ...doc, scenes: [scene] };

    const before1 = twoLayerDoc.scenes[0]!.timeline.layers[1]!;
    const result = docRemoveFrame(twoLayerDoc, 0, 0, 1);
    expect(result.scenes[0]!.timeline.layers[1]).toBe(before1);
  });
});

// ---------------------------------------------------------------------------
// frameCount consistency across operation sequences
// ---------------------------------------------------------------------------

describe("frameCount consistency across sequences", () => {
  it("insert then remove returns original frameCount", () => {
    const doc = makeDocWithLayer([0], 5);
    const afterInsert = docInsertFrame(doc, 0, 0, 2);
    const afterRemove = docRemoveFrame(afterInsert, 0, 0, 2);
    expect(layerFrameCount(getLayer(afterRemove, 0, 0))).toBe(5);
  });

  it("multiple insertFrames accumulate correctly", () => {
    const doc = makeDocWithLayer([0], 1);
    let result = doc;
    for (let i = 0; i < 4; i++) {
      result = docInsertFrame(result, 0, 0, 0);
    }
    expect(layerFrameCount(getLayer(result, 0, 0))).toBe(5);
  });

  it("insertKeyframe at end extends frameCount", () => {
    const doc = makeDocWithLayer([0], 3);
    // Insert keyframe at the current last frame index = 2 (within), frameCount stays 3
    const r1 = docInsertKeyframe(doc, 0, 0, 2);
    expect(layerFrameCount(getLayer(r1, 0, 0))).toBe(3);
    // Then insert beyond end
    const r2 = docInsertKeyframe(r1, 0, 0, 5);
    expect(layerFrameCount(getLayer(r2, 0, 0))).toBe(6);
  });
});
