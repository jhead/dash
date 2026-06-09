/**
 * Tests for DoAction (tag 12) frame script compilation.
 *
 * Covers:
 *  - trace("hello") → tag 12 with ActionTrace (0x26)
 *  - stop() → tag 12 with ActionStop (0x07)
 *  - No script → no tag 12
 *  - Multi-frame: only the keyframe with a script gets tag 12
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
// Tag constants
// ---------------------------------------------------------------------------

const TAG_SHOW_FRAME = 1;
const TAG_DO_ACTION = 12;
const TAG_END = 0;

// Action opcodes
const ACTION_TRACE = 0x26;
const ACTION_STOP = 0x07;

// ---------------------------------------------------------------------------
// SWF binary helpers
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  /** Sequential index in the tag stream (0-based). */
  idx: number;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  // Skip SWF header: 3 signature bytes + 1 version + 4 file-length bytes = 8 bytes.
  // Then RECT field: nBits is encoded in the top 5 bits of byte 8.
  const nBits = (swf[8]! >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  // After RECT: FrameRate (UI16) + FrameCount (UI16) = 4 bytes
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
  let idx = 0;
  while (pos + 2 <= swf.length) {
    const recordHeader = swf[pos]! | (swf[pos + 1]! << 8);
    const tagCode = (recordHeader >> 6) & 0x3ff;
    let bodyLength = recordHeader & 0x3f;
    let headerSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        swf[pos + 2]! |
        (swf[pos + 3]! << 8) |
        (swf[pos + 4]! << 16) |
        (swf[pos + 5]! << 24);
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

function makeScene(frames: Frame[], name = "Scene 1"): Scene {
  return {
    id: "scene-1",
    name,
    timeline: { layers: [makeLayer("layer-1", frames)] },
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

describe("framescript: DoAction (tag 12) compilation", () => {
  it('doc with frame.script = \'trace("hello");\' on keyframe 0 compiles to SWF containing tag 12', () => {
    const doc = makeDoc([makeScene([makeFrame(0, 'trace("hello");')])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBeGreaterThanOrEqual(1);
  });

  it('tag 12 body contains ActionTrace (0x26) opcode for trace("hello");', () => {
    const doc = makeDoc([makeScene([makeFrame(0, 'trace("hello");')])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTag = tags.find((t) => t.code === TAG_DO_ACTION);
    expect(doActionTag).toBeDefined();
    const body = doActionTag!.body;
    const hasTrace = Array.from(body).some((b) => b === ACTION_TRACE);
    expect(hasTrace).toBe(true);
  });

  it("doc with no scripts compiles without tag 12", () => {
    const doc = makeDoc([makeScene([makeFrame(0, ""), makeFrame(1, ""), makeFrame(2, "")])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBe(0);
  });

  it("multi-frame: only the keyframe with a script gets tag 12", () => {
    // Frame 0: no script, Frame 1: has script, Frame 2: no script
    const frames = [
      makeFrame(0, ""),
      makeFrame(1, 'trace("hello");'),
      makeFrame(2, ""),
    ];
    const doc = makeDoc([makeScene(frames)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // Exactly 1 DoAction tag for the 3 frames
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBe(1);

    // That DoAction must appear between the 1st and 2nd ShowFrame (i.e., before frame 1's ShowFrame)
    const showFrameTags = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrameTags.length).toBe(3);

    const doActionIdx = doActionTags[0]!.idx;
    // Must come after the first ShowFrame (frame 0's end)
    expect(doActionIdx).toBeGreaterThan(showFrameTags[0]!.idx);
    // Must come before the second ShowFrame (frame 1's end)
    expect(doActionIdx).toBeLessThan(showFrameTags[1]!.idx);
  });

  it("script with stop(); compiles with ActionStop (0x07) opcode", () => {
    const doc = makeDoc([makeScene([makeFrame(0, "stop();")])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTag = tags.find((t) => t.code === TAG_DO_ACTION);
    expect(doActionTag).toBeDefined();
    const body = doActionTag!.body;

    // Tag 12 present
    expect(doActionTag!.code).toBe(TAG_DO_ACTION);

    // ActionStop (0x07) opcode must be present in the body
    const hasStop = Array.from(body).some((b) => b === ACTION_STOP);
    expect(hasStop).toBe(true);
  });

  it("DoAction tag body ends with ActionEnd (0x00) byte", () => {
    const doc = makeDoc([makeScene([makeFrame(0, 'trace("hello");')])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const doActionTag = tags.find((t) => t.code === TAG_DO_ACTION);
    expect(doActionTag).toBeDefined();
    const body = doActionTag!.body;
    expect(body.length).toBeGreaterThan(0);
    expect(body[body.length - 1]).toBe(0x00); // ActionEnd
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
});
