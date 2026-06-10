/**
 * Tests for Protect (tag 24) and EnableDebugger2 (tag 64) absence by default,
 * and that the SWF compiles without error.
 *
 * Tag codes:
 *   24  Protect
 *   64  EnableDebugger2
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser (minimal — parses tag type + body from raw SWF bytes)
// ---------------------------------------------------------------------------

function findTags(bytes: Uint8Array) {
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
  for (let i = 0; i < frameCount; i++) frames.push(makeBlankFrame(i));
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
    timeline: { layers: [makeLayer(`${id}-layer`, frameCount)] },
  };
}

function makeDoc(scenes: Scene[]): FlashDocument {
  return {
    id: "doc-protect-1",
    properties: { ...BASE_PROPS },
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF Protect and EnableDebugger2 tags", () => {
  it("default SWF export contains no Protect tag (type 24)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const protectTag = tags.find((t) => t.type === 24);
    expect(protectTag).toBeUndefined();
  });

  it("default SWF export contains no EnableDebugger2 tag (type 64)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const debugTag = tags.find((t) => t.type === 64);
    expect(debugTag).toBeUndefined();
  });

  it("SWF compiles without error", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("protect: true emits a Protect tag (type 24)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { protect: true });
    const tags = findTags(swf);
    const protectTag = tags.find((t) => t.type === 24);
    expect(protectTag).toBeDefined();
    expect(protectTag!.body.length).toBe(0);
  });

  it("debugPassword option emits EnableDebugger2 tag (type 64)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { debugPassword: "secret" });
    const tags = findTags(swf);
    const debugTag = tags.find((t) => t.type === 64);
    expect(debugTag).toBeDefined();
    // Body: 2 reserved bytes + password bytes + null terminator
    const body = debugTag!.body;
    expect(body[0]).toBe(0); // reserved
    expect(body[1]).toBe(0); // reserved
    const pw = new TextDecoder().decode(body.slice(2, body.length - 1));
    expect(pw).toBe("secret");
    expect(body[body.length - 1]).toBe(0); // null terminator
  });
});
