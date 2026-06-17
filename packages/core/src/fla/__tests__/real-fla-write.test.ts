/**
 * Binary FLA writer round-trip tests.
 *
 * Build small documents via the model factories, serialize with saveRealFla(),
 * assert the bytes are a valid OLE2 container, then round-trip through the
 * existing importer (tryLoadRealFla) and check that key structure is recovered.
 *
 * Byte-presence is necessary but not sufficient (per CLAUDE.md); these are
 * structural round-trip checks against the inverse-oracle importer.
 */

import { describe, it, expect } from "vitest";
import { saveRealFla } from "../write/fla-write.js";
import { isOle2, tryLoadRealFla } from "../ole.js";
import { createDocument, createDocumentProperties } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import { createLayer, createFrame } from "../../model/timeline.js";
import { createSymbol } from "../../model/library.js";
import type { FlashDocument, Frame, Layer, Scene } from "../../model/types.js";
import type {
  ShapeDisplayObject,
  SymbolInstance,
  TextDisplayObject,
} from "../../engine/types.js";

function frameWith(objects: Frame["displayObjects"]): Frame {
  return createFrame(0, { isEmpty: objects.length === 0, displayObjects: objects });
}

function layerWith(name: string, type: Layer["type"], objects: Frame["displayObjects"]): Layer {
  return createLayer(name, type, { frames: [frameWith(objects)], frameCount: 1 });
}

function sceneWith(name: string, layers: Layer[]): Scene {
  return createScene(name, { timeline: { layers } });
}

function baseDoc(scenes: Scene[], extra?: Partial<FlashDocument>): FlashDocument {
  return createDocument({
    properties: createDocumentProperties({
      width: 640,
      height: 480,
      frameRate: 24,
      backgroundColor: "#336699",
    }),
    scenes,
    library: { items: [], folders: [] },
    ...extra,
  });
}

const solidRectShape = (x: number, y: number): ShapeDisplayObject => ({
  type: "shape",
  id: "shape1",
  x,
  y,
  shape: {
    id: "geom1",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 100, y: 0 } },
          { type: "line", to: { x: 100, y: 60 } },
          { type: "line", to: { x: 0, y: 60 } },
          { type: "line", to: { x: 0, y: 0 } },
        ],
        fill: { type: "solid", color: { r: 200, g: 30, b: 40, a: 255 } },
        closed: true,
      },
    ],
  },
});

describe("saveRealFla — container + document properties", () => {
  it("produces a valid OLE2 container", () => {
    const doc = baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [])])]);
    const bytes = saveRealFla(doc);
    expect(isOle2(bytes)).toBe(true);
  });

  it("round-trips stage width/height/fps/background", () => {
    const doc = baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [])])]);
    const out = tryLoadRealFla(saveRealFla(doc));
    expect(out).not.toBeNull();
    expect(out!.properties.width).toBe(640);
    expect(out!.properties.height).toBe(480);
    expect(out!.properties.frameRate).toBe(24);
    expect(out!.properties.backgroundColor.toLowerCase()).toBe("#336699");
  });
});

describe("saveRealFla — scenes", () => {
  it("recovers scene count + names in play order", () => {
    const doc = baseDoc([
      sceneWith("Intro", [layerWith("Layer 1", "normal", [])]),
      sceneWith("Main", [layerWith("Layer 1", "normal", [])]),
      sceneWith("Outro", [layerWith("Layer 1", "normal", [])]),
    ]);
    const out = tryLoadRealFla(saveRealFla(doc));
    expect(out).not.toBeNull();
    expect(out!.scenes.map((s) => s.name)).toEqual(["Intro", "Main", "Outro"]);
  });
});

describe("saveRealFla — layers", () => {
  it("recovers layer count and names (handling bottom-to-top storage)", () => {
    // Model top-to-bottom: li=0 "Top", li=1 "Mid", li=2 "Bottom".
    const layers = [
      layerWith("Top", "normal", []),
      layerWith("Mid", "normal", []),
      layerWith("Bottom", "normal", []),
    ];
    const doc = baseDoc([sceneWith("Scene 1", layers)]);
    const out = tryLoadRealFla(saveRealFla(doc));
    expect(out).not.toBeNull();
    const names = out!.scenes[0]!.timeline.layers.map((l) => l.name);
    expect(names).toEqual(["Top", "Mid", "Bottom"]);
  });

  it("preserves layer visible/locked", () => {
    const layers = [
      createLayer("Hidden", "normal", { visible: false, frames: [createFrame(0)], frameCount: 1 }),
      createLayer("Locked", "normal", { locked: true, frames: [createFrame(0)], frameCount: 1 }),
    ];
    const doc = baseDoc([sceneWith("Scene 1", layers)]);
    const out = tryLoadRealFla(saveRealFla(doc));
    const ls = out!.scenes[0]!.timeline.layers;
    const hidden = ls.find((l) => l.name === "Hidden");
    const locked = ls.find((l) => l.name === "Locked");
    expect(hidden?.visible).toBe(false);
    expect(locked?.locked).toBe(true);
  });
});

describe("saveRealFla — shape", () => {
  it("recovers a keyframe with a solid-fill shape", () => {
    const doc = baseDoc([
      sceneWith("Scene 1", [layerWith("Layer 1", "normal", [solidRectShape(40, 50)])]),
    ]);
    const out = tryLoadRealFla(saveRealFla(doc));
    expect(out).not.toBeNull();
    const layer = out!.scenes[0]!.timeline.layers[0]!;
    const objs = layer.frames[0]!.displayObjects;
    const shape = objs.find((o) => o.type === "shape");
    expect(shape).toBeDefined();
    if (shape && shape.type === "shape") {
      // At least one path with a solid fill should have been reconstructed.
      const filled = shape.shape.paths.find((p) => p.fill && p.fill.type === "solid");
      expect(filled).toBeDefined();
      if (filled && filled.fill && filled.fill.type === "solid") {
        expect(filled.fill.color).toEqual({ r: 200, g: 30, b: 40, a: 255 });
      }
    }
  });
});

describe("saveRealFla — symbol + instance", () => {
  it("recovers a symbol and a graphic instance with a matrix", () => {
    const sym = createSymbol("MyGraphic", "graphic");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst1",
      symbolId: sym.id,
      x: 120,
      y: 80,
      scaleX: 2,
      scaleY: 0.5,
      rotation: 0,
    };
    const doc = baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [inst])])], {
      library: { items: [sym], folders: [] },
    });
    const out = tryLoadRealFla(saveRealFla(doc));
    expect(out).not.toBeNull();
    // Symbol present in library.
    const importedSym = out!.library.items.find((it) => it.itemType === "symbol");
    expect(importedSym).toBeDefined();
    // Instance present on the layer, with the placement matrix recovered.
    const objs = out!.scenes[0]!.timeline.layers[0]!.frames[0]!.displayObjects;
    const importedInst = objs.find((o) => o.type === "instance");
    expect(importedInst).toBeDefined();
    if (importedInst && importedInst.type === "instance") {
      expect(importedInst.x).toBeCloseTo(120, 1);
      expect(importedInst.y).toBeCloseTo(80, 1);
      expect(importedInst.scaleX ?? 1).toBeCloseTo(2, 1);
      expect(importedInst.scaleY ?? 1).toBeCloseTo(0.5, 1);
    }
  });
});

describe("saveRealFla — text", () => {
  it("recovers a static text field", () => {
    const text: TextDisplayObject = {
      type: "text",
      id: "t1",
      x: 30,
      y: 40,
      width: 200,
      height: 24,
      text: "Hello",
      textType: "static",
      fontFamily: "Arial",
      fontSize: 18,
      bold: false,
      italic: false,
      color: { r: 10, g: 20, b: 30, a: 255 },
      align: "left",
      multiline: false,
      wordWrap: false,
    };
    const doc = baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [text])])]);
    const out = tryLoadRealFla(saveRealFla(doc));
    expect(out).not.toBeNull();
    const objs = out!.scenes[0]!.timeline.layers[0]!.frames[0]!.displayObjects;
    const importedText = objs.find((o) => o.type === "text");
    expect(importedText).toBeDefined();
    if (importedText && importedText.type === "text") {
      expect(importedText.text).toBe("Hello");
      expect(importedText.textType).toBe("static");
      expect(importedText.fontSize).toBeCloseTo(18, 1);
      expect(importedText.color).toEqual({ r: 10, g: 20, b: 30, a: 255 });
    }
  });
});
