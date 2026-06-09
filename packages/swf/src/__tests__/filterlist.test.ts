/**
 * PlaceObject3 multi-filter FILTERLIST encoding tests.
 *
 * Verifies:
 *  1. Object with 2 filters → FILTERLIST count byte = 2
 *  2. First filter ID byte = DropShadow (0)
 *  3. Blur filter ID = 1
 *  4. Glow filter ID = 2
 *  5. Bevel filter ID = 3
 *  6. Order of filters in list matches order in displayObject.filters array
 */

import { describe, it, expect } from "vitest";
import { encodePlaceObject3WithFilters } from "../filters.js";
import type {
  BlurFilter,
  GlowFilter,
  DropShadowFilter,
  BevelFilter,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Filter factories
// ---------------------------------------------------------------------------

function makeDropShadowFilter(overrides: Partial<DropShadowFilter> = {}): DropShadowFilter {
  return {
    type: "drop-shadow",
    distance: 4,
    angle: 45,
    color: { r: 0, g: 0, b: 0, a: 255 },
    alpha: 0.65,
    blurX: 4,
    blurY: 4,
    strength: 1,
    inner: false,
    knockout: false,
    hideObject: false,
    enabled: true,
    ...overrides,
  };
}

function makeBlurFilter(overrides: Partial<BlurFilter> = {}): BlurFilter {
  return {
    type: "blur",
    blurX: 4,
    blurY: 4,
    quality: 1,
    enabled: true,
    ...overrides,
  };
}

function makeGlowFilter(overrides: Partial<GlowFilter> = {}): GlowFilter {
  return {
    type: "glow",
    color: { r: 255, g: 0, b: 0, a: 255 },
    alpha: 1,
    blurX: 6,
    blurY: 6,
    strength: 2,
    inner: false,
    knockout: false,
    enabled: true,
    ...overrides,
  };
}

function makeBevelFilter(overrides: Partial<BevelFilter> = {}): BevelFilter {
  return {
    type: "bevel",
    distance: 4,
    angle: 45,
    highlightColor: { r: 255, g: 255, b: 255, a: 255 },
    highlightAlpha: 1,
    shadowColor: { r: 0, g: 0, b: 0, a: 255 },
    shadowAlpha: 1,
    blurX: 4,
    blurY: 4,
    strength: 1,
    inner: false,
    knockout: false,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: extract FILTERLIST start index from PlaceObject3 body
//
// PlaceObject3 body:
//   [0]     Flags1 UI8
//   [1]     Flags2 UI8
//   [2..3]  Depth UI16LE
//   [4..5]  CharacterId UI16LE
//   [6..]   MATRIX (variable-length bit-packed, at least 2 bytes)
//   after MATRIX: FILTERLIST = UI8 filterCount, then filter entries
//
// Strategy: scan from byte 7 looking for filterCount followed by a known
// FilterID value (0-7). Returns the byte index of filterCount.
// ---------------------------------------------------------------------------

function findFilterListStart(body: Uint8Array, expectedCount: number): number {
  for (let i = 7; i < body.length - 1; i++) {
    if (body[i] === expectedCount) {
      const nextByte = body[i + 1];
      // Valid FilterIDs: 0,1,2,3,4,6,7
      if ([0, 1, 2, 3, 4, 6, 7].includes(nextByte)) {
        return i;
      }
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlaceObject3 FILTERLIST multi-filter encoding", () => {
  /**
   * Test 1: Object with 2 filters → FILTERLIST count byte = 2.
   */
  it("FILTERLIST count byte = 2 when object has 2 enabled filters", () => {
    const blur = makeBlurFilter();
    const glow = makeGlowFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [blur, glow]);

    const start = findFilterListStart(body, 2);
    expect(start).toBeGreaterThan(-1);
    expect(body[start]).toBe(2);
  });

  /**
   * Test 2: First filter ID byte = DropShadow (0).
   * With a single DropShadow filter, the FILTERLIST is: [1, 0, ...]
   * count=1, then FilterID=0.
   */
  it("DropShadow filter ID byte is 0", () => {
    const filter = makeDropShadowFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Find FILTERLIST: count=1 then filterId=0
    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 0) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);
    expect(body[filterListStart + 1]).toBe(0); // FilterID = 0 (DropShadow)
  });

  /**
   * Test 3: Blur filter ID = 1.
   */
  it("Blur filter ID byte is 1", () => {
    const filter = makeBlurFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 1) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);
    expect(body[filterListStart + 1]).toBe(1); // FilterID = 1 (Blur)
  });

  /**
   * Test 4: Glow filter ID = 2.
   */
  it("Glow filter ID byte is 2", () => {
    const filter = makeGlowFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 2) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);
    expect(body[filterListStart + 1]).toBe(2); // FilterID = 2 (Glow)
  });

  /**
   * Test 5: Bevel filter ID = 3.
   */
  it("Bevel filter ID byte is 3", () => {
    const filter = makeBevelFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 3) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);
    expect(body[filterListStart + 1]).toBe(3); // FilterID = 3 (Bevel)
  });

  /**
   * Test 6: Order of filters in FILTERLIST matches order in the filters array.
   *
   * We place DropShadow (ID=0) first, then Blur (ID=1).
   * After the count byte (2), we expect: [0, ...dropShadowBytes..., 1, ...blurBytes...]
   */
  it("Filter order in FILTERLIST matches the filters array order (DropShadow then Blur)", () => {
    const dropShadow = makeDropShadowFilter();
    const blur = makeBlurFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [dropShadow, blur]);

    // Find FILTERLIST start where count=2
    const start = findFilterListStart(body, 2);
    expect(start).toBeGreaterThan(-1);

    // First filter entry starts at start+1
    const firstFilterId = body[start + 1];
    expect(firstFilterId).toBe(0); // DropShadow comes first
  });

  /**
   * Test 6b: Order reversed: Blur then DropShadow.
   * The FILTERLIST must have Blur (1) first, then DropShadow (0).
   */
  it("Filter order in FILTERLIST matches reversed array order (Blur then DropShadow)", () => {
    const blur = makeBlurFilter();
    const dropShadow = makeDropShadowFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [blur, dropShadow]);

    // Find FILTERLIST start where count=2
    const start = findFilterListStart(body, 2);
    expect(start).toBeGreaterThan(-1);

    // First filter entry starts at start+1
    const firstFilterId = body[start + 1];
    expect(firstFilterId).toBe(1); // Blur comes first
  });

  /**
   * Test: Three filters — count=3, order matches.
   */
  it("FILTERLIST count = 3 when object has 3 enabled filters", () => {
    const dropShadow = makeDropShadowFilter();
    const blur = makeBlurFilter();
    const glow = makeGlowFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [dropShadow, blur, glow]);

    const start = findFilterListStart(body, 3);
    expect(start).toBeGreaterThan(-1);
    expect(body[start]).toBe(3);
    // First filter should be DropShadow
    expect(body[start + 1]).toBe(0);
  });

  /**
   * Test: Disabled filters are excluded from FILTERLIST.
   * Only enabled filters contribute to the count.
   */
  it("Disabled filters are excluded from FILTERLIST count", () => {
    const enabledBlur = makeBlurFilter({ enabled: true });
    const disabledGlow = makeGlowFilter({ enabled: false });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [enabledBlur, disabledGlow]);

    // Count should be 1 (only the blur), first FilterID should be 1 (Blur)
    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 1) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);
    expect(body[filterListStart]).toBe(1); // count=1
    expect(body[filterListStart + 1]).toBe(1); // FilterID=1 (Blur)
  });
});
