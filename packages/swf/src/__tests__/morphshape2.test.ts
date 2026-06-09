/**
 * Tests for DefineMorphShape2 (tag 84) support in shape tween compilation.
 *
 * Tests:
 * 1. Shape-tween SWF compiles without error
 * 2. Either tag 46 (DefineMorphShape) OR tag 84 (DefineMorphShape2) appears
 * 3. If tag 84 is used: body starts with character ID UI16 >= 1
 * 4. Motion tween (tweenType='motion') does NOT produce tag 46 or tag 84
 * 5. No-tween layer does NOT produce tag 46 or tag 84
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  ShapeDisplayObject,
} from "@flash/core";
import type { Shape, ShapePath } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag code constants
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_DEFINE_MORPH_SHAPE = 46;
const TAG_DEFINE_MORPH_SHAPE2 = 84;

// ---------------------------------------------------------------------------
// SWF binary parser helpers
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

interface SWFHeader {
  tagsOffset: number;
  frameCount: number;
}

function parseSWFHeader(bytes: Uint8Array): SWFHeader {
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
  readBits(nBits); // xMin
  readBits(nBits); // xMax
  readBits(nBits); // yMin
  readBits(nBits); // yMax
  bitsLeft = 0; // flush

  const frameCount = bytes[byteOff + 2] | (bytes[byteOff + 3] << 8);
  const tagsOffset = byteOff + 4;

  return { tagsOffset, frameCount };
}

function parseTags(bytes: Uint8Array, offset: number): SWFTag[] {
  const tags: SWFTag[] = [];
  let pos = offset;
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
      offset: pos,
    });
    pos = bodyStart + bodyLength;
    if (tagCode === TAG_END) break;
  }
  return tags;
}

function parseSWF(bytes: Uint8Array): { header: SWFHeader; tags: SWFTag[] } {
  const header = parseSWFHeader(bytes);
  const tags = parseTags(bytes, header.tagsOffset);
  return { header, tags };
}

// ---------------------------------------------------------------------------
// Shape path and document builder helpers
// ---------------------------------------------------------------------------

function makeRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number; a: number }
): ShapePath {
  return {
    start: { x, y },
    segments: [
      { type: "line", to: { x: x + w, y } },
      { type: "line", to: { x: x + w, y: y + h } },
      { type: "line", to: { x, y: y + h } },
    ],
    closed: true,
    fill: { type: "solid", color },
  };
}

function makeRectShape(id: string, x: number, y: number, w: number, h: number): Shape {
  return {
    id: `shape-${id}`,
    paths: [makeRectPath(x, y, w, h, { r: 255, g: 0, b: 0, a: 255 })],
  };
}

function makeShapeDisplayObject(
  id: string,
  shape: Shape,
  x = 0,
  y = 0
): ShapeDisplayObject {
  return {
    id,
    type: "shape",
    shape,
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

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

function makeBaseFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    index: 0,
    isKeyframe: true,
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

function makeLayer(name: string, frames: Frame[]): Layer {
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
    frames,
    frameCount: frames.length,
  };
}

function makeScene(id: string, name: string, layers: Layer[]): Scene {
  return {
    id,
    name,
    timeline: { layers },
  };
}

/**
 * Build a minimal FlashDocument with a single shape tween layer.
 * Frame 0: keyframe tweenType='shape' with a 50×50 rect
 * Frames 1–3: non-keyframe span frames
 * Frame 4: end keyframe tweenType='none' with a 100×100 rect
 */
function makeShapeTweenDoc(): FlashDocument {
  const startShape = makeRectShape("start", 50, 50, 50, 50);
  const endShape = makeRectShape("end", 200, 200, 100, 100);

  const startObj = makeShapeDisplayObject("shape-obj", startShape, 50, 50);
  const endObj = makeShapeDisplayObject("shape-obj", endShape, 200, 200);

  const startFrame: Frame = makeBaseFrame({
    index: 0,
    isKeyframe: true,
    isEmpty: false,
    tweenType: "shape",
    displayObjects: [startObj],
  });

  const spanFrames: Frame[] = [1, 2, 3].map((i) =>
    makeBaseFrame({
      index: i,
      isKeyframe: false,
      isEmpty: false,
      tweenType: "shape",
    })
  );

  const endFrame: Frame = makeBaseFrame({
    index: 4,
    isKeyframe: true,
    isEmpty: false,
    tweenType: "none",
    displayObjects: [endObj],
  });

  const layer = makeLayer("Layer 1", [startFrame, ...spanFrames, endFrame]);
  const scene = makeScene("scene-1", "Scene 1", [layer]);

  return {
    id: "morphshape2-test-doc",
    properties: BASE_PROPS,
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}

/**
 * Build a FlashDocument with a motion tween layer (tweenType='motion').
 */
function makeMotionTweenDoc(): FlashDocument {
  const shape = makeRectShape("motion", 50, 50, 50, 50);
  const startObj = makeShapeDisplayObject("motion-obj", shape, 50, 50);
  const endObj = makeShapeDisplayObject("motion-obj", shape, 200, 200);

  const startFrame: Frame = makeBaseFrame({
    index: 0,
    isKeyframe: true,
    isEmpty: false,
    tweenType: "motion",
    displayObjects: [startObj],
  });

  const spanFrames: Frame[] = [1, 2, 3].map((i) =>
    makeBaseFrame({
      index: i,
      isKeyframe: false,
      isEmpty: false,
      tweenType: "motion",
    })
  );

  const endFrame: Frame = makeBaseFrame({
    index: 4,
    isKeyframe: true,
    isEmpty: false,
    tweenType: "none",
    displayObjects: [endObj],
  });

  const layer = makeLayer("Layer 1", [startFrame, ...spanFrames, endFrame]);
  const scene = makeScene("scene-1", "Scene 1", [layer]);

  return {
    id: "motion-tween-doc",
    properties: BASE_PROPS,
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}

/**
 * Build a FlashDocument with a single static (no-tween) layer.
 */
function makeNoTweenDoc(): FlashDocument {
  const shape = makeRectShape("static", 50, 50, 50, 50);
  const obj = makeShapeDisplayObject("static-obj", shape, 50, 50);

  const frame: Frame = makeBaseFrame({
    index: 0,
    isKeyframe: true,
    isEmpty: false,
    tweenType: "none",
    displayObjects: [obj],
  });

  const layer = makeLayer("Layer 1", [frame]);
  const scene = makeScene("scene-1", "Scene 1", [layer]);

  return {
    id: "no-tween-doc",
    properties: BASE_PROPS,
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineMorphShape2 (tag 84) — shape tween compilation", () => {
  // ---------------------------------------------------------------------------
  // Test 1: Shape-tween SWF compiles without error
  // ---------------------------------------------------------------------------

  it("compiles a shape-tween document without throwing", () => {
    const doc = makeShapeTweenDoc();
    expect(() => compileDocument(doc)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Test 2: Either tag 46 or tag 84 appears in the SWF
  // ---------------------------------------------------------------------------

  it("emits at least one DefineMorphShape (tag 46) or DefineMorphShape2 (tag 84)", () => {
    const doc = makeShapeTweenDoc();
    const swf = compileDocument(doc);
    const { tags } = parseSWF(swf);

    const morphTags = tags.filter(
      (t) => t.code === TAG_DEFINE_MORPH_SHAPE || t.code === TAG_DEFINE_MORPH_SHAPE2
    );
    expect(morphTags.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Test 3: If tag 84 is used, body starts with character ID UI16 >= 1
  // ---------------------------------------------------------------------------

  it("if tag 84 (DefineMorphShape2) is emitted, body starts with charId UI16 >= 1", () => {
    const doc = makeShapeTweenDoc();
    const swf = compileDocument(doc);
    const { tags } = parseSWF(swf);

    const morph2Tags = tags.filter((t) => t.code === TAG_DEFINE_MORPH_SHAPE2);
    for (const tag of morph2Tags) {
      // First two bytes are charId as UI16LE
      expect(tag.body.length).toBeGreaterThanOrEqual(2);
      const charId = tag.body[0] | (tag.body[1] << 8);
      expect(charId).toBeGreaterThanOrEqual(1);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 4: Motion tween does NOT produce tag 46 or tag 84
  // ---------------------------------------------------------------------------

  it("motion tween (tweenType='motion') does NOT produce tag 46 or tag 84", () => {
    const doc = makeMotionTweenDoc();
    const swf = compileDocument(doc);
    const { tags } = parseSWF(swf);

    const morphTags = tags.filter(
      (t) => t.code === TAG_DEFINE_MORPH_SHAPE || t.code === TAG_DEFINE_MORPH_SHAPE2
    );
    expect(morphTags.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 5: No-tween layer does NOT produce tag 46 or tag 84
  // ---------------------------------------------------------------------------

  it("no-tween layer does NOT produce tag 46 or tag 84", () => {
    const doc = makeNoTweenDoc();
    const swf = compileDocument(doc);
    const { tags } = parseSWF(swf);

    const morphTags = tags.filter(
      (t) => t.code === TAG_DEFINE_MORPH_SHAPE || t.code === TAG_DEFINE_MORPH_SHAPE2
    );
    expect(morphTags.length).toBe(0);
  });
});
