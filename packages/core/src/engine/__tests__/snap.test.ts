/**
 * Unit tests for snapObjects.ts — document-aware snap-to-objects helper.
 * Also covers snapToGrid and snapToGuides from snap.ts.
 */

import { describe, it, expect } from "vitest";
import { snapToObjects } from "../snapObjects.js";
import { snapToGrid, snapToGuides } from "../snap.js";
import type { Guide } from "../../model/types.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { BitmapDisplayObject, DisplayObject } from "../types.js";
import type { Bounds } from "../bounds.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeBitmap(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number
): BitmapDisplayObject {
  return { type: "bitmap", id, libraryItemId: `lib-${id}`, x, y, width, height };
}

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

function bounds(x: number, y: number, width: number, height: number): Bounds {
  return { x, y, width, height };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("snapToObjects — no snap when no other objects exist", () => {
  it("returns original position when frame has no other objects", () => {
    const moving = makeBitmap("a", 100, 100, 50, 50);
    const doc = makeDoc([moving]);
    const movingBounds = bounds(100, 100, 50, 50);

    const result = snapToObjects(doc, 0, 0, 0, "a", movingBounds, 5);

    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.snappedX).toBe(false);
    expect(result.snappedY).toBe(false);
  });
});

describe("snapToObjects — snaps left edge to right edge of nearby object", () => {
  it("snaps when moving left edge is within threshold of other right edge", () => {
    // other object: x=0, width=100 → right edge at x=100
    // moving object proposed left edge at x=103 (delta=3, within threshold=5)
    // expected snap: move left edge to 100, so x becomes 100
    const other = makeBitmap("other", 0, 0, 100, 50);
    const moving = makeBitmap("moving", 103, 0, 50, 50);
    const doc = makeDoc([other, moving]);

    // Propose moving left edge at x=103
    const movingBounds = bounds(103, 0, 50, 50);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    // Left edge (103) snaps to right edge (100): delta = -3
    expect(result.x).toBe(100);
    expect(result.snappedX).toBe(true);
  });
});

describe("snapToObjects — does not snap when distance > threshold", () => {
  it("returns original x when closest point is farther than threshold", () => {
    // other right edge at 100, moving left edge at 110 → distance = 10 > threshold=5
    const other = makeBitmap("other", 0, 0, 100, 50);
    const moving = makeBitmap("moving", 110, 0, 50, 50);
    const doc = makeDoc([other, moving]);

    const movingBounds = bounds(110, 0, 50, 50);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    expect(result.x).toBe(110);
    expect(result.snappedX).toBe(false);
  });
});

describe("snapToObjects — snaps both axes independently", () => {
  it("snaps X and Y independently when both are within threshold", () => {
    // other: x=0, y=0, width=100, height=80
    // other right edge at x=100, other bottom edge at y=80
    // moving proposed left edge at x=102 (delta=2), top edge at y=78 (delta=2)
    const other = makeBitmap("other", 0, 0, 100, 80);
    const moving = makeBitmap("moving", 102, 78, 50, 50);
    const doc = makeDoc([other, moving]);

    const movingBounds = bounds(102, 78, 50, 50);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    // X: left edge (102) snaps to right edge (100)
    expect(result.x).toBe(100);
    expect(result.snappedX).toBe(true);
    // Y: top edge (78) snaps to bottom edge (80)
    expect(result.y).toBe(80);
    expect(result.snappedY).toBe(true);
  });
});

describe("snapToObjects — returns original position when nothing is within threshold", () => {
  it("returns original x and y when all candidates are out of range", () => {
    // other: x=0, y=0, width=10, height=10
    // moving: far away at x=500, y=500 → no snap
    const other = makeBitmap("other", 0, 0, 10, 10);
    const moving = makeBitmap("moving", 500, 500, 50, 50);
    const doc = makeDoc([other, moving]);

    const movingBounds = bounds(500, 500, 50, 50);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    expect(result.x).toBe(500);
    expect(result.y).toBe(500);
    expect(result.snappedX).toBe(false);
    expect(result.snappedY).toBe(false);
  });
});

describe("snapToObjects — snaps to center alignment", () => {
  it("snaps horizontal centers when within threshold", () => {
    // other: x=0, width=100 → h-center at x=50
    // moving: width=60, proposed x=22 → h-center at 22+30=52 (delta=2)
    // snap: move h-center to 50 → delta=-2 → x becomes 20
    const other = makeBitmap("other", 0, 0, 100, 50);
    const moving = makeBitmap("moving", 22, 200, 60, 50);
    const doc = makeDoc([other, moving]);

    const movingBounds = bounds(22, 200, 60, 50);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    // The center-to-center snap should be smaller than any edge snap
    expect(result.x).toBe(20); // center snapped: 50 - 30 = 20
    expect(result.snappedX).toBe(true);
  });

  it("snaps vertical centers when within threshold", () => {
    // other: y=0, height=100 → v-center at y=50
    // moving: height=60, proposed y=22 → v-center at 22+30=52 (delta=2)
    const other = makeBitmap("other", 0, 0, 100, 100);
    const moving = makeBitmap("moving", 200, 22, 50, 60);
    const doc = makeDoc([other, moving]);

    const movingBounds = bounds(200, 22, 50, 60);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    expect(result.y).toBe(20); // center snapped: 50 - 30 = 20
    expect(result.snappedY).toBe(true);
  });
});

describe("snapToObjects — returns snappedX=false, snappedY=false when no snap", () => {
  it("returns false flags for both axes when no snap is found", () => {
    const other = makeBitmap("other", 0, 0, 50, 50);
    const moving = makeBitmap("moving", 300, 300, 50, 50);
    const doc = makeDoc([other, moving]);

    const movingBounds = bounds(300, 300, 50, 50);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    expect(result.snappedX).toBe(false);
    expect(result.snappedY).toBe(false);
  });
});

describe("snapToObjects — picks closest snap when multiple candidates", () => {
  it("uses the nearest X snap delta among multiple candidates", () => {
    // obj1: right edge at x=100, obj2: left edge at x=104
    // moving left edge at x=103: dist to 100 = 3, dist to 104 = 1 → snap to 104
    const obj1 = makeBitmap("obj1", 0, 0, 100, 50);
    const obj2 = makeBitmap("obj2", 104, 0, 50, 50);
    const moving = makeBitmap("moving", 103, 200, 50, 50);
    const doc = makeDoc([obj1, obj2, moving]);

    const movingBounds = bounds(103, 200, 50, 50);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    // Closest is obj2 left edge (104) → delta = +1
    expect(result.x).toBe(104);
    expect(result.snappedX).toBe(true);
  });
});

describe("snapToObjects — invalid scene/layer indices", () => {
  it("returns original position for out-of-range sceneIdx", () => {
    const moving = makeBitmap("moving", 100, 100, 50, 50);
    const doc = makeDoc([moving]);

    const movingBounds = bounds(100, 100, 50, 50);
    const result = snapToObjects(doc, 99, 0, 0, "moving", movingBounds, 5);

    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.snappedX).toBe(false);
    expect(result.snappedY).toBe(false);
  });

  it("returns original position for out-of-range layerIdx", () => {
    const moving = makeBitmap("moving", 100, 100, 50, 50);
    const doc = makeDoc([moving]);

    const movingBounds = bounds(100, 100, 50, 50);
    const result = snapToObjects(doc, 0, 99, 0, "moving", movingBounds, 5);

    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.snappedX).toBe(false);
    expect(result.snappedY).toBe(false);
  });
});

describe("snapToObjects — snap to left edge of target", () => {
  it("snaps moving right edge to target left edge when within threshold", () => {
    // target left edge at x=200; moving right edge at x=200+width=50+153=203 → dist=3
    const target = makeBitmap("target", 200, 0, 80, 50);
    const moving = makeBitmap("moving", 153, 0, 50, 50);
    const doc = makeDoc([target, moving]);

    // Proposed: moving right edge at 153+50=203, target left at 200 → delta=-3
    const movingBounds = bounds(153, 0, 50, 50);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    expect(result.x).toBe(150); // right edge snapped to 200: x = 200 - 50 = 150
    expect(result.snappedX).toBe(true);
  });
});

describe("snapToObjects — snap to top edge of target", () => {
  it("snaps moving bottom edge to target top edge when within threshold", () => {
    // target top edge at y=200; moving bottom edge at y=153+50=203 → dist=3
    const target = makeBitmap("target", 0, 200, 80, 80);
    const moving = makeBitmap("moving", 0, 153, 50, 50);
    const doc = makeDoc([target, moving]);

    const movingBounds = bounds(0, 153, 50, 50);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    expect(result.y).toBe(150); // bottom snapped to 200: y = 200 - 50 = 150
    expect(result.snappedY).toBe(true);
  });
});

describe("snapToObjects — snap to bottom edge of target", () => {
  it("snaps moving top edge to target bottom edge when within threshold", () => {
    // target: y=0, height=100 → bottom at y=100; moving top at y=102 → dist=2
    const target = makeBitmap("target", 0, 0, 80, 100);
    const moving = makeBitmap("moving", 0, 102, 50, 50);
    const doc = makeDoc([target, moving]);

    const movingBounds = bounds(0, 102, 50, 50);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    expect(result.y).toBe(100); // top edge snapped to target bottom (100)
    expect(result.snappedY).toBe(true);
  });
});

describe("snapToObjects — excluded object IDs are not snapped to", () => {
  it("does not snap to the moving object itself even if its ID is in the frame", () => {
    // Only the moving object is in the frame (no other candidates)
    const moving = makeBitmap("moving", 100, 100, 50, 50);
    const doc = makeDoc([moving]);

    // Pass a movingBounds very close to where the object already is
    const movingBounds = bounds(102, 100, 50, 50);
    const result = snapToObjects(doc, 0, 0, 0, "moving", movingBounds, 5);

    // Should not snap to itself
    expect(result.x).toBe(102);
    expect(result.snappedX).toBe(false);
  });
});

describe("snapToObjects — empty target list returns no snap", () => {
  it("returns original position with no snap flags when no objects exist in frame", () => {
    const doc = makeDoc([]);

    const movingBounds = bounds(50, 50, 40, 40);
    const result = snapToObjects(doc, 0, 0, 0, "nonexistent", movingBounds, 5);

    expect(result.x).toBe(50);
    expect(result.y).toBe(50);
    expect(result.snappedX).toBe(false);
    expect(result.snappedY).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// snapToGrid tests
// ---------------------------------------------------------------------------

describe("snapToGrid — rounds to nearest grid intersection", () => {
  it("snapPointToGrid(5, 7, 10, 10) → {x:10, y:10} (x=5 is exactly half, JS rounds up; y=7 rounds to 10)", () => {
    // Math.round(5/10)*10 = Math.round(0.5)*10 = 1*10 = 10 (JS rounds 0.5 up)
    // Math.round(7/10)*10 = Math.round(0.7)*10 = 1*10 = 10
    const result = snapToGrid({ x: 5, y: 7 }, 10, 10);
    expect(result.point.x).toBe(10);
    expect(result.point.y).toBe(10);
    expect(result.type).toBe("grid");
  });

  it("snapPointToGrid(6, 6, 10, 10) → {x:10, y:10} (>0.5 rounds up)", () => {
    const result = snapToGrid({ x: 6, y: 6 }, 10, 10);
    expect(result.point.x).toBe(10);
    expect(result.point.y).toBe(10);
  });

  it("snapPointToGrid(15, 12, 10, 10) → {x:20, y:10}", () => {
    const result = snapToGrid({ x: 15, y: 12 }, 10, 10);
    expect(result.point.x).toBe(20);
    expect(result.point.y).toBe(10);
  });

  it("snapPointToGrid(0, 0, 18, 18) → {x:0, y:0}", () => {
    const result = snapToGrid({ x: 0, y: 0 }, 18, 18);
    expect(result.point.x).toBe(0);
    expect(result.point.y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// snapToGuides tests
// ---------------------------------------------------------------------------

describe("snapToGuides — horizontal guide snaps y when within threshold", () => {
  it("horizontal guide at y=50, threshold=5: snapToGuides(30, 48) → {x:30, y:50}", () => {
    const guides: Guide[] = [{ id: "g1", orientation: "horizontal", position: 50 }];
    const result = snapToGuides({ x: 30, y: 48 }, guides, 5);
    expect(result.point.x).toBe(30);
    expect(result.point.y).toBe(50);
    expect(result.type).toBe("guide");
  });

  it("point outside threshold (y=56, guide at y=50): no snap", () => {
    const guides: Guide[] = [{ id: "g1", orientation: "horizontal", position: 50 }];
    const result = snapToGuides({ x: 30, y: 56 }, guides, 5);
    expect(result.point.x).toBe(30);
    expect(result.point.y).toBe(56);
    expect(result.type).toBe("none");
  });
});

describe("snapToGuides — vertical guide snaps x when within threshold", () => {
  it("vertical guide at x=100, threshold=5: snapToGuides(97, 30) → {x:100, y:30}", () => {
    const guides: Guide[] = [{ id: "g2", orientation: "vertical", position: 100 }];
    const result = snapToGuides({ x: 97, y: 30 }, guides, 5);
    expect(result.point.x).toBe(100);
    expect(result.point.y).toBe(30);
    expect(result.type).toBe("guide");
  });
});

describe("snapToGuides — two guides, both in threshold: picks closest", () => {
  it("horizontal guide at y=50 and vertical guide at x=100, both in threshold: snaps to nearest", () => {
    const guides: Guide[] = [
      { id: "g1", orientation: "horizontal", position: 50 },
      { id: "g2", orientation: "vertical", position: 100 },
    ];
    // x=97 (dist=3 to guide x=100), y=48 (dist=2 to guide y=50)
    // Both are within threshold=5; snapToGuides picks the overall closest result
    // horizontal snap: candidate {x:97, y:50}, dist=2
    // vertical snap: candidate {x:100, y:48}, dist=3
    // closest is horizontal (dist=2)
    const result = snapToGuides({ x: 97, y: 48 }, guides, 5);
    expect(result.point.x).toBe(97);
    expect(result.point.y).toBe(50);
    expect(result.type).toBe("guide");
  });

  it("vertical guide closer: returns vertical snap", () => {
    const guides: Guide[] = [
      { id: "g1", orientation: "horizontal", position: 50 },
      { id: "g2", orientation: "vertical", position: 100 },
    ];
    // x=98 (dist=2 to guide x=100), y=45 (dist=5 to guide y=50)
    // horizontal: dist=5 (exactly at threshold, not strictly less), vertical: dist=2 < threshold
    // Only vertical snaps (dist < tolerance)
    const result = snapToGuides({ x: 98, y: 45 }, guides, 5);
    expect(result.point.x).toBe(100);
    expect(result.point.y).toBe(45);
    expect(result.type).toBe("guide");
  });
});
