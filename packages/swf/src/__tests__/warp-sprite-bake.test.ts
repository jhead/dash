/**
 * Free Transform Distort/Envelope warp baked into a SYMBOL-INTERNAL DefineShape4
 * (task 1232) — the sprite / symbol-internal publish path.
 *
 * Same defect class as task 1228 (warp bake into DefineShape) and task 1230
 * (warp + affine double-transform), but for a shape that lives INSIDE a
 * movieclip/graphic symbol rather than on the scene timeline. Reached in the
 * editor via symbol-edit / edit-in-place, where `handleShapeWarp` writes a
 * `warp` onto a ShapeDisplayObject inside the symbol's timeline.
 *
 * BUG: `sprite.ts` built the symbol's DefineShape4 from `shiftShapePaths` and
 * IGNORED `obj.warp`, then emitted an affine PlaceObject2 — so the published
 * symbol showed the pristine un-warped shape (stage/SWF divergence) and, for a
 * warped+scaled/rotated shape, would have double-transformed it.
 *
 * FIX: mirror the scene path. Bake `obj.warp` into the symbol's DefineShape4 via
 * the shared `bakeWarpIntoShape` (engine/warp.ts) and gate the sprite-internal
 * PlaceObject2 scale/rotation to identity for warped shapes (the baked warp is
 * the sole geometry transform, exactly as the editor renderer draws it).
 *
 * These tests compile a real movieclip-symbol document via `compileDocument`,
 * locate the DefineShape4 hoisted above the DefineSprite, decode its ShapeBounds,
 * and decode the sprite-internal PlaceObject2 matrix — all from OUR OWN SWF.
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
  ShapeWarp,
  Symbol,
  SymbolInstance,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_DEFINE_SHAPE4 = 83;
const TAG_PLACE_OBJECT2 = 26;
const TAG_DEFINE_SPRITE = 39;

// ---------------------------------------------------------------------------
// SWF tag / structure parsing
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

function findTagsOffset(bytes: Uint8Array): number {
  const nBits = (bytes[8] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + 4 * nBits) / 8);
  return 8 + rectBytes + 4;
}

function parseTags(bytes: Uint8Array): SwfTag[] {
  const tags: SwfTag[] = [];
  let pos = findTagsOffset(bytes);
  while (pos + 2 <= bytes.length) {
    const hdr = bytes[pos] | (bytes[pos + 1] << 8);
    const code = (hdr >> 6) & 0x3ff;
    let len = hdr & 0x3f;
    let hdrSize = 2;
    if (len === 0x3f) {
      len =
        bytes[pos + 2] |
        (bytes[pos + 3] << 8) |
        (bytes[pos + 4] << 16) |
        (bytes[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({ code, body: bytes.slice(bodyStart, bodyStart + len) });
    pos = bodyStart + len;
    if (code === TAG_END) break;
  }
  return tags;
}

/** Parse the inner control tags of a DefineSprite body (starts at byte 4). */
function decodeSpriteInnerTags(body: Uint8Array): SwfTag[] {
  let pos = 4;
  const inner: SwfTag[] = [];
  while (pos + 2 <= body.length) {
    const hdr = body[pos] | (body[pos + 1] << 8);
    const code = (hdr >> 6) & 0x3ff;
    let len = hdr & 0x3f;
    let hdrSize = 2;
    if (len === 0x3f) {
      len =
        body[pos + 2] |
        (body[pos + 3] << 8) |
        (body[pos + 4] << 16) |
        (body[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    inner.push({ code, body: body.slice(bodyStart, bodyStart + len) });
    pos = bodyStart + len;
    if (code === TAG_END) break;
  }
  return inner;
}

// ---------------------------------------------------------------------------
// Bit reader for RECT / MATRIX
// ---------------------------------------------------------------------------

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

function decodeShapeBounds(body: Uint8Array) {
  const r = makeBitReader(body, 2); // skip charId
  const nBits = r.readUB(5);
  return {
    xMin: r.readSB(nBits),
    xMax: r.readSB(nBits),
    yMin: r.readSB(nBits),
    yMax: r.readSB(nBits),
  };
}

/** Decode a PlaceObject2 body's MATRIX (HasCharacter|HasMatrix path). */
function decodePlaceMatrix(body: Uint8Array) {
  const flags = body[0];
  const hasCharacter = (flags & 0x02) !== 0;
  const depth = body[1] | (body[2] << 8);
  let cursor = 3;
  let charId: number | null = null;
  if (hasCharacter) {
    charId = body[cursor] | (body[cursor + 1] << 8);
    cursor += 2;
  }
  const r = makeBitReader(body, cursor);
  const hasScale = r.readUB(1) === 1;
  let scaleX = 1;
  let scaleY = 1;
  if (hasScale) {
    const nBits = r.readUB(5);
    scaleX = r.readSB(nBits) / 65536;
    scaleY = r.readSB(nBits) / 65536;
  }
  const hasRotate = r.readUB(1) === 1;
  if (hasRotate) {
    const nBits = r.readUB(5);
    r.readSB(nBits);
    r.readSB(nBits);
  }
  const tBits = r.readUB(5);
  const translateX = r.readSB(tBits);
  const translateY = r.readSB(tBits);
  return { charId, depth, hasScale, scaleX, scaleY, hasRotate, translateX, translateY };
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

const DEFAULT_SYMBOL_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
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

function makeFrame(displayObjects: ShapeDisplayObject[] | SymbolInstance[]): Frame {
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
    displayObjects: displayObjects as Frame["displayObjects"],
  };
}

function makeLayer(displayObjects: ShapeDisplayObject[] | SymbolInstance[]): Layer {
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

/**
 * Build a document with ONE movieclip symbol that contains the given warped
 * shape (symbol-internal), and an instance of that symbol on the scene at (0,0).
 */
function makeSymbolDoc(innerShape: ShapeDisplayObject): FlashDocument {
  const symbol: Symbol = {
    id: "sym-1",
    name: "Clip",
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: { layers: [makeLayer([innerShape])] },
    linkage: DEFAULT_SYMBOL_LINKAGE,
    scale9Grid: null,
  };
  const instance: SymbolInstance = {
    id: "inst-1",
    type: "instance",
    symbolId: "sym-1",
    x: 0,
    y: 0,
  };
  const scene: Scene = {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers: [makeLayer([instance])] },
  };
  return {
    id: "warp-sprite-doc",
    properties: { ...BASE_PROPS },
    scenes: [scene],
    library: { items: [symbol], folders: [] },
  };
}

/**
 * Compile and return the DefineShape4 bounds (the symbol-internal shape) plus
 * the sprite-internal PlaceObject2 matrix. The DefineShape4 is hoisted above the
 * DefineSprite (definition tags are illegal inside a sprite body), so it appears
 * at top level; the PlaceObject2 placing it lives INSIDE the DefineSprite.
 */
function decodeSymbolInternal(doc: FlashDocument) {
  const swf = compileDocument(doc, { compress: false });
  const tags = parseTags(swf);

  const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
  expect(shapeTags.length).toBe(1);
  const bounds = decodeShapeBounds(shapeTags[0].body);

  const spriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
  expect(spriteTags.length).toBe(1);
  const inner = decodeSpriteInnerTags(spriteTags[0].body);
  const innerPlace = inner.filter((t) => t.code === TAG_PLACE_OBJECT2);
  expect(innerPlace.length).toBe(1);
  const place = decodePlaceMatrix(innerPlace[0].body);

  return { bounds, place };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Free Transform warp baked into symbol-internal DefineShape4 (task 1232)", () => {
  // Symbol-internal shape placed at (50,50); local 100×100 square →
  // stage-space corners nw=(50,50) ne=(150,50) se=(150,150) sw=(50,150).
  const OBJ_X = 50;
  const OBJ_Y = 50;

  /** Identity-corner distort except SE dragged from (150,150) out to (300,250). */
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

  it("un-warped symbol-internal shape publishes its pristine bounds (no regression)", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: squareShape(),
      x: OBJ_X,
      y: OBJ_Y,
    };
    const { bounds } = decodeSymbolInternal(makeSymbolDoc(obj));
    // Legacy sprite convention bakes the (+x,+y) offset into the geometry and
    // emits a 0,0 residual placement: 50..150 px = 1000..3000 twips.
    expect(bounds.xMin).toBe(1000);
    expect(bounds.yMin).toBe(1000);
    expect(bounds.xMax).toBe(3000);
    expect(bounds.yMax).toBe(3000);
  });

  it("a Distort warp is baked into the symbol-internal DefineShape4 (NOT pristine)", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: squareShape(),
      x: OBJ_X,
      y: OBJ_Y,
      warp: distortWarp(),
    };
    const { bounds, place } = decodeSymbolInternal(makeSymbolDoc(obj));

    // Warp is baked origin-relative (absolute − placement): SE → (250,200) px →
    // (5000,4000) twips. The pristine (un-warped) square would have been the
    // 1000..3000 box from the test above — the warp is clearly present.
    expect(bounds.xMin).toBe(0);
    expect(bounds.yMin).toBe(0);
    expect(bounds.xMax).toBe(5000);
    expect(bounds.yMax).toBe(4000);

    // The baked warp is origin-relative, so the residual sprite-internal
    // PlaceObject2 carries (x,y) and NO affine scale/rotation.
    expect(place.hasScale).toBe(false);
    expect(place.hasRotate).toBe(false);
    expect(place.translateX).toBe(OBJ_X * 20);
    expect(place.translateY).toBe(OBJ_Y * 20);
  });

  it("warp + scaleX=2 on a symbol-internal shape does NOT double-transform", () => {
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
    const { bounds, place } = decodeSymbolInternal(makeSymbolDoc(obj));

    // Warp is the SOLE geometry transform; scale is not compounded into bounds
    // (would be 10000,8000) nor re-applied via PlaceObject2.
    expect(bounds.xMax).toBe(5000);
    expect(bounds.yMax).toBe(4000);
    expect(place.hasScale).toBe(false);
    expect(place.hasRotate).toBe(false);
    expect(place.translateX).toBe(OBJ_X * 20);
    expect(place.translateY).toBe(OBJ_Y * 20);
  });

  it("warp + rotation=30 on a symbol-internal shape does NOT double-transform", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: squareShape(),
      x: OBJ_X,
      y: OBJ_Y,
      rotation: 30,
      warp: distortWarp(),
    };
    const { bounds, place } = decodeSymbolInternal(makeSymbolDoc(obj));
    expect(bounds.xMax).toBe(5000);
    expect(bounds.yMax).toBe(4000);
    expect(place.hasRotate).toBe(false);
    expect(place.hasScale).toBe(false);
  });

  it("pure affine (scaleX=2, no warp) STILL applies scale in the sprite PlaceObject2", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: squareShape(),
      x: OBJ_X,
      y: OBJ_Y,
      scaleX: 2,
      scaleY: 2,
    };
    const { bounds, place } = decodeSymbolInternal(makeSymbolDoc(obj));

    // No warp: pristine geometry (offset baked: 1000..3000 twips) and the affine
    // is carried by the sprite-internal PlaceObject2 — unaffected by the fix.
    expect(bounds.xMin).toBe(1000);
    expect(bounds.xMax).toBe(3000);
    expect(place.hasScale).toBe(true);
    expect(place.scaleX).toBeCloseTo(2, 3);
    expect(place.scaleY).toBeCloseTo(2, 3);
  });

  it("an Envelope warp (bowed edge) is baked into the symbol-internal DefineShape4 too", () => {
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
        // Bottom edge bowed DOWN.
        b0: { x: 50 + 100 / 3, y: 230 },
        b1: { x: 50 + 200 / 3, y: 230 },
        l0: { x: 50, y: 50 + 100 / 3 },
        l1: { x: 50, y: 50 + 200 / 3 },
      },
    };
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
    const { bounds } = decodeSymbolInternal(makeSymbolDoc(obj));
    // The bowed bottom pushes yMax well past the pristine 2000-twip bottom.
    expect(bounds.yMax).toBeGreaterThan(2500);
  });
});
