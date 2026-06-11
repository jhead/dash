/**
 * Tests for DoAction (tag 12) emission from frame scripts.
 *
 * Verifies that:
 *  - A frame with script: 'stop();' produces a DoAction tag (tag 12)
 *  - The DoAction bytes appear before ShowFrame (tag 1)
 *  - A frame with an empty script does NOT produce a DoAction tag
 *  - The DoAction body ends with ActionEnd (0x00)
 *  - Multiple frames with scripts each get their own DoAction
 *
 * Tag codes:
 *   0  End
 *   1  ShowFrame
 *  12  DoAction
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag code constants
// ---------------------------------------------------------------------------

const TAG_SHOW_FRAME = 1;
const TAG_DO_ACTION = 12;
const TAG_END = 0;

// ---------------------------------------------------------------------------
// SWF binary parser helpers
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  idx: number;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  // Parse the RECT field: first 5 bits of byte[8] give nBits
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  // Skip SWF file header (3 sig + 1 ver + 4 fileLen) + RECT + FrameRate(2) + FrameCount(2)
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
  let idx = 0;
  while (pos + 2 <= swf.length) {
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
      idx: idx++,
    });
    pos = bodyStart + bodyLength;
    if (tagCode === TAG_END) break;
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

function makeFrame(index: number, script = ""): Frame {
  return {
    index,
    isKeyframe: true,
    isEmpty: true,
    tweenType: "none",
    label: "",
    labelType: "name",
    script,
    sound: null,
    motionEase: 0,
    motionEaseType: "none",
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionSnap: false,
    motionScale: false,
    shapeEase: 0,
    shapeEaseType: "none",
    shapeBlend: "distributive",
    displayObjects: [],
  };
}

function makeLayer(id: string, frames: Frame[]): Layer {
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
    frameCount: frames.length,
  };
}

function makeScene(frames: Frame[]): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: {
      layers: [makeLayer("layer-1", frames)],
    },
  };
}

function makeDoc(scenes: Scene[]): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DoAction (tag 12) frame script emission", () => {
  it("frame with script 'stop();' produces a DoAction tag (tag 12)", () => {
    const doc = makeDoc([makeScene([makeFrame(0, "stop();")])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBe(1);
  });

  it("DoAction tag appears before ShowFrame in the tag stream", () => {
    const doc = makeDoc([makeScene([makeFrame(0, "stop();")])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionIdx = tags.findIndex((t) => t.code === TAG_DO_ACTION);
    const showFrameIdx = tags.findIndex((t) => t.code === TAG_SHOW_FRAME);

    expect(doActionIdx).toBeGreaterThanOrEqual(0);
    expect(showFrameIdx).toBeGreaterThanOrEqual(0);
    expect(doActionIdx).toBeLessThan(showFrameIdx);
  });

  it("frame with empty script does NOT produce a DoAction tag", () => {
    const doc = makeDoc([makeScene([makeFrame(0, "")])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBe(0);
  });

  it("frame with whitespace-only script does NOT produce a DoAction tag", () => {
    const doc = makeDoc([makeScene([makeFrame(0, "   \n\t  ")])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBe(0);
  });

  it("DoAction body ends with ActionEnd (0x00)", () => {
    const doc = makeDoc([makeScene([makeFrame(0, "stop();")])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTag = tags.find((t) => t.code === TAG_DO_ACTION);
    expect(doActionTag).toBeDefined();
    const body = doActionTag!.body;
    expect(body.length).toBeGreaterThan(0);
    expect(body[body.length - 1]).toBe(0x00); // ActionEnd
  });

  it("multiple frames with scripts each get their own DoAction tag", () => {
    // 3 frames: frame 0 has script, frame 1 has no script, frame 2 has script
    const frames = [
      makeFrame(0, "stop();"),
      makeFrame(1, ""),
      makeFrame(2, "play();"),
    ];
    const doc = makeDoc([makeScene(frames)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBe(2);
  });

  it("each DoAction appears before its corresponding ShowFrame", () => {
    // 2 frames, both with scripts
    const frames = [makeFrame(0, "stop();"), makeFrame(1, "play();")];
    const doc = makeDoc([makeScene(frames)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const showFrames = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    const doActions = tags.filter((t) => t.code === TAG_DO_ACTION);

    expect(showFrames.length).toBe(2);
    expect(doActions.length).toBe(2);

    // First DoAction should come before first ShowFrame
    expect(doActions[0].idx).toBeLessThan(showFrames[0].idx);
    // Second DoAction should come before second ShowFrame
    expect(doActions[1].idx).toBeLessThan(showFrames[1].idx);
    // Second DoAction should come after first ShowFrame
    expect(doActions[1].idx).toBeGreaterThan(showFrames[0].idx);
  });

  it("DoAction body contains ActionStop (0x07) opcode for stop() call", () => {
    const doc = makeDoc([makeScene([makeFrame(0, "stop();")])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTag = tags.find((t) => t.code === TAG_DO_ACTION);
    expect(doActionTag).toBeDefined();
    const body = doActionTag!.body;
    // ActionStop opcode = 0x07
    const hasStop = Array.from(body).some((b) => b === 0x07);
    expect(hasStop).toBe(true);
  });

  it("DoAction body contains ActionPlay (0x06) opcode for play() call", () => {
    const doc = makeDoc([makeScene([makeFrame(0, "play();")])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTag = tags.find((t) => t.code === TAG_DO_ACTION);
    expect(doActionTag).toBeDefined();
    const body = doActionTag!.body;
    // ActionPlay opcode = 0x06
    const hasPlay = Array.from(body).some((b) => b === 0x06);
    expect(hasPlay).toBe(true);
  });
});
