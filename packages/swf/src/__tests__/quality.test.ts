/**
 * Tests for docProperties.quality → _quality AS2 DoAction emission.
 *
 * Verifies that:
 * - quality="low"  → DoAction emitted with "_quality" and "LOW"
 * - quality="medium" → DoAction emitted with "MEDIUM"
 * - quality="best" → DoAction emitted with "BEST"
 * - quality="high" (default) → no _quality DoAction emitted
 * - quality=undefined → no _quality DoAction emitted
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
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
    tags.push({
      code: tagCode,
      body: swf.slice(bodyStart, bodyStart + bodyLength),
      offset: pos,
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

/**
 * Return true when any DoAction (tag 12) body contains the given ASCII substring.
 */
function doActionContains(tags: SwfTag[], needle: string): boolean {
  const TAG_DO_ACTION = 12;
  const doActions = tags.filter((t) => t.code === TAG_DO_ACTION);
  const needleBytes = Array.from(needle).map((c) => c.charCodeAt(0));
  for (const tag of doActions) {
    outer: for (let i = 0; i <= tag.body.length - needleBytes.length; i++) {
      for (let j = 0; j < needleBytes.length; j++) {
        if (tag.body[i + j] !== needleBytes[j]) continue outer;
      }
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Document factory helpers
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

function makeBlankFrame(index: number): Frame {
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
  };
}

function makeLayer(id: string, frameCount: number): Layer {
  const frames: Frame[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(makeBlankFrame(i));
  }
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
    frameCount,
  };
}

function makeScene(id: string, name: string, frameCount = 1): Scene {
  return {
    id,
    name,
    timeline: {
      layers: [makeLayer(`${id}-layer`, frameCount)],
    },
  };
}

function makeDoc(quality?: "low" | "medium" | "high" | "best"): FlashDocument {
  return {
    id: "doc-1",
    properties: {
      ...BASE_PROPS,
      ...(quality !== undefined ? { quality } : {}),
    },
    scenes: [makeScene("s1", "Scene 1", 1)],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("docProperties.quality → _quality DoAction", () => {
  it("quality='low' emits a DoAction containing '_quality' and 'LOW'", () => {
    const doc = makeDoc("low");
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_quality")).toBe(true);
    expect(doActionContains(tags, "LOW")).toBe(true);
  });

  it("quality='medium' emits a DoAction containing '_quality' and 'MEDIUM'", () => {
    const doc = makeDoc("medium");
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_quality")).toBe(true);
    expect(doActionContains(tags, "MEDIUM")).toBe(true);
  });

  it("quality='best' emits a DoAction containing '_quality' and 'BEST'", () => {
    const doc = makeDoc("best");
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_quality")).toBe(true);
    expect(doActionContains(tags, "BEST")).toBe(true);
  });

  it("quality='high' (default) does NOT emit a _quality DoAction", () => {
    const doc = makeDoc("high");
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_quality")).toBe(false);
  });

  it("quality=undefined does NOT emit a _quality DoAction", () => {
    const doc = makeDoc(undefined);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_quality")).toBe(false);
  });

  it("quality='low' DoAction does NOT contain 'HIGH' or 'MEDIUM' or 'BEST'", () => {
    const doc = makeDoc("low");
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "HIGH")).toBe(false);
    expect(doActionContains(tags, "MEDIUM")).toBe(false);
    expect(doActionContains(tags, "BEST")).toBe(false);
  });

  it("compileDocument does not throw for any quality value", () => {
    for (const q of ["low", "medium", "high", "best"] as const) {
      expect(() => compileDocument(makeDoc(q))).not.toThrow();
    }
    expect(() => compileDocument(makeDoc(undefined))).not.toThrow();
  });
});
