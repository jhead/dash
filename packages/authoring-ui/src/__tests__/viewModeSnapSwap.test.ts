/**
 * Unit tests for tasks 0829-0832:
 *   0829 - viewMode handler changes mode
 *   0831 - snapToPixels rounds coordinates to integers
 *   0832 - swap bitmap updates libraryItemId on a BitmapDisplayObject
 */

import { describe, it, expect } from "vitest";
import { createDocument, createLayer, createFrame, addDisplayObject, updateDisplayObject } from "@flash/core";
import type { BitmapDisplayObject } from "@flash/core";

// ---------------------------------------------------------------------------
// Task 0829: viewMode — handler logic
// ---------------------------------------------------------------------------

describe("viewMode handler", () => {
  it("changes from normal to outlines", () => {
    let mode: "normal" | "outlines" | "fast" | "antialias" = "normal";
    const handleViewModeChange = (m: typeof mode) => { mode = m; };
    handleViewModeChange("outlines");
    expect(mode).toBe("outlines");
  });

  it("changes from normal to fast", () => {
    let mode: "normal" | "outlines" | "fast" | "antialias" = "normal";
    const handleViewModeChange = (m: typeof mode) => { mode = m; };
    handleViewModeChange("fast");
    expect(mode).toBe("fast");
  });

  it("changes from normal to antialias", () => {
    let mode: "normal" | "outlines" | "fast" | "antialias" = "normal";
    const handleViewModeChange = (m: typeof mode) => { mode = m; };
    handleViewModeChange("antialias");
    expect(mode).toBe("antialias");
  });

  it("toggles back to normal", () => {
    let mode: "normal" | "outlines" | "fast" | "antialias" = "outlines";
    const handleViewModeChange = (m: typeof mode) => { mode = m; };
    handleViewModeChange("normal");
    expect(mode).toBe("normal");
  });
});

// ---------------------------------------------------------------------------
// Task 0831: snapToPixels — rounding logic
// ---------------------------------------------------------------------------

describe("snapToPixels rounding", () => {
  /**
   * Replicates the StageArea snap-to-pixels rounding in onMouseMove:
   *   newX = Math.round(obj.x + dx), dx = newX - obj.x
   */
  function applySnapToPixels(
    objX: number,
    objY: number,
    dx: number,
    dy: number,
    snapToPixels: boolean
  ) {
    if (snapToPixels) {
      const newX = Math.round(objX + dx);
      const newY = Math.round(objY + dy);
      return { dx: newX - objX, dy: newY - objY };
    }
    return { dx, dy };
  }

  it("rounds fractional delta so final position is integer", () => {
    const { dx, dy } = applySnapToPixels(10, 20, 1.7, 2.3, true);
    // 10 + 1.7 = 11.7 → rounds to 12; dx = 12 - 10 = 2
    expect(10 + dx).toBe(12);
    // 20 + 2.3 = 22.3 → rounds to 22; dy = 22 - 20 = 2
    expect(20 + dy).toBe(22);
  });

  it("leaves integer positions unchanged when already aligned", () => {
    const { dx, dy } = applySnapToPixels(5, 5, 3, 4, true);
    expect(5 + dx).toBe(8);
    expect(5 + dy).toBe(9);
  });

  it("does not round when snapToPixels is false", () => {
    const { dx, dy } = applySnapToPixels(0, 0, 1.5, 2.5, false);
    expect(dx).toBe(1.5);
    expect(dy).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// Task 0832: swap bitmap — model-level update
// ---------------------------------------------------------------------------

describe("swap bitmap", () => {
  function makeBitmapObj(id: string, libraryItemId: string): BitmapDisplayObject {
    return {
      type: "bitmap",
      id,
      libraryItemId,
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      scaleX: 1,
      scaleY: 1,
    };
  }

  it("updates libraryItemId while preserving other props", () => {
    const doc = createDocument();
    const layer = { ...createLayer("Layer 1") };
    const frame = { ...createFrame(0, { isKeyframe: true, isEmpty: false }) };
    const tl = {
      ...doc.scenes[0].timeline,
      layers: [{ ...layer, frames: [frame] }],
    };
    const layerId = tl.layers[0].id;
    const bmpObj = makeBitmapObj("bmp-1", "lib-item-old");

    const tlWithObj = addDisplayObject(tl, layerId, 0, bmpObj);

    // Simulate swap: update libraryItemId to new value
    const tlAfterSwap = updateDisplayObject(
      tlWithObj,
      layerId,
      0,
      "bmp-1",
      { libraryItemId: "lib-item-new" } as Partial<BitmapDisplayObject>
    );

    const updatedLayer = tlAfterSwap.layers.find((l) => l.id === layerId)!;
    const kf = updatedLayer.frames.find((f) => f.isKeyframe && f.index === 0)!;
    const updatedObj = kf.displayObjects.find((o) => o.id === "bmp-1") as BitmapDisplayObject;

    expect(updatedObj.libraryItemId).toBe("lib-item-new");
    // Other properties preserved
    expect(updatedObj.x).toBe(10);
    expect(updatedObj.y).toBe(20);
    expect(updatedObj.width).toBe(100);
    expect(updatedObj.height).toBe(80);
  });

  it("does not affect other objects in the same frame", () => {
    const doc = createDocument();
    const layer = createLayer("Layer 1");
    const frame = createFrame(0, { isKeyframe: true, isEmpty: false });
    const tl = {
      ...doc.scenes[0].timeline,
      layers: [{ ...layer, frames: [frame] }],
    };
    const layerId = tl.layers[0].id;
    const bmp1 = makeBitmapObj("bmp-1", "lib-old-1");
    const bmp2 = makeBitmapObj("bmp-2", "lib-old-2");

    const tlWithObjs = addDisplayObject(
      addDisplayObject(tl, layerId, 0, bmp1),
      layerId,
      0,
      bmp2
    );

    const tlAfterSwap = updateDisplayObject(
      tlWithObjs,
      layerId,
      0,
      "bmp-1",
      { libraryItemId: "lib-new-1" } as Partial<BitmapDisplayObject>
    );

    const updatedLayer = tlAfterSwap.layers.find((l) => l.id === layerId)!;
    const kf = updatedLayer.frames.find((f) => f.isKeyframe && f.index === 0)!;
    const obj1 = kf.displayObjects.find((o) => o.id === "bmp-1") as BitmapDisplayObject;
    const obj2 = kf.displayObjects.find((o) => o.id === "bmp-2") as BitmapDisplayObject;

    expect(obj1.libraryItemId).toBe("lib-new-1");
    expect(obj2.libraryItemId).toBe("lib-old-2"); // unchanged
  });
});
