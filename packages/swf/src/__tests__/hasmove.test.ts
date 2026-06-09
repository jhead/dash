/**
 * Tests for PlaceObject2 HasMove flag emission in motion-tween layers.
 *
 * SWF PlaceObject2 flags byte (first byte of tag body):
 *   bit 0  (0x01): PlaceFlagMove      — modify existing depth (re-placement)
 *   bit 1  (0x02): PlaceFlagHasCharacter — charId present in body
 *   bit 2  (0x04): PlaceFlagHasMatrix — MATRIX present
 *
 * For motion-tween layers:
 *   - First frame: PlaceObject2 with HasCharacter (0x02) set — new object on stage.
 *   - Subsequent tweened frames: PlaceObject2 with Move (0x01) set — update position.
 *
 * Tag codes:
 *   26  PlaceObject2
 *    1  ShowFrame
 *    0  End
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";
import type { ShapeDisplayObject } from "@flash/core";
import type { Shape } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser helpers (identical to those in moveflag.test.ts)
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

/** Parse all tag records from a compiled SWF binary. */
function parseTags(swf: Uint8Array): SwfTag[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
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
      offset: pos,
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

/**
 * Group tag indices by frame. Returns an array of arrays where each inner
 * array contains the indices (into `tags`) of the tags in frame N (0-indexed).
 */
function groupByFrame(tags: SwfTag[]): number[][] {
  const frames: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].code === Tag.ShowFrame) {
      frames.push(current);
      current = [];
    } else {
      current.push(i);
    }
  }
  return frames;
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

function makeShape(id = "shape-1"): Shape {
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
        fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
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
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene(layers)],
    library: { items: [], folders: [] },
  };
}

/**
 * Build a motion-tween layer with 5 frames (indices 0–4):
 *   - Frame 0: keyframe, tweenType="motion", shape at (0,  175)
 *   - Frames 1–3: non-keyframe, tweenType="motion" (tween-interpolated)
 *   - Frame 4: keyframe, tweenType="none",   shape at (400, 175)
 */
function makeMotionTweenLayer(objId = "tween-obj"): Layer {
  const startObj = makeShapeObj(objId, 0, 175);
  const endObj   = makeShapeObj(objId, 400, 175);

  const frames: Frame[] = [
    makeBaseFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      tweenType: "motion",
      displayObjects: [startObj],
    }),
    makeBaseFrame(1, { isKeyframe: false, isEmpty: false, tweenType: "motion" }),
    makeBaseFrame(2, { isKeyframe: false, isEmpty: false, tweenType: "motion" }),
    makeBaseFrame(3, { isKeyframe: false, isEmpty: false, tweenType: "motion" }),
    makeBaseFrame(4, {
      isKeyframe: true,
      isEmpty: false,
      tweenType: "none",
      displayObjects: [endObj],
    }),
  ];

  return makeLayer("motion-layer", frames, 5);
}

// ---------------------------------------------------------------------------
// PlaceObject2 flag constants
// ---------------------------------------------------------------------------

const FLAG_MOVE           = 0x01; // PlaceFlagMove
const FLAG_HAS_CHARACTER  = 0x02; // PlaceFlagHasCharacter
const FLAG_HAS_MATRIX     = 0x04; // PlaceFlagHasMatrix

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlaceObject2 HasMove flag — motion-tween layer", () => {

  /**
   * Test 1: A motion-tween layer with 5 frames produces multiple PlaceObject2 tags.
   */
  it("1. motion-tween layer with 5 frames produces multiple PlaceObject2 (tag 26) tags", () => {
    const doc = makeDoc([makeMotionTweenLayer()]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const po2Tags = tags.filter((t) => t.code === Tag.PlaceObject2);
    // Expect at least 2: one initial placement + at least one move/update
    expect(po2Tags.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * Test 2: The first PlaceObject2 (frame 0) has HasCharacter flag (0x02) set.
   * This is the initial placement of the object on the display list.
   */
  it("2. first PlaceObject2 has HasCharacter flag (0x02) set", () => {
    const doc = makeDoc([makeMotionTweenLayer()]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    // Frame 0 contains the initial PlaceObject2
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const frame0Tags = frames[0].map((i) => tags[i]);
    const places0 = frame0Tags.filter((t) => t.code === Tag.PlaceObject2);
    expect(places0.length).toBeGreaterThan(0);

    const flags0 = places0[0].body[0];
    // HasCharacter (0x02) must be set for the initial placement
    expect(flags0 & FLAG_HAS_CHARACTER).toBe(FLAG_HAS_CHARACTER);
    // Move (0x01) must NOT be set for a fresh placement
    expect(flags0 & FLAG_MOVE).toBe(0);
  });

  /**
   * Test 3: Subsequent motion-tween frames' PlaceObject2 tags have HasMove (0x01) set.
   * These are the per-frame position updates during the tween span.
   */
  it("3. subsequent motion-tween frames have HasMove (0x01) set in PlaceObject2 flags", () => {
    const doc = makeDoc([makeMotionTweenLayer()]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    // Check frames 1–3 (the interpolated tween frames)
    for (let fi = 1; fi <= 3; fi++) {
      const frameTags = (frames[fi] ?? []).map((i) => tags[i]);
      const places = frameTags.filter((t) => t.code === Tag.PlaceObject2);
      if (places.length > 0) {
        const flags = places[0].body[0];
        // Move flag must be set on tween update frames
        expect(flags & FLAG_MOVE).toBe(FLAG_MOVE);
        // HasCharacter should NOT be set (same object, only position changes)
        expect(flags & FLAG_HAS_CHARACTER).toBe(0);
        // HasMatrix should be set (position changed)
        expect(flags & FLAG_HAS_MATRIX).toBe(FLAG_HAS_MATRIX);
      }
    }
  });

  /**
   * Test 4: Motion-tween PlaceObject2 without character change has flags with
   * HasMove (0x01) set but NOT HasCharacter (0x02).
   *
   * This directly verifies the transform-only update semantics: when the same
   * object ID moves to a new position during a tween, the compiler emits
   * PlaceFlagMove | PlaceFlagHasMatrix (0x05), not a new character placement.
   */
  it("4. motion-tween re-placement without character change has Move set, HasCharacter clear", () => {
    const doc = makeDoc([makeMotionTweenLayer()]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    // Gather all PlaceObject2 tags beyond frame 0 that have the Move flag set
    const moveUpdates: SwfTag[] = [];
    for (let fi = 1; fi < frames.length; fi++) {
      const frameTags = (frames[fi] ?? []).map((i) => tags[i]);
      for (const t of frameTags) {
        if (t.code === Tag.PlaceObject2 && (t.body[0] & FLAG_MOVE) !== 0) {
          moveUpdates.push(t);
        }
      }
    }

    // There should be at least one Move-flagged PlaceObject2 for the tween
    expect(moveUpdates.length).toBeGreaterThan(0);

    for (const tag of moveUpdates) {
      const flags = tag.body[0];
      // Must have Move set
      expect(flags & FLAG_MOVE).toBe(FLAG_MOVE);
      // Must NOT have HasCharacter set (transform-only)
      expect(flags & FLAG_HAS_CHARACTER).toBe(0);
    }
  });

  /**
   * Test 5: A static layer (no tween) uses only HasCharacter for the initial
   * placement and emits no PlaceObject2 in subsequent identical frames.
   * The initial frame must have HasCharacter (0x02) set and Move (0x01) clear.
   */
  it("5. static layer (no tween) uses HasCharacter for initial placement, no Move flag", () => {
    const obj = makeShapeObj("static-obj", 100, 100);

    // Single keyframe — static, no tween
    const layer = makeLayer("static-layer", [
      makeBaseFrame(0, {
        isKeyframe: true,
        isEmpty: false,
        tweenType: "none",
        displayObjects: [obj],
      }),
      makeBaseFrame(1, {
        isKeyframe: false,
        isEmpty: false,
        tweenType: "none",
        displayObjects: [obj],
      }),
      makeBaseFrame(2, {
        isKeyframe: false,
        isEmpty: false,
        tweenType: "none",
        displayObjects: [obj],
      }),
    ], 3);

    const doc = makeDoc([layer]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    // Frame 0: fresh placement — HasCharacter set, Move clear
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const frame0Tags = frames[0].map((i) => tags[i]);
    const places0 = frame0Tags.filter((t) => t.code === Tag.PlaceObject2);
    expect(places0.length).toBeGreaterThan(0);

    const flags0 = places0[0].body[0];
    expect(flags0 & FLAG_HAS_CHARACTER).toBe(FLAG_HAS_CHARACTER);
    expect(flags0 & FLAG_MOVE).toBe(0);

    // Frames 1 and 2: static, object unchanged — no PlaceObject2 emitted
    for (let fi = 1; fi <= 2; fi++) {
      const frameTags = (frames[fi] ?? []).map((i) => tags[i]);
      const places = frameTags.filter((t) => t.code === Tag.PlaceObject2);
      expect(places.length).toBe(0);
    }
  });
});
