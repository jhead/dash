/**
 * Clip actions and loopMode/firstFrame in symbol timelines (task 1124).
 *
 * Verifies that sprite.ts correctly encodes:
 *   - Explicit clipActions on SymbolInstance inside a MovieClip symbol timeline
 *   - Synthesized clip actions for loopMode='play-once' (enterFrame→stop)
 *   - Synthesized clip actions for loopMode='single-frame' (load→gotoAndStop)
 *   - firstFrame>0 seek action (load→gotoAndPlay)
 *
 * SWF tag codes:
 *   0   End
 *   1   ShowFrame
 *  26   PlaceObject2
 *  39   DefineSprite
 *
 * PlaceObject2 flags (byte 0):
 *   bit 0: HasMove
 *   bit 1: HasCharacter
 *   bit 6: HasClipDepth
 *   bit 7: HasClipActions (= 0x80)
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  ClipAction,
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
  SymbolInstance,
} from "@flash/core";

// ---------------------------------------------------------------------------
// SWF binary parser helpers (duplicated from other test files for locality)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function findTagsOffset(bytes: Uint8Array): number {
  const nBits = (bytes[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  return 8 + rectBytes + 4;
}

function parseTags(bytes: Uint8Array): SWFTag[] {
  const offset = findTagsOffset(bytes);
  const tags: SWFTag[] = [];
  let pos = offset;
  while (pos + 2 <= bytes.length) {
    const hdr = bytes[pos] | (bytes[pos + 1] << 8);
    const code = (hdr >> 6) & 0x3ff;
    let len = hdr & 0x3f;
    let hdrSize = 2;
    if (len === 0x3f) {
      len =
        bytes[pos + 2] |
        (bytes[pos + 3] << 8) |
        (bytes[pos + 4] << 16) |
        (bytes[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({ code, body: bytes.slice(bodyStart, bodyStart + len) });
    pos = bodyStart + len;
    if (code === 0) break;
  }
  return tags;
}

function parseSpriteInnerTags(body: Uint8Array): SWFTag[] {
  let pos = 4; // skip SpriteID (2) + FrameCount (2)
  const tags: SWFTag[] = [];
  while (pos + 2 <= body.length) {
    const hdr = body[pos] | (body[pos + 1] << 8);
    const code = (hdr >> 6) & 0x3ff;
    let len = hdr & 0x3f;
    let hdrSize = 2;
    if (len === 0x3f) {
      len =
        body[pos + 2] |
        (body[pos + 3] << 8) |
        (body[pos + 4] << 16) |
        (body[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({ code, body: body.slice(bodyStart, bodyStart + len) });
    pos = bodyStart + len;
    if (code === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Tag constants
// ---------------------------------------------------------------------------

const TAG_PLACE_OBJECT2 = 26;
const TAG_DEFINE_SPRITE = 39;

// HasClipActions flag in PlaceObject2 flags byte
const HAS_CLIP_ACTIONS = 0x80;
const HAS_CHARACTER = 0x02;

// ---------------------------------------------------------------------------
// Fixture helpers
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

const DEFAULT_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

function makeFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: false,
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
    motionScale: false,
    shapeEase: 0,
    shapeEaseType: "none",
    shapeBlend: "distributive",
    displayObjects: [],
    ...overrides,
  };
}

function makeLayer(name: string, frames: Partial<Frame>[] = [{}]): Layer {
  const full = frames.map((f, i) => makeFrame({ index: i, ...f }));
  return {
    id: `layer-${name}`,
    name,
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames: full,
    frameCount: full.length,
  };
}

function makeScene(id: string, name: string, layers: Layer[]): Scene {
  return { id, name, timeline: { layers } };
}

/** Leaf symbol — used as the nested target inside an outer symbol. loopMode /
 *  firstFrame only apply to GRAPHIC symbols, so loopMode tests pass "graphic". */
function makeLeafSymbol(id: string, name: string, symbolType: "movieclip" | "graphic" = "movieclip"): Symbol {
  return {
    id,
    name,
    itemType: "symbol",
    symbolType,
    timeline: { layers: [makeLayer("Layer 1", [{ isEmpty: true }])] },
    linkage: DEFAULT_LINKAGE,
    scale9Grid: null,
  };
}

/** Outer symbol with a single layer whose first keyframe places a SymbolInstance. */
function makeOuterSymbol(
  outerId: string,
  outerName: string,
  innerSymbolId: string,
  instanceOverrides: Partial<SymbolInstance> = {}
): Symbol {
  const inst: SymbolInstance = {
    id: "inst-1",
    type: "instance",
    symbolId: innerSymbolId,
    instanceName: "",
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    skewX: 0,
    skewY: 0,
    visible: true,
    alpha: 1,
    blendMode: "normal",
    cacheAsBitmap: false,
    filters: [],
    colorEffect: { type: "none" },
    loopMode: "loop",
    firstFrame: 0,
    clipActions: [],
    ...instanceOverrides,
  };
  return {
    id: outerId,
    name: outerName,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: {
      layers: [
        makeLayer("Layer 1", [
          { isEmpty: false, displayObjects: [inst] },
        ]),
      ],
    },
    linkage: DEFAULT_LINKAGE,
    scale9Grid: null,
  };
}

function makeDoc(overrides: Partial<FlashDocument> = {}): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene("scene-1", "Scene 1", [makeLayer("Layer 1", [{ isEmpty: true }])])],
    library: { items: [], folders: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: extract the PlaceObject2 tags from inside the OUTER DefineSprite body.
// The outer sprite is the last DefineSprite tag (the inner/leaf is first).
// ---------------------------------------------------------------------------

function getOuterSpriteInnerPO2s(bytes: Uint8Array): SWFTag[] {
  const tags = parseTags(bytes);
  const spriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
  // outer symbol is the last sprite defined
  const outerSprite = spriteTags[spriteTags.length - 1];
  if (!outerSprite) return [];
  const inner = parseSpriteInnerTags(outerSprite.body);
  return inner.filter((t) => t.code === TAG_PLACE_OBJECT2);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sprite.ts: clip actions on SymbolInstance in symbol timeline (task 1124)", () => {

  it("1. plain instance (no clip actions) — PlaceObject2 has no HasClipActions flag", () => {
    const leaf = makeLeafSymbol("leaf-1", "LeafClip");
    const outer = makeOuterSymbol("outer-1", "OuterClip", "leaf-1");
    const doc = makeDoc({ library: { items: [leaf, outer], folders: [] } });
    const bytes = compileDocument(doc);
    const po2s = getOuterSpriteInnerPO2s(bytes);
    // The initial PlaceObject2 for the instance
    const initial = po2s.find((t) => (t.body[0] & HAS_CHARACTER) !== 0);
    expect(initial).toBeDefined();
    expect(initial!.body[0] & HAS_CLIP_ACTIONS).toBe(0);
  });

  it("2. explicit clipActions — initial PlaceObject2 sets HasClipActions (0x80) flag", () => {
    const leaf = makeLeafSymbol("leaf-1", "LeafClip");
    const clipActions: ClipAction[] = [{ event: "load", script: "trace('hello');" }];
    const outer = makeOuterSymbol("outer-1", "OuterClip", "leaf-1", { clipActions });
    const doc = makeDoc({ library: { items: [leaf, outer], folders: [] } });
    const bytes = compileDocument(doc);
    const po2s = getOuterSpriteInnerPO2s(bytes);
    const initial = po2s.find((t) => (t.body[0] & HAS_CHARACTER) !== 0);
    expect(initial).toBeDefined();
    expect(initial!.body[0] & HAS_CLIP_ACTIONS).toBe(HAS_CLIP_ACTIONS);
  });

  it("3. loopMode='play-once' — synthesizes enterFrame clip action → HasClipActions flag", () => {
    const leaf = makeLeafSymbol("leaf-1", "LeafClip", "graphic");
    const outer = makeOuterSymbol("outer-1", "OuterClip", "leaf-1", { loopMode: "play-once" });
    const doc = makeDoc({ library: { items: [leaf, outer], folders: [] } });
    const bytes = compileDocument(doc);
    const po2s = getOuterSpriteInnerPO2s(bytes);
    const initial = po2s.find((t) => (t.body[0] & HAS_CHARACTER) !== 0);
    expect(initial).toBeDefined();
    expect(initial!.body[0] & HAS_CLIP_ACTIONS).toBe(HAS_CLIP_ACTIONS);
  });

  it("4. loopMode='single-frame' — synthesizes load clip action → HasClipActions flag", () => {
    const leaf = makeLeafSymbol("leaf-1", "LeafClip", "graphic");
    const outer = makeOuterSymbol("outer-1", "OuterClip", "leaf-1", { loopMode: "single-frame", firstFrame: 2 });
    const doc = makeDoc({ library: { items: [leaf, outer], folders: [] } });
    const bytes = compileDocument(doc);
    const po2s = getOuterSpriteInnerPO2s(bytes);
    const initial = po2s.find((t) => (t.body[0] & HAS_CHARACTER) !== 0);
    expect(initial).toBeDefined();
    expect(initial!.body[0] & HAS_CLIP_ACTIONS).toBe(HAS_CLIP_ACTIONS);
  });

  it("5. firstFrame>0 with loopMode='loop' — synthesizes load seek clip action → HasClipActions", () => {
    const leaf = makeLeafSymbol("leaf-1", "LeafClip", "graphic");
    const outer = makeOuterSymbol("outer-1", "OuterClip", "leaf-1", { loopMode: "loop", firstFrame: 3 });
    const doc = makeDoc({ library: { items: [leaf, outer], folders: [] } });
    const bytes = compileDocument(doc);
    const po2s = getOuterSpriteInnerPO2s(bytes);
    const initial = po2s.find((t) => (t.body[0] & HAS_CHARACTER) !== 0);
    expect(initial).toBeDefined();
    expect(initial!.body[0] & HAS_CLIP_ACTIONS).toBe(HAS_CLIP_ACTIONS);
  });

  it("6. loopMode='loop', firstFrame=0 — no clip actions synthesized, no HasClipActions", () => {
    const leaf = makeLeafSymbol("leaf-1", "LeafClip");
    const outer = makeOuterSymbol("outer-1", "OuterClip", "leaf-1", { loopMode: "loop", firstFrame: 0 });
    const doc = makeDoc({ library: { items: [leaf, outer], folders: [] } });
    const bytes = compileDocument(doc);
    const po2s = getOuterSpriteInnerPO2s(bytes);
    const initial = po2s.find((t) => (t.body[0] & HAS_CHARACTER) !== 0);
    expect(initial).toBeDefined();
    expect(initial!.body[0] & HAS_CLIP_ACTIONS).toBe(0);
  });

  it("7. SWF compiles without error for all loopMode variants", () => {
    const leaf = makeLeafSymbol("leaf-1", "LeafClip");
    for (const loopMode of ["loop", "play-once", "single-frame"] as const) {
      const outer = makeOuterSymbol("outer-1", "OuterClip", "leaf-1", { loopMode });
      const doc = makeDoc({ library: { items: [leaf, outer], folders: [] } });
      expect(() => compileDocument(doc)).not.toThrow();
    }
  });
});
