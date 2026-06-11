/**
 * Tests for CWS (compressed SWF) output via the `compress` option.
 *
 * A compressed SWF differs from a standard FWS SWF in the following ways:
 *   - Bytes 0-2 are "CWS" [0x43, 0x57, 0x53] instead of "FWS" [0x46, 0x57, 0x53]
 *   - Bytes 3-7 (version + uncompressed file length) are unchanged
 *   - Bytes 8 onward are the zlib-deflated SWF body
 *
 * When decompressed the body must be identical to the uncompressed FWS body
 * (bytes 8 onward of the equivalent FWS SWF).
 */

import { describe, it, expect } from "vitest";
import { inflateSync } from "fflate";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Document factory helpers (shared pattern across swf tests)
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

function makeDoc(
  scenes: Scene[],
  overrides: Partial<typeof BASE_PROPS> = {}
): FlashDocument {
  return {
    id: "doc-1",
    properties: { ...BASE_PROPS, ...overrides },
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF compressed output (CWS)", () => {
  it("1. compile with { compress: true } produces CWS signature [0x43, 0x57, 0x53]", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc, { compress: true });
    expect(buf[0]).toBe(0x43); // 'C'
    expect(buf[1]).toBe(0x57); // 'W'
    expect(buf[2]).toBe(0x53); // 'S'
  });

  it("2. compile with { compress: false } produces FWS signature [0x46, 0x57, 0x53]", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc, { compress: false });
    expect(buf[0]).toBe(0x46); // 'F'
    expect(buf[1]).toBe(0x57); // 'W'
    expect(buf[2]).toBe(0x53); // 'S'
  });

  it("3. compile with no options produces FWS signature (default uncompressed)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    expect(buf[0]).toBe(0x46); // 'F'
  });

  it("4. CWS version byte (byte 3) is still 0x08 (Flash 8)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc, { compress: true });
    expect(buf[3]).toBe(0x08);
  });

  it("5. CWS uncompressed file length field (bytes 4-7) equals the uncompressed FWS length", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const fws = compileDocument(doc, { compress: false });
    const cws = compileDocument(doc, { compress: true });

    const fwsLength = new DataView(fws.buffer, fws.byteOffset).getUint32(4, true);
    const cwsLength = new DataView(cws.buffer, cws.byteOffset).getUint32(4, true);

    // Both must record the uncompressed total file length
    expect(cwsLength).toBe(fwsLength);
  });

  it("6. CWS body (bytes 8+) decompresses to the same bytes as the FWS body (bytes 8+)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const fws = compileDocument(doc, { compress: false });
    const cws = compileDocument(doc, { compress: true });

    const fwsBody = fws.slice(8);
    const cwsBody = cws.slice(8);

    const decompressed = inflateSync(cwsBody);

    expect(decompressed).toEqual(fwsBody);
  });

  it("7. CWS output is shorter than FWS output for a non-trivial doc (deflate actually compresses)", () => {
    // Use a multi-frame doc to generate more body bytes for a meaningful comparison.
    const doc = makeDoc([makeScene("s1", "Scene 1", 10)]);
    const fws = compileDocument(doc, { compress: false });
    const cws = compileDocument(doc, { compress: true });
    // Compressed output (header=8 + deflated body) should be smaller than uncompressed
    expect(cws.length).toBeLessThan(fws.length);
  });

  it("8. multi-frame CWS body decompresses correctly", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 5)]);
    const fws = compileDocument(doc, { compress: false });
    const cws = compileDocument(doc, { compress: true });

    const decompressed = inflateSync(cws.slice(8));
    expect(decompressed).toEqual(fws.slice(8));
  });
});
