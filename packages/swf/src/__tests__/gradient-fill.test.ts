/**
 * Tests for DefineShape gradient fill encoding.
 *
 * Verifies that a ShapeDisplayObject with a LinearGradient or RadialGradient
 * fill compiles to a valid SWF that contains a DefineShape4 tag (code 83)
 * whose fill style area includes the correct gradient fill type byte
 * (0x10 for linear, 0x12 for radial).
 *
 * SWF fill style type bytes:
 *   0x00 = solid fill
 *   0x10 = linear gradient
 *   0x12 = radial gradient
 *   0x13 = focal radial gradient
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
// SWF tag parser (minimal)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

/**
 * Parse SWF tag records from a full SWF byte array.
 * Skips the SWF header (fixed 8-byte prefix + variable RECT + 4 bytes).
 */
function parseSWFTags(bytes: Uint8Array): SWFTag[] {
  // SWF header: 3 signature + 1 version + 4 fileLength = 8 bytes
  // Then a bit-packed RECT (FrameSize)
  let byteOff = 8;
  let bitBuf = 0;
  let bitsLeft = 0;

  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitsLeft === 0) {
        bitBuf = bytes[byteOff++];
        bitsLeft = 8;
      }
      result = (result << 1) | ((bitBuf >> (bitsLeft - 1)) & 1);
      bitsLeft--;
    }
    return result;
  }

  // Skip the RECT (5-bit nBits + 4 * nBits)
  const nBits = readBits(5);
  readBits(nBits * 4); // xMin, xMax, yMin, yMax
  bitsLeft = 0; // flush to byte boundary

  // Skip FrameRate (UI16LE) + FrameCount (UI16LE)
  byteOff += 4;

  // Now parse tag records
  const tags: SWFTag[] = [];
  let pos = byteOff;
  while (pos + 2 <= bytes.length) {
    const recordHdr = bytes[pos] | (bytes[pos + 1] << 8);
    const tagCode = (recordHdr >> 6) & 0x3ff;
    let bodyLength = recordHdr & 0x3f;
    let hdrSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        bytes[pos + 2] |
        (bytes[pos + 3] << 8) |
        (bytes[pos + 4] << 16) |
        (bytes[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({
      code: tagCode,
      body: bytes.slice(bodyStart, bodyStart + bodyLength),
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break; // End tag
  }
  return tags;
}

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

function makeLayer(name: string, frame: Frame): Layer {
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
    frames: [frame],
    frameCount: 1,
  };
}

function makeScene(displayObjects: ShapeDisplayObject[]): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: {
      layers: [makeLayer("Layer 1", makeFrame(displayObjects))],
    },
  };
}

function makeDoc(displayObjects: ShapeDisplayObject[]): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene(displayObjects)],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Shape builders
// ---------------------------------------------------------------------------

/** Build a 100x100 rectangle ShapeDisplayObject with a linear gradient fill. */
function makeLinearGradientShape(): ShapeDisplayObject {
  const shape: Shape = {
    id: "gradient-shape",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 100, y: 0 } },
          { type: "line", to: { x: 100, y: 100 } },
          { type: "line", to: { x: 0, y: 100 } },
        ],
        closed: true,
        fill: {
          type: "linear-gradient",
          angle: 0,
          stops: [
            { ratio: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
            { ratio: 255, color: { r: 0, g: 0, b: 255, a: 255 } },
          ],
        },
      },
    ],
  };
  return {
    id: "shape-obj-1",
    type: "shape",
    shape,
    x: 10,
    y: 10,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

/** Build a 100x100 rectangle ShapeDisplayObject with a radial gradient fill. */
function makeRadialGradientShape(): ShapeDisplayObject {
  const shape: Shape = {
    id: "radial-gradient-shape",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 100, y: 0 } },
          { type: "line", to: { x: 100, y: 100 } },
          { type: "line", to: { x: 0, y: 100 } },
        ],
        closed: true,
        fill: {
          type: "radial-gradient",
          focalPoint: 0,
          stops: [
            { ratio: 0, color: { r: 255, g: 255, b: 0, a: 255 } },
            { ratio: 255, color: { r: 0, g: 128, b: 0, a: 255 } },
          ],
        },
      },
    ],
  };
  return {
    id: "shape-obj-2",
    type: "shape",
    shape,
    x: 10,
    y: 10,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

/** Build a 100x100 rectangle ShapeDisplayObject with a focal radial gradient fill. */
function makeFocalRadialGradientShape(): ShapeDisplayObject {
  const shape: Shape = {
    id: "focal-radial-gradient-shape",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 100, y: 0 } },
          { type: "line", to: { x: 100, y: 100 } },
          { type: "line", to: { x: 0, y: 100 } },
        ],
        closed: true,
        fill: {
          type: "radial-gradient",
          focalPoint: 0.5,
          stops: [
            { ratio: 0, color: { r: 255, g: 255, b: 0, a: 255 } },
            { ratio: 255, color: { r: 0, g: 128, b: 0, a: 255 } },
          ],
        },
      },
    ],
  };
  return {
    id: "shape-obj-3",
    type: "shape",
    shape,
    x: 10,
    y: 10,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

// ---------------------------------------------------------------------------
// DefineShape4 body parser helper
// ---------------------------------------------------------------------------

/**
 * Locate the fill style type byte in a DefineShape4 body.
 *
 * DefineShape4 body layout:
 *   [0..1]  charId UI16LE
 *   [2..]   ShapeBounds RECT (variable, bit-packed)
 *   [..]    EdgeBounds RECT (variable, bit-packed)
 *   [..]    UI8 flags
 *   [..]    UI8 fillStyleCount (or 0xFF + UI16LE for extended)
 *   [..]    UI8 fillStyleType  ← first fill style type byte
 *
 * Returns the fill style type byte for the first fill entry, or -1 if
 * the body is too short to parse.
 */
function readFirstFillStyleType(body: Uint8Array): number {
  // Skip charId (2 bytes)
  let byteOffset = 2;
  let bitBuf = 0;
  let bitsLeft = 0;

  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitsLeft === 0) {
        if (byteOffset >= body.length) return 0;
        bitBuf = body[byteOffset++];
        bitsLeft = 8;
      }
      result = (result << 1) | ((bitBuf >> (bitsLeft - 1)) & 1);
      bitsLeft--;
    }
    return result;
  }

  function skipRect(): void {
    const nBits = readBits(5);
    readBits(nBits * 4); // xMin, xMax, yMin, yMax
    bitsLeft = 0; // flush to byte boundary
  }

  skipRect(); // ShapeBounds
  skipRect(); // EdgeBounds

  // UI8 DefineShape4 flags
  if (byteOffset >= body.length) return -1;
  byteOffset += 1;

  // fillStyleCount
  if (byteOffset >= body.length) return -1;
  const count = body[byteOffset++];
  if (count === 0xff) {
    // Extended count: skip UI16LE
    byteOffset += 2;
  }

  if (count === 0 || byteOffset >= body.length) return -1;

  // First fill style type byte
  return body[byteOffset];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const TAG_DEFINE_SHAPE4 = 83;

describe("DefineShape gradient fill — full SWF compilation", () => {
  it("linear gradient shape compiles to a Uint8Array without error", () => {
    const doc = makeDoc([makeLinearGradientShape()]);
    const bytes = compileDocument(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(20);
  });

  it("linear gradient shape produces a DefineShape4 tag (code 83)", () => {
    const doc = makeDoc([makeLinearGradientShape()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThan(0);
  });

  it("linear gradient fill style type byte is 0x10", () => {
    const doc = makeDoc([makeLinearGradientShape()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThan(0);

    const fillType = readFirstFillStyleType(shapeTags[0].body);
    // 0x10 = linear gradient fill type in SWF spec
    expect(fillType).toBe(0x10);
  });

  it("radial gradient shape compiles without error", () => {
    const doc = makeDoc([makeRadialGradientShape()]);
    const bytes = compileDocument(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(20);
  });

  it("radial gradient shape produces a DefineShape4 tag (code 83)", () => {
    const doc = makeDoc([makeRadialGradientShape()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThan(0);
  });

  it("radial gradient fill style type byte is 0x12 (non-focal)", () => {
    const doc = makeDoc([makeRadialGradientShape()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThan(0);

    const fillType = readFirstFillStyleType(shapeTags[0].body);
    // 0x12 = radial gradient fill type in SWF spec
    expect(fillType).toBe(0x12);
  });

  it("focal radial gradient fill style type byte is 0x13", () => {
    const doc = makeDoc([makeFocalRadialGradientShape()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThan(0);

    const fillType = readFirstFillStyleType(shapeTags[0].body);
    // 0x13 = focal radial gradient fill type in SWF spec
    expect(fillType).toBe(0x13);
  });

  it("linear gradient with angled fill (45 degrees) compiles without error", () => {
    const shape: Shape = {
      id: "angled-gradient-shape",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 100, y: 0 } },
            { type: "line", to: { x: 100, y: 100 } },
            { type: "line", to: { x: 0, y: 100 } },
          ],
          closed: true,
          fill: {
            type: "linear-gradient",
            angle: 45,
            stops: [
              { ratio: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
              { ratio: 128, color: { r: 255, g: 255, b: 0, a: 255 } },
              { ratio: 255, color: { r: 0, g: 0, b: 255, a: 255 } },
            ],
          },
        },
      ],
    };
    const shapeObj: ShapeDisplayObject = {
      id: "angled-shape-obj",
      type: "shape",
      shape,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    };
    const doc = makeDoc([shapeObj]);
    const bytes = compileDocument(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(20);
  });

  it("linear gradient with multiple stops produces a DefineShape4 with fill type 0x10", () => {
    const shape: Shape = {
      id: "multi-stop-gradient",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 200, y: 0 } },
            { type: "line", to: { x: 200, y: 50 } },
            { type: "line", to: { x: 0, y: 50 } },
          ],
          closed: true,
          fill: {
            type: "linear-gradient",
            angle: 0,
            stops: [
              { ratio: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
              { ratio: 85, color: { r: 0, g: 255, b: 0, a: 255 } },
              { ratio: 170, color: { r: 0, g: 0, b: 255, a: 255 } },
              { ratio: 255, color: { r: 255, g: 0, b: 0, a: 255 } },
            ],
          },
        },
      ],
    };
    const shapeObj: ShapeDisplayObject = {
      id: "multi-stop-obj",
      type: "shape",
      shape,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    };
    const doc = makeDoc([shapeObj]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThan(0);
    const fillType = readFirstFillStyleType(shapeTags[0].body);
    expect(fillType).toBe(0x10);
  });
});
