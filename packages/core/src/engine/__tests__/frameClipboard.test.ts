/**
 * Unit tests for frameClipboard — copy/cut/paste frames.
 */

import { describe, it, expect } from "vitest";
import { copyFrames, pasteFrames, cutFrames } from "../frameClipboard.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a simple one-scene document with given layers. */
function makeDoc(...layerNames: string[]): FlashDocument {
  const layers = layerNames.length > 0
    ? layerNames.map((name) => createLayer(name))
    : [createLayer("Layer 1")];
  const doc = createDocument();
  return {
    ...doc,
    scenes: [
      {
        ...doc.scenes[0],
        timeline: createTimeline({ layers }),
      },
    ],
  };
}

/** Return a doc's layer by index in scene 0. */
function layer(doc: FlashDocument, idx: number) {
  return doc.scenes[0].timeline.layers[idx];
}

/** Add keyframes at specific indices to a layer (mutably for test setup). */
function addKeyframes(
  doc: FlashDocument,
  layerIdx: number,
  ...frameIndexes: number[]
): FlashDocument {
  const layers = doc.scenes[0].timeline.layers.map((l, i) => {
    if (i !== layerIdx) return l;
    const extra = frameIndexes.map((idx) =>
      createFrame(idx, {
        isKeyframe: true,
        isEmpty: false,
        displayObjects: [],
        label: `kf-${idx}`,
      })
    );
    const allFrames = [...l.frames, ...extra].sort((a, b) => a.index - b.index);
    const maxIndex = allFrames.reduce((m, f) => Math.max(m, f.index), 0);
    return { ...l, frames: allFrames, frameCount: maxIndex + 1 };
  });
  return {
    ...doc,
    scenes: [
      { ...doc.scenes[0], timeline: { ...doc.scenes[0].timeline, layers } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("copyFrames", () => {
  it("1. returns correct frame count", () => {
    let doc = makeDoc("L1");
    doc = addKeyframes(doc, 0, 1, 2, 3, 4);
    const cb = copyFrames(doc, 0, [], 1, 3);
    expect(cb.frameCount).toBe(3);
  });

  it("2. deep-clones frames — mutating clipboard does not affect original", () => {
    let doc = makeDoc("L1");
    doc = addKeyframes(doc, 0, 2);
    const cb = copyFrames(doc, 0, [], 0, 2);
    const original = layer(doc, 0).frames.find((f) => f.index === 2);
    const copied = cb.layerFrames[0].find((f) => f.index === 2);
    // They should be equal by value but different objects
    expect(copied).toBeDefined();
    expect(copied).not.toBe(original);
    // Spread-cloned frame has own displayObjects array
    expect(copied!.displayObjects).not.toBe(original!.displayObjects);
  });

  it("3. on empty range returns empty clipboard", () => {
    const doc = makeDoc("L1");
    // endFrame < startFrame
    const cb = copyFrames(doc, 0, [], 5, 3);
    expect(cb.frameCount).toBe(0);
    expect(cb.layerFrames[0]).toEqual([]);
  });

  it("10. multi-layer copy: layerFrames has correct length per layer", () => {
    let doc = makeDoc("L1", "L2", "L3");
    doc = addKeyframes(doc, 0, 1, 2);
    doc = addKeyframes(doc, 1, 2, 3);
    // Copy frames 0–2 from all layers
    const cb = copyFrames(doc, 0, [], 0, 2);
    expect(cb.layerCount).toBe(3);
    expect(cb.layerFrames).toHaveLength(3);
    // Layer 0: has keyframes at 0, 1, 2 → 3 keyframes in range
    expect(cb.layerFrames[0].length).toBe(3);
    // Layer 1: has keyframes at 0, 2 → 2 keyframes in range
    expect(cb.layerFrames[1].length).toBe(2);
  });
});

describe("pasteFrames", () => {
  it("4. replaces frames at target position", () => {
    let doc = makeDoc("L1");
    doc = addKeyframes(doc, 0, 2);
    // Copy frame 0..2
    const cb = copyFrames(doc, 0, [], 0, 2);
    // Paste at frame 5
    const result = pasteFrames(doc, 0, [], 5, cb);
    const resultLayer = layer(result, 0);
    // Should have keyframe at 5 (0 from clipboard rebased to 5)
    const kf5 = resultLayer.frames.find((f) => f.index === 5 && f.isKeyframe);
    const kf7 = resultLayer.frames.find((f) => f.index === 7 && f.isKeyframe);
    expect(kf5).toBeDefined();
    expect(kf7).toBeDefined();
  });

  it("5. preserves frames outside paste range", () => {
    let doc = makeDoc("L1");
    doc = addKeyframes(doc, 0, 10);
    const cb = copyFrames(doc, 0, [], 0, 0);
    const result = pasteFrames(doc, 0, [], 5, cb);
    const resultLayer = layer(result, 0);
    // Frame at index 10 should still be present
    const kf10 = resultLayer.frames.find((f) => f.index === 10 && f.isKeyframe);
    expect(kf10).toBeDefined();
  });

  it("6. extends layer frameCount if paste goes beyond current length", () => {
    let doc = makeDoc("L1");
    // Extend the layer to have 5 frames (0–4) with keyframes
    doc = addKeyframes(doc, 0, 1, 2, 3, 4);
    const cb = copyFrames(doc, 0, [], 0, 4);
    expect(cb.frameCount).toBe(5);
    // Paste at frame 10 → last pasted frame is at index 14 → need frameCount >= 15
    const result = pasteFrames(doc, 0, [], 10, cb);
    const resultLayer = layer(result, 0);
    expect(resultLayer.frameCount).toBeGreaterThanOrEqual(15);
  });
});

describe("cutFrames", () => {
  it("7. returns clipboard with correct frames", () => {
    let doc = makeDoc("L1");
    doc = addKeyframes(doc, 0, 3);
    const { clipboard } = cutFrames(doc, 0, [], 0, 3);
    expect(clipboard.frameCount).toBe(4);
    // All frames in the clipboard should be rebased
    const indices = clipboard.layerFrames[0].map((f) => f.index);
    expect(indices).toContain(0);
    expect(indices).toContain(3);
  });

  it("8. replaces cut range with blank keyframes in newDoc", () => {
    let doc = makeDoc("L1");
    doc = addKeyframes(doc, 0, 2);
    const { newDoc } = cutFrames(doc, 0, [], 0, 2);
    const resultLayer = layer(newDoc, 0);
    // Every frame in range 0–2 should now be blank keyframes
    for (let i = 0; i <= 2; i++) {
      const kf = resultLayer.frames.find((f) => f.index === i && f.isKeyframe);
      expect(kf).toBeDefined();
      expect(kf!.isEmpty).toBe(true);
      expect(kf!.displayObjects).toHaveLength(0);
    }
  });

  it("9. pasteFrames after cutFrames restores original keyframes at correct positions", () => {
    let doc = makeDoc("L1");
    // Give layer keyframes at 0, 2, 4 (label is set to "kf-N" by addKeyframes)
    doc = addKeyframes(doc, 0, 2, 4);

    // Cut frames 0–4
    const { newDoc, clipboard } = cutFrames(doc, 0, [], 0, 4);
    // Paste back at 0
    const restored = pasteFrames(newDoc, 0, [], 0, clipboard);
    const restoredLayer = layer(restored, 0);

    // Keyframes at 0, 2, 4 should be present
    const kf0 = restoredLayer.frames.find((f) => f.index === 0 && f.isKeyframe);
    const kf2 = restoredLayer.frames.find((f) => f.index === 2 && f.isKeyframe);
    const kf4 = restoredLayer.frames.find((f) => f.index === 4 && f.isKeyframe);
    expect(kf0).toBeDefined();
    expect(kf2).toBeDefined();
    expect(kf4).toBeDefined();
    // Labels should be preserved from the original keyframes
    expect(kf2!.label).toBe("kf-2");
    expect(kf4!.label).toBe("kf-4");
  });
});
