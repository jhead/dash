/**
 * Tests for SWF filter encoding (FILTERLIST, PlaceObject3).
 *
 * Tag codes:
 *   26  PlaceObject2
 *   70  PlaceObject3
 *   83  DefineShape4
 *
 * These tests verify:
 *  - BlurFilter bytes (FilterID=1, correct BlurX/Y encoding)
 *  - GlowFilter bytes (FilterID=2, RGBA color order)
 *  - DropShadowFilter bytes (FilterID=0)
 *  - FilterList with multiple filters (correct count byte)
 *  - Symbol instance with blur filter uses PlaceObject3 (tag 70)
 *  - Symbol without filters uses PlaceObject2 (tag 26)
 *  - Symbol with empty filters array uses PlaceObject2
 *  - Strength field encoding (8.8 fixed point)
 */

import { describe, it, expect } from "vitest";
import { encodePlaceObject3WithFilters, hasEnabledFilters } from "../filters.js";
import { compileDocument } from "../compile.js";
import type { BlurFilter, GlowFilter, DropShadowFilter, GradientGlowFilter, GradientBevelFilter, AdjustColorFilter } from "@flash/core";
import type { FlashDocument, Frame, Layer, Scene, Symbol } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_PLACE_OBJECT2 = 26;
const TAG_PLACE_OBJECT3 = 70;
const TAG_END = 0;

// ---------------------------------------------------------------------------
// SWF tag parser (copied from scenes.test.ts)
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
  while (pos < swf.length) {
    const recordHeader = swf[pos] | (swf[pos + 1] << 8);
    const tagCode = (recordHeader >> 6) & 0x3ff;
    let bodyLength = recordHeader & 0x3f;
    let headerSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        swf[pos + 2] |
        (swf[pos + 3] << 8) |
        (swf[pos + 4] << 16) |
        (swf[pos + 5] << 24);
      headerSize = 6;
    }
    const bodyStart = pos + headerSize;
    tags.push({
      code: tagCode,
      body: swf.slice(bodyStart, bodyStart + bodyLength),
    });
    pos = bodyStart + bodyLength;
    if (tagCode === TAG_END) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Document factory helpers
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: "#ffffff",
  rulerUnits: "px" as const,
  grid: {
    showGrid: false,
    snapToGrid: false,
    gridColor: "#999999",
    gridWidth: 18,
    gridHeight: 18,
  },
  guides: [],
  snapToObjects: false,
  snapToPixels: false,
  snapToGuides: false,
};

function makeFrame(displayObjects: unknown[] = [], index = 0): Frame {
  return {
    index,
    isKeyframe: true,
    isEmpty: displayObjects.length === 0,
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects: displayObjects as Frame["displayObjects"],
  };
}

function makeLayer(id: string, frames: Frame[]): Layer {
  return {
    id,
    name: id,
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames,
    frameCount: frames.length,
  };
}

function makeScene(layers: Layer[]): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers },
  };
}

/** Build a minimal Symbol for use in SymbolInstance tests. */
function makeSymbol(id: string): Symbol {
  return {
    id,
    name: id,
    itemType: "symbol",
    symbolType: "movieclip",
    linkage: {
      exportForActionScript: false,
      exportInFirstFrame: false,
      linkageIdentifier: "",
      className: "",
      exportForRuntimeSharing: false,
      importForRuntimeSharing: false,
      sharedUrl: "",
    },
    scale9Grid: null,
    timeline: {
      layers: [makeLayer("layer", [makeFrame([], 0)])],
    },
  };
}

function makeDoc(scenes: Scene[], symbols: Symbol[] = []): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes,
    library: {
      items: symbols,
      folders: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Filter factories
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helper: read a little-endian IEEE 754 float from bytes at offset
// ---------------------------------------------------------------------------

function readFloat32LE(bytes: Uint8Array, offset: number): number {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setUint8(0, bytes[offset]);
  view.setUint8(1, bytes[offset + 1]);
  view.setUint8(2, bytes[offset + 2]);
  view.setUint8(3, bytes[offset + 3]);
  return view.getFloat32(0, true /* LE */);
}

/**
 * Read a SWF FIXED16 value (16.16 signed fixed-point, 4 bytes LE).
 * The integer is interpreted as round(value * 65536), so divide by 65536 to get the float.
 */
function readFixed16(bytes: Uint8Array, offset: number): number {
  const raw =
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24);
  // Convert unsigned 32-bit to signed 32-bit
  const signed = raw | 0;
  return signed / 65536;
}

function readUI16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF filter encoding", () => {
  /**
   * Test 1: BlurFilter bytes — correct FilterID=1 and BlurX/Y encoding.
   *
   * PlaceObject3 body layout (with one Blur filter):
   *   [0]       Flags1 UI8
   *   [1]       Flags2 UI8
   *   [2..3]    Depth UI16LE
   *   [4..5]    CharacterId UI16LE
   *   [6..]     MATRIX (variable width bit-packed)
   *   [after MATRIX] FILTERLIST:
   *                    [0] FilterCount UI8 = 1
   *                    [1] FilterID UI8 = 1 (Blur)
   *                    [2..5] BlurX FLOAT LE
   *                    [6..9] BlurY FLOAT LE
   *                    [10] Passes UI8
   */
  it("BlurFilter: FilterID=1 and BlurX/BlurY are IEEE 754 floats", () => {
    const filter = makeBlurFilter({ blurX: 8, blurY: 16 });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Find the FILTERLIST: it starts after the fixed-size header part.
    // Flags1, Flags2, Depth, CharId = 6 bytes
    // MATRIX at (0,0) with no scale/rotate = minimal:
    //   hasScale=0 (1 bit), hasRotate=0 (1 bit), nTransBits=UB[5] (5 bits), tx+ty (2*nBits) → flush
    // For (0,0): minimal nBits = 2, so: 1+1+5+2+2 = 11 bits → 2 bytes (padded)
    // So FILTERLIST starts at byte 6 + 2 = 8
    // But let's find it by scanning for the FilterCount byte (=1) followed by FilterID (=1).

    // We know FILTERLIST is after the MATRIX. Let's look for FilterID=1 (Blur)
    // after byte 7 (MATRIX should be at least 2 bytes).
    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 /* FilterCount=1 */ && body[i + 1] === 1 /* FilterID=1=Blur */) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);

    const filterIdByte = body[filterListStart + 1];
    expect(filterIdByte).toBe(1); // FilterID for Blur

    // BlurX/BlurY are FIXED16 (16.16 fixed-point), not IEEE 754 floats.
    const blurX = readFixed16(body, filterListStart + 2);
    const blurY = readFixed16(body, filterListStart + 6);

    expect(blurX).toBeCloseTo(8, 5);
    expect(blurY).toBeCloseTo(16, 5);
  });

  /**
   * Test 2: GlowFilter bytes — FilterID=2 and RGBA color order.
   */
  it("GlowFilter: FilterID=2 and color bytes in RGBA order", () => {
    const filter = makeGlowFilter({
      color: { r: 0x12, g: 0x34, b: 0x56, a: 255 },
      alpha: 1,
    });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Find FILTERLIST: FilterCount=1 then FilterID=2
    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 2) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);

    const filterId = body[filterListStart + 1];
    expect(filterId).toBe(2); // Glow

    // RGBA comes immediately after FilterID
    const r = body[filterListStart + 2];
    const g = body[filterListStart + 3];
    const b = body[filterListStart + 4];
    const a = body[filterListStart + 5];

    expect(r).toBe(0x12);
    expect(g).toBe(0x34);
    expect(b).toBe(0x56);
    expect(a).toBe(255);
  });

  /**
   * Test 3: DropShadowFilter bytes — FilterID=0.
   */
  it("DropShadowFilter: FilterID=0 and RGBA color bytes correct", () => {
    const filter = makeDropShadowFilter({
      color: { r: 0xaa, g: 0xbb, b: 0xcc, a: 255 },
      alpha: 1.0,
    });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Find FILTERLIST: FilterCount=1 then FilterID=0
    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 0) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);

    const filterId = body[filterListStart + 1];
    expect(filterId).toBe(0); // DropShadow

    // RGBA after FilterID
    const r = body[filterListStart + 2];
    const g = body[filterListStart + 3];
    const b = body[filterListStart + 4];
    const a = body[filterListStart + 5];

    expect(r).toBe(0xaa);
    expect(g).toBe(0xbb);
    expect(b).toBe(0xcc);
    expect(a).toBe(255);
  });

  /**
   * Test 4: FilterList with 2 filters — correct count byte = 2.
   */
  it("FILTERLIST with 2 filters has FilterCount=2", () => {
    const blur = makeBlurFilter();
    const glow = makeGlowFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [blur, glow]);

    // The FILTERLIST starts after MATRIX. Scan for count byte = 2
    // followed by a valid FilterID (0, 1, or 2).
    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 2 && (body[i + 1] === 0 || body[i + 1] === 1 || body[i + 1] === 2)) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);
    expect(body[filterListStart]).toBe(2); // FilterCount = 2
  });

  /**
   * Test 5: Symbol instance with blur filter uses PlaceObject3 (tag 70).
   */
  it("SymbolInstance with blur filter is placed with PlaceObject3 (tag 70)", () => {
    const sym = makeSymbol("sym-1");

    const instanceObj = {
      id: "inst-1",
      type: "instance" as const,
      symbolId: "sym-1",
      x: 0,
      y: 0,
      filters: [makeBlurFilter()],
    };

    const doc = makeDoc(
      [makeScene([makeLayer("layer", [makeFrame([instanceObj])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const placeObject3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    expect(placeObject3Tags.length).toBeGreaterThan(0);
  });

  /**
   * Test 6: Symbol instance without filters uses PlaceObject2 (tag 26).
   */
  it("SymbolInstance without filters is placed with PlaceObject2 (tag 26)", () => {
    const sym = makeSymbol("sym-2");

    const instanceObj = {
      id: "inst-2",
      type: "instance" as const,
      symbolId: "sym-2",
      x: 0,
      y: 0,
      // no filters
    };

    const doc = makeDoc(
      [makeScene([makeLayer("layer", [makeFrame([instanceObj])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const placeObject3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    const placeObject2Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);

    // Should have PlaceObject2 but NOT PlaceObject3
    expect(placeObject2Tags.length).toBeGreaterThan(0);
    expect(placeObject3Tags.length).toBe(0);
  });

  /**
   * Test 7: Symbol instance with empty filters array uses PlaceObject2.
   */
  it("SymbolInstance with empty filters array uses PlaceObject2 (tag 26)", () => {
    const sym = makeSymbol("sym-3");

    const instanceObj = {
      id: "inst-3",
      type: "instance" as const,
      symbolId: "sym-3",
      x: 0,
      y: 0,
      filters: [], // empty array
    };

    const doc = makeDoc(
      [makeScene([makeLayer("layer", [makeFrame([instanceObj])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const placeObject3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    const placeObject2Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);

    expect(placeObject2Tags.length).toBeGreaterThan(0);
    expect(placeObject3Tags.length).toBe(0);
  });

  /**
   * Test 8: Strength field encoding (8.8 fixed-point).
   *
   * GlowFilter with strength=2 should encode Strength as UI16LE = 2 * 256 = 512 = 0x0200.
   * Bytes: [0x00, 0x02].
   */
  it("GlowFilter strength is encoded as 8.8 fixed-point (value * 256)", () => {
    const filter = makeGlowFilter({ strength: 2 });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Find FILTERLIST start (FilterCount=1, FilterID=2)
    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 2) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);

    // GlowFilter layout after FilterID:
    //   [2..5]  R G B A  (4 bytes)
    //   [6..9]  BlurX FLOAT (4 bytes)
    //   [10..13] BlurY FLOAT (4 bytes)
    //   [14..15] Strength FIXED8 UI16LE (2 bytes)
    const strengthOffset = filterListStart + 2 + 4 + 4 + 4; // skip FilterID + RGBA + BlurX + BlurY
    const strength = readUI16LE(body, strengthOffset);

    // strength=2 → 2 * 256 = 512 = 0x0200
    expect(strength).toBe(2 * 256); // 512
  });

  /**
   * Test 9: DropShadowFilter strength is also 8.8 fixed-point.
   */
  it("DropShadowFilter strength is encoded as 8.8 fixed-point (value * 256)", () => {
    const filter = makeDropShadowFilter({ strength: 3, alpha: 1.0 });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Find FILTERLIST (FilterCount=1, FilterID=0)
    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 0) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);

    // DropShadowFilter layout after FilterID:
    //   [2..5]  RGBA (4 bytes)
    //   [6..9]  BlurX FLOAT (4 bytes)
    //   [10..13] BlurY FLOAT (4 bytes)
    //   [14..17] Angle FLOAT (4 bytes)
    //   [18..21] Distance FLOAT (4 bytes)
    //   [22..23] Strength FIXED8 UI16LE (2 bytes)
    const strengthOffset = filterListStart + 2 + 4 + 4 + 4 + 4 + 4;
    const strength = readUI16LE(body, strengthOffset);

    expect(strength).toBe(3 * 256); // 768
  });

  /**
   * Test for GradientGlow filter (FilterID=4).
   */
  it("GradientGlow filter: PlaceObject3 contains filter ID byte 4", () => {
    const sym = makeSymbol("sym-gg");

    const gradientGlowFilter: GradientGlowFilter = {
      type: "gradientGlow",
      distance: 4,
      angle: 45,
      gradient: [
        { color: "#000000", alpha: 0, ratio: 0 },
        { color: "#ff0000", alpha: 1, ratio: 128 },
        { color: "#ffffff", alpha: 1, ratio: 255 },
      ],
      blurX: 4,
      blurY: 4,
      strength: 1,
      quality: 1,
      inner: false,
      knockout: false,
      compositeSource: true,
      enabled: true,
    };

    const instanceObj = {
      id: "inst-gg",
      type: "instance" as const,
      symbolId: "sym-gg",
      x: 0,
      y: 0,
      filters: [gradientGlowFilter],
    };

    const doc = makeDoc(
      [makeScene([makeLayer("layer", [makeFrame([instanceObj])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const po3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    expect(po3Tags.length).toBeGreaterThan(0);

    // The PlaceObject3 body should contain filter ID byte 4
    const body = po3Tags[0].body;
    let found = false;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 4) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  /**
   * Test for AdjustColor filter (FilterID=6).
   */
  it("AdjustColor filter: PlaceObject3 contains filter ID byte 6", () => {
    const sym = makeSymbol("sym-ac");

    const adjustColorFilter: AdjustColorFilter = {
      type: "adjustColor",
      brightness: 10,
      contrast: 0,
      saturation: 0,
      hue: 0,
      enabled: true,
    };

    const instanceObj = {
      id: "inst-ac",
      type: "instance" as const,
      symbolId: "sym-ac",
      x: 0,
      y: 0,
      filters: [adjustColorFilter],
    };

    const doc = makeDoc(
      [makeScene([makeLayer("layer", [makeFrame([instanceObj])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const po3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    expect(po3Tags.length).toBeGreaterThan(0);

    // The PlaceObject3 body should contain filter ID byte 6
    const body = po3Tags[0].body;
    let found = false;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 6) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  /**
   * Test for GradientBevel filter (FilterID=7).
   */
  it("GradientBevel filter: PlaceObject3 contains filter ID byte 7", () => {
    const sym = makeSymbol("sym-gb");

    const gradientBevelFilter: GradientBevelFilter = {
      type: "gradientBevel",
      distance: 4,
      angle: 45,
      gradient: [
        { color: "#000000", alpha: 1, ratio: 0 },
        { color: "#ffffff", alpha: 1, ratio: 128 },
        { color: "#808080", alpha: 1, ratio: 255 },
      ],
      blurX: 4,
      blurY: 4,
      strength: 1,
      quality: 1,
      inner: false,
      knockout: false,
      compositeSource: true,
      enabled: true,
    };

    const instanceObj = {
      id: "inst-gb",
      type: "instance" as const,
      symbolId: "sym-gb",
      x: 0,
      y: 0,
      filters: [gradientBevelFilter],
    };

    const doc = makeDoc(
      [makeScene([makeLayer("layer", [makeFrame([instanceObj])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const po3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    expect(po3Tags.length).toBeGreaterThan(0);

    // The PlaceObject3 body should contain filter ID byte 7
    const body = po3Tags[0].body;
    let found = false;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 7) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  /**
   * Test 10: hasEnabledFilters utility.
   */
  it("hasEnabledFilters returns true only when filters array has enabled filters", () => {
    expect(hasEnabledFilters(undefined)).toBe(false);
    expect(hasEnabledFilters([])).toBe(false);
    expect(hasEnabledFilters([makeBlurFilter({ enabled: false })])).toBe(false);
    expect(hasEnabledFilters([makeBlurFilter({ enabled: true })])).toBe(true);
    expect(
      hasEnabledFilters([
        makeBlurFilter({ enabled: false }),
        makeGlowFilter({ enabled: true }),
      ])
    ).toBe(true);
  });

  /**
   * Test 11: PlaceObject3 Flags2 bit 4 (HasFilterList) is set when filters present.
   */
  it("PlaceObject3 body Flags2 byte has HasFilterList bit set (bit 4 = 0x10)", () => {
    const filter = makeBlurFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Flags2 is at byte index 1
    const flags2 = body[1];
    expect(flags2 & 0x10).toBe(0x10); // bit 4 = HasFilterList
  });

  /**
   * Test 12: PlaceObject3 Flags2 is 0 when no enabled filters.
   */
  it("PlaceObject3 body Flags2 byte is 0 when all filters are disabled", () => {
    const filter = makeBlurFilter({ enabled: false });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const flags2 = body[1];
    expect(flags2).toBe(0); // No filter list
  });

  /**
   * Test 13: ShapeDisplayObject with drop shadow filter uses PlaceObject3 (tag 70).
   *
   * This is the root-cause regression test for the visual oracle "drop shadow
   * filter" failure.  A shape-type display object (not a SymbolInstance) that
   * carries a drop-shadow filter must be placed with PlaceObject3 so the
   * FILTERLIST payload is accepted by the Flash/Ruffle player.
   */
  it("ShapeDisplayObject with drop shadow filter is placed with PlaceObject3 (tag 70)", () => {
    const shapeObj = {
      id: "shadow-rect",
      type: "shape" as const,
      shape: {
        id: "shape-shadow-rect",
        paths: [
          {
            start: { x: 175, y: 125 },
            segments: [
              { type: "line" as const, to: { x: 375, y: 125 } },
              { type: "line" as const, to: { x: 375, y: 275 } },
              { type: "line" as const, to: { x: 175, y: 275 } },
            ],
            closed: true,
            fill: {
              type: "solid" as const,
              color: { r: 255, g: 255, b: 255, a: 255 },
            },
          },
        ],
      },
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      filters: [makeDropShadowFilter()],
    };

    const doc = makeDoc([
      makeScene([makeLayer("layer", [makeFrame([shapeObj])])]),
    ]);

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const placeObject3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    const placeObject2Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);

    // ShapeDisplayObject with drop shadow must use PlaceObject3
    expect(placeObject3Tags.length).toBeGreaterThan(0);

    // The PlaceObject3 body should contain filter ID byte 0x00 (DropShadow)
    const body = placeObject3Tags[0].body;
    let foundDropShadow = false;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 /* FilterCount=1 */ && body[i + 1] === 0 /* FilterID=0=DropShadow */) {
        foundDropShadow = true;
        break;
      }
    }
    expect(foundDropShadow).toBe(true);

    // There should be no PlaceObject2 for the shape that carries the filter
    // (it may still be 0 if there's only one layer/object)
    expect(placeObject2Tags.length).toBe(0);
  });

  /**
   * Test 14: ShapeDisplayObject without filters still uses PlaceObject2 (tag 26).
   */
  it("ShapeDisplayObject without filters is placed with PlaceObject2 (tag 26)", () => {
    const shapeObj = {
      id: "plain-rect",
      type: "shape" as const,
      shape: {
        id: "shape-plain-rect",
        paths: [
          {
            start: { x: 100, y: 100 },
            segments: [
              { type: "line" as const, to: { x: 200, y: 100 } },
              { type: "line" as const, to: { x: 200, y: 200 } },
              { type: "line" as const, to: { x: 100, y: 200 } },
            ],
            closed: true,
            fill: {
              type: "solid" as const,
              color: { r: 255, g: 0, b: 0, a: 255 },
            },
          },
        ],
      },
      x: 0,
      y: 0,
    };

    const doc = makeDoc([
      makeScene([makeLayer("layer", [makeFrame([shapeObj])])]),
    ]);

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const placeObject3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    const placeObject2Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);

    expect(placeObject2Tags.length).toBeGreaterThan(0);
    expect(placeObject3Tags.length).toBe(0);
  });

  /**
   * Test 15: DropShadowFilter uses FIXED16 (not IEEE 754 float) for BlurX/BlurY/Angle/Distance.
   *
   * Regression test for task 0664: filter values were previously written as IEEE 754 floats,
   * but Ruffle's parser (swf/src/read.rs read_drop_shadow_filter) reads them as Fixed16.
   *
   * Fixed16 encoding: value * 65536 stored as signed LE int32.
   * The raw bytes for blurX=4 in Fixed16: 4 * 65536 = 262144 = 0x00040000
   *   → bytes [0x00, 0x00, 0x04, 0x00] (LE)
   * If it were IEEE 754: 4.0f = 0x40800000 → bytes [0x00, 0x00, 0x80, 0x40]
   */
  it("DropShadowFilter blurX/blurY/angle/distance are FIXED16 (not IEEE 754 float)", () => {
    const filter = makeDropShadowFilter({ blurX: 4, blurY: 8, angle: 45, distance: 10, alpha: 1.0 });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Find FILTERLIST (FilterCount=1, FilterID=0)
    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 0) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);

    // Layout after FilterID (offset +1):
    //   RGBA: 4 bytes (offset +2..+5)
    //   BlurX: FIXED16, 4 bytes (offset +6..+9)
    //   BlurY: FIXED16, 4 bytes (offset +10..+13)
    //   Angle: FIXED16, 4 bytes (offset +14..+17)  (radians)
    //   Distance: FIXED16, 4 bytes (offset +18..+21)
    const blurXFixed = readFixed16(body, filterListStart + 2 + 4);          // +6 from filterListStart
    const blurYFixed = readFixed16(body, filterListStart + 2 + 4 + 4);      // +10
    const angleFixed = readFixed16(body, filterListStart + 2 + 4 + 4 + 4);  // +14
    const distFixed  = readFixed16(body, filterListStart + 2 + 4 + 4 + 4 + 4); // +18

    expect(blurXFixed).toBeCloseTo(4, 3);
    expect(blurYFixed).toBeCloseTo(8, 3);
    // angle=45° → π/4 ≈ 0.7854 radians
    expect(angleFixed).toBeCloseTo(Math.PI / 4, 3);
    expect(distFixed).toBeCloseTo(10, 3);

    // Confirm it is NOT IEEE 754: blurX=4 as float32 bytes start with 0x00, 0x00, 0x80, 0x40
    // but as Fixed16 they start with 0x00, 0x00, 0x04, 0x00
    // blurX bytes at filterListStart+6
    const blurXByte2 = body[filterListStart + 2 + 4 + 2]; // third byte of BlurX (LE)
    // IEEE 754 float 4.0: 0x40800000 LE → bytes [0x00, 0x00, 0x80, 0x40], so third byte = 0x80
    // Fixed16 4.0: 0x00040000 LE → bytes [0x00, 0x00, 0x04, 0x00], so third byte = 0x04
    expect(blurXByte2).toBe(0x04); // FIXED16, not float
  });

  /**
   * Test 16: BlurFilter uses FIXED16 (not IEEE 754 float) for BlurX/BlurY.
   */
  it("BlurFilter blurX/blurY are FIXED16 (not IEEE 754 float)", () => {
    const filter = makeBlurFilter({ blurX: 6, blurY: 10 });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Find FILTERLIST (FilterCount=1, FilterID=1)
    let filterListStart = -1;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 1) {
        filterListStart = i;
        break;
      }
    }
    expect(filterListStart).toBeGreaterThan(-1);

    // BlurX at +2, BlurY at +6 (from filterListStart, after FilterID byte at +1)
    const blurX = readFixed16(body, filterListStart + 2);
    const blurY = readFixed16(body, filterListStart + 6);

    expect(blurX).toBeCloseTo(6, 3);
    expect(blurY).toBeCloseTo(10, 3);

    // Third byte of blurX=6 in Fixed16: 6 * 65536 = 0x00060000 → third byte = 0x06
    const blurXByte2 = body[filterListStart + 2 + 2];
    expect(blurXByte2).toBe(0x06);
  });
});
