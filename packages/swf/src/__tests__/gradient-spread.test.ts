/**
 * Tests for gradient spread mode and interpolation mode encoding.
 *
 * SWF GRADIENT first-byte layout (per SWF19 §2.4.2.4):
 *   bits[7:6] SpreadMode:        0=pad/extend, 1=reflect, 2=repeat, 3=reserved
 *   bits[5:4] InterpolationMode: 0=normal RGB, 1=linear RGB, 2-3=reserved
 *   bits[3:0] NumGradients (0–15)
 *
 * Verified against Ruffle read.rs `read_gradient_flags`:
 *   spread = (flags >> 6) & 0b11
 *   interpolation = (flags >> 4) & 0b11
 *   num_records = flags & 0b1111
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  LinearGradientFill,
  RadialGradientFill,
  Scene,
  Shape,
  ShapeDisplayObject,
} from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser (minimal — same as gradient-fill.test.ts)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function parseSWFTags(bytes: Uint8Array): SWFTag[] {
  let byteOff = 8;
  let bitBuf = 0;
  let bitsLeft = 0;

  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitsLeft === 0) {
        bitBuf = bytes[byteOff++];
        bitsLeft = 8;
      }
      result = (result << 1) | ((bitBuf >> (bitsLeft - 1)) & 1);
      bitsLeft--;
    }
    return result;
  }

  const nBits = readBits(5);
  readBits(nBits * 4);
  bitsLeft = 0;
  byteOff += 4;

  const tags: SWFTag[] = [];
  let pos = byteOff;
  while (pos + 2 <= bytes.length) {
    const recordHdr = bytes[pos] | (bytes[pos + 1] << 8);
    const tagCode = (recordHdr >> 6) & 0x3ff;
    let bodyLength = recordHdr & 0x3f;
    let hdrSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        bytes[pos + 2] |
        (bytes[pos + 3] << 8) |
        (bytes[pos + 4] << 16) |
        (bytes[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({
      code: tagCode,
      body: bytes.slice(bodyStart, bodyStart + bodyLength),
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// MATRIX skip helper (bit-packed SWF MATRIX)
// ---------------------------------------------------------------------------

/**
 * A minimal bit reader over a Uint8Array that reads MSB-first.
 */
class BitReader {
  private buf: Uint8Array;
  private byteOff: number;
  private bitBuf = 0;
  private bitsLeft = 0;

  constructor(buf: Uint8Array, startByte = 0) {
    this.buf = buf;
    this.byteOff = startByte;
  }

  get byteOffset(): number {
    return this.byteOff;
  }

  readBit(): number {
    if (this.bitsLeft === 0) {
      if (this.byteOff >= this.buf.length) return 0;
      this.bitBuf = this.buf[this.byteOff++];
      this.bitsLeft = 8;
    }
    const bit = (this.bitBuf >> (this.bitsLeft - 1)) & 1;
    this.bitsLeft--;
    return bit;
  }

  readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) result = (result << 1) | this.readBit();
    return result;
  }

  readSBits(n: number): number {
    const raw = this.readBits(n);
    if (n === 0) return 0;
    const sign = 1 << (n - 1);
    return (raw & (sign - 1)) - (raw & sign);
  }

  flushByte(): void {
    this.bitsLeft = 0;
  }

  readUI8(): number {
    this.flushByte();
    if (this.byteOff >= this.buf.length) return 0;
    return this.buf[this.byteOff++];
  }

  skipBytes(n: number): void {
    this.flushByte();
    this.byteOff += n;
  }

  skipRect(): void {
    const nBits = this.readBits(5);
    this.readBits(nBits * 4);
    this.flushByte();
  }

  skipMatrix(): void {
    const hasScale = this.readBit();
    if (hasScale) {
      const n = this.readBits(5);
      this.readSBits(n);
      this.readSBits(n);
    }
    const hasRotate = this.readBit();
    if (hasRotate) {
      const n = this.readBits(5);
      this.readSBits(n);
      this.readSBits(n);
    }
    const nTrans = this.readBits(5);
    this.readSBits(nTrans);
    this.readSBits(nTrans);
    this.flushByte();
  }
}

/**
 * Navigate a DefineShape4 body to find the GRADIENT first byte
 * (the byte that encodes SpreadMode, InterpolationMode, and NumGradients).
 *
 * DefineShape4 body layout up to GRADIENT:
 *   [0..1]  charId UI16LE
 *   ShapeBounds RECT (bit-packed)
 *   EdgeBounds  RECT (bit-packed)
 *   UI8 flags
 *   UI8 fillStyleCount (or 0xFF + UI16LE)
 *   UI8 fillStyleType  (0x10 or 0x12 or 0x13)
 *   MATRIX (bit-packed, byte-aligned after)
 *   UI8 GRADIENT_BYTE  ← this is what we want
 *
 * Returns -1 if parsing fails.
 */
function readGradientByte(body: Uint8Array): number {
  const br = new BitReader(body, 2); // skip charId UI16

  br.skipRect(); // ShapeBounds
  br.skipRect(); // EdgeBounds
  br.skipBytes(1); // DefineShape4 flags UI8

  const count = br.readUI8();
  if (count === 0xff) br.skipBytes(2); // extended count
  if (count === 0) return -1;

  const fillType = br.readUI8();
  if (fillType !== 0x10 && fillType !== 0x12 && fillType !== 0x13) {
    return -1; // not a gradient fill
  }

  br.skipMatrix(); // skip MATRIX (byte-aligned after)

  // Next byte is the GRADIENT header byte
  return br.readUI8();
}

// ---------------------------------------------------------------------------
// Document fixture helpers
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

function makeFrame(displayObjects: ShapeDisplayObject[]): Frame {
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
    displayObjects,
  };
}

function makeLayer(frame: Frame): Layer {
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
    frames: [frame],
    frameCount: 1,
  };
}

function makeDoc(fill: LinearGradientFill | RadialGradientFill): FlashDocument {
  const shape: Shape = {
    id: "test-shape",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 100, y: 0 } },
          { type: "line", to: { x: 100, y: 100 } },
          { type: "line", to: { x: 0, y: 100 } },
        ],
        closed: true,
        fill,
      },
    ],
  };
  const shapeObj: ShapeDisplayObject = {
    id: "shape-obj",
    type: "shape",
    shape,
    x: 10,
    y: 10,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
  const scene: Scene = {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers: [makeLayer(makeFrame([shapeObj]))] },
  };
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const TAG_DEFINE_SHAPE4 = 83;

describe("Gradient spread mode — SWF GRADIENT byte encoding", () => {
  it("default (no spreadMode) encodes SpreadMode=0 (extend/pad)", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [
        { ratio: 0,   color: { r: 255, g: 0,   b: 0,   a: 255 } },
        { ratio: 255, color: { r: 0,   g: 0,   b: 255, a: 255 } },
      ],
    };
    const bytes = compileDocument(makeDoc(fill));
    const tags = parseSWFTags(bytes).filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(tags.length).toBeGreaterThan(0);

    const gradByte = readGradientByte(tags[0].body);
    expect(gradByte).toBeGreaterThanOrEqual(0);

    const spreadBits = (gradByte >> 6) & 0b11;
    expect(spreadBits).toBe(0); // pad/extend = 0
  });

  it("spreadMode 'extend' encodes SpreadMode bits[7:6] = 0b00", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      spreadMode: "extend",
      stops: [
        { ratio: 0,   color: { r: 255, g: 0,   b: 0,   a: 255 } },
        { ratio: 255, color: { r: 0,   g: 0,   b: 255, a: 255 } },
      ],
    };
    const bytes = compileDocument(makeDoc(fill));
    const tags = parseSWFTags(bytes).filter((t) => t.code === TAG_DEFINE_SHAPE4);
    const gradByte = readGradientByte(tags[0].body);
    expect((gradByte >> 6) & 0b11).toBe(0);
  });

  it("spreadMode 'reflect' encodes SpreadMode bits[7:6] = 0b01", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      spreadMode: "reflect",
      stops: [
        { ratio: 0,   color: { r: 255, g: 0,   b: 0,   a: 255 } },
        { ratio: 255, color: { r: 0,   g: 0,   b: 255, a: 255 } },
      ],
    };
    const bytes = compileDocument(makeDoc(fill));
    const tags = parseSWFTags(bytes).filter((t) => t.code === TAG_DEFINE_SHAPE4);
    const gradByte = readGradientByte(tags[0].body);
    expect((gradByte >> 6) & 0b11).toBe(1); // reflect = 1
  });

  it("spreadMode 'repeat' encodes SpreadMode bits[7:6] = 0b10", () => {
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      focalPoint: 0,
      spreadMode: "repeat",
      stops: [
        { ratio: 0,   color: { r: 255, g: 255, b: 0,   a: 255 } },
        { ratio: 255, color: { r: 0,   g: 128, b: 0,   a: 255 } },
      ],
    };
    const bytes = compileDocument(makeDoc(fill));
    const tags = parseSWFTags(bytes).filter((t) => t.code === TAG_DEFINE_SHAPE4);
    const gradByte = readGradientByte(tags[0].body);
    expect((gradByte >> 6) & 0b11).toBe(2); // repeat = 2
  });
});

describe("Gradient interpolation mode — SWF GRADIENT byte encoding", () => {
  it("default (no interpolation) encodes InterpolationMode=0 (normal RGB)", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [
        { ratio: 0,   color: { r: 255, g: 0,   b: 0,   a: 255 } },
        { ratio: 255, color: { r: 0,   g: 0,   b: 255, a: 255 } },
      ],
    };
    const bytes = compileDocument(makeDoc(fill));
    const tags = parseSWFTags(bytes).filter((t) => t.code === TAG_DEFINE_SHAPE4);
    const gradByte = readGradientByte(tags[0].body);
    const interpBits = (gradByte >> 4) & 0b11;
    expect(interpBits).toBe(0); // normal RGB = 0
  });

  it("interpolation 'rgb' encodes InterpolationMode bits[5:4] = 0b00", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      interpolation: "rgb",
      stops: [
        { ratio: 0,   color: { r: 255, g: 0,   b: 0,   a: 255 } },
        { ratio: 255, color: { r: 0,   g: 0,   b: 255, a: 255 } },
      ],
    };
    const bytes = compileDocument(makeDoc(fill));
    const tags = parseSWFTags(bytes).filter((t) => t.code === TAG_DEFINE_SHAPE4);
    const gradByte = readGradientByte(tags[0].body);
    expect((gradByte >> 4) & 0b11).toBe(0);
  });

  it("interpolation 'linearRGB' encodes InterpolationMode bits[5:4] = 0b01", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      interpolation: "linearRGB",
      stops: [
        { ratio: 0,   color: { r: 255, g: 0,   b: 0,   a: 255 } },
        { ratio: 255, color: { r: 0,   g: 0,   b: 255, a: 255 } },
      ],
    };
    const bytes = compileDocument(makeDoc(fill));
    const tags = parseSWFTags(bytes).filter((t) => t.code === TAG_DEFINE_SHAPE4);
    const gradByte = readGradientByte(tags[0].body);
    expect((gradByte >> 4) & 0b11).toBe(1); // linearRGB = 1
  });

  it("spreadMode 'reflect' + interpolation 'linearRGB' both encoded in the same byte", () => {
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      focalPoint: 0,
      spreadMode: "reflect",
      interpolation: "linearRGB",
      stops: [
        { ratio: 0,   color: { r: 255, g: 0,   b: 0,   a: 255 } },
        { ratio: 255, color: { r: 0,   g: 0,   b: 255, a: 255 } },
      ],
    };
    const bytes = compileDocument(makeDoc(fill));
    const tags = parseSWFTags(bytes).filter((t) => t.code === TAG_DEFINE_SHAPE4);
    const gradByte = readGradientByte(tags[0].body);

    // spread=reflect(1) at bits[7:6], interp=linearRGB(1) at bits[5:4]
    expect((gradByte >> 6) & 0b11).toBe(1); // reflect
    expect((gradByte >> 4) & 0b11).toBe(1); // linearRGB
    // NumGradients = 2 at bits[3:0]
    expect(gradByte & 0b1111).toBe(2);
  });

  it("GRADIENT byte for extend+rgb with 2 stops = 0x02 (all bits zero except numGradients=2)", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      spreadMode: "extend",
      interpolation: "rgb",
      stops: [
        { ratio: 0,   color: { r: 0, g: 0, b: 0, a: 255 } },
        { ratio: 255, color: { r: 255, g: 255, b: 255, a: 255 } },
      ],
    };
    const bytes = compileDocument(makeDoc(fill));
    const tags = parseSWFTags(bytes).filter((t) => t.code === TAG_DEFINE_SHAPE4);
    const gradByte = readGradientByte(tags[0].body);
    // (0<<6)|(0<<4)|2 = 0x02
    expect(gradByte).toBe(0x02);
  });
});
