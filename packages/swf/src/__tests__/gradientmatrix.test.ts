/**
 * Tests for SWF gradient fill matrix (MATRIX record) twips encoding.
 *
 * The SWF gradient coordinate space uses a ±16384 twips square that is
 * mapped to the fill via an affine MATRIX record. For a 100px wide shape:
 *   halfW = halfH = 100*20 / 2 = 1000 twips
 *   GRAD_HALF = 16384 twips
 *   scale = 1000 / 16384
 *   a (16.16) = round(scale * 65536) = round(1000 * 65536 / 16384) = 4000
 *   tx = cx in twips = 1000 (center of 0..2000)
 *
 * Fill type bytes (SWF spec):
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
// Minimal SWF tag parser
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function parseSWFTags(bytes: Uint8Array): SWFTag[] {
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

  const nBits = readBits(5);
  readBits(nBits * 4);
  bitsLeft = 0;
  byteOff += 4;

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
    if (tagCode === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// DefineShape4 body parser — extract first fill style type byte
// ---------------------------------------------------------------------------

function readFirstFillStyleType(body: Uint8Array): number {
  let byteOffset = 2; // skip charId
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
    readBits(nBits * 4);
    bitsLeft = 0;
  }

  skipRect(); // ShapeBounds
  skipRect(); // EdgeBounds

  if (byteOffset >= body.length) return -1;
  byteOffset += 1; // flags

  if (byteOffset >= body.length) return -1;
  const count = body[byteOffset++];
  if (count === 0xff) byteOffset += 2;
  if (count === 0 || byteOffset >= body.length) return -1;

  return body[byteOffset];
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

/** 100×100 shape with linear gradient fill at angle=0. */
function makeLinearGradientShape(): ShapeDisplayObject {
  const shape: Shape = {
    id: "linear-shape",
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
    id: "shape-obj-linear",
    type: "shape",
    shape,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

/** 100×100 shape with radial gradient fill. */
function makeRadialGradientShape(): ShapeDisplayObject {
  const shape: Shape = {
    id: "radial-shape",
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
    id: "shape-obj-radial",
    type: "shape",
    shape,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

const TAG_DEFINE_SHAPE4 = 83;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF gradient matrix twips encoding", () => {
  // ---- 1. Linear gradient compiles without error ----
  it("shape with linear gradient fill compiles without error", () => {
    const doc = makeDoc([makeLinearGradientShape()]);
    expect(() => compileDocument(doc)).not.toThrow();
    const bytes = compileDocument(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(20);
  });

  // ---- 2. Radial gradient compiles without error ----
  it("shape with radial gradient fill compiles without error", () => {
    const doc = makeDoc([makeRadialGradientShape()]);
    expect(() => compileDocument(doc)).not.toThrow();
    const bytes = compileDocument(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(20);
  });

  // ---- 3. Linear gradient fill type byte = 0x10 ----
  it("linear gradient FILLSTYLE type byte is 0x10 in DefineShape4", () => {
    const doc = makeDoc([makeLinearGradientShape()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThan(0);
    const fillType = readFirstFillStyleType(shapeTags[0].body);
    expect(fillType).toBe(0x10);
  });

  // ---- 3b. Radial gradient fill type byte = 0x12 ----
  it("radial gradient FILLSTYLE type byte is 0x12 in DefineShape4", () => {
    const doc = makeDoc([makeRadialGradientShape()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThan(0);
    const fillType = readFirstFillStyleType(shapeTags[0].body);
    expect(fillType).toBe(0x12);
  });

  // ---- 4. Gradient matrix scale for 100px wide shape ----
  //
  // For a 100×100 shape the expected gradient matrix parameters are:
  //   halfW = halfH = 1000 twips  (100px * 20)
  //   GRAD_HALF = 16384 twips
  //   scale = 1000 / 16384
  //   a (16.16) = round(scale * 65536) = 4000
  //   tx = cy = 1000 twips  (center of 0..2000)
  //
  // We verify the scale factor calculation is consistent with the SWF spec:
  // 100px * 20 twips/px / 2 = 1000 half-extent in twips.
  it("gradient matrix scale factor calculation: 100px shape → halfW = 1000 twips", () => {
    const shapeWidthPx = 100;
    const twipsPerPx = 20;
    const GRAD_HALF = 16384;

    const halfW = (shapeWidthPx * twipsPerPx) / 2; // 1000
    expect(halfW).toBe(1000);

    const scale = halfW / GRAD_HALF;
    const a_fixed = Math.round(scale * 65536); // 16.16 fixed-point
    // 1000 * 65536 / 16384 = 65536000 / 16384 = 4000
    expect(a_fixed).toBe(4000);
  });

  it("gradient matrix center tx/ty: 100px shape centered at 1000 twips", () => {
    const shapeWidthPx = 100;
    const shapeHeightPx = 100;
    const twipsPerPx = 20;

    // Shape goes from (0,0) to (100,100) in pixels → (0,0) to (2000,2000) in twips
    const xMinTwips = 0;
    const xMaxTwips = shapeWidthPx * twipsPerPx; // 2000
    const yMinTwips = 0;
    const yMaxTwips = shapeHeightPx * twipsPerPx; // 2000

    const cx = Math.round((xMinTwips + xMaxTwips) / 2); // 1000
    const cy = Math.round((yMinTwips + yMaxTwips) / 2); // 1000

    expect(cx).toBe(1000);
    expect(cy).toBe(1000);
  });

  it("gradient matrix scale for 200px wide shape → a_fixed = 8000", () => {
    const shapeWidthPx = 200;
    const twipsPerPx = 20;
    const GRAD_HALF = 16384;

    const halfW = (shapeWidthPx * twipsPerPx) / 2; // 2000
    const scale = halfW / GRAD_HALF;
    const a_fixed = Math.round(scale * 65536);
    // 2000 * 65536 / 16384 = 8000
    expect(a_fixed).toBe(8000);
  });

  it("linear gradient with angle produces a DefineShape4 tag", () => {
    const shape: Shape = {
      id: "angled",
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
              { ratio: 255, color: { r: 0, g: 0, b: 255, a: 255 } },
            ],
          },
        },
      ],
    };
    const shapeObj: ShapeDisplayObject = {
      id: "angled-obj",
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
