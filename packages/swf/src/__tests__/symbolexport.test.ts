/**
 * Tests for symbol linkage export (ExportAssets tag 56).
 *
 * Verifies that symbols with exportForActionScript=true produce a correct
 * ExportAssets tag (type 56) in compiled SWF output, and that symbols with
 * exportForActionScript=false are excluded.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene, Symbol } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF binary parser helper
// ---------------------------------------------------------------------------

function findTags(bytes: Uint8Array) {
  const nbits = bytes[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let i = 8 + rectBytes + 4;
  const tags: Array<{ type: number; body: Uint8Array }> = [];
  while (i < bytes.length - 1) {
    const h = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
    const type = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    if (len === 63) {
      len =
        bytes[i] |
        (bytes[i + 1] << 8) |
        (bytes[i + 2] << 16) |
        (bytes[i + 3] << 24);
      i += 4;
    }
    tags.push({ type, body: bytes.slice(i, i + len) });
    if (type === 0) break;
    i += len;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Fixture helpers
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

function makeEmptyFrame(): Frame {
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
  };
}

function makeLayer(id = "layer-1"): Layer {
  return {
    id,
    name: "Layer 1",
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames: [makeEmptyFrame()],
    frameCount: 1,
  };
}

function makeScene(): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers: [makeLayer()] },
  };
}

function makeDoc(symbols: Symbol[]): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene()],
    library: { items: symbols, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Symbol linkage export", () => {
  // Test 1: Symbol with exportForActionScript=true and linkageIdentifier='MyClip'
  // produces ExportAssets tag (type 56) in compiled SWF.
  it("symbol with exportForActionScript=true produces ExportAssets tag (type 56)", () => {
    const symbol: Symbol = {
      id: "sym1",
      name: "MyClip",
      itemType: "symbol",
      symbolType: "movieclip",
      timeline: { layers: [makeLayer("sym-layer-1")] },
      linkage: {
        exportForActionScript: true,
        exportInFirstFrame: true,
        linkageIdentifier: "MyClip",
        className: "MyClip",
        exportForRuntimeSharing: false,
        importForRuntimeSharing: false,
        sharedUrl: "",
      },
      scale9Grid: null,
    };
    const doc = makeDoc([symbol]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);

    const exportTags = tags.filter((t) => t.type === 56);
    expect(exportTags.length).toBeGreaterThan(0);
  });

  // Test 2: The ExportAssets body contains uint16 count, then (uint16 charId,
  // null-terminated name) pairs — verify 'MyClip\0' appears in the body.
  it("ExportAssets body contains 'MyClip\\0' in correct binary format", () => {
    const symbol: Symbol = {
      id: "sym1",
      name: "MyClip",
      itemType: "symbol",
      symbolType: "movieclip",
      timeline: { layers: [makeLayer("sym-layer-1")] },
      linkage: {
        exportForActionScript: true,
        exportInFirstFrame: true,
        linkageIdentifier: "MyClip",
        className: "MyClip",
        exportForRuntimeSharing: false,
        importForRuntimeSharing: false,
        sharedUrl: "",
      },
      scale9Grid: null,
    };
    const doc = makeDoc([symbol]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);

    const exportTags = tags.filter((t) => t.type === 56);
    expect(exportTags.length).toBe(1);

    const body = exportTags[0].body;
    // First 2 bytes: count (uint16 LE), should be 1
    const count = body[0] | (body[1] << 8);
    expect(count).toBe(1);

    // Next 2 bytes: characterId (uint16 LE)
    // Then: null-terminated string 'MyClip\0'
    let pos = 4; // skip count(2) + charId(2)
    let nameEnd = pos;
    while (nameEnd < body.length && body[nameEnd] !== 0) nameEnd++;
    const name = new TextDecoder().decode(body.slice(pos, nameEnd));
    expect(name).toBe("MyClip");
    // Verify null terminator present
    expect(body[nameEnd]).toBe(0);
  });

  // Test 3: Symbol with exportForActionScript=false produces no ExportAssets tag.
  it("symbol with exportForActionScript=false does not produce ExportAssets tag", () => {
    const symbol: Symbol = {
      id: "sym1",
      name: "MyClip",
      itemType: "symbol",
      symbolType: "movieclip",
      timeline: { layers: [makeLayer("sym-layer-1")] },
      linkage: {
        exportForActionScript: false,
        exportInFirstFrame: false,
        linkageIdentifier: "MyClip",
        className: "MyClip",
        exportForRuntimeSharing: false,
        importForRuntimeSharing: false,
        sharedUrl: "",
      },
      scale9Grid: null,
    };
    const doc = makeDoc([symbol]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);

    const exportTags = tags.filter((t) => t.type === 56);
    expect(exportTags.length).toBe(0);
  });
});
