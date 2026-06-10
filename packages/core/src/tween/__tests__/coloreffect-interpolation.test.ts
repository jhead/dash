/**
 * Tests for color effect interpolation in motion tweens.
 * Covers interpolateColorEffect for all four ColorEffect types
 * (brightness, tint, alpha, advanced), plus the none/identity cases.
 */
import { describe, it, expect } from "vitest";
import { interpolateColorEffect, interpolateTween } from "../interpolate.js";
import type { TweenTarget } from "../types.js";
import type { ColorEffect } from "../../engine/types.js";

// ---------------------------------------------------------------------------
// interpolateColorEffect — unit tests per effect type
// ---------------------------------------------------------------------------

describe("interpolateColorEffect — none/null cases", () => {
  it("both null → returns null", () => {
    expect(interpolateColorEffect(null, null, 0.5)).toBeNull();
  });

  it("both 'none' → returns null", () => {
    const none: ColorEffect = { type: "none" };
    expect(interpolateColorEffect(none, none, 0.5)).toBeNull();
  });

  it("null from, null to → returns null", () => {
    expect(interpolateColorEffect(undefined, undefined, 0.5)).toBeNull();
  });
});

describe("interpolateColorEffect — brightness", () => {
  it("lerps brightness linearly at t=0.5 (result is 0 = identity → null)", () => {
    const from: ColorEffect = { type: "brightness", brightness: -100 };
    const to: ColorEffect = { type: "brightness", brightness: 100 };
    // At t=0.5, lerp(-100, 100, 0.5) = 0, which is the identity → null
    const result = interpolateColorEffect(from, to, 0.5);
    expect(result).toBeNull();
  });

  it("lerps brightness linearly at t=0.25 → -50", () => {
    const from: ColorEffect = { type: "brightness", brightness: -100 };
    const to: ColorEffect = { type: "brightness", brightness: 100 };
    const result = interpolateColorEffect(from, to, 0.25);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("brightness");
    expect(result!.brightness).toBeCloseTo(-50);
  });

  it("returns start value at t=0", () => {
    const from: ColorEffect = { type: "brightness", brightness: 50 };
    const to: ColorEffect = { type: "brightness", brightness: -50 };
    const result = interpolateColorEffect(from, to, 0);
    expect(result!.brightness).toBeCloseTo(50);
  });

  it("returns end value at t=1", () => {
    const from: ColorEffect = { type: "brightness", brightness: 50 };
    const to: ColorEffect = { type: "brightness", brightness: -50 };
    const result = interpolateColorEffect(from, to, 1);
    expect(result!.brightness).toBeCloseTo(-50);
  });

  it("interpolates from 'none' (identity = 0) to brightness", () => {
    const none: ColorEffect = { type: "none" };
    const to: ColorEffect = { type: "brightness", brightness: 80 };
    const result = interpolateColorEffect(none, to, 0.5);
    expect(result!.type).toBe("brightness");
    expect(result!.brightness).toBeCloseTo(40);
  });

  it("interpolates from brightness to 'none' (identity = 0)", () => {
    const from: ColorEffect = { type: "brightness", brightness: 80 };
    const none: ColorEffect = { type: "none" };
    const result = interpolateColorEffect(from, none, 0.5);
    expect(result!.type).toBe("brightness");
    expect(result!.brightness).toBeCloseTo(40);
  });

  it("returns null when brightness = 0 (identity)", () => {
    const from: ColorEffect = { type: "brightness", brightness: 0 };
    const to: ColorEffect = { type: "brightness", brightness: 0 };
    expect(interpolateColorEffect(from, to, 0.5)).toBeNull();
  });
});

describe("interpolateColorEffect — tint", () => {
  it("lerps tintAmount at t=0.5 from 100% red to 0%", () => {
    const from: ColorEffect = { type: "tint", tintColor: "#ff0000", tintAmount: 100 };
    const to: ColorEffect = { type: "tint", tintColor: "#ff0000", tintAmount: 0 };
    const result = interpolateColorEffect(from, to, 0.5);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("tint");
    expect(result!.tintAmount).toBeCloseTo(50);
  });

  it("lerps tint color channels at t=0.5 (red → blue)", () => {
    const from: ColorEffect = { type: "tint", tintColor: "#ff0000", tintAmount: 100 };
    const to: ColorEffect = { type: "tint", tintColor: "#0000ff", tintAmount: 100 };
    const result = interpolateColorEffect(from, to, 0.5);
    expect(result!.type).toBe("tint");
    // At t=0.5: R=127 or 128, G=0, B=127 or 128
    expect(result!.tintColor).toMatch(/^#[0-9a-f]{6}$/i);
    const clean = result!.tintColor!.replace(/^#/, "");
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    // lerp(255, 0, 0.5) = 127.5 → rounded to 127 or 128
    expect(r).toBeGreaterThanOrEqual(127);
    expect(r).toBeLessThanOrEqual(128);
    expect(g).toBe(0);
    // lerp(0, 255, 0.5) = 127.5 → rounded to 127 or 128
    expect(b).toBeGreaterThanOrEqual(127);
    expect(b).toBeLessThanOrEqual(128);
  });

  it("interpolates from 'none' (identity = tintAmount:0) to tint", () => {
    const none: ColorEffect = { type: "none" };
    const to: ColorEffect = { type: "tint", tintColor: "#ff0000", tintAmount: 100 };
    const result = interpolateColorEffect(none, to, 0.5);
    expect(result!.type).toBe("tint");
    expect(result!.tintAmount).toBeCloseTo(50);
  });

  it("returns null when tintAmount = 0 (identity)", () => {
    const from: ColorEffect = { type: "tint", tintColor: "#ff0000", tintAmount: 0 };
    const to: ColorEffect = { type: "tint", tintColor: "#0000ff", tintAmount: 0 };
    expect(interpolateColorEffect(from, to, 0.5)).toBeNull();
  });
});

describe("interpolateColorEffect — alpha", () => {
  it("lerps alpha at t=0.5 from 0 to 100", () => {
    const from: ColorEffect = { type: "alpha", alpha: 0 };
    const to: ColorEffect = { type: "alpha", alpha: 100 };
    const result = interpolateColorEffect(from, to, 0.5);
    expect(result!.type).toBe("alpha");
    expect(result!.alpha).toBeCloseTo(50);
  });

  it("returns null when alpha = 100 (fully opaque = identity)", () => {
    const from: ColorEffect = { type: "alpha", alpha: 100 };
    const to: ColorEffect = { type: "alpha", alpha: 100 };
    expect(interpolateColorEffect(from, to, 0.5)).toBeNull();
  });

  it("interpolates from 'none' (identity = alpha:100) to alpha:0", () => {
    const none: ColorEffect = { type: "none" };
    const to: ColorEffect = { type: "alpha", alpha: 0 };
    const result = interpolateColorEffect(none, to, 0.5);
    expect(result!.type).toBe("alpha");
    expect(result!.alpha).toBeCloseTo(50);
  });
});

describe("interpolateColorEffect — advanced", () => {
  it("lerps all 6 channel fields at t=0.5", () => {
    const from: ColorEffect = {
      type: "advanced",
      redMult: 0, greenMult: 0, blueMult: 0,
      redOffset: 0, greenOffset: 0, blueOffset: 0,
    };
    const to: ColorEffect = {
      type: "advanced",
      redMult: 100, greenMult: 100, blueMult: 100,
      redOffset: 100, greenOffset: 100, blueOffset: 100,
    };
    const result = interpolateColorEffect(from, to, 0.5);
    expect(result!.type).toBe("advanced");
    expect(result!.redMult).toBeCloseTo(50);
    expect(result!.greenMult).toBeCloseTo(50);
    expect(result!.blueMult).toBeCloseTo(50);
    expect(result!.redOffset).toBeCloseTo(50);
    expect(result!.greenOffset).toBeCloseTo(50);
    expect(result!.blueOffset).toBeCloseTo(50);
  });

  it("returns null when all channels are at identity (mult=100, offset=0)", () => {
    const from: ColorEffect = {
      type: "advanced",
      redMult: 100, greenMult: 100, blueMult: 100,
      redOffset: 0, greenOffset: 0, blueOffset: 0,
    };
    const to: ColorEffect = {
      type: "advanced",
      redMult: 100, greenMult: 100, blueMult: 100,
      redOffset: 0, greenOffset: 0, blueOffset: 0,
    };
    expect(interpolateColorEffect(from, to, 0.5)).toBeNull();
  });

  it("interpolates from 'none' (identity) to advanced offset", () => {
    const none: ColorEffect = { type: "none" };
    const to: ColorEffect = {
      type: "advanced",
      redMult: 100, greenMult: 100, blueMult: 100,
      redOffset: 200, greenOffset: 0, blueOffset: -200,
    };
    const result = interpolateColorEffect(none, to, 0.5);
    expect(result!.type).toBe("advanced");
    expect(result!.redOffset).toBeCloseTo(100);
    expect(result!.greenOffset).toBeCloseTo(0);
    expect(result!.blueOffset).toBeCloseTo(-100);
  });
});

describe("interpolateColorEffect — mismatched types", () => {
  it("returns from effect when types differ (no interpolation possible)", () => {
    const from: ColorEffect = { type: "brightness", brightness: 50 };
    const to: ColorEffect = { type: "tint", tintColor: "#ff0000", tintAmount: 100 };
    const result = interpolateColorEffect(from, to, 0.5);
    // Should fall back to 'from' (brightness) since types differ
    expect(result).not.toBeNull();
    expect(result!.type).toBe("brightness");
  });
});

// ---------------------------------------------------------------------------
// interpolateTween — color effect integrated into TweenTarget
// ---------------------------------------------------------------------------

describe("interpolateTween — color effect integration", () => {
  const base: TweenTarget = {
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 100,
  };

  it("interpolates tint effect through TweenTarget at t=0.5", () => {
    const from: TweenTarget = {
      ...base,
      colorEffect: { type: "tint", tintColor: "#ff0000", tintAmount: 100 },
    };
    const to: TweenTarget = {
      ...base,
      colorEffect: { type: "tint", tintColor: "#ff0000", tintAmount: 0 },
    };
    const result = interpolateTween(from, to, 5, 0, 10, { ease: 0 });
    expect(result.colorEffect).not.toBeNull();
    expect(result.colorEffect!.type).toBe("tint");
    expect(result.colorEffect!.tintAmount).toBeCloseTo(50);
  });

  it("passes null colorEffect through when both sides are null", () => {
    const from: TweenTarget = { ...base, colorEffect: null };
    const to: TweenTarget = { ...base, colorEffect: null };
    const result = interpolateTween(from, to, 5, 0, 10, { ease: 0 });
    expect(result.colorEffect).toBeNull();
  });

  it("interpolates brightness from none (null) to 100 at t=0.5 → 50", () => {
    const from: TweenTarget = { ...base, colorEffect: null };
    const to: TweenTarget = {
      ...base,
      colorEffect: { type: "brightness", brightness: 100 },
    };
    const result = interpolateTween(from, to, 5, 0, 10, { ease: 0 });
    expect(result.colorEffect!.type).toBe("brightness");
    expect(result.colorEffect!.brightness).toBeCloseTo(50);
  });
});
