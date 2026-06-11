/**
 * Tests for DefineEditText (tag 37) encoding via compileDocument.
 *
 * Verifies that a FlashDocument containing TextDisplayObject instances
 * produces valid SWF output, with DefineEditText (tag 37) emitted for
 * dynamic and input text objects.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  TextDisplayObject,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_DEFINE_TEXT = 11;
const TAG_DEFINE_EDIT_TEXT = 37;

// ---------------------------------------------------------------------------
// SWF binary parser (minimal — mirrors other SWF tests)
// ---------------------------------------------------------------------------

function findTags(
  bytes: Uint8Array
): Array<{ type: number; body: Uint8Array }> {
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
    if (type === TAG_END) break;
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

function makeTextObject(
  overrides: Partial<TextDisplayObject> = {}
): TextDisplayObject {
  return {
    id: "text-1",
    type: "text",
    x: 10,
    y: 10,
    width: 200,
    height: 30,
    text: "Hello World",
    textType: "dynamic",
    fontFamily: "Arial",
    fontSize: 12,
    bold: false,
    italic: false,
    color: { r: 0, g: 0, b: 0, a: 255 },
    align: "left",
    multiline: false,
    wordWrap: false,
    ...overrides,
  };
}

function makeFrame(displayObjects: readonly TextDisplayObject[]): Frame {
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

function makeScene(name: string, frames: Frame[]): Scene {
  return {
    id: "scene-1",
    name,
    timeline: { layers: [makeLayer(frames)] },
  };
}

function makeDoc(textObjects: TextDisplayObject[]): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene("Scene 1", [makeFrame(textObjects)])],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineEditText (tag 37) encoding", () => {
  it("compileDocument returns a Uint8Array for a doc with a dynamic text object", () => {
    const doc = makeDoc([makeTextObject()]);
    const bytes = compileDocument(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(8);
  });

  it("SWF output contains a DefineEditText tag (type 37) for dynamic text", () => {
    const doc = makeDoc([makeTextObject({ textType: "dynamic" })]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const editTextTags = tags.filter((t) => t.type === TAG_DEFINE_EDIT_TEXT);
    expect(editTextTags.length).toBeGreaterThanOrEqual(1);
  });

  it("SWF output contains a DefineEditText tag (type 37) for input text", () => {
    const doc = makeDoc([makeTextObject({ textType: "input", text: "" })]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const editTextTags = tags.filter((t) => t.type === TAG_DEFINE_EDIT_TEXT);
    expect(editTextTags.length).toBeGreaterThanOrEqual(1);
  });

  it("SWF output contains DefineEditText (type 37) for static text (device fonts)", () => {
    const doc = makeDoc([makeTextObject({ textType: "static", text: "Hi" })]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const editTextTags = tags.filter((t) => t.type === TAG_DEFINE_EDIT_TEXT);
    // Static text now uses DefineEditText with device fonts (matching MC text behaviour)
    expect(editTextTags.length).toBeGreaterThanOrEqual(1);
  });

  it("static text does NOT emit DefineText (type 11) — uses DefineEditText instead", () => {
    const doc = makeDoc([makeTextObject({ textType: "static", text: "Hi" })]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const textTags = tags.filter((t) => t.type === TAG_DEFINE_TEXT);
    expect(textTags.length).toBe(0);
  });

  it("DefineEditText tag body begins with a valid CharacterId (UI16LE > 0)", () => {
    const doc = makeDoc([makeTextObject({ textType: "dynamic", text: "Score" })]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const editTag = tags.find((t) => t.type === TAG_DEFINE_EDIT_TEXT);
    expect(editTag).toBeDefined();
    const charId = editTag!.body[0] | (editTag!.body[1] << 8);
    expect(charId).toBeGreaterThan(0);
  });

  it("DefineEditText tag body is non-trivially sized (contains RECT + flags + fields)", () => {
    const doc = makeDoc([makeTextObject({ textType: "dynamic", text: "Hello" })]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const editTag = tags.find((t) => t.type === TAG_DEFINE_EDIT_TEXT);
    expect(editTag).toBeDefined();
    // Minimal body: 2 (charId) + RECT bits + 2 (flags) + ...
    expect(editTag!.body.length).toBeGreaterThan(10);
  });

  it("two dynamic text objects in same frame produce two DefineEditText tags", () => {
    const obj1 = makeTextObject({ id: "text-1", textType: "dynamic", text: "One" });
    const obj2: TextDisplayObject = {
      ...makeTextObject({ id: "text-2", textType: "dynamic", text: "Two" }),
      id: "text-2",
      x: 50,
      y: 50,
    };
    const doc = makeDoc([obj1, obj2]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const editTextTags = tags.filter((t) => t.type === TAG_DEFINE_EDIT_TEXT);
    expect(editTextTags.length).toBeGreaterThanOrEqual(2);
  });

  it("SWF output contains an End tag (type 0), indicating well-formed output", () => {
    const doc = makeDoc([makeTextObject()]);
    const bytes = compileDocument(doc);
    const tags = findTags(bytes);
    const endTag = tags.find((t) => t.type === TAG_END);
    expect(endTag).toBeDefined();
  });
});
