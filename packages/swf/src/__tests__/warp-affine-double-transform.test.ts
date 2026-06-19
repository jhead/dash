/**
 * Free Transform warp + affine double-transform (task 1230).
 *
 * Task 1228 bakes a Distort/Envelope warp into ABSOLUTE-stage DefineShape4
 * geometry (then subtracts the placement offset so the shape stays
 * origin-relative and PlaceObject2 tx/ty restores position). The baked geometry
 * therefore already encodes the FULL stage-space transform, including any
 * scale/rotation that was in effect when the warp was authored (the warp corners
 * live in stage space and are captured from the already scaled/rotated AABB).
 *
 * BUG: the frame loop still emitted PlaceObject2 with the object's affine
 * scaleX/scaleY/rotation, so a warped shape that ALSO carried non-identity
 * scale/rotation was transformed TWICE in the published SWF — once in the baked
 * geometry, once again by the PlaceObject2 matrix. The editor renderer
 * (renderer.ts) ignores affine entirely when a warp is present (warp supersedes
 * affine), so the published SWF disagreed with the stage.
 *
 * FIX: for warped shapes the frame loop emits an IDENTITY objTransform (the
 * baked warp is the sole geometry transform; PlaceObject2 tx/ty still position
 * it), matching the editor renderer exactly. Pure-warp (identity affine) and
 * pure-affine (no warp) cases are unchanged.
 *
 * These tests decode the PlaceObject2 MATRIX and the DefineShape4 ShapeBounds
 * from OUR OWN compiled SWF and assert the transform is applied exactly once.
 */
import { describe, it, expect } from "vitest";
import { exportSWF } from "../export.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Shape,
  ShapeDisplayObject,
  ShapeWarp,
} from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parsing
// ---------------------------------------------------------------------------

interface SwfTag {
  type: number;
  body: Uint8Array;
}

const TAG_DEFINE_SHAPE4 = 83;
const TAG_PLACE_OBJECT2 = 26;

function findTags(bytes: Uint8Array): SwfTag[] {
  const nbits = bytes[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let i = 8 + rectBytes + 4;
  const tags: SwfTag[] = [];
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

/** A bit reader for the packed MATRIX / RECT structures. */
function makeBitReader(body: Uint8Array, startByte: number) {
  let byteOffset = startByte;
  let bitBuf = 0;
  let bitsLeft = 0;
  function readUB(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitsLeft === 0) {
        bitBuf = body[byteOffset++];
        bitsLeft = 8;
      }
      result = (result << 1) | ((bitBuf >> (bitsLeft - 1)) & 1);
      bitsLeft--;
    }
    return result;
  }
  function readSB(n: number): number {
    if (n === 0) return 0;
    const raw = readUB(n);
    const signBit = 1 << (n - 1);
    return raw & signBit ? raw - (1 << n) : raw;
  }
  return { readUB, readSB };
}

interface DecodedMatrix {
  hasScale: boolean;
  scaleX: number; // FB 16.16, decoded to float (only meaningful if hasScale)
  scaleY: number;
  hasRotate: boolean;
  rotateSkew0: number;
  rotateSkew1: number;
  translateX: number; // twips
  translateY: number;
}

/**
 * Decode a PlaceObject2 body's MATRIX. Body layout:
 *   UI8 flags, UI16 depth, UI16 charId, then the bit-packed MATRIX.
 * (Our encoder always sets HasCharacter|HasMatrix and no other optional fields
 * for the un-named/un-cxform path used by these fixtures.)
 */
function decodePlaceMatrix(body: Uint8Array): {
  flags: number;
  depth: number;
  charId: number;
  matrix: DecodedMatrix;
} {
  const flags = body[0];
  const depth = body[1] | (body[2] << 8);
  const charId = body[3] | (body[4] << 8);
  const r = makeBitReader(body, 5);
  const hasScale = r.readUB(1) === 1;
  let scaleX = 1;
  let scaleY = 1;
  if (hasScale) {
    const nBits = r.readUB(5);
    scaleX = r.readSB(nBits) / 65536;
    scaleY = r.readSB(nBits) / 65536;
  }
  const hasRotate = r.readUB(1) === 1;
  let rotateSkew0 = 0;
  let rotateSkew1 = 0;
  if (hasRotate) {
    const nBits = r.readUB(5);
    rotateSkew0 = r.readSB(nBits) / 65536;
    rotateSkew1 = r.readSB(nBits) / 65536;
  }
  const tBits = r.readUB(5);
  const translateX = r.readSB(tBits);
  const translateY = r.readSB(tBits);
  return {
    flags,
    depth,
    charId,
    matrix: {
      hasScale,
      scaleX,
      scaleY,
      hasRotate,
      rotateSkew0,
      rotateSkew1,
      translateX,
      translateY,
    },
  };
}

/** Decode the ShapeBounds RECT (twips) from a DefineShape4 body. */
function decodeShapeBounds(body: Uint8Array): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} {
  const r = makeBitReader(body, 2); // skip charId
  const nBits = r.readUB(5);
  const xMin = r.readSB(nBits);
  const xMax = r.readSB(nBits);
  const yMin = r.readSB(nBits);
  const yMax = r.readSB(nBits);
  return { xMin, xMax, yMin, yMax };
}

// ---------------------------------------------------------------------------
// Document factory helpers
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 24,
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

/** A 100×100 axis-aligned square contour in LOCAL space (origin-relative). */
function squareShape(): Shape {
  return {
    id: "sq",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 100, y: 0 } },
          { type: "line", to: { x: 100, y: 100 } },
          { type: "line", to: { x: 0, y: 100 } },
          { type: "line", to: { x: 0, y: 0 } },
        ],
        fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
        closed: true,
      },
    ],
  };
}

function makeFrame(displayObjects: ShapeDisplayObject[]): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: false,
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
    displayObjects,
  };
}

function makeLayer(displayObjects: ShapeDisplayObject[]): Layer {
  return {
    id: "layer-0",
    name: "Layer 1",
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
    timeline: { layers: [makeLayer(displayObjects)] },
  };
  return {
    id: "warp-affine-doc",
    properties: { ...BASE_PROPS },
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}

function decodeFromSwf(doc: FlashDocument) {
  const swf = exportSWF(doc, { compress: false });
  const tags = findTags(swf);
  const shapeTags = tags.filter((t) => t.type === TAG_DEFINE_SHAPE4);
  const placeTags = tags.filter((t) => t.type === TAG_PLACE_OBJECT2);
  expect(shapeTags.length).toBe(1);
  expect(placeTags.length).toBe(1);
  return {
    bounds: decodeShapeBounds(shapeTags[0].body),
    place: decodePlaceMatrix(placeTags[0].body),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Free Transform warp + affine double-transform (task 1230)", () => {
  // Object placed at (50,50); local 100×100 square → stage corners
  // nw=(50,50), ne=(150,50), se=(150,150), sw=(50,150).
  const OBJ_X = 50;
  const OBJ_Y = 50;

  /** Identity-corner distort except SE dragged from (150,150) to (300,250). */
  function distortWarp(): ShapeWarp {
    return {
      mode: "distort",
      origBounds: { x: OBJ_X, y: OBJ_Y, width: 100, height: 100 },
      corners: {
        nw: { x: 50, y: 50 },
        ne: { x: 150, y: 50 },
        se: { x: 300, y: 250 },
        sw: { x: 50, y: 150 },
      },
    };
  }

  it("warp + scaleX=2 does NOT also apply scale in PlaceObject2 (no double transform)", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: squareShape(),
      x: OBJ_X,
      y: OBJ_Y,
      scaleX: 2,
      scaleY: 2,
      warp: distortWarp(),
    };
    const { bounds, place } = decodeFromSwf(makeDoc([obj]));

    // PlaceObject2 matrix is translate-only (identity scale/rotate): the warp is
    // the sole geometry transform, exactly as the editor renderer draws it.
    expect(place.matrix.hasScale).toBe(false);
    expect(place.matrix.hasRotate).toBe(false);
    expect(place.matrix.translateX).toBe(OBJ_X * 20); // 1000 twips
    expect(place.matrix.translateY).toBe(OBJ_Y * 20); // 1000 twips

    // Baked geometry reflects ONLY the warp (SE corner → 250,200 px origin-rel →
    // 5000,4000 twips). It is NOT doubled by scaleX/scaleY=2 (which would be
    // 10000,8000) and NOT the pristine 2000,2000.
    expect(bounds.xMin).toBe(0);
    expect(bounds.yMin).toBe(0);
    expect(bounds.xMax).toBe(5000);
    expect(bounds.yMax).toBe(4000);
  });

  it("warp + rotation=30 does NOT also apply rotation in PlaceObject2", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: squareShape(),
      x: OBJ_X,
      y: OBJ_Y,
      rotation: 30,
      warp: distortWarp(),
    };
    const { bounds, place } = decodeFromSwf(makeDoc([obj]));

    // No rotation (and no scale) in the placement matrix — translate only.
    expect(place.matrix.hasRotate).toBe(false);
    expect(place.matrix.hasScale).toBe(false);
    expect(place.matrix.translateX).toBe(OBJ_X * 20);
    expect(place.matrix.translateY).toBe(OBJ_Y * 20);

    // Baked geometry is the pure warp; the rotation is not compounded into it.
    expect(bounds.xMax).toBe(5000);
    expect(bounds.yMax).toBe(4000);
  });

  it("pure warp (identity affine) is unchanged: translate-only placement", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: squareShape(),
      x: OBJ_X,
      y: OBJ_Y,
      warp: distortWarp(),
    };
    const { bounds, place } = decodeFromSwf(makeDoc([obj]));
    expect(place.matrix.hasScale).toBe(false);
    expect(place.matrix.hasRotate).toBe(false);
    expect(place.matrix.translateX).toBe(OBJ_X * 20);
    expect(place.matrix.translateY).toBe(OBJ_Y * 20);
    expect(bounds.xMax).toBe(5000);
    expect(bounds.yMax).toBe(4000);
  });

  it("pure affine (scaleX=2, no warp) STILL applies scale in PlaceObject2 (no regression)", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: squareShape(),
      x: OBJ_X,
      y: OBJ_Y,
      scaleX: 2,
      scaleY: 2,
    };
    const { bounds, place } = decodeFromSwf(makeDoc([obj]));

    // Without a warp the affine MUST be carried by the placement matrix: the
    // shape is encoded at its pristine origin-relative bounds and scaled by PO2.
    expect(place.matrix.hasScale).toBe(true);
    expect(place.matrix.scaleX).toBeCloseTo(2, 3);
    expect(place.matrix.scaleY).toBeCloseTo(2, 3);
    expect(place.matrix.translateX).toBe(OBJ_X * 20);
    expect(place.matrix.translateY).toBe(OBJ_Y * 20);

    // Pristine geometry (the scale lives in PO2, not the shape record).
    expect(bounds.xMax).toBe(2000);
    expect(bounds.yMax).toBe(2000);
  });

  it("pure affine (rotation=30, no warp) STILL applies rotation in PlaceObject2", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: squareShape(),
      x: OBJ_X,
      y: OBJ_Y,
      rotation: 30,
    };
    const { place, bounds } = decodeFromSwf(makeDoc([obj]));
    expect(place.matrix.hasRotate).toBe(true);
    expect(bounds.xMax).toBe(2000); // pristine; rotation is in PO2
    expect(bounds.yMax).toBe(2000);
  });
});
