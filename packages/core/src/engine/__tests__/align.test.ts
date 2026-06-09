/**
 * Unit tests for align.ts — alignObjects and distributeObjects.
 */

import { describe, it, expect } from "vitest";
import { alignObjects, distributeObjects } from "../align.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { BitmapDisplayObject, DisplayObject } from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a simple bitmap display object at (x, y) with given dimensions.
 * Bitmaps have explicit width/height which makes bound calculations simple.
 */
function makeBitmap(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number
): BitmapDisplayObject {
  return {
    type: "bitmap",
    id,
    libraryItemId: `lib-${id}`,
    x,
    y,
    width,
    height,
  };
}

/**
 * Create a single-scene document with one layer whose frame 0 contains
 * the given display objects.
 */
function makeDoc(objects: DisplayObject[]): FlashDocument {
  const frame = createFrame(0, {
    isKeyframe: true,
    isEmpty: objects.length === 0,
    displayObjects: objects,
  });
  const layer = createLayer("Layer 1", "normal", {
    frames: [frame],
    frameCount: 1,
  });
  const doc = createDocument();
  return {
    ...doc,
    scenes: [
      {
        ...doc.scenes[0],
        timeline: createTimeline({ layers: [layer] }),
      },
    ],
  };
}

/** Extract display objects from scene 0 / layer 0 / frame 0. */
function getObjects(doc: FlashDocument): readonly DisplayObject[] {
  const kf = doc.scenes[0].timeline.layers[0].frames.find(
    (f) => f.isKeyframe && f.index === 0
  );
  return kf?.displayObjects ?? [];
}

/** Get a single object by id. */
function getById(doc: FlashDocument, id: string): DisplayObject | undefined {
  return getObjects(doc).find((o) => o.id === id);
}

function xOf(doc: FlashDocument, id: string): number {
  return (getById(doc, id) as BitmapDisplayObject).x;
}

function yOf(doc: FlashDocument, id: string): number {
  return (getById(doc, id) as BitmapDisplayObject).y;
}

// Default stage: 550 × 400 (createDocument defaults)

// ---------------------------------------------------------------------------
// alignLeft
// ---------------------------------------------------------------------------

describe("alignObjects — left", () => {
  it("aligns all selected objects to the leftmost left edge", () => {
    // a at x=10, b at x=50, c at x=30 → target left = 10
    const a = makeBitmap("a", 10, 0, 50, 50);
    const b = makeBitmap("b", 50, 0, 50, 50);
    const c = makeBitmap("c", 30, 0, 50, 50);
    const doc = makeDoc([a, b, c]);

    const result = alignObjects(doc, 0, 0, 0, ["a", "b", "c"], "left", false);

    expect(xOf(result, "a")).toBe(10);
    expect(xOf(result, "b")).toBe(10);
    expect(xOf(result, "c")).toBe(10);
  });

  it("alignToStage=true aligns to x=0", () => {
    const a = makeBitmap("a", 100, 0, 50, 50);
    const b = makeBitmap("b", 200, 0, 50, 50);
    const doc = makeDoc([a, b]);

    const result = alignObjects(doc, 0, 0, 0, ["a", "b"], "left", true);

    expect(xOf(result, "a")).toBe(0);
    expect(xOf(result, "b")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// alignRight
// ---------------------------------------------------------------------------

describe("alignObjects — right", () => {
  it("aligns all selected objects to the rightmost right edge", () => {
    // a right edge = 10+50=60, b right edge = 50+50=100, c right edge = 30+50=80 → target = 100
    const a = makeBitmap("a", 10, 0, 50, 50);
    const b = makeBitmap("b", 50, 0, 50, 50);
    const c = makeBitmap("c", 30, 0, 50, 50);
    const doc = makeDoc([a, b, c]);

    const result = alignObjects(doc, 0, 0, 0, ["a", "b", "c"], "right", false);

    // Each object's right edge should equal 100 → x = 100 - width
    expect(xOf(result, "a")).toBe(50);  // 100 - 50
    expect(xOf(result, "b")).toBe(50);  // 100 - 50
    expect(xOf(result, "c")).toBe(50);  // 100 - 50
  });

  it("alignToStage=true aligns right edges to stageWidth", () => {
    const a = makeBitmap("a", 0, 0, 50, 50);
    const b = makeBitmap("b", 100, 0, 60, 50);
    const doc = makeDoc([a, b]);
    const stageWidth = doc.properties.width; // 550

    const result = alignObjects(doc, 0, 0, 0, ["a", "b"], "right", true);

    expect(xOf(result, "a")).toBe(stageWidth - 50); // 500
    expect(xOf(result, "b")).toBe(stageWidth - 60); // 490
  });
});

// ---------------------------------------------------------------------------
// alignTop
// ---------------------------------------------------------------------------

describe("alignObjects — top", () => {
  it("aligns all selected objects to the topmost top edge", () => {
    const a = makeBitmap("a", 0, 20, 50, 50);
    const b = makeBitmap("b", 0, 80, 50, 50);
    const c = makeBitmap("c", 0, 5, 50, 50);  // topmost
    const doc = makeDoc([a, b, c]);

    const result = alignObjects(doc, 0, 0, 0, ["a", "b", "c"], "top", false);

    expect(yOf(result, "a")).toBe(5);
    expect(yOf(result, "b")).toBe(5);
    expect(yOf(result, "c")).toBe(5);
  });

  it("alignToStage=true aligns top edges to y=0", () => {
    const a = makeBitmap("a", 0, 50, 50, 50);
    const b = makeBitmap("b", 0, 150, 50, 70);
    const doc = makeDoc([a, b]);

    const result = alignObjects(doc, 0, 0, 0, ["a", "b"], "top", true);

    expect(yOf(result, "a")).toBe(0);
    expect(yOf(result, "b")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// alignBottom
// ---------------------------------------------------------------------------

describe("alignObjects — bottom", () => {
  it("aligns all selected objects to the bottommost bottom edge", () => {
    // a bottom = 20+50=70, b bottom = 80+50=130, c bottom = 5+50=55 → target = 130
    const a = makeBitmap("a", 0, 20, 50, 50);
    const b = makeBitmap("b", 0, 80, 50, 50);
    const c = makeBitmap("c", 0, 5, 50, 50);
    const doc = makeDoc([a, b, c]);

    const result = alignObjects(doc, 0, 0, 0, ["a", "b", "c"], "bottom", false);

    // Each y = 130 - 50 = 80
    expect(yOf(result, "a")).toBe(80);
    expect(yOf(result, "b")).toBe(80);
    expect(yOf(result, "c")).toBe(80);
  });

  it("alignToStage=true aligns bottom edges to stageHeight", () => {
    const a = makeBitmap("a", 0, 0, 50, 50);
    const b = makeBitmap("b", 0, 100, 50, 80);
    const doc = makeDoc([a, b]);
    const stageHeight = doc.properties.height; // 400

    const result = alignObjects(doc, 0, 0, 0, ["a", "b"], "bottom", true);

    expect(yOf(result, "a")).toBe(stageHeight - 50);  // 350
    expect(yOf(result, "b")).toBe(stageHeight - 80);  // 320
  });
});

// ---------------------------------------------------------------------------
// hCenter
// ---------------------------------------------------------------------------

describe("alignObjects — hCenter", () => {
  it("aligns horizontal centers to mean of centers", () => {
    // a center = 0+25=25, b center = 100+25=125 → mean = 75
    const a = makeBitmap("a", 0, 0, 50, 50);
    const b = makeBitmap("b", 100, 0, 50, 50);
    const doc = makeDoc([a, b]);

    const result = alignObjects(doc, 0, 0, 0, ["a", "b"], "hCenter", false);

    // target=75; a.x = 75 - 25 = 50; b.x = 75 - 25 = 50
    expect(xOf(result, "a")).toBe(50);
    expect(xOf(result, "b")).toBe(50);
  });

  it("alignToStage=true aligns horizontal centers to stageWidth/2", () => {
    const a = makeBitmap("a", 0, 0, 100, 50);
    const b = makeBitmap("b", 300, 0, 60, 50);
    const doc = makeDoc([a, b]);
    const stageCenter = doc.properties.width / 2; // 275

    const result = alignObjects(doc, 0, 0, 0, ["a", "b"], "hCenter", true);

    // a.x = 275 - 50 = 225; b.x = 275 - 30 = 245
    expect(xOf(result, "a")).toBe(stageCenter - 50);
    expect(xOf(result, "b")).toBe(stageCenter - 30);
  });
});

// ---------------------------------------------------------------------------
// vCenter
// ---------------------------------------------------------------------------

describe("alignObjects — vCenter", () => {
  it("aligns vertical centers to mean of centers", () => {
    // a center = 0+25=25, b center = 100+25=125 → mean = 75
    const a = makeBitmap("a", 0, 0, 50, 50);
    const b = makeBitmap("b", 0, 100, 50, 50);
    const doc = makeDoc([a, b]);

    const result = alignObjects(doc, 0, 0, 0, ["a", "b"], "vCenter", false);

    // target=75; a.y = 75-25=50; b.y = 75-25=50
    expect(yOf(result, "a")).toBe(50);
    expect(yOf(result, "b")).toBe(50);
  });

  it("alignToStage=true aligns vertical centers to stageHeight/2", () => {
    const a = makeBitmap("a", 0, 0, 50, 100);
    const b = makeBitmap("b", 0, 300, 50, 60);
    const doc = makeDoc([a, b]);
    const stageCenter = doc.properties.height / 2; // 200

    const result = alignObjects(doc, 0, 0, 0, ["a", "b"], "vCenter", true);

    // a.y = 200 - 50 = 150; b.y = 200 - 30 = 170
    expect(yOf(result, "a")).toBe(stageCenter - 50);
    expect(yOf(result, "b")).toBe(stageCenter - 30);
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("alignObjects — immutability", () => {
  it("returns a new document reference", () => {
    const a = makeBitmap("a", 10, 0, 50, 50);
    const b = makeBitmap("b", 50, 0, 50, 50);
    const doc = makeDoc([a, b]);

    const result = alignObjects(doc, 0, 0, 0, ["a", "b"], "left", false);

    expect(result).not.toBe(doc);
  });

  it("does not mutate the original document", () => {
    const a = makeBitmap("a", 10, 0, 50, 50);
    const b = makeBitmap("b", 50, 0, 50, 50);
    const doc = makeDoc([a, b]);
    const origX = xOf(doc, "b");

    alignObjects(doc, 0, 0, 0, ["a", "b"], "left", false);

    // Original doc's b.x must still be 50
    expect(xOf(doc, "b")).toBe(origX);
  });

  it("returns doc unchanged when objectIds is empty", () => {
    const a = makeBitmap("a", 10, 0, 50, 50);
    const doc = makeDoc([a]);

    const result = alignObjects(doc, 0, 0, 0, [], "left", false);

    expect(result).toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// alignObjects — single object / edge cases
// ---------------------------------------------------------------------------

describe("alignObjects — single object", () => {
  it("single object align left: position unchanged (nothing to align to)", () => {
    // With a single object, the target is the object's own left edge, so it's a no-op
    const a = makeBitmap("a", 42, 10, 50, 50);
    const doc = makeDoc([a]);

    const result = alignObjects(doc, 0, 0, 0, ["a"], "left", false);

    // Should return same x since target IS its own left edge
    expect(xOf(result, "a")).toBe(42);
  });

  it("two objects aligned left: both end up at same x", () => {
    const a = makeBitmap("a", 10, 0, 50, 50);
    const b = makeBitmap("b", 80, 0, 50, 50);
    const doc = makeDoc([a, b]);

    const result = alignObjects(doc, 0, 0, 0, ["a", "b"], "left", false);

    // Both should be at x=10 (leftmost edge)
    expect(xOf(result, "a")).toBe(10);
    expect(xOf(result, "b")).toBe(10);
    expect(xOf(result, "a")).toBe(xOf(result, "b"));
  });

  it("unknown object IDs are skipped gracefully", () => {
    const a = makeBitmap("a", 10, 0, 50, 50);
    const doc = makeDoc([a]);

    // "ghost" does not exist in the document
    const result = alignObjects(doc, 0, 0, 0, ["a", "ghost"], "left", false);

    // "a" is still in the result, "ghost" is just ignored
    expect(getById(result, "a")).toBeDefined();
    expect(getById(result, "ghost")).toBeUndefined();
    expect(xOf(result, "a")).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// distributeObjects — horizontal
// ---------------------------------------------------------------------------

describe("distributeObjects — horizontal", () => {
  it("spaces objects evenly along the x axis", () => {
    // Objects at x=0(w=50), x=200(w=50), x=350(w=50)
    // Span = 350+50 - 0 = 400; sumWidths = 150; gap = (400-150)/(3-1) = 125
    // Expected positions: 0, 0+50+125=175, 175+50+125=350
    const a = makeBitmap("a", 0, 0, 50, 50);
    const b = makeBitmap("b", 200, 0, 50, 50);  // will be moved
    const c = makeBitmap("c", 350, 0, 50, 50);
    const doc = makeDoc([a, b, c]);

    const result = distributeObjects(doc, 0, 0, 0, ["a", "b", "c"], "horizontal");

    expect(xOf(result, "a")).toBeCloseTo(0, 5);
    expect(xOf(result, "b")).toBeCloseTo(175, 5);
    expect(xOf(result, "c")).toBeCloseTo(350, 5);
  });

  it("evenly spaces objects with different widths", () => {
    // a at x=0(w=100), b at x=200(w=60), c at x=400(w=40)
    // Span = 400+40 - 0 = 440; sumWidths = 200; gap = (440-200)/2 = 120
    // positions: a at 0, b at 0+100+120=220, c at 220+60+120=400
    const a = makeBitmap("a", 0, 0, 100, 50);
    const b = makeBitmap("b", 200, 0, 60, 50);
    const c = makeBitmap("c", 400, 0, 40, 50);
    const doc = makeDoc([a, b, c]);

    const result = distributeObjects(doc, 0, 0, 0, ["a", "b", "c"], "horizontal");

    expect(xOf(result, "a")).toBeCloseTo(0, 5);
    expect(xOf(result, "b")).toBeCloseTo(220, 5);
    expect(xOf(result, "c")).toBeCloseTo(400, 5);
  });
});

// ---------------------------------------------------------------------------
// distributeObjects — vertical
// ---------------------------------------------------------------------------

describe("distributeObjects — vertical", () => {
  it("spaces objects evenly along the y axis", () => {
    // a at y=0(h=50), b at y=200(h=50), c at y=350(h=50)
    // Span = 350+50 - 0 = 400; sumHeights = 150; gap = (400-150)/2 = 125
    // Expected: a at 0, b at 175, c at 350
    const a = makeBitmap("a", 0, 0, 50, 50);
    const b = makeBitmap("b", 0, 200, 50, 50);
    const c = makeBitmap("c", 0, 350, 50, 50);
    const doc = makeDoc([a, b, c]);

    const result = distributeObjects(doc, 0, 0, 0, ["a", "b", "c"], "vertical");

    expect(yOf(result, "a")).toBeCloseTo(0, 5);
    expect(yOf(result, "b")).toBeCloseTo(175, 5);
    expect(yOf(result, "c")).toBeCloseTo(350, 5);
  });

  it("evenly spaces objects with different heights", () => {
    // a at y=0(h=100), b at y=200(h=60), c at y=400(h=40)
    // Span = 400+40 - 0 = 440; sumHeights = 200; gap = (440-200)/2 = 120
    // positions: a at 0, b at 220, c at 400
    const a = makeBitmap("a", 0, 0, 50, 100);
    const b = makeBitmap("b", 0, 200, 50, 60);
    const c = makeBitmap("c", 0, 400, 50, 40);
    const doc = makeDoc([a, b, c]);

    const result = distributeObjects(doc, 0, 0, 0, ["a", "b", "c"], "vertical");

    expect(yOf(result, "a")).toBeCloseTo(0, 5);
    expect(yOf(result, "b")).toBeCloseTo(220, 5);
    expect(yOf(result, "c")).toBeCloseTo(400, 5);
  });
});

// ---------------------------------------------------------------------------
// distributeObjects — edge cases
// ---------------------------------------------------------------------------

describe("distributeObjects — edge cases", () => {
  it("three objects: middle moves to exact midpoint between outer two", () => {
    // a at x=0(w=50), b at x=300(w=50) (middle), c at x=500(w=50) (rightmost)
    // Span = 500+50 - 0 = 550; sumWidths = 150; gap = (550-150)/2 = 200
    // Expected: a=0, b=0+50+200=250, c=500
    const a = makeBitmap("a", 0, 0, 50, 50);
    const b = makeBitmap("b", 300, 0, 50, 50);
    const c = makeBitmap("c", 500, 0, 50, 50);
    const doc = makeDoc([a, b, c]);

    const result = distributeObjects(doc, 0, 0, 0, ["a", "b", "c"], "horizontal");

    expect(xOf(result, "a")).toBeCloseTo(0, 5);
    expect(xOf(result, "b")).toBeCloseTo(250, 5);
    expect(xOf(result, "c")).toBeCloseTo(500, 5);
  });

  it("two objects: distribute is a no-op (leaves them in place)", () => {
    const a = makeBitmap("a", 0, 0, 50, 50);
    const b = makeBitmap("b", 100, 0, 50, 50);
    const doc = makeDoc([a, b]);

    const result = distributeObjects(doc, 0, 0, 0, ["a", "b"], "horizontal");

    expect(result).toBe(doc);
  });

  it("returns doc unchanged with fewer than 3 objects", () => {
    const a = makeBitmap("a", 0, 0, 50, 50);
    const b = makeBitmap("b", 100, 0, 50, 50);
    const doc = makeDoc([a, b]);

    const result = distributeObjects(doc, 0, 0, 0, ["a", "b"], "horizontal");

    expect(result).toBe(doc);
  });

  it("returns doc unchanged with 0 objects", () => {
    const doc = makeDoc([]);

    const result = distributeObjects(doc, 0, 0, 0, [], "horizontal");

    expect(result).toBe(doc);
  });

  it("returns doc unchanged with 1 object", () => {
    const a = makeBitmap("a", 0, 0, 50, 50);
    const doc = makeDoc([a]);

    const result = distributeObjects(doc, 0, 0, 0, ["a"], "horizontal");

    expect(result).toBe(doc);
  });

  it("returns a new document reference (immutable)", () => {
    const a = makeBitmap("a", 0, 0, 50, 50);
    const b = makeBitmap("b", 100, 0, 50, 50);
    const c = makeBitmap("c", 300, 0, 50, 50);
    const doc = makeDoc([a, b, c]);

    const result = distributeObjects(doc, 0, 0, 0, ["a", "b", "c"], "horizontal");

    expect(result).not.toBe(doc);
  });

  it("does not mutate original document", () => {
    const a = makeBitmap("a", 0, 0, 50, 50);
    const b = makeBitmap("b", 200, 0, 50, 50);
    const c = makeBitmap("c", 350, 0, 50, 50);
    const doc = makeDoc([a, b, c]);
    const origBX = xOf(doc, "b");

    distributeObjects(doc, 0, 0, 0, ["a", "b", "c"], "horizontal");

    expect(xOf(doc, "b")).toBe(origBX);
  });
});
