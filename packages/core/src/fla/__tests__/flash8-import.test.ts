/**
 * Real Flash binary FLA import tests.
 *
 * These exercise the genuine Flash 8 / MX 2004 binary document payload
 * parser (flash8-binary.ts + flash8-import.ts) against real .fla fixtures:
 *
 *   fixtures/flash8-nested-textfields.fla
 *     Authored in Flash 8 (Contents version 0x3F). One scene; a button
 *     instance named "evilbutton"; a frame script; library with a button
 *     symbol (shape + dynamic text + nested movieclip instance "evilmc")
 *     and a movieclip symbol (shape + two dynamic text fields, one named
 *     "eviltext" with variable binding).
 *
 *   fixtures/mx2004-frame-scripts.fla
 *     MX 2004-era binary format (Contents version 0x38). Three keyframes
 *     with AS2 frame scripts on the main timeline; a movieclip symbol
 *     ("child") whose three keyframes each carry a script and a rectangle
 *     shape with a solid fill and a 1px stroke.
 *
 * Fixture provenance: ruffle's AVM1 regression-test sources (MIT-licensed),
 * ruffle/tests/tests/swfs/avm1/{nested_textfields_in_buttons,delete}/test.fla.
 * Ground truth for shape geometry was cross-checked against the SWFs
 * published from the same FLAs.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isOle2, tryLoadRealFla } from "../ole.js";
import { parseFla8Contents, parseFla8Timeline } from "../flash8-binary.js";
import { parseClipActions, parseButtonHandlers, toColorEffect, toFlashFilter, buildFla8Document } from "../flash8-import.js";
import { getTweenSpans } from "../../model/timeline-query.js";
import type { Fla8ColorEffect, Fla8Filter } from "../flash8-binary.js";
import type { FlashDocument, Symbol as SymbolItem, SoundItem } from "../../model/types.js";
import type {
  ShapeDisplayObject,
  SymbolInstance,
  TextDisplayObject,
} from "../../engine/types.js";

function fixture(name: string): Uint8Array {
  const path = fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
  return new Uint8Array(readFileSync(path));
}

function symbols(doc: FlashDocument): SymbolItem[] {
  return doc.library.items.filter((i): i is SymbolItem => i.itemType === "symbol");
}

function allDisplayObjects(doc: FlashDocument) {
  const out: Array<ShapeDisplayObject | SymbolInstance | TextDisplayObject> = [];
  const timelines = [
    ...doc.scenes.map((s) => s.timeline),
    ...symbols(doc).map((s) => s.timeline),
  ];
  for (const tl of timelines) {
    for (const layer of tl.layers) {
      for (const frame of layer.frames) {
        for (const o of frame.displayObjects) {
          if (o.type === "shape" || o.type === "instance" || o.type === "text") {
            out.push(o);
          }
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Flash 8 fixture
// ---------------------------------------------------------------------------

describe("real Flash 8 .fla import (flash8-nested-textfields.fla)", () => {
  let doc: FlashDocument;

  beforeAll(() => {
    const bytes = fixture("flash8-nested-textfields.fla");
    expect(isOle2(bytes)).toBe(true);
    const loaded = tryLoadRealFla(bytes);
    expect(loaded).not.toBeNull();
    doc = loaded!;
  });

  it("extracts stage properties from the Contents stream", () => {
    expect(doc.properties.width).toBe(550);
    expect(doc.properties.height).toBe(400);
    expect(doc.properties.frameRate).toBe(12);
    expect(doc.properties.backgroundColor).toBe("#ffffff");
  });

  it("extracts the scene with its real layer", () => {
    expect(doc.scenes.length).toBe(1);
    const layers = doc.scenes[0]!.timeline.layers;
    expect(layers.length).toBe(1);
    expect(layers[0]!.name).toBe("Layer 1");
    expect(layers[0]!.type).toBe("normal");
  });

  it("extracts the frame script (AS2 source) from frame 1", () => {
    const frame = doc.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.script).toContain("this.helloworld");
    expect(frame.script).toContain("Congratulations");
  });

  it("extracts the button instance with its instance name and symbol link", () => {
    const frame = doc.scenes[0]!.timeline.layers[0]!.frames[0]!;
    const instances = frame.displayObjects.filter(
      (o): o is SymbolInstance => o.type === "instance",
    );
    expect(instances.length).toBe(1);
    const inst = instances[0]!;
    expect(inst.instanceName).toBe("evilbutton");
    // placement matrix translation (verified against the source document)
    expect(inst.x).toBeCloseTo(39, 0);
    expect(inst.y).toBeCloseTo(49, 0);
    // must reference a real library symbol
    const target = symbols(doc).find((s) => s.id === inst.symbolId);
    expect(target).toBeDefined();
    expect(target!.symbolType).toBe("button");
  });

  it("extracts both library symbols with correct types", () => {
    const syms = symbols(doc);
    expect(syms.length).toBe(2);
    expect(syms.map((s) => s.symbolType).sort()).toEqual(["button", "movieclip"]);
  });

  it("extracts shape geometry inside the button symbol", () => {
    const button = symbols(doc).find((s) => s.symbolType === "button")!;
    const shapes = button.timeline.layers
      .flatMap((l) => l.frames)
      .flatMap((f) => f.displayObjects)
      .filter((o): o is ShapeDisplayObject => o.type === "shape");
    expect(shapes.length).toBeGreaterThan(0);
    const paths = shapes[0]!.shape.paths;
    expect(paths.length).toBeGreaterThan(0);
    // red fill (#FF0000) — cross-checked against the published SWF
    const fills = paths.map((p) => p.fill).filter((f) => f && f.type === "solid");
    expect(fills.length).toBeGreaterThan(0);
    expect(fills[0]).toMatchObject({ type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } });
    // closed rectangle outline ~480x183 px (SWF DefineShape bounds: 480x183)
    expect(paths[0]!.closed).toBe(true);
    expect(paths[0]!.segments.length).toBe(4);
  });

  it("extracts dynamic text fields with content, font, and instance name", () => {
    const texts = allDisplayObjects(doc).filter(
      (o): o is TextDisplayObject => o.type === "text",
    );
    const contents = texts.map((t) => t.text);
    expect(contents).toContain("button");
    expect(contents).toContain("movieclip");
    expect(contents).toContain("Evil Dynamic Crosslinked Text Field");
    const evil = texts.find((t) => t.text.startsWith("Evil"))!;
    expect(evil.instanceName).toBe("eviltext");
    expect(evil.textType).toBe("dynamic");
    expect(evil.fontFamily).toBe("Times New Roman");
    expect(evil.fontSize).toBe(12);
  });

  it("extracts the nested movieclip instance inside the button", () => {
    const button = symbols(doc).find((s) => s.symbolType === "button")!;
    const instances = button.timeline.layers
      .flatMap((l) => l.frames)
      .flatMap((f) => f.displayObjects)
      .filter((o): o is SymbolInstance => o.type === "instance");
    expect(instances.length).toBe(1);
    expect(instances[0]!.instanceName).toBe("evilmc");
    const target = symbols(doc).find((s) => s.id === instances[0]!.symbolId);
    expect(target?.symbolType).toBe("movieclip");
  });
});

// ---------------------------------------------------------------------------
// MX 2004 fixture (frame scripts + shape geometry)
// ---------------------------------------------------------------------------

describe("MX 2004 binary .fla import (mx2004-frame-scripts.fla)", () => {
  let doc: FlashDocument;

  beforeAll(() => {
    const loaded = tryLoadRealFla(fixture("mx2004-frame-scripts.fla"));
    expect(loaded).not.toBeNull();
    doc = loaded!;
  });

  it("extracts three keyframes with their AS2 frame scripts", () => {
    const layer = doc.scenes[0]!.timeline.layers[0]!;
    expect(layer.name).toBe("Layer 1");
    expect(layer.frameCount).toBe(3);
    expect(layer.frames.length).toBe(3);
    expect(layer.frames[0]!.script).toContain('var x = "thing";');
    expect(layer.frames[1]!.script).toContain("delete x;");
    expect(layer.frames[2]!.script).toBe("stop();");
    expect(layer.frames.map((f) => f.index)).toEqual([0, 1, 2]);
  });

  it("extracts the 'child' movieclip symbol with per-frame scripts", () => {
    const syms = symbols(doc);
    expect(syms.length).toBe(1);
    const child = syms[0]!;
    expect(child.name).toBe("child");
    expect(child.symbolType).toBe("movieclip");
    const frames = child.timeline.layers[0]!.frames;
    expect(frames.length).toBe(3);
    expect(frames[0]!.script).toContain("child frame 1");
    expect(frames[1]!.script).toContain("child frame 2");
    expect(frames[2]!.script).toContain("child frame 3");
    expect(frames[2]!.script).toContain("stop();");
  });

  it("extracts rectangle shape geometry with fill and stroke", () => {
    const child = symbols(doc)[0]!;
    const shape = child.timeline.layers[0]!.frames[0]!.displayObjects.find(
      (o): o is ShapeDisplayObject => o.type === "shape",
    )!;
    expect(shape).toBeDefined();
    const path = shape.shape.paths[0]!;
    // Ground truth from the published SWF: DefineShape bounds
    // (-58.5..60.5, -36.5..38.5 px) = 118x74 px rect + 1px stroke.
    expect(path.closed).toBe(true);
    expect(path.segments.length).toBe(4);
    expect(path.start.x).toBeCloseTo(60, 1);
    expect(path.start.y).toBeCloseTo(38, 1);
    expect(path.fill).toMatchObject({
      type: "solid",
      color: { r: 0xff, g: 0x33, b: 0x00, a: 0xff },
    });
    expect(path.stroke).toMatchObject({ width: 1, color: { r: 0, g: 0, b: 0, a: 255 } });
  });

  it("frames with no display objects are flagged empty; the shape frame is not", () => {
    const sceneFrames = doc.scenes[0]!.timeline.layers[0]!.frames;
    expect(sceneFrames.every((f) => f.isEmpty)).toBe(true);
    const childFrames = symbols(doc)[0]!.timeline.layers[0]!.frames;
    expect(childFrames.every((f) => !f.isEmpty)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shape tween (morph) import — task 0716
// Fixture: ruffle/swf/tests/swfs/DefineMorphShape-MX.fla (MX-era binary FLA)
// This FLA has a single layer with a 29-frame shape tween: a gradient-filled
// quadrilateral morphs into a differently-shaped quadrilateral.
// ---------------------------------------------------------------------------

describe("shape tween FLA import (morph-shape-tween-mx.fla)", () => {
  let doc: FlashDocument;

  beforeAll(() => {
    const bytes = fixture("morph-shape-tween-mx.fla");
    expect(isOle2(bytes)).toBe(true);
    const loaded = tryLoadRealFla(bytes);
    expect(loaded).not.toBeNull();
    doc = loaded!;
  });

  it("parses two keyframes from the shape tween layer", () => {
    const layer = doc.scenes[0]!.timeline.layers[0]!;
    // Duration 29 + end keyframe of duration 1 = frameCount 30
    expect(layer.frameCount).toBe(30);
    // Exactly two keyframes: start (tweenType=shape) + end (tweenType=none)
    expect(layer.frames.length).toBe(2);
    expect(layer.frames[0]!.index).toBe(0);
    expect(layer.frames[1]!.index).toBe(29);
  });

  it("marks the start keyframe with tweenType=shape", () => {
    const layer = doc.scenes[0]!.timeline.layers[0]!;
    expect(layer.frames[0]!.tweenType).toBe("shape");
    expect(layer.frames[1]!.tweenType).toBe("none");
  });

  it("produces a tween span from getTweenSpans", () => {
    const layer = doc.scenes[0]!.timeline.layers[0]!;
    const spans = getTweenSpans(layer);
    expect(spans.length).toBe(1);
    expect(spans[0]!.tweenType).toBe("shape");
    expect(spans[0]!.startFrame).toBe(0);
    expect(spans[0]!.endFrame).toBe(28);
  });

  it("extracts distinct start and end shape geometry", () => {
    const layer = doc.scenes[0]!.timeline.layers[0]!;
    const startKf = layer.frames[0]!;
    const endKf = layer.frames[1]!;

    expect(startKf.displayObjects.length).toBe(1);
    expect(endKf.displayObjects.length).toBe(1);

    const startShape = startKf.displayObjects[0] as ShapeDisplayObject;
    const endShape = endKf.displayObjects[0] as ShapeDisplayObject;
    expect(startShape.type).toBe("shape");
    expect(endShape.type).toBe("shape");

    // Both shapes are closed quadrilaterals (4 segments each).
    expect(startShape.shape.paths[0]!.closed).toBe(true);
    expect(startShape.shape.paths[0]!.segments.length).toBe(4);
    expect(endShape.shape.paths[0]!.closed).toBe(true);
    expect(endShape.shape.paths[0]!.segments.length).toBe(4);

    // Start and end shapes must have different geometry (otherwise there's no morph).
    const startPt = startShape.shape.paths[0]!.start;
    const endPt = endShape.shape.paths[0]!.start;
    const sameStart =
      Math.abs(startPt.x - endPt.x) < 0.01 && Math.abs(startPt.y - endPt.y) < 0.01;
    expect(sameStart).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Low-level parser entry points
// ---------------------------------------------------------------------------

describe("parseFla8Contents / parseFla8Timeline (low level)", () => {
  it("reads the symbol library table from the Contents stream", () => {
    // Reuse tryLoadRealFla's OLE2 plumbing indirectly: the import test above
    // already proves stream extraction; here just sanity-check the Contents
    // parser against a synthetic empty stream.
    const empty = parseFla8Contents(new Uint8Array(0));
    expect(empty.width).toBeNull();
    expect(empty.frameRate).toBeNull();
    expect(empty.symbols.size).toBe(0);
    expect(empty.sounds.size).toBe(0);
  });

  it("parses a sound entry from a synthetic Contents stream", () => {
    // Build a minimal unicode Contents stream (formatVersion 0x38) that
    // contains a single sound library entry: stream name "Sound 3",
    // display name "boom.mp3".
    //
    // Contents parser scans for UTF-16LE "Sound " preceded by the total
    // stream-name length byte, then reads a BomString for the display name.
    //
    // Layout (all bytes):
    //   [0x38]               formatVersion (>= 0x38 → unicode mode)
    //   [0x07]               length of stream name "Sound 3" in chars (7)
    //   "Sound 3" as UTF-16LE (14 bytes)
    //   FF FE FF 08          BomString header: magic + length (8 chars)
    //   "boom.mp3" as UTF-16LE (16 bytes)

    function utf16le(s: string): number[] {
      const out: number[] = [];
      for (let i = 0; i < s.length; i++) {
        out.push(s.charCodeAt(i) & 0xff, s.charCodeAt(i) >> 8);
      }
      return out;
    }

    const streamName = "Sound 3"; // 7 chars
    const displayName = "boom.mp3"; // 8 chars
    const buf = new Uint8Array([
      0x38,                        // formatVersion
      streamName.length,           // length byte before UTF-16LE stream name
      ...utf16le(streamName),      // "Sound 3" in UTF-16LE
      0xff, 0xfe, 0xff,            // BomString magic
      displayName.length,          // BomString length (8 chars)
      ...utf16le(displayName),     // "boom.mp3" in UTF-16LE
    ]);

    const info = parseFla8Contents(buf);
    expect(info.sounds.size).toBe(1);
    expect(info.sounds.get(3)).toBeDefined();
    expect(info.sounds.get(3)!.name).toBe("boom.mp3");
  });

  it("rejects a non-timeline stream with a descriptive error", () => {
    expect(() => parseFla8Timeline(new Uint8Array([0x42, 0x00, 0x00]))).toThrow(
      /root marker/,
    );
  });

  it("tolerates an unrecognised class tag (0x204) without throwing", () => {
    // Minimal synthetic stream that puts 0x0204 where a class tag is expected
    // inside CPicLayer's children loop. Before this fix the bad tag was
    // thrown as an unhandled Error that propagated all the way through
    // parseFla8Timeline, causing the whole symbol to be discarded.
    //
    // Stream layout:
    //   01            root marker
    //   FFFF 0100 0800 "CPicPage"   new class CPicPage (schema 1)
    //   04 00                       CPicPage CPicObjBase: schema=4, flags=0
    //   FFFF 0100 0900 "CPicLayer"  new class CPicLayer (schema 1)
    //   04 00                       CPicLayer CPicObjBase: schema=4, flags=0
    //   04 02                       *** BAD class tag 0x0204 ***
    //   (zeros pad the stream so skipToNextBoundary can run without EOF)
    const stream = new Uint8Array([
      0x01, // root marker
      // New class: CPicPage
      0xff, 0xff, 0x01, 0x00, 0x08, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x50, 0x61, 0x67, 0x65, // "CPicPage"
      // CPicPage CPicObjBase: schema=4, flags=0
      0x04, 0x00,
      // CPicPage first child: new class CPicLayer
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x4c, 0x61, 0x79, 0x65, 0x72, // "CPicLayer"
      // CPicLayer CPicObjBase: schema=4, flags=0
      0x04, 0x00,
      // *** Bad class tag 0x0204 in CPicLayer's children ***
      0x04, 0x02,
      // Padding zeros so skipToNextBoundary does not immediately hit EOF
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    // Must not throw — symbol should be importable (possibly empty/partial)
    let result: ReturnType<typeof parseFla8Timeline> | null = null;
    expect(() => {
      result = parseFla8Timeline(stream);
    }).not.toThrow();
    expect(result).not.toBeNull();
    // The timeline should have 0 or 1 layers depending on how much was recovered
    expect(result!.layers.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Wave-2: instance onClipEvent handlers + color transforms (task 0705)
//
// The two committed fixtures place plain instances (no clip handlers, identity
// color transform), so these target the FLA-side parsing helpers directly with
// the verbatim block syntax Flash stores in the binary FLA.
// ---------------------------------------------------------------------------

describe("instance onClipEvent extraction (parseClipActions)", () => {
  it("parses a single load handler", () => {
    const actions = parseClipActions('onClipEvent (load) {\n\ttrace("hi");\n}');
    expect(actions).toEqual([{ event: "load", script: 'trace("hi");' }]);
  });

  it("parses multiple handler blocks in one script", () => {
    const src =
      "onClipEvent (load) {\n\tx = 0;\n}\nonClipEvent (enterFrame) {\n\tx += 1;\n}";
    const actions = parseClipActions(src);
    expect(actions.map((a) => a.event)).toEqual(["load", "enterFrame"]);
    expect(actions[0]!.script).toBe("x = 0;");
    expect(actions[1]!.script).toBe("x += 1;");
  });

  it("brace-matches bodies containing nested blocks", () => {
    const src = "onClipEvent (enterFrame) {\n\tif (a) {\n\t\tb();\n\t}\n}";
    const actions = parseClipActions(src);
    expect(actions.length).toBe(1);
    expect(actions[0]!.script).toBe("if (a) {\n\t\tb();\n\t}");
  });

  it("splits a comma-separated event list into one ClipAction per event", () => {
    const actions = parseClipActions("onClipEvent (keyDown, keyUp) {\n\tk();\n}");
    expect(actions.map((a) => a.event)).toEqual(["keyDown", "keyUp"]);
    expect(actions.every((a) => a.script === "k();")).toBe(true);
  });

  it("skips unknown event keywords with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const actions = parseClipActions("onClipEvent (bogus) {\n\tz();\n}");
    expect(actions).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns an empty array for a script with no handlers", () => {
    expect(parseClipActions("stop();")).toEqual([]);
  });
});

describe("instance color transform mapping (toColorEffect)", () => {
  const identity: Fla8ColorEffect = {
    rMult: 256, rOff: 0, gMult: 256, gOff: 0, bMult: 256, bOff: 0, aMult: 256, aOff: 0,
  };

  it("treats an identity transform as no effect", () => {
    expect(toColorEffect(identity)).toBeUndefined();
    expect(toColorEffect(null)).toBeUndefined();
  });

  it("maps a pure-alpha transform to an alpha effect (0..100%)", () => {
    const half = toColorEffect({ ...identity, aMult: 128 });
    expect(half).toEqual({ type: "alpha", alpha: 50 });
  });

  it("maps an RGB multiplier transform to an advanced effect (percent)", () => {
    const eff = toColorEffect({ ...identity, rMult: 128, gMult: 64, bMult: 0 });
    expect(eff).toMatchObject({
      type: "advanced",
      redMult: 50,
      greenMult: 25,
      blueMult: 0,
      redOffset: 0,
      greenOffset: 0,
      blueOffset: 0,
    });
  });

  it("carries channel offsets through on the advanced effect", () => {
    const eff = toColorEffect({ ...identity, rOff: 100, gOff: -50, bOff: 255 });
    expect(eff).toMatchObject({
      type: "advanced",
      redOffset: 100,
      greenOffset: -50,
      blueOffset: 255,
    });
  });
});

// ---------------------------------------------------------------------------
// Wave-3: instance filter mapping (task 0715)
// ---------------------------------------------------------------------------

describe("instance filter mapping (toFlashFilter)", () => {
  const makeDropShadow = (overrides: Partial<Fla8Filter & { kind: "drop-shadow" }> = {}): Fla8Filter => ({
    kind: "drop-shadow",
    r: 0,
    g: 0,
    b: 0,
    a: 166,
    blurX: 4,
    blurY: 4,
    angle: Math.PI / 4,
    distance: 4,
    strength: 1,
    inner: false,
    knockout: false,
    hideObject: false,
    passes: 1,
    ...overrides,
  });

  it("maps a drop-shadow filter with all fields", () => {
    const result = toFlashFilter(makeDropShadow());
    expect(result).not.toBeNull();
    expect(result!.type).toBe("drop-shadow");
    if (result!.type !== "drop-shadow") return;
    expect(result.color).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(result.alpha).toBeCloseTo(166 / 255, 3);
    expect(result.blurX).toBe(4);
    expect(result.blurY).toBe(4);
    expect(result.angle).toBeCloseTo(315, 0); // π/4 rad → 315° after negate+normalise
    expect(result.distance).toBe(4);
    expect(result.strength).toBe(1);
    expect(result.inner).toBe(false);
    expect(result.knockout).toBe(false);
    expect(result.hideObject).toBe(false);
    expect(result.enabled).toBe(true);
  });

  it("maps inner=true and knockout=true on a drop-shadow filter", () => {
    const result = toFlashFilter(makeDropShadow({ inner: true, knockout: true, hideObject: true }));
    if (result!.type !== "drop-shadow") return;
    expect(result.inner).toBe(true);
    expect(result.knockout).toBe(true);
    expect(result.hideObject).toBe(true);
  });

  it("maps a blur filter", () => {
    const f: Fla8Filter = { kind: "blur", blurX: 8, blurY: 6, passes: 2 };
    const result = toFlashFilter(f);
    expect(result!.type).toBe("blur");
    if (result!.type !== "blur") return;
    expect(result.blurX).toBe(8);
    expect(result.blurY).toBe(6);
    expect(result.quality).toBe(2);
    expect(result.enabled).toBe(true);
  });

  it("maps blur passes to quality 3 for 6+ passes", () => {
    const f: Fla8Filter = { kind: "blur", blurX: 4, blurY: 4, passes: 6 };
    const result = toFlashFilter(f);
    if (result!.type !== "blur") return;
    expect(result.quality).toBe(3);
  });

  it("maps a glow filter", () => {
    const f: Fla8Filter = {
      kind: "glow",
      r: 255,
      g: 0,
      b: 0,
      a: 255,
      blurX: 6,
      blurY: 6,
      strength: 2,
      inner: false,
      knockout: false,
      passes: 1,
    };
    const result = toFlashFilter(f);
    expect(result!.type).toBe("glow");
    if (result!.type !== "glow") return;
    expect(result.color).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(result.alpha).toBeCloseTo(1, 3);
    expect(result.strength).toBe(2);
    expect(result.inner).toBe(false);
  });

  it("maps a bevel filter with highlight and shadow colors", () => {
    const f: Fla8Filter = {
      kind: "bevel",
      highlightR: 255,
      highlightG: 255,
      highlightB: 255,
      highlightA: 255,
      shadowR: 0,
      shadowG: 0,
      shadowB: 0,
      shadowA: 255,
      blurX: 4,
      blurY: 4,
      angle: 0.785398,
      distance: 4,
      strength: 1,
      inner: false,
      knockout: false,
      onTop: false,
      passes: 1,
    };
    const result = toFlashFilter(f);
    expect(result!.type).toBe("bevel");
    if (result!.type !== "bevel") return;
    expect(result.highlightColor).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(result.shadowColor).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(result.highlightAlpha).toBeCloseTo(1, 3);
    expect(result.shadowAlpha).toBeCloseTo(1, 3);
    expect(result.enabled).toBe(true);
  });

  it("maps a gradient-glow filter with stops", () => {
    const f: Fla8Filter = {
      kind: "gradient-glow",
      stops: [
        { r: 0, g: 0, b: 0, a: 0, ratio: 0 },
        { r: 255, g: 0, b: 0, a: 255, ratio: 128 },
        { r: 255, g: 255, b: 255, a: 255, ratio: 255 },
      ],
      blurX: 4,
      blurY: 4,
      angle: 0,
      distance: 4,
      strength: 1,
      inner: false,
      knockout: false,
      compositeSource: true,
      onTop: false,
      passes: 1,
    };
    const result = toFlashFilter(f);
    expect(result!.type).toBe("gradientGlow");
    if (result!.type !== "gradientGlow") return;
    expect(result.gradient).toHaveLength(3);
    expect(result.gradient[0]).toMatchObject({ color: "#000000", alpha: 0, ratio: 0 });
    expect(result.gradient[1]).toMatchObject({ color: "#ff0000", alpha: 1, ratio: 128 });
    expect(result.compositeSource).toBe(true);
    expect(result.enabled).toBe(true);
  });

  it("maps a gradient-bevel filter", () => {
    const f: Fla8Filter = {
      kind: "gradient-bevel",
      stops: [
        { r: 0, g: 0, b: 0, a: 255, ratio: 0 },
        { r: 255, g: 255, b: 255, a: 255, ratio: 255 },
      ],
      blurX: 4,
      blurY: 4,
      angle: 0,
      distance: 4,
      strength: 1,
      inner: false,
      knockout: false,
      compositeSource: false,
      onTop: true,
      passes: 1,
    };
    const result = toFlashFilter(f);
    expect(result!.type).toBe("gradientBevel");
    if (result!.type !== "gradientBevel") return;
    expect(result.gradient).toHaveLength(2);
    expect(result.enabled).toBe(true);
  });

  it("maps a color-matrix filter to an identity AdjustColor with enabled=false", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f: Fla8Filter = { kind: "color-matrix", matrix: new Array(20).fill(0) };
    const result = toFlashFilter(f);
    expect(result!.type).toBe("adjustColor");
    if (result!.type !== "adjustColor") return;
    expect(result.enabled).toBe(false);
    warn.mockRestore();
  });

  it("converts -π/4 radians to 45° (Flash UI) correctly", () => {
    // Flash UI 45° CW = -π/4 rad (math CCW). toDegrees(-π/4) = 45° after normalise.
    const result = toFlashFilter(makeDropShadow({ angle: -Math.PI / 4 }));
    if (result!.type !== "drop-shadow") return;
    expect(result.angle).toBeCloseTo(45, 1);
  });
});

// ---------------------------------------------------------------------------
// Frame sound linkage (task 0754)
//
// Verifies that buildFla8Document wires a non-zero soundId in the binary frame
// to a SoundItem in the library and populates Frame.sound correctly.
//
// The test uses two minimal synthetic binary streams:
//
//   Contents stream (27 bytes):
//     Byte 0: format version 0x3F (unicode mode)
//     Bytes 1-14: "Sound 1" as UTF-16LE (the length byte at pos 0 = 0x3F = 63
//       which satisfies the scanner's "lenByte >= 7 and <= 64" range check)
//     Bytes 15-26: BomString FF FE FF 04 + "test" as UTF-16LE → sound name
//
//   Page stream (~106 bytes):
//     A minimal CPicPage → CPicLayer → CPicFrame chain where the CPicFrame
//     carries fs=5 (frame schema 5) with soundId=1. All CPicObjBase children
//     lists and shape bodies are empty; EOF terminates the remaining reads
//     (which are all wrapped in FlaEofError-catching try/catch blocks).
// ---------------------------------------------------------------------------

describe("frame sound linkage (buildFla8Document with in-memory synthetic streams)", () => {
  let doc: FlashDocument;

  beforeAll(() => {
    // --- Contents stream: encodes sound #1 named "test" ---
    // Layout: [version=0x3F] [lenByte=7] ["Sound 1" as UTF-16LE] [BomString "test"]
    //
    // The scanner for sounds looks for the UTF-16 pattern "Sound " in the bytes,
    // then checks bytes[idx-1] as a length byte (must be 7..64 for "Sound 1").
    // We place lenByte=7 immediately before the "Sound 1" pattern at position 2,
    // so bytes[1]=7 satisfies the range check.  The BomString immediately follows
    // the stream name and carries the library display name "test".
    const contentsBytes = new Uint8Array([
      0x3f, // byte 0: format version 0x3F (>= 0x38 → unicode mode)
      0x07, // byte 1: lenByte = 7 (length of "Sound 1")
      // bytes 2-15: "Sound 1" as UTF-16LE (7 chars × 2 = 14 bytes)
      0x53, 0x00, 0x6f, 0x00, 0x75, 0x00, 0x6e, 0x00,
      0x64, 0x00, 0x20, 0x00, 0x31, 0x00,
      // bytes 16-27: BomString FF FE FF <len=4> + "test" as UTF-16LE
      0xff, 0xfe, 0xff, 0x04,
      0x74, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00,
    ]);

    // --- Page stream: CPicPage → CPicLayer → CPicFrame with soundId=1 ---
    // Class table after parsing:
    //   slots 1+2 → CPicPage  (backref 0x8001)
    //   slots 3+4 → CPicLayer (backref 0x8003)
    //   slots 5+6 → CPicFrame (backref 0x8005)
    const pageBytes = new Uint8Array([
      // Root marker
      0x01,
      // New class CPicPage (schema=1, name len=8)
      0xff, 0xff, 0x01, 0x00, 0x08, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x50, 0x61, 0x67, 0x65, // "CPicPage"
      // CPicPage readCPicObjBase: schema=4, flags=0
      0x04, 0x00,
      // CPicPage children: new class CPicLayer (schema=1, name len=9)
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x4c, 0x61, 0x79, 0x65, 0x72, // "CPicLayer"
      // CPicLayer readCPicObjBase: schema=4, flags=0
      0x04, 0x00,
      // CPicLayer children: new class CPicFrame (schema=1, name len=9)
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x46, 0x72, 0x61, 0x6d, 0x65, // "CPicFrame"
      // CPicFrame readCPicObjBase: schema=4, flags=0
      0x04, 0x00,
      // CPicFrame has no children
      0x00, 0x00, // null class tag
      // schema>0: skip 8 bytes (registration point = 2x INT_MIN sentinel)
      0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80,
      // schema>2: skip 1; schema>3: skip 1
      0x00, 0x00,
      // readCPicFrameNode: shapeSchema
      0x00,
      // readMatrix: a=1.0 (16.16 fixed), b=0, c=0, d=1.0, tx=0, ty=0
      0x00, 0x00, 0x01, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x01, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      // readShapeData: schema=0, no fills, no strokes (edge loop skipped)
      0x00,             // shapeData schema=0
      0x00, 0x00, 0x00, 0x00, // edge count hint
      0x00, 0x00,       // fillCount=0
      0x00, 0x00,       // lineCount=0
      // CPicFrame-specific fields (fs=5):
      0x05,             // fs=5
      0x01, 0x00,       // duration=1
      0x00, 0x00,       // keyMode (fs>2)
      0x00, 0x00,       // ease (fs>1)
      0x01, 0x00,       // soundId=1 (fs>4)
      // Stream ends here; remaining reads (CPicLayer body, repositionAfterLayerTrailer,
      // CPicPage body) all hit EOF and are caught by FlaEofError try/catch.
    ]);

    const streams = new Map<string, Uint8Array>([
      ["contents", contentsBytes],
      ["Page 1",   pageBytes],
    ]);
    const result = buildFla8Document(streams);
    expect(result).not.toBeNull();
    doc = result!;
  });

  it("creates a SoundItem in the library for the referenced sound", () => {
    const soundItems = doc.library.items.filter((i): i is SoundItem => i.itemType === "sound");
    expect(soundItems).toHaveLength(1);
    expect(soundItems[0]!.name).toBe("test");
  });

  it("populates Frame.sound with the correct libraryItemId", () => {
    const soundItems = doc.library.items.filter((i): i is SoundItem => i.itemType === "sound");
    const soundId = soundItems[0]!.id;
    const frame = doc.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.sound).not.toBeNull();
    expect(frame.sound!.libraryItemId).toBe(soundId);
  });

  it("uses event sync mode when soundSync field is absent (fs=5 has no soundSync)", () => {
    const frame = doc.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.sound!.syncMode).toBe("event");
  });

  it("uses repeatCount=1 when soundLoop field is absent (fs=5 has no soundLoop)", () => {
    const frame = doc.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.sound!.repeatCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Wave-4: frame sound attachment wiring (task 0754)
// ---------------------------------------------------------------------------

describe("frame sound wiring (buildFla8Document)", () => {
  it("creates a SoundItem in the library for each sound in the Contents stream", () => {
    // Construct a synthetic unicode Contents stream (formatVersion 0x38) that
    // declares one sound: stream name "Sound 3", display name "boom.mp3".
    function utf16le(s: string): number[] {
      const out: number[] = [];
      for (let i = 0; i < s.length; i++) {
        out.push(s.charCodeAt(i) & 0xff, s.charCodeAt(i) >> 8);
      }
      return out;
    }
    const contentsBytes = new Uint8Array([
      0x38,                  // formatVersion (unicode)
      0x07,                  // length of stream name "Sound 3" (7 chars)
      ...utf16le("Sound 3"), // stream name in UTF-16LE
      0xff, 0xfe, 0xff,      // BomString magic
      0x08,                  // display name length (8 chars)
      ...utf16le("boom.mp3"),// display name in UTF-16LE
    ]);

    // A trivially-invalid Page stream will cause parseFla8Timeline to throw
    // (caught and warned), resulting in a fallback empty scene — but the sound
    // library items are built before scene parsing so they appear in the output.
    const streams = new Map<string, Uint8Array>([
      ["Contents", contentsBytes],
      ["Page 1", new Uint8Array([0x00])], // invalid; causes graceful fallback
    ]);

    const doc = buildFla8Document(streams);
    expect(doc).not.toBeNull();

    const soundItems = doc!.library.items.filter(
      (i): i is SoundItem => i.itemType === "sound"
    );
    expect(soundItems.length).toBe(1);
    expect(soundItems[0]!.name).toBe("boom.mp3");
  });
});

// ---------------------------------------------------------------------------
// parseButtonHandlers unit tests
// ---------------------------------------------------------------------------

describe("parseButtonHandlers", () => {
  it("parses a single on(release) handler", () => {
    const src = `on(release) { gotoAndStop(2); }`;
    const handlers = parseButtonHandlers(src);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]!.event).toBe("release");
    expect(handlers[0]!.script).toBe("gotoAndStop(2);");
  });

  it("parses multiple distinct handlers", () => {
    const src = `on(press) { play(); }\non(release) { stop(); }`;
    const handlers = parseButtonHandlers(src);
    expect(handlers).toHaveLength(2);
    expect(handlers[0]!.event).toBe("press");
    expect(handlers[0]!.script).toBe("play();");
    expect(handlers[1]!.event).toBe("release");
    expect(handlers[1]!.script).toBe("stop();");
  });

  it("splits comma-separated events into separate handlers", () => {
    const src = `on(rollOver, rollOut) { trace("hover"); }`;
    const handlers = parseButtonHandlers(src);
    expect(handlers).toHaveLength(2);
    expect(handlers[0]!.event).toBe("rollOver");
    expect(handlers[1]!.event).toBe("rollOut");
    expect(handlers[0]!.script).toBe(`trace("hover");`);
    expect(handlers[1]!.script).toBe(`trace("hover");`);
  });

  it("handles nested braces in handler body", () => {
    const src = `on(release) { if (x) { gotoAndStop(2); } }`;
    const handlers = parseButtonHandlers(src);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]!.script).toBe("if (x) { gotoAndStop(2); }");
  });

  it("skips unknown event names with a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const src = `on(bogusEvent) { stop(); }`;
    const handlers = parseButtonHandlers(src);
    expect(handlers).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("bogusEvent")
    );
    warnSpy.mockRestore();
  });

  it("returns empty array for empty input", () => {
    expect(parseButtonHandlers("")).toHaveLength(0);
    expect(parseButtonHandlers("   ")).toHaveLength(0);
  });

  it("recognises all valid button event names", () => {
    const events = ["press", "release", "releaseOutside", "rollOut", "rollOver", "dragOut", "dragOver"];
    for (const ev of events) {
      const handlers = parseButtonHandlers(`on(${ev}) { trace("ok"); }`);
      expect(handlers).toHaveLength(1);
      expect(handlers[0]!.event).toBe(ev);
    }
  });
});
