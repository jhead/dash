/**
 * Self-determinism test for the golden FLA/SWF pair harness (task 0698).
 *
 * The golden-diff harness compares our SWF against a reference Flash 8 export.
 * That comparison is only meaningful if our own compiler is byte-stable: the
 * same FlashDocument must always compile to identical bytes. This guards against
 * non-determinism creeping in via unstable sorts, random IDs, Map/Set iteration
 * order, or a non-fixed zlib compression level.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
  Shape,
  ShapeDisplayObject,
  TextDisplayObject,
  SymbolInstance,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Minimal document builders (mirrors integration.test.ts helpers)
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: "#3366cc",
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

const DEFAULT_SYMBOL_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

function makeFrame(
  displayObjects: readonly (ShapeDisplayObject | TextDisplayObject | SymbolInstance)[],
  script = ""
): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: displayObjects.length === 0 && !script,
    tweenType: "none",
    label: "",
    labelType: "name",
    script,
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

function makeLayer(name: string, frames: Partial<Frame>[]): Layer {
  const fullFrames: Frame[] = frames.map((f, i) => {
    const { index: _ignored, ...rest } = f as Partial<Frame> & { index?: number };
    return {
      ...makeFrame([]),
      index: i,
      ...rest,
    };
  });
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
    frames: fullFrames,
    frameCount: fullFrames.length,
  };
}

function makeScene(id: string, name: string, frames: Partial<Frame>[]): Scene {
  return {
    id,
    name,
    timeline: { layers: [makeLayer("Layer 1", frames)] },
  };
}

function makeRect(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number; a: number }
): ShapeDisplayObject {
  const shape: Shape = {
    id: `shape-${id}`,
    paths: [
      {
        start: { x, y },
        segments: [
          { type: "line", to: { x: x + w, y } },
          { type: "line", to: { x: x + w, y: y + h } },
          { type: "line", to: { x, y: y + h } },
        ],
        closed: true,
        fill: { type: "solid", color },
      },
    ],
  };
  return {
    id: `rect-obj-${id}`,
    type: "shape",
    shape,
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

function makeText(id: string, text: string): TextDisplayObject {
  return {
    id: `text-obj-${id}`,
    type: "text",
    x: 10,
    y: 10,
    width: 100,
    height: 30,
    text,
    textType: "static",
    fontFamily: "Arial",
    fontSize: 12,
    bold: false,
    italic: false,
    color: { r: 0, g: 0, b: 0, a: 255 },
    align: "left",
    multiline: false,
    wordWrap: false,
  };
}

function makeSymbol(id: string, name: string, frames?: Partial<Frame>[]): Symbol {
  const innerFrames = frames ?? [makeFrame([])];
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: { layers: [makeLayer("Layer 1", innerFrames)] },
    linkage: DEFAULT_SYMBOL_LINKAGE,
    scale9Grid: null,
  };
}

function makeInstance(id: string, symbolId: string, x: number, y: number): SymbolInstance {
  return {
    id: `inst-${id}`,
    type: "instance",
    symbolId,
    instanceName: `inst_${id}`,
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

/**
 * Build a non-trivial document that exercises multiple code paths likely to
 * hide non-determinism: multiple shapes (char-id allocation), a library symbol
 * with nested instance, text (font table), and a frame script (AS2 compile).
 */
function buildTestDocument(): FlashDocument {
  const sym = makeSymbol("sym-1", "MovieClip 1", [
    makeFrame([makeRect("inner", 0, 0, 40, 40, { r: 0, g: 200, b: 0, a: 255 })]),
  ]);

  const frame0 = makeFrame(
    [
      makeRect("a", 10, 10, 100, 80, { r: 255, g: 0, b: 0, a: 255 }),
      makeRect("b", 150, 20, 60, 60, { r: 0, g: 0, b: 255, a: 255 }),
      makeText("t", "Hello, golden harness"),
      makeInstance("i", "sym-1", 300, 200),
    ],
    "trace('frame 1'); var x = 1 + 2;"
  );
  const frame1 = makeFrame([makeRect("a", 20, 20, 100, 80, { r: 255, g: 0, b: 0, a: 255 })]);

  return {
    id: "doc-determinism",
    properties: BASE_PROPS,
    scenes: [makeScene("scene-1", "Scene 1", [frame0, frame1])],
    library: { items: [sym], folders: [] },
  };
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compileDocument() self-determinism", () => {
  it("same document produces identical bytes across two compiles (uncompressed)", () => {
    const doc = buildTestDocument();
    const swf1 = compileDocument(doc);
    const swf2 = compileDocument(doc);
    expect(toHex(swf1)).toBe(toHex(swf2));
  });

  it("same document produces identical bytes when compressed (fixed zlib level)", () => {
    const doc = buildTestDocument();
    const swf1 = compileDocument(doc, { compress: true });
    const swf2 = compileDocument(doc, { compress: true });
    expect(toHex(swf1)).toBe(toHex(swf2));
    // Compressed output must use the CWS signature.
    expect(swf1[0]).toBe(0x43);
  });

  it("repeated compiles remain stable across many iterations", () => {
    const doc = buildTestDocument();
    const reference = toHex(compileDocument(doc));
    for (let i = 0; i < 5; i++) {
      expect(toHex(compileDocument(doc))).toBe(reference);
    }
  });
});
