/**
 * Tests for DefineMorphShape (tag 46) encoding and shape tween compilation.
 *
 * Tests:
 * 1. encodeDefineMorphShape returns Uint8Array
 * 2. First two bytes are CharacterId (UI16 LE)
 * 3. Tag code in wrapper is 46
 * 4. Start bounds RECT is present and decodable
 * 5. End bounds RECT is present and decodable
 * 6. Compiled shape-tween document has tag 46 (not just tag 32/83)
 * 7. Shape tween document has ShowFrame count matching keyframe span
 * 8. PlaceObject2 records for shape tween frames have ratio field set (non-zero for mid-span frames)
 */

import { describe, it, expect } from "vitest";
import { encodeDefineMorphShape, encodePlaceObject2WithRatio } from "../morphshape.js";
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
const TAG_SHOW_FRAME = 1;
const TAG_DEFINE_MORPH_SHAPE = 46;
const TAG_PLACE_OBJECT2 = 26;
const TAG_DEFINE_SHAPE4 = 83;

// ---------------------------------------------------------------------------
// SWF binary parser helpers (shared with integration.test.ts)
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
  // Skip: signature(3) + version(1) + fileLength(4) = 8 bytes
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

  // FrameRate (UI16LE) + FrameCount (UI16LE)
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

/**
 * Wrap a tag body in a SWF record header (short or long).
 * Short form used when body.length < 63.
 */
function wrapTag(tagCode: number, body: Uint8Array): Uint8Array {
  const isLong = body.length >= 63;
  if (isLong) {
    const hdr = new Uint8Array(6);
    const shortField = (tagCode << 6) | 0x3f;
    hdr[0] = shortField & 0xff;
    hdr[1] = (shortField >> 8) & 0xff;
    hdr[2] = body.length & 0xff;
    hdr[3] = (body.length >> 8) & 0xff;
    hdr[4] = (body.length >> 16) & 0xff;
    hdr[5] = (body.length >> 24) & 0xff;
    const out = new Uint8Array(6 + body.length);
    out.set(hdr);
    out.set(body, 6);
    return out;
  } else {
    const shortField = (tagCode << 6) | body.length;
    const hdr = new Uint8Array(2);
    hdr[0] = shortField & 0xff;
    hdr[1] = (shortField >> 8) & 0xff;
    const out = new Uint8Array(2 + body.length);
    out.set(hdr);
    out.set(body, 2);
    return out;
  }
}

/**
 * Read a bit-packed RECT from bytes starting at byteOffset.
 * Returns {xMin, xMax, yMin, yMax} in twips and the number of bytes consumed.
 */
function readRect(
  bytes: Uint8Array,
  byteOffset: number
): { xMin: number; xMax: number; yMin: number; yMax: number; bytesConsumed: number } {
  let byteOff = byteOffset;
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

  function toSigned(raw: number, bits: number): number {
    const signBit = 1 << (bits - 1);
    return raw & signBit ? raw - (signBit << 1) : raw;
  }

  const nBits = readBits(5);
  const xMinRaw = readBits(nBits);
  const xMaxRaw = readBits(nBits);
  const yMinRaw = readBits(nBits);
  const yMaxRaw = readBits(nBits);

  return {
    xMin: toSigned(xMinRaw, nBits),
    xMax: toSigned(xMaxRaw, nBits),
    yMin: toSigned(yMinRaw, nBits),
    yMax: toSigned(yMaxRaw, nBits),
    bytesConsumed: byteOff - byteOffset,
  };
}

// ---------------------------------------------------------------------------
// Shape path helpers
// ---------------------------------------------------------------------------

/** A simple 50×50 rectangle starting at (x, y). */
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

// ---------------------------------------------------------------------------
// Document builder helpers
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
 *
 * The layer has:
 *   - Frame 0 (keyframe, tweenType='shape'): 50×50 rect at (50, 50)
 *   - Frames 1..3 (non-keyframes): span frames
 *   - Frame 4 (keyframe, tweenType='none'): 100×100 rect at (200, 200)
 *
 * Total = 5 frames.
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

  // Non-keyframe span frames
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
    id: "shape-tween-doc",
    properties: BASE_PROPS,
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Test 1: encodeDefineMorphShape returns Uint8Array
// ---------------------------------------------------------------------------

describe("encodeDefineMorphShape", () => {
  const startPaths = [makeRectPath(0, 0, 50, 50, { r: 255, g: 0, b: 0, a: 255 })];
  const endPaths = [makeRectPath(0, 0, 100, 100, { r: 0, g: 0, b: 255, a: 255 })];

  it("returns a Uint8Array", () => {
    const result = encodeDefineMorphShape(1, startPaths, endPaths);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(10);
  });

  // ---------------------------------------------------------------------------
  // Test 2: First two bytes are CharacterId (UI16 LE)
  // ---------------------------------------------------------------------------

  it("encodes charId as UI16LE in first two bytes", () => {
    const body = encodeDefineMorphShape(42, startPaths, endPaths);
    const charId = body[0] | (body[1] << 8);
    expect(charId).toBe(42);
  });

  it("charId=1 encodes correctly", () => {
    const body = encodeDefineMorphShape(1, startPaths, endPaths);
    const charId = body[0] | (body[1] << 8);
    expect(charId).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Tag code in wrapper is 46
  // ---------------------------------------------------------------------------

  it("produces tag code 46 when wrapped in a SWF record header", () => {
    const body = encodeDefineMorphShape(1, startPaths, endPaths);
    const tagged = wrapTag(TAG_DEFINE_MORPH_SHAPE, body);
    const recordHdr = tagged[0] | (tagged[1] << 8);
    const tagCode = (recordHdr >> 6) & 0x3ff;
    expect(tagCode).toBe(46);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Start bounds RECT is present and decodable
  // ---------------------------------------------------------------------------

  it("start bounds RECT is decodable (after charId bytes)", () => {
    const body = encodeDefineMorphShape(1, startPaths, endPaths);
    // StartBounds begins at byte 2 (after charId UI16LE)
    const rect = readRect(body, 2);
    // rect should be non-trivial (non-zero dimensions)
    expect(rect.xMax).toBeGreaterThan(rect.xMin);
    expect(rect.yMax).toBeGreaterThan(rect.yMin);
    // 50×50 rect in twips: xMin=0, xMax=1000, yMin=0, yMax=1000
    expect(rect.xMax - rect.xMin).toBe(50 * 20); // 1000 twips
    expect(rect.yMax - rect.yMin).toBe(50 * 20);
  });

  // ---------------------------------------------------------------------------
  // Test 5: End bounds RECT is present and decodable
  // ---------------------------------------------------------------------------

  it("end bounds RECT is decodable (after start bounds)", () => {
    const body = encodeDefineMorphShape(1, startPaths, endPaths);
    // StartBounds at offset 2
    const startRect = readRect(body, 2);
    const endRectOffset = 2 + startRect.bytesConsumed;
    const endRect = readRect(body, endRectOffset);
    // End shape is 100×100 rect: dimensions should be 2000×2000 twips
    expect(endRect.xMax - endRect.xMin).toBe(100 * 20);
    expect(endRect.yMax - endRect.yMin).toBe(100 * 20);
  });

  // ---------------------------------------------------------------------------
  // Test for empty paths (edge case)
  // ---------------------------------------------------------------------------

  it("handles empty path lists without crashing", () => {
    const body = encodeDefineMorphShape(1, [], []);
    expect(body).toBeInstanceOf(Uint8Array);
    // charId should still be correct
    const charId = body[0] | (body[1] << 8);
    expect(charId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests 6–8: Compiled shape tween document structure
// ---------------------------------------------------------------------------

describe("Shape tween compilation", () => {
  // ---------------------------------------------------------------------------
  // Test 6: Compiled shape-tween document has tag 46 (not just tag 32/83)
  // ---------------------------------------------------------------------------

  it("emits DefineMorphShape2 (tag 84) for a shape tween layer", () => {
    const doc = makeShapeTweenDoc();
    const swf = compileDocument(doc);
    const { tags } = parseSWF(swf);

    // Compiler now emits tag 84 (DefineMorphShape2) for Flash 8 targets so that
    // LINESTYLE2 cap/join data is preserved via MORPHLINESTYLE2 records.
    const TAG_DEFINE_MORPH_SHAPE2 = 84;
    const morphTags = tags.filter(
      (t) => t.code === TAG_DEFINE_MORPH_SHAPE || t.code === TAG_DEFINE_MORPH_SHAPE2
    );
    expect(morphTags.length).toBeGreaterThanOrEqual(1);
  });

  it("does not emit separate DefineShape4 (tag 83) for shape tween objects", () => {
    const doc = makeShapeTweenDoc();
    const swf = compileDocument(doc);
    const { tags } = parseSWF(swf);

    // The start and end shapes of the shape tween should NOT be emitted as
    // separate DefineShape4 tags (they are encoded together in DefineMorphShape).
    // There should be zero or fewer DefineShape4 tags than would be expected
    // for a baked approach (which would emit one per frame).
    const shape4Tags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    // In a 5-frame shape tween, baked approach would emit 5 tags;
    // morph approach emits 0 (all encoded in tag 46).
    expect(shape4Tags.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 7: Shape tween document has ShowFrame count matching keyframe span
  // ---------------------------------------------------------------------------

  it("emits the correct number of ShowFrame tags for a 5-frame shape tween", () => {
    const doc = makeShapeTweenDoc();
    const swf = compileDocument(doc);
    const { tags } = parseSWF(swf);

    const showFrameTags = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    // 5 frames in the shape tween doc (frames 0–4)
    expect(showFrameTags.length).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // Test 8: PlaceObject2 records for shape tween frames have ratio field set
  // ---------------------------------------------------------------------------

  it("PlaceObject2 for shape tween frames includes HasRatio flag (bit 4)", () => {
    const doc = makeShapeTweenDoc();
    const swf = compileDocument(doc);
    const { tags } = parseSWF(swf);

    // Find PlaceObject2 tags that have HasRatio flag set (flags byte bit 4 = 0x10)
    const ratioPlaceTags = tags.filter((t) => {
      if (t.code !== TAG_PLACE_OBJECT2) return false;
      const flags = t.body[0];
      return (flags & 0x10) !== 0; // HasRatio bit
    });

    expect(ratioPlaceTags.length).toBeGreaterThan(0);
  });

  it("mid-span frames have non-zero ratio in PlaceObject2", () => {
    const doc = makeShapeTweenDoc();
    const swf = compileDocument(doc);
    const { tags } = parseSWF(swf);

    // Collect all PlaceObject2 tags with HasRatio flag
    const ratioPlaceTags = tags.filter((t) => {
      if (t.code !== TAG_PLACE_OBJECT2) return false;
      const flags = t.body[0];
      return (flags & 0x10) !== 0;
    });

    // Parse ratio values from the PlaceObject2 bodies
    // PlaceObject2 layout with HasCharacter|HasMatrix|HasRatio (0x16):
    //   [0] flags (1 byte)
    //   [1..2] depth UI16LE (2 bytes)
    //   [3..4] charId UI16LE (2 bytes)
    //   [5..] MATRIX (variable bit-packed)
    //   after MATRIX: ratio UI16LE
    //
    // We look for ratio values > 0 among non-first-frame placements.
    // (First frame has ratio=0, subsequent frames have increasing ratios.)
    const ratioValues: number[] = [];
    for (const tag of ratioPlaceTags) {
      const flags = tag.body[0];
      const hasCharacter = (flags & 0x02) !== 0;
      const hasMatrix = (flags & 0x04) !== 0;

      if (!hasCharacter || !hasMatrix) continue;

      // Skip past: flags(1) + depth(2) + charId(2) = 5 bytes
      let off = 5;
      if (off >= tag.body.length) continue;

      // Parse MATRIX (bit-packed): hasScale bit, optional scale, hasRotate bit, optional rotate, translate
      let byteOff = off;
      let bitBuf = 0;
      let bitsLeft = 0;

      function readBits(n: number): number {
        let result = 0;
        for (let i = 0; i < n; i++) {
          if (bitsLeft === 0) {
            if (byteOff >= tag.body.length) return 0;
            bitBuf = tag.body[byteOff++];
            bitsLeft = 8;
          }
          result = (result << 1) | ((bitBuf >> (bitsLeft - 1)) & 1);
          bitsLeft--;
        }
        return result;
      }

      const hasScale = readBits(1);
      if (hasScale) {
        const nBits = readBits(5);
        readBits(nBits); // scaleX
        readBits(nBits); // scaleY
      }
      const hasRotate = readBits(1);
      if (hasRotate) {
        const nBits = readBits(5);
        readBits(nBits); // rotateSkew0
        readBits(nBits); // rotateSkew1
      }
      const nTransBits = readBits(5);
      readBits(nTransBits); // tx
      readBits(nTransBits); // ty

      // Flush to byte boundary to reach ratio field
      bitsLeft = 0;
      // byteOff is now at the ratio field
      if (byteOff + 1 < tag.body.length) {
        const ratio = tag.body[byteOff] | (tag.body[byteOff + 1] << 8);
        ratioValues.push(ratio);
      }
    }

    // At least one non-zero ratio should be present (mid-span frames)
    const nonZeroRatios = ratioValues.filter((r) => r > 0);
    expect(nonZeroRatios.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests for encodePlaceObject2WithRatio
// ---------------------------------------------------------------------------

describe("encodePlaceObject2WithRatio", () => {
  it("returns a Uint8Array", () => {
    const result = encodePlaceObject2WithRatio(1, 1, 0, 0, 32767);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("has HasRatio flag (0x10) set in flags byte for first placement", () => {
    const body = encodePlaceObject2WithRatio(1, 1, 0, 0, 32767, false);
    expect(body[0] & 0x10).toBe(0x10);
  });

  it("has HasCharacter flag (0x02) set in first placement", () => {
    const body = encodePlaceObject2WithRatio(1, 1, 0, 0, 0, false);
    expect(body[0] & 0x02).toBe(0x02);
  });

  it("depth is encoded as UI16LE at bytes [1..2]", () => {
    const body = encodePlaceObject2WithRatio(5, 3, 0, 0, 0, false);
    const depth = body[1] | (body[2] << 8);
    expect(depth).toBe(3);
  });

  it("charId is encoded as UI16LE at bytes [3..4]", () => {
    const body = encodePlaceObject2WithRatio(42, 1, 0, 0, 0, false);
    const charId = body[3] | (body[4] << 8);
    expect(charId).toBe(42);
  });
});
