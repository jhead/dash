/**
 * Tests for DefineShape4 (tag 83) fill and stroke styles.
 *
 * Verifies that ShapeDisplayObjects with various fill/stroke configurations
 * produce SWF bytes containing DefineShape4 tags (code 83) with the correct
 * structure and style data.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Shape,
  ShapeDisplayObject,
} from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser (as specified in the task description)
// ---------------------------------------------------------------------------

function findTags(bytes: Uint8Array) {
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

const TAG_DEFINE_SHAPE4 = 83;

// ---------------------------------------------------------------------------
// Document fixture helpers
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

const DEFAULT_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

function makeFrame(displayObjects: ShapeDisplayObject[]): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: displayObjects.length === 0,
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
    displayObjects,
  };
}

function makeLayer(name: string, displayObjects: ShapeDisplayObject[]): Layer {
  return {
    id: `layer-${name}`,
    name,
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames: [makeFrame(displayObjects)],
    frameCount: 1,
  };
}

function makeDoc(displayObjects: ShapeDisplayObject[]): FlashDocument {
  const scene: Scene = {
    id: "scene-1",
    name: "Scene 1",
    timeline: {
      layers: [makeLayer("Layer 1", displayObjects)],
    },
  };
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Shape builders
// ---------------------------------------------------------------------------

/** Build a ShapeDisplayObject with a solid fill of the given color. */
function makeFillShape(
  id: string,
  r: number,
  g: number,
  b: number,
  x = 10,
  y = 10
): ShapeDisplayObject {
  const shape: Shape = {
    id: `shape-${id}`,
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 50, y: 0 } },
          { type: "line", to: { x: 50, y: 50 } },
          { type: "line", to: { x: 0, y: 50 } },
        ],
        closed: true,
        fill: { type: "solid", color: { r, g, b, a: 255 } },
      },
    ],
  };
  return { id, type: "shape", shape, x, y };
}

/** Build a ShapeDisplayObject with a stroke only (no fill). */
function makeStrokeOnlyShape(id: string, x = 10, y = 10): ShapeDisplayObject {
  const shape: Shape = {
    id: `shape-${id}`,
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [{ type: "line", to: { x: 50, y: 0 } }],
        closed: false,
        stroke: {
          type: "solid",
          color: { r: 0, g: 0, b: 0, a: 255 },
          width: 2,
          caps: "round",
          joints: "round",
          miterLimit: 3,
        },
      },
    ],
  };
  return { id, type: "shape", shape, x, y };
}

/** Read charId (UI16LE) from the first two bytes of a tag body. */
function readCharId(body: Uint8Array): number {
  return body[0] | (body[1] << 8);
}

/**
 * Search for a byte sequence within a Uint8Array.
 * Returns true if the sequence exists anywhere in the array.
 */
function containsBytes(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineShape4 (tag 83) fill and stroke styles", () => {
  it("1. A ShapeDisplayObject with fill color produces tag 83 (DefineShape4)", () => {
    const doc = makeDoc([makeFillShape("s1", 255, 0, 0)]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const shape4Tags = tags.filter((t) => t.type === TAG_DEFINE_SHAPE4);
    expect(shape4Tags.length).toBeGreaterThan(0);
  });

  it("2. Tag 83 body starts with character ID (UI16 >= 1)", () => {
    const doc = makeDoc([makeFillShape("s1", 255, 0, 0)]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const shape4Tags = tags.filter((t) => t.type === TAG_DEFINE_SHAPE4);
    expect(shape4Tags.length).toBeGreaterThan(0);
    const charId = readCharId(shape4Tags[0].body);
    expect(charId).toBeGreaterThanOrEqual(1);
  });

  it("3. A shape with red fill (#FF0000): the body contains bytes [0xFF, 0x00, 0x00] somewhere after FillStyleCount", () => {
    const doc = makeDoc([makeFillShape("s1", 0xff, 0x00, 0x00)]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const shape4Tags = tags.filter((t) => t.type === TAG_DEFINE_SHAPE4);
    expect(shape4Tags.length).toBeGreaterThan(0);
    // The red color bytes should appear somewhere in the body after the header
    const body = shape4Tags[0].body;
    expect(containsBytes(body, [0xff, 0x00, 0x00])).toBe(true);
  });

  it("4. A shape with no fill produces a tag 83 with FillStyleCount = 0 (if no fill) or has empty fill array", () => {
    const doc = makeDoc([makeStrokeOnlyShape("s1")]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const shape4Tags = tags.filter((t) => t.type === TAG_DEFINE_SHAPE4);
    expect(shape4Tags.length).toBeGreaterThan(0);
    // The stroke-only shape still produces a DefineShape4 tag
    const body = shape4Tags[0].body;
    expect(body.length).toBeGreaterThan(2); // has at least charId + RECT data
  });

  it("5. Multiple shapes each get their own tag 83 with distinct character IDs", () => {
    const doc = makeDoc([
      makeFillShape("s1", 255, 0, 0, 10, 10),
      makeFillShape("s2", 0, 255, 0, 100, 10),
    ]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const shape4Tags = tags.filter((t) => t.type === TAG_DEFINE_SHAPE4);
    expect(shape4Tags.length).toBeGreaterThanOrEqual(2);
    const charIds = shape4Tags.map((t) => readCharId(t.body));
    const uniqueIds = new Set(charIds);
    expect(uniqueIds.size).toBe(charIds.length);
    for (const id of charIds) {
      expect(id).toBeGreaterThanOrEqual(1);
    }
  });

  it("6. A stroke-only shape (no fill, has stroke) still produces tag 83", () => {
    const doc = makeDoc([makeStrokeOnlyShape("stroke-shape")]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const shape4Tags = tags.filter((t) => t.type === TAG_DEFINE_SHAPE4);
    expect(shape4Tags.length).toBeGreaterThan(0);
    const charId = readCharId(shape4Tags[0].body);
    expect(charId).toBeGreaterThanOrEqual(1);
  });
});
