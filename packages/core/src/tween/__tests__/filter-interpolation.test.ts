/**
 * Tests for filter interpolation in motion tweens.
 * Covers interpolateFilters for all FlashFilter types and the snap-on-mismatch rules.
 */
import { describe, it, expect } from "vitest";
import { interpolateFilters, interpolateTween } from "../interpolate.js";
import type { TweenConfig, TweenTarget } from "../types.js";
import type {
  AdjustColorFilter,
  BevelFilter,
  BlurFilter,
  DropShadowFilter,
  FlashFilter,
  GlowFilter,
  GradientBevelFilter,
  GradientGlowFilter,
} from "../../engine/filters.js";

// ---------------------------------------------------------------------------
// interpolateFilters — null / empty cases
// ---------------------------------------------------------------------------

describe("interpolateFilters — null / empty cases", () => {
  it("both null → returns null", () => {
    expect(interpolateFilters(null, null, 0.5)).toBeNull();
  });

  it("both empty arrays → returns null", () => {
    expect(interpolateFilters([], [], 0.5)).toBeNull();
  });

  it("null from and null to → returns null", () => {
    expect(interpolateFilters(undefined, undefined, 0.5)).toBeNull();
  });

  it("empty from, null to → returns null", () => {
    expect(interpolateFilters([], null, 0.5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Length mismatch → snap to from
// ---------------------------------------------------------------------------

describe("interpolateFilters — length mismatch snaps to from", () => {
  const blur: BlurFilter = { type: "blur", blurX: 10, blurY: 10, quality: 1, enabled: true };
  const glow: GlowFilter = {
    type: "glow",
    color: { r: 255, g: 0, b: 0, a: 255 },
    alpha: 1,
    blurX: 6,
    blurY: 6,
    strength: 2,
    inner: false,
    knockout: false,
    enabled: true,
  };

  it("from has 1 filter, to has 2 → returns from (1 filter)", () => {
    const result = interpolateFilters([blur], [blur, glow], 0.5);
    expect(result).toHaveLength(1);
    expect(result![0]).toEqual(blur);
  });

  it("from has 2 filters, to has 1 → returns from (2 filters)", () => {
    const result = interpolateFilters([blur, glow], [blur], 0.5);
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual(blur);
  });

  it("from empty, to has filters → returns null (no from to snap to)", () => {
    const result = interpolateFilters([], [blur], 0.5);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Type mismatch at same position → snap that individual filter to from
// ---------------------------------------------------------------------------

describe("interpolateFilters — type mismatch at position snaps to from filter", () => {
  const blur: BlurFilter = { type: "blur", blurX: 10, blurY: 10, quality: 1, enabled: true };
  const glow: GlowFilter = {
    type: "glow",
    color: { r: 255, g: 0, b: 0, a: 255 },
    alpha: 1,
    blurX: 6,
    blurY: 6,
    strength: 2,
    inner: false,
    knockout: false,
    enabled: true,
  };

  it("blur → glow (type mismatch) → returns blur unchanged", () => {
    const result = interpolateFilters([blur], [glow], 0.5);
    expect(result).toHaveLength(1);
    expect(result![0]).toEqual(blur);
  });
});

// ---------------------------------------------------------------------------
// BlurFilter interpolation
// ---------------------------------------------------------------------------

describe("interpolateFilters — BlurFilter", () => {
  const from: BlurFilter = { type: "blur", blurX: 0, blurY: 0, quality: 1, enabled: true };
  const to: BlurFilter = { type: "blur", blurX: 20, blurY: 10, quality: 1, enabled: true };

  it("t=0 returns from values", () => {
    const result = interpolateFilters([from], [to], 0) as BlurFilter[];
    expect(result[0].blurX).toBeCloseTo(0);
    expect(result[0].blurY).toBeCloseTo(0);
  });

  it("t=1 returns to values", () => {
    const result = interpolateFilters([from], [to], 1) as BlurFilter[];
    expect(result[0].blurX).toBeCloseTo(20);
    expect(result[0].blurY).toBeCloseTo(10);
  });

  it("t=0.5 returns midpoint values", () => {
    const result = interpolateFilters([from], [to], 0.5) as BlurFilter[];
    expect(result[0].blurX).toBeCloseTo(10);
    expect(result[0].blurY).toBeCloseTo(5);
  });

  it("non-numeric fields (quality, enabled) are preserved from from", () => {
    const result = interpolateFilters([from], [to], 0.5) as BlurFilter[];
    expect(result[0].quality).toBe(1);
    expect(result[0].enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DropShadowFilter interpolation
// ---------------------------------------------------------------------------

describe("interpolateFilters — DropShadowFilter", () => {
  const from: DropShadowFilter = {
    type: "drop-shadow",
    distance: 0,
    angle: 0,
    color: { r: 0, g: 0, b: 0, a: 255 },
    alpha: 0,
    blurX: 0,
    blurY: 0,
    strength: 0,
    inner: false,
    knockout: false,
    hideObject: false,
    enabled: true,
  };
  const to: DropShadowFilter = {
    type: "drop-shadow",
    distance: 10,
    angle: 90,
    color: { r: 255, g: 0, b: 0, a: 255 },
    alpha: 1,
    blurX: 8,
    blurY: 4,
    strength: 2,
    inner: false,
    knockout: false,
    hideObject: false,
    enabled: true,
  };

  it("t=0.5 interpolates all numeric fields", () => {
    const result = interpolateFilters([from], [to], 0.5) as DropShadowFilter[];
    const r = result[0];
    expect(r.distance).toBeCloseTo(5);
    expect(r.angle).toBeCloseTo(45);
    expect(r.alpha).toBeCloseTo(0.5);
    expect(r.blurX).toBeCloseTo(4);
    expect(r.blurY).toBeCloseTo(2);
    expect(r.strength).toBeCloseTo(1);
    expect(r.color.r).toBe(128);
  });

  it("preserves boolean fields from from", () => {
    const result = interpolateFilters([from], [to], 0.5) as DropShadowFilter[];
    expect(result[0].inner).toBe(false);
    expect(result[0].knockout).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GlowFilter interpolation
// ---------------------------------------------------------------------------

describe("interpolateFilters — GlowFilter", () => {
  const from: GlowFilter = {
    type: "glow",
    color: { r: 0, g: 0, b: 0, a: 255 },
    alpha: 0,
    blurX: 0,
    blurY: 0,
    strength: 0,
    inner: false,
    knockout: false,
    enabled: true,
  };
  const to: GlowFilter = {
    type: "glow",
    color: { r: 0, g: 255, b: 0, a: 255 },
    alpha: 1,
    blurX: 12,
    blurY: 8,
    strength: 4,
    inner: false,
    knockout: false,
    enabled: true,
  };

  it("t=0.5 interpolates blurX, blurY, strength, alpha, color", () => {
    const result = interpolateFilters([from], [to], 0.5) as GlowFilter[];
    const r = result[0];
    expect(r.blurX).toBeCloseTo(6);
    expect(r.blurY).toBeCloseTo(4);
    expect(r.strength).toBeCloseTo(2);
    expect(r.alpha).toBeCloseTo(0.5);
    expect(r.color.g).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// BevelFilter interpolation
// ---------------------------------------------------------------------------

describe("interpolateFilters — BevelFilter", () => {
  const from: BevelFilter = {
    type: "bevel",
    distance: 0,
    angle: 0,
    highlightColor: { r: 0, g: 0, b: 0, a: 255 },
    highlightAlpha: 0,
    shadowColor: { r: 0, g: 0, b: 0, a: 255 },
    shadowAlpha: 0,
    blurX: 0,
    blurY: 0,
    strength: 0,
    quality: 1,
    bevelType: "inner",
    knockout: false,
    enabled: true,
  };
  const to: BevelFilter = {
    type: "bevel",
    distance: 10,
    angle: 90,
    highlightColor: { r: 255, g: 255, b: 255, a: 255 },
    highlightAlpha: 1,
    shadowColor: { r: 0, g: 0, b: 0, a: 255 },
    shadowAlpha: 1,
    blurX: 8,
    blurY: 4,
    strength: 2,
    quality: 1,
    bevelType: "inner",
    knockout: false,
    enabled: true,
  };

  it("t=0.5 interpolates numeric fields", () => {
    const result = interpolateFilters([from], [to], 0.5) as BevelFilter[];
    const r = result[0];
    expect(r.distance).toBeCloseTo(5);
    expect(r.angle).toBeCloseTo(45);
    expect(r.highlightAlpha).toBeCloseTo(0.5);
    expect(r.shadowAlpha).toBeCloseTo(0.5);
    expect(r.blurX).toBeCloseTo(4);
    expect(r.blurY).toBeCloseTo(2);
    expect(r.strength).toBeCloseTo(1);
  });
});

// ---------------------------------------------------------------------------
// AdjustColorFilter interpolation
// ---------------------------------------------------------------------------

describe("interpolateFilters — AdjustColorFilter", () => {
  const from: AdjustColorFilter = {
    type: "adjustColor",
    brightness: -100,
    contrast: -100,
    saturation: -100,
    hue: -180,
    enabled: true,
  };
  const to: AdjustColorFilter = {
    type: "adjustColor",
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hue: 180,
    enabled: true,
  };

  it("t=0.5 returns midpoint values", () => {
    const result = interpolateFilters([from], [to], 0.5) as AdjustColorFilter[];
    const r = result[0];
    expect(r.brightness).toBeCloseTo(0);
    expect(r.contrast).toBeCloseTo(0);
    expect(r.saturation).toBeCloseTo(0);
    expect(r.hue).toBeCloseTo(0);
  });

  it("t=0 returns from values", () => {
    const result = interpolateFilters([from], [to], 0) as AdjustColorFilter[];
    expect(result[0].brightness).toBeCloseTo(-100);
    expect(result[0].hue).toBeCloseTo(-180);
  });

  it("t=1 returns to values", () => {
    const result = interpolateFilters([from], [to], 1) as AdjustColorFilter[];
    expect(result[0].brightness).toBeCloseTo(100);
    expect(result[0].hue).toBeCloseTo(180);
  });
});

// ---------------------------------------------------------------------------
// GradientGlowFilter interpolation
// ---------------------------------------------------------------------------

describe("interpolateFilters — GradientGlowFilter", () => {
  const from: GradientGlowFilter = {
    type: "gradientGlow",
    distance: 0,
    angle: 0,
    gradient: [
      { color: "#000000", alpha: 0, ratio: 0 },
      { color: "#ff0000", alpha: 1, ratio: 128 },
    ],
    blurX: 0,
    blurY: 0,
    strength: 0,
    quality: 1,
    inner: false,
    knockout: false,
    compositeSource: true,
    enabled: true,
  };
  const to: GradientGlowFilter = {
    type: "gradientGlow",
    distance: 10,
    angle: 90,
    gradient: [
      { color: "#ffffff", alpha: 1, ratio: 64 },
      { color: "#0000ff", alpha: 0.5, ratio: 200 },
    ],
    blurX: 8,
    blurY: 4,
    strength: 2,
    quality: 1,
    inner: false,
    knockout: false,
    compositeSource: true,
    enabled: true,
  };

  it("t=0.5 interpolates numeric params and gradient stops", () => {
    const result = interpolateFilters([from], [to], 0.5) as GradientGlowFilter[];
    const r = result[0];
    expect(r.distance).toBeCloseTo(5);
    expect(r.angle).toBeCloseTo(45);
    expect(r.blurX).toBeCloseTo(4);
    expect(r.blurY).toBeCloseTo(2);
    expect(r.strength).toBeCloseTo(1);
    // gradient stop 0: color lerped between #000000 and #ffffff → #808080
    expect(r.gradient[0].color).toBe("#808080");
    expect(r.gradient[0].alpha).toBeCloseTo(0.5);
    expect(r.gradient[0].ratio).toBeCloseTo(32);
    // gradient stop 1: ratio 128→200 at t=0.5 → 164
    expect(r.gradient[1].ratio).toBeCloseTo(164);
  });

  it("gradient length mismatch → snaps to from gradient", () => {
    const toMismatch: GradientGlowFilter = {
      ...to,
      gradient: [{ color: "#ffffff", alpha: 1, ratio: 64 }],
    };
    const result = interpolateFilters([from], [toMismatch], 0.5) as GradientGlowFilter[];
    expect(result[0].gradient).toEqual(from.gradient);
  });
});

// ---------------------------------------------------------------------------
// GradientBevelFilter interpolation
// ---------------------------------------------------------------------------

describe("interpolateFilters — GradientBevelFilter", () => {
  const from: GradientBevelFilter = {
    type: "gradientBevel",
    distance: 0,
    angle: 0,
    gradient: [{ color: "#000000", alpha: 0, ratio: 0 }],
    blurX: 0,
    blurY: 0,
    strength: 0,
    quality: 1,
    inner: false,
    knockout: false,
    compositeSource: true,
    enabled: true,
  };
  const to: GradientBevelFilter = {
    type: "gradientBevel",
    distance: 10,
    angle: 90,
    gradient: [{ color: "#ffffff", alpha: 1, ratio: 255 }],
    blurX: 8,
    blurY: 4,
    strength: 2,
    quality: 1,
    inner: false,
    knockout: false,
    compositeSource: true,
    enabled: true,
  };

  it("t=0.5 interpolates numeric params", () => {
    const result = interpolateFilters([from], [to], 0.5) as GradientBevelFilter[];
    const r = result[0];
    expect(r.distance).toBeCloseTo(5);
    expect(r.angle).toBeCloseTo(45);
    expect(r.blurX).toBeCloseTo(4);
    expect(r.strength).toBeCloseTo(1);
    expect(r.gradient[0].alpha).toBeCloseTo(0.5);
    expect(r.gradient[0].ratio).toBeCloseTo(127.5);
  });
});

// ---------------------------------------------------------------------------
// Multiple filters in array
// ---------------------------------------------------------------------------

describe("interpolateFilters — multiple filters in array", () => {
  const blur1: BlurFilter = { type: "blur", blurX: 0, blurY: 0, quality: 1, enabled: true };
  const blur2: BlurFilter = { type: "blur", blurX: 20, blurY: 10, quality: 1, enabled: true };
  const adjustFrom: AdjustColorFilter = {
    type: "adjustColor",
    brightness: 0,
    contrast: 0,
    saturation: 0,
    hue: 0,
    enabled: true,
  };
  const adjustTo: AdjustColorFilter = {
    type: "adjustColor",
    brightness: 100,
    contrast: 50,
    saturation: -50,
    hue: 90,
    enabled: true,
  };

  it("t=0.5 interpolates all filters independently", () => {
    const result = interpolateFilters(
      [blur1, adjustFrom],
      [blur2, adjustTo],
      0.5
    ) as FlashFilter[];
    const b = result[0] as BlurFilter;
    expect(b.blurX).toBeCloseTo(10);
    expect(b.blurY).toBeCloseTo(5);
    const a = result[1] as AdjustColorFilter;
    expect(a.brightness).toBeCloseTo(50);
    expect(a.hue).toBeCloseTo(45);
  });
});

// ---------------------------------------------------------------------------
// interpolateTween — filters field propagated through
// ---------------------------------------------------------------------------

describe("interpolateTween — filters propagated", () => {
  const baseConfig: TweenConfig = { ease: 0 };

  it("filters from TweenTarget are included in interpolated result", () => {
    const blur1: BlurFilter = { type: "blur", blurX: 0, blurY: 0, quality: 1, enabled: true };
    const blur2: BlurFilter = { type: "blur", blurX: 20, blurY: 10, quality: 1, enabled: true };

    const from: TweenTarget = {
      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 100,
      filters: [blur1],
    };
    const to: TweenTarget = {
      x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 100,
      filters: [blur2],
    };

    const result = interpolateTween(from, to, 5, 0, 10, baseConfig);
    expect(result.filters).not.toBeNull();
    expect(result.filters).toHaveLength(1);
    const b = result.filters![0] as BlurFilter;
    // at frame 5 of 10 → t = 0.5
    expect(b.blurX).toBeCloseTo(10);
    expect(b.blurY).toBeCloseTo(5);
  });

  it("no filters in TweenTargets → result.filters is null", () => {
    const from: TweenTarget = {
      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 100,
    };
    const to: TweenTarget = {
      x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 100,
    };
    const result = interpolateTween(from, to, 5, 0, 10, baseConfig);
    expect(result.filters).toBeNull();
  });
});
