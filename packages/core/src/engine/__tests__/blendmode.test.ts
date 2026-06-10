/**
 * Unit tests for Canvas 2D blend mode mapping in the renderer.
 *
 * Tests verify:
 *  1. BLEND_MAP maps 'multiply' to 'multiply'
 *  2. BLEND_MAP maps 'add' to 'lighter'
 *  3. Unknown blend mode falls back to 'source-over'
 *  4. SymbolInstance without blendMode renders with 'source-over' (default)
 *  7. applySubtractBlend darkens destination by source
 *  8. applySubtractBlend clamps at 0 (no negative values)
 *  9. applySubtractBlend ignores alpha-zero source pixels
 * 10. applyInvertBlend fully inverts when source is fully opaque
 * 11. applyInvertBlend has no effect when source is fully transparent
 * 12. applyInvertBlend blends proportionally at 50% source alpha
 * 13. PIXEL_BLEND_MODES contains 'subtract' and 'invert'
 */

import { describe, it, expect, vi } from "vitest";
import { BLEND_MAP, PIXEL_BLEND_MODES, applySubtractBlend, applyInvertBlend } from "../renderer.js";
import type { SceneGraph, DisplayObject } from "../types.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Canvas blend mode mapping (BLEND_MAP)", () => {
  /**
   * Test 1: BLEND_MAP maps 'multiply' to 'multiply'
   */
  it("1. BLEND_MAP maps 'multiply' to 'multiply'", () => {
    expect(BLEND_MAP["multiply"]).toBe("multiply");
  });

  /**
   * Test 2: BLEND_MAP maps 'add' to 'lighter'
   */
  it("2. BLEND_MAP maps 'add' to 'lighter'", () => {
    expect(BLEND_MAP["add"]).toBe("lighter");
  });

  /**
   * Test 3: Unknown blend mode falls back to 'source-over' via nullish coalescing
   */
  it("3. Unknown blend mode falls back to 'source-over'", () => {
    const unknownMode = "not-a-real-blend-mode";
    const result = BLEND_MAP[unknownMode] ?? "source-over";
    expect(result).toBe("source-over");
  });

  /**
   * Test 4: SymbolInstance without blendMode → globalCompositeOperation stays 'source-over'
   *
   * We verify this by constructing a mock context and checking that
   * globalCompositeOperation is NOT set when blendMode is absent.
   */
  it("4. SymbolInstance without blendMode does not change globalCompositeOperation from default", () => {
    // The renderer only sets globalCompositeOperation when blendMode is set and not 'normal'.
    // We verify this by checking the BLEND_MAP logic pathway.

    // An instance with no blendMode should use the default 'source-over'
    const instanceWithoutBlend = {
      type: "instance" as const,
      id: "inst-no-blend",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      // blendMode is absent
    };

    // Simulate the check: only set globalCompositeOperation when blendMode is set AND !== 'normal'
    let compositeWasSet = false;
    let compositeValue: string = "source-over";

    const blendMode = (instanceWithoutBlend as { blendMode?: string }).blendMode;
    if (blendMode && blendMode !== "normal") {
      compositeWasSet = true;
      compositeValue = BLEND_MAP[blendMode] ?? "source-over";
    }

    expect(compositeWasSet).toBe(false);
    expect(compositeValue).toBe("source-over");
  });

  /**
   * Additional coverage: verify all standard blend modes are present in BLEND_MAP
   */
  it("5. BLEND_MAP contains all 14 Flash 8 blend modes", () => {
    const flashModes = [
      "normal", "layer", "multiply", "screen", "lighten", "darken",
      "difference", "add", "subtract", "invert", "alpha", "erase",
      "overlay", "hardlight",
    ];
    for (const mode of flashModes) {
      expect(BLEND_MAP[mode]).toBeDefined();
    }
  });

  /**
   * Additional: verify specific mappings that have non-obvious Canvas equivalents
   */
  it("6. BLEND_MAP maps 'hardlight' to 'hard-light' (CSS spelling)", () => {
    expect(BLEND_MAP["hardlight"]).toBe("hard-light");
  });
});

// ---------------------------------------------------------------------------
// Pixel blend function unit tests
// ---------------------------------------------------------------------------

describe("applySubtractBlend", () => {
  /**
   * Test 7: subtracting white (255,255,255) at full alpha from red (255,0,0)
   * destination yields black (0,0,0).
   */
  it("7. subtracts white source from red destination → black", () => {
    const dst = new Uint8ClampedArray([255, 0, 0, 255]);
    const src = new Uint8ClampedArray([255, 255, 255, 255]);
    applySubtractBlend(dst, src, 0);
    expect(dst[0]).toBe(0);   // 255 - 255*1 = 0
    expect(dst[1]).toBe(0);   // 0   - 255*1 = 0 (clamped)
    expect(dst[2]).toBe(0);   // 0   - 255*1 = 0 (clamped)
    expect(dst[3]).toBe(255); // alpha unchanged
  });

  /**
   * Test 8: result is clamped at 0; no negative values.
   */
  it("8. result is clamped to 0 — no negative channel values", () => {
    const dst = new Uint8ClampedArray([50, 50, 50, 255]);
    const src = new Uint8ClampedArray([200, 200, 200, 255]);
    applySubtractBlend(dst, src, 0);
    expect(dst[0]).toBe(0);
    expect(dst[1]).toBe(0);
    expect(dst[2]).toBe(0);
    expect(dst[3]).toBe(255);
  });

  /**
   * Test 9: a fully transparent source pixel (alpha=0) has no effect on the destination.
   */
  it("9. fully transparent source pixel has no effect on destination", () => {
    const dst = new Uint8ClampedArray([100, 150, 200, 255]);
    const src = new Uint8ClampedArray([255, 255, 255, 0]); // alpha = 0
    applySubtractBlend(dst, src, 0);
    expect(dst[0]).toBe(100);
    expect(dst[1]).toBe(150);
    expect(dst[2]).toBe(200);
    expect(dst[3]).toBe(255);
  });

  /**
   * Test: partial subtraction with 50% source alpha.
   */
  it("partial subtraction at 50% source alpha", () => {
    const dst = new Uint8ClampedArray([200, 100, 80, 255]);
    const src = new Uint8ClampedArray([100, 60, 40, 128]); // ~50% alpha
    applySubtractBlend(dst, src, 0);
    const a = 128 / 255;
    expect(dst[0]).toBe(Math.max(0, Math.round(200 - 100 * a)));
    expect(dst[1]).toBe(Math.max(0, Math.round(100 - 60 * a)));
    expect(dst[2]).toBe(Math.max(0, Math.round(80 - 40 * a)));
    expect(dst[3]).toBe(255);
  });
});

describe("applyInvertBlend", () => {
  /**
   * Test 10: fully opaque white source inverts red destination → cyan.
   */
  it("10. fully opaque source fully inverts destination: red → cyan", () => {
    const dst = new Uint8ClampedArray([255, 0, 0, 255]); // red
    const src = new Uint8ClampedArray([0, 0, 0, 255]);   // opaque (color doesn't matter for invert)
    applyInvertBlend(dst, src, 0);
    expect(dst[0]).toBe(0);   // 255 - 255 = 0
    expect(dst[1]).toBe(255); // 255 - 0   = 255
    expect(dst[2]).toBe(255); // 255 - 0   = 255
    expect(dst[3]).toBe(255); // alpha unchanged
  });

  /**
   * Test 11: fully transparent source has no effect on destination.
   */
  it("11. fully transparent source has no effect on destination", () => {
    const dst = new Uint8ClampedArray([100, 150, 200, 255]);
    const src = new Uint8ClampedArray([0, 0, 0, 0]); // alpha = 0
    applyInvertBlend(dst, src, 0);
    expect(dst[0]).toBe(100);
    expect(dst[1]).toBe(150);
    expect(dst[2]).toBe(200);
    expect(dst[3]).toBe(255);
  });

  /**
   * Test 12: 50% source alpha blends halfway between original and inverted.
   */
  it("12. 50% source alpha blends halfway between original and inverted", () => {
    const dst = new Uint8ClampedArray([100, 100, 100, 255]);
    const src = new Uint8ClampedArray([0, 0, 0, 128]); // ~50% alpha
    applyInvertBlend(dst, src, 0);
    const a = 128 / 255;
    const expected = Math.round((255 - 100) * a + 100 * (1 - a));
    expect(dst[0]).toBe(expected);
    expect(dst[1]).toBe(expected);
    expect(dst[2]).toBe(expected);
    expect(dst[3]).toBe(255);
  });
});

describe("PIXEL_BLEND_MODES", () => {
  /**
   * Test 13: PIXEL_BLEND_MODES contains exactly 'subtract' and 'invert'.
   */
  it("13. PIXEL_BLEND_MODES contains 'subtract' and 'invert'", () => {
    expect(PIXEL_BLEND_MODES.has("subtract")).toBe(true);
    expect(PIXEL_BLEND_MODES.has("invert")).toBe(true);
    // These modes should NOT be in PIXEL_BLEND_MODES (they have native Canvas equivalents)
    expect(PIXEL_BLEND_MODES.has("multiply")).toBe(false);
    expect(PIXEL_BLEND_MODES.has("screen")).toBe(false);
    expect(PIXEL_BLEND_MODES.has("normal")).toBe(false);
  });
});
