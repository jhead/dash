/**
 * Tests for SWF ShowFrame tag emission and frame count validation.
 *
 * Verifies that the correct number of ShowFrame (tag 1) tags are emitted and
 * that structural rules (End tag placement, ShowFrame ordering) hold.
 *
 * Tag codes:
 *    0  End
 *    1  ShowFrame
 *   26  PlaceObject2
 *   12  DoAction
 *   86  SceneAndFrameLabelData
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_SHOW_FRAME = 1;
const TAG_PLACE_OBJECT2 = 26;
const TAG_DO_ACTION = 12;

// ---------------------------------------------------------------------------
// Tag parser (provided by task spec)
// ---------------------------------------------------------------------------

interface SwfTag {
  type: number;
  body: Uint8Array;
}

function findTags(bytes: Uint8Array): SwfTag[] {
  const nbits = bytes[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let i = 8 + rectBytes + 4;
  const tags: Array<{ type: number; body: Uint8Array }> = [];
  while (i < bytes.length - 1) {
    const h = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
    const type = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    if (len === 63) {
      len =
        bytes[i] |
        (bytes[i + 1] << 8) |
        (bytes[i + 2] << 16) |
        (bytes[i + 3] << 24);
      i += 4;
    }
    tags.push({ type, body: bytes.slice(i, i + len) });
    if (type === 0) break;
    i += len;
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
    id: "doc-showframe",
    properties: BASE_PROPS,
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// 1. A 1-frame document has exactly 1 ShowFrame (tag 1)
// ---------------------------------------------------------------------------

describe("ShowFrame tag count", () => {
  it("1. a 1-frame document emits exactly 1 ShowFrame tag", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const showFrames = tags.filter((t) => t.type === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(1);
  });

  it("2. a 5-frame document emits exactly 5 ShowFrame tags", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 5)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const showFrames = tags.filter((t) => t.type === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 3. ShowFrame appears last for each frame (after PlaceObject2/DoAction)
// ---------------------------------------------------------------------------

describe("ShowFrame ordering within frames", () => {
  it("3. ShowFrame is the last non-End tag before each frame boundary", () => {
    // Build a doc with frames; for each frame boundary the tag sequence
    // must end with ShowFrame.  In a multi-frame doc, partition the tag
    // sequence by ShowFrame: all content tags must precede ShowFrame.
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);

    // Collect indices of ShowFrame and PlaceObject2/DoAction tags
    const showFrameIndices = tags
      .map((t, i) => (t.type === TAG_SHOW_FRAME ? i : -1))
      .filter((i) => i !== -1);

    // Every PlaceObject2 or DoAction tag must appear before the next ShowFrame
    tags.forEach((tag, idx) => {
      if (tag.type === TAG_PLACE_OBJECT2 || tag.type === TAG_DO_ACTION) {
        // Find the next ShowFrame after this tag
        const nextShowFrame = showFrameIndices.find((si) => si > idx);
        // There must be a ShowFrame after any content tag
        expect(nextShowFrame).toBeDefined();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 4. End tag (tag 0) appears exactly once at the end
// ---------------------------------------------------------------------------

describe("End tag", () => {
  it("4. End tag appears exactly once in a 1-frame doc", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const endTags = tags.filter((t) => t.type === TAG_END);
    expect(endTags.length).toBe(1);
  });

  it("5. End tag is the last tag in the SWF", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const lastTag = tags[tags.length - 1];
    expect(lastTag).toBeDefined();
    expect(lastTag!.type).toBe(TAG_END);
  });

  it("End tag appears exactly once in a 5-frame doc", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 5)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const endTags = tags.filter((t) => t.type === TAG_END);
    expect(endTags.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Multi-scene document with 3+2 frames has 5 total ShowFrames
// ---------------------------------------------------------------------------

describe("multi-scene ShowFrame count", () => {
  it("6. a 2-scene doc with 3+2 frames emits 5 total ShowFrame tags", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 3),
      makeScene("s2", "Scene 2", 2),
    ]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const showFrames = tags.filter((t) => t.type === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(5);
  });

  it("total ShowFrames in 3-scene doc with 2+4+1 frames equals 7", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 2),
      makeScene("s2", "Scene 2", 4),
      makeScene("s3", "Scene 3", 1),
    ]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const showFrames = tags.filter((t) => t.type === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(7);
  });

  it("End tag is last tag in multi-scene doc", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 3),
      makeScene("s2", "Scene 2", 2),
    ]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const lastTag = tags[tags.length - 1];
    expect(lastTag).toBeDefined();
    expect(lastTag!.type).toBe(TAG_END);
  });
});
