/**
 * Tests for PlaceObject2 (tag 26) instance name encoding via HasName flag (bit 5, 0x20).
 *
 * SWF PlaceObject2 flags byte:
 *   bit 0 (0x01): HasMove
 *   bit 1 (0x02): HasCharacter
 *   bit 2 (0x04): HasMatrix
 *   bit 3 (0x08): HasColorTransform
 *   bit 4 (0x10): HasRatio
 *   bit 5 (0x20): HasName
 *   bit 6 (0x40): HasClipDepth
 *   bit 7 (0x80): HasClipActions
 *
 * When HasName is set, the null-terminated instance name string appears in the
 * tag body after the MATRIX (and CXFORM, if present).
 */

import { describe, it, expect } from "vitest";
import { exportSWF } from "../export.js";
import type { FlashDocument, Frame, Layer, Scene, Symbol, SymbolInstance } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag parser helper
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

const TAG_PLACE_OBJECT2 = 26;
const HAS_NAME_FLAG = 0x20;
const HAS_CHARACTER_FLAG = 0x02;

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

function makeEmptyFrame(
  displayObjects: readonly SymbolInstance[] = []
): Frame {
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
    displayObjects,
  };
}

function makeLayer(frames: Frame[]): Layer {
  return {
    id: "layer-1",
    name: "Layer 1",
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

function makeScene(frames: Frame[]): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers: [makeLayer(frames)] },
  };
}

function makeSymbol(id: string, name: string): Symbol {
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: { layers: [makeLayer([makeEmptyFrame()])] },
    linkage: DEFAULT_LINKAGE,
    scale9Grid: null,
  };
}

/**
 * Create a SymbolInstance with the given instanceName.
 */
function makeInstanceWithName(
  id: string,
  symbolId: string,
  instanceName: string
): SymbolInstance {
  return {
    id,
    type: "instance",
    symbolId,
    x: 10,
    y: 10,
    instanceName,
  };
}

function makeDoc(
  symbolId: string,
  instance: SymbolInstance
): FlashDocument {
  const sym = makeSymbol(symbolId, "MyButton");
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene([makeEmptyFrame([instance])])],
    library: { items: [sym], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlaceObject2 — instance name (HasName flag)", () => {
  it("1. SWF compiles without error when instanceName is set", () => {
    const inst = makeInstanceWithName("inst-1", "sym-1", "myButton");
    const doc = makeDoc("sym-1", inst);
    expect(() => exportSWF(doc, { compress: false })).not.toThrow();
  });

  it("2. PlaceObject2 with instanceName has HasName flag (0x20) set in flags byte", () => {
    const inst = makeInstanceWithName("inst-1", "sym-1", "myButton");
    const doc = makeDoc("sym-1", inst);
    const bytes = exportSWF(doc, { compress: false });
    const tags = findTags(bytes);

    // Find PlaceObject2 tags that place a new character (HasCharacter=1)
    const po2Tags = tags.filter(
      (t) =>
        t.type === TAG_PLACE_OBJECT2 &&
        (t.body[0] & HAS_CHARACTER_FLAG) !== 0
    );

    expect(po2Tags.length).toBeGreaterThan(0);

    // At least one must have HasName flag set
    const hasNameTag = po2Tags.find((t) => (t.body[0] & HAS_NAME_FLAG) !== 0);
    expect(hasNameTag).toBeDefined();
  });

  it("3. PlaceObject2 body contains 'myButton\\0' when HasName is set", () => {
    const instanceName = "myButton";
    const inst = makeInstanceWithName("inst-1", "sym-1", instanceName);
    const doc = makeDoc("sym-1", inst);
    const bytes = exportSWF(doc, { compress: false });
    const tags = findTags(bytes);

    const po2Tags = tags.filter(
      (t) =>
        t.type === TAG_PLACE_OBJECT2 &&
        (t.body[0] & HAS_CHARACTER_FLAG) !== 0 &&
        (t.body[0] & HAS_NAME_FLAG) !== 0
    );

    expect(po2Tags.length).toBeGreaterThan(0);

    const nameBytes = new TextEncoder().encode(instanceName + "\0");

    // Search for the name bytes within the tag body
    const found = po2Tags.some((tag) => {
      const body = tag.body;
      for (let i = 0; i <= body.length - nameBytes.length; i++) {
        let match = true;
        for (let j = 0; j < nameBytes.length; j++) {
          if (body[i + j] !== nameBytes[j]) {
            match = false;
            break;
          }
        }
        if (match) return true;
      }
      return false;
    });

    expect(found).toBe(true);
  });

  it("4. PlaceObject2 without instanceName does NOT have HasName flag set", () => {
    // Instance with no instanceName field
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 10,
      y: 10,
    };
    const doc = makeDoc("sym-1", inst);
    const bytes = exportSWF(doc, { compress: false });
    const tags = findTags(bytes);

    const po2Tags = tags.filter(
      (t) =>
        t.type === TAG_PLACE_OBJECT2 &&
        (t.body[0] & HAS_CHARACTER_FLAG) !== 0
    );

    expect(po2Tags.length).toBeGreaterThan(0);

    // None should have HasName set
    const hasNameTag = po2Tags.find((t) => (t.body[0] & HAS_NAME_FLAG) !== 0);
    expect(hasNameTag).toBeUndefined();
  });

  it("5. Flags byte equals 0x26 (HasCharacter | HasMatrix | HasName) for named instance", () => {
    const inst = makeInstanceWithName("inst-1", "sym-1", "myButton");
    const doc = makeDoc("sym-1", inst);
    const bytes = exportSWF(doc, { compress: false });
    const tags = findTags(bytes);

    const po2Tags = tags.filter(
      (t) =>
        t.type === TAG_PLACE_OBJECT2 &&
        (t.body[0] & HAS_CHARACTER_FLAG) !== 0 &&
        (t.body[0] & HAS_NAME_FLAG) !== 0
    );

    expect(po2Tags.length).toBeGreaterThan(0);
    // HasCharacter (0x02) | HasMatrix (0x04) | HasName (0x20) = 0x26
    expect(po2Tags[0].body[0]).toBe(0x26);
  });
});
