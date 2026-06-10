/**
 * Tests for DisplacementMapFilter SWF encoding (FilterID = 8).
 *
 * SWF DisplacementMapFilter layout:
 *   UI8:    FilterID = 8
 *   UI16:   MapBitmapId
 *   FLOAT:  MapPoint.x  (IEEE 754 LE)
 *   FLOAT:  MapPoint.y  (IEEE 754 LE)
 *   UI8:    ComponentX
 *   UI8:    ComponentY
 *   FLOAT:  ScaleX      (IEEE 754 LE)
 *   FLOAT:  ScaleY      (IEEE 754 LE)
 *   UI8:    Mode        (0=wrap, 1=clamp, 2=ignore, 3=color)
 *   RGBA:   Color       (4 bytes)
 *   UI8:    Clamp       (reserved, 0)
 */

import { describe, it, expect } from "vitest";
import { encodePlaceObject3WithFilters } from "../filters.js";
import type { DisplacementMapFilter } from "@flash/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFloat32LE(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getFloat32(0, true);
}

function readUI16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

/**
 * Find the FILTERLIST start (FilterCount byte followed by FilterID byte) in a
 * PlaceObject3 body. Returns the index of the FilterCount byte, or -1.
 */
function findFilterListStart(body: Uint8Array, filterCount: number, filterId: number): number {
  for (let i = 7; i < body.length - 1; i++) {
    if (body[i] === filterCount && body[i + 1] === filterId) {
      return i;
    }
  }
  return -1;
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DisplacementMapFilter SWF encoding (FilterID=8)", () => {
  /**
   * Test 1: FilterID byte is 8 for DisplacementMapFilter.
   */
  it("DisplacementMapFilter: FilterID byte is 8", () => {
    const filter = makeDisplacementFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 8);
    expect(start).toBeGreaterThan(-1);
    expect(body[start + 1]).toBe(8);
  });

  /**
   * Test 2: MapBitmapId is written as UI16 LE immediately after FilterID.
   */
  it("DisplacementMapFilter: MapBitmapId is written as UI16 LE", () => {
    const filter = makeDisplacementFilter({ mapBitmapId: 42 });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 8);
    expect(start).toBeGreaterThan(-1);

    // start+0: FilterCount (1)
    // start+1: FilterID (8)
    // start+2..+3: MapBitmapId (UI16 LE)
    const mapBitmapId = readUI16LE(body, start + 2);
    expect(mapBitmapId).toBe(42);
  });

  /**
   * Test 3: MapPoint X and Y are written as FLOAT32 LE after MapBitmapId.
   */
  it("DisplacementMapFilter: MapPoint X and Y are FLOAT32 LE", () => {
    const filter = makeDisplacementFilter({ mapPoint: { x: 12.5, y: -8.0 } });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 8);
    expect(start).toBeGreaterThan(-1);

    // start+0: FilterCount
    // start+1: FilterID
    // start+2..+3: MapBitmapId (2 bytes)
    // start+4..+7: MapPoint.x (FLOAT32)
    // start+8..+11: MapPoint.y (FLOAT32)
    const mapX = readFloat32LE(body, start + 4);
    const mapY = readFloat32LE(body, start + 8);

    expect(mapX).toBeCloseTo(12.5, 5);
    expect(mapY).toBeCloseTo(-8.0, 5);
  });

  /**
   * Test 4: ComponentX and ComponentY are written as UI8 after MapPoint.
   */
  it("DisplacementMapFilter: ComponentX and ComponentY are written correctly", () => {
    const filter = makeDisplacementFilter({ componentX: 4, componentY: 8 }); // B and A channels
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 8);
    expect(start).toBeGreaterThan(-1);

    // start+12: ComponentX
    // start+13: ComponentY
    expect(body[start + 12]).toBe(4); // B channel
    expect(body[start + 13]).toBe(8); // A channel
  });

  /**
   * Test 5: ScaleX and ScaleY are written as FLOAT32 LE after ComponentY.
   */
  it("DisplacementMapFilter: ScaleX and ScaleY are FLOAT32 LE", () => {
    const filter = makeDisplacementFilter({ scaleX: 50.0, scaleY: 25.5 });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 8);
    expect(start).toBeGreaterThan(-1);

    // start+14..+17: ScaleX (FLOAT32)
    // start+18..+21: ScaleY (FLOAT32)
    const scaleX = readFloat32LE(body, start + 14);
    const scaleY = readFloat32LE(body, start + 18);

    expect(scaleX).toBeCloseTo(50.0, 4);
    expect(scaleY).toBeCloseTo(25.5, 4);
  });

  /**
   * Test 6: Mode byte is written correctly (0=wrap, 1=clamp, 2=ignore, 3=color).
   */
  it("DisplacementMapFilter: Mode byte encodes wrap/clamp/ignore/color correctly", () => {
    const modes: Array<["wrap" | "clamp" | "ignore" | "color", number]> = [
      ["wrap", 0],
      ["clamp", 1],
      ["ignore", 2],
      ["color", 3],
    ];

    for (const [modeName, modeValue] of modes) {
      const filter = makeDisplacementFilter({ mode: modeName });
      const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

      const start = findFilterListStart(body, 1, 8);
      expect(start).toBeGreaterThan(-1);

      // start+22: Mode
      expect(body[start + 22]).toBe(modeValue);
    }
  });

  /**
   * Test 7: Color RGBA bytes are written correctly after Mode.
   */
  it("DisplacementMapFilter: Color RGBA bytes are written correctly", () => {
    const filter = makeDisplacementFilter({ color: "#ff8040aa" });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 8);
    expect(start).toBeGreaterThan(-1);

    // start+23..+26: RGBA
    expect(body[start + 23]).toBe(0xff); // R
    expect(body[start + 24]).toBe(0x80); // G
    expect(body[start + 25]).toBe(0x40); // B
    expect(body[start + 26]).toBe(0xaa); // A
  });

  /**
   * Test 8: Clamp (reserved) byte is 0 after Color.
   */
  it("DisplacementMapFilter: reserved Clamp byte is 0", () => {
    const filter = makeDisplacementFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 8);
    expect(start).toBeGreaterThan(-1);

    // start+27: Clamp (reserved)
    expect(body[start + 27]).toBe(0);
  });

  /**
   * Test 9: Total FILTERLIST size for a DisplacementMapFilter.
   *
   * FilterCount(1) + FilterID(1) + MapBitmapId(2) + MapPoint(8) + ComponentX(1) +
   * ComponentY(1) + ScaleX(4) + ScaleY(4) + Mode(1) + Color(4) + Clamp(1) = 28 bytes
   */
  it("DisplacementMapFilter: total FILTERLIST has correct byte count (28 bytes)", () => {
    const filter = makeDisplacementFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 8);
    expect(start).toBeGreaterThan(-1);

    const filterListBytes = body.length - start;
    expect(filterListBytes).toBe(28);
  });

  /**
   * Test 10: HasFilterList flag (bit 4 of Flags2) is set.
   */
  it("DisplacementMapFilter: PlaceObject3 Flags2 HasFilterList bit is set", () => {
    const filter = makeDisplacementFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Flags2 is at byte index 1
    const flags2 = body[1];
    expect(flags2 & 0x10).toBe(0x10);
  });

  /**
   * Test 11: Disabled filter is excluded from the FILTERLIST.
   */
  it("DisplacementMapFilter: disabled filter is not encoded in FILTERLIST", () => {
    const filter = makeDisplacementFilter({ enabled: false });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Flags2 HasFilterList bit should be clear
    const flags2 = body[1];
    expect(flags2 & 0x10).toBe(0);

    // No FilterID=8 should appear
    const start = findFilterListStart(body, 1, 8);
    expect(start).toBe(-1);
  });

  /**
   * Test 12: Default values — mapBitmapId=0, componentX=1, componentY=2, mode=wrap (0).
   */
  it("DisplacementMapFilter: default values are encoded correctly", () => {
    const filter: DisplacementMapFilter = {
      type: "displacementMap",
      enabled: true,
    };
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 8);
    expect(start).toBeGreaterThan(-1);

    const mapBitmapId = readUI16LE(body, start + 2);
    expect(mapBitmapId).toBe(0);

    expect(body[start + 12]).toBe(1); // default componentX = 1 (Red)
    expect(body[start + 13]).toBe(2); // default componentY = 2 (Green)
    expect(body[start + 22]).toBe(0); // default mode = wrap (0)
  });
});
