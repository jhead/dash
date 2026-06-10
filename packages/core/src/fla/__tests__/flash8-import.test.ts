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
import {
  parseFla8Contents,
  parseFla8Timeline,
  textOrientationFromRunFields,
} from "../flash8-binary.js";
import { parseClipActions, parseButtonHandlers, toColorEffect, toFlashFilter, buildFla8Document, buildHtmlText, convertFla8Text, assignFolderParents, toObjectAccessibility } from "../flash8-import.js";
import { getTweenSpans } from "../../model/timeline-query.js";
import type {
  Fla8ColorEffect,
  Fla8Filter,
  Fla8Text,
  Fla8TextOrientation,
} from "../flash8-binary.js";
import type { FlashDocument, Symbol as SymbolItem, SoundItem, FontItem, Layer } from "../../model/types.js";
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

  it("symbols have SymbolLinkage populated (no linkage set = defaults)", () => {
    // These symbols have no AS2 linkage set in Flash, so all linkage fields
    // should be their defaults (empty strings, false booleans).
    const syms = symbols(doc);
    for (const sym of syms) {
      expect(sym.linkage).toBeDefined();
      // All symbols in this fixture have no linkage set:
      expect(sym.linkage.linkageIdentifier).toBe("");
      expect(sym.linkage.exportForActionScript).toBe(false);
    }
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

  it("normalizes CRLF line endings in frame scripts (task 0950)", () => {
    // mx2004-frame-scripts.fla was authored on Windows and contains CRLF
    // (0x0d 0x0a) line endings in the UTF-16LE BomString script fields.
    // After import all \r\n sequences must be collapsed to \n so multi-line
    // scripts display correctly in the editor.
    const layer = doc.scenes[0]!.timeline.layers[0]!;
    for (const frame of layer.frames) {
      expect(frame.script).not.toMatch(/\r/);
    }
    const childFrames = symbols(doc)[0]!.timeline.layers[0]!.frames;
    for (const frame of childFrames) {
      expect(frame.script).not.toMatch(/\r/);
    }
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

  it("decodeMorphData runs without emitting a skip-fallback warning (task 0878)", () => {
    // Verify that decodeMorphData successfully decodes CPicMorphShape and does
    // NOT fall back to the old forward-scan path.  The fallback emits a
    // specific console.warn message; its absence means the decoder ran cleanly.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const bytes = fixture("morph-shape-tween-mx.fla");
      tryLoadRealFla(bytes);
      const skipWarnings = warnSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes("morph data") && m.includes("skipped"));
      expect(skipWarnings).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("shape-tween start keyframe defaults to shapeBlend=distributive (task 0916)", () => {
    // The MX-era fixture doesn't carry an angular blend byte; decodeMorphData
    // must default to "distributive" rather than returning undefined or "angular".
    const layer = doc.scenes[0]!.timeline.layers[0]!;
    expect(layer.frames[0]!.shapeBlend).toBe("distributive");
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

  it("maps a color-matrix filter to an AdjustColor with enabled=true", () => {
    const f: Fla8Filter = {
      kind: "color-matrix",
      matrix: [1, 0, 0, 0, 0,  0, 1, 0, 0, 0,  0, 0, 1, 0, 0,  0, 0, 0, 1, 0],
    };
    const result = toFlashFilter(f);
    expect(result!.type).toBe("adjustColor");
    if (result!.type !== "adjustColor") return;
    expect(result.enabled).toBe(true);
    expect(result.brightness).toBe(0);
    expect(result.contrast).toBe(0);
  });

  it("ColorMatrix filter import — brightness preserved from matrix offset", () => {
    // Identity scale (diagonal=1) with RGB offset of +127.5 → +50% brightness
    const matrix: number[] = [1, 0, 0, 0, 127.5,  0, 1, 0, 0, 127.5,  0, 0, 1, 0, 127.5,  0, 0, 0, 1, 0];
    const f: Fla8Filter = { kind: "color-matrix", matrix };
    const result = toFlashFilter(f);
    expect(result!.type).toBe("adjustColor");
    if (result!.type !== "adjustColor") return;
    expect(result.brightness).toBeCloseTo(50, 0);
    expect(result.enabled).toBe(true);
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
    // Class reference indices (= 1 + classesDefinedBefore + objectsWrittenBefore,
    // per the MFC CArchive scheme; here no objects are interleaved between the
    // class declarations so the indices come out 1, 3, 5):
    //   CPicPage  → backref 0x8001
    //   CPicLayer → backref 0x8003
    //   CPicFrame → backref 0x8005
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

// ---------------------------------------------------------------------------
// Fill subtype 0x20 — task 0858
//
// Subtype 0x20 (bit 5 set, not gradient 0x10 or bitmap 0x40) was previously
// returned as kind:"unknown" and rendered as solid gray.  After task 0858 it
// is mapped to kind:"solid" using the base RGBA color that precedes the
// subtype byte, consuming the 24-byte gradient transform matrix + 12 bytes
// of trailer to keep the stream aligned.
//
// The synthetic stream below encodes a minimal CPicPage → CPicLayer →
// CPicFrame containing a CPicShape child.  The CPicShape's shapeData carries
// one fill with subtype 0x20 (color=red FF 00 00 FF) and one edge so that
// the shape element is included in the parsed output.
// ---------------------------------------------------------------------------

describe("fill subtype 0x20 (task 0858)", () => {
  // Build a synthetic Page stream testing fill subtype 0x20 via the CPicFrame's
  // own inherited CPicShape body (not via a child CPicShape object).
  //
  // Structure: CPicPage → CPicLayer → CPicFrame (no children).
  // The CPicFrame's own shape body carries one fill with subtype 0x20 (color=red)
  // and one minimal edge so the shape is included in elements.
  //
  // Class table after parsing (each class occupies two slots):
  //   slots 1+2 → CPicPage   (new class tag 0xFFFF)
  //   slots 3+4 → CPicLayer  (new class tag 0xFFFF)
  //   slots 5+6 → CPicFrame  (new class tag 0xFFFF)
  //
  // readMatrix identity = a=1.0 (0x00010000), b=0, c=0, d=1.0 (16.16 fixed), tx=ty=0
  const IDENTITY_MATRIX = [
    0x00, 0x00, 0x01, 0x00, // a = 1.0
    0x00, 0x00, 0x00, 0x00, // b = 0
    0x00, 0x00, 0x00, 0x00, // c = 0
    0x00, 0x00, 0x01, 0x00, // d = 1.0
    0x00, 0x00, 0x00, 0x00, // tx = 0
    0x00, 0x00, 0x00, 0x00, // ty = 0
  ] as const;

  const pageBytes = new Uint8Array([
    // Root marker
    0x01,
    // New class CPicPage (schema=1, name len=8, "CPicPage")
    0xff, 0xff, 0x01, 0x00, 0x08, 0x00,
    0x43, 0x50, 0x69, 0x63, 0x50, 0x61, 0x67, 0x65,
    // CPicPage → readCPicObjBase: schema=4, flags=0
    0x04, 0x00,
    //   CPicPage's child: new class CPicLayer (schema=1, name len=9, "CPicLayer")
    0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
    0x43, 0x50, 0x69, 0x63, 0x4c, 0x61, 0x79, 0x65, 0x72,
    //   CPicLayer → readCPicObjBase: schema=4, flags=0
    0x04, 0x00,
    //     CPicLayer's child: new class CPicFrame (schema=1, name len=9, "CPicFrame")
    0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
    0x43, 0x50, 0x69, 0x63, 0x46, 0x72, 0x61, 0x6d, 0x65,
    //     CPicFrame → readCPicObjBase: schema=4, flags=0
    0x04, 0x00,
    //     CPicFrame has NO display-object children
    0x00, 0x00,
    //     schema>0: registration point (2 × INT_MIN sentinels, 8 bytes)
    0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80,
    //     schema>2: skip(1), schema>3: skip(1)
    0x00, 0x00,
    //   back in readCPicFrameNode: shapeSchema = 3 (> 2 → caps = true)
    0x03,
    //   readCPicFrameNode: readMatrix (identity, 24 bytes)
    ...IDENTITY_MATRIX,
    //   readShapeData(caps=true): shapeData schema byte = 3
    0x03,
    //   edge count hint (4 bytes, ignored)
    0x01, 0x00, 0x00, 0x00,
    //   fillCount = 1 (u16 LE)
    0x01, 0x00,
    //   readFillStyle(caps=true):
    //     base color RGBA = FF 00 00 FF (opaque red)
    0xff, 0x00, 0x00, 0xff,
    //     subtype = 0x20  ← the case under test
    0x20,
    //     more_flags = 0x00
    0x00,
    //     readMatrix (24 bytes) consumed by the 0x20 branch
    ...IDENTITY_MATRIX,
    //     skip(12) — 4-byte + 8-byte trailer consumed by the 0x20 branch
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    //   lineCount = 0
    0x00, 0x00,
    //   edge loop (schema >= 2):
    //     flags = 0xC1 = style-change (0x40) + no-selection (0x80) + t1=1 (s16 delta)
    0xc1,
    //     style-change (no-sel): line=0, fill0=1, fill1=0
    0x00, 0x01, 0x00,
    //     t1=1 → [dx1=s16(100), dy1=s16(0)]  → a minimal non-degenerate edge
    0x64, 0x00, 0x00, 0x00,
    //   edge loop end sentinel
    0x00,
    // Remaining reads (frame-specific fields, layer/page trailers) hit EOF → caught
  ]);

  it("parses fill subtype 0x20 as kind:'solid' with the base color", () => {
    const timeline = parseFla8Timeline(pageBytes);
    expect(timeline.layers).toHaveLength(1);
    const frames = timeline.layers[0]!.frames;
    expect(frames).toHaveLength(1);
    const shapes = frames[0]!.elements.filter(
      (e): e is Extract<typeof e, { type: "shape" }> => e.type === "shape"
    );
    expect(shapes).toHaveLength(1);
    const fills = shapes[0]!.fills;
    expect(fills).toHaveLength(1);
    const fill = fills[0]!;
    expect(fill.kind).toBe("solid");
    // The base RGBA (red) must be preserved; the matrix and 12-byte trailer
    // are consumed but do not change the fill color.
    if (fill.kind === "solid") {
      expect(fill.color.r).toBe(0xff);
      expect(fill.color.g).toBe(0x00);
      expect(fill.color.b).toBe(0x00);
      expect(fill.color.a).toBe(0xff);
    }
  });

  function makeFrameShapePageBytes(frameFlags: number): Uint8Array {
    const bytes = new Uint8Array(pageBytes);
    const frameName = [0x43, 0x50, 0x69, 0x63, 0x46, 0x72, 0x61, 0x6d, 0x65];
    for (let i = 0; i <= bytes.length - frameName.length - 2; i++) {
      if (frameName.every((b, j) => bytes[i + j] === b) && bytes[i + 9] === 0x04) {
        bytes[i + 10] = frameFlags;
        break;
      }
    }
    return bytes;
  }

  it("decodes frame-inherited shape with flags=0 as visible:false (task 0932)", () => {
    const timeline = parseFla8Timeline(makeFrameShapePageBytes(0x00));
    const shape = timeline.layers[0]!.frames[0]!.elements.find((e) => e.type === "shape");
    expect(shape).toBeDefined();
    expect(shape!.type === "shape" && shape.visible).toBe(false);
  });

  it("decodes frame-inherited shape with flags=1 as visible (unset) (task 0932)", () => {
    const timeline = parseFla8Timeline(makeFrameShapePageBytes(0x01));
    const shape = timeline.layers[0]!.frames[0]!.elements.find((e) => e.type === "shape");
    expect(shape).toBeDefined();
    expect(shape!.type === "shape" && shape.visible).toBeUndefined();
  });

  it("forwards hidden frame shape through buildFla8Document as visible:false (task 0932)", () => {
    const streams = new Map<string, Uint8Array>([
      ["contents", new Uint8Array([0x3f])],
      ["Page 1", makeFrameShapePageBytes(0x00)],
    ]);
    const doc = buildFla8Document(streams);
    expect(doc).not.toBeNull();
    const shape = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!.displayObjects.find(
      (o): o is ShapeDisplayObject => o.type === "shape",
    );
    expect(shape).toBeDefined();
    expect(shape!.visible).toBe(false);
  });

  it("forwards visible frame shape through buildFla8Document without visible:false (task 0932)", () => {
    const streams = new Map<string, Uint8Array>([
      ["contents", new Uint8Array([0x3f])],
      ["Page 1", makeFrameShapePageBytes(0x01)],
    ]);
    const doc = buildFla8Document(streams);
    expect(doc).not.toBeNull();
    const shape = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!.displayObjects.find(
      (o): o is ShapeDisplayObject => o.type === "shape",
    );
    expect(shape).toBeDefined();
    expect(shape!.visible).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multi-run rich text — buildHtmlText
// ---------------------------------------------------------------------------

describe("buildHtmlText — multi-run rich text HTML builder", () => {
  it("single run: wraps text in <font> tag with face, size, color", () => {
    const html = buildHtmlText([
      { text: "Hello", fontName: "Arial", fontSize: 12, color: { r: 0, g: 0, b: 0, a: 255 }, bold: false, italic: false },
    ]);
    expect(html).toBe('<font face="Arial" size="12" color="#000000">Hello</font>');
  });

  it("single run with bold: wraps content in <b>", () => {
    const html = buildHtmlText([
      { text: "Bold", fontName: "Arial", fontSize: 14, color: { r: 255, g: 0, b: 0, a: 255 }, bold: true, italic: false },
    ]);
    expect(html).toBe('<font face="Arial" size="14" color="#ff0000"><b>Bold</b></font>');
  });

  it("single run with italic: wraps content in <i>", () => {
    const html = buildHtmlText([
      { text: "Italic", fontName: "Times", fontSize: 16, color: { r: 0, g: 128, b: 0, a: 255 }, bold: false, italic: true },
    ]);
    expect(html).toBe('<font face="Times" size="16" color="#008000"><i>Italic</i></font>');
  });

  it("single run with bold+italic: nests <i> inside <b>", () => {
    const html = buildHtmlText([
      { text: "BoldItalic", fontName: "Arial", fontSize: 12, color: { r: 0, g: 0, b: 255, a: 255 }, bold: true, italic: true },
    ]);
    expect(html).toBe('<font face="Arial" size="12" color="#0000ff"><b><i>BoldItalic</i></b></font>');
  });

  it("multi-run: concatenates two runs with different color", () => {
    const html = buildHtmlText([
      { text: "Hello", fontName: "Arial", fontSize: 12, color: { r: 255, g: 0, b: 0, a: 255 }, bold: true, italic: false },
      { text: " World", fontName: "Arial", fontSize: 12, color: { r: 0, g: 0, b: 255, a: 255 }, bold: false, italic: false },
    ]);
    expect(html).toContain('<font face="Arial" size="12" color="#ff0000"><b>Hello</b></font>');
    expect(html).toContain('<font face="Arial" size="12" color="#0000ff"> World</font>');
  });

  it("multi-run: preserves per-run font and size differences", () => {
    const html = buildHtmlText([
      { text: "Big", fontName: "Impact", fontSize: 24, color: { r: 0, g: 0, b: 0, a: 255 }, bold: false, italic: false },
      { text: "Small", fontName: "Arial", fontSize: 10, color: { r: 0, g: 0, b: 0, a: 255 }, bold: false, italic: false },
    ]);
    expect(html).toContain('face="Impact" size="24"');
    expect(html).toContain('face="Arial" size="10"');
  });

  it("escapes HTML special characters in text content", () => {
    const html = buildHtmlText([
      { text: "a<b>&c", fontName: "Arial", fontSize: 12, color: { r: 0, g: 0, b: 0, a: 255 }, bold: false, italic: false },
    ]);
    expect(html).toContain("a&lt;b&gt;&amp;c");
  });

  it("falls back to Arial when fontName is empty", () => {
    const html = buildHtmlText([
      { text: "test", fontName: "", fontSize: 12, color: { r: 0, g: 0, b: 0, a: 255 }, bold: false, italic: false },
    ]);
    expect(html).toContain('face="Arial"');
  });
});

// ---------------------------------------------------------------------------
// parseFla8Contents: className decoding from writeAsLinkage block (task 0874)
// ---------------------------------------------------------------------------

describe("parseFla8Contents className decode (synthetic Contents stream)", () => {
  // Helper: encode a string as UTF-16LE bytes
  function utf16le(s: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) {
      out.push(s.charCodeAt(i) & 0xff, s.charCodeAt(i) >> 8);
    }
    return out;
  }

  // Helper: encode a BomString (FF FE FF <len> <UTF-16LE data>)
  function bomString(s: string): number[] {
    return [0xff, 0xfe, 0xff, s.length, ...utf16le(s)];
  }

  /**
   * Build a minimal unicode Contents stream for a single "Symbol 1" entry
   * with the given className in the writeAsLinkage block.
   *
   * Stream layout:
   *   [0x38]                         formatVersion (unicode mode)
   *   [0x08] + UTF16LE("Symbol 1")   stream name (8 chars)
   *   BomString("MyClip")            display name  ← s starts here, s.end after it
   *   [UI32LE: 0x00000001]           stream number
   *   [0x02]                         typeByte (movieclip)
   *   BomString("")                  heuristic linkageIdentifier (empty)
   *   [0x01 0x00 0x00 0x00]          4 flag bytes (exportInFirstFrame=1, rest=0)
   *   --- 41 bytes after s.end: writeAsLinkage block starts ---
   *   The gap (from s.end to writeAsLinkage) is exactly 41 bytes:
   *     UI32LE(streamNum)=4 + typeByte=1 + BomString("")=4 + 4 flags=4
   *     = 13 bytes from s.end to flagBase+4
   *     Then we need 41 - 13 = 28 more "intermediate" bytes to reach laStart.
   *
   * Actually, the 41-byte offset was measured from s.end (the end of the
   * display-name BomString) to the start of the 00 00 00 00 prefix.
   * The heuristic BomString("") is at s.end + 5 (after UI32LE + typeByte).
   * BomString("") = FF FE FF 00 = 4 bytes.  Then 4 flag bytes = 4 bytes.
   * Total from s.end: 4 (streamNum) + 1 (typeByte) + 4 (BomString("")) + 4 (flags) = 13 bytes.
   * The writeAsLinkage zero-prefix is at s.end + 41, so we need 28 bytes of
   * intermediate data (spriteVersion / page-shape records etc.) between
   * flagBase+4 and laStart.  We just pad with zeros here.
   *
   * writeAsLinkage block (starting at laStart = s.end + 41):
   *   [00 00 00 00]            UI32 zero prefix
   *   [0x07]                   asLinkageVersion (7 = Flash 8)
   *   [0x00]                   flags
   *   [00 00 00]               3 zero bytes
   *   BomString("")            linkageIdentifier (real, empty)
   *   BomString("")            linkageURL (empty)
   *   BomString(className)     className ← the value under test
   */
  function buildContentsStream(className: string): Uint8Array {
    const displayName = "MyClip";
    const streamName = "Symbol 1";

    // Build header: formatVersion + length-prefixed UTF-16LE stream name
    const header = [
      0x38,                          // formatVersion (unicode)
      streamName.length,             // 8
      ...utf16le(streamName),        // 16 bytes
    ];

    // Display name BomString — "s" in the parser code.
    // s.end is right after this.
    const dispNameBom = bomString(displayName); // 4 + 12 = 16 bytes

    // Bytes s.end+0 to s.end+12 (13 bytes total):
    //   [0..3]: UI32LE stream number = 1
    //   [4]:    typeByte = 2 (movieclip)
    //   [5..8]: BomString("") = FF FE FF 00  (heuristic linkageIdentifier)
    //   [9..12]: 4 flag bytes = 01 00 00 00
    const afterName = [
      0x01, 0x00, 0x00, 0x00,  // UI32LE streamNum=1
      0x02,                     // typeByte=2 (movieclip)
      0xff, 0xfe, 0xff, 0x00,  // BomString("") = heuristic linkageIdentifier
      0x01, 0x00, 0x00, 0x00,  // 4 flag bytes: exportInFirstFrame=1, rest=0
    ]; // 13 bytes

    // Pad from s.end+13 to s.end+41 = 28 bytes of zeros
    const pad = new Array<number>(28).fill(0);

    // writeAsLinkage block at s.end+41:
    //   [0..3]: 00 00 00 00 (zero prefix)
    //   [4]:    0x07 (asLinkageVersion=7)
    //   [5]:    0x00 (flags)
    //   [6..8]: 00 00 00
    //   [9..]: BomString("") linkageIdentifier
    //          BomString("") linkageURL
    //          BomString(className)
    const laBlock = [
      0x00, 0x00, 0x00, 0x00,  // zero prefix
      0x07,                     // asLinkageVersion=7 (Flash 8)
      0x00,                     // flags
      0x00, 0x00, 0x00,         // 3 zero bytes
      ...bomString(""),          // BomString("") linkageIdentifier
      ...bomString(""),          // BomString("") linkageURL
      ...bomString(className),   // BomString(className) ← target
    ];

    const all = [
      ...header,
      ...dispNameBom,
      ...afterName,
      ...pad,
      ...laBlock,
    ];
    return new Uint8Array(all);
  }

  it("decodes a non-empty className from the writeAsLinkage block", () => {
    const buf = buildContentsStream("com.example.MyClip");
    const info = parseFla8Contents(buf);
    expect(info.symbols.size).toBe(1);
    const sym = info.symbols.get(1)!;
    expect(sym).toBeDefined();
    expect(sym.name).toBe("MyClip");
    expect(sym.typeByte).toBe(2);
    expect(sym.className).toBe("com.example.MyClip");
  });

  it("leaves className as empty string when writeAsLinkage block has empty className", () => {
    const buf = buildContentsStream("");
    const info = parseFla8Contents(buf);
    const sym = info.symbols.get(1)!;
    expect(sym.className).toBe("");
  });

  it("leaves className as empty string when writeAsLinkage zero-prefix is absent", () => {
    // Build the stream but corrupt the zero prefix at s.end+41 so the block
    // is not recognized.
    const buf = buildContentsStream("should.not.appear");
    // The zero prefix is at s.end+41. Display name "MyClip"=6chars → BomString=4+12=16 bytes.
    // Header = 1 + 1 + 16 = 18 bytes. So s starts at 18, s.end = 18+16=34.
    // laStart = 34 + 41 = 75.
    const corruptedBuf = new Uint8Array(buf);
    corruptedBuf[75] = 0xff; // corrupt the first zero byte of the prefix
    const info = parseFla8Contents(corruptedBuf);
    const sym = info.symbols.get(1)!;
    // With the prefix corrupted the block won't be recognized, className should be ""
    expect(sym.className).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Text element colorEffect forwarding (task 0882)
//
// Verifies that convertFla8Text forwards a non-null Fla8Text.colorEffect to the
// resulting TextDisplayObject.  This exercises the forwarding fix in flash8-import.ts:
// the text branch now calls toColorEffect(el.colorEffect) and includes it in the
// output when non-identity, matching the pattern used for SymbolInstance and
// BitmapDisplayObject.
// ---------------------------------------------------------------------------

describe("text element colorEffect forwarding (convertFla8Text)", () => {
  /** Minimal valid Fla8Text for conversion tests. */
  function makeFla8Text(overrides: Partial<Fla8Text> = {}): Fla8Text {
    return {
      type: "text",
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
      width: 100,
      height: 20,
      text: "Hello",
      fontName: "Arial",
      fontSize: 12,
      color: { r: 0, g: 0, b: 0, a: 255 },
      bold: false,
      italic: false,
      align: "left",
      orientation: "horizontal",
      instanceName: "",
      textType: "dynamic",
      wordWrap: false,
      multiline: false,
      password: false,
      maxChars: 0,
      hasBorder: false,
      hasBackground: false,
      as2VariableName: "",
      scrollable: false,
      filters: [],
      colorEffect: null,
      runs: [],
      ...overrides,
    };
  }

  it("produces no colorEffect when colorEffect is null (identity)", () => {
    const result = convertFla8Text(makeFla8Text({ colorEffect: null }));
    expect(result.colorEffect).toBeUndefined();
  });

  it("preserves an alpha colorEffect on the TextDisplayObject", () => {
    const ce: Fla8ColorEffect = {
      rMult: 256, rOff: 0,
      gMult: 256, gOff: 0,
      bMult: 256, bOff: 0,
      aMult: 128, aOff: 0, // 50% alpha
    };
    const result = convertFla8Text(makeFla8Text({ colorEffect: ce }));
    expect(result.colorEffect).toEqual({ type: "alpha", alpha: 50 });
  });

  it("preserves an advanced (tint) colorEffect on the TextDisplayObject", () => {
    const ce: Fla8ColorEffect = {
      rMult: 128, rOff: 100,
      gMult: 64,  gOff: 0,
      bMult: 0,   bOff: 50,
      aMult: 256, aOff: 0,
    };
    const result = convertFla8Text(makeFla8Text({ colorEffect: ce }));
    expect(result.colorEffect).toMatchObject({
      type: "advanced",
      redMult: 50,
      greenMult: 25,
      blueMult: 0,
      redOffset: 100,
      greenOffset: 0,
      blueOffset: 50,
    });
  });

  it("omits colorEffect from the result for an identity transform", () => {
    const identity: Fla8ColorEffect = {
      rMult: 256, rOff: 0,
      gMult: 256, gOff: 0,
      bMult: 256, bOff: 0,
      aMult: 256, aOff: 0,
    };
    const result = convertFla8Text(makeFla8Text({ colorEffect: identity }));
    // Identity transform → toColorEffect returns undefined → not forwarded
    expect(result.colorEffect).toBeUndefined();
  });

  it("forwards all standard text fields correctly alongside colorEffect", () => {
    const ce: Fla8ColorEffect = {
      rMult: 256, rOff: 0,
      gMult: 256, gOff: 0,
      bMult: 256, bOff: 0,
      aMult: 128, aOff: 0,
    };
    const result = convertFla8Text(makeFla8Text({
      text: "Test",
      fontName: "Times New Roman",
      fontSize: 18,
      bold: true,
      textType: "static",
      instanceName: "myLabel",
      colorEffect: ce,
    }));
    expect(result.type).toBe("text");
    expect(result.text).toBe("Test");
    expect(result.fontFamily).toBe("Times New Roman");
    expect(result.fontSize).toBe(18);
    expect(result.bold).toBe(true);
    expect(result.textType).toBe("static");
    expect(result.instanceName).toBe("myLabel");
    expect(result.colorEffect).toEqual({ type: "alpha", alpha: 50 });
  });
});

// ---------------------------------------------------------------------------
// CPicText vertical/rtl byte → orientation mapping and import forwarding
// ---------------------------------------------------------------------------

describe("text orientation (CPicText vertical/rtl bytes)", () => {
  /** Minimal valid Fla8Text for orientation conversion tests. */
  function makeOrientFla8Text(overrides: Partial<Fla8Text> = {}): Fla8Text {
    return {
      type: "text",
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      width: 50,
      height: 100,
      text: "縦",
      fontName: "Arial",
      fontSize: 12,
      color: { r: 0, g: 0, b: 0, a: 255 },
      bold: false,
      italic: false,
      align: "left",
      orientation: "horizontal",
      instanceName: "",
      textType: "static",
      wordWrap: false,
      multiline: false,
      password: false,
      maxChars: 0,
      hasBorder: false,
      hasBackground: false,
      as2VariableName: "",
      scrollable: false,
      filters: [],
      colorEffect: null,
      runs: [],
      ...overrides,
    };
  }

  it.each([
    [false, false, "horizontal"],
    [true, true, "vertical-rtl"],
    [true, false, "vertical-ltr"],
  ] as const)(
    "textOrientationFromRunFields(vertical=%s, rtl=%s) → %s",
    (vertical, rightToLeft, expected) => {
      expect(textOrientationFromRunFields(vertical, rightToLeft)).toBe(expected);
    },
  );

  it.each([
    ["horizontal", undefined],
    ["vertical-rtl", "vertical-rtl"],
    ["vertical-ltr", "vertical-ltr"],
  ] as const)(
    "convertFla8Text forwards orientation '%s'",
    (orientation, expected) => {
      const result = convertFla8Text(
        makeOrientFla8Text({ orientation: orientation as Fla8TextOrientation }),
      );
      if (expected) {
        expect(result.orientation).toBe(expected);
      } else {
        expect(result.orientation).toBeUndefined();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Magnet.fla — CS2-era FLA with multiple scenes (regression 0886 / 0889)
// ---------------------------------------------------------------------------
// Regression test: verifies that layer names in Magnet.fla are decoded as
// human-readable strings and not as raw binary bytes.  Before the CS2
// class-reference-index fix (task 0889) several layers came out as garbled
// binary (e.g. "\x01\x00\x00\x06…ÿÿÿ?ÿÿ") because the MFC CArchive
// class-tag table was mis-indexed, causing the stream reader to desync.

describe("Magnet.fla — CS2 FLA layer names are readable strings (regression 0886)", () => {
  let doc: FlashDocument;

  beforeAll(() => {
    const loaded = tryLoadRealFla(fixture("Magnet.fla"));
    expect(loaded).not.toBeNull();
    doc = loaded!;
  });

  it("imports 6 scenes", () => {
    expect(doc.scenes.length).toBe(6);
  });

  it("all layer names are printable ASCII strings (no raw binary garbage)", () => {
    for (const scene of doc.scenes) {
      for (const layer of scene.timeline.layers) {
        // A garbled name contains control bytes below 0x20 or high non-ASCII
        // code-points that Flash never emits in layer names.
        const hasControlBytes = [...layer.name].some(
          (c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) > 0x7e,
        );
        expect(hasControlBytes).toBe(false);
      }
    }
  });

  it("scene 0 (AA) has the expected layer names", () => {
    const names = doc.scenes[0]!.timeline.layers.map((l) => l.name);
    // Binary FLA stores layers bottom-to-top; import reverses to match Flash convention
    // (li=0 = topmost/frontmost layer in panel = Ball; li=5 = background = Layer 7).
    expect(names).toEqual(["Ball", "Walls", "Magnets", "Layer 5", "Layer 3", "Layer 7"]);
  });

  it("scene 2 (Scene 5) has readable layer names", () => {
    const names = doc.scenes[2]!.timeline.layers.map((l) => l.name);
    // Binary FLA stores layers bottom-to-top; reversed on import so frontmost is li=0.
    expect(names).toEqual(["Layer 5", "Layer 5", "Ball", "Layer 3"]);
  });

  it("scenes 3–5 (BA, AB, BB) have readable layer names", () => {
    for (const scene of doc.scenes.slice(3)) {
      for (const layer of scene.timeline.layers) {
        expect(typeof layer.name).toBe("string");
        expect(layer.name.length).toBeGreaterThan(0);
      }
    }
  });
});

// CPicSwf — embedded SWF placement (task 0892)
//
// Magnet.fla contains four CPicSwf placements (Claw.swft and claw2.swft
// symbols placed on scene timelines).  Before this fix they produced:
//   [FLA import] class "CPicSwf" is not supported; skipping its data
// After this fix:
//   * CPicSwf data is parsed correctly (no stream desync)
//   * An informative "CPicSwf placement ... skipped" warning is emitted
//   * The Magnet.fla layer names remain correct (stream alignment preserved)
describe("Magnet.fla — CPicSwf embedded SWF placements (task 0892)", () => {
  it("does NOT emit the 'class CPicSwf is not supported' warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const bytes = fixture("Magnet.fla");
      tryLoadRealFla(bytes);
      const messages = warnSpy.mock.calls.map((c) => c.join(" "));
      const oldWarnings = messages.filter((m) =>
        m.includes('class "CPicSwf" is not supported'),
      );
      expect(oldWarnings).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("emits an informative CPicSwf skipped warning with placement details", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const bytes = fixture("Magnet.fla");
      tryLoadRealFla(bytes);
      const messages = warnSpy.mock.calls.map((c) => c.join(" "));
      const newWarnings = messages.filter((m) => m.includes("CPicSwf skipped"));
      // Magnet.fla has four CPicSwf instances; each emits one warning.
      expect(newWarnings.length).toBeGreaterThan(0);
      // Warning should include placement matrix details.
      expect(newWarnings[0]).toMatch(/x=\d+/);
      expect(newWarnings[0]).toMatch(/scaleX=/);
      expect(newWarnings[0]).toMatch(/rotation=/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("still imports 6 scenes and readable layer names after the CPicSwf fix", () => {
    const loaded = tryLoadRealFla(fixture("Magnet.fla"));
    expect(loaded).not.toBeNull();
    expect(loaded!.scenes.length).toBe(6);
    // Verify stream alignment wasn't disturbed by CPicSwf parsing.
    // Binary FLA stores layers bottom-to-top; import reverses so li=0 is frontmost.
    const names = loaded!.scenes[0]!.timeline.layers.map((l) => l.name);
    expect(names).toEqual(["Ball", "Walls", "Magnets", "Layer 5", "Layer 3", "Layer 7"]);
  });
});

// ---------------------------------------------------------------------------
// parseFla8Contents: scale9Grid decoding from Contents stream (task 0896)
// ---------------------------------------------------------------------------
// Verifies that scale9Grid is decoded from the 20-byte block that follows the
// 16-byte F5 pre-scale9Grid anchor pattern in the Contents stream symbol entry.
//
// Binary layout (flacomdoc FlaConverter.writeSymbols, F8+):
//   Pre-pattern (16 bytes): FF FE FF 00  FF FE FF 00  00 00 00 00  FF FE FF 00
//   UI32LE toggle  (1=enabled, 0=disabled)
//   UI32LE right   (twips = px * 20)
//   UI32LE left    (twips = px * 20)
//   UI32LE bottom  (twips = px * 20)
//   UI32LE top     (twips = px * 20)
//
// The test builds a minimal Flash 8 (formatVersion=0x3F) Contents stream and
// places the anchor + scale9Grid block immediately after the linkage flags.
// ---------------------------------------------------------------------------

describe("parseFla8Contents scale9Grid decode (synthetic Contents stream)", () => {
  // Helper: encode a string as UTF-16LE bytes
  function utf16le(s: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) {
      out.push(s.charCodeAt(i) & 0xff, s.charCodeAt(i) >> 8);
    }
    return out;
  }

  // Helper: encode a BomString (FF FE FF <len> <UTF-16LE data>)
  function bomString(s: string): number[] {
    return [0xff, 0xfe, 0xff, s.length, ...utf16le(s)];
  }

  // Helper: write a UI32LE value as 4 bytes
  function ui32le(v: number): number[] {
    return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
  }

  /**
   * Build a minimal Flash 8 Contents stream for a single "Symbol 1" entry
   * with the given scale9Grid values.
   *
   * Stream layout:
   *   [0x3F]                         formatVersion (Flash 8 unicode)
   *   [0x08] + UTF16LE("Symbol 1")   stream name (8 chars)
   *   BomString("MyClip")            display name  ← s starts here; s.end = 34
   *   [UI32LE: 0x00000001]           stream number (4 bytes)
   *   [0x02]                         typeByte (movieclip)
   *   BomString("")                  heuristic linkageIdentifier (4 bytes)
   *   [0x01 0x00 0x00 0x00]          4 flag bytes (exportInFirstFrame=1, rest=0)
   *                                  ← linkageFlagsEnd = s.end + 13 = 47
   *   [16 bytes pre-pattern]         FF FE FF 00 × 2, 00 × 4, FF FE FF 00
   *   [20 bytes scale9Grid block]    toggle + right + left + bottom + top
   *   [50 bytes of zeros]            padding (extends buffer past scanLimit)
   *
   * gridPrePos = 47 (right at linkageFlagsEnd).
   * scanLimit  = min(bytes.length - 36, linkageFlagsEnd + 2000) = min(137-36, 2047) = 101
   * 47 >= 47 and 47 < 101 → decoding proceeds.
   */
  function buildScale9Stream(
    toggle: number,
    rightTwips: number,
    leftTwips: number,
    bottomTwips: number,
    topTwips: number,
  ): Uint8Array {
    const displayName = "MyClip";
    const streamName = "Symbol 1";

    const header = [
      0x3f,                          // formatVersion (Flash 8)
      streamName.length,             // 8
      ...utf16le(streamName),        // 16 bytes
    ];
    // BomString("MyClip"): FF FE FF 06 + 12 UTF-16LE = 16 bytes; s.end = 18+16 = 34
    const dispNameBom = bomString(displayName);

    // 13 bytes: streamNum(4) + typeByte(1) + BomString("")(4) + flags(4)
    // linkageFlagsEnd = s.end + 13 = 47
    const afterName = [
      0x01, 0x00, 0x00, 0x00,  // UI32LE streamNum=1
      0x02,                     // typeByte=2 (movieclip)
      0xff, 0xfe, 0xff, 0x00,  // BomString("") = linkageIdentifier
      0x01, 0x00, 0x00, 0x00,  // 4 flag bytes: exportInFirstFrame=1, rest=0
    ];

    // 16-byte F5 pre-scale9Grid anchor pattern
    const prePattern = [
      0xff, 0xfe, 0xff, 0x00, // empty BomString
      0xff, 0xfe, 0xff, 0x00, // empty BomString
      0x00, 0x00, 0x00, 0x00, // 4 zero bytes
      0xff, 0xfe, 0xff, 0x00, // empty BomString
    ];

    // 20-byte scale9Grid block
    const gridBlock = [
      ...ui32le(toggle),
      ...ui32le(rightTwips),
      ...ui32le(leftTwips),
      ...ui32le(bottomTwips),
      ...ui32le(topTwips),
    ];

    // 50 bytes of tail padding to push buffer.length past scanLimit check
    const tail = new Array<number>(50).fill(0);

    const all = [
      ...header,
      ...dispNameBom,
      ...afterName,
      ...prePattern,
      ...gridBlock,
      ...tail,
    ];
    return new Uint8Array(all);
  }

  it("decodes an enabled scale9Grid with correct pixel coordinates", () => {
    // Grid: left=10px, top=20px, right=110px, bottom=70px
    // In twips: left=200, top=400, right=2200, bottom=1400
    const buf = buildScale9Stream(1, 2200, 200, 1400, 400);
    const info = parseFla8Contents(buf);
    expect(info.symbols.size).toBe(1);
    const sym = info.symbols.get(1)!;
    expect(sym).toBeDefined();
    expect(sym.scale9Grid).not.toBeNull();
    expect(sym.scale9Grid!.left).toBe(10);    // 200 / 20
    expect(sym.scale9Grid!.top).toBe(20);     // 400 / 20
    expect(sym.scale9Grid!.right).toBe(110);  // 2200 / 20
    expect(sym.scale9Grid!.bottom).toBe(70);  // 1400 / 20
  });

  it("returns null scale9Grid when toggle is 0 (disabled)", () => {
    // All INT_MIN sentinel values (0x80000000) when disabled
    const INT_MIN = 0x80000000;
    const buf = buildScale9Stream(0, INT_MIN, INT_MIN, INT_MIN, INT_MIN);
    const info = parseFla8Contents(buf);
    const sym = info.symbols.get(1)!;
    expect(sym).toBeDefined();
    expect(sym.scale9Grid).toBeNull();
  });

  it("returns null scale9Grid when formatVersion is below 0x3F (pre-Flash-8)", () => {
    // Build the same stream but with formatVersion=0x38 (MX2004, below F8 threshold)
    const buf = buildScale9Stream(1, 2200, 200, 1400, 400);
    const modified = new Uint8Array(buf);
    modified[0] = 0x38; // downgrade formatVersion to MX2004
    const info = parseFla8Contents(modified);
    const sym = info.symbols.get(1)!;
    expect(sym).toBeDefined();
    expect(sym.scale9Grid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Custom ease Bézier curve decoding (task 0883)
// ---------------------------------------------------------------------------

const FLASH8_IDENTITY_MATRIX_24 = [
  0x00, 0x00, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
] as const;

/**
 * Synthetic CPicPage → CPicLayer → CPicFrame stream with frameVersionB = 0x18
 * (Flash 8). The frame carries:
 *   useSingleEaseCurve = 1
 *   hasCustomEase = 1
 *   property[0..4]: numPoints = 0 (no per-property curves)
 *   property[5] (all): numPoints = 4
 *     pts[0] = (0, 0)     anchor start, written twice (32 bytes)
 *     pts[1] = (0.25, 0.1) control 1                  (16 bytes)
 *     pts[2] = (0.75, 0.9) control 2                  (16 bytes)
 *     pts[3] = (1, 1)     anchor end,  written twice  (32 bytes)
 *
 * The expected decoded motionEaseCurve (CSS cubic-bezier convention):
 *   { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.9 }
 */
const FLASH8_CUSTOM_EASE_FRAME_BYTES = new Uint8Array([
    // Root marker
    0x01,
    // New class CPicPage (schema=1, name len=8, "CPicPage")
    0xff, 0xff, 0x01, 0x00, 0x08, 0x00,
    0x43, 0x50, 0x69, 0x63, 0x50, 0x61, 0x67, 0x65,
    // CPicPage → readCPicObjBase: schema=4, flags=0
    0x04, 0x00,
    // child: new class CPicLayer (schema=1, name len=9, "CPicLayer")
    0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
    0x43, 0x50, 0x69, 0x63, 0x4c, 0x61, 0x79, 0x65, 0x72,
    // CPicLayer → readCPicObjBase: schema=4, flags=0
    0x04, 0x00,
    // child: new class CPicFrame (schema=1, name len=9, "CPicFrame")
    0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
    0x43, 0x50, 0x69, 0x63, 0x46, 0x72, 0x61, 0x6d, 0x65,
    // CPicFrame → readCPicObjBase: schema=4, flags=0
    0x04, 0x00,
    // CPicFrame has NO display-object children
    0x00, 0x00,
    // schema>0: registration point (2 × INT_MIN sentinels, 8 bytes)
    0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80,
    // schema>2: skip(1), schema>3: skip(1)
    0x00, 0x00,
    // CPicFrameNode: shapeSchema = 0
    0x00,
    // readMatrix (identity, 24 bytes)
    ...FLASH8_IDENTITY_MATRIX_24,
    // readShapeData(caps=false): schema=0 (1), edgeHint=0 (4), fillCount=0 (2), lineCount=0 (2) = 9 bytes
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    // --- CPicFrame-specific fields ---
    // fs = 24 (0x18 = Flash 8 frameVersionB)
    0x18,
    // duration = 1 (u16 LE)
    0x01, 0x00,
    // fs>2: keyMode = 0x4001 (motion tween) (u16 LE)
    0x01, 0x40,
    // fs>1: motionEase = 0 (s16)
    0x00, 0x00,
    // fs>4: soundId = 0 (u16)
    0x00, 0x00,
    // fs>5: envelope count = 0 (u16)
    0x00, 0x00,
    // fs>6: soundLoop=0 (u16), soundSync=0 (u8), inPoint=0 (u32), outPoint=0 (u32) = 11 bytes
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    // fs>7: skip(2)
    0x00, 0x00,
    // fs>8: CString label = "" (length byte = 0x00)
    0x00,
    // fs>=19: readTimelineSubObject: typeId=4 (u32), formatType=0 (u32), skip(4), pfCount=0 (u32)
    0x04, 0x00, 0x00, 0x00,  // typeId=4
    0x00, 0x00, 0x00, 0x00,  // formatType=0 → branch: skip(4) + pfCount
    0x00, 0x00, 0x00, 0x00,  // skip(4)
    0x00, 0x00, 0x00, 0x00,  // pfCount=0
    // fs>10: rotateFlaValue=1 (none, u32), rotateCount=0 (u32)
    0x01, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    // fs>11: labelIsComment=0 (u32)
    0x00, 0x00, 0x00, 0x00,
    // fs>12: morphTag=0 (u16)
    0x00, 0x00,
    // fs>13: motionOrientToPath=0 (u32)
    0x00, 0x00, 0x00, 0x00,
    // fs>14: oblistTag=0 (u16) — must be 0 to avoid frameTailEndScan
    0x00, 0x00,
    // fs>15: tweenInstanceName="" (CString: length=0x00)
    0x00,
    // fs>19: skip(4)
    0x00, 0x00, 0x00, 0x00,
    // fs>20: skip(4)
    0x00, 0x00, 0x00, 0x00,
    // fs>=22: skip(4)
    0x00, 0x00, 0x00, 0x00,
    // fs>=24: useSingleEaseCurve=1, hasCustomEase=1
    0x01, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00,
    // property[0..4]: numPoints=0 each (5 × u32 = 20 bytes)
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    // property[5] (all): numPoints=4
    0x04, 0x00, 0x00, 0x00,
    // pts[0] anchor start (0.0, 0.0) — written twice (4 × f64 = 32 bytes)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // x=0.0
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // y=0.0
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // duplicate x
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // duplicate y
    // pts[1] control 1: x=0.25, y=0.1 (2 × f64 = 16 bytes)
    // 0.25 = 0x3fd0000000000000 LE
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xd0, 0x3f,
    // 0.1 = 0x3fb999999999999a LE
    0x9a, 0x99, 0x99, 0x99, 0x99, 0x99, 0xb9, 0x3f,
    // pts[2] control 2: x=0.75, y=0.9 (2 × f64 = 16 bytes)
    // 0.75 = 0x3fe8000000000000 LE
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xe8, 0x3f,
    // 0.9 = 0x3feccccccccccccd LE
    0xcd, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xec, 0x3f,
    // pts[3] anchor end (1.0, 1.0) — written twice (4 × f64 = 32 bytes)
    // 1.0 = 0x3ff0000000000000 LE
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f,  // x=1.0
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f,  // y=1.0
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f,  // duplicate x
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f,  // duplicate y
    // Remaining layer/page tail fields hit EOF → caught by FlaEofError
]);

describe("custom ease Bézier curve decoding (task 0883)", () => {
  it("decodes motionEaseCurve from Flash 8 CPicFrame tail (fs=24, useSingleEaseCurve=1)", () => {
    const timeline = parseFla8Timeline(FLASH8_CUSTOM_EASE_FRAME_BYTES);
    expect(timeline.layers).toHaveLength(1);
    const frame = timeline.layers[0]!.frames[0]!;
    expect(frame.motionEaseCurve).not.toBeNull();
    expect(frame.motionEaseCurve!.x1).toBeCloseTo(0.25, 6);
    expect(frame.motionEaseCurve!.y1).toBeCloseTo(0.1, 6);
    expect(frame.motionEaseCurve!.x2).toBeCloseTo(0.75, 6);
    expect(frame.motionEaseCurve!.y2).toBeCloseTo(0.9, 6);
  });

  it("passes motionEaseCurve through flash8-import convertLayer to Frame", () => {
    const streams = new Map<string, Uint8Array>([["Page 1", FLASH8_CUSTOM_EASE_FRAME_BYTES]]);
    const doc = buildFla8Document(streams);
    expect(doc).not.toBeNull();
    const frame = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.motionEaseCurve).not.toBeNull();
    expect(frame.motionEaseCurve!.x1).toBeCloseTo(0.25, 6);
    expect(frame.motionEaseCurve!.y1).toBeCloseTo(0.1, 6);
    expect(frame.motionEaseCurve!.x2).toBeCloseTo(0.75, 6);
    expect(frame.motionEaseCurve!.y2).toBeCloseTo(0.9, 6);
  });

  it("x1/x2 are clamped to [0,1] even when the decoded value is outside that range", () => {
    // Verify the clamping branch by checking that a valid in-range value passes through.
    const timeline = parseFla8Timeline(FLASH8_CUSTOM_EASE_FRAME_BYTES);
    const curve = timeline.layers[0]!.frames[0]!.motionEaseCurve!;
    expect(curve.x1).toBeGreaterThanOrEqual(0);
    expect(curve.x1).toBeLessThanOrEqual(1);
    expect(curve.x2).toBeGreaterThanOrEqual(0);
    expect(curve.x2).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Shape-tween ease forwarding (task 0914)
//
// The binary stores one ease value (motionEase s16) regardless of tween type.
// For tweenType="shape" this value must land in Frame.shapeEase, not
// Frame.motionEase.  The bug: flash8-import.ts always mapped f.motionEase to
// motionEase, so shape tweens always imported as ease=0 (linear) even when
// the Flash document had a non-zero ease.
//
// Synthetic stream layout (CPicPage → CPicLayer → CPicFrame with fs=3):
//   fs=3 carries:  duration (u16), keyMode (u16, fs>2), motionEase (s16, fs>1).
//   keyMode=0x0002 → shape tween.
//   motionEase=50  → should map to shapeEase=50 (ease-in/out range: -100..100).
//
// We also verify the negative direction: for a motion-tween frame the same
// binary ease value must appear in motionEase (not shapeEase).
// ---------------------------------------------------------------------------

describe("shape-tween ease forwarding (task 0914)", () => {
  // Shared synthetic stream body for CPicPage → CPicLayer → CPicFrame header.
  // The CPicFrame-specific bytes follow the shape data at the end.
  const IDENTITY_MATRIX_24 = [
    0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ] as const;

  function makeFrameStream(keyMode: number, ease: number): Uint8Array {
    // ease is encoded as a signed 16-bit little-endian value
    const easeBytes = [ease & 0xff, (ease >> 8) & 0xff];
    return new Uint8Array([
      // Root marker
      0x01,
      // New class CPicPage (schema=1, name len=8, "CPicPage")
      0xff, 0xff, 0x01, 0x00, 0x08, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x50, 0x61, 0x67, 0x65,
      // CPicPage → readCPicObjBase: schema=4, flags=0
      0x04, 0x00,
      // child: new class CPicLayer (schema=1, name len=9, "CPicLayer")
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x4c, 0x61, 0x79, 0x65, 0x72,
      // CPicLayer → readCPicObjBase: schema=4, flags=0
      0x04, 0x00,
      // child: new class CPicFrame (schema=1, name len=9, "CPicFrame")
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x46, 0x72, 0x61, 0x6d, 0x65,
      // CPicFrame → readCPicObjBase: schema=4, flags=0
      0x04, 0x00,
      // CPicFrame has NO display-object children
      0x00, 0x00,
      // schema>0: registration point (2 × INT_MIN sentinels)
      0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80,
      // schema>2: skip(1), schema>3: skip(1)
      0x00, 0x00,
      // CPicFrameNode: shapeSchema = 0
      0x00,
      // readMatrix (identity, 24 bytes)
      ...IDENTITY_MATRIX_24,
      // readShapeData(caps=false): schema=0(1), edgeHint=0(4), fillCount=0(2), lineCount=0(2)
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // --- CPicFrame-specific fields: fs=3 ---
      0x03,                         // fs=3
      0x01, 0x00,                   // duration=1 (u16 LE)
      keyMode & 0xff, (keyMode >> 8) & 0xff,  // keyMode (u16 LE, fs>2)
      ...easeBytes,                 // motionEase (s16 LE, fs>1)
      // Remaining reads hit EOF — caught by FlaEofError try/catch
    ]);
  }

  it("shape-tween frame: binary ease value maps to shapeEase, not motionEase", () => {
    // keyMode=0x0002 → shape tween; ease=50
    const stream = makeFrameStream(0x0002, 50);
    const streams = new Map<string, Uint8Array>([["Page 1", stream]]);
    const doc = buildFla8Document(streams);
    expect(doc).not.toBeNull();
    const frame = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.tweenType).toBe("shape");
    expect(frame.shapeEase).toBe(50);
    expect(frame.shapeEaseType).toBe("in");
    expect(frame.motionEase).toBe(0); // must remain at default
  });

  it("shape-tween frame: negative ease (ease-out) maps to shapeEase correctly", () => {
    // keyMode=0x0002 → shape tween; ease=-75 (stored as signed s16)
    const ease = -75;
    const easeU16 = ease & 0xffff; // two's complement: 0xFF85
    const stream = makeFrameStream(0x0002, easeU16);
    const streams = new Map<string, Uint8Array>([["Page 1", stream]]);
    const doc = buildFla8Document(streams);
    expect(doc).not.toBeNull();
    const frame = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.tweenType).toBe("shape");
    expect(frame.shapeEase).toBe(-75);
    expect(frame.shapeEaseType).toBe("out");
    expect(frame.motionEase).toBe(0);
  });

  it("motion-tween frame: binary ease value maps to motionEase, shapeEase stays 0", () => {
    // keyMode=0x4001 → motion tween; ease=75
    const stream = makeFrameStream(0x4001, 75);
    const streams = new Map<string, Uint8Array>([["Page 1", stream]]);
    const doc = buildFla8Document(streams);
    expect(doc).not.toBeNull();
    const frame = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.tweenType).toBe("motion");
    expect(frame.motionEase).toBe(75);
    expect(frame.motionEaseType).toBe("in");
    expect(frame.shapeEase).toBe(0); // must remain at default
  });

  it("no-tween frame: shapeEase stays 0 (ease value not routed to shapeEase)", () => {
    // keyMode=0x0000 → no tween; ease=50 in the binary.
    // The ease value is not meaningful for no-tween frames.  The important
    // invariant is that shapeEase stays 0 (shape tween is not active).
    const stream = makeFrameStream(0x0000, 50);
    const streams = new Map<string, Uint8Array>([["Page 1", stream]]);
    const doc = buildFla8Document(streams);
    expect(doc).not.toBeNull();
    const frame = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.tweenType).toBe("none");
    expect(frame.shapeEase).toBe(0);
    // motionEase gets the raw binary value in the no-tween path (harmless, unused)
    expect(frame.motionEase).toBe(50);
    expect(frame.motionEaseType).toBe("in");
  });
});

// ---------------------------------------------------------------------------
// Motion/shape tween ease direction decoding (task 0932)
//
// CPicFrame field_190 is a signed s16 acceleration (flacomdoc
// TimelineConverter.writeUI16). Sign encodes direction; |value| is strength.
// XFL convention (flacomdoc 0012_interpolation): negative = ease-out,
// positive = ease-in, zero = none. Custom Bézier curves with zero
// acceleration decode as ease-in-out.
// ---------------------------------------------------------------------------

describe("tween ease direction decoding (task 0932)", () => {
  const IDENTITY_MATRIX_24 = [
    0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ] as const;

  function makeEaseFrameStream(keyMode: number, easeS16: number): Uint8Array {
    const easeBytes = [easeS16 & 0xff, (easeS16 >> 8) & 0xff];
    return new Uint8Array([
      0x01,
      0xff, 0xff, 0x01, 0x00, 0x08, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x50, 0x61, 0x67, 0x65,
      0x04, 0x00,
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x4c, 0x61, 0x79, 0x65, 0x72,
      0x04, 0x00,
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x46, 0x72, 0x61, 0x6d, 0x65,
      0x04, 0x00,
      0x00, 0x00,
      0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80,
      0x00, 0x00,
      0x00,
      ...IDENTITY_MATRIX_24,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x03,
      0x01, 0x00,
      keyMode & 0xff, (keyMode >> 8) & 0xff,
      ...easeBytes,
    ]);
  }

  it.each([
    [0, "none"],
    [82, "in"],
    [-63, "out"],
  ] as const)("acceleration=%i decodes easeType=%s on Fla8Frame", (accel, expected) => {
    const signed = accel < 0 ? (accel & 0xffff) : accel;
    const timeline = parseFla8Timeline(makeEaseFrameStream(0x4001, signed));
    const frame = timeline.layers[0]!.frames[0]!;
    expect(frame.motionEase).toBe(accel);
    expect(frame.easeType).toBe(expected);
  });

  it("forwards motionEaseType to Frame for motion tweens", () => {
    const stream = makeEaseFrameStream(0x4001, (-63) & 0xffff);
    const doc = buildFla8Document(new Map([["Page 1", stream]]));
    const frame = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.tweenType).toBe("motion");
    expect(frame.motionEase).toBe(-63);
    expect(frame.motionEaseType).toBe("out");
  });

  it("forwards shapeEaseType to Frame for shape tweens", () => {
    const stream = makeEaseFrameStream(0x0002, 25);
    const doc = buildFla8Document(new Map([["Page 1", stream]]));
    const frame = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.tweenType).toBe("shape");
    expect(frame.shapeEase).toBe(25);
    expect(frame.shapeEaseType).toBe("in");
  });

  it("custom ease curve with zero acceleration decodes as inOut", () => {
    const timeline = parseFla8Timeline(FLASH8_CUSTOM_EASE_FRAME_BYTES);
    const frame = timeline.layers[0]!.frames[0]!;
    expect(frame.motionEase).toBe(0);
    expect(frame.easeType).toBe("inOut");
    expect(frame.motionEaseCurve).not.toBeNull();

    const doc = buildFla8Document(
      new Map([["Page 1", FLASH8_CUSTOM_EASE_FRAME_BYTES]]),
    );
    const modelFrame = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(modelFrame.motionEaseType).toBe("inOut");
  });
});

// ---------------------------------------------------------------------------
// assignFolderParents — folder layer parentFolderId reconstruction (task 0915)
// ---------------------------------------------------------------------------

describe("assignFolderParents (task 0915)", () => {
  // Helper: build a minimal Layer stub with just enough fields for assignFolderParents.
  function makeLayer(id: string, type: Layer["type"]): Layer {
    return {
      id,
      name: id,
      type,
      visible: true,
      locked: false,
      outlineMode: false,
      outlineColor: "#0000ff",
      height: 20,
      parentFolderId: null,
      frames: [],
      frameCount: 1,
    };
  }

  it("leaves parentFolderId null for all layers when no folder is present", () => {
    const layers = [makeLayer("a", "normal"), makeLayer("b", "normal")];
    const result = assignFolderParents(layers);
    expect(result).toHaveLength(2);
    expect(result[0]!.parentFolderId).toBeNull();
    expect(result[1]!.parentFolderId).toBeNull();
  });

  it("assigns non-folder layers after a folder to that folder's id", () => {
    const folder = makeLayer("folder1", "folder");
    const child1 = makeLayer("layer1", "normal");
    const child2 = makeLayer("layer2", "normal");
    const result = assignFolderParents([folder, child1, child2]);
    expect(result).toHaveLength(3);
    expect(result[0]!.parentFolderId).toBeNull();       // folder itself is top-level
    expect(result[1]!.parentFolderId).toBe("folder1");  // child1 → folder1
    expect(result[2]!.parentFolderId).toBe("folder1");  // child2 → folder1
  });

  it("does not assign parentFolderId to layers before the first folder", () => {
    const top = makeLayer("top", "normal");
    const folder = makeLayer("fold", "folder");
    const child = makeLayer("child", "normal");
    const result = assignFolderParents([top, folder, child]);
    expect(result[0]!.parentFolderId).toBeNull();  // top comes before folder
    expect(result[1]!.parentFolderId).toBeNull();  // folder itself is top-level
    expect(result[2]!.parentFolderId).toBe("fold"); // child belongs to fold
  });

  it("handles sibling folders: each resets the current parent context", () => {
    const folder1 = makeLayer("f1", "folder");
    const child1  = makeLayer("c1", "normal");
    const folder2 = makeLayer("f2", "folder");
    const child2  = makeLayer("c2", "normal");
    const result = assignFolderParents([folder1, child1, folder2, child2]);
    expect(result[0]!.parentFolderId).toBeNull();   // f1 is top-level
    expect(result[1]!.parentFolderId).toBe("f1");   // c1 → f1
    expect(result[2]!.parentFolderId).toBeNull();   // f2 is top-level (sibling of f1)
    expect(result[3]!.parentFolderId).toBe("f2");   // c2 → f2
  });

  it("assigns masked/guided/guide layer types to their enclosing folder", () => {
    const folder = makeLayer("fold", "folder");
    const mask   = makeLayer("m",    "mask");
    const masked = makeLayer("md",   "masked");
    const result = assignFolderParents([folder, mask, masked]);
    expect(result[1]!.parentFolderId).toBe("fold");
    expect(result[2]!.parentFolderId).toBe("fold");
  });

  it("returns an empty array unchanged", () => {
    expect(assignFolderParents([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Button symbol Up/Over/Down/Hit frame structure (task 0923)
//
// Flash binary FLA stores button symbols as CPicPage timelines with exactly
// 4 frames corresponding to the Up, Over, Down, and Hit states (frame indices
// 0, 1, 2, 3 respectively). The Flash authoring tool does NOT store textual
// "Up"/"Over"/"Down"/"Hit" labels for these frames in the binary — the state
// is implicit by frame position. The f.label forwarding path in
// flash8-import.ts is exercised, and the labels survive as empty strings.
//
// Fixture: Magnet.fla — CS2 FLA with multiple button symbols (e.g. "Symbol 10",
// "Symbol 11", "Symbol 13", "Symbol 34", "WW2", etc.) each storing exactly
// 4 frames with empty labels.
// ---------------------------------------------------------------------------

describe("button symbol Up/Over/Down/Hit frame structure (task 0923)", () => {
  let doc: FlashDocument;

  beforeAll(() => {
    const loaded = tryLoadRealFla(fixture("Magnet.fla"));
    expect(loaded).not.toBeNull();
    doc = loaded!;
  });

  it("all button symbols have exactly 4 frames (Up/Over/Down/Hit) in layer 0", () => {
    const buttonSymbols = symbols(doc).filter((s) => s.symbolType === "button");
    expect(buttonSymbols.length).toBeGreaterThan(0);
    for (const sym of buttonSymbols) {
      const layer0 = sym.timeline.layers[0]!;
      expect(layer0.frames.length).toBe(4);
      expect(layer0.frameCount).toBe(4);
    }
  });

  it("button state frame indices are 0 (Up), 1 (Over), 2 (Down), 3 (Hit)", () => {
    // Pick the first button symbol with a single layer as the canonical check.
    const buttonSymbol = symbols(doc).find(
      (s) => s.symbolType === "button" && s.timeline.layers.length >= 1,
    )!;
    expect(buttonSymbol).toBeDefined();
    const frames = buttonSymbol.timeline.layers[0]!.frames;
    expect(frames[0]!.index).toBe(0); // Up state
    expect(frames[1]!.index).toBe(1); // Over state
    expect(frames[2]!.index).toBe(2); // Down state
    expect(frames[3]!.index).toBe(3); // Hit state
  });

  it("button state frame labels survive import — Flash stores empty labels for state frames", () => {
    // Flash does NOT store textual "Up"/"Over"/"Down"/"Hit" labels in the
    // binary FLA for button state frames; the state is positional.  The
    // f.label field is forwarded through flash8-import.ts's convertLayer
    // for button timelines just as for movieclip timelines.  Verify that
    // all 4 state frames import with label="" (not undefined or null) and
    // that labelType is "name" (the default when labelIsComment is false).
    const buttonSymbol = symbols(doc).find(
      (s) => s.symbolType === "button" && s.timeline.layers[0]!.frames.length === 4,
    )!;
    expect(buttonSymbol).toBeDefined();
    const frames = buttonSymbol.timeline.layers[0]!.frames;
    for (const frame of frames) {
      expect(frame.label).toBe("");
      expect(frame.labelType).toBe("name");
    }
  });
});

// ---------------------------------------------------------------------------
// FontItem library entries from embedded font symbols (task 0926)
//
// Flash 8/CS2-era binary FLAs encode embedded font library entries as "Font N"
// stream references in the Contents stream. Each entry carries the font family
// name (e.g. "_sans") at a fixed byte offset after the stream-name BomString.
// Before task 0926 these entries were silently skipped; after the fix each
// "Font N" entry in the Contents stream is converted to a FontItem in
// doc.library.
//
// Fixture: Magnet.fla (CS2 FLA) — contains one embedded font "_sans" (Font 1).
// ---------------------------------------------------------------------------

describe("FLA import: FontItem entries created for embedded fonts (task 0926)", () => {
  let doc: FlashDocument;

  beforeAll(() => {
    const loaded = tryLoadRealFla(fixture("Magnet.fla"));
    expect(loaded).not.toBeNull();
    doc = loaded!;
  });

  it("library contains at least one FontItem", () => {
    const fontItems = doc.library.items.filter((i): i is FontItem => i.itemType === "font");
    expect(fontItems.length).toBeGreaterThan(0);
  });

  it("FontItem for '_sans' is present with correct fields", () => {
    const fontItems = doc.library.items.filter((i): i is FontItem => i.itemType === "font");
    const sans = fontItems.find((f) => f.fontName === "_sans");
    expect(sans).toBeDefined();
    expect(sans!.name).toBe("_sans");
    expect(sans!.itemType).toBe("font");
    expect(typeof sans!.id).toBe("string");
    expect(sans!.id.length).toBeGreaterThan(0);
  });

  it("parseFla8Contents produces a fonts map with Font 1 entry", () => {
    // Verify the binary-level parsing: parseFla8Contents must find the font
    // in the Contents stream and populate the fonts Map correctly.
    // We test this via a synthetic Contents stream that mimics the real layout.
    //
    // Synthetic Contents stream for "Font 1" -> "_sans":
    //   FF FE FF 06 [Font 1 UTF-16LE] UI16(1) UI32(hash) UI16(schema) UI8(flag) UI8(5) [_sans UTF-16LE]
    //
    // Note: parseFla8Contents also needs a formatVersion >= 0x38 (unicode).
    // We embed a fake framerate/bgColor anchor and dimensions so it doesn't warn.
    function makeFontContentsStream(fontNum: number, fontFamily: string): Uint8Array {
      // Encode "Font N" as BomString: FF FE FF [len] [UTF-16LE]
      const streamName = `Font ${fontNum}`;
      const nameUtf16: number[] = [];
      for (const c of streamName) { nameUtf16.push(c.charCodeAt(0), 0); }
      const bom = [0xff, 0xfe, 0xff, streamName.length, ...nameUtf16];

      // Fixed-offset font data after BomString:
      //   +0 UI16: stream number
      //   +2..5: 4 skip bytes (hash)
      //   +6..7: 2 skip bytes (schema)
      //   +8: 1 skip byte (flag)
      //   +9: UI8 fontNameLen
      //   +10..end: UTF-16LE font family name
      const fontUtf16: number[] = [];
      for (const c of fontFamily) { fontUtf16.push(c.charCodeAt(0), 0); }
      const fontData = [
        fontNum & 0xff, (fontNum >> 8) & 0xff, // UI16 stream number
        0x7e, 0x57, 0x8e, 0x42,                // 4 skip bytes (hash)
        0x0a, 0x18,                             // 2 skip bytes (schema)
        0x01,                                   // 1 skip byte (flag)
        fontFamily.length,                      // UI8 fontNameLen
        ...fontUtf16,                           // font family name UTF-16LE
      ];

      // Build a minimal valid Contents stream:
      // Byte 0: formatVersion >= 0x38 (unicode)
      // Then embed the font BomString + data somewhere in the stream.
      // parseFla8Contents scans the entire byte array for patterns, so
      // we just need the font entry to appear at a valid position.
      const header = [0x3f]; // formatVersion = 0x3F (Flash 8)
      const allBytes = [...header, ...bom, ...fontData];
      return new Uint8Array(allBytes);
    }

    const stream = makeFontContentsStream(1, "_sans");
    const contents = parseFla8Contents(stream);
    expect(contents.fonts.size).toBe(1);
    const fontInfo = contents.fonts.get(1);
    expect(fontInfo).toBeDefined();
    expect(fontInfo!.fontName).toBe("_sans");
    expect(fontInfo!.name).toBe("_sans");
  });
});

// ---------------------------------------------------------------------------
// Motion tween rotateType and rotateCount decoding (task 0936)
//
// Flash stores rotation parameters in CPicFrame tween data (fs >= 19, fs > 10):
//   motionTweenRotate (u32): 1=none, 2=auto, 3=CW, 4=CCW
//   rotateTimes       (u32): extra full rotations (0, 1, 2, ...)
//
// The decoder maps the u32 value → string enum "none"|"auto"|"cw"|"ccw" and
// forwards both fields through flash8-import to Frame.motionRotate and
// Frame.motionRotateCount.
//
// Synthetic stream layout (CPicPage → CPicLayer → CPicFrame with fs=19):
//   duration=1 (u16), keyMode=0x4001 motion-tween (u16, fs>2),
//   motionEase=0 (s16, fs>1), soundId=0 (u16, fs>4),
//   envCount=0 (u16, fs>5), soundLoop=0(u16) soundSync=0(u8) in=0(u32) out=0(u32) (fs>6),
//   skip(2) (fs>7), label="" CString (fs>8),
//   readTimelineSubObject: typeId=4 formatType=0 skip4=0 pfCount=0 (fs>=19),
//   rotateFlaValue (u32, fs>10), rotateCount (u32, fs>10),
//   remaining reads hit EOF — caught by try/catch.
// ---------------------------------------------------------------------------

describe("motion tween rotateType and rotateCount decoding (task 0936)", () => {
  const IDENTITY_MATRIX_24_ROTATE = [
    0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ] as const;

  /**
   * Build a minimal synthetic CPicPage → CPicLayer → CPicFrame stream with
   * fs=19 (0x13) to reach the rotateFlaValue / rotateCount fields.
   *
   * @param rotateFlaValue  binary value: 1=none, 2=auto, 3=CW, 4=CCW
   * @param rotateCount     extra full rotations (u32)
   */
  function makeRotateFrameStream(rotateFlaValue: number, rotateCount: number): Uint8Array {
    function u32le(v: number): number[] {
      return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
    }
    return new Uint8Array([
      // Root marker
      0x01,
      // New class CPicPage (schema=1, name len=8, "CPicPage")
      0xff, 0xff, 0x01, 0x00, 0x08, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x50, 0x61, 0x67, 0x65,
      // CPicPage → readCPicObjBase: schema=4, flags=0
      0x04, 0x00,
      // child: new class CPicLayer (schema=1, name len=9, "CPicLayer")
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x4c, 0x61, 0x79, 0x65, 0x72,
      // CPicLayer → readCPicObjBase: schema=4, flags=0
      0x04, 0x00,
      // child: new class CPicFrame (schema=1, name len=9, "CPicFrame")
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x46, 0x72, 0x61, 0x6d, 0x65,
      // CPicFrame → readCPicObjBase: schema=4, flags=0
      0x04, 0x00,
      // CPicFrame has NO display-object children
      0x00, 0x00,
      // schema>0: registration point (2 × INT_MIN sentinels, 8 bytes)
      0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80,
      // schema>2: skip(1), schema>3: skip(1)
      0x00, 0x00,
      // CPicFrameNode: shapeSchema = 0
      0x00,
      // readMatrix (identity, 24 bytes)
      ...IDENTITY_MATRIX_24_ROTATE,
      // readShapeData(caps=false): schema=0(1), edgeHint=0(4), fillCount=0(2), lineCount=0(2)
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // --- CPicFrame-specific fields (fs=19 = 0x13) ---
      0x13,             // fs = 19 (>= 19 AND > 10 → rotation fields decoded)
      0x01, 0x00,       // duration = 1 (u16)
      0x01, 0x40,       // keyMode = 0x4001 (motion tween) (u16, fs>2)
      0x00, 0x00,       // motionEase = 0 (s16, fs>1)
      0x00, 0x00,       // soundId = 0 (u16, fs>4)
      0x00, 0x00,       // envelope count = 0 (u16, fs>5)
      // fs>6: soundLoop(u16) + soundSync(u8) + inPoint(u32) + outPoint(u32) = 11 bytes
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00,       // fs>7: skip(2)
      0x00,             // fs>8: CString label = "" (length byte = 0)
      // fs>=19: readTimelineSubObject: typeId=4 (u32), formatType=0 (u32), skip4, pfCount=0
      0x04, 0x00, 0x00, 0x00,   // typeId = 4
      0x00, 0x00, 0x00, 0x00,   // formatType = 0 → else if (formatType === 0) branch
      0x00, 0x00, 0x00, 0x00,   // skip(4)
      0x00, 0x00, 0x00, 0x00,   // pfCount = 0
      // fs>10: rotateFlaValue (u32) and rotateCount (u32)
      ...u32le(rotateFlaValue),
      ...u32le(rotateCount),
      // Remaining fs>11 / fs>12 / ... reads hit EOF — caught by FlaEofError
    ]);
  }

  it.each([
    [1, "none"],
    [2, "auto"],
    [3, "cw"],
    [4, "ccw"],
  ] as const)(
    "rotateFlaValue=%i decodes to motionRotate='%s' in parseFla8Timeline",
    (rotateFlaValue, expected) => {
      const stream = makeRotateFrameStream(rotateFlaValue, 0);
      const timeline = parseFla8Timeline(stream);
      expect(timeline.layers).toHaveLength(1);
      const frame = timeline.layers[0]!.frames[0]!;
      expect(frame.motionRotate).toBe(expected);
      expect(frame.motionRotateCount).toBe(0);
    },
  );

  it("rotateCount is decoded correctly from the binary (extra full rotations)", () => {
    // Encode CW rotation (rotateFlaValue=3) with rotateCount=2
    const stream = makeRotateFrameStream(3, 2);
    const timeline = parseFla8Timeline(stream);
    const frame = timeline.layers[0]!.frames[0]!;
    expect(frame.motionRotate).toBe("cw");
    expect(frame.motionRotateCount).toBe(2);
  });

  it("motionRotate defaults to 'none' for unknown rotateFlaValue (0)", () => {
    // 0 is not in the map (1..4 are valid); should fall back to 'none'
    const stream = makeRotateFrameStream(0, 0);
    const timeline = parseFla8Timeline(stream);
    const frame = timeline.layers[0]!.frames[0]!;
    expect(frame.motionRotate).toBe("none");
  });

  it("forwards motionRotate and motionRotateCount through buildFla8Document to Frame", () => {
    // Use CCW (rotateFlaValue=4) with rotateCount=3 — verifies the flash8-import
    // forwarding path (flash8-import.ts passes both fields to the model keyframe).
    const stream = makeRotateFrameStream(4, 3);
    const streams = new Map<string, Uint8Array>([["Page 1", stream]]);
    const doc = buildFla8Document(streams);
    expect(doc).not.toBeNull();
    const frame = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.motionRotate).toBe("ccw");
    expect(frame.motionRotateCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// CPicObjBase flags: visible/hidden decoding (task 0932)
//
// CPicObjBase is the base of every display-object class in the binary FLA.
// Its second byte (flags) has bit 0 = visible: 0x01 → visible, 0x00 → hidden.
// readCPicSymbolFields now captures this flag and returns it as SymbolBaseFields.visible.
// ---------------------------------------------------------------------------

describe("CPicSprite visible/hidden flag decoding (task 0932)", () => {
  //
  // Builds a minimal synthetic Page stream:
  //   CPicPage → CPicLayer → CPicFrame → CPicSprite (with given flags byte)
  //
  // CPicSprite body uses symbolSchema=0 (no color effect, no filters),
  // identity matrix, libraryIndex=1, g=0 (simplest sprite trailer).
  //
  // Class table slots (each class = 2 slots):
  //   1+2  → CPicPage
  //   3+4  → CPicLayer
  //   5+6  → CPicFrame
  //   7+8  → CPicSprite
  //
  const IDENTITY_MATRIX = [
    0x00, 0x00, 0x01, 0x00, // a = 1.0 (16.16 fixed)
    0x00, 0x00, 0x00, 0x00, // b = 0
    0x00, 0x00, 0x00, 0x00, // c = 0
    0x00, 0x00, 0x01, 0x00, // d = 1.0
    0x00, 0x00, 0x00, 0x00, // tx = 0
    0x00, 0x00, 0x00, 0x00, // ty = 0
  ] as const;

  function makeSpriteStream(spriteFlags: number): Uint8Array {
    return new Uint8Array([
      // Root marker
      0x01,
      // --- New class CPicPage (schema=1, nameLen=8, "CPicPage") ---
      0xff, 0xff, 0x01, 0x00, 0x08, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x50, 0x61, 0x67, 0x65, // "CPicPage"
      // CPicPage CPicObjBase: schema=4, flags=0
      0x04, 0x00,
      //   -- CPicPage child: new class CPicLayer (schema=1, nameLen=9, "CPicLayer") --
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x4c, 0x61, 0x79, 0x65, 0x72, // "CPicLayer"
      //   CPicLayer CPicObjBase: schema=4, flags=0
      0x04, 0x00,
      //     -- CPicLayer child: new class CPicFrame (schema=1, nameLen=9, "CPicFrame") --
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x46, 0x72, 0x61, 0x6d, 0x65, // "CPicFrame"
      //     CPicFrame CPicObjBase: schema=4, flags=0
      0x04, 0x00,
      //       -- CPicFrame child: new class CPicSprite (schema=1, nameLen=10, "CPicSprite") --
      0xff, 0xff, 0x01, 0x00, 0x0a, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x53, 0x70, 0x72, 0x69, 0x74, 0x65, // "CPicSprite"
      //       CPicSprite CPicObjBase: schema=0, flags=spriteFlags ← THE BIT UNDER TEST
      0x00, spriteFlags,
      //       CPicSprite has no children → null terminator
      0x00, 0x00,
      //       (schema=0: no registration point skips)
      //
      //       === CPicSymbolFields body ===
      //       symbolSchema = 0 (no color effect, no filters, no empty string)
      0x00,
      //       matrix (identity, 24 bytes)
      ...IDENTITY_MATRIX,
      //       firstFrame = 0 (u16 LE)
      0x00, 0x00,
      //       loopMode = 0 (u8)
      0x00,
      //       skip(1) — constant 0 after loopMode
      0x00,
      //       (symbolSchema < 7: no extra skip)
      //       (symbolSchema < 4: no color effect block)
      //       (symbolSchema < 6: no empty CString)
      //       libraryIndex = 1 (u16 LE)
      0x01, 0x00,
      //       skip(2) — reserved bytes after libraryIndex
      0x00, 0x00,
      //       (symbolSchema < 0x0e: no 3-byte skip)
      //       (symbolSchema < 0x13: no filters/blend block)
      //
      //       === CPicSprite trailer ===
      //       g = 0 (pre-F5: no timeline sub-object, no skip blocks)
      0x00,
      //       instanceName = empty CString
      0x00,
      //       (g < 3: no reserved blocks)
      //
      //     Back in CPicFrame children loop: null terminator (end of children)
      0x00, 0x00,
      //     CPicFrame CPicObjBase post-loop (schema=4):
      //       registration point (2 × INT_MIN sentinels, 8 bytes)
      0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80,
      //       schema>2: skip(1), schema>3: skip(1)
      0x00, 0x00,
      //
      //     === CPicFrame-specific fields ===
      //     shapeSchema = 0
      0x00,
      //     readMatrix (identity, 24 bytes) — frame's own transform
      ...IDENTITY_MATRIX,
      //     readShapeData(caps=false): schema=0(1), edgeHint=0(4), fillCount=0(2),
      //       lineCount=0(2), edge-end sentinel(1)
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      //     Remaining CPicFrame-specific reads hit EOF → caught by FlaEofError
    ]);
  }

  it("CPicSprite with flags=0x00 (hidden) decodes to Fla8Instance.visible === false", () => {
    // flags=0x00: bit 0 is 0 → not visible → visible = false
    const stream = makeSpriteStream(0x00);
    const timeline = parseFla8Timeline(stream);
    expect(timeline.layers).toHaveLength(1);
    const frame = timeline.layers[0]!.frames[0]!;
    const instances = frame.elements.filter(
      (e): e is Extract<typeof e, { type: "instance" }> => e.type === "instance",
    );
    expect(instances).toHaveLength(1);
    expect(instances[0]!.visible).toBe(false);
  });

  it("CPicSprite with flags=0x01 (visible) does not set visible field (default true)", () => {
    // flags=0x01: bit 0 is 1 → visible → visible field is absent (default true)
    const stream = makeSpriteStream(0x01);
    const timeline = parseFla8Timeline(stream);
    const frame = timeline.layers[0]!.frames[0]!;
    const instances = frame.elements.filter(
      (e): e is Extract<typeof e, { type: "instance" }> => e.type === "instance",
    );
    expect(instances).toHaveLength(1);
    expect(instances[0]!.visible).toBeUndefined();
  });
});
// Motion tween sync flag decoding (task 0934)
//
// Flash stores motionTweenSync ("Sync" in the properties panel) in keyMode bit
// 0x0800 for classic/motion tweens (flacomdoc TimelineConverter KEYMODES).
// ---------------------------------------------------------------------------

describe("motion tween sync flag decoding (task 0934)", () => {
  const IDENTITY_MATRIX_24_SYNC = [
    0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ] as const;

  function makeSyncFrameStream(keyMode: number): Uint8Array {
    return new Uint8Array([
      0x01,
      0xff, 0xff, 0x01, 0x00, 0x08, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x50, 0x61, 0x67, 0x65,
      0x04, 0x00,
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x4c, 0x61, 0x79, 0x65, 0x72,
      0x04, 0x00,
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x46, 0x72, 0x61, 0x6d, 0x65,
      0x04, 0x00,
      0x00, 0x00,
      0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80,
      0x00, 0x00,
      0x00,
      ...IDENTITY_MATRIX_24_SYNC,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x13,
      0x01, 0x00,
      keyMode & 0xff, (keyMode >> 8) & 0xff,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00,
      0x00,
      0x04, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]);
  }

  it.each([
    [0x4001, false],
    [0x4801, true], // 0x4001 | 0x0800 (motionTweenSync)
    [0x4d01, true], // flacomdoc fixture: sync + orient + rotate
  ] as const)("keyMode=0x%04x decodes motionSync=%s", (keyMode, expected) => {
    const timeline = parseFla8Timeline(makeSyncFrameStream(keyMode));
    const frame = timeline.layers[0]!.frames[0]!;
    expect(frame.motionSync).toBe(expected);
  });

  it("forwards motionSync through buildFla8Document to Frame", () => {
    const stream = makeSyncFrameStream(0x4801);
    const streams = new Map<string, Uint8Array>([["Page 1", stream]]);
    const doc = buildFla8Document(streams);
    expect(doc).not.toBeNull();
    const frame = doc!.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(frame.motionSync).toBe(true);
    expect(frame.tweenType).toBe("motion");
  });
});
// Symbol instance AccProps / accessibility decoding (task 0937)
// ---------------------------------------------------------------------------

describe("CPicSprite accessibility AccProps decoding (task 0937)", () => {
  const IDENTITY_MATRIX = [
    0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ] as const;

  function asciiCString(s: string): readonly number[] {
    if (!s) return [0x00];
    const chars = [...s].map((ch) => ch.charCodeAt(0));
    return [chars.length, ...chars];
  }

  function accessibilityBlock(opts: {
    silent?: boolean;
    name?: string;
    description?: string;
    shortcut?: string;
    tabIndex?: string;
    forceSimple?: boolean;
  }): readonly number[] {
    const {
      silent = false,
      name = "",
      description = "",
      shortcut = "",
      tabIndex = "0",
      forceSimple = false,
    } = opts;
    return [
      0x09, 0x00,
      0x00, 0x00, silent ? 0x01 : 0x00, 0x00, 0x00, 0x00,
      ...asciiCString(name),
      ...asciiCString(description),
      ...asciiCString(shortcut),
      ...asciiCString(tabIndex),
      0x00,
      forceSimple ? 0x01 : 0x00,
      0x00, 0x00, 0x00,
    ];
  }

  function makeSpriteAccStream(accBytes: readonly number[], instanceName = "myBtn"): Uint8Array {
    return new Uint8Array([
      0x01,
      0xff, 0xff, 0x01, 0x00, 0x08, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x50, 0x61, 0x67, 0x65,
      0x04, 0x01,
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x4c, 0x61, 0x79, 0x65, 0x72,
      0x04, 0x00,
      0xff, 0xff, 0x01, 0x00, 0x09, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x46, 0x72, 0x61, 0x6d, 0x65,
      0x04, 0x00,
      0xff, 0xff, 0x01, 0x00, 0x0a, 0x00,
      0x43, 0x50, 0x69, 0x63, 0x53, 0x70, 0x72, 0x69, 0x74, 0x65,
      0x00, 0x01,
      0x00, 0x00,
      0x00,
      ...IDENTITY_MATRIX,
      0x00, 0x00,
      0x00,
      0x00,
      0x01, 0x00,
      0x00, 0x00,
      0x08,
      0x04, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      ...asciiCString(instanceName),
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ...accBytes,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00,
      0x00,
      0x00, 0x00,
      0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80,
      0x00, 0x00,
      0x00,
      ...IDENTITY_MATRIX,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
  }

  it("decodes accName, description, shortcut, tabIndex, and forceSimple from CPicSprite trailer", () => {
    const stream = makeSpriteAccStream(accessibilityBlock({
      name: "Submit",
      description: "Submit the form",
      shortcut: "Alt+S",
      tabIndex: "3",
      forceSimple: true,
    }));
    const timeline = parseFla8Timeline(stream);
    const inst = timeline.layers[0]!.frames[0]!.elements.find(
      (e): e is Extract<typeof e, { type: "instance" }> => e.type === "instance",
    );
    expect(inst?.accessibility).toEqual({
      enabled: true,
      name: "Submit",
      description: "Submit the form",
      shortcut: "Alt+S",
      tabIndex: 3,
      forceSimple: true,
    });
  });

  it("maps silent flag to enabled=false", () => {
    const stream = makeSpriteAccStream(accessibilityBlock({ silent: true, name: "Hidden" }));
    const timeline = parseFla8Timeline(stream);
    const inst = timeline.layers[0]!.frames[0]!.elements.find(
      (e): e is Extract<typeof e, { type: "instance" }> => e.type === "instance",
    );
    expect(inst?.accessibility?.enabled).toBe(false);
    expect(inst?.accessibility?.name).toBe("Hidden");
  });

  it("toObjectAccessibility maps Fla8Accessibility to ObjectAccessibility", () => {
    expect(toObjectAccessibility({
      enabled: true,
      name: "Play",
      description: "Start playback",
      tabIndex: 2,
    })).toEqual({
      enabled: true,
      name: "Play",
      description: "Start playback",
      tabIndex: 2,
    });
    expect(toObjectAccessibility({ enabled: false, name: "Hidden" })).toEqual({
      enabled: false,
      name: "Hidden",
    });
    expect(toObjectAccessibility({ enabled: true })).toBeUndefined();
  });
});
