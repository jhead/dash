/**
 * Tests for PlaceObject2 tween mid-frame encoding.
 *
 * Verifies that:
 *   1. A 3-frame motion tween produces exactly 3 ShowFrame (tag 1) tags.
 *   2. Frame 2 (index 1, the mid-frame) has a PlaceObject2 (tag 26) with
 *      the HasMove flag (0x01) set.
 *   3. The PlaceObject2 in a tween mid-frame includes a MATRIX encoding
 *      (HasMatrix flag 0x04) reflecting the interpolated position.
 *   4. A shape-tween mid-frame PlaceObject2 has the HasRatio flag (0x10) set.
 *
 * PlaceObject2 flags byte (first byte of tag body):
 *   bit 0  (0x01): PlaceFlagMove        — modify existing depth
 *   bit 1  (0x02): PlaceFlagHasCharacter — charId present
 *   bit 2  (0x04): PlaceFlagHasMatrix   — MATRIX present
 *   bit 4  (0x10): PlaceFlagHasRatio    — ratio (morph/shape tween) present
 *
 * Tag codes:
 *    1  ShowFrame
 *   26  PlaceObject2
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type { FlashDocument, Frame, Layer, Scene, Shape } from "@flash/core";
import type { ShapeDisplayObject } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag parser helpers
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

/** Parse all tag records from a compiled SWF binary. */
function findTags(swf: Uint8Array): SwfTag[] {
  const nbits = swf[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let i = 8 + rectBytes + 4;
  const tags: SwfTag[] = [];
  while (i < swf.length - 1) {
    const h = swf[i] | (swf[i + 1] << 8);
    i += 2;
    const code = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    if (len === 63) {
      len =
        swf[i] |
        (swf[i + 1] << 8) |
        (swf[i + 2] << 16) |
        (swf[i + 3] << 24);
      i += 4;
    }
    tags.push({ code, body: swf.slice(i, i + len) });
    if (code === 0) break;
    i += len;
  }
  return tags;
}

/**
 * Group tag indices by frame.  Returns an array of arrays where each inner
 * array contains the SwfTag objects emitted before the corresponding ShowFrame.
 */
function groupByFrame(tags: SwfTag[]): SwfTag[][] {
  const frames: SwfTag[][] = [];
  let current: SwfTag[] = [];
  for (const tag of tags) {
    if (tag.code === Tag.ShowFrame) {
      frames.push(current);
      current = [];
    } else {
      current.push(tag);
    }
  }
  return frames;
}

// ---------------------------------------------------------------------------
// PlaceObject2 flag constants
// ---------------------------------------------------------------------------

const FLAG_MOVE           = 0x01; // PlaceFlagMove
const FLAG_HAS_CHARACTER  = 0x02; // PlaceFlagHasCharacter
const FLAG_HAS_MATRIX     = 0x04; // PlaceFlagHasMatrix
const FLAG_HAS_RATIO      = 0x10; // PlaceFlagHasRatio

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

function makeShape(id: string): Shape {
  return {
    id,
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 50, y: 0 } },
          { type: "line", to: { x: 50, y: 50 } },
          { type: "line", to: { x: 0, y: 50 } },
        ],
        closed: true,
        fill: { type: "solid", color: { r: 200, g: 0, b: 0, a: 255 } },
      },
    ],
  };
}

function makeShapeObj(id: string, x: number, y: number): ShapeDisplayObject {
  return {
    id,
    type: "shape" as const,
    shape: makeShape(id),
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 1,
    visible: true,
    filters: [],
    blendMode: "normal" as const,
    cacheAsBitmap: false,
  };
}

function makeBaseFrame(index: number, overrides: Partial<Frame> = {}): Frame {
  return {
    index,
    isKeyframe: false,
    isEmpty: true,
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
    displayObjects: [],
    ...overrides,
  };
}

function makeLayer(id: string, frames: Frame[], frameCount?: number): Layer {
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
    frameCount: frameCount ?? frames.reduce((m, f) => Math.max(m, f.index + 1), 1),
  };
}

function makeScene(layers: Layer[]): Scene {
  return { id: "sc-1", name: "Scene 1", timeline: { layers } };
}

function makeDoc(layers: Layer[]): FlashDocument {
  return {
    id: "doc-tweenframes",
    properties: BASE_PROPS,
    scenes: [makeScene(layers)],
    library: { items: [], folders: [] },
  };
}

/**
 * Build a 3-frame motion-tween layer:
 *   Frame 0: keyframe, tweenType="motion", shape at x=0
 *   Frame 1: non-keyframe, tweenType="motion"  (mid-frame, x≈50 interpolated)
 *   Frame 2: keyframe, tweenType="none",  shape at x=100
 */
function makeMotionTweenLayer3(objId = "mt-obj"): Layer {
  const startObj = makeShapeObj(objId, 0, 100);
  const endObj   = makeShapeObj(objId, 100, 100);

  const frames: Frame[] = [
    makeBaseFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      tweenType: "motion",
      displayObjects: [startObj],
    }),
    makeBaseFrame(1, {
      isKeyframe: false,
      isEmpty: false,
      tweenType: "motion",
    }),
    makeBaseFrame(2, {
      isKeyframe: true,
      isEmpty: false,
      tweenType: "none",
      displayObjects: [endObj],
    }),
  ];

  return makeLayer("motion-layer", frames, 3);
}

/**
 * Build a 3-frame shape-tween layer using two distinct shapes.
 *   Frame 0: keyframe, tweenType="shape", shape-A
 *   Frame 1: non-keyframe, tweenType="shape"  (mid-frame)
 *   Frame 2: keyframe, tweenType="none",  shape-B
 */
function makeShapeTweenLayer3(): Layer {
  const startObj = makeShapeObj("shape-A", 50, 50);
  // End shape has different path geometry to trigger morph
  const endShapeId = "shape-B";
  const endShape: Shape = {
    id: endShapeId,
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 80, y: 0 } },
          { type: "line", to: { x: 80, y: 80 } },
          { type: "line", to: { x: 0, y: 80 } },
        ],
        closed: true,
        fill: { type: "solid", color: { r: 0, g: 100, b: 200, a: 255 } },
      },
    ],
  };
  const endObj: ShapeDisplayObject = {
    id: endShapeId,
    type: "shape",
    shape: endShape,
    x: 100,
    y: 100,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 1,
    visible: true,
    filters: [],
    blendMode: "normal",
    cacheAsBitmap: false,
  };

  const frames: Frame[] = [
    makeBaseFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      tweenType: "shape",
      displayObjects: [startObj],
    }),
    makeBaseFrame(1, {
      isKeyframe: false,
      isEmpty: false,
      tweenType: "shape",
    }),
    makeBaseFrame(2, {
      isKeyframe: true,
      isEmpty: false,
      tweenType: "none",
      displayObjects: [endObj],
    }),
  ];

  return makeLayer("shape-tween-layer", frames, 3);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF PlaceObject2 tween mid-frame encoding", () => {

  /**
   * Test 1: A document with a 3-frame motion tween produces 3 ShowFrame tags.
   */
  it("1. 3-frame motion tween produces 3 ShowFrame (tag 1) tags", () => {
    const doc = makeDoc([makeMotionTweenLayer3()]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);

    const showFrames = tags.filter((t) => t.code === Tag.ShowFrame);
    expect(showFrames).toHaveLength(3);
  });

  /**
   * Test 2: Frame 2 (index 1 — the mid-frame) has a PlaceObject2 with HasMove flag.
   * The tween mid-frame should update the display object's position via a Move.
   */
  it("2. frame 2 (index 1 mid-frame) has PlaceObject2 (tag 26) with HasMove flag (0x01)", () => {
    const doc = makeDoc([makeMotionTweenLayer3()]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const frames = groupByFrame(tags);

    // frames[1] is the second ShowFrame bucket (index 1)
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const midFrameTags = frames[1];
    const places = midFrameTags.filter((t) => t.code === Tag.PlaceObject2);

    expect(places.length).toBeGreaterThan(0);

    // At least one PlaceObject2 in the mid-frame must have HasMove (0x01) set
    const hasMoveTags = places.filter((t) => (t.body[0] & FLAG_MOVE) !== 0);
    expect(hasMoveTags.length).toBeGreaterThan(0);
  });

  /**
   * Test 3: PlaceObject2 in the tween mid-frame has MATRIX encoding
   * (HasMatrix flag 0x04) reflecting the interpolated position.
   */
  it("3. PlaceObject2 in tween mid-frame has MATRIX encoding (HasMatrix flag 0x04)", () => {
    const doc = makeDoc([makeMotionTweenLayer3()]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(2);
    const midFrameTags = frames[1];
    const places = midFrameTags.filter((t) => t.code === Tag.PlaceObject2);

    expect(places.length).toBeGreaterThan(0);

    // At least one PlaceObject2 must have HasMatrix (0x04) set
    const hasMatrixTags = places.filter((t) => (t.body[0] & FLAG_HAS_MATRIX) !== 0);
    expect(hasMatrixTags.length).toBeGreaterThan(0);
  });

  /**
   * Test 4: Shape-tween mid-frame PlaceObject2 has HasRatio flag (0x10) set.
   * Shape tweens use DefineMorphShape + PlaceObject2WithRatio for interpolation.
   */
  it("4. shape-tween mid-frame has PlaceObject2 with HasRatio flag (0x10)", () => {
    const doc = makeDoc([makeShapeTweenLayer3()]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);

    // Find any PlaceObject2 with HasRatio flag set (from any frame in the tween)
    const ratioTags = tags.filter(
      (t) => t.code === Tag.PlaceObject2 && (t.body[0] & FLAG_HAS_RATIO) !== 0
    );
    expect(ratioTags.length).toBeGreaterThan(0);
  });

  /**
   * Bonus: mid-frame motion tween PlaceObject2 does NOT have HasCharacter set —
   * it is a transform-only update for the same object already on stage.
   */
  it("5. motion-tween mid-frame PlaceObject2 with HasMove does not have HasCharacter (0x02)", () => {
    const doc = makeDoc([makeMotionTweenLayer3()]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(2);
    const midFrameTags = frames[1];
    const moveTags = midFrameTags.filter(
      (t) => t.code === Tag.PlaceObject2 && (t.body[0] & FLAG_MOVE) !== 0
    );

    expect(moveTags.length).toBeGreaterThan(0);

    for (const tag of moveTags) {
      expect(tag.body[0] & FLAG_HAS_CHARACTER).toBe(0);
    }
  });
});
