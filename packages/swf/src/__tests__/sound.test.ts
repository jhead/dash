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
import type { FlashDocument, SoundEffect, SoundItem, SoundLinkage } from "@flash/core";
import { effectToEnvelope, encodeSoundInfo } from "../sounds.js";

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
  repeatCount = 1,
  effect?: SoundEffect
): SoundLinkage {
  return { libraryItemId, syncMode, repeatCount, effect };
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

  it("repeatCount=0 (infinite) maps to LoopCount 0xFFFF in StartSound (Ruffle infinite)", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "event", 0) }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const loopCount = startTag.body[3] | (startTag.body[4] << 8);
    expect(loopCount).toBe(0xFFFF);
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

// ---------------------------------------------------------------------------
// Tests: effectToEnvelope — preset expansion
// ---------------------------------------------------------------------------

describe("effectToEnvelope — preset expansion", () => {
  it("returns null for 'none'", () => {
    expect(effectToEnvelope("none")).toBeNull();
  });

  it("fadeIn: starts silent, ends at full volume on both channels", () => {
    const pts = effectToEnvelope("fadeIn")!;
    expect(pts.length).toBe(2);
    expect(pts[0]).toMatchObject({ pos44: 0, leftLevel: 0, rightLevel: 0 });
    expect(pts[1]).toMatchObject({ pos44: 44100, leftLevel: 32768, rightLevel: 32768 });
  });

  it("fadeOut: starts at full volume, ends silent", () => {
    const pts = effectToEnvelope("fadeOut")!;
    expect(pts.length).toBe(2);
    expect(pts[0]).toMatchObject({ pos44: 0, leftLevel: 32768, rightLevel: 32768 });
    expect(pts[1]).toMatchObject({ pos44: 44100, leftLevel: 0, rightLevel: 0 });
  });

  it("left: left channel at full, right at 0", () => {
    const pts = effectToEnvelope("left")!;
    expect(pts.length).toBe(2);
    for (const pt of pts) {
      expect(pt.leftLevel).toBe(32768);
      expect(pt.rightLevel).toBe(0);
    }
  });

  it("right: right channel at full, left at 0", () => {
    const pts = effectToEnvelope("right")!;
    expect(pts.length).toBe(2);
    for (const pt of pts) {
      expect(pt.leftLevel).toBe(0);
      expect(pt.rightLevel).toBe(32768);
    }
  });

  it("fadeLeftToRight: pans from left to right", () => {
    const pts = effectToEnvelope("fadeLeftToRight")!;
    expect(pts[0]).toMatchObject({ leftLevel: 32768, rightLevel: 0 });
    expect(pts[1]).toMatchObject({ leftLevel: 0, rightLevel: 32768 });
  });

  it("fadeRightToLeft: pans from right to left", () => {
    const pts = effectToEnvelope("fadeRightToLeft")!;
    expect(pts[0]).toMatchObject({ leftLevel: 0, rightLevel: 32768 });
    expect(pts[1]).toMatchObject({ leftLevel: 32768, rightLevel: 0 });
  });
});

// ---------------------------------------------------------------------------
// Tests: encodeSoundInfo — envelope encoding
// ---------------------------------------------------------------------------

describe("encodeSoundInfo — envelope encoding", () => {
  it("hasEnvelope bit (bit 3) is 0 when effect is 'none'", () => {
    const bytes = encodeSoundInfo({ effect: "none" });
    expect((bytes[0] >> 3) & 1).toBe(0);
  });

  it("hasEnvelope bit (bit 3) is 0 when no effect set", () => {
    const bytes = encodeSoundInfo({});
    expect((bytes[0] >> 3) & 1).toBe(0);
  });

  it("hasEnvelope bit (bit 3) is 1 when effect is 'fadeIn'", () => {
    const bytes = encodeSoundInfo({ effect: "fadeIn" });
    expect((bytes[0] >> 3) & 1).toBe(1);
  });

  it("fadeIn encodes EnvelopeCount=2 followed by two 8-byte envelope points", () => {
    const bytes = encodeSoundInfo({ effect: "fadeIn" });
    // flags (1 byte) + EnvelopeCount (1 byte) + 2×(UI32+UI16+UI16)=2×8=16 bytes
    expect(bytes.length).toBe(18);
    // EnvelopeCount
    expect(bytes[1]).toBe(2);
    // First point: pos44=0, leftLevel=0, rightLevel=0
    const p0pos = bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24);
    const p0l = bytes[6] | (bytes[7] << 8);
    const p0r = bytes[8] | (bytes[9] << 8);
    expect(p0pos).toBe(0);
    expect(p0l).toBe(0);
    expect(p0r).toBe(0);
    // Second point: pos44=44100, leftLevel=32768, rightLevel=32768
    const p1pos = bytes[10] | (bytes[11] << 8) | (bytes[12] << 16) | (bytes[13] << 24);
    const p1l = bytes[14] | (bytes[15] << 8);
    const p1r = bytes[16] | (bytes[17] << 8);
    expect(p1pos).toBe(44100);
    expect(p1l).toBe(32768);
    expect(p1r).toBe(32768);
  });

  it("explicit envelope points override the effect field", () => {
    const bytes = encodeSoundInfo({
      effect: "fadeIn",
      envelope: [{ pos44: 100, leftLevel: 100, rightLevel: 200 }],
    });
    // EnvelopeCount should be 1 (explicit envelope wins)
    expect(bytes[1]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: StartSound with effect — end-to-end via compileDocument
// ---------------------------------------------------------------------------

describe("SWF sound export — StartSound with envelope effect", () => {
  it("HasEnvelope flag set in StartSound SoundInfo when effect is 'fadeIn'", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "event", 1, "fadeIn") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    // SoundInfo flags is at byte index 2 of StartSound body (after 2-byte soundId)
    const infoFlags = startTag.body[2];
    expect((infoFlags >> 3) & 1).toBe(1); // hasEnvelope
  });

  it("HasEnvelope flag NOT set when effect is 'none'", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "event", 1, "none") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const infoFlags = startTag.body[2];
    expect((infoFlags >> 3) & 1).toBe(0); // no envelope
  });

  it("HasEnvelope flag NOT set when effect is undefined", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const infoFlags = startTag.body[2];
    expect((infoFlags >> 3) & 1).toBe(0);
  });

  it("'left' effect: envelope rightLevel=0 in StartSound body", () => {
    // Use repeatCount=0 (no loops) to keep SoundInfo layout simple: no LoopCount bytes
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "event", 0, "left") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    // body[0..1]=soundId, body[2]=flags, body[3]=LoopCount_lo, body[4]=LoopCount_hi
    // (repeatCount=0 still sets hasLoops, writing LoopCount=0xFFFF for infinite), body[5]=EnvelopeCount
    // body[6..9]=pos44, body[10..11]=leftLevel, body[12..13]=rightLevel
    const infoFlags = startTag.body[2];
    expect((infoFlags >> 3) & 1).toBe(1); // hasEnvelope set
    const envCount = startTag.body[5];
    expect(envCount).toBe(2);
    const rightLevel0 = startTag.body[12] | (startTag.body[13] << 8);
    expect(rightLevel0).toBe(0);
  });
});
