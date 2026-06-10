/**
 * Unit tests for Edit Multiple Frames (EMF) mode logic.
 *
 * Tests the core hit-testing logic that determines whether a click on a ghost
 * frame object (in the onion skin range) should jump the timeline to that frame.
 *
 * The component-level integration is tested by verifying the pure helper
 * logic inline (matching the pattern used in drawingTools.test.ts).
 */

import { describe, it, expect } from "vitest";
import type { ShapeDisplayObject, SceneGraph } from "@flash/core";
import { transformedShapeBounds } from "@flash/core";

// ---------------------------------------------------------------------------
// Inline the hit-test logic from StageArea.tsx's EMF section
// This must stay in sync with the source.
// ---------------------------------------------------------------------------

interface OnionFrame {
  frameIndex: number;
  opacity: number;
  tint: "before" | "after";
  sceneGraph: SceneGraph;
  outlineMode?: boolean;
}

/**
 * Given a click at (stageX, stageY), check if it hits a shape in any ghost frame.
 * Returns the frameIndex of the first ghost frame hit, or null if none.
 */
function findGhostFrameHit(
  stageX: number,
  stageY: number,
  onionFrames: OnionFrame[]
): number | null {
  const sortedGhosts = [...onionFrames].sort((a, b) => b.opacity - a.opacity);
  for (const ghost of sortedGhosts) {
    for (const layer of ghost.sceneGraph.layers) {
      if (!layer.visible) continue;
      const shapes = layer.objects.filter(
        (o): o is ShapeDisplayObject => o.type === "shape"
      );
      const ghostShape = [...shapes].reverse().find((obj) => {
        const bounds = transformedShapeBounds(obj);
        return (
          stageX >= bounds.x &&
          stageX <= bounds.x + bounds.width &&
          stageY >= bounds.y &&
          stageY <= bounds.y + bounds.height
        );
      });
      if (ghostShape) {
        return ghost.frameIndex;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers for building test objects
// ---------------------------------------------------------------------------

function makeShape(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number
): ShapeDisplayObject {
  return {
    type: "shape" as const,
    id,
    x,
    y,
    shape: {
      id: `shape-${id}`,
      paths: [
        {
          fill: { type: "solid" as const, color: { r: 255, g: 0, b: 0, a: 255 } },
          start: { x: 0, y: 0 },
          segments: [
            { type: "line" as const, to: { x: w, y: 0 } },
            { type: "line" as const, to: { x: w, y: h } },
            { type: "line" as const, to: { x: 0, y: h } },
          ],
          closed: true,
        },
      ],
    },
  };
}

function makeOnionFrame(
  frameIndex: number,
  opacity: number,
  shapes: ShapeDisplayObject[],
  visible = true
): OnionFrame {
  return {
    frameIndex,
    opacity,
    tint: frameIndex < 5 ? "before" : "after",
    sceneGraph: {
      layers: [
        {
          id: "layer-1",
          name: "Layer 1",
          visible,
          locked: false,
          objects: shapes,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Edit Multiple Frames — ghost frame hit testing", () => {
  it("returns null when onionFrames is empty", () => {
    const result = findGhostFrameHit(100, 100, []);
    expect(result).toBeNull();
  });

  it("hits a shape in a ghost frame", () => {
    const shape = makeShape("s1", 50, 50, 100, 100);
    const frames = [makeOnionFrame(3, 0.4, [shape])];
    const result = findGhostFrameHit(100, 100, frames);
    expect(result).toBe(3);
  });

  it("returns null when click is outside all ghost shapes", () => {
    const shape = makeShape("s1", 50, 50, 100, 100);
    const frames = [makeOnionFrame(3, 0.4, [shape])];
    const result = findGhostFrameHit(300, 300, frames);
    expect(result).toBeNull();
  });

  it("prefers the ghost frame with higher opacity (closer to current)", () => {
    // Frame 4 is closer (higher opacity 0.4) vs frame 2 (opacity 0.2)
    const shapeA = makeShape("a", 50, 50, 100, 100);
    const shapeB = makeShape("b", 50, 50, 100, 100);
    const frames = [
      makeOnionFrame(2, 0.2, [shapeA]),
      makeOnionFrame(4, 0.4, [shapeB]),
    ];
    // Both overlap at (100, 100). Higher opacity frame should win.
    const result = findGhostFrameHit(100, 100, frames);
    expect(result).toBe(4);
  });

  it("skips invisible layers in ghost frames", () => {
    const shape = makeShape("s1", 50, 50, 100, 100);
    const frames = [makeOnionFrame(3, 0.4, [shape], false /* visible=false */)];
    const result = findGhostFrameHit(100, 100, frames);
    expect(result).toBeNull();
  });

  it("hit-tests the boundary of a shape (edge pixel)", () => {
    const shape = makeShape("s1", 50, 50, 100, 100);
    const frames = [makeOnionFrame(3, 0.4, [shape])];
    // Click exactly on the right/bottom edge
    const result = findGhostFrameHit(150, 150, frames);
    expect(result).toBe(3);
  });

  it("returns null when click is just outside the shape", () => {
    const shape = makeShape("s1", 50, 50, 100, 100);
    const frames = [makeOnionFrame(3, 0.4, [shape])];
    // One pixel outside
    const result = findGhostFrameHit(151, 100, frames);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests for Timeline EMF state (prop wiring simulation)
// ---------------------------------------------------------------------------

describe("Edit Multiple Frames — onion frame opacity computation", () => {
  it("EMF mode uses high (0.6) opacity for all ghost frames", () => {
    const editMultipleFrames = true;
    const onionBefore = 2;
    const onionAfter = 2;

    const getOpacity = (i: number, isBefore: boolean) =>
      editMultipleFrames
        ? 0.6
        : isBefore
        ? 0.2 + (0.2 * (onionBefore - i)) / Math.max(onionBefore, 1)
        : 0.2 + (0.2 * (onionAfter - i)) / Math.max(onionAfter, 1);

    // All EMF ghost frames should be at 0.6
    for (let i = 1; i <= onionBefore; i++) {
      expect(getOpacity(i, true)).toBe(0.6);
    }
    for (let i = 1; i <= onionAfter; i++) {
      expect(getOpacity(i, false)).toBe(0.6);
    }
  });

  it("normal onion skin mode uses graduated opacity", () => {
    const editMultipleFrames = false;
    const onionBefore = 2;

    const getOpacity = (i: number) =>
      editMultipleFrames
        ? 0.6
        : 0.2 + (0.2 * (onionBefore - i)) / Math.max(onionBefore, 1);

    // i=1 (closest): 0.2 + 0.2*(2-1)/2 = 0.2 + 0.1 = 0.3
    expect(getOpacity(1)).toBeCloseTo(0.3);
    // i=2 (farthest): 0.2 + 0.2*(2-2)/2 = 0.2 + 0 = 0.2
    expect(getOpacity(2)).toBeCloseTo(0.2);
  });
});

// ---------------------------------------------------------------------------
// Tests for Onion Skin Outlines mode
// ---------------------------------------------------------------------------

describe("Onion Skin Outlines — outlineMode flag on ghost frames", () => {
  /**
   * Simulate building ghost frames as Shell.tsx does, with outlineMode toggled.
   */
  function buildGhostFrames(
    currentFrame: number,
    onionBefore: number,
    onionAfter: number,
    onionSkinOutlines: boolean
  ): OnionFrame[] {
    const maxFrame = 20;
    const frames: OnionFrame[] = [];

    const makeScene = (): OnionFrame["sceneGraph"] => ({
      layers: [{ id: "l1", name: "Layer 1", visible: true, locked: false, objects: [] }],
    });

    for (let i = 1; i <= onionBefore; i++) {
      const fi = currentFrame - i;
      if (fi < 0) continue;
      frames.push({ frameIndex: fi, opacity: 0.3, tint: "before", sceneGraph: makeScene(), outlineMode: onionSkinOutlines });
    }
    for (let i = 1; i <= onionAfter; i++) {
      const fi = currentFrame + i;
      if (fi >= maxFrame) continue;
      frames.push({ frameIndex: fi, opacity: 0.3, tint: "after", sceneGraph: makeScene(), outlineMode: onionSkinOutlines });
    }
    return frames;
  }

  it("outlineMode is false on all ghost frames when onionSkinOutlines=false", () => {
    const frames = buildGhostFrames(5, 2, 2, false);
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect(f.outlineMode).toBe(false);
    }
  });

  it("outlineMode is true on all ghost frames when onionSkinOutlines=true", () => {
    const frames = buildGhostFrames(5, 2, 2, true);
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect(f.outlineMode).toBe(true);
    }
  });

  it("before/after tint is preserved regardless of outlineMode", () => {
    const frames = buildGhostFrames(5, 2, 2, true);
    const before = frames.filter((f) => f.tint === "before");
    const after = frames.filter((f) => f.tint === "after");
    expect(before.length).toBe(2);
    expect(after.length).toBe(2);
  });

  it("toggling outlineMode does not affect ghost frame count", () => {
    const framesOff = buildGhostFrames(5, 2, 2, false);
    const framesOn  = buildGhostFrames(5, 2, 2, true);
    expect(framesOn.length).toBe(framesOff.length);
  });
});
