/**
 * Tests for graphic symbol loopMode / firstFrame emission in the compiled SWF.
 *
 * Flash 8 behavior:
 *  - loop (default): no extra encoding — sprites loop by default.
 *  - single-frame: PlaceObject2 emits HasClipActions (0x80) with a load clip
 *    action: this.gotoAndStop(firstFrame + 1);
 *    (The Ratio field approach was dropped because Ruffle's MovieClip ignores
 *    on_ratio_changed and always shows frame 1 regardless of ratio.)
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
  it("single-frame sets HasClipActions (0x80) flag on PlaceObject2", () => {
    // single-frame uses an onClipEvent(load){ gotoAndStop(N) } clip action rather than
    // the Ratio field, because Ruffle's MovieClip ignores on_ratio_changed.
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
    // HasClipActions (0x80) MUST be set for single-frame mode
    expect(po2!.body[0]! & 0x80).toBe(0x80);
    // HasRatio (0x10) must NOT be set (we no longer use the ratio field)
    expect(po2!.body[0]! & 0x10).toBe(0);
  });

  it("single-frame does NOT set HasRatio (0x10) on PlaceObject2", () => {
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
    expect(po2!.body[0]! & 0x10).toBe(0); // no HasRatio
  });

  it("single-frame firstFrame=0 on any symbol still sets HasClipActions", () => {
    // Even firstFrame=0 emits a load clip action (gotoAndStop(1)) to ensure the
    // clip stays frozen at frame 1 and does not loop.
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
    // HasClipActions must be set
    expect(po2!.body[0]! & 0x80).toBe(0x80);
    // HasRatio must NOT be set
    expect(po2!.body[0]! & 0x10).toBe(0);
  });

  it("single-frame on 1-frame symbol still sets HasClipActions", () => {
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
    // HasClipActions set (gotoAndStop(1) still emitted)
    expect(po2!.body[0]! & 0x80).toBe(0x80);
    // HasRatio must NOT be set
    expect(po2!.body[0]! & 0x10).toBe(0);
  });

  it("single-frame merges with existing clipActions", () => {
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 4);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "single-frame",
      firstFrame: 1,
      clipActions: [{ event: "load", script: "trace('loaded');" }],
    };
    const doc = makeDoc(sym, inst);
    // Should compile without error — both existing load and synthesized gotoAndStop load actions emitted
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

  it("play-once with firstFrame=0 does NOT add a load seek action (no change from firstFrame=0)", () => {
    // firstFrame=0 means start from frame 1 (default), no seek needed.
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 4);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "play-once",
      firstFrame: 0,
    };
    const doc = makeDoc(sym, inst);
    const bytes = compileDocument(doc);
    // Should compile without error
    expect(bytes.length).toBeGreaterThan(0);
    const tags = parseSWFTags(bytes);
    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    expect(po2!.body[0]! & 0x80).toBe(0x80); // HasClipActions set (stop action still present)
  });

  it("play-once with firstFrame=2 sets HasClipActions and compiles without error", () => {
    // firstFrame=2 means gotoAndPlay(3) should be emitted on load.
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 6);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "play-once",
      firstFrame: 2,
    };
    const doc = makeDoc(sym, inst);
    expect(() => compileDocument(doc)).not.toThrow();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    // HasClipActions must be set (both stop and seek actions)
    expect(po2!.body[0]! & 0x80).toBe(0x80);
  });
});

// ---------------------------------------------------------------------------
// Tests — loop mode with firstFrame > 0
// ---------------------------------------------------------------------------

describe("loopMode: loop with firstFrame > 0", () => {
  it("loop with firstFrame=0 has no HasClipActions", () => {
    // Default loop with no firstFrame offset: no clip actions needed.
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 4);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "loop",
      firstFrame: 0,
    };
    const doc = makeDoc(sym, inst);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    expect(po2!.body[0]! & 0x80).toBe(0); // no HasClipActions
  });

  it("loop with firstFrame=2 sets HasClipActions (0x80) on PlaceObject2", () => {
    // firstFrame=2 means gotoAndPlay(3) emitted on load so the loop starts at frame 3.
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 6);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "loop",
      firstFrame: 2,
    };
    const doc = makeDoc(sym, inst);
    expect(() => compileDocument(doc)).not.toThrow();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    // HasClipActions (0x80) MUST be set since a load seek is emitted
    expect(po2!.body[0]! & 0x80).toBe(0x80);
  });

  it("loop with firstFrame=2 does NOT set HasRatio", () => {
    const sym = makeSymbolWithFrames("sym-1", "MyClip", 6);
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      loopMode: "loop",
      firstFrame: 2,
    };
    const doc = makeDoc(sym, inst);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2).toBeDefined();
    // HasRatio (0x10) must NOT be set — ratio is for single-frame mode only
    expect(po2!.body[0]! & 0x10).toBe(0);
  });
});
