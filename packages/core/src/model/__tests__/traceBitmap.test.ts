/**
 * Unit tests for model/traceBitmap.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  traceBitmap,
  DEFAULT_TRACE_OPTIONS,
} from "../traceBitmap.js";
import type { ImageDataLike } from "../traceBitmap.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ImageDataLike with RGBA pixel data.
 * Pixels are supplied as [r, g, b, a] tuples in row-major order.
 */
function makeImageData(
  width: number,
  height: number,
  pixels: Array<[number, number, number, number]>
): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length && i < width * height; i++) {
    const [r, g, b, a] = pixels[i];
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

/**
 * Build a 10×10 image with four distinct colored quadrants:
 *   Top-left 5×5:    red   (255, 0, 0, 255)
 *   Top-right 5×5:   green (0, 255, 0, 255)
 *   Bottom-left 5×5: blue  (0, 0, 255, 255)
 *   Bottom-right 5×5: white (255, 255, 255, 255)
 */
function makeQuadrantImage(): ImageDataLike {
  const width = 10;
  const height = 10;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (y < 5 && x < 5) {
        // red
        data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
      } else if (y < 5 && x >= 5) {
        // green
        data[i] = 0; data[i + 1] = 255; data[i + 2] = 0; data[i + 3] = 255;
      } else if (y >= 5 && x < 5) {
        // blue
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 255;
      } else {
        // white
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
      }
    }
  }

  return { width, height, data };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("traceBitmap", () => {
  it("produces at least one shape from a 4-color 10×10 image", () => {
    const imageData = makeQuadrantImage();
    const shapes = traceBitmap(imageData, {
      ...DEFAULT_TRACE_OPTIONS,
      minimumArea: 1,
    });
    // Each quadrant is 25px; expect exactly 4 regions
    expect(shapes.length).toBe(4);
  });

  it("each returned path has a solid fill", () => {
    const imageData = makeQuadrantImage();
    const shapes = traceBitmap(imageData, {
      ...DEFAULT_TRACE_OPTIONS,
      minimumArea: 1,
    });
    for (const path of shapes) {
      expect(path.fill).toBeDefined();
      expect(path.fill?.type).toBe("solid");
    }
  });

  it("each returned path is closed", () => {
    const imageData = makeQuadrantImage();
    const shapes = traceBitmap(imageData, { ...DEFAULT_TRACE_OPTIONS, minimumArea: 1 });
    for (const path of shapes) {
      expect(path.closed).toBe(true);
    }
  });

  it("each axis-aligned region traces to a 4-line rectangle (corners preserved)", () => {
    // Axis-aligned square quadrants: marching squares yields a clean 4-vertex
    // contour; the 90° corners exceed the corner threshold so they stay sharp
    // line segments (no curve rounding) and Douglas-Peucker keeps all 4.
    const imageData = makeQuadrantImage();
    const shapes = traceBitmap(imageData, { ...DEFAULT_TRACE_OPTIONS, minimumArea: 1 });
    for (const path of shapes) {
      expect(path.closed).toBe(true);
      expect(path.segments.length).toBe(4);
      for (const seg of path.segments) {
        expect(seg.type).toBe("line");
      }
      // Each quadrant spans a 5×5 pixel area.
      const xs = [path.start.x, ...path.segments.map((s) => s.to.x)];
      const ys = [path.start.y, ...path.segments.map((s) => s.to.y)];
      expect(Math.max(...xs) - Math.min(...xs)).toBe(5);
      expect(Math.max(...ys) - Math.min(...ys)).toBe(5);
    }
  });

  it("minimum area filter removes small regions", () => {
    // 4×1 image: leftmost pixel is unique color, right 3 pixels are another color
    const imageData = makeImageData(4, 1, [
      [255, 0, 0, 255],    // red — 1 pixel region
      [0, 0, 255, 255],    // blue
      [0, 0, 255, 255],    // blue
      [0, 0, 255, 255],    // blue
    ]);

    // With minimumArea = 2, the 1-pixel red region should be discarded
    const shapes = traceBitmap(imageData, {
      ...DEFAULT_TRACE_OPTIONS,
      minimumArea: 2,
    });
    expect(shapes.length).toBe(1);
    const fill = shapes[0].fill;
    expect(fill?.type).toBe("solid");
    if (fill?.type === "solid") {
      // The surviving region should be blue
      expect(fill.color.b).toBeGreaterThan(100);
      expect(fill.color.r).toBeLessThan(100);
    }
  });

  it("minimum area filter keeps the region when area equals the threshold", () => {
    const imageData = makeImageData(2, 1, [
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
    const shapes = traceBitmap(imageData, {
      ...DEFAULT_TRACE_OPTIONS,
      minimumArea: 2,
    });
    expect(shapes.length).toBe(1);
  });

  it("transparent pixels are excluded from visible regions", () => {
    // 2×1 image: one opaque red, one fully transparent
    const imageData = makeImageData(2, 1, [
      [255, 0, 0, 255],
      [0, 0, 0, 0],
    ]);
    const shapes = traceBitmap(imageData, {
      ...DEFAULT_TRACE_OPTIONS,
      minimumArea: 1,
    });
    // Transparent pixels collect into a separate bucket that should be skipped
    // (key === -1 is filtered)
    expect(shapes.length).toBe(1);
  });

  it("accepts partial options and merges with defaults", () => {
    const imageData = makeQuadrantImage();
    // Only override minimumArea
    const shapes = traceBitmap(imageData, { minimumArea: 1 });
    expect(shapes.length).toBe(4);
  });

  it("returns empty array for an empty image", () => {
    const imageData: ImageDataLike = { width: 0, height: 0, data: [] };
    const shapes = traceBitmap(imageData, DEFAULT_TRACE_OPTIONS);
    expect(shapes.length).toBe(0);
  });

  it("solid single-color image returns exactly one region", () => {
    const imageData = makeImageData(5, 5, Array(25).fill([100, 150, 200, 255]));
    const shapes = traceBitmap(imageData, { ...DEFAULT_TRACE_OPTIONS, minimumArea: 1 });
    expect(shapes.length).toBe(1);
  });
});
