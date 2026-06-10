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
import { parseClipActions, toColorEffect } from "../flash8-import.js";
import type { Fla8ColorEffect } from "../flash8-binary.js";
import type { FlashDocument, Symbol as SymbolItem } from "../../model/types.js";
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
  });

  it("rejects a non-timeline stream with a descriptive error", () => {
    expect(() => parseFla8Timeline(new Uint8Array([0x42, 0x00, 0x00]))).toThrow(
      /root marker/,
    );
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
