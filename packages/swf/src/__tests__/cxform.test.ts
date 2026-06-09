/**
 * Tests for CXFormWithAlpha encoding and ColorEffect → CXForm conversion.
 *
 * Tag codes:
 *   26  PlaceObject2
 *
 * PlaceObject2 flags byte:
 *   bit 0: HasMove        (0x01)
 *   bit 1: HasCharacter   (0x02)
 *   bit 2: HasMatrix      (0x04)
 *   bit 3: HasColorTransform (0x08)
 *   bit 4: HasRatio       (0x10)
 *   bit 5: HasName        (0x20)
 *   bit 6: HasClipDepth   (0x40)
 *   bit 7: HasClipActions (0x80)
 */

import { describe, it, expect } from "vitest";
import { colorEffectToCXForm, encodeCXFormWithAlpha } from "../cxform.js";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene, Symbol } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_PLACE_OBJECT2 = 26;
const TAG_END = 0;

// ---------------------------------------------------------------------------
// SWF tag parser
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

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
    });
    pos = bodyStart + bodyLength;
    if (tagCode === TAG_END) break;
  }
  return tags;
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

function makeFrame(displayObjects: unknown[] = [], index = 0): Frame {
  return {
    index,
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
    displayObjects: displayObjects as Frame["displayObjects"],
  };
}

function makeLayer(id: string, frames: Frame[]): Layer {
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
    frameCount: frames.length,
  };
}

function makeScene(layers: Layer[]): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers },
  };
}

function makeSymbol(id: string, name: string): Symbol {
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    scale9Grid: null,
    timeline: { layers: [makeLayer("l1", [makeFrame([], 0)])] },
    linkage: {
      exportForActionScript: false,
      exportInFirstFrame: false,
      linkageIdentifier: "",
      className: "",
      exportForRuntimeSharing: false,
      importForRuntimeSharing: false,
      sharedUrl: "",
    },
  };
}

function makeDoc(scenes: Scene[], symbols: Symbol[] = []): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes,
    library: { items: symbols, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Unit tests: colorEffectToCXForm
// ---------------------------------------------------------------------------

describe("colorEffectToCXForm", () => {
  it("returns null for type=none", () => {
    const result = colorEffectToCXForm({ type: "none" });
    expect(result).toBeNull();
  });

  it("alpha=50 → alphaMult ≈ 128, all RGB mults = 256, all adds = 0", () => {
    const result = colorEffectToCXForm({ type: "alpha", alpha: 50 });
    expect(result).not.toBeNull();
    expect(result!.alphaMult).toBe(128);
    expect(result!.redMult).toBe(256);
    expect(result!.greenMult).toBe(256);
    expect(result!.blueMult).toBe(256);
    expect(result!.redAdd).toBe(0);
    expect(result!.greenAdd).toBe(0);
    expect(result!.blueAdd).toBe(0);
    expect(result!.alphaAdd).toBe(0);
  });

  it("brightness=0 → identity (mult=256, add=0)", () => {
    const result = colorEffectToCXForm({ type: "brightness", brightness: 0 });
    expect(result).not.toBeNull();
    expect(result!.redMult).toBe(256);
    expect(result!.greenMult).toBe(256);
    expect(result!.blueMult).toBe(256);
    expect(result!.alphaMult).toBe(256);
    expect(result!.redAdd).toBe(0);
    expect(result!.greenAdd).toBe(0);
    expect(result!.blueAdd).toBe(0);
    expect(result!.alphaAdd).toBe(0);
  });

  it("brightness=100 → white (mult=0 for RGB, add=255)", () => {
    const result = colorEffectToCXForm({ type: "brightness", brightness: 100 });
    expect(result).not.toBeNull();
    // At b=1.0: mult = round(max(0, 1 - 1) * 256) = 0
    expect(result!.redMult).toBe(0);
    expect(result!.greenMult).toBe(0);
    expect(result!.blueMult).toBe(0);
    // add = round(max(0, 1.0) * 255) = 255
    expect(result!.redAdd).toBe(255);
    expect(result!.greenAdd).toBe(255);
    expect(result!.blueAdd).toBe(255);
    expect(result!.alphaMult).toBe(256);
    expect(result!.alphaAdd).toBe(0);
  });

  it("tint at 100% red → redAdd=255, greenAdd=0, blueAdd=0", () => {
    const result = colorEffectToCXForm({
      type: "tint",
      tintColor: "#ff0000",
      tintAmount: 100,
    });
    expect(result).not.toBeNull();
    // p = 1.0 → mult = 0, adds = r*p, g*p, b*p
    expect(result!.redMult).toBe(0);
    expect(result!.redAdd).toBe(255);
    expect(result!.greenAdd).toBe(0);
    expect(result!.blueAdd).toBe(0);
    expect(result!.alphaMult).toBe(256);
    expect(result!.alphaAdd).toBe(0);
  });

  it("advanced: all 8 fields pass through correctly", () => {
    const result = colorEffectToCXForm({
      type: "advanced",
      redMult: 50,   // 50% → round(0.5 * 256) = 128
      greenMult: 100, // 100% → 256
      blueMult: 0,   // 0% → 0
      redOffset: 10,
      greenOffset: -20,
      blueOffset: 127,
    });
    expect(result).not.toBeNull();
    expect(result!.redMult).toBe(128);
    expect(result!.greenMult).toBe(256);
    expect(result!.blueMult).toBe(0);
    expect(result!.alphaMult).toBe(256); // default
    expect(result!.redAdd).toBe(10);
    expect(result!.greenAdd).toBe(-20);
    expect(result!.blueAdd).toBe(127);
    expect(result!.alphaAdd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: encodeCXFormWithAlpha
// ---------------------------------------------------------------------------

describe("encodeCXFormWithAlpha", () => {
  it("returns a non-empty Uint8Array (at least 2 bytes)", () => {
    const result = encodeCXFormWithAlpha({
      redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 128,
      redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0,
    });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("identity (no mult change, no add) produces minimal encoding", () => {
    // When all mults = 256 and all adds = 0, hasMultTerms=false, hasAddTerms=false
    // Result should be 1 byte: HasAddTerms=0, HasMultTerms=0, Nbits=1 → 0b00_0001_xx → padded
    const result = encodeCXFormWithAlpha({
      redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 256,
      redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0,
    });
    expect(result.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: PlaceObject2 HasColorTransform flag
// ---------------------------------------------------------------------------

describe("compile: symbol instance with colorEffect", () => {
  it("alpha=50% instance emits PlaceObject2 with HasColorTransform flag (0x08)", () => {
    const sym = makeSymbol("sym-1", "Symbol 1");
    const instance = {
      type: "instance" as const,
      id: "inst-1",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      colorEffect: { type: "alpha" as const, alpha: 50 },
    };

    const doc = makeDoc(
      [makeScene([makeLayer("l1", [makeFrame([instance])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // Find PlaceObject2 tags
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTags.length).toBeGreaterThan(0);

    // The instance's PlaceObject2 should have HasColorTransform bit (0x08) set in flags
    const instancePlaceTag = placeTags.find((t) => {
      // flags byte is the first byte of body
      return (t.body[0] & 0x08) !== 0;
    });
    expect(instancePlaceTag).toBeDefined();
    // Also verify HasCharacter (0x02) and HasMatrix (0x04) are set
    expect(instancePlaceTag!.body[0] & 0x0e).toBe(0x0e);
  });

  it("instance without colorEffect emits PlaceObject2 WITHOUT HasColorTransform flag", () => {
    const sym = makeSymbol("sym-1", "Symbol 1");
    const instance = {
      type: "instance" as const,
      id: "inst-1",
      symbolId: "sym-1",
      x: 0,
      y: 0,
    };

    const doc = makeDoc(
      [makeScene([makeLayer("l1", [makeFrame([instance])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTags.length).toBeGreaterThan(0);

    // No PlaceObject2 should have HasColorTransform set
    const withCxform = placeTags.find((t) => (t.body[0] & 0x08) !== 0);
    expect(withCxform).toBeUndefined();
  });

  it("instance with type=none colorEffect does NOT set HasColorTransform", () => {
    const sym = makeSymbol("sym-1", "Symbol 1");
    const instance = {
      type: "instance" as const,
      id: "inst-1",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      colorEffect: { type: "none" as const },
    };

    const doc = makeDoc(
      [makeScene([makeLayer("l1", [makeFrame([instance])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);

    const withCxform = placeTags.find((t) => (t.body[0] & 0x08) !== 0);
    expect(withCxform).toBeUndefined();
  });
});
