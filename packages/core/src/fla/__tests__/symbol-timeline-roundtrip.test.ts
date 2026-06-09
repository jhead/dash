/**
 * FLA round-trip test: symbol timeline preservation.
 *
 * Builds a document with a MovieClip symbol that has a non-trivial 3-layer
 * timeline, saves it via saveFla(), loads it via loadFla(), and verifies that
 * all layers, frame counts, labels, layer types, and display objects are
 * correctly preserved.
 */

import { describe, it, expect } from "vitest";
import { createDocument } from "../../model/document.js";
import { createLayer, createFrame, createTimeline } from "../../model/timeline.js";
import { createSymbol, addLibraryItem, createSymbolLinkage } from "../../model/library.js";
import { saveFla, loadFla } from "../zip.js";
import type { Symbol } from "../../model/types.js";
import type { ShapeDisplayObject } from "../../engine/types.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal ShapeDisplayObject
// ---------------------------------------------------------------------------
function makeShape(id: string, x: number, y: number): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: {
      id: `inner-${id}`,
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 50, y: 0 } },
            { type: "line", to: { x: 50, y: 50 } },
            { type: "line", to: { x: 0, y: 50 } },
          ],
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
          closed: true,
        },
      ],
    },
    x,
    y,
  };
}

// ---------------------------------------------------------------------------
// Build a document with one MovieClip symbol containing a 3-layer timeline:
//   Layer 0 "shapes"  — 5 frames, keyframe 0 with a ShapeDisplayObject (x=10, y=20)
//   Layer 1 "labels"  — 5 frames, keyframe at index 2 with label "intro"
//   Layer 2 "guide"   — type='guide', 5 frames
// ---------------------------------------------------------------------------
function buildDoc() {
  const shape = makeShape("sym-shape-1", 10, 20);

  const shapesLayer = createLayer("shapes", "normal", {
    frames: [
      createFrame(0, {
        isKeyframe: true,
        isEmpty: false,
        displayObjects: [shape],
      }),
    ],
    frameCount: 5,
  });

  const labelsLayer = createLayer("labels", "normal", {
    frames: [
      createFrame(0, { isKeyframe: true, isEmpty: true }),
      createFrame(2, { isKeyframe: true, isEmpty: true, label: "intro" }),
    ],
    frameCount: 5,
  });

  const guideLayer = createLayer("guide", "guide", {
    frames: [createFrame(0, { isKeyframe: true, isEmpty: true })],
    frameCount: 5,
  });

  const symbol: Symbol = {
    id: "sym-multilayer-1",
    name: "MyClip",
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: {
      layers: [shapesLayer, labelsLayer, guideLayer],
    },
    linkage: createSymbolLinkage(),
    scale9Grid: null,
  };

  const baseDoc = createDocument();
  const library = addLibraryItem(baseDoc.library, symbol);
  return { ...baseDoc, library };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("FLA round-trip: symbol with multi-layer timeline", () => {
  let restoredSymbol: Symbol | undefined;

  // Build once, restore once — shared across all assertions.
  const doc = buildDoc();
  const restored = loadFla(saveFla(doc));
  restoredSymbol = restored.library.items.find(
    (i) => i.id === "sym-multilayer-1"
  ) as Symbol | undefined;

  it("1. library has exactly 1 symbol item", () => {
    expect(restored.library.items).toHaveLength(1);
  });

  it("2. symbol has symbolType 'movieclip'", () => {
    expect(restoredSymbol?.symbolType).toBe("movieclip");
  });

  it("3. symbol timeline has 3 layers", () => {
    expect(restoredSymbol?.timeline.layers).toHaveLength(3);
  });

  it("4. layer 0 is named 'shapes'", () => {
    expect(restoredSymbol?.timeline.layers[0]?.name).toBe("shapes");
  });

  it("5. layer 2 has type 'guide'", () => {
    expect(restoredSymbol?.timeline.layers[2]?.type).toBe("guide");
  });

  it("6. layer 0 has at least 1 frame", () => {
    expect(restoredSymbol?.timeline.layers[0]?.frames.length).toBeGreaterThanOrEqual(1);
  });

  it("7. frame 0 of layer 0 has display objects", () => {
    const frame0 = restoredSymbol?.timeline.layers[0]?.frames.find(
      (f) => f.index === 0
    );
    expect(frame0?.displayObjects.length).toBeGreaterThan(0);
  });

  it("8. the ShapeDisplayObject at frame 0 of layer 0 has x=10, y=20", () => {
    const frame0 = restoredSymbol?.timeline.layers[0]?.frames.find(
      (f) => f.index === 0
    );
    const obj = frame0?.displayObjects[0] as ShapeDisplayObject | undefined;
    expect(obj?.type).toBe("shape");
    expect(obj?.x).toBe(10);
    expect(obj?.y).toBe(20);
  });

  it("9. frame 2 of layer 1 has label 'intro'", () => {
    const frame2 = restoredSymbol?.timeline.layers[1]?.frames.find(
      (f) => f.index === 2
    );
    expect(frame2?.label).toBe("intro");
  });
});
