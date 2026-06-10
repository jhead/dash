/**
 * Tests for StageScaleMode (tag 65) emission in compiled SWF output.
 *
 * SWF tag 65 controls how the stage scales when the player window is resized.
 * Flash Professional always emits this tag.
 *
 * Tag body:
 *   AllowScaling (UI8): 0=noScale, 1=showAll, 2=exactFit, 3=noBorder
 *   Alignment    (UI8): 0=center, 1=L, 2=R, 3=T, 4=B, 5=TL, 6=TR, 7=BL, 8=BR
 *
 * We always emit AllowScaling=1 (showAll) and Alignment=0 (center).
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_SET_BACKGROUND_COLOR = 9;
const TAG_STAGE_SCALE_MODE = 65;
const TAG_SHOW_FRAME = 1;

// ---------------------------------------------------------------------------
// SWF tag parser (same helper pattern as other test files)
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
  while (pos < swf.length) {
    const recordHeader = swf[pos] | (swf[pos + 1] << 8);
    const tagCode = (recordHeader >> 6) & 0x3ff;
    let bodyLength = recordHeader & 0x3f;
    let headerSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        swf[pos + 2] |
        (swf[pos + 3] << 8) |
        (swf[pos + 4] << 16) |
        (swf[pos + 5] << 24);
      headerSize = 6;
    }
    const bodyStart = pos + headerSize;
    tags.push({
      code: tagCode,
      body: swf.slice(bodyStart, bodyStart + bodyLength),
      offset: pos,
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Document factory helpers
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
    id: "doc-1",
    properties: { ...BASE_PROPS },
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StageScaleMode (tag 65)", () => {
  it("emits StageScaleMode tag in compiled SWF output", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const scaleModeTag = tags.find((t) => t.code === TAG_STAGE_SCALE_MODE);
    expect(scaleModeTag).toBeDefined();
  });

  it("StageScaleMode tag body is exactly 2 bytes", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const scaleModeTag = tags.find((t) => t.code === TAG_STAGE_SCALE_MODE);
    expect(scaleModeTag).toBeDefined();
    expect(scaleModeTag!.body.length).toBe(2);
  });

  it("StageScaleMode AllowScaling=1 (showAll)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const scaleModeTag = tags.find((t) => t.code === TAG_STAGE_SCALE_MODE);
    expect(scaleModeTag).toBeDefined();
    expect(scaleModeTag!.body[0]).toBe(1); // AllowScaling = showAll
  });

  it("StageScaleMode Alignment=0 (center)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const scaleModeTag = tags.find((t) => t.code === TAG_STAGE_SCALE_MODE);
    expect(scaleModeTag).toBeDefined();
    expect(scaleModeTag!.body[1]).toBe(0); // Alignment = center
  });

  it("StageScaleMode appears immediately after SetBackgroundColor", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const withIndices = tags.map((t, idx) => ({ ...t, idx }));
    const bgColorIdx = withIndices.find(
      (t) => t.code === TAG_SET_BACKGROUND_COLOR
    )?.idx;
    const scaleModeIdx = withIndices.find(
      (t) => t.code === TAG_STAGE_SCALE_MODE
    )?.idx;
    expect(bgColorIdx).toBeDefined();
    expect(scaleModeIdx).toBeDefined();
    expect(scaleModeIdx!).toBe(bgColorIdx! + 1);
  });

  it("StageScaleMode appears before the first ShowFrame", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const withIndices = tags.map((t, idx) => ({ ...t, idx }));
    const scaleModeIdx = withIndices.find(
      (t) => t.code === TAG_STAGE_SCALE_MODE
    )?.idx;
    const firstShowFrameIdx = withIndices.find(
      (t) => t.code === TAG_SHOW_FRAME
    )?.idx;
    expect(scaleModeIdx).toBeDefined();
    expect(firstShowFrameIdx).toBeDefined();
    expect(scaleModeIdx!).toBeLessThan(firstShowFrameIdx!);
  });

  it("StageScaleMode appears exactly once in multi-scene SWF", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 2),
      makeScene("s2", "Scene 2", 2),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const scaleModeTags = tags.filter((t) => t.code === TAG_STAGE_SCALE_MODE);
    expect(scaleModeTags.length).toBe(1);
  });
});
