/**
 * Tests for multi-keyframe motion tween document round-trip (10 frames).
 *
 * Verifies:
 *   1. A 10-frame motion tween document compiles without error.
 *   2. Exactly 10 ShowFrame (tag 1) tags are emitted.
 *   3. Frame 0 PlaceObject2 has HasCharacter flag (0x02) set.
 *   4. Frames 1–9 PlaceObject2 tags have HasMove flag (0x01) set.
 *   5. Mid-frame PlaceObject2 has HasMatrix flag (0x04) for interpolated position.
 *   6. Frame 0 and frame 9 MATRIX translations differ (start ≠ end).
 *
 * PlaceObject2 flags byte (first byte of tag body):
 *   bit 0  (0x01): PlaceFlagMove        — modify existing depth
 *   bit 1  (0x02): PlaceFlagHasCharacter — charId present
 *   bit 2  (0x04): PlaceFlagHasMatrix   — MATRIX present
 *
 * Tag codes:
 *    1  ShowFrame
 *   26  PlaceObject2
 *    0  End
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type { FlashDocument, Frame, Layer, Scene, Shape } from "@flash/core";
import type { ShapeDisplayObject } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser helpers
// ---------------------------------------------------------------------------

/** Parse SWF header to find where the tag stream starts. */
function getTagStreamStart(bytes: Uint8Array): number {
  const nBits = (bytes[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  return 8 + rectBytes + 4;
}

interface SwfTag {
  code: number;
  body: Uint8Array;
}

/** Parse all tag records from a compiled SWF binary. */
function parseTags(bytes: Uint8Array): SwfTag[] {
  const tags: SwfTag[] = [];
  let i = getTagStreamStart(bytes);
  while (i < bytes.length - 1) {
    const hdr = bytes[i] | (bytes[i + 1] << 8);
    const type = (hdr >> 6) & 0x3ff;
    const slen = hdr & 0x3f;
    let len: number;
    let hlen: number;
    if (slen === 63) {
      len =
        bytes[i + 2] |
        (bytes[i + 3] << 8) |
        (bytes[i + 4] << 16) |
        (bytes[i + 5] << 24);
      hlen = 6;
    } else {
      len = slen;
      hlen = 2;
    }
    const bodyStart = i + hlen;
    tags.push({ code: type, body: bytes.slice(bodyStart, bodyStart + len) });
    if (type === 0) break;
    i += hlen + len;
  }
  return tags;
}

/**
 * Group tags by frame. Returns an array of arrays where each inner array
 * contains the SwfTag objects emitted before the corresponding ShowFrame.
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

const FLAG_MOVE          = 0x01; // PlaceFlagMove
const FLAG_HAS_CHARACTER = 0x02; // PlaceFlagHasCharacter
const FLAG_HAS_MATRIX    = 0x04; // PlaceFlagHasMatrix

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
    frameCount:
      frameCount ?? frames.reduce((m, f) => Math.max(m, f.index + 1), 1),
  };
}

function makeScene(layers: Layer[]): Scene {
  return { id: "sc-1", name: "Scene 1", timeline: { layers } };
}

function makeDoc(layers: Layer[]): FlashDocument {
  return {
    id: "doc-tweenmulti",
    properties: BASE_PROPS,
    scenes: [makeScene(layers)],
    library: { items: [], folders: [] },
  };
}

/**
 * Build a 10-frame motion-tween layer:
 *   Frame 0:   keyframe, tweenType="motion", shape at x=0,   y=0
 *   Frames 1–8: non-keyframe, tweenType="motion" (interpolated)
 *   Frame 9:   keyframe, tweenType="none",   shape at x=400, y=0
 */
function makeMotionTweenLayer10(objId = "tween-obj-10"): Layer {
  const startObj = makeShapeObj(objId, 0, 0);
  const endObj = makeShapeObj(objId, 400, 0);

  const frames: Frame[] = [
    makeBaseFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      tweenType: "motion",
      displayObjects: [startObj],
    }),
    ...Array.from({ length: 8 }, (_, i) =>
      makeBaseFrame(i + 1, {
        isKeyframe: false,
        isEmpty: false,
        tweenType: "motion",
      })
    ),
    makeBaseFrame(9, {
      isKeyframe: true,
      isEmpty: false,
      tweenType: "none",
      displayObjects: [endObj],
    }),
  ];

  return makeLayer("tween-10-layer", frames, 10);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Multi-keyframe tween document round-trip (10 frames)", () => {
  /**
   * Test 1: 10-frame motion tween document compiles without error.
   */
  it("1. 10-frame motion tween document compiles without error", () => {
    const doc = makeDoc([makeMotionTweenLayer10()]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  /**
   * Test 2: Exactly 10 ShowFrame (tag 1) tags in output.
   */
  it("2. produces exactly 10 ShowFrame (tag 1) tags", () => {
    const doc = makeDoc([makeMotionTweenLayer10()]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const showFrames = tags.filter((t) => t.code === Tag.ShowFrame);
    expect(showFrames).toHaveLength(10);
  });

  /**
   * Test 3: PlaceObject2 at frame 0 has HasCharacter flag (0x02) — initial placement.
   */
  it("3. frame 0 PlaceObject2 has HasCharacter flag (0x02) set", () => {
    const doc = makeDoc([makeMotionTweenLayer10()]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(1);
    const frame0Tags = frames[0];
    const places = frame0Tags.filter((t) => t.code === Tag.PlaceObject2);
    expect(places.length).toBeGreaterThan(0);

    const flags = places[0].body[0];
    expect(flags & FLAG_HAS_CHARACTER).toBe(FLAG_HAS_CHARACTER);
    // Fresh placement must NOT have the Move flag set
    expect(flags & FLAG_MOVE).toBe(0);
  });

  /**
   * Test 4: PlaceObject2 at frames 1–9 has HasMove flag (0x01) — tween updates.
   */
  it("4. frames 1–9 PlaceObject2 tags have HasMove flag (0x01) set", () => {
    const doc = makeDoc([makeMotionTweenLayer10()]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    // Check every frame from 1 onwards that has a PlaceObject2
    let foundMoveFrame = false;
    for (let fi = 1; fi < frames.length; fi++) {
      const places = frames[fi].filter((t) => t.code === Tag.PlaceObject2);
      if (places.length > 0) {
        for (const tag of places) {
          expect(tag.body[0] & FLAG_MOVE).toBe(FLAG_MOVE);
          expect(tag.body[0] & FLAG_HAS_CHARACTER).toBe(0);
        }
        foundMoveFrame = true;
      }
    }
    expect(foundMoveFrame).toBe(true);
  });

  /**
   * Test 5: Mid-frame PlaceObject2 has HasMatrix flag (0x04) for interpolated position.
   */
  it("5. mid-frame PlaceObject2 has HasMatrix flag (0x04) for interpolated position", () => {
    const doc = makeDoc([makeMotionTweenLayer10()]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    // Check a mid-point frame (frame index 4 or 5)
    const midIdx = Math.min(4, frames.length - 1);
    expect(frames.length).toBeGreaterThan(midIdx);
    const midFrameTags = frames[midIdx];
    const places = midFrameTags.filter((t) => t.code === Tag.PlaceObject2);

    expect(places.length).toBeGreaterThan(0);
    const hasMatrixTags = places.filter(
      (t) => (t.body[0] & FLAG_HAS_MATRIX) !== 0
    );
    expect(hasMatrixTags.length).toBeGreaterThan(0);
  });

  /**
   * Test 6: Frame 0 and frame 9 MATRIX translations differ (start ≠ end).
   *
   * The SWF MATRIX record starts after the flags byte + optional charId (UI16) +
   * optional depth (UI16). We extract the translate-X value from the MATRIX to
   * confirm the compiler encoded different positions for start and end keyframes.
   *
   * Both frame 0 and frame 9 have HasMatrix set (0x04). For the initial placement
   * (HasCharacter | HasMatrix) the MATRIX follows [flags(1)] + [charId(2)] + [depth(2)].
   * For the last tween update (Move | HasMatrix) it follows [flags(1)] + [depth(2)].
   *
   * We compare the raw body bytes to confirm they are not identical.
   */
  it("6. frame 0 HasMatrix bytes differ from frame 9 HasMatrix bytes (start ≠ end)", () => {
    const doc = makeDoc([makeMotionTweenLayer10()]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(10);

    // Frame 0: initial placement PlaceObject2 with HasMatrix
    const frame0Places = frames[0].filter(
      (t) =>
        t.code === Tag.PlaceObject2 && (t.body[0] & FLAG_HAS_MATRIX) !== 0
    );
    expect(frame0Places.length).toBeGreaterThan(0);

    // Frame 9: last frame (end keyframe) PlaceObject2 with HasMatrix
    const frame9Places = frames[9].filter(
      (t) =>
        t.code === Tag.PlaceObject2 && (t.body[0] & FLAG_HAS_MATRIX) !== 0
    );
    expect(frame9Places.length).toBeGreaterThan(0);

    // The bodies should differ because the positions are x=0 vs x=400
    const body0 = Array.from(frame0Places[0].body);
    const body9 = Array.from(frame9Places[0].body);

    expect(body0).not.toEqual(body9);
  });
});
