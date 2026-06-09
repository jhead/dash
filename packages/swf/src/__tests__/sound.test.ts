/**
 * Integration tests for SWF sound export.
 *
 * These tests call compileDocument() and parse the resulting SWF binary to
 * verify that DefineSound (tag 14) and StartSound (tag 15) tags are emitted
 * correctly based on the document's library and frame sound linkages.
 *
 * SWF tag record header format:
 *   short: UI16LE — high 10 bits = tagCode, low 6 bits = bodyLength (if < 63)
 *   long:  UI16LE (low 6 bits = 0x3F) followed by UI32LE bodyLength
 *
 * DefineSound body:
 *   [0..1]  soundId UI16LE
 *   [2]     SoundFlags: (format<<4)|(rate<<2)|(size<<1)|channels
 *   [3..6]  SoundSampleCount UI32LE
 *   [7..8]  SeekSamples SI16LE — only for MP3 (format=2 per SWF spec)
 *   [...]   audio bytes
 *
 * StartSound body:
 *   [0..1]  soundId UI16LE
 *   [2]     SoundInfo flags
 *   [3..4]  LoopCount UI16LE — only when HasLoops bit (bit 2) is set
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, SoundItem, SoundLinkage } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser helpers
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  offset: number; // byte offset of the start of the record in the SWF
}

/**
 * Parse the tag stream from a compiled SWF binary.
 * The SWF header is variable-length due to the RECT encoding;
 * we locate the end of the header by scanning for RECT then the fixed fields.
 */
function parseTags(swf: Uint8Array): SwfTag[] {
  // SWF header:
  //   3 bytes signature ("FWS" or "CWS")
  //   1 byte version
  //   4 bytes file length UI32LE
  //   RECT (variable, bit-packed, starts at offset 8)
  //   2 bytes FrameRate UI16LE
  //   2 bytes FrameCount UI16LE
  // RECT encoding: first 5 bits = Nbits, then 4*Nbits bits for Xmin/Xmax/Ymin/Ymax
  // Total RECT bytes = ceil((5 + 4*Nbits) / 8)

  const nBits = (swf[8] >> 3) & 0x1f; // high 5 bits of first byte
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);

  // Header size = 8 (signature+version+fileLen) + rectBytes + 4 (frameRate+frameCount)
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
  while (pos < swf.length) {
    const recordHeader = swf[pos] | (swf[pos + 1] << 8);
    const tagCode = (recordHeader >> 6) & 0x3ff;
    let bodyLength = recordHeader & 0x3f;
    let headerSize = 2;
    if (bodyLength === 0x3f) {
      // long record: next 4 bytes are body length
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
      offset: pos,
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break; // End tag
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Document factory helpers
// ---------------------------------------------------------------------------

const TAG_DEFINE_SOUND = 14;
const TAG_START_SOUND = 15;

function makeSoundItem(
  id: string,
  compressionType: "mp3" | "raw" | "adpcm" = "mp3"
): SoundItem {
  // Minimal base64-encoded empty audio data
  return {
    id,
    name: `${id}.${compressionType}`,
    itemType: "sound",
    dataUri: `data:audio/${compressionType};base64,`,
    compressionType,
    sampleRate: 44100,
    sampleSize: 16,
    isStereo: false,
    durationSeconds: 1,
  };
}

function makeSoundLinkage(
  libraryItemId: string,
  syncMode: SoundLinkage["syncMode"] = "event",
  repeatCount = 1
): SoundLinkage {
  return { libraryItemId, syncMode, repeatCount };
}

/** Build a minimal FlashDocument with the given library items and optional frame sound. */
function makeDoc(
  soundItems: SoundItem[],
  frameSounds: Array<{ frameIdx: number; sound: SoundLinkage }> = []
): FlashDocument {
  // Build frames: ensure a keyframe exists for each frame that has a sound
  const maxFrame = frameSounds.reduce(
    (m, fs) => Math.max(m, fs.frameIdx),
    0
  );

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

  // Ensure at least one keyframe if frameSounds is empty
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
    library: {
      items: soundItems,
      folders: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: DefineSound emitted per SoundItem
// ---------------------------------------------------------------------------

describe("SWF sound export — DefineSound (tag 14)", () => {
  it("emits one DefineSound tag for a single SoundItem in the library", () => {
    const doc = makeDoc([makeSoundItem("snd-1")]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const soundTags = tags.filter((t) => t.code === TAG_DEFINE_SOUND);
    expect(soundTags.length).toBe(1);
  });

  it("emits two DefineSound tags for two SoundItems in the library", () => {
    const doc = makeDoc([makeSoundItem("snd-1"), makeSoundItem("snd-2", "raw")]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const soundTags = tags.filter((t) => t.code === TAG_DEFINE_SOUND);
    expect(soundTags.length).toBe(2);
  });

  it("emits no DefineSound tags when library has no sounds", () => {
    const doc = makeDoc([]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const soundTags = tags.filter((t) => t.code === TAG_DEFINE_SOUND);
    expect(soundTags.length).toBe(0);
  });

  it("DefineSound body starts with a valid UI16LE soundId (> 0)", () => {
    const doc = makeDoc([makeSoundItem("snd-1")]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const st = tags.find((t) => t.code === TAG_DEFINE_SOUND)!;
    const soundId = st.body[0] | (st.body[1] << 8);
    expect(soundId).toBeGreaterThan(0);
  });

  it("DefineSound for MP3 item has format bits=2 in SoundFlags high nibble", () => {
    const doc = makeDoc([makeSoundItem("snd-1", "mp3")]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const st = tags.find((t) => t.code === TAG_DEFINE_SOUND)!;
    const flags = st.body[2];
    const format = (flags >> 4) & 0xf;
    expect(format).toBe(2); // 2 = MP3 per SWF spec
  });
});

// ---------------------------------------------------------------------------
// Tests: StartSound emitted per frame with sound linkage
// ---------------------------------------------------------------------------

describe("SWF sound export — StartSound (tag 15)", () => {
  it("emits StartSound when a keyframe has a non-null sound linkage", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTags = tags.filter((t) => t.code === TAG_START_SOUND);
    expect(startTags.length).toBe(1);
  });

  it("emits no StartSound when no frame has a sound linkage", () => {
    const doc = makeDoc([makeSoundItem("snd-1")], []);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTags = tags.filter((t) => t.code === TAG_START_SOUND);
    expect(startTags.length).toBe(0);
  });

  it("StartSound references the correct soundId for the linked SoundItem", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const defineSoundTag = tags.find((t) => t.code === TAG_DEFINE_SOUND)!;
    const startSoundTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const definedSoundId = defineSoundTag.body[0] | (defineSoundTag.body[1] << 8);
    const startSoundId = startSoundTag.body[0] | (startSoundTag.body[1] << 8);
    expect(startSoundId).toBe(definedSoundId);
  });

  it("SyncStop flag (bit 5 of SoundInfo) is set when syncMode is 'stop'", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "stop") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const infoFlags = startTag.body[2];
    expect((infoFlags >> 5) & 1).toBe(1); // SyncStop
  });

  it("SyncNoMultiple flag (bit 4 of SoundInfo) is set when syncMode is 'start'", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "start") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const infoFlags = startTag.body[2];
    expect((infoFlags >> 4) & 1).toBe(1); // SyncNoMultiple
  });

  it("HasLoops flag (bit 2) is set and LoopCount written when repeatCount > 1", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "event", 3) }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const infoFlags = startTag.body[2];
    expect((infoFlags >> 2) & 1).toBe(1); // HasLoops
    const loopCount = startTag.body[3] | (startTag.body[4] << 8);
    expect(loopCount).toBe(3);
  });

  it("repeatCount=0 (infinite) maps to LoopCount 0 in StartSound (SWF SoundInfo spec: 0 = loop forever)", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "event", 0) }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const loopCount = startTag.body[3] | (startTag.body[4] << 8);
    expect(loopCount).toBe(0);
  });

  it("StartSound appears before ShowFrame (tag 1) in the same frame", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startIdx = tags.findIndex((t) => t.code === TAG_START_SOUND);
    const showIdx = tags.findIndex((t) => t.code === 1 /* ShowFrame */);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(showIdx).toBeGreaterThan(startIdx);
  });
});
