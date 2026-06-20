/**
 * Unit tests for the JSFL runtime.
 *
 * These tests verify that the Flash 8 JSFL automation API surface works
 * correctly as a pure TypeScript sandbox (no browser/DOM required).
 */
import { describe, it, expect } from "vitest";
import { createDocument, buildArrangementFromShapes, faceArea } from "@flash/core";
import { runJsfl, buildJsflContext } from "../runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides?: Parameters<typeof createDocument>[0]) {
  const doc = createDocument(overrides);
  return buildJsflContext(doc, 0, 0);
}

// ---------------------------------------------------------------------------
// fl.trace()
// ---------------------------------------------------------------------------

describe("fl.trace()", () => {
  it("captures trace output in the result", () => {
    const ctx = makeContext();
    const result = runJsfl(`fl.trace("hello");`, ctx);
    expect(result.traces).toEqual(["hello"]);
  });

  it("captures multiple traces in order", () => {
    const ctx = makeContext();
    const result = runJsfl(
      `fl.trace("first"); fl.trace("second"); fl.trace("third");`,
      ctx
    );
    expect(result.traces).toEqual(["first", "second", "third"]);
  });
});

// ---------------------------------------------------------------------------
// fl.getDocumentDOM()
// ---------------------------------------------------------------------------

describe("fl.getDocumentDOM()", () => {
  it("returns the document proxy", () => {
    const ctx = makeContext();
    const result = runJsfl(`fl.getDocumentDOM();`, ctx);
    // No error means it returned successfully
    expect(result.error).toBeUndefined();
  });

  it("fl.version is '8,0,0,0'", () => {
    const ctx = makeContext();
    const result = runJsfl(`fl.trace(fl.version);`, ctx);
    expect(result.traces).toEqual(["8,0,0,0"]);
  });
});

// ---------------------------------------------------------------------------
// doc.width / doc.height / doc.frameRate
// ---------------------------------------------------------------------------

describe("document properties", () => {
  it("doc.width returns 550 (Flash default)", () => {
    const ctx = makeContext();
    const result = runJsfl(`fl.trace(fl.getDocumentDOM().width);`, ctx);
    expect(result.traces).toEqual(["550"]);
  });

  it("doc.height returns 400 (Flash default)", () => {
    const ctx = makeContext();
    const result = runJsfl(`fl.trace(fl.getDocumentDOM().height);`, ctx);
    expect(result.traces).toEqual(["400"]);
  });

  it("doc.frameRate returns 12 (Flash default)", () => {
    const ctx = makeContext();
    const result = runJsfl(`fl.trace(fl.getDocumentDOM().frameRate);`, ctx);
    expect(result.traces).toEqual(["12"]);
  });
});

// ---------------------------------------------------------------------------
// doc.addNewRectangle()
// ---------------------------------------------------------------------------

describe("doc.addNewRectangle()", () => {
  it("adds a shape to the timeline", () => {
    const ctx = makeContext();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:10, top:10, right:110, bottom:110}, 0);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.finalDocument).toBeDefined();
    const scene = result.finalDocument!.scenes[0];
    const layer = scene.timeline.layers[0];
    const kf = layer.frames.find((f) => f.isKeyframe && f.index === 0);
    expect(kf?.displayObjects.length).toBeGreaterThan(0);
    expect(kf?.displayObjects[0].type).toBe("shape");
  });
});

// ---------------------------------------------------------------------------
// Merge-on-commit parity (task 1328): JSFL shape creation routes through the
// SHARED commitShapeToTimeline helper, so two overlapping rects/lines a JSFL
// script draws merge IDENTICALLY to the interactive UI draw path — same-color
// UNION, different-color CUT, line-splits-fill (docs/36-vector-merge-model.md).
// ---------------------------------------------------------------------------

describe("JSFL shape creation — merge-on-commit parity", () => {
  function sceneShapeAreas(doc: import("@flash/core").FlashDocument) {
    const kf = doc.scenes[0].timeline.layers[0].frames.find((f) => f.isKeyframe && f.index === 0)!;
    const shapes = kf.displayObjects
      .filter((o): o is import("@flash/core").ShapeDisplayObject => o.type === "shape")
      .map((o) => o.shape);
    const ps = buildArrangementFromShapes(shapes);
    const areaOf = (r: number, g: number, b: number) => {
      const idx = ps.fills.findIndex(
        (f) => f.type === "solid" && f.color.r === r && f.color.g === g && f.color.b === b
      );
      let a = 0;
      for (const face of ps.faces) if (!face.unbounded && face.fill === idx) a += faceArea(ps, face);
      return a;
    };
    return { count: kf.displayObjects.length, areaOf };
  }

  it("two same-color JSFL rects UNION into one merged region", () => {
    const ctx = makeContext();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.setFillColor("#0000ff"); doc.setStrokeColor("#0000ff");
       doc.addNewRectangle({left:0, top:0, right:100, bottom:100}, 0);
       doc.addNewRectangle({left:50, top:0, right:150, bottom:100}, 0);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const { count, areaOf } = sceneShapeAreas(result.finalDocument!);
    expect(count).toBe(1);
    expect(areaOf(0, 0, 255)).toBeCloseTo(15000, 0);
  });

  it("a red JSFL rect over a blue one CUTS the blue (top wins)", () => {
    const ctx = makeContext();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.setFillColor("#0000ff"); doc.setStrokeColor("#0000ff");
       doc.addNewRectangle({left:0, top:0, right:100, bottom:100}, 0);
       doc.setFillColor("#ff0000"); doc.setStrokeColor("#ff0000");
       doc.addNewRectangle({left:50, top:0, right:150, bottom:100}, 0);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const { areaOf } = sceneShapeAreas(result.finalDocument!);
    expect(areaOf(255, 0, 0)).toBeCloseTo(10000, 0);
    expect(areaOf(0, 0, 255)).toBeCloseTo(5000, 0);
  });

  it("a JSFL line drawn across a JSFL fill SPLITS it into two faces", () => {
    const ctx = makeContext();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.setFillColor("#0000ff"); doc.setStrokeColor("#0000ff");
       doc.addNewRectangle({left:0, top:0, right:100, bottom:100}, 0);
       doc.addNewLine({x:50, y:-10}, {x:50, y:110});`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const kf = result.finalDocument!.scenes[0].timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    )!;
    const shapes = kf.displayObjects
      .filter((o): o is import("@flash/core").ShapeDisplayObject => o.type === "shape")
      .map((o) => o.shape);
    const ps = buildArrangementFromShapes(shapes);
    const blueIdx = ps.fills.findIndex((f) => f.type === "solid" && f.color.b === 255 && f.color.r === 0);
    const blueFaces = ps.faces.filter((f) => !f.unbounded && f.fill === blueIdx);
    // The line splits the fill into TWO independently-traceable faces.
    expect(blueFaces.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// doc.addNewOval()
// ---------------------------------------------------------------------------

describe("doc.addNewOval()", () => {
  it("adds an oval shape to the timeline", () => {
    const ctx = makeContext();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewOval({left:0, top:0, right:100, bottom:100});`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.finalDocument).toBeDefined();
    const scene = result.finalDocument!.scenes[0];
    const layer = scene.timeline.layers[0];
    const kf = layer.frames.find((f) => f.isKeyframe && f.index === 0);
    expect(kf?.displayObjects.length).toBeGreaterThan(0);
    expect(kf?.displayObjects[0].type).toBe("shape");
  });
});

// ---------------------------------------------------------------------------
// doc.addNewText()
// ---------------------------------------------------------------------------

describe("doc.addNewText()", () => {
  it("adds a text field to the timeline", () => {
    const ctx = makeContext();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewText({left:10, top:10, right:200, bottom:30}, "Hello JSFL");`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.finalDocument).toBeDefined();
    const scene = result.finalDocument!.scenes[0];
    const layer = scene.timeline.layers[0];
    const kf = layer.frames.find((f) => f.isKeyframe && f.index === 0);
    const textObj = kf?.displayObjects.find((o) => o.type === "text");
    expect(textObj).toBeDefined();
    expect((textObj as { text?: string }).text).toBe("Hello JSFL");
  });
});

// ---------------------------------------------------------------------------
// doc.selectAll()
// ---------------------------------------------------------------------------

describe("doc.selectAll()", () => {
  it("populates doc.selection with all objects in the current frame", () => {
    const ctx = makeContext();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:0, top:0, right:50, bottom:50}, 0);
       doc.addNewOval({left:60, top:0, right:110, bottom:50});
       doc.selectAll();
       fl.trace(doc.selection.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    // Two objects were added, so selection should contain 2
    expect(result.traces).toContain("2");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("returns error field for thrown script errors", () => {
    const ctx = makeContext();
    const result = runJsfl(`throw new Error("oops");`, ctx);
    expect(result.error).toBe("oops");
  });

  it("still returns any traces emitted before the error", () => {
    const ctx = makeContext();
    const result = runJsfl(
      `fl.trace("before error");
       throw new Error("boom");`,
      ctx
    );
    expect(result.traces).toEqual(["before error"]);
    expect(result.error).toBe("boom");
  });

  it("returns empty traces array when no trace calls are made", () => {
    const ctx = makeContext();
    const result = runJsfl(`var x = 1 + 1;`, ctx);
    expect(result.traces).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});
