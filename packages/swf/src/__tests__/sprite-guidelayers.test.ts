/**
 * Task 1125: guide and folder layers in symbol timelines must be invisible.
 *
 * Verifies that encodeDefineSprite correctly skips 'guide' and 'folder' layer
 * types — mirroring the compile.ts guard pattern. A shape on a guide layer
 * inside a MovieClip symbol must NOT produce a PlaceObject2 tag inside the
 * DefineSprite body.
 *
 * SWF tag codes:
 *   0   End
 *   1   ShowFrame
 *  26   PlaceObject2
 *  39   DefineSprite
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
  Symbol,
} from "@flash/core";

// ---------------------------------------------------------------------------
// SWF parser helpers
// ---------------------------------------------------------------------------

interface SWFTag { code: number; body: Uint8Array; }

function findTagsOffset(bytes: Uint8Array): number {
  const nBits = (bytes[8] >> 3) & 0x1f;
  return 8 + Math.ceil((5 + 4 * nBits) / 8) + 4;
}

function parseTags(bytes: Uint8Array): SWFTag[] {
  const tags: SWFTag[] = [];
  let pos = findTagsOffset(bytes);
  while (pos + 2 <= bytes.length) {
    const hdr = bytes[pos] | (bytes[pos + 1] << 8);
    const code = (hdr >> 6) & 0x3ff;
    let len = hdr & 0x3f;
    let hdrSize = 2;
    if (len === 0x3f) {
      len = bytes[pos + 2] | (bytes[pos + 3] << 8) | (bytes[pos + 4] << 16) | (bytes[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({ code, body: bytes.slice(bodyStart, bodyStart + len) });
    pos = bodyStart + len;
    if (code === 0) break;
  }
  return tags;
}

function parseSpriteInnerTags(body: Uint8Array): SWFTag[] {
  const tags: SWFTag[] = [];
  let pos = 4;
  while (pos + 2 <= body.length) {
    const hdr = body[pos] | (body[pos + 1] << 8);
    const code = (hdr >> 6) & 0x3ff;
    let len = hdr & 0x3f;
    let hdrSize = 2;
    if (len === 0x3f) {
      len = body[pos + 2] | (body[pos + 3] << 8) | (body[pos + 4] << 16) | (body[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({ code, body: body.slice(bodyStart, bodyStart + len) });
    pos = bodyStart + len;
    if (code === 0) break;
  }
  return tags;
}

const TAG_PLACE_OBJECT2 = 26;
const TAG_DEFINE_SPRITE = 39;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550, height: 400, frameRate: 12, backgroundColor: "#ffffff",
  rulerUnits: "px" as const,
  grid: { showGrid: false, snapToGrid: false, gridColor: "#999999", gridWidth: 18, gridHeight: 18 },
  guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
};

const DEFAULT_LINKAGE = {
  exportForActionScript: false, exportInFirstFrame: false,
  linkageIdentifier: "", className: "",
  exportForRuntimeSharing: false, importForRuntimeSharing: false, sharedUrl: "",
};

function makeShape(): Shape {
  return {
    id: "s1",
    paths: [{
      start: { x: 0, y: 0 },
      segments: [
        { type: "line", to: { x: 50, y: 0 } },
        { type: "line", to: { x: 50, y: 50 } },
        { type: "line", to: { x: 0, y: 50 } },
      ],
      closed: true,
      fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
    }],
  };
}

function makeShapeObj(): ShapeDisplayObject {
  return { id: "obj-1", type: "shape", shape: makeShape(), x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
}

function makeFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    index: 0, isKeyframe: true, isEmpty: false, tweenType: "none",
    label: "", labelType: "name", script: "", sound: null,
    motionEase: 0, motionEaseType: "none", motionRotate: "none",
    motionRotateCount: 0, motionOrientToPath: false, motionSync: false,
    motionSnap: false, motionScale: false, shapeEase: 0,
    shapeEaseType: "none", shapeBlend: "distributive", displayObjects: [],
    ...overrides,
  };
}

function makeLayer(name: string, type: Layer["type"], frames: Partial<Frame>[] = [{}]): Layer {
  const full = frames.map((f, i) => makeFrame({ index: i, ...f }));
  return {
    id: `layer-${name}`, name, type, visible: true, locked: false,
    outlineMode: false, outlineColor: "#ff0000", height: 20,
    parentFolderId: null, frames: full, frameCount: full.length,
  };
}

function makeSymbolWithLayerTypes(
  id: string,
  layers: Layer[]
): Symbol {
  return {
    id, name: id, itemType: "symbol", symbolType: "movieclip",
    timeline: { layers }, linkage: DEFAULT_LINKAGE, scale9Grid: null,
  };
}

function makeDoc(sym: Symbol): FlashDocument {
  const rootLayer: Layer = makeLayer("Root", "normal", [{ isEmpty: true }]);
  const rootScene: Scene = { id: "s1", name: "Scene 1", timeline: { layers: [rootLayer] } };
  return {
    id: "doc-1", properties: BASE_PROPS,
    scenes: [rootScene],
    library: { items: [sym], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sprite.ts: guide and folder layers skipped (task 1125)", () => {

  it("1. normal layer — shape is placed via PlaceObject2 inside sprite", () => {
    const sym = makeSymbolWithLayerTypes("sym-1", [
      makeLayer("Normal", "normal", [{ isEmpty: false, displayObjects: [makeShapeObj()] }]),
    ]);
    const bytes = compileDocument(makeDoc(sym));
    const tags = parseTags(bytes);
    const sprite = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(sprite).toBeDefined();
    const inner = parseSpriteInnerTags(sprite!.body);
    expect(inner.some((t) => t.code === TAG_PLACE_OBJECT2)).toBe(true);
  });

  it("2. guide layer — shape is NOT placed via PlaceObject2 inside sprite", () => {
    const sym = makeSymbolWithLayerTypes("sym-1", [
      makeLayer("Guide", "guide", [{ isEmpty: false, displayObjects: [makeShapeObj()] }]),
    ]);
    const bytes = compileDocument(makeDoc(sym));
    const tags = parseTags(bytes);
    const sprite = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(sprite).toBeDefined();
    const inner = parseSpriteInnerTags(sprite!.body);
    // Guide layer content must NOT appear as PlaceObject2 in the sprite body
    expect(inner.some((t) => t.code === TAG_PLACE_OBJECT2)).toBe(false);
  });

  it("3. folder layer — shape is NOT placed via PlaceObject2 inside sprite", () => {
    const sym = makeSymbolWithLayerTypes("sym-1", [
      makeLayer("Folder", "folder", [{ isEmpty: false, displayObjects: [makeShapeObj()] }]),
    ]);
    const bytes = compileDocument(makeDoc(sym));
    const tags = parseTags(bytes);
    const sprite = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(sprite).toBeDefined();
    const inner = parseSpriteInnerTags(sprite!.body);
    expect(inner.some((t) => t.code === TAG_PLACE_OBJECT2)).toBe(false);
  });

  it("4. guided layer — shape IS placed (guided = real animated content)", () => {
    const sym = makeSymbolWithLayerTypes("sym-1", [
      makeLayer("Guided", "guided", [{ isEmpty: false, displayObjects: [makeShapeObj()] }]),
    ]);
    const bytes = compileDocument(makeDoc(sym));
    const tags = parseTags(bytes);
    const sprite = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(sprite).toBeDefined();
    const inner = parseSpriteInnerTags(sprite!.body);
    expect(inner.some((t) => t.code === TAG_PLACE_OBJECT2)).toBe(true);
  });

  it("5. mixed guide + normal layers — only normal layer content is placed", () => {
    const sym = makeSymbolWithLayerTypes("sym-1", [
      makeLayer("Normal", "normal", [{ isEmpty: false, displayObjects: [makeShapeObj()] }]),
      makeLayer("Guide", "guide", [{ isEmpty: false, displayObjects: [makeShapeObj()] }]),
    ]);
    const bytes = compileDocument(makeDoc(sym));
    const tags = parseTags(bytes);
    const sprite = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(sprite).toBeDefined();
    const inner = parseSpriteInnerTags(sprite!.body);
    // Exactly one PlaceObject2 (from the normal layer only)
    expect(inner.filter((t) => t.code === TAG_PLACE_OBJECT2).length).toBe(1);
  });

  it("6. SWF compiles without error for all layer types", () => {
    const layerTypes: Layer["type"][] = ["normal", "guide", "folder", "guided", "mask", "masked"];
    for (const type of layerTypes) {
      const sym = makeSymbolWithLayerTypes(`sym-${type}`, [
        makeLayer(type, type, [{ isEmpty: false, displayObjects: [makeShapeObj()] }]),
      ]);
      expect(() => compileDocument(makeDoc(sym))).not.toThrow();
    }
  });
});
