/**
 * Tests for FrameLabel (SWF tag 43) encoding.
 *
 * Covers:
 *  - encodeFrameLabel produces correct bytes for a simple label
 *  - encodeFrameLabel with anchor flag sets the named-anchor byte (0x01)
 *  - compileDocument with a labeled frame emits FrameLabel before ShowFrame
 *  - Unlabeled frames do NOT emit FrameLabel
 *  - comment-type labels (labelType === "comment") are NOT emitted as FrameLabel
 *
 * Tag codes:
 *   1   ShowFrame
 *  43   FrameLabel
 */

import { describe, it, expect } from "vitest";
import { encodeFrameLabel } from "../framelabel.js";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag code constants
// ---------------------------------------------------------------------------

const TAG_SHOW_FRAME = 1;
const TAG_FRAME_LABEL = 43;

// ---------------------------------------------------------------------------
// SWF binary parser helpers
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  idx: number;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
  let idx = 0;
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
      idx: idx++,
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

function readFrameLabelString(body: Uint8Array): string {
  let end = 0;
  while (end < body.length && body[end] !== 0) end++;
  return new TextDecoder().decode(body.slice(0, end));
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

function makeFrame(
  index: number,
  label = "",
  labelType: "name" | "anchor" | "comment" = "name"
): Frame {
  return {
    index,
    isKeyframe: true,
    isEmpty: true,
    tweenType: "none",
    label,
    labelType,
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

function makeScene(id: string, name: string, frames: Frame[]): Scene {
  return {
    id,
    name,
    timeline: {
      layers: [makeLayer(`${id}-layer`, frames)],
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
// encodeFrameLabel unit tests
// ---------------------------------------------------------------------------

describe("encodeFrameLabel", () => {
  it("produces correct bytes for a simple label", () => {
    const body = encodeFrameLabel("hello", false);
    // "hello" = 5 bytes + NUL = 6 bytes total
    expect(body.length).toBe(6);
    // "hello" in ASCII
    expect(body[0]).toBe(0x68); // h
    expect(body[1]).toBe(0x65); // e
    expect(body[2]).toBe(0x6c); // l
    expect(body[3]).toBe(0x6c); // l
    expect(body[4]).toBe(0x6f); // o
    // NUL terminator
    expect(body[5]).toBe(0x00);
  });

  it("produces NUL-terminated body without anchor byte for isAnchor=false", () => {
    const body = encodeFrameLabel("frame1", false);
    // "frame1" = 6 bytes + NUL = 7 bytes, no extra byte
    expect(body.length).toBe(7);
    expect(body[6]).toBe(0x00); // NUL terminator
  });

  it("with anchor flag sets extra byte 0x01 after NUL", () => {
    const body = encodeFrameLabel("anchor_frame", true);
    // "anchor_frame" = 12 bytes + NUL + 0x01 = 14 bytes
    expect(body.length).toBe(14);
    // Last byte before anchor flag is NUL
    expect(body[12]).toBe(0x00);
    // Anchor flag byte
    expect(body[13]).toBe(0x01);
  });

  it("anchor flag is absent when isAnchor=false", () => {
    const body = encodeFrameLabel("test", false);
    // Only NUL terminator, no 0x01
    expect(body.length).toBe(5);
    expect(body[4]).toBe(0x00);
    // No extra byte
    expect(body.length).toBe(5);
  });

  it("encodes UTF-8 label correctly", () => {
    // ASCII-only label: just verify structure is correct
    const label = "myLabel";
    const body = encodeFrameLabel(label, false);
    expect(body.length).toBe(label.length + 1);
    expect(body[body.length - 1]).toBe(0x00);
    expect(readFrameLabelString(body)).toBe(label);
  });
});

// ---------------------------------------------------------------------------
// compileDocument integration tests
// ---------------------------------------------------------------------------

describe("compileDocument FrameLabel emission", () => {
  it("emits FrameLabel before ShowFrame for a labeled frame (frameIdx > 0)", () => {
    // Scene with 3 frames: frame 0 (no label), frame 1 (labeled "myLabel"), frame 2 (no label)
    const frames = [
      makeFrame(0, ""),
      makeFrame(1, "myLabel", "name"),
      makeFrame(2, ""),
    ];
    const doc = makeDoc([makeScene("s1", "Scene 1", frames)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // Find all FrameLabel tags with body containing "myLabel"
    const frameLabelTags = tags.filter(
      (t) => t.code === TAG_FRAME_LABEL && readFrameLabelString(t.body) === "myLabel"
    );
    expect(frameLabelTags.length).toBe(1);

    const labelTag = frameLabelTags[0];
    // The FrameLabel for "myLabel" should appear before the 2nd ShowFrame
    // (scene label is at frame 0, "myLabel" is at frame 1 → before the 2nd ShowFrame)
    const showFrames = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBeGreaterThanOrEqual(2);

    // The myLabel FrameLabel must appear after the first ShowFrame (frame 0)
    // and before the second ShowFrame (frame 1)
    const firstShowFrameIdx = showFrames[0].idx;
    const secondShowFrameIdx = showFrames[1].idx;
    expect(labelTag.idx).toBeGreaterThan(firstShowFrameIdx);
    expect(labelTag.idx).toBeLessThan(secondShowFrameIdx);
  });

  it("FrameLabel body is NUL-terminated label string", () => {
    const frames = [makeFrame(0, ""), makeFrame(1, "gotoHere", "name")];
    const doc = makeDoc([makeScene("s1", "Scene 1", frames)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const labelTag = tags.find(
      (t) => t.code === TAG_FRAME_LABEL && readFrameLabelString(t.body) === "gotoHere"
    );
    expect(labelTag).toBeDefined();
    // Body = "gotoHere\0" = 9 bytes
    expect(labelTag!.body.length).toBe(9);
    expect(labelTag!.body[8]).toBe(0x00);
  });

  it("anchor-type label emits FrameLabel with anchor byte 0x01", () => {
    const frames = [makeFrame(0, ""), makeFrame(1, "anchorPoint", "anchor")];
    const doc = makeDoc([makeScene("s1", "Scene 1", frames)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const labelTag = tags.find(
      (t) => t.code === TAG_FRAME_LABEL && readFrameLabelString(t.body) === "anchorPoint"
    );
    expect(labelTag).toBeDefined();
    // Body = "anchorPoint\0\x01" = 13 bytes
    const body = labelTag!.body;
    expect(body.length).toBe(13);
    expect(body[11]).toBe(0x00); // NUL
    expect(body[12]).toBe(0x01); // anchor flag
  });

  it("unlabeled frames do NOT emit FrameLabel for their body", () => {
    // 3 frames, none have a label
    const frames = [makeFrame(0, ""), makeFrame(1, ""), makeFrame(2, "")];
    const doc = makeDoc([makeScene("s1", "Scene 1", frames)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // No scene-name FrameLabel is emitted (real Flash 8 does not emit scene names as FrameLabel)
    // and no frame labels either — so zero FrameLabel tags total
    const frameLabelTags = tags.filter((t) => t.code === TAG_FRAME_LABEL);
    expect(frameLabelTags.length).toBe(0);
  });

  it("comment-type labels are NOT emitted as FrameLabel", () => {
    // Frame 1 has a comment label — should NOT produce a FrameLabel tag
    const frames = [
      makeFrame(0, ""),
      makeFrame(1, "this is a comment", "comment"),
      makeFrame(2, ""),
    ];
    const doc = makeDoc([makeScene("s1", "Scene 1", frames)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // No FrameLabel tags at all: no user labels, no scene-name labels
    const frameLabelTags = tags.filter((t) => t.code === TAG_FRAME_LABEL);
    expect(frameLabelTags.length).toBe(0);

    // Specifically, no FrameLabel for "this is a comment"
    const commentLabel = tags.find(
      (t) => t.code === TAG_FRAME_LABEL && readFrameLabelString(t.body) === "this is a comment"
    );
    expect(commentLabel).toBeUndefined();
  });

  it("multiple labeled frames produce multiple FrameLabel tags", () => {
    const frames = [
      makeFrame(0, ""),
      makeFrame(1, "intro", "name"),
      makeFrame(2, ""),
      makeFrame(3, "main", "name"),
    ];
    const doc = makeDoc([makeScene("s1", "Scene 1", frames)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const introLabel = tags.find(
      (t) => t.code === TAG_FRAME_LABEL && readFrameLabelString(t.body) === "intro"
    );
    const mainLabel = tags.find(
      (t) => t.code === TAG_FRAME_LABEL && readFrameLabelString(t.body) === "main"
    );

    expect(introLabel).toBeDefined();
    expect(mainLabel).toBeDefined();
  });
});
