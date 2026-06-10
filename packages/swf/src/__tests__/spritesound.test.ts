/**
 * Tests for SWF sprite sound encoding.
 *
 * Verifies that symbols (DefineSprite / tag 39) and root timeline interact
 * correctly with sound items and frame sound linkages in the library. These
 * tests focus on compile-time correctness: no crashes, correct absence of
 * sound tags when not expected, and no cross-contamination between root and
 * symbol sound handling.
 *
 * SWF tag codes:
 *   0  End
 *   1  ShowFrame
 *  14  DefineSound
 *  15  StartSound
 *  39  DefineSprite
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
  SoundItem,
  SoundLinkage,
} from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser
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
  let pos = findTagsOffset(bytes);
  const tags: SWFTag[] = [];
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

// ---------------------------------------------------------------------------
// Tag code constants
// ---------------------------------------------------------------------------

const TAG_DEFINE_SOUND  = 14;
const TAG_START_SOUND   = 15;
const TAG_DEFINE_SPRITE = 39;

// ---------------------------------------------------------------------------
// Document / fixture helpers
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
    isEmpty: true,
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
    displayObjects: [],
    ...overrides,
  };
}

function makeLayer(name: string, frames: Partial<Frame>[] = [{}]): Layer {
  const fullFrames = frames.map((f, i) => makeFrame({ index: i, ...f }));
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
    frames: fullFrames,
    frameCount: fullFrames.length,
  };
}

function makeScene(id: string, name: string, layers: Layer[]): Scene {
  return { id, name, timeline: { layers } };
}

function makeSymbol(
  id: string,
  name: string,
  layers: Layer[] = [makeLayer("Layer 1")]
): Symbol {
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: { layers },
    linkage: DEFAULT_LINKAGE,
    scale9Grid: null,
  };
}

function makeSoundItem(id: string): SoundItem {
  return {
    id,
    name: `${id}.mp3`,
    itemType: "sound",
    dataUri: `data:audio/mp3;base64,`,
    compressionType: "mp3",
    sampleRate: 44100,
    sampleSize: 16,
    isStereo: false,
    durationSeconds: 1,
  };
}

function makeSoundLinkage(libraryItemId: string): SoundLinkage {
  return { libraryItemId, syncMode: "event", repeatCount: 1 };
}

function makeDoc(overrides: Partial<FlashDocument> = {}): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [
      makeScene("scene-1", "Scene 1", [makeLayer("Layer 1")]),
    ],
    library: { items: [], folders: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Symbol with no frame sound — compiles without error
// ---------------------------------------------------------------------------

describe("symbol with no frame sound", () => {
  it("1. symbol with no frame sound — SWF compiles without error", () => {
    const sym = makeSymbol("sym-1", "MyClip");
    const doc = makeDoc({ library: { items: [sym], folders: [] } });
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("1b. DefineSprite tag is emitted for the symbol", () => {
    const sym = makeSymbol("sym-1", "MyClip");
    const doc = makeDoc({ library: { items: [sym], folders: [] } });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    expect(tags.some((t) => t.code === TAG_DEFINE_SPRITE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Root timeline with no sound — no tag 14 or tag 15 at root level
// ---------------------------------------------------------------------------

describe("root timeline with no sound", () => {
  it("2. root timeline with no sound — no DefineSound (14) at root level", () => {
    const doc = makeDoc();
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    expect(tags.some((t) => t.code === TAG_DEFINE_SOUND)).toBe(false);
  });

  it("2b. root timeline with no sound — no StartSound (15) at root level", () => {
    const doc = makeDoc();
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    expect(tags.some((t) => t.code === TAG_START_SOUND)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Symbol with frame sound in library — compiles without error
// ---------------------------------------------------------------------------

describe("symbol library item with frame sound linkage", () => {
  it("3. symbol whose frame has a sound linkage — compiles without error", () => {
    const snd = makeSoundItem("snd-1");
    // Build a symbol whose first frame has a sound reference
    const symLayer = makeLayer("Layer 1", [
      { sound: makeSoundLinkage("snd-1") },
    ]);
    const sym = makeSymbol("sym-1", "ClipWithSound", [symLayer]);
    const doc = makeDoc({ library: { items: [sym, snd], folders: [] } });
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("3b. DefineSound is emitted when sound item exists in library", () => {
    const snd = makeSoundItem("snd-1");
    const symLayer = makeLayer("Layer 1", [
      { sound: makeSoundLinkage("snd-1") },
    ]);
    const sym = makeSymbol("sym-1", "ClipWithSound", [symLayer]);
    const doc = makeDoc({ library: { items: [sym, snd], folders: [] } });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    // DefineSound (14) should be emitted for the sound item
    expect(tags.some((t) => t.code === TAG_DEFINE_SOUND)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. SoundItem in library but not used — compiles without error
// ---------------------------------------------------------------------------

describe("SoundItem in library but not referenced", () => {
  it("4. SoundItem in library but not used on any frame — compiles without error", () => {
    const snd = makeSoundItem("snd-unused");
    const doc = makeDoc({ library: { items: [snd], folders: [] } });
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("4b. Unused SoundItem still produces a DefineSound tag (character is defined)", () => {
    const snd = makeSoundItem("snd-unused");
    const doc = makeDoc({ library: { items: [snd], folders: [] } });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    // The sound is defined in the library — DefineSound is emitted even if unused
    expect(tags.some((t) => t.code === TAG_DEFINE_SOUND)).toBe(true);
  });

  it("4c. Unused SoundItem does not produce a StartSound tag", () => {
    const snd = makeSoundItem("snd-unused");
    const doc = makeDoc({ library: { items: [snd], folders: [] } });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    expect(tags.some((t) => t.code === TAG_START_SOUND)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Root and symbol sounds don't interfere — both compile together
// ---------------------------------------------------------------------------

describe("root and symbol sounds coexist", () => {
  it("5. root frame sound + symbol with sound — both compile without error", () => {
    const sndRoot = makeSoundItem("snd-root");
    const sndSym  = makeSoundItem("snd-sym");
    // Root frame with sound
    const rootLayer = makeLayer("Layer 1", [
      { sound: makeSoundLinkage("snd-root") },
    ]);
    // Symbol with sound in its frame
    const symLayer = makeLayer("Layer 1", [
      { sound: makeSoundLinkage("snd-sym") },
    ]);
    const sym = makeSymbol("sym-1", "ClipWithSound", [symLayer]);
    const doc = makeDoc({
      scenes: [makeScene("s1", "Scene 1", [rootLayer])],
      library: { items: [sym, sndRoot, sndSym], folders: [] },
    });
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("5b. root and symbol together — two DefineSound tags (one per sound item)", () => {
    const sndRoot = makeSoundItem("snd-root");
    const sndSym  = makeSoundItem("snd-sym");
    const rootLayer = makeLayer("Layer 1", [
      { sound: makeSoundLinkage("snd-root") },
    ]);
    const symLayer = makeLayer("Layer 1", [
      { sound: makeSoundLinkage("snd-sym") },
    ]);
    const sym = makeSymbol("sym-1", "ClipWithSound", [symLayer]);
    const doc = makeDoc({
      scenes: [makeScene("s1", "Scene 1", [rootLayer])],
      library: { items: [sym, sndRoot, sndSym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    const soundTags = tags.filter((t) => t.code === TAG_DEFINE_SOUND);
    expect(soundTags.length).toBe(2);
  });

  it("5c. root StartSound is emitted at root level for root frame sound", () => {
    const sndRoot = makeSoundItem("snd-root");
    const rootLayer = makeLayer("Layer 1", [
      { sound: makeSoundLinkage("snd-root") },
    ]);
    const doc = makeDoc({
      scenes: [makeScene("s1", "Scene 1", [rootLayer])],
      library: { items: [sndRoot], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    expect(tags.some((t) => t.code === TAG_START_SOUND)).toBe(true);
  });
});
