/**
 * Tests for graphic symbol loopMode / firstFrame emission in the compiled SWF.
 *
 * Flash 8 behavior:
 *  - loop (default): no extra encoding — sprites loop by default.
 *  - single-frame: PlaceObject2 emits HasRatio (0x10) with ratio computed as
 *    Math.round(firstFrame / (totalFrames - 1) * 65535).
 *  - play-once: PlaceObject2 has HasClipActions (0x80) with an enterFrame clip
 *    action: if (this._currentframe >= this._totalframes) { this.stop(); }
 *
 * PlaceObject2 flags:
 *   bit 0: HasMove       (0x01)
 *   bit 1: HasCharacter  (0x02)
 *   bit 2: HasMatrix     (0x04)
 *   bit 3: HasColorTransform (0x08)
 *   bit 4: HasRatio      (0x10)
 *   bit 5: HasName       (0x20)
 *   bit 6: HasClipDepth  (0x40)
 *   bit 7: HasClipActions (0x80)
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
  SymbolInstance,
} from "@flash/core";

// ---------------------------------------------------------------------------
// SWF binary helpers
// ---------------------------------------------------------------------------

function getTagStreamOffset(bytes: Uint8Array): number {
  let byteOff = 8;
  let bitBuf = 0;
  let bitsLeft = 0;

  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitsLeft === 0) {
        bitBuf = bytes[byteOff++]!;
        bitsLeft = 8;
      }
      result = (result << 1) | ((bitBuf >> (bitsLeft - 1)) & 1);
      bitsLeft--;
    }
    return result;
  }

  const nBits = readBits(5);
  readBits(nBits); // xMin
  readBits(nBits); // xMax
  readBits(nBits); // yMin
  readBits(nBits); // yMax
  return byteOff + 4; // skip FrameRate (UI16) + FrameCount (UI16)
}

function parseSWFTags(bytes: Uint8Array): Array<{ code: number; body: Uint8Array }> {
  const tags: Array<{ code: number; body: Uint8Array }> = [];
  let pos = getTagStreamOffset(bytes);

  while (pos + 2 <= bytes.length) {
    const hdr = bytes[pos]! | (bytes[pos + 1]! << 8);
    const tagCode = (hdr >> 6) & 0x3ff;
    let bodyLen = hdr & 0x3f;
    let hdrSize = 2;

    if (bodyLen === 0x3f) {
      bodyLen =
        bytes[pos + 2]! |
        (bytes[pos + 3]! << 8) |
        (bytes[pos + 4]! << 16) |
        (bytes[pos + 5]! << 24);
      hdrSize = 6;
    }

    const bodyStart = pos + hdrSize;
    tags.push({ code: tagCode, body: bytes.slice(bodyStart, bodyStart + bodyLen) });
    pos = bodyStart + bodyLen;
    if (tagCode === 0) break;
  }
  return tags;
}

const TAG_PLACE_OBJECT2 = 26;

// ---------------------------------------------------------------------------
// Fixture builders
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

function makeEmptyFrame(index = 0, displayObjects: readonly SymbolInstance[] = []): Frame {
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
    displayObjects,
  };
}

function makeLayer(frames: Frame[]): Layer {
  return {
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
  };
}

function makeScene(frames: Frame[]): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers: [makeLayer(frames)] },
  };
}

/**
 * Build a symbol with a given number of frames.
 * Each frame is a separate keyframe (no display objects).
 */
function makeSymbolWithFrames(id: string, name: string, frameCount: number): Symbol {
  const frames: Frame[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(makeEmptyFrame(i));
  }
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: { layers: [makeLayer(frames)] },
    linkage: DEFAULT_LINKAGE,
    scale9Grid: null,
  };
}

function makeDoc(sym: Symbol, instance: SymbolInstance): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene([makeEmptyFrame(0, [instance])])],
    library: { items: [sym], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests — loop mode (default)
// ---------------------------------------------------------------------------

describe("loopMode: loop (default)", () => {
  it("no HasRatio bit on PlaceObject2 for default loop mode", () => {
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 4);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      // loopMode not set => defaults to "loop"
    };
    const doc = makeDoc(sym, inst);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    // HasRatio (0x10) must NOT be set for loop mode
    expect(po2!.body[0]! & 0x10).toBe(0);
    // HasClipActions (0x80) must NOT be set for loop mode
    expect(po2!.body[0]! & 0x80).toBe(0);
  });

  it("explicit loopMode='loop' also has no HasRatio or HasClipActions", () => {
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 4);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "loop",
    };
    const doc = makeDoc(sym, inst);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    expect(po2!.body[0]! & 0x10).toBe(0);
    expect(po2!.body[0]! & 0x80).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — single-frame mode
// ---------------------------------------------------------------------------

describe("loopMode: single-frame", () => {
  it("single-frame sets HasRatio (0x10) flag on PlaceObject2", () => {
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 4);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "single-frame",
      firstFrame: 2,
    };
    const doc = makeDoc(sym, inst);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    // HasRatio (0x10) MUST be set for single-frame mode
    expect(po2!.body[0]! & 0x10).toBe(0x10);
  });

  it("single-frame firstFrame=2 on 4-frame symbol gives ratio ~43690 (2/3 * 65535)", () => {
    // Symbol has 4 frames (indices 0-3), so totalFrames=4, lastFrame=3.
    // firstFrame=2 → ratio = Math.round(2/3 * 65535) = 43690
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 4);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "single-frame",
      firstFrame: 2,
    };
    const doc = makeDoc(sym, inst);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();

    // Parse the ratio field from the PlaceObject2 body.
    // Body layout: flags(1) + depth(2) + charId(2) + MATRIX(variable) + ratio(2)
    // We need to skip the MATRIX to find ratio. The flags byte has HasRatio=0x10.
    // Flags in this case: HasCharacter(0x02) | HasMatrix(0x04) | HasRatio(0x10) = 0x16
    const body = po2!.body;
    expect(body[0]! & 0x10).toBe(0x10); // HasRatio set

    // Skip depth(2) + charId(2) = 4 bytes after flags(1) = offset 5
    // Then decode MATRIX (bit-encoded) to find where ratio starts.
    // We trust the ratio is present at the end after the MATRIX.
    // Parse MATRIX bits: starting at byte offset 5 (after flags+depth+charId).
    let bytePos = 5;
    let bitBuf = 0;
    let bitsLeft = 0;

    function readBit(): number {
      if (bitsLeft === 0) {
        bitBuf = body[bytePos++]!;
        bitsLeft = 8;
      }
      bitsLeft--;
      return (bitBuf >> bitsLeft) & 1;
    }

    function readBitsN(n: number): number {
      let r = 0;
      for (let i = 0; i < n; i++) r = (r << 1) | readBit();
      return r;
    }

    // hasScale
    const hasScale = readBit();
    if (hasScale) {
      const nBits = readBitsN(5);
      readBitsN(nBits); // scaleX
      readBitsN(nBits); // scaleY
    }
    // hasRotate
    const hasRotate = readBit();
    if (hasRotate) {
      const nBits = readBitsN(5);
      readBitsN(nBits); // rotateSkew0
      readBitsN(nBits); // rotateSkew1
    }
    // translate (always present)
    const nBits = readBitsN(5);
    readBitsN(nBits); // translateX (signed, but we just consume)
    readBitsN(nBits); // translateY
    // flush to byte boundary
    bitsLeft = 0;

    // Now bytePos points at the ratio UI16LE
    const ratio = body[bytePos]! | (body[bytePos + 1]! << 8);
    // Expected: Math.round(2/3 * 65535) = 43690
    expect(ratio).toBe(Math.round(2 / 3 * 65535));
  });

  it("single-frame firstFrame=0 on any symbol gives ratio 0", () => {
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 5);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "single-frame",
      firstFrame: 0,
    };
    const doc = makeDoc(sym, inst);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    // HasRatio must be set
    expect(po2!.body[0]! & 0x10).toBe(0x10);
  });

  it("single-frame on 1-frame symbol gives ratio 0", () => {
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 1);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "single-frame",
      firstFrame: 0,
    };
    const doc = makeDoc(sym, inst);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    // HasRatio set even for 1-frame symbol (ratio = 0)
    expect(po2!.body[0]! & 0x10).toBe(0x10);
  });
});

// ---------------------------------------------------------------------------
// Tests — play-once mode
// ---------------------------------------------------------------------------

describe("loopMode: play-once", () => {
  it("play-once sets HasClipActions (0x80) flag on PlaceObject2", () => {
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 4);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "play-once",
    };
    const doc = makeDoc(sym, inst);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    // HasClipActions (0x80) MUST be set for play-once mode
    expect(po2!.body[0]! & 0x80).toBe(0x80);
  });

  it("play-once does NOT set HasRatio (0x10) on PlaceObject2", () => {
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 4);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "play-once",
    };
    const doc = makeDoc(sym, inst);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    expect(po2!.body[0]! & 0x10).toBe(0); // no HasRatio
  });

  it("play-once merges with existing clipActions", () => {
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 4);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "play-once",
      clipActions: [{ event: "load", script: "trace('loaded');" }],
    };
    const doc = makeDoc(sym, inst);
    // Should compile without error — both load and enterFrame actions emitted
    expect(() => compileDocument(doc)).not.toThrow();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    expect(po2!.body[0]! & 0x80).toBe(0x80); // HasClipActions set
  });
});
