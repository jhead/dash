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
import { isOle2, tryLoadRealFla, __readAllStreamsForTest } from "../ole.js";
import { validateContentsStream, validateTimelineStream } from "../write/carchive-validate.js";
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

// Content-bearing timelines are asserted against the STRICT CArchive validator
// (real-Flash byte structure), not against the lenient importer's round-trip. The
// writer's contract is byte-compatibility with Flash 8; importer round-tripping is
// not a goal and must not drive the writer. The validator enforces the §5.1 tag
// invariant and §5.2 index allocation — i.e. it rejects exactly what Flash rejects.

describe("saveRealFla — shape (strict CArchive structure)", () => {
  it("a solid-fill rectangle keyframe stores its geometry INLINE (no CPicShape class)", () => {
    // Real Flash keeps a frame's raw vector graphics as the frame's own inline
    // shape body — NOT a tagged CPicShape child. A shape-only doc's Page 1 must
    // therefore declare exactly {CPicPage, CPicLayer, CPicFrame} and nothing else;
    // a stray CPicShape NEWCLASS corrupts the §5.2 running index and Flash refuses
    // to open the doc.
    const doc = baseDoc([
      sceneWith("Scene 1", [layerWith("Layer 1", "normal", [solidRectShape(40, 50)])]),
    ]);
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    validateContentsStream(streams.get("Contents")!);
    const page = validateTimelineStream(streams.get("Page 1")!);
    expect(page.classes.sort()).toEqual(["CPicFrame", "CPicLayer", "CPicPage"]);
    expect(page.classes).not.toContain("CPicShape");
  });

  it("two raw shapes on one frame merge into ONE inline shape (still no CPicShape)", () => {
    const doc = baseDoc([
      sceneWith("Scene 1", [
        layerWith("Layer 1", "normal", [solidRectShape(10, 10), solidRectShape(120, 80)]),
      ]),
    ]);
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    validateContentsStream(streams.get("Contents")!);
    const page = validateTimelineStream(streams.get("Page 1")!);
    expect(page.classes.sort()).toEqual(["CPicFrame", "CPicLayer", "CPicPage"]);
    expect(page.classes).not.toContain("CPicShape");
  });
});

describe("saveRealFla — symbol + instance (strict CArchive structure)", () => {
  it("a graphic symbol + instance frames the catalog + the page/symbol graphs", () => {
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
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    const cat = validateContentsStream(streams.get("Contents")!);
    expect(cat.documentPages).toBe(2); // scene + symbol CDocumentPage records
    const page = validateTimelineStream(streams.get("Page 1")!);
    expect(page.classes).toContain("CPicSymbol"); // graphic instance class
    expect(streams.has("Symbol 1")).toBe(true);
    validateTimelineStream(streams.get("Symbol 1")!);
  });
});

describe("saveRealFla — text (strict CArchive structure)", () => {
  it("a static text field parses cleanly and frames a CPicText", () => {
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
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    validateContentsStream(streams.get("Contents")!);
    const page = validateTimelineStream(streams.get("Page 1")!);
    expect(page.classes).toContain("CPicText");
  });
});
