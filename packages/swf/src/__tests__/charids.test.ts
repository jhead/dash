/**
 * SWF character ID management tests.
 *
 * Verifies that each symbol and shape definition in the SWF gets a unique,
 * positive (>= 1) character ID, and that multiple symbols in the library all
 * receive distinct character IDs.
 *
 * Tag codes used:
 *   39  DefineSprite
 *    1  DefineShape
 *   83  DefineShape4
 */

import { describe, it, expect } from "vitest";
import { exportSWF } from "../export.js";
import type { FlashDocument, Symbol, Frame, Layer, Scene } from "@flash/core";
import type { ShapeDisplayObject, Shape } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag parser (as specified in the task description)
// ---------------------------------------------------------------------------

function findTags(bytes: Uint8Array) {
  const nbits = bytes[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let i = 8 + rectBytes + 4;
  const tags: Array<{ type: number; offset: number; body: Uint8Array }> = [];
  while (i < bytes.length - 1) {
    const h = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
    const type = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    const offset = i;
    if (len === 63) {
      len =
        bytes[i] |
        (bytes[i + 1] << 8) |
        (bytes[i + 2] << 16) |
        (bytes[i + 3] << 24);
      i += 4;
    }
    tags.push({ type, offset, body: bytes.slice(i, i + len) });
    if (type === 0) break;
    i += len;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_DEFINE_SPRITE = 39;
const TAG_DEFINE_SHAPE = 1;
const TAG_DEFINE_SHAPE4 = 83;

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

const DEFAULT_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

function makeFrame(index: number, overrides?: Partial<Frame>): Frame {
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

function makeLayer(name: string, frames?: Frame[]): Layer {
  return {
    id: `layer-${name}`,
    name,
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#0000ff",
    height: 20,
    parentFolderId: null,
    frames: frames ?? [makeFrame(0)],
    frameCount: frames?.length ?? 1,
  };
}

function makeScene(id: string, name: string, layers: Layer[]): Scene {
  return { id, name, timeline: { layers } };
}

function makeSymbol(id: string, name: string, layers?: Layer[]): Symbol {
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: {
      layers: layers ?? [makeLayer("Layer 1")],
    },
    linkage: DEFAULT_LINKAGE,
    scale9Grid: null,
  };
}

/** Build a simple rectangle ShapeDisplayObject. */
function makeShape(id: string, x: number, y: number): ShapeDisplayObject {
  const shape: Shape = {
    id: `inner-${id}`,
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 50, y: 0 } },
          { type: "line", to: { x: 50, y: 50 } },
          { type: "line", to: { x: 0, y: 50 } },
        ],
        fill: { type: "solid", color: { r: 200, g: 100, b: 50, a: 255 } },
        closed: true,
      },
    ],
  };
  return { id, type: "shape", shape, x, y };
}

function makeDoc(
  symbols: Symbol[],
  sceneShapes?: ShapeDisplayObject[]
): FlashDocument {
  const sceneLayer = makeLayer(
    "BG",
    sceneShapes && sceneShapes.length > 0
      ? [makeFrame(0, { isEmpty: false, displayObjects: sceneShapes })]
      : [makeFrame(0)]
  );

  return {
    id: "doc-test",
    properties: BASE_PROPS,
    scenes: [makeScene("sc-1", "Scene 1", [sceneLayer])],
    library: { items: symbols, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Helper: collect character IDs from DefineSprite and DefineShape* tags
// ---------------------------------------------------------------------------

/**
 * Extract the first two bytes of each tag body as a uint16 LE character ID.
 * Applicable to: DefineSprite (39), DefineShape (1), DefineShape4 (83).
 */
function collectCharIds(
  bytes: Uint8Array,
  tagTypes: number[]
): number[] {
  const tags = findTags(bytes);
  const ids: number[] = [];
  for (const tag of tags) {
    if (tagTypes.includes(tag.type) && tag.body.length >= 2) {
      const charId = tag.body[0] | (tag.body[1] << 8);
      ids.push(charId);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF character ID management", () => {
  // -------------------------------------------------------------------------
  // 1. Two distinct symbols each get unique DefineSprite character IDs
  // -------------------------------------------------------------------------
  it("1. two symbols → two DefineSprite tags with distinct character IDs", () => {
    const sym1 = makeSymbol("sym-a", "ClipA");
    const sym2 = makeSymbol("sym-b", "ClipB");
    const doc = makeDoc([sym1, sym2]);
    const bytes = exportSWF(doc);

    const tags = findTags(bytes);
    const spriteTags = tags.filter((t) => t.type === TAG_DEFINE_SPRITE);
    expect(spriteTags.length).toBe(2);

    const id1 = spriteTags[0].body[0] | (spriteTags[0].body[1] << 8);
    const id2 = spriteTags[1].body[0] | (spriteTags[1].body[1] << 8);
    expect(id1).not.toBe(id2);
  });

  // -------------------------------------------------------------------------
  // 2. A shape and a sprite don't share the same character ID
  // -------------------------------------------------------------------------
  it("2. shape on stage and a sprite in library do not share the same character ID", () => {
    const shapeObj = makeShape("shape-on-stage", 0, 0);
    const sym = makeSymbol("sym-1", "MyClip");
    const doc = makeDoc([sym], [shapeObj]);
    const bytes = exportSWF(doc);

    const spriteIds = collectCharIds(bytes, [TAG_DEFINE_SPRITE]);
    const shapeIds = collectCharIds(bytes, [TAG_DEFINE_SHAPE, TAG_DEFINE_SHAPE4]);

    expect(spriteIds.length).toBeGreaterThanOrEqual(1);
    expect(shapeIds.length).toBeGreaterThanOrEqual(1);

    // Verify no overlap between sprite IDs and shape IDs
    for (const spriteId of spriteIds) {
      for (const shapeId of shapeIds) {
        expect(spriteId).not.toBe(shapeId);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 3. Three symbols → three DefineSprite tags with all distinct IDs
  // -------------------------------------------------------------------------
  it("3. three symbols in library → all three DefineSprite tags have distinct character IDs", () => {
    const sym1 = makeSymbol("sym-1", "ClipA");
    const sym2 = makeSymbol("sym-2", "ClipB");
    const sym3 = makeSymbol("sym-3", "ClipC");
    const doc = makeDoc([sym1, sym2, sym3]);
    const bytes = exportSWF(doc);

    const tags = findTags(bytes);
    const spriteTags = tags.filter((t) => t.type === TAG_DEFINE_SPRITE);
    expect(spriteTags.length).toBe(3);

    const ids = spriteTags.map(
      (t) => t.body[0] | (t.body[1] << 8)
    );
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 4. All character IDs are >= 1 (0 is reserved in SWF)
  // -------------------------------------------------------------------------
  it("4. all DefineSprite and DefineShape character IDs are >= 1 (0 is reserved)", () => {
    const shapeObj = makeShape("shape-1", 10, 20);
    const sym1 = makeSymbol("sym-1", "ClipA");
    const sym2 = makeSymbol("sym-2", "ClipB");
    const doc = makeDoc([sym1, sym2], [shapeObj]);
    const bytes = exportSWF(doc);

    const allIds = collectCharIds(bytes, [
      TAG_DEFINE_SPRITE,
      TAG_DEFINE_SHAPE,
      TAG_DEFINE_SHAPE4,
    ]);
    expect(allIds.length).toBeGreaterThanOrEqual(1);
    for (const id of allIds) {
      expect(id).toBeGreaterThanOrEqual(1);
    }
  });
});
