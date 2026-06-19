/**
 * Regression tests for DisplacementMapFilter handling (task 1239).
 *
 * DisplacementMapFilter is an AS3 / Flash Player 9+ *runtime* filter
 * (`flash.filters.DisplacementMapFilter`) with NO Flash 8 SWF FILTERLIST
 * representation. The SWF FILTERLIST (PlaceObject3, tag 70) only defines
 * FilterIDs 0..7. The encoder previously emitted DisplacementMapFilter as
 * FilterID=8; Ruffle's `swf` crate rejects any id outside 0..7 as "Invalid
 * filter type", which makes the swf crate decode `filters = None` for the
 * ENTIRE PlaceObject3 — silently dropping every (otherwise valid) filter on
 * that instance.
 *
 * The fix: never emit a displacementMap (or any non-0..7 filter) into the SWF
 * FILTERLIST. It is skipped when building the list so the remaining valid
 * filters on the same instance still apply. These tests prove:
 *   1. No FilterID=8 byte is ever emitted.
 *   2. A displacementMap alone produces NO filter list (HasFilterList clear).
 *   3. A displacementMap mixed with a valid filter (blur) leaves the blur
 *      intact and the list well-formed (count = 1, FilterID = 1).
 */

import { describe, it, expect } from "vitest";
import {
  encodePlaceObject3WithFilters,
  encodePlaceObject3WithBlendMode,
  hasEnabledFilters,
  isSwfEncodableFilter,
  encodableFilters,
} from "../filters.js";
import type { DisplacementMapFilter, BlurFilter, FlashFilter } from "@flash/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDisplacementFilter(overrides: Partial<DisplacementMapFilter> = {}): DisplacementMapFilter {
  return {
    type: "displacementMap",
    mapBitmapId: 5,
    mapPoint: { x: 0, y: 0 },
    componentX: 1,
    componentY: 2,
    scaleX: 10,
    scaleY: 10,
    mode: "wrap",
    color: "#00000000",
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

/**
 * Find the FILTERLIST start (FilterCount byte followed by a *valid* FilterID
 * byte 0..7) in a PlaceObject3 body. Returns the index of the FilterCount byte.
 */
function findFilterListStart(body: Uint8Array, filterCount: number): number {
  for (let i = 7; i < body.length - 1; i++) {
    if (body[i] === filterCount && body[i + 1] >= 0 && body[i + 1] <= 7) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Unit: the encodability predicate
// ---------------------------------------------------------------------------

describe("SWF filter encodability (task 1239)", () => {
  it("isSwfEncodableFilter: displacementMap is NOT encodable", () => {
    expect(isSwfEncodableFilter(makeDisplacementFilter())).toBe(false);
  });

  it("isSwfEncodableFilter: blur IS encodable", () => {
    expect(isSwfEncodableFilter(makeBlurFilter())).toBe(true);
  });

  it("encodableFilters: strips displacementMap, keeps enabled valid filters", () => {
    const filters: FlashFilter[] = [
      makeBlurFilter(),
      makeDisplacementFilter(),
      makeBlurFilter({ enabled: false }), // disabled valid filter — excluded
    ];
    const result = encodableFilters(filters);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("blur");
  });

  it("hasEnabledFilters: false when the ONLY enabled filter is a displacementMap", () => {
    expect(hasEnabledFilters([makeDisplacementFilter()])).toBe(false);
  });

  it("hasEnabledFilters: true when a valid filter is present alongside a displacementMap", () => {
    expect(hasEnabledFilters([makeDisplacementFilter(), makeBlurFilter()])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Encoder: displacementMap is never emitted as FilterID=8
// ---------------------------------------------------------------------------

describe("DisplacementMapFilter is not emitted into the SWF FILTERLIST (task 1239)", () => {
  it("a lone displacementMap produces NO filter list (HasFilterList clear)", () => {
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [makeDisplacementFilter()]);

    // Flags2 (byte index 1): HasFilterList (0x01) must be clear, so there is no
    // FILTERLIST in the body at all (and therefore no FilterID=8 entry).
    expect(body[1] & 0x01).toBe(0);
  });

  it("displacementMap + blur: the blur survives, the displacement is dropped", () => {
    // Order the displacement FIRST to prove it does not shift/poison the blur.
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [
      makeDisplacementFilter(),
      makeBlurFilter({ blurX: 6, blurY: 6, quality: 2 }),
    ]);

    // HasFilterList must be set (there IS a valid filter).
    expect(body[1] & 0x01).toBe(0x01);
    // HasImage (0x10) must NOT be set (task 1238 guard).
    expect(body[1] & 0x10).toBe(0);

    // FILTERLIST: count = 1, FilterID = 1 (Blur), NOT 2 (displacement count).
    const start = findFilterListStart(body, 1);
    expect(start).toBeGreaterThan(-1);
    expect(body[start]).toBe(1); // FilterCount = 1 (blur only)
    expect(body[start + 1]).toBe(1); // FilterID = 1 (Blur)

    // No FilterID=8 byte should appear in the FILTERLIST region.
    for (let i = start; i < body.length; i++) {
      expect(body[i]).not.toBe(8);
    }
  });

  it("blur + displacementMap (reversed order): blur still intact, count = 1", () => {
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [
      makeBlurFilter(),
      makeDisplacementFilter(),
    ]);

    expect(body[1] & 0x01).toBe(0x01); // HasFilterList set
    const start = findFilterListStart(body, 1);
    expect(start).toBeGreaterThan(-1);
    expect(body[start]).toBe(1); // count = 1
    expect(body[start + 1]).toBe(1); // FilterID = 1 (Blur)
  });

  it("encodePlaceObject3WithBlendMode also skips displacementMap but keeps the blur", () => {
    const body = encodePlaceObject3WithBlendMode(
      1,
      1,
      0,
      0,
      "multiply",
      [makeDisplacementFilter(), makeBlurFilter()],
    );

    // HasBlendMode (0x02) always set; HasFilterList (0x01) set for the blur.
    expect(body[1] & 0x02).toBe(0x02);
    expect(body[1] & 0x01).toBe(0x01);

    const start = findFilterListStart(body, 1);
    expect(start).toBeGreaterThan(-1);
    expect(body[start]).toBe(1); // count = 1 (blur only)
    expect(body[start + 1]).toBe(1); // Blur
  });

  it("blend-mode placement with ONLY a displacementMap has no filter list", () => {
    const body = encodePlaceObject3WithBlendMode(
      1,
      1,
      0,
      0,
      "multiply",
      [makeDisplacementFilter()],
    );

    expect(body[1] & 0x02).toBe(0x02); // HasBlendMode set
    expect(body[1] & 0x01).toBe(0); // HasFilterList clear
  });
});
