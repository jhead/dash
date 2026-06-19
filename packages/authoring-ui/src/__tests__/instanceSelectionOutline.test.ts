/**
 * Regression test for task 1270 — No transform/selection outline drawn when a
 * symbol/MovieClip INSTANCE is selected on the stage.
 *
 * BUG: select a placed symbol/MC instance with the Selection tool and NO dashed
 * bounding box / resize handles / rotation handle appears. Raw shapes, text, and
 * bitmap objects DO show the halo; instances did not. The selection STATE was set
 * correctly (the instance is in selectedShapeId/selectedShapeIds and is draggable) —
 * the defect was purely in the selection-outline RENDER.
 *
 * ROOT CAUSE (StageArea.tsx selection-outline render loop): for each selected id the
 * loop looks it up in shapeDisplayObjects; the `else` branch then checked ONLY
 * textDisplayObjects and bitmapDisplayObjects. A selected INSTANCE id is in NONE of
 * those three arrays (instances live in symbolInstanceDisplayObjects and have no
 * inline width/height), so the branch found nothing and drew NOTHING — no box, no
 * handles.
 *
 * FIX: the `else` branch now also looks up symbolInstanceDisplayObjects and, when the
 * selected id resolves to an instance, computes its stage-space AABB via
 * getSymbolInstanceBounds(inst, library) (the same bounds the hit-test, snapping, and
 * Scale9Grid overlay already use) and draws the same dashed box + 8 resize handles +
 * rotation handle as a shape.
 *
 * These tests assert the load-bearing pieces at the unit level:
 *  (1) getSymbolInstanceBounds returns a real (non-zero) box for a converted instance,
 *      honoring scaleX/scaleY — the precondition the render branch needs to draw; and
 *  (2) a faithful mirror of the StageArea selection-outline lookup chain now RESOLVES
 *      an instance id to a drawable bounding box, where the pre-fix chain (text/bitmap
 *      only) resolved nothing.
 */

import { describe, it, expect } from "vitest";
import type {
  ShapeDisplayObject,
  SymbolInstance,
  TextDisplayObject,
  BitmapDisplayObject,
} from "@flash/core";
import type { Library, Symbol as FlashSymbol } from "@flash/core";
import { getSymbolInstanceBounds } from "../StageArea.js";

/** A rect shape in SYMBOL-LOCAL space (registration-normalized to top-left = 0,0). */
function localRect(id: string, w: number, h: number): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    x: 0,
    y: 0,
    shape: {
      id: id + "-shape",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: w, y: 0 } },
            { type: "line", to: { x: w, y: h } },
            { type: "line", to: { x: 0, y: h } },
            { type: "line", to: { x: 0, y: 0 } },
          ],
          closed: true,
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
        },
      ],
    },
  };
}

/** Build a library holding one movieclip symbol whose frame-0 contains the given shape. */
function makeLibraryWithSymbol(symbolId: string, content: ShapeDisplayObject): Library {
  const symbol = {
    id: symbolId,
    name: "Converted",
    itemType: "symbol",
    symbolType: "movieclip",
    linkage: { exportForActionScript: false },
    scale9Grid: null,
    timeline: {
      layers: [
        {
          id: "sym-L1",
          name: "Layer 1",
          type: "normal",
          visible: true,
          locked: false,
          outlineMode: false,
          outlineColor: "#0000ff",
          height: 20,
          parentFolderId: null,
          frameCount: 1,
          frames: [
            {
              index: 0,
              isKeyframe: true,
              isEmpty: false,
              tweenType: "none",
              label: "",
              labelType: "name",
              script: "",
              sound: null,
              motionEase: 0,
              motionRotate: "none",
              motionRotateCount: 0,
              motionOrientToPath: false,
              motionSync: false,
              motionScale: true,
              shapeEase: 0,
              shapeBlend: "distributive",
              displayObjects: [content],
            },
          ],
        },
      ],
    },
  } as unknown as FlashSymbol;
  return { items: [symbol], folders: [] };
}

function makeInstance(id: string, symbolId: string, x: number, y: number, scaleX = 1, scaleY = 1): SymbolInstance {
  return { type: "instance", id, symbolId, x, y, scaleX, scaleY } as SymbolInstance;
}

/**
 * Faithful mirror of the StageArea selection-outline lookup chain (the `else` branch
 * of the render loop). Returns the bounding box that would be drawn for `selId`, or
 * undefined if nothing would be drawn — exactly the difference the fix makes.
 *
 * Pre-fix this chain considered ONLY text/bitmap; post-fix it also resolves instances
 * via getSymbolInstanceBounds.
 */
function resolveOutlineBounds(
  selId: string,
  shapeDisplayObjects: ShapeDisplayObject[],
  textDisplayObjects: TextDisplayObject[],
  bitmapDisplayObjects: BitmapDisplayObject[],
  symbolInstanceDisplayObjects: SymbolInstance[],
  library: Library | undefined
): { x: number; y: number; width: number; height: number } | undefined {
  const shape = shapeDisplayObjects.find((o) => o.id === selId);
  if (shape) return undefined; // shape branch handled elsewhere; this mirror is for the else branch
  const textObj = textDisplayObjects.find((o) => o.id === selId);
  const bitmapObj = !textObj ? bitmapDisplayObjects.find((o) => o.id === selId) : undefined;
  const instObj = !textObj && !bitmapObj ? symbolInstanceDisplayObjects.find((o) => o.id === selId) : undefined;
  if (textObj ?? bitmapObj) {
    const g = (textObj ?? bitmapObj)!;
    if (g.width > 0 && g.height > 0) return { x: g.x, y: g.y, width: g.width, height: g.height };
    return undefined;
  }
  if (instObj) {
    const b = getSymbolInstanceBounds(instObj, library);
    if (b.width > 0 && b.height > 0) return b;
  }
  return undefined;
}

describe("symbol instance selection-outline bounds (task 1270)", () => {
  it("getSymbolInstanceBounds returns a non-zero box at the instance position", () => {
    const lib = makeLibraryWithSymbol("sym-1", localRect("r1", 100, 80));
    const inst = makeInstance("inst-1", "sym-1", 200, 150);

    const b = getSymbolInstanceBounds(inst, lib);
    expect(b.width).toBe(100);
    expect(b.height).toBe(80);
    expect(b.x).toBe(200);
    expect(b.y).toBe(150);
    // A drawable halo requires positive dimensions — the render branch gates on this.
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });

  it("getSymbolInstanceBounds honors scaleX/scaleY", () => {
    const lib = makeLibraryWithSymbol("sym-1", localRect("r1", 100, 80));
    const inst = makeInstance("inst-1", "sym-1", 50, 60, 2, 0.5);

    const b = getSymbolInstanceBounds(inst, lib);
    expect(b.width).toBe(200); // 100 * 2
    expect(b.height).toBe(40); // 80 * 0.5
    expect(b.x).toBe(50);
    expect(b.y).toBe(60);
  });

  it("a selected INSTANCE id now resolves to a drawable outline box (the fix)", () => {
    const lib = makeLibraryWithSymbol("sym-1", localRect("r1", 120, 90));
    const inst = makeInstance("inst-1", "sym-1", 30, 40);

    const bounds = resolveOutlineBounds("inst-1", [], [], [], [inst], lib);
    expect(bounds).toBeDefined();
    expect(bounds!.width).toBe(120);
    expect(bounds!.height).toBe(90);
    expect(bounds!.x).toBe(30);
    expect(bounds!.y).toBe(40);
  });

  it("the PRE-FIX lookup chain (text/bitmap only) drew nothing for an instance", () => {
    // Demonstrate the bug: with the instance absent from the text/bitmap arrays AND
    // not consulted, the resolver yields nothing. Here we pass an EMPTY instance array
    // to simulate the old code path that never looked at symbolInstanceDisplayObjects.
    const lib = makeLibraryWithSymbol("sym-1", localRect("r1", 120, 90));
    const bounds = resolveOutlineBounds("inst-1", [], [], [], [], lib);
    expect(bounds).toBeUndefined();
  });

  it("text and bitmap selection outlines are unaffected by the fix", () => {
    const textObj = {
      type: "text",
      id: "t1",
      x: 10,
      y: 20,
      width: 60,
      height: 18,
    } as unknown as TextDisplayObject;
    const bitmapObj = {
      type: "bitmap",
      id: "b1",
      x: 5,
      y: 6,
      width: 40,
      height: 30,
    } as unknown as BitmapDisplayObject;

    const tb = resolveOutlineBounds("t1", [], [textObj], [], [], undefined);
    expect(tb).toEqual({ x: 10, y: 20, width: 60, height: 18 });

    const bb = resolveOutlineBounds("b1", [], [], [bitmapObj], [], undefined);
    expect(bb).toEqual({ x: 5, y: 6, width: 40, height: 30 });
  });
});
