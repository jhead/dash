/**
 * Tests for SWF SetBackgroundColor (tag 9) and FrameLabel (tag 43).
 *
 * Verifies:
 *  - SetBackgroundColor tag is present and has the correct RGB bytes
 *  - Default white (#FFFFFF) encodes correctly
 *  - FrameLabel tag is emitted for labeled frames
 *  - Frames without labels do not emit FrameLabel
 *
 * Tag codes:
 *   1  ShowFrame
 *   9  SetBackgroundColor
 *  43  FrameLabel
 */

import { describe, it, expect } from "vitest";
import { exportSWF } from "../export.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag code constants
// ---------------------------------------------------------------------------

const TAG_SHOW_FRAME = 1;
const TAG_SET_BACKGROUND_COLOR = 9;
const TAG_FRAME_LABEL = 43;

// ---------------------------------------------------------------------------
// SWF tag parser
// ---------------------------------------------------------------------------

interface SwfTag {
  type: number;
  body: Uint8Array;
}

function findTags(bytes: Uint8Array): SwfTag[] {
  const tags: SwfTag[] = [];
  // Skip header: 8 bytes + FrameSize RECT (variable)
  // RECT starts at byte 8: top 5 bits = Nbits; total RECT bits = 5 + 4*Nbits
  const nbits = (bytes[8] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let i = 8 + rectBytes + 4; // +4 for frameRate (UI16) + frameCount (UI16)

  while (i < bytes.length - 1) {
    const h = bytes[i] | (bytes[i + 1] << 8);
    const type = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    i += 2;
    if (len === 63) {
      len =
        bytes[i] |
        (bytes[i + 1] << 8) |
        (bytes[i + 2] << 16) |
        (bytes[i + 3] << 24);
      i += 4;
    }
    tags.push({ type, body: bytes.slice(i, i + len) });
    if (type === 0) break; // End tag
    i += len;
  }
  return tags;
}

function readCString(body: Uint8Array): string {
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

function makeScene(id: string, name: string, frames: Frame[]): Scene {
  return {
    id,
    name,
    timeline: {
      layers: [makeLayer(`${id}-layer`, frames)],
    },
  };
}

function makeDoc(backgroundColor: string, scenes: Scene[]): FlashDocument {
  return {
    id: "doc-bgtest",
    properties: { ...BASE_PROPS, backgroundColor },
    scenes,
    library: { items: [], folders: [] },
  };
}

function makeSimpleDoc(backgroundColor: string, frameCount = 1): FlashDocument {
  const frames = Array.from({ length: frameCount }, (_, i) => makeFrame(i));
  return makeDoc(backgroundColor, [makeScene("s1", "Scene 1", frames)]);
}

// ---------------------------------------------------------------------------
// SetBackgroundColor (tag 9) tests
// ---------------------------------------------------------------------------

describe("SWF SetBackgroundColor tag (type 9)", () => {
  it("1. doc with backgroundColor '#FF0000' has tag type 9 with body [0xFF, 0x00, 0x00]", () => {
    const doc = makeSimpleDoc("#FF0000");
    const bytes = exportSWF(doc);
    const tags = findTags(bytes);
    const bgTag = tags.find((t) => t.type === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    expect(bgTag!.body[0]).toBe(0xff); // R
    expect(bgTag!.body[1]).toBe(0x00); // G
    expect(bgTag!.body[2]).toBe(0x00); // B
  });

  it("2. doc with default white '#FFFFFF' has tag type 9 body [0xFF, 0xFF, 0xFF]", () => {
    const doc = makeSimpleDoc("#FFFFFF");
    const bytes = exportSWF(doc);
    const tags = findTags(bytes);
    const bgTag = tags.find((t) => t.type === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    expect(bgTag!.body[0]).toBe(0xff); // R
    expect(bgTag!.body[1]).toBe(0xff); // G
    expect(bgTag!.body[2]).toBe(0xff); // B
  });

  it("3. SetBackgroundColor body is exactly 3 bytes", () => {
    const doc = makeSimpleDoc("#336699");
    const bytes = exportSWF(doc);
    const tags = findTags(bytes);
    const bgTag = tags.find((t) => t.type === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    expect(bgTag!.body.length).toBe(3);
  });

  it("4. SetBackgroundColor appears before the first ShowFrame", () => {
    const doc = makeSimpleDoc("#ffffff", 2);
    const bytes = exportSWF(doc);
    const tags = findTags(bytes);
    const withIdx = tags.map((t, idx) => ({ ...t, idx }));
    const bgIdx = withIdx.find((t) => t.type === TAG_SET_BACKGROUND_COLOR)?.idx;
    const firstShowFrameIdx = withIdx.find((t) => t.type === TAG_SHOW_FRAME)?.idx;
    expect(bgIdx).toBeDefined();
    expect(firstShowFrameIdx).toBeDefined();
    expect(bgIdx!).toBeLessThan(firstShowFrameIdx!);
  });
});

// ---------------------------------------------------------------------------
// FrameLabel (tag 43) tests
// ---------------------------------------------------------------------------

describe("SWF FrameLabel tag (type 43)", () => {
  it("5. doc with frame label 'intro' has tag type 43 with body starting 'intro\\0'", () => {
    const frames = [makeFrame(0, ""), makeFrame(1, "intro", "name")];
    const doc = makeDoc("#ffffff", [makeScene("s1", "Scene 1", frames)]);
    const bytes = exportSWF(doc);
    const tags = findTags(bytes);
    const labelTag = tags.find(
      (t) => t.type === TAG_FRAME_LABEL && readCString(t.body) === "intro"
    );
    expect(labelTag).toBeDefined();
    // Body must be NUL-terminated: 'intro' (5 bytes) + NUL = 6 bytes
    expect(labelTag!.body.length).toBe(6);
    expect(labelTag!.body[0]).toBe(0x69); // i
    expect(labelTag!.body[1]).toBe(0x6e); // n
    expect(labelTag!.body[2]).toBe(0x74); // t
    expect(labelTag!.body[3]).toBe(0x72); // r
    expect(labelTag!.body[4]).toBe(0x6f); // o
    expect(labelTag!.body[5]).toBe(0x00); // NUL
  });

  it("6. doc with no frame labels does not emit FrameLabel for frame bodies (only scene label)", () => {
    const frames = [makeFrame(0, ""), makeFrame(1, ""), makeFrame(2, "")];
    const doc = makeDoc("#ffffff", [makeScene("s1", "Scene 1", frames)]);
    const bytes = exportSWF(doc);
    const tags = findTags(bytes);
    // Only the scene-name FrameLabel (Scene 1) should be present
    const frameLabelTags = tags.filter((t) => t.type === TAG_FRAME_LABEL);
    const nonSceneLabels = frameLabelTags.filter(
      (t) => readCString(t.body) !== "Scene 1"
    );
    expect(nonSceneLabels.length).toBe(0);
  });
});
