/**
 * Task 1427 — "Erase Inside" region lock must NOT drift per pointermove.
 *
 * Flash 8's Erase Inside erases ONLY the fill in which the eraser gesture
 * STARTED, stopping at its boundary for the whole drag. The bug: StageArea's
 * interactive eraser passed `insideAt: sweptStage[0]` — the PREVIOUS pointer
 * sample of the CURRENT move increment — to planarEraseShape on every move. As
 * the drag proceeds that anchor follows the cursor: once the cursor crosses into
 * a different fill, the next increment locks to THAT fill and erases it.
 *
 * The fix captures the gesture-start point ONCE at pointerdown
 * (`eraserGestureStartRef`) and passes THAT as `insideAt` for every increment.
 *
 * This test reproduces the exact StageArea pointermove loop (chained
 * planarEraseShape calls, each erasing into the previous result, swept segment
 * [prev, cur], stamp via buildEraserPolygon) for a drag that starts in fill A
 * (red) and sweeps into adjacent fill B (blue). It asserts:
 *   - FIXED anchor (the fix): B is byte-identical, only A loses the swept area.
 *   - PER-INCREMENT anchor (the old bug): B IS erased — proving the test would
 *     catch a regression back to the drifting anchor.
 *   - a gesture starting on EMPTY canvas erases nothing in inside mode.
 */
import { describe, it, expect } from "vitest";
import {
  buildArrangementFromShapes,
  planarShapeToShape,
  planarEraseShape,
  buildEraserPolygon,
  type Fill,
  type Point,
  type Shape,
  type ShapePath,
} from "@flash/core";

const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };
const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };

function rectPath(x: number, y: number, w: number, h: number, fill: Fill): ShapePath {
  return {
    start: { x, y },
    segments: [
      { type: "line", to: { x, y: y + h } },
      { type: "line", to: { x: x + w, y: y + h } },
      { type: "line", to: { x: x + w, y } },
      { type: "line", to: { x, y } },
    ],
    fill,
    closed: true,
  };
}
function rectShape(id: string, x: number, y: number, w: number, h: number, fill: Fill): Shape {
  return { id, paths: [rectPath(x, y, w, h, fill)] };
}
/** Merge shapes into one via the planar read-back (mirrors the merge-drawing fold). */
function mergeShapes(id: string, shapes: Shape[]): Shape {
  return planarShapeToShape(buildArrangementFromShapes(shapes), id);
}
/**
 * Net area covered by a particular fill color in a shape. Outer loops are CCW
 * (positive), erased/hole loops are CW (negative), so summing the SIGNED loop
 * areas first (and taking abs at the end) subtracts holes — the renderer's
 * non-zero-winding result. Summing abs per-loop would (wrongly) ADD a hole.
 */
function colorArea(shape: Shape | null, fill: Fill): number {
  if (!shape || fill.type !== "solid") return 0;
  let a = 0;
  for (const p of shape.paths) {
    if (!p.fill || p.fill.type !== "solid") continue;
    const c = p.fill.color;
    if (c.r !== fill.color.r || c.g !== fill.color.g || c.b !== fill.color.b) continue;
    let sum = 0;
    let prev = p.start;
    for (const seg of p.segments) {
      sum += prev.x * seg.to.y - seg.to.x * prev.y;
      prev = seg.to;
    }
    a += sum / 2;
  }
  return Math.abs(a);
}

/** How the caller derives `insideAt` per pointermove increment. */
type AnchorMode = "gesture-start" | "per-increment";

/**
 * Replay the StageArea interactive eraser loop over a sequence of pointer
 * samples in Erase-Inside mode. `anchorMode` selects the fixed gesture-start
 * anchor (the fix) or the drifting previous-sample anchor (the old bug).
 */
function replayEraseInsideDrag(
  shape: Shape,
  samples: Point[],
  radius: number,
  anchorMode: AnchorMode,
): Shape | null {
  // pointerdown captures the gesture start ONCE (StageArea eraserGestureStartRef).
  const gestureStart = samples[0];
  let cur: Shape | null = shape;
  for (let i = 1; i < samples.length; i++) {
    if (cur === null) break;
    const prev = samples[i - 1];
    const p = samples[i];
    // sweptStage = [prev, cur] (StageArea builds a capsule from the segment).
    const sweptStage: Point[] =
      Math.hypot(p.x - prev.x, p.y - prev.y) < 0.01 ? [p] : [prev, p];
    const stamp = buildEraserPolygon(sweptStage, radius);
    const insideAt = anchorMode === "gesture-start" ? gestureStart : sweptStage[0];
    const { shape: next } = planarEraseShape(cur, stamp, {
      mode: "inside",
      insideAt,
    });
    cur = next;
  }
  return cur;
}

describe("Erase Inside region lock (task 1427)", () => {
  // Red fill 0..100, blue fill 100..200 (adjacent, merged into one shape).
  const merged = () =>
    mergeShapes("m", [
      rectShape("red", 0, 0, 100, 100, RED),
      rectShape("blue", 100, 0, 100, 100, BLUE),
    ]);
  // A drag that STARTS in red (x=50) and sweeps across the seam into blue (x=115).
  const samples: Point[] = [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 105, y: 50 },
    { x: 115, y: 50 },
  ];
  const RADIUS = 8;

  it("gesture-start anchor (the fix): a drag started in RED never erases BLUE", () => {
    const shape = merged();
    const redBefore = colorArea(shape, RED);
    const blueBefore = colorArea(shape, BLUE);
    expect(redBefore).toBeGreaterThan(0);
    expect(blueBefore).toBeGreaterThan(0);

    const out = replayEraseInsideDrag(shape, samples, RADIUS, "gesture-start");
    const redAfter = colorArea(out, RED);
    const blueAfter = colorArea(out, BLUE);

    // Red (the started-in region) loses the swept area; blue is byte-identical.
    expect(redAfter).toBeLessThan(redBefore);
    expect(blueAfter).toBeCloseTo(blueBefore, 5);
  });

  it("per-increment anchor (the OLD bug) DOES erase BLUE — regression guard", () => {
    const shape = merged();
    const blueBefore = colorArea(shape, BLUE);
    const out = replayEraseInsideDrag(shape, samples, RADIUS, "per-increment");
    // The drifting anchor locks onto blue mid-drag and bites it. This proves the
    // fixed-anchor assertion above is meaningful (the test would fail on a revert).
    expect(colorArea(out, BLUE)).toBeLessThan(blueBefore);
  });

  it("gesture starting on EMPTY canvas erases nothing in inside mode", () => {
    // Single red fill; the whole drag stays over EMPTY canvas (y=300, far below).
    const shape = rectShape("red", 0, 0, 100, 100, RED);
    const redBefore = colorArea(shape, RED);
    const emptySamples: Point[] = [
      { x: 50, y: 300 },
      { x: 60, y: 300 },
      { x: 70, y: 300 },
    ];
    const out = replayEraseInsideDrag(shape, emptySamples, RADIUS, "gesture-start");
    // Inside mode with an anchor on empty space erases nothing at all.
    expect(colorArea(out, RED)).toBeCloseTo(redBefore, 5);
  });
});
