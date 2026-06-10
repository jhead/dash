/**
 * Tests for StartSound2 (tag 89) encoding and compile integration.
 *
 * Covers:
 *   - encodeStartSound2 unit test: body starts with null-terminated class name
 *   - compileDocument integration: tag 89 emitted for sound with linkageIdentifier
 *   - tag 15 (StartSound) still emitted for sounds without linkageIdentifier
 *   - ExportAssets entry included for sounds with exportForActionScript=true
 */

import { describe, it, expect } from "vitest";
import { encodeStartSound2 } from "../sounds.js";
import { compileDocument } from "../compile.js";
import type { FlashDocument, SoundItem, SoundLinkage } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag constants
// ---------------------------------------------------------------------------

const TAG_DEFINE_SOUND = 14;
const TAG_START_SOUND = 15;
const TAG_EXPORT_ASSETS = 56;
const TAG_START_SOUND2 = 89;

// ---------------------------------------------------------------------------
// SWF tag parser helpers
// ---------------------------------------------------------------------------

interface TagRecord {
  code: number;
  body: Uint8Array;
}

function parseTags(swf: Uint8Array): TagRecord[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;
  const tags: TagRecord[] = [];
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
    tags.push({ code: tagCode, body: swf.slice(bodyStart, bodyStart + bodyLength) });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Document factory helpers
// ---------------------------------------------------------------------------

function makeSoundItem(id: string, linkageIdentifier?: string, exportForActionScript?: boolean): SoundItem {
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
    ...(linkageIdentifier !== undefined ? { linkageIdentifier } : {}),
    ...(exportForActionScript !== undefined ? { exportForActionScript } : {}),
  };
}

function makeDoc(
  soundItems: SoundItem[],
  frameSounds: Array<{ frameIdx: number; sound: SoundLinkage }> = []
): FlashDocument {
  const maxFrame = frameSounds.reduce((m, fs) => Math.max(m, fs.frameIdx), 0);
  const frameMap = new Map<number, SoundLinkage>();
  for (const { frameIdx, sound } of frameSounds) {
    frameMap.set(frameIdx, sound);
  }
  const frames = [];
  for (let i = 0; i <= maxFrame; i++) {
    frames.push({
      index: i,
      isKeyframe: true,
      isEmpty: true,
      tweenType: "none" as const,
      label: "",
      labelType: "name" as const,
      script: "",
      sound: frameMap.get(i) ?? null,
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
    id: "doc-1",
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
    library: { items: soundItems, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Unit tests: encodeStartSound2
// ---------------------------------------------------------------------------

describe("encodeStartSound2 — tag 89 body", () => {
  it("body starts with null-terminated class name", () => {
    const body = encodeStartSound2("MySound");
    // "MySound" = 7 chars + null = 8 bytes, then 1 byte SoundInfo flags
    expect(body.length).toBeGreaterThanOrEqual(9);
    // Check class name bytes
    const name = "MySound";
    for (let i = 0; i < name.length; i++) {
      expect(body[i]).toBe(name.charCodeAt(i));
    }
    // Null terminator
    expect(body[name.length]).toBe(0);
  });

  it("SoundInfo flags byte follows the null-terminated class name", () => {
    const body = encodeStartSound2("Boom");
    const nameLen = "Boom".length + 1; // +1 for null terminator
    const flagsByte = body[nameLen];
    expect(flagsByte).toBe(0); // no flags set
  });

  it("HasLoops flag (bit 2) appears after class name", () => {
    const body = encodeStartSound2("Sfx", { loops: 2 });
    const nameLen = "Sfx".length + 1;
    const flags = body[nameLen];
    expect((flags >> 2) & 1).toBe(1); // HasLoops
    const loopCount = body[nameLen + 1] | (body[nameLen + 2] << 8);
    expect(loopCount).toBe(2);
  });

  it("stop flag (bit 5) propagates into SoundInfo", () => {
    const body = encodeStartSound2("Alert", { stop: true });
    const nameLen = "Alert".length + 1;
    const flags = body[nameLen];
    expect((flags >> 5) & 1).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: compileDocument → StartSound2 (tag 89)
// ---------------------------------------------------------------------------

describe("compileDocument — StartSound2 (tag 89) integration", () => {
  it("sound with linkageIdentifier produces StartSound2 (tag 89) not StartSound (tag 15)", () => {
    const snd = makeSoundItem("snd1", "MySoundClass");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 } }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startSound2Tags = tags.filter((t) => t.code === TAG_START_SOUND2);
    const startSoundTags = tags.filter((t) => t.code === TAG_START_SOUND);
    expect(startSound2Tags.length).toBeGreaterThanOrEqual(1);
    expect(startSoundTags.length).toBe(0);
  });

  it("StartSound2 body begins with the class name null-terminated", () => {
    const className = "MySoundClass";
    const snd = makeSoundItem("snd1", className);
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 } }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const tag89 = tags.find((t) => t.code === TAG_START_SOUND2)!;
    expect(tag89).toBeDefined();
    for (let i = 0; i < className.length; i++) {
      expect(tag89.body[i]).toBe(className.charCodeAt(i));
    }
    expect(tag89.body[className.length]).toBe(0);
  });

  it("sound without linkageIdentifier still produces StartSound (tag 15)", () => {
    const snd = makeSoundItem("snd1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 } }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startSoundTags = tags.filter((t) => t.code === TAG_START_SOUND);
    const startSound2Tags = tags.filter((t) => t.code === TAG_START_SOUND2);
    expect(startSoundTags.length).toBeGreaterThanOrEqual(1);
    expect(startSound2Tags.length).toBe(0);
  });

  it("DefineSound (tag 14) still appears for linked sound items", () => {
    const snd = makeSoundItem("snd1", "MySoundClass");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 } }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const defineTags = tags.filter((t) => t.code === TAG_DEFINE_SOUND);
    expect(defineTags.length).toBe(1);
  });

  it("ExportAssets (tag 56) includes entry for sound with exportForActionScript=true", () => {
    const snd = makeSoundItem("snd1", "MySoundClass", true);
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 } }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const exportTag = tags.find((t) => t.code === TAG_EXPORT_ASSETS);
    expect(exportTag).toBeDefined();
    // ExportAssets body: UI16 count, then [UI16 charId, string name, ...]
    const count = exportTag!.body[0] | (exportTag!.body[1] << 8);
    expect(count).toBeGreaterThanOrEqual(1);
    // Find the class name in the export body
    const bodyStr = String.fromCharCode(...exportTag!.body);
    expect(bodyStr).toContain("MySoundClass");
  });
});
