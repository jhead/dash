/**
 * Free Transform Distort/Envelope warp baking into published SWF (task 1228).
 *
 * A PlaceObject2/3 matrix is affine and cannot represent a non-affine distort
 * (perspective quad) or envelope (Coons/bezier mesh). Real Flash 8 — and now we
 * — bake the warp into the DefineShape edge coordinates at publish time so the
 * published movie matches the editor stage.
 *
 * These tests compile a warped shape via exportSWF, locate the emitted
 * DefineShape4 tag in OUR OWN SWF output, decode its ShapeBounds RECT, and
 * assert the baked geometry reflects the warp (distinct from the un-warped
 * shape). They also exercise the engine bake helper directly so the
 * stage↔publish equivalence is explicit.
 */
import { describe, it, expect } from "vitest";
import { exportSWF } from "../export.js";
import { bakeWarpIntoShape } from "../compiler/characters.js";
import { warpShape } from "@flash/core";
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
// SWF tag parsing (mirrors e2e-compile.test.ts)
// ---------------------------------------------------------------------------

interface SwfTag {
  type: number;
  body: Uint8Array;
}

const TAG_DEFINE_SHAPE4 = 83;

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

/**
 * Decode the first RECT (ShapeBounds) from a DefineShape4 body. The body starts
 * with a UI16LE charId, then ShapeBounds RECT (bit-packed: UB[5] nBits then
 * 4×SB[nBits] = xMin,xMax,yMin,yMax in twips). Returns twip bounds.
 */
function decodeShapeBounds(body: Uint8Array): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} {
  let byteOffset = 2; // skip charId
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
    // sign-extend
    const signBit = 1 << (n - 1);
    return raw & signBit ? raw - (1 << n) : raw;
  }
  const nBits = readUB(5);
  const xMin = readSB(nBits);
  const xMax = readSB(nBits);
  const yMin = readSB(nBits);
  const yMax = readSB(nBits);
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
    id: "warp-doc",
    properties: { ...BASE_PROPS },
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}

function shapeBoundsFromSwf(doc: FlashDocument) {
  const swf = exportSWF(doc, { compress: false });
  const tags = findTags(swf);
  const shapeTags = tags.filter((t) => t.type === TAG_DEFINE_SHAPE4);
  expect(shapeTags.length).toBe(1);
  return decodeShapeBounds(shapeTags[0].body);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Free Transform warp baked into published SWF (task 1228)", () => {
  // Object placed at (50,50); local 100×100 square → stage-space corners
  // nw=(50,50), ne=(150,50), se=(150,150), sw=(50,150).
  const OBJ_X = 50;
  const OBJ_Y = 50;

  function distortWarp(): ShapeWarp {
    // Identity corners except SE dragged from (150,150) out to (300,250).
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

  it("un-warped shape publishes its pristine (origin-relative) bounds", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: squareShape(),
      x: OBJ_X,
      y: OBJ_Y,
    };
    const b = shapeBoundsFromSwf(makeDoc([obj]));
    // Origin-relative 100×100 square → 0..2000 twips on each axis.
    expect(b.xMin).toBe(0);
    expect(b.yMin).toBe(0);
    expect(b.xMax).toBe(2000);
    expect(b.yMax).toBe(2000);
  });

  it("a Distort warp is baked into the published DefineShape4 geometry", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: squareShape(),
      x: OBJ_X,
      y: OBJ_Y,
      warp: distortWarp(),
    };
    const b = shapeBoundsFromSwf(makeDoc([obj]));
    // Stage SE corner dragged to (300,250); the baked geometry is origin-
    // relative (absolute − placement offset), so SE → (250,200) px →
    // (5000,4000) twips. The pristine square would have been 2000×2000.
    expect(b.xMin).toBe(0); // nw/sw still at local 0
    expect(b.yMin).toBe(0);
    expect(b.xMax).toBe(5000); // dragged-out SE corner, NOT 2000
    expect(b.yMax).toBe(4000);
  });

  it("baked publish geometry matches the editor stage warpShape() output", () => {
    // The compiler must reuse the SAME engine warp the stage renderer uses.
    const shape = squareShape();
    const warp = distortWarp();
    // Stage: warpShape maps local → ABSOLUTE stage space.
    const stageAbsolute = warpShape(shape, warp, OBJ_X, OBJ_Y);
    // Publish: bakeWarpIntoShape = absolute − placement offset (origin-relative,
    // since PlaceObject2 tx/ty carries the offset). Adding the offset back must
    // exactly reproduce the stage's absolute geometry.
    const baked = bakeWarpIntoShape(shape, warp, OBJ_X, OBJ_Y);
    const stagePts = stageAbsolute.paths[0].start;
    const bakedPts = baked.paths[0].start;
    expect(bakedPts.x + OBJ_X).toBeCloseTo(stagePts.x, 6);
    expect(bakedPts.y + OBJ_Y).toBeCloseTo(stagePts.y, 6);
    // Every segment endpoint too.
    const stageSegs = stageAbsolute.paths[0].segments;
    const bakedSegs = baked.paths[0].segments;
    expect(bakedSegs.length).toBe(stageSegs.length);
    for (let i = 0; i < stageSegs.length; i++) {
      const s = stageSegs[i];
      const bk = bakedSegs[i];
      if (s.type === "line" && bk.type === "line") {
        expect(bk.to.x + OBJ_X).toBeCloseTo(s.to.x, 6);
        expect(bk.to.y + OBJ_Y).toBeCloseTo(s.to.y, 6);
      }
    }
  });

  it("an Envelope warp (bent edges, subdivided to chords) is baked too", () => {
    // Identity envelope corners, but bow the bottom edge downward via b0/b1.
    const envelope: ShapeWarp = {
      mode: "envelope",
      origBounds: { x: OBJ_X, y: OBJ_Y, width: 100, height: 100 },
      corners: {
        nw: { x: 50, y: 50 },
        ne: { x: 150, y: 50 },
        se: { x: 150, y: 150 },
        sw: { x: 50, y: 150 },
      },
      edges: {
        t0: { x: 50 + 100 / 3, y: 50 },
        t1: { x: 50 + 200 / 3, y: 50 },
        r0: { x: 150, y: 50 + 100 / 3 },
        r1: { x: 150, y: 50 + 200 / 3 },
        // Bottom edge bowed DOWN by 80px at its control points.
        b0: { x: 50 + 100 / 3, y: 230 },
        b1: { x: 50 + 200 / 3, y: 230 },
        l0: { x: 50, y: 50 + 100 / 3 },
        l1: { x: 50, y: 50 + 200 / 3 },
      },
    };
    // The square's corners map to the (unchanged) corners; the bow only bends
    // the bottom edge BETWEEN them, so include an explicit midpoint vertex on
    // the bottom edge (u=0.5,v=1) for it to sample the bowed region.
    const shapeWithBottomMid: Shape = {
      id: "sq",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 100, y: 0 } },
            { type: "line", to: { x: 100, y: 100 } },
            { type: "line", to: { x: 50, y: 100 } }, // bottom-edge midpoint
            { type: "line", to: { x: 0, y: 100 } },
            { type: "line", to: { x: 0, y: 0 } },
          ],
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
          closed: true,
        },
      ],
    };
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: shapeWithBottomMid,
      x: OBJ_X,
      y: OBJ_Y,
      warp: envelope,
    };
    const b = shapeBoundsFromSwf(makeDoc([obj]));
    // The bowed bottom edge pushes the geometry well past the pristine 2000-twip
    // bottom; the cubic mid-rise of a 180px control bow lifts the published
    // yMax substantially above 2000.
    expect(b.yMax).toBeGreaterThan(2500);
  });
});
