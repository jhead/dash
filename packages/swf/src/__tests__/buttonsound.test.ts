/**
 * Unit tests for DefineButtonSound (tag 17).
 *
 * Verifies that:
 * - encodeDefineButtonSound() encodes the tag body correctly
 * - compileDocument() emits tag 17 after tag 34 when buttonSounds is present
 * - SoundId=0 is written for states with no sound
 * - SOUNDINFO loops field is written when loops > 0
 */

import { describe, it, expect } from "vitest";
import { encodeDefineButtonSound } from "../buttons.js";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
  SoundItem,
  ButtonSounds,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readUI16LE(buf: Uint8Array, offset: number): number {
  return (buf[offset]! | (buf[offset + 1]! << 8)) >>> 0;
}

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

const BASE_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

function makeFrame(index: number, overrides: Partial<Frame> = {}): Frame {
  return {
    index,
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

function makeButtonSymbol(id: string, sounds?: ButtonSounds): Symbol {
  const frames = [0, 1, 2, 3].map((idx) => makeFrame(idx));
  return {
    id,
    name: `Button_${id}`,
    itemType: "symbol",
    symbolType: "button",
    timeline: {
      layers: [makeLayer(`${id}-layer`, frames)],
    },
    linkage: BASE_LINKAGE,
    scale9Grid: null,
    ...(sounds ? { buttonSounds: sounds } : {}),
  };
}

function makeSoundItem(id: string, name: string): SoundItem {
  return {
    id,
    name,
    itemType: "sound",
    // Minimal valid MP3 data URI (3 bytes: ID3 header stub)
    dataUri: "data:audio/mpeg;base64,AAAAAAAA",
    sampleRate: 44100,
    sampleSize: 16,
    isStereo: false,
    durationSeconds: 1,
    compressionType: "mp3",
  };
}

function makeEmptyScene(): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: {
      layers: [makeLayer("layer-1", [makeFrame(0)])],
    },
  };
}

function makeDoc(symbols: Symbol[], sounds: SoundItem[] = []): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeEmptyScene()],
    library: {
      items: [...symbols, ...sounds],
      folders: [],
    },
  };
}

// ---------------------------------------------------------------------------
// SWF parser
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  const nBits = (swf[8]! >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
  while (pos < swf.length) {
    const recordHeader = swf[pos]! | (swf[pos + 1]! << 8);
    const tagCode = (recordHeader >> 6) & 0x3ff;
    let bodyLength = recordHeader & 0x3f;
    let headerSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        swf[pos + 2]! |
        (swf[pos + 3]! << 8) |
        (swf[pos + 4]! << 16) |
        (swf[pos + 5]! << 24);
      headerSize = 6;
    }
    const bodyStart = pos + headerSize;
    tags.push({
      code: tagCode,
      body: swf.slice(bodyStart, bodyStart + bodyLength),
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// encodeDefineButtonSound unit tests
// ---------------------------------------------------------------------------

describe("encodeDefineButtonSound", () => {
  it("emits ButtonId as first UI16", () => {
    const soundIdMap = new Map<string, number>([["snd1", 5]]);
    const sounds: ButtonSounds = { upToOver: { soundId: "snd1" } };
    const body = encodeDefineButtonSound(42, sounds, soundIdMap);
    expect(readUI16LE(body, 0)).toBe(42);
  });

  it("writes 4 state slots; empty states get SoundId=0", () => {
    const soundIdMap = new Map<string, number>();
    const sounds: ButtonSounds = {}; // no sounds
    const body = encodeDefineButtonSound(1, sounds, soundIdMap);
    // UI16 ButtonId + 4 × UI16 SoundId (0)
    expect(body.length).toBe(2 + 4 * 2);
    // All 4 state SoundIds = 0
    expect(readUI16LE(body, 2)).toBe(0); // overToUp
    expect(readUI16LE(body, 4)).toBe(0); // upToOver
    expect(readUI16LE(body, 6)).toBe(0); // overToDown
    expect(readUI16LE(body, 8)).toBe(0); // downToOver
  });

  it("writes correct SoundId for upToOver state (slot 1)", () => {
    const soundIdMap = new Map<string, number>([["snd1", 7]]);
    const sounds: ButtonSounds = { upToOver: { soundId: "snd1" } };
    const body = encodeDefineButtonSound(1, sounds, soundIdMap);
    // Slot order: overToUp(0), upToOver(1), overToDown(2), downToOver(3)
    expect(readUI16LE(body, 2)).toBe(0); // overToUp = no sound
    expect(readUI16LE(body, 4)).toBe(7); // upToOver = SoundId 7
    expect(readUI16LE(body, 7)).toBe(0); // overToDown = no sound (after SOUNDINFO byte at 6)
    expect(readUI16LE(body, 9)).toBe(0); // downToOver = no sound
  });

  it("emits SOUNDINFO flags byte = 0x00 (no loops) when loops not set", () => {
    const soundIdMap = new Map<string, number>([["snd1", 3]]);
    const sounds: ButtonSounds = { upToOver: { soundId: "snd1" } };
    const body = encodeDefineButtonSound(1, sounds, soundIdMap);
    // After SoundId at offset 4: SOUNDINFO flags byte at offset 6
    expect(body[6]).toBe(0x00); // flags = 0 (no loops, no envelope)
  });

  it("emits SOUNDINFO HasLoops flag and LoopCount when loops > 0", () => {
    const soundIdMap = new Map<string, number>([["snd1", 3]]);
    const sounds: ButtonSounds = { upToOver: { soundId: "snd1", loops: 3 } };
    const body = encodeDefineButtonSound(1, sounds, soundIdMap);
    // Offset 4: SoundId=3, offset 6: flags=0x04 (HasLoops), offset 7-8: LoopCount=3
    expect(body[6]).toBe(0x04);
    expect(readUI16LE(body, 7)).toBe(3);
  });

  it("treats unknown soundId as no sound (SoundId=0)", () => {
    const soundIdMap = new Map<string, number>(); // empty map
    const sounds: ButtonSounds = { overToDown: { soundId: "missing" } };
    const body = encodeDefineButtonSound(1, sounds, soundIdMap);
    // All 4 slots should be SoundId=0
    expect(readUI16LE(body, 2)).toBe(0);
    expect(readUI16LE(body, 4)).toBe(0);
    expect(readUI16LE(body, 6)).toBe(0);
    expect(readUI16LE(body, 8)).toBe(0);
  });

  it("supports sounds on all 4 states", () => {
    const soundIdMap = new Map<string, number>([
      ["s1", 10],
      ["s2", 11],
      ["s3", 12],
      ["s4", 13],
    ]);
    const sounds: ButtonSounds = {
      overToUp: { soundId: "s1" },
      upToOver: { soundId: "s2" },
      overToDown: { soundId: "s3" },
      downToOver: { soundId: "s4" },
    };
    const body = encodeDefineButtonSound(1, sounds, soundIdMap);
    // Each state: UI16 SoundId + UI8 flags = 3 bytes
    expect(body.length).toBe(2 + 4 * 3);
    expect(readUI16LE(body, 2)).toBe(10);  // overToUp
    expect(readUI16LE(body, 5)).toBe(11);  // upToOver
    expect(readUI16LE(body, 8)).toBe(12);  // overToDown
    expect(readUI16LE(body, 11)).toBe(13); // downToOver
  });
});

// ---------------------------------------------------------------------------
// Integration: compile.ts emits DefineButtonSound (tag 17)
// ---------------------------------------------------------------------------

describe("compile — DefineButtonSound integration", () => {
  const TAG_DEFINE_BUTTON2 = 34;
  const TAG_DEFINE_BUTTON_SOUND = 17;
  const TAG_DEFINE_SOUND = 14;

  it("does NOT emit tag 17 when buttonSounds is absent", () => {
    const btn = makeButtonSymbol("btn1");
    const doc = makeDoc([btn]);
    const tags = parseTags(compileDocument(doc));
    const codes = tags.map((t) => t.code);
    expect(codes).toContain(TAG_DEFINE_BUTTON2);
    expect(codes).not.toContain(TAG_DEFINE_BUTTON_SOUND);
  });

  it("emits tag 17 when buttonSounds is present", () => {
    const snd = makeSoundItem("snd1", "click");
    const btn = makeButtonSymbol("btn1", {
      upToOver: { soundId: "snd1" },
    });
    const doc = makeDoc([btn], [snd]);
    const tags = parseTags(compileDocument(doc));
    const codes = tags.map((t) => t.code);
    expect(codes).toContain(TAG_DEFINE_BUTTON_SOUND);
  });

  it("tag 17 appears after tag 14 (DefineSound) in the SWF", () => {
    const snd = makeSoundItem("snd1", "click");
    const btn = makeButtonSymbol("btn1", {
      upToOver: { soundId: "snd1" },
    });
    const doc = makeDoc([btn], [snd]);
    const tags = parseTags(compileDocument(doc));
    const soundIdx = tags.findIndex((t) => t.code === TAG_DEFINE_SOUND);
    const btnSoundIdx = tags.findIndex((t) => t.code === TAG_DEFINE_BUTTON_SOUND);
    expect(soundIdx).toBeGreaterThanOrEqual(0);
    expect(btnSoundIdx).toBeGreaterThanOrEqual(0);
    expect(btnSoundIdx).toBeGreaterThan(soundIdx);
  });

  it("tag 17 body starts with the correct ButtonId (matches DefineButton2 ButtonId)", () => {
    const snd = makeSoundItem("snd1", "click");
    const btn = makeButtonSymbol("btn1", {
      upToOver: { soundId: "snd1" },
    });
    const doc = makeDoc([btn], [snd]);
    const tags = parseTags(compileDocument(doc));

    const btn2Tag = tags.find((t) => t.code === TAG_DEFINE_BUTTON2)!;
    const sndTag = tags.find((t) => t.code === TAG_DEFINE_BUTTON_SOUND)!;

    // Both tags should start with the same ButtonId (UI16 LE)
    const buttonId = readUI16LE(btn2Tag.body, 0);
    const soundButtonId = readUI16LE(sndTag.body, 0);
    expect(soundButtonId).toBe(buttonId);
  });
});
