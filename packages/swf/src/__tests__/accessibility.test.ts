/**
 * Accessibility model tests.
 *
 * Verifies that:
 * - FlashDocument.accessibility field is optional and defaults to undefined
 * - DocumentAccessibility fields have the expected shape
 * - ObjectAccessibility on SymbolInstance is optional
 * - A document with accessibility.enabled=true can be compiled without error
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  SymbolInstance,
} from "@flash/core";
import type { DocumentAccessibility, ObjectAccessibility } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser (shared pattern)
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

function makeDoc(
  scenes: Scene[],
  accessibility?: DocumentAccessibility
): FlashDocument {
  return {
    id: "doc-1",
    properties: { ...BASE_PROPS },
    scenes,
    library: { items: [], folders: [] },
    ...(accessibility !== undefined ? { accessibility } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AccessibilityPanel model — DocumentAccessibility", () => {
  it("FlashDocument.accessibility is undefined by default", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    expect(doc.accessibility).toBeUndefined();
  });

  it("FlashDocument.accessibility can be set with enabled=true", () => {
    const acc: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: true,
      useCustomTabOrder: false,
    };
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], acc);
    expect(doc.accessibility?.enabled).toBe(true);
    expect(doc.accessibility?.makeChildrenAccessible).toBe(true);
    expect(doc.accessibility?.useCustomTabOrder).toBe(false);
  });

  it("FlashDocument.accessibility can be set with enabled=false", () => {
    const acc: DocumentAccessibility = {
      enabled: false,
      makeChildrenAccessible: false,
      useCustomTabOrder: true,
    };
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], acc);
    expect(doc.accessibility?.enabled).toBe(false);
    expect(doc.accessibility?.makeChildrenAccessible).toBe(false);
    expect(doc.accessibility?.useCustomTabOrder).toBe(true);
  });

  it("compileDocument does not throw when accessibility.enabled=true", () => {
    const acc: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: true,
      useCustomTabOrder: false,
    };
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], acc);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("compileDocument produces a valid SWF when accessibility.enabled=true", () => {
    const acc: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: true,
      useCustomTabOrder: false,
    };
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], acc);
    const swf = compileDocument(doc);
    // Signature: 'FWS' or 'CWS'
    const sig = String.fromCharCode(swf[0], swf[1], swf[2]);
    expect(["FWS", "CWS"]).toContain(sig);
    // Parses without error and produces at least ShowFrame (tag 1)
    const tags = parseTags(swf);
    const showFrames = tags.filter((t) => t.code === 1);
    expect(showFrames.length).toBeGreaterThanOrEqual(1);
  });

  it("compileDocument produces a valid SWF when accessibility is undefined", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const showFrames = tags.filter((t) => t.code === 1);
    expect(showFrames.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AccessibilityPanel model — ObjectAccessibility on SymbolInstance", () => {
  it("SymbolInstance.accessibility is optional", () => {
    // Verify that a SymbolInstance without accessibility compiles fine
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-1",
      symbolId: "sym-1",
      x: 100,
      y: 100,
    };
    expect(inst.accessibility).toBeUndefined();
  });

  it("SymbolInstance.accessibility can carry name and description", () => {
    const acc: ObjectAccessibility = {
      enabled: true,
      name: "My Button",
      description: "Activates the main menu",
      shortcut: "Alt+M",
      tabIndex: 1,
      forceSimple: false,
    };
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-2",
      symbolId: "sym-2",
      x: 0,
      y: 0,
      accessibility: acc,
    };
    expect(inst.accessibility?.name).toBe("My Button");
    expect(inst.accessibility?.description).toBe("Activates the main menu");
    expect(inst.accessibility?.shortcut).toBe("Alt+M");
    expect(inst.accessibility?.tabIndex).toBe(1);
    expect(inst.accessibility?.forceSimple).toBe(false);
  });

  it("ObjectAccessibility enabled=false stores correctly", () => {
    const acc: ObjectAccessibility = {
      enabled: false,
    };
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-3",
      symbolId: "sym-3",
      x: 0,
      y: 0,
      accessibility: acc,
    };
    expect(inst.accessibility?.enabled).toBe(false);
    expect(inst.accessibility?.name).toBeUndefined();
  });
});
