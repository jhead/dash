/**
 * Tests for analyzeFrameSizes (bandwidth profiler).
 *
 * Compiles simple multi-frame documents and verifies that the per-frame
 * byte analysis matches the actual ShowFrame structure in the SWF.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { analyzeFrameSizes } from "../profiler.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Document factory helpers (same pattern as showframe.test.ts)
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: "#ffffff",
  rulerUnits: "px" as const,
  grid: {
    showGrid: false,
    snapToGrid: false,
    gridColor: "#999999",
    gridWidth: 18,
    gridHeight: 18,
  },
  guides: [],
  snapToObjects: false,
  snapToPixels: false,
  snapToGuides: false,
};

function makeBlankFrame(index: number): Frame {
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
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects: [],
  };
}

function makeLayer(id: string, frameCount: number): Layer {
  const frames: Frame[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(makeBlankFrame(i));
  }
  return {
    id,
    name: id,
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames,
    frameCount,
  };
}

function makeScene(id: string, name: string, frameCount = 1): Scene {
  return {
    id,
    name,
    timeline: {
      layers: [makeLayer(`${id}-layer`, frameCount)],
    },
  };
}

function makeDoc(scenes: Scene[]): FlashDocument {
  return {
    id: "doc-profiler",
    properties: BASE_PROPS,
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analyzeFrameSizes", () => {
  it("counts frames in a compiled 1-frame SWF", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const bytes = compileDocument(doc);
    const report = analyzeFrameSizes(bytes);
    expect(report.frameCount).toBe(1);
  });

  it("counts frames in a compiled 3-frame SWF", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const bytes = compileDocument(doc);
    const report = analyzeFrameSizes(bytes);
    expect(report.frameCount).toBe(3);
  });

  it("counts frames in a compiled 5-frame SWF", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 5)]);
    const bytes = compileDocument(doc);
    const report = analyzeFrameSizes(bytes);
    expect(report.frameCount).toBe(5);
  });

  it("counts frames across multiple scenes (3+2 = 5 frames)", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 3),
      makeScene("s2", "Scene 2", 2),
    ]);
    const bytes = compileDocument(doc);
    const report = analyzeFrameSizes(bytes);
    expect(report.frameCount).toBe(5);
  });

  it("frameSizes array length matches frameCount", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 4)]);
    const bytes = compileDocument(doc);
    const report = analyzeFrameSizes(bytes);
    expect(report.frameSizes.length).toBe(report.frameCount);
  });

  it("frame bytes are positive for every frame", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const bytes = compileDocument(doc);
    const report = analyzeFrameSizes(bytes);
    expect(report.frameSizes.every((n) => n > 0)).toBe(true);
  });

  it("totalBytes matches the compiled SWF length", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const bytes = compileDocument(doc);
    const report = analyzeFrameSizes(bytes);
    expect(report.totalBytes).toBe(bytes.length);
  });

  it("largestFrame is a valid frame index", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 5)]);
    const bytes = compileDocument(doc);
    const report = analyzeFrameSizes(bytes);
    expect(report.largestFrame).toBeGreaterThanOrEqual(0);
    expect(report.largestFrame).toBeLessThan(report.frameCount);
  });

  it("averageFrameBytes is positive", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const bytes = compileDocument(doc);
    const report = analyzeFrameSizes(bytes);
    expect(report.averageFrameBytes).toBeGreaterThan(0);
  });

  it("sum of frameSizes approximately accounts for total SWF bytes", () => {
    // The sum of per-frame bytes should be close to totalBytes.
    // (Frame 0 absorbs the SWF preamble, and the End tag is added to the last frame,
    //  so the sum should equal totalBytes.)
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const bytes = compileDocument(doc);
    const report = analyzeFrameSizes(bytes);
    const sum = report.frameSizes.reduce((a, b) => a + b, 0);
    // Allow a few bytes of tolerance for End tag attribution
    expect(sum).toBeGreaterThanOrEqual(report.totalBytes - 10);
    expect(sum).toBeLessThanOrEqual(report.totalBytes + 10);
  });
});
