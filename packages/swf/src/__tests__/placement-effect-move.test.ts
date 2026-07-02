/**
 * Task 1375 — per-placement effects must survive MOVE re-emits.
 *
 * A class of place-vs-move asymmetry: an effect (filter / blendMode / colorEffect
 * / visible / alpha) handled on FIRST placement was dropped on the posChanged/Move
 * re-emit. Because motion tweens make posChanged fire every frame, the effect was
 * lost for the whole tween — a bitmap filter tween or a shape tint tween reverted
 * to un-effected after frame 1.
 *
 * These tests compile a document whose display object MOVES across keyframes while
 * carrying a constant effect, then assert that EVERY frame's placement re-emits the
 * effect (PlaceObject3 with HasFilterList for filters; PlaceObject2 with
 * HasColorTransform for a tint) — both on the scene timeline (frames.ts) and inside
 * a movieclip symbol (sprite.ts).
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
} from "@flash/core";

// ---------------------------------------------------------------------------
// SWF / DefineSprite tag parsing
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

function walkTags(bytes: Uint8Array, start: number): SwfTag[] {
  let pos = start;
  const tags: SwfTag[] = [];
  while (pos < bytes.length - 1) {
    const h = bytes[pos] | (bytes[pos + 1] << 8);
    const code = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    let hdr = 2;
    if (len === 0x3f) {
      len =
        bytes[pos + 2] |
        (bytes[pos + 3] << 8) |
        (bytes[pos + 4] << 16) |
        (bytes[pos + 5] << 24);
      hdr = 6;
    }
    tags.push({ code, body: bytes.slice(pos + hdr, pos + hdr + len) });
    pos = pos + hdr + len;
    if (code === 0) break;
  }
  return tags;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + 4 * nBits) / 8);
  return walkTags(swf, 8 + rectBytes + 4);
}

/** Control tags inside a DefineSprite body (charId(2) frameCount(2) then tags). */
function parseSpriteTags(defineSpriteBody: Uint8Array): SwfTag[] {
  return walkTags(defineSpriteBody, 4);
}

// PlaceObject2 flags1 bits.
const PO2_HAS_MOVE = 0x01;
const PO2_HAS_COLOR_TRANSFORM = 0x08;
// PlaceObject3 flags2 bit 0 (PlaceFlag 1<<8) = HasFilterList.
const PO3_HAS_FILTER_LIST = 0x01;

// ---------------------------------------------------------------------------
// Document factory
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: "#ffffff",
  rulerUnits: "px" as const,
  grid: { showGrid: false, snapToGrid: false, gridColor: "#999999", gridWidth: 18, gridHeight: 18 },
  guides: [],
  snapToObjects: false,
  snapToPixels: false,
  snapToGuides: false,
};

function makeFrame(displayObjects: unknown[], index: number, opts: Partial<Frame> = {}): Frame {
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
    motionEaseType: "none",
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionSnap: false,
    motionScale: true,
    shapeEase: 0,
    shapeEaseType: "none",
    shapeBlend: "distributive",
    displayObjects: displayObjects as Frame["displayObjects"],
    ...opts,
  } as Frame;
}

function makeLayer(id: string, frames: Frame[], frameCount?: number): Layer {
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
    frameCount: frameCount ?? frames.length,
  };
}

// A simple filled square so a real DefineShape character is emitted.
const TRI_SHAPE = {
  id: "tri",
  paths: [
    {
      fill: { type: "solid", color: { r: 0, g: 170, b: 255, a: 255 } },
      stroke: undefined,
      start: { x: 0, y: 0 },
      segments: [
        { type: "line", to: { x: 40, y: 0 } },
        { type: "line", to: { x: 40, y: 40 } },
        { type: "line", to: { x: 0, y: 40 } },
      ],
      closed: true,
    },
  ],
};

const TINT_RED = { type: "tint" as const, tintColor: "#ff0000", tintAmount: 80 };
const BLUR = { type: "blur" as const, blurX: 8, blurY: 8, quality: 1 as const, enabled: true };

// 20×20 opaque-red pre-decoded ARGB, for the bitmap character pass.
const BMP_W = 20;
const BMP_H = 20;
const BMP_ARGB = new Uint8Array(BMP_W * BMP_H * 4);
for (let i = 0; i < BMP_W * BMP_H; i++) {
  BMP_ARGB[i * 4] = 255; // A
  BMP_ARGB[i * 4 + 1] = 255; // R
}
const RED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAG0lEQVR4nGP4z8BANiJf" +
  "56jmUc2jmkc1U0UzADHNjoAymaoJAAAAAElFTkSuQmCC";

function bitmapLibraryItem() {
  return {
    id: "bi1",
    name: "red.png",
    itemType: "bitmap",
    dataUri: `data:image/png;base64,${RED_PNG_BASE64}`,
    originalWidth: BMP_W,
    originalHeight: BMP_H,
    allowSmoothing: false,
    compressionType: "lossless",
    quality: 100,
  };
}
const BITMAP_PIXELS = new Map([["bi1", { width: BMP_W, height: BMP_H, pixels: BMP_ARGB }]]);

// ---------------------------------------------------------------------------
// Tests — scene timeline (frames.ts)
// ---------------------------------------------------------------------------

describe("task 1375 — scene timeline: effect survives MOVE re-emit", () => {
  it("bitmap filter tween keeps the filter (PlaceObject3 + HasFilterList) on every moved frame", () => {
    const bmp = (x: number) => ({
      id: "bmp",
      type: "bitmap" as const,
      libraryItemId: "bi1",
      x,
      y: 100,
      width: BMP_W,
      height: BMP_H,
      filters: [BLUR],
    });
    const frames: Frame[] = [
      makeFrame([bmp(50)], 0, { tweenType: "motion" }),
      makeFrame([bmp(150)], 1, { tweenType: "motion" }),
      makeFrame([bmp(250)], 2),
    ];
    const scene: Scene = {
      id: "s",
      name: "Scene 1",
      timeline: { layers: [makeLayer("l", frames, 3)] },
    };
    const doc = {
      id: "d",
      properties: BASE_PROPS,
      scenes: [scene],
      library: { items: [bitmapLibraryItem()], folders: [] },
    } as unknown as FlashDocument;

    const tags = parseTags(compileDocument(doc, { bitmapPixels: BITMAP_PIXELS }));

    // Count PlaceObject3 placements carrying a filter list, and assert NO plain
    // PlaceObject2 move (which would mean the filter was dropped on a re-emit).
    const po3WithFilters = tags.filter(
      (t) => t.code === Tag.PlaceObject3 && (t.body[1] & PO3_HAS_FILTER_LIST) !== 0
    );
    const po2Moves = tags.filter(
      (t) => t.code === Tag.PlaceObject2 && (t.body[0] & PO2_HAS_MOVE) !== 0
    );
    // Frame 1 first-placement PO3 + frames 2 and 3 moved PO3 = 3 total.
    expect(po3WithFilters.length).toBeGreaterThanOrEqual(3);
    expect(po2Moves.length).toBe(0);
  });

  it("shape tint tween keeps the color transform (PlaceObject2 + HasColorTransform) on every moved frame", () => {
    const shp = (x: number) => ({
      id: "sh",
      type: "shape" as const,
      shape: TRI_SHAPE,
      x,
      y: 100,
      colorEffect: TINT_RED,
    });
    const frames: Frame[] = [
      makeFrame([shp(50)], 0),
      makeFrame([shp(150)], 1),
      makeFrame([shp(250)], 2),
    ];
    const scene: Scene = {
      id: "s",
      name: "Scene 1",
      timeline: { layers: [makeLayer("l", frames, 3)] },
    };
    const doc = {
      id: "d",
      properties: BASE_PROPS,
      scenes: [scene],
      library: { items: [], folders: [] },
    } as unknown as FlashDocument;

    const tags = parseTags(compileDocument(doc));

    const movedWithColor = tags.filter(
      (t) =>
        t.code === Tag.PlaceObject2 &&
        (t.body[0] & PO2_HAS_MOVE) !== 0 &&
        (t.body[0] & PO2_HAS_COLOR_TRANSFORM) !== 0
    );
    // Any moved PlaceObject2 that drops the color transform is the bug.
    const movedWithoutColor = tags.filter(
      (t) =>
        t.code === Tag.PlaceObject2 &&
        (t.body[0] & PO2_HAS_MOVE) !== 0 &&
        (t.body[0] & PO2_HAS_COLOR_TRANSFORM) === 0
    );
    expect(movedWithColor.length).toBeGreaterThanOrEqual(2); // frames 2 and 3
    expect(movedWithoutColor.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — symbol-internal timeline (sprite.ts)
// ---------------------------------------------------------------------------

describe("task 1375 — movieclip-internal: effect survives MOVE re-emit", () => {
  function symbolWithMovingChild(child: (x: number) => unknown): Symbol {
    const frames: Frame[] = [
      makeFrame([child(0)], 0),
      makeFrame([child(30)], 1),
      makeFrame([child(60)], 2),
    ];
    return {
      id: "mc",
      name: "mc",
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
      timeline: { layers: [makeLayer("sym-l", frames, 3)] },
    } as unknown as Symbol;
  }

  function docPlacingSymbol(sym: Symbol, extraItems: unknown[] = []): FlashDocument {
    const scene: Scene = {
      id: "s",
      name: "Scene 1",
      timeline: {
        layers: [
          makeLayer("l", [
            makeFrame(
              [{ id: "inst", type: "instance", symbolId: "mc", x: 20, y: 20 }],
              0
            ),
          ]),
        ],
      },
    };
    return {
      id: "d",
      properties: BASE_PROPS,
      scenes: [scene],
      library: { items: [sym, ...extraItems], folders: [] },
    } as unknown as FlashDocument;
  }

  it("shape tint tween inside a movieclip keeps the color transform on moved frames", () => {
    const sym = symbolWithMovingChild((x) => ({
      id: "sh",
      type: "shape",
      shape: TRI_SHAPE,
      x,
      y: 0,
      colorEffect: TINT_RED,
    }));
    const tags = parseTags(compileDocument(docPlacingSymbol(sym)));
    const sprite = tags.find((t) => t.code === Tag.DefineSprite);
    expect(sprite).toBeDefined();
    const inner = parseSpriteTags(sprite!.body);

    const movedWithColor = inner.filter(
      (t) =>
        t.code === Tag.PlaceObject2 &&
        (t.body[0] & PO2_HAS_MOVE) !== 0 &&
        (t.body[0] & PO2_HAS_COLOR_TRANSFORM) !== 0
    );
    const movedWithoutColor = inner.filter(
      (t) =>
        t.code === Tag.PlaceObject2 &&
        (t.body[0] & PO2_HAS_MOVE) !== 0 &&
        (t.body[0] & PO2_HAS_COLOR_TRANSFORM) === 0
    );
    expect(movedWithColor.length).toBeGreaterThanOrEqual(2);
    expect(movedWithoutColor.length).toBe(0);
  });

  it("bitmap filter tween inside a movieclip keeps the filter on moved frames", () => {
    const sym = symbolWithMovingChild((x) => ({
      id: "bmp",
      type: "bitmap",
      libraryItemId: "bi1",
      x,
      y: 0,
      width: BMP_W,
      height: BMP_H,
      filters: [BLUR],
    }));
    const tags = parseTags(
      compileDocument(docPlacingSymbol(sym, [bitmapLibraryItem()]), { bitmapPixels: BITMAP_PIXELS })
    );
    const sprite = tags.find((t) => t.code === Tag.DefineSprite);
    expect(sprite).toBeDefined();
    const inner = parseSpriteTags(sprite!.body);

    const po3WithFilters = inner.filter(
      (t) => t.code === Tag.PlaceObject3 && (t.body[1] & PO3_HAS_FILTER_LIST) !== 0
    );
    const po2Moves = inner.filter(
      (t) => t.code === Tag.PlaceObject2 && (t.body[0] & PO2_HAS_MOVE) !== 0
    );
    expect(po3WithFilters.length).toBeGreaterThanOrEqual(3);
    expect(po2Moves.length).toBe(0);
  });
});
