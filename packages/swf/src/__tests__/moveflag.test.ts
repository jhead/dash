/**
 * Tests for PlaceObject2 Move flag (bit 0) emission.
 *
 * SWF PlaceObject2 flags byte (first byte of body):
 *   bit 0: Move         — 1 = modify existing depth, 0 = place new character
 *   bit 1: HasCharacter — 1 = charId present in body
 *   bit 2: HasMatrix    — 1 = MATRIX present
 *
 * When Move=1 and HasCharacter=0: modify existing object at depth (transform only).
 * When Move=1 and HasCharacter=1: replace object at depth with a new character.
 * When Move=0 and HasCharacter=1: place a new object (depth must be empty).
 *
 * Tag codes:
 *   26  PlaceObject2
 *    1  ShowFrame
 *   83  DefineShape4
 *   43  FrameLabel
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";
import type { Shape } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF parser helpers
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

/**
 * Parse all tag records from a compiled SWF binary.
 * Stops at the End tag (code 0) or end of file.
 */
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
    if (tagCode === 0 /* End */) break;
  }
  return tags;
}

/**
 * Group tag indices by frame. Returns an array of arrays where each inner
 * array contains the indices (into `tags`) of the tags that belong to
 * frame N (0-indexed).
 */
function groupByFrame(tags: SwfTag[]): number[][] {
  const frames: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].code === 1 /* ShowFrame */) {
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

/** Build a minimal shape. */
function makeShape(id = "shape-1"): Shape {
  return {
    id,
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 10, y: 0 } },
          { type: "line", to: { x: 10, y: 10 } },
          { type: "line", to: { x: 0, y: 10 } },
        ],
        closed: true,
        fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
      },
    ],
  };
}

/** Build a shape display object at (x, y). */
function makeShapeObjAt(id: string, x: number, y: number) {
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

/** Build a blank keyframe. */
function makeBlankFrame(index: number): Frame {
  return {
    index,
    isKeyframe: true,
    isEmpty: true,
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
    displayObjects: [],
  };
}

/** Build a keyframe with a single shape display object at (x, y). */
function makeShapeFrameAt(index: number, objId: string, x: number, y: number): Frame {
  return {
    index,
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
    displayObjects: [makeShapeObjAt(objId, x, y)],
  };
}

/** Build a layer with the provided frames. */
function makeLayerWithFrames(id: string, frames: Frame[], frameCount: number): Layer {
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
    frameCount,
  };
}

/** Build a minimal scene with the given layers. */
function makeScene(id: string, name: string, layers: Layer[]): Scene {
  return {
    id,
    name,
    timeline: { layers },
  };
}

/** Build a minimal FlashDocument with the given scenes. */
function makeDoc(scenes: Scene[]): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlaceObject2 Move flag (bit 0)", () => {
  /**
   * Test 1: Same charId at same depth, position changes frame 1→2.
   * Frame 2 PlaceObject2 should have Move flag (bit 0) set and HasCharacter (bit 1) clear.
   * Expected flags byte: 0x05 = Move | HasMatrix
   */
  it("sets Move flag (bit 0) when same charId moves to a different position", () => {
    // Layer: frame 0 shape at (0,0), frame 1 same shape id at (100,0)
    const layer = makeLayerWithFrames(
      "l1",
      [
        makeShapeFrameAt(0, "obj-a", 0, 0),
        makeShapeFrameAt(1, "obj-a", 100, 0),
      ],
      2
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(2);

    // Frame 0: should have a PlaceObject2 WITHOUT Move flag (fresh placement)
    const frame0Tags = frames[0].map((i) => tags[i]);
    const places0 = frame0Tags.filter((t) => t.code === Tag.PlaceObject2);
    expect(places0.length).toBeGreaterThan(0);
    const flags0 = places0[places0.length - 1].body[0];
    // Move flag (bit 0) should NOT be set for initial placement
    expect(flags0 & 0x01).toBe(0);
    // HasCharacter (bit 1) should be set for initial placement
    expect(flags0 & 0x02).toBe(0x02);

    // Frame 1: should have a PlaceObject2 WITH Move flag (position changed, same charId)
    const frame1Tags = frames[1].map((i) => tags[i]);
    const places1 = frame1Tags.filter((t) => t.code === Tag.PlaceObject2);
    expect(places1.length).toBeGreaterThan(0);
    const flags1 = places1[places1.length - 1].body[0];
    // Move flag (bit 0) SHOULD be set
    expect(flags1 & 0x01).toBe(0x01);
    // HasCharacter (bit 1) should NOT be set (same charId, transform-only update)
    expect(flags1 & 0x02).toBe(0);
    // HasMatrix (bit 2) should be set
    expect(flags1 & 0x04).toBe(0x04);
  });

  /**
   * Test 2: Object at frame 0, removed (blank) at frame 1, re-added same objId at frame 2.
   * Frame 2 PlaceObject2 should NOT have Move flag (fresh placement after removal).
   */
  it("does NOT set Move flag when same object reappears after being removed", () => {
    // Layer: shape at frame 0, blank at frame 1, same shape at frame 2
    const layer = makeLayerWithFrames(
      "l1",
      [
        makeShapeFrameAt(0, "obj-a", 0, 0),
        makeBlankFrame(1),
        makeShapeFrameAt(2, "obj-a", 50, 50),
      ],
      3
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(3);

    // Frame 2: should have a PlaceObject2 WITHOUT Move flag (fresh placement)
    const frame2Tags = frames[2].map((i) => tags[i]);
    const places2 = frame2Tags.filter((t) => t.code === Tag.PlaceObject2);
    expect(places2.length).toBeGreaterThan(0);
    const flags2 = places2[places2.length - 1].body[0];
    // Move flag (bit 0) should NOT be set — this is a fresh placement
    expect(flags2 & 0x01).toBe(0);
    // HasCharacter (bit 1) SHOULD be set — fresh placement includes charId
    expect(flags2 & 0x02).toBe(0x02);
  });

  /**
   * Test 3: Different objId at same layer (and therefore different depth assignment).
   * When obj-b replaces obj-a in the same layer, obj-a gets RemoveObject2 and
   * obj-b gets a fresh PlaceObject2 (no Move flag) — because each unique object ID
   * is assigned its own stable depth in the compiler.
   */
  it("emits fresh PlaceObject2 (no Move flag) and RemoveObject2 when a different objId replaces at same layer", () => {
    // Layer: obj-a at frame 0, obj-b (different id) at frame 1
    const layer = makeLayerWithFrames(
      "l1",
      [
        makeShapeFrameAt(0, "obj-a", 0, 0),
        makeShapeFrameAt(1, "obj-b", 50, 0),
      ],
      2
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(2);

    // Frame 1: should have a RemoveObject2 for obj-a and a fresh PlaceObject2 for obj-b
    const frame1Tags = frames[1].map((i) => tags[i]);
    const places1 = frame1Tags.filter((t) => t.code === Tag.PlaceObject2);
    const removes1 = frame1Tags.filter((t) => t.code === Tag.RemoveObject2);

    // obj-a was removed
    expect(removes1.length).toBeGreaterThan(0);

    // obj-b placed fresh — no Move flag
    expect(places1.length).toBeGreaterThan(0);
    const flags1 = places1[places1.length - 1].body[0];
    // Move flag (bit 0) should NOT be set (fresh placement)
    expect(flags1 & 0x01).toBe(0);
    // HasCharacter (bit 1) SHOULD be set (fresh placement includes charId)
    expect(flags1 & 0x02).toBe(0x02);
  });

  /**
   * Test 4: Object does not move between frames — no PlaceObject2 emitted in frame 2.
   */
  it("emits no PlaceObject2 when position is unchanged between frames", () => {
    // Layer: shape at (10,20) on frame 0, same shape at same position on frame 1
    const layer = makeLayerWithFrames(
      "l1",
      [
        makeShapeFrameAt(0, "obj-a", 10, 20),
        makeShapeFrameAt(1, "obj-a", 10, 20),
      ],
      2
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(2);

    // Frame 1 should have NO PlaceObject2 (nothing changed)
    const frame1Tags = frames[1].map((i) => tags[i]);
    const places1 = frame1Tags.filter((t) => t.code === Tag.PlaceObject2);
    expect(places1.length).toBe(0);
  });

  /**
   * Test 5: Verify the exact flags byte value for a Move-only (transform-only) update.
   * Expected: 0x05 = Move (0x01) | HasMatrix (0x04).
   */
  it("emits flags byte 0x05 (Move | HasMatrix) for transform-only update", () => {
    const layer = makeLayerWithFrames(
      "l1",
      [
        makeShapeFrameAt(0, "obj-a", 0, 0),
        makeShapeFrameAt(1, "obj-a", 200, 100),
      ],
      2
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    const frame1Tags = frames[1].map((i) => tags[i]);
    const places1 = frame1Tags.filter((t) => t.code === Tag.PlaceObject2);
    expect(places1.length).toBeGreaterThan(0);
    const flags1 = places1[places1.length - 1].body[0];
    // Exact flags byte: Move=1, HasCharacter=0, HasMatrix=1 → 0x05
    expect(flags1).toBe(0x05);
  });

  /**
   * Test 6: Fresh placement flags byte should be 0x06 (HasCharacter | HasMatrix).
   */
  it("emits flags byte 0x06 (HasCharacter | HasMatrix) for fresh placement", () => {
    const layer = makeLayerWithFrames(
      "l1",
      [makeShapeFrameAt(0, "obj-a", 0, 0)],
      1
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    const frame0Tags = frames[0].map((i) => tags[i]);
    const places0 = frame0Tags.filter((t) => t.code === Tag.PlaceObject2);
    expect(places0.length).toBeGreaterThan(0);
    const flags0 = places0[places0.length - 1].body[0];
    // Fresh placement: HasCharacter=1, HasMatrix=1, Move=0 → 0x06
    expect(flags0).toBe(0x06);
  });
});
