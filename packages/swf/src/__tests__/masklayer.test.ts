/**
 * Tests for mask layer SWF export — ClipDepth / HasClipDepth in PlaceObject2.
 *
 * In SWF, a clipping mask is expressed by placing the mask shape with a
 * PlaceObject2 tag that has the HasClipDepth flag (bit 6 = 0x40) set and a
 * ClipDepth field that specifies the highest depth of the masked layers.
 *
 * Flash layer stack convention (as used in compile.ts):
 *   layers[0]  = topmost layer in the timeline UI
 *   layers[N-1] = bottommost
 *
 * For SWF export the compiler assigns increasing depths to layers in order,
 * so lower-indexed layers get lower depth numbers.
 *
 * Test document structure:
 *   Layer 0 (type='masked')  — contains a coloured rectangle (the content to mask)
 *   Layer 1 (type='mask')    — contains a rectangle that acts as the clipping shape
 *
 * In the compiled SWF:
 *   - The mask shape (layer 1 / higher depth) must have HasClipDepth set.
 *   - ClipDepth must cover the depth(s) of the masked layer (layer 0 / lower depth).
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
} from "@flash/core";
import type { Shape, ShapeDisplayObject } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF parser helpers (minimal, adapted from integration.test.ts)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function parseSWFHeader(bytes: Uint8Array): number {
  // Returns offset of the first tag.
  // RECT starts at byte 8 — bit-packed
  let byteOff = 8;
  let bitsLeft = 0;
  let bitBuf = 0;

  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitsLeft === 0) {
        bitBuf = bytes[byteOff++]!;
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

  // Flush to byte boundary, then skip FrameRate (2) + FrameCount (2)
  byteOff = Math.ceil((8 * 8 + 5 + nBits * 4) / 8);
  return byteOff + 4; // tags start after FrameRate + FrameCount
}

function parseTags(bytes: Uint8Array, offset: number): SWFTag[] {
  const tags: SWFTag[] = [];
  let pos = offset;
  while (pos + 2 <= bytes.length) {
    const recordHdr = bytes[pos]! | (bytes[pos + 1]! << 8);
    const tagCode = (recordHdr >> 6) & 0x3ff;
    let bodyLength = recordHdr & 0x3f;
    let hdrSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        bytes[pos + 2]! |
        (bytes[pos + 3]! << 8) |
        (bytes[pos + 4]! << 16) |
        (bytes[pos + 5]! << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({
      code: tagCode,
      body: bytes.slice(bodyStart, bodyStart + bodyLength),
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break; // End tag
  }
  return tags;
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

function makeShape(id: string, fill = { r: 255, g: 0, b: 0, a: 255 }): Shape {
  return {
    id,
    paths: [
      {
        start: { x: 10, y: 10 },
        segments: [
          { type: "line", to: { x: 100, y: 10 } },
          { type: "line", to: { x: 100, y: 100 } },
          { type: "line", to: { x: 10, y: 100 } },
        ],
        closed: true,
        fill: { type: "solid", color: fill },
      },
    ],
  };
}

function makeShapeObj(objId: string, shapeId: string): ShapeDisplayObject {
  return {
    id: objId,
    type: "shape",
    shape: makeShape(shapeId),
    x: 10,
    y: 10,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

function makeKeyframe(displayObjects: ShapeDisplayObject[]): Frame {
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

function makeLayer(
  id: string,
  name: string,
  type: Layer["type"],
  frames: Frame[]
): Layer {
  return {
    id,
    name,
    type,
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

/**
 * Build a FlashDocument with two layers in Flash timeline order:
 *   layers[0] = mask layer   (top of UI — clipping shape)
 *   layers[1] = masked layer (below the mask — content that gets clipped)
 *
 * In Flash's timeline UI the mask layer sits ABOVE the masked layer.
 * layers[0] = index 0 = top of timeline = top of UI.
 *
 * In SWF the mask object must be placed at a lower depth than the masked
 * objects so that its ClipDepth can reference the depths above it:
 *   mask    → depth D,    clipDepth = D_masked_max
 *   masked  → depth D+1 … D_masked_max
 *
 * The compile.ts pre-pass forces the masked-layer depths to be assigned first
 * (so they are lower numbers), then the mask layer objects are assigned higher
 * depth numbers.  Wait — that would be backwards.
 *
 * Actually compile.ts iterates layers in order (li=0, li=1, …) and assigns
 * depths lazily: the first call to getOrAssignDepth wins.  The pre-pass
 * assigns masked depths before mask depths so that:
 *   layers[0] (mask)   → objects assigned AFTER the pre-pass → higher depth
 *   layers[1] (masked) → objects assigned BY the pre-pass   → lower depth
 *
 * SWF rule: mask at depth D clips depths D+1..clipDepth.
 * So mask must be at a LOWER depth than masked.  To achieve this with lazy
 * assignment we put masked at index 0 (gets assigned first = lower depth)
 * and mask at index 1 (gets assigned second = higher depth ... but then
 * clipDepth < depth, which violates SWF).
 *
 * The correct authoring order IS mask[0] / masked[1] and the pre-pass must
 * reserve depths for masked objects FIRST so they end up with higher depth
 * numbers while the mask layer objects, processed in li-order, get assigned
 * lower numbers.  Alternatively we put the masked layer at a lower index.
 *
 * For the purposes of this test we use the simplest order that makes the
 * compile logic work: mask at index 0, masked at index 1.  The pre-pass
 * calls getOrAssignDepth for the masked layer objects first, giving them
 * depth 1.  Then in the main loop the mask layer (li=0) objects get depth 2
 * but clipDepth=1 — which means depth > clipDepth, invalid.
 *
 * To avoid this we instead put masked at index 0 and mask at index 1, so
 * the pre-pass (triggered by li=1 being mask) assigns masked depths.  But
 * the pre-pass iterates li+1 onwards for masked layers — with mask at li=1
 * it would look at li=2 which is empty.  This is also wrong.
 *
 * The CORRECT convention (matching Flash authoring + SWF):
 *   layers[0] = mask  (rendered first = lower SWF depth)
 *   layers[1] = masked (rendered second = higher SWF depth)
 * and the pre-pass for li=0 (mask) assigns depths for li=1 (masked) first,
 * giving them depth 1.  Then in the main loop, li=0 (mask) objects get
 * depth 2 with clipDepth=1.  But mask depth (2) > clipDepth (1): INVALID.
 *
 * To fix this the pre-pass must ensure that mask objects get LOWER depth
 * numbers than their masked objects.  This means the pre-pass must NOT assign
 * masked depths before the mask depth; instead the mask itself gets assigned
 * first (depth 1) and masked get higher depths (depth 2..N), making clipDepth≥depth+1.
 *
 * The implementation in compile.ts was updated to use this order:
 *   1. In the main layer loop (li=0 → N), call getOrAssignDepth for ALL layers
 *      in natural order.  Mask layers (li=0 here) get lower depths.
 *   2. The pre-pass over mask layers records the MAXIMUM depth among masked
 *      layers, which will be >= mask depth + 1 because masked layers have higher li.
 *
 * So the correct layer order for this test is:
 *   layers[0] = type='mask'    (li=0 → lower depth numbers)
 *   layers[1] = type='masked'  (li=1 → higher depth numbers)
 */
function makeMaskDoc(): FlashDocument {
  const maskLayer = makeLayer(
    "layer-mask",
    "Layer 1 (mask)",
    "mask",
    [makeKeyframe([makeShapeObj("obj-mask", "shape-mask")])]
  );

  const maskedLayer = makeLayer(
    "layer-masked",
    "Layer 2 (masked)",
    "masked",
    [makeKeyframe([makeShapeObj("obj-masked", "shape-masked")])]
  );

  const scene: Scene = {
    id: "scene-1",
    name: "Scene 1",
    timeline: {
      // mask layer first (index 0 → lower SWF depth), masked second (index 1 → higher depth)
      layers: [maskLayer, maskedLayer],
    },
  };

  return {
    id: "doc-mask-test",
    properties: BASE_PROPS,
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const TAG_PLACE_OBJECT2 = 26;

describe("mask layer SWF export: HasClipDepth", () => {
  it("compiles a document with mask + masked layers without throwing", () => {
    const doc = makeMaskDoc();
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("produces a non-empty SWF byte array", () => {
    const doc = makeMaskDoc();
    const swf = compileDocument(doc);
    expect(swf.length).toBeGreaterThan(20);
  });

  it("produces at least two PlaceObject2 tags (one per layer)", () => {
    const doc = makeMaskDoc();
    const swf = compileDocument(doc);
    const tagsOffset = parseSWFHeader(swf);
    const tags = parseTags(swf, tagsOffset);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTags.length).toBeGreaterThanOrEqual(2);
  });

  it("exactly one PlaceObject2 tag has the HasClipDepth flag (0x40) set", () => {
    const doc = makeMaskDoc();
    const swf = compileDocument(doc);
    const tagsOffset = parseSWFHeader(swf);
    const tags = parseTags(swf, tagsOffset);

    // PlaceObject2 body[0] is the flags byte.
    // HasClipDepth = bit 6 = 0x40
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    const clipDepthTags = placeTags.filter((t) => (t.body[0]! & 0x40) !== 0);

    expect(clipDepthTags.length).toBe(1);
  });

  it("the PlaceObject2 with HasClipDepth has a ClipDepth field > 0", () => {
    const doc = makeMaskDoc();
    const swf = compileDocument(doc);
    const tagsOffset = parseSWFHeader(swf);
    const tags = parseTags(swf, tagsOffset);

    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    const maskTag = placeTags.find((t) => (t.body[0]! & 0x40) !== 0);
    expect(maskTag).toBeDefined();

    if (maskTag) {
      // PlaceObject2 body layout when HasCharacter + HasMatrix + HasClipDepth:
      //   [0]   flags byte (0x46)
      //   [1-2] depth UI16LE
      //   [3-4] charId UI16LE
      //   [5..] MATRIX (variable length, bit-packed)
      //   After MATRIX (byte-aligned): ClipDepth UI16LE
      //
      // We can't trivially parse the variable-length MATRIX here, but we can
      // verify the body is long enough and that ClipDepth > 0 somewhere after
      // the fixed prefix.  The minimum body length is: 1 (flags) + 2 (depth) +
      // 2 (charId) + at least 3 bytes (minimal MATRIX) + 2 (ClipDepth) = 10.
      expect(maskTag.body.length).toBeGreaterThanOrEqual(10);

      // Read the last two bytes of the body as ClipDepth UI16LE.
      // Our minimal translation-only MATRIX is small and deterministic so
      // ClipDepth will be at the tail.
      const len = maskTag.body.length;
      const clipDepthValue = maskTag.body[len - 2]! | (maskTag.body[len - 1]! << 8);
      expect(clipDepthValue).toBeGreaterThan(0);
    }
  });

  it("the masked layer's PlaceObject2 does NOT have HasClipDepth set", () => {
    const doc = makeMaskDoc();
    const swf = compileDocument(doc);
    const tagsOffset = parseSWFHeader(swf);
    const tags = parseTags(swf, tagsOffset);

    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    // There must be at least one PlaceObject2 without HasClipDepth
    const nonMaskTags = placeTags.filter((t) => (t.body[0]! & 0x40) === 0);
    expect(nonMaskTags.length).toBeGreaterThanOrEqual(1);
  });

  it("a document with only normal layers produces no HasClipDepth PlaceObject2", () => {
    const normalLayer = makeLayer(
      "layer-normal",
      "Layer 1",
      "normal",
      [makeKeyframe([makeShapeObj("obj-normal", "shape-normal")])]
    );
    const doc: FlashDocument = {
      id: "doc-normal",
      properties: BASE_PROPS,
      scenes: [
        {
          id: "scene-1",
          name: "Scene 1",
          timeline: { layers: [normalLayer] },
        },
      ],
      library: { items: [], folders: [] },
    };
    const swf = compileDocument(doc);
    const tagsOffset = parseSWFHeader(swf);
    const tags = parseTags(swf, tagsOffset);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    const clipDepthTags = placeTags.filter((t) => (t.body[0]! & 0x40) !== 0);
    expect(clipDepthTags.length).toBe(0);
  });
});
