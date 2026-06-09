/**
 * Tests for SWF DefineSound (tag 14) and StartSound (tag 15) output.
 *
 * Verifies that compileDocument() emits the correct tags based on the
 * document's library SoundItems and frame sound linkages.
 *
 * Tag numbers:
 *   14 = DefineSound
 *   15 = StartSound
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, SoundItem, SoundLinkage } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag parser
// ---------------------------------------------------------------------------

function findTags(bytes: Uint8Array): Array<{ type: number; body: Uint8Array }> {
  const nbits = bytes[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let i = 8 + rectBytes + 4;
  const tags: Array<{ type: number; body: Uint8Array }> = [];
  while (i < bytes.length - 1) {
    const h = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
    const type = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    if (len === 63) {
      len =
        bytes[i] |
        (bytes[i + 1] << 8) |
        (bytes[i + 2] << 16) |
        (bytes[i + 3] << 24);
      i += 4;
    }
    tags.push({ type, body: bytes.slice(i, i + len) });
    if (type === 0) break;
    i += len;
  }
  return tags;
}

const TAG_DEFINE_SOUND = 14;
const TAG_START_SOUND = 15;

// ---------------------------------------------------------------------------
// Minimal document factory
// ---------------------------------------------------------------------------

function makeSoundItem(id: string): SoundItem {
  return {
    id,
    name: `${id}.mp3`,
    itemType: "sound",
    dataUri: "data:audio/mp3;base64,",
    compressionType: "mp3",
    sampleRate: 44100,
    sampleSize: 16,
    isStereo: false,
    durationSeconds: 1,
  };
}

function makeDoc(
  soundItems: SoundItem[],
  frameSounds: Array<{ frameIdx: number; sound: SoundLinkage }> = []
): FlashDocument {
  const maxFrame = frameSounds.reduce((m, fs) => Math.max(m, fs.frameIdx), 0);
  const soundMap = new Map<number, SoundLinkage>();
  for (const { frameIdx, sound } of frameSounds) {
    soundMap.set(frameIdx, sound);
  }

  const frames = [];
  for (let fi = 0; fi <= maxFrame; fi++) {
    frames.push({
      index: fi,
      isKeyframe: true,
      isEmpty: true,
      tweenType: "none" as const,
      label: "",
      labelType: "name" as const,
      script: "",
      sound: soundMap.get(fi) ?? null,
      motionEase: 0,
      motionRotate: "none" as const,
      motionRotateCount: 0,
      motionOrientToPath: false,
      motionSync: false,
      motionScale: false,
      shapeEase: 0,
      shapeBlend: "distributive" as const,
      displayObjects: [],
    });
  }

  if (frames.length === 0) {
    frames.push({
      index: 0,
      isKeyframe: true,
      isEmpty: true,
      tweenType: "none" as const,
      label: "",
      labelType: "name" as const,
      script: "",
      sound: null,
      motionEase: 0,
      motionRotate: "none" as const,
      motionRotateCount: 0,
      motionOrientToPath: false,
      motionSync: false,
      motionScale: false,
      shapeEase: 0,
      shapeBlend: "distributive" as const,
      displayObjects: [],
    });
  }

  return {
    id: "doc-snd-test",
    properties: {
      width: 550,
      height: 400,
      frameRate: 12,
      backgroundColor: "#ffffff",
      rulerUnits: "px",
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
    },
    scenes: [
      {
        id: "scene-1",
        name: "Scene 1",
        timeline: {
          layers: [
            {
              id: "layer-1",
              name: "Layer 1",
              type: "normal",
              visible: true,
              locked: false,
              outlineMode: false,
              outlineColor: "#ff0000",
              height: 20,
              parentFolderId: null,
              frames,
              frameCount: frames.length,
            },
          ],
        },
      },
    ],
    library: {
      items: soundItems,
      folders: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF DefineSound (tag 14) and StartSound (tag 15)", () => {
  // -------------------------------------------------------------------------
  // Test 1: No sounds → no tag 14 and no tag 15
  // -------------------------------------------------------------------------

  it("1. SWF with no sounds has no DefineSound (14) and no StartSound (15) tags", () => {
    const doc = makeDoc([]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    expect(tags.filter((t) => t.type === TAG_DEFINE_SOUND).length).toBe(0);
    expect(tags.filter((t) => t.type === TAG_START_SOUND).length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: SoundItem in library → compiles without error
  // -------------------------------------------------------------------------

  it("2. SWF with a SoundItem in the library compiles without error", () => {
    const doc = makeDoc([makeSoundItem("snd1")]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Test 3: Frame with sound linkage → StartSound (tag 15) appears
  // -------------------------------------------------------------------------

  it("3. frame with sound linkage (event syncMode) produces StartSound (tag 15)", () => {
    const doc = makeDoc(
      [makeSoundItem("snd1")],
      [{ frameIdx: 0, sound: { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 } }]
    );
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const startTags = tags.filter((t) => t.type === TAG_START_SOUND);
    expect(startTags.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 4: DefineSound body starts with charId UI16 (> 0)
  // -------------------------------------------------------------------------

  it("4. DefineSound (tag 14) body starts with a nonzero UI16LE charId", () => {
    const doc = makeDoc([makeSoundItem("snd1")]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const dt = tags.find((t) => t.type === TAG_DEFINE_SOUND);
    expect(dt).toBeDefined();
    if (dt) {
      const charId = dt.body[0] | (dt.body[1] << 8);
      expect(charId).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: Multiple SoundItems → one DefineSound per item
  // -------------------------------------------------------------------------

  it("5. two SoundItems in library produce two DefineSound (tag 14) tags", () => {
    const doc = makeDoc([makeSoundItem("snd1"), makeSoundItem("snd2")]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const defineTags = tags.filter((t) => t.type === TAG_DEFINE_SOUND);
    expect(defineTags.length).toBe(2);
  });
});
