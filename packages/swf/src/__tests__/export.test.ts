/**
 * Tests for exportSWF and triggerDownload helpers.
 */
import { describe, it, expect } from "vitest";
import { exportSWF, triggerDownload } from "../export.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Minimal document fixture
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

function makeEmptyFrame(): Frame {
  return {
    index: 0,
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

function makeLayer(name: string): Layer {
  return {
    id: `layer-${name}`,
    name,
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames: [makeEmptyFrame()],
    frameCount: 1,
  };
}

function makeScene(id: string, name: string): Scene {
  return {
    id,
    name,
    timeline: {
      layers: [makeLayer("Layer 1")],
    },
  };
}

const minimalDoc: FlashDocument = {
  id: "doc-1",
  properties: BASE_PROPS,
  scenes: [makeScene("scene-1", "Scene 1")],
  library: { items: [], folders: [] },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("exportSWF", () => {
  it("returns a Uint8Array", () => {
    const result = exportSWF(minimalDoc);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("first 3 bytes are FWS (uncompressed SWF signature)", () => {
    const result = exportSWF(minimalDoc);
    expect(result[0]).toBe(0x46); // 'F'
    expect(result[1]).toBe(0x57); // 'W'
    expect(result[2]).toBe(0x53); // 'S'
  });

  it("returns a non-empty buffer (length > 20)", () => {
    const result = exportSWF(minimalDoc);
    expect(result.length).toBeGreaterThan(20);
  });
});

describe("triggerDownload", () => {
  it("does not throw in a Node.js environment (document is undefined)", () => {
    const bytes = exportSWF(minimalDoc);
    expect(() => triggerDownload(bytes, "test.swf")).not.toThrow();
  });
});
