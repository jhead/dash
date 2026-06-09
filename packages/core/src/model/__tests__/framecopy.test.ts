/**
 * Tests for copyFrames and pasteFrames pure functions.
 *
 * copyFrames(layer, startIndex, endIndex) — returns a slice of frames
 *   reindexed from 0.
 * pasteFrames(layer, frames, atIndex) — inserts frames at the given position,
 *   shifting existing frames right and updating frameCount.
 */

import { describe, it, expect } from "vitest";
import { copyFrames, pasteFrames } from "../frame-utils.js";
import type { Layer, Frame } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrame(index: number, overrides: Partial<Frame> = {}): Frame {
  return {
    index,
    isKeyframe: false,
    isEmpty: true,
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects: [],
    ...overrides,
  };
}

function makeLayer(frames: Frame[]): Layer {
  return {
    id: "layer-1",
    name: "Layer 1",
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames,
    frameCount: frames.length,
  };
}

// ---------------------------------------------------------------------------
// copyFrames
// ---------------------------------------------------------------------------

describe("copyFrames", () => {
  it("returns the correct number of frames for the given range", () => {
    const layer = makeLayer([
      makeFrame(0),
      makeFrame(1),
      makeFrame(2),
      makeFrame(3),
      makeFrame(4),
    ]);
    const copied = copyFrames(layer, 1, 3);
    expect(copied.length).toBe(3);
  });

  it("reindexes copied frames starting from 0", () => {
    const layer = makeLayer([
      makeFrame(0),
      makeFrame(1),
      makeFrame(2),
      makeFrame(3),
    ]);
    const copied = copyFrames(layer, 2, 3);
    expect(copied[0].index).toBe(0);
    expect(copied[1].index).toBe(1);
  });

  it("preserves script content on copied frames", () => {
    const layer = makeLayer([
      makeFrame(0, { script: "trace('hello');" }),
      makeFrame(1, { script: "gotoAndPlay(1);" }),
      makeFrame(2),
    ]);
    const copied = copyFrames(layer, 0, 1);
    expect(copied[0].script).toBe("trace('hello');");
    expect(copied[1].script).toBe("gotoAndPlay(1);");
  });

  it("preserves tweenType on copied frames", () => {
    const layer = makeLayer([
      makeFrame(0, { isKeyframe: true, tweenType: "motion" }),
      makeFrame(1, { tweenType: "motion" }),
      makeFrame(2),
    ]);
    const copied = copyFrames(layer, 0, 1);
    expect(copied[0].tweenType).toBe("motion");
    expect(copied[1].tweenType).toBe("motion");
  });

  it("preserves isKeyframe flag on copied frames", () => {
    const layer = makeLayer([
      makeFrame(0, { isKeyframe: true }),
      makeFrame(1),
      makeFrame(2, { isKeyframe: true }),
      makeFrame(3),
    ]);
    const copied = copyFrames(layer, 0, 2);
    expect(copied[0].isKeyframe).toBe(true);
    expect(copied[1].isKeyframe).toBe(false);
    expect(copied[2].isKeyframe).toBe(true);
  });

  it("copies a single frame when startIndex equals endIndex", () => {
    const layer = makeLayer([makeFrame(0), makeFrame(1), makeFrame(2)]);
    const copied = copyFrames(layer, 1, 1);
    expect(copied.length).toBe(1);
    expect(copied[0].index).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pasteFrames
// ---------------------------------------------------------------------------

describe("pasteFrames", () => {
  it("appends frames at the end when atIndex equals frameCount", () => {
    const layer = makeLayer([makeFrame(0), makeFrame(1)]);
    const toInsert = [makeFrame(0, { script: "appended" })];
    const result = pasteFrames(layer, toInsert, 2);
    expect(result.frames.length).toBe(3);
    expect(result.frames[2].script).toBe("appended");
  });

  it("inserts frames at the start when atIndex is 0", () => {
    const layer = makeLayer([makeFrame(0, { script: "original" })]);
    const toInsert = [makeFrame(0, { script: "inserted" })];
    const result = pasteFrames(layer, toInsert, 0);
    expect(result.frames[0].script).toBe("inserted");
    expect(result.frames[1].script).toBe("original");
  });

  it("inserts frames in the middle correctly", () => {
    const layer = makeLayer([makeFrame(0, { label: "A" }), makeFrame(1, { label: "C" })]);
    const toInsert = [makeFrame(0, { label: "B" })];
    const result = pasteFrames(layer, toInsert, 1);
    expect(result.frames[0].label).toBe("A");
    expect(result.frames[1].label).toBe("B");
    expect(result.frames[2].label).toBe("C");
  });

  it("updates frameCount to reflect the new total", () => {
    const layer = makeLayer([makeFrame(0), makeFrame(1), makeFrame(2)]);
    const toInsert = [makeFrame(0), makeFrame(0)];
    const result = pasteFrames(layer, toInsert, 1);
    expect(result.frameCount).toBe(5);
  });

  it("reindexes all frames correctly after insertion", () => {
    const layer = makeLayer([makeFrame(0), makeFrame(1), makeFrame(2)]);
    const toInsert = [makeFrame(0), makeFrame(0)];
    const result = pasteFrames(layer, toInsert, 1);
    // Frames should be 0,1,2,3,4
    result.frames.forEach((f, i) => {
      expect(f.index).toBe(i);
    });
  });

  it("does not mutate the original layer", () => {
    const layer = makeLayer([makeFrame(0), makeFrame(1)]);
    const originalLength = layer.frames.length;
    pasteFrames(layer, [makeFrame(0)], 1);
    expect(layer.frames.length).toBe(originalLength);
    expect(layer.frameCount).toBe(originalLength);
  });
});
