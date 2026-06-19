/**
 * Accessibility model tests.
 *
 * Verifies that:
 * - FlashDocument.accessibility field is optional and defaults to undefined
 * - DocumentAccessibility fields have the expected shape
 * - ObjectAccessibility on SymbolInstance is optional
 * - A document with accessibility.enabled=true can be compiled without error
 * - useCustomTabOrder=true emits a DoAction with _root.tabChildren=false
 * - SymbolInstance with accessibility.tabIndex emits tabEnabled/tabIndex DoAction
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
  accessibility?: DocumentAccessibility,
  symbols: Symbol[] = []
): FlashDocument {
  return {
    id: "doc-1",
    properties: { ...BASE_PROPS },
    scenes,
    library: { items: symbols, folders: [] },
    ...(accessibility !== undefined ? { accessibility } : {}),
  };
}

/** Build a minimal Symbol (movieclip) for SymbolInstance tests. */
function makeSymbol(id: string): Symbol {
  return {
    id,
    name: id,
    itemType: "symbol",
    symbolType: "movieclip",
    linkage: {
      exportForActionScript: false,
      exportInFirstFrame: false,
      linkageIdentifier: "",
      className: "",
      exportForRuntimeSharing: false,
      importForRuntimeSharing: false,
      sharedUrl: "",
    },
    scale9Grid: null,
    timeline: {
      layers: [
        {
          id: "layer",
          name: "layer",
          type: "normal",
          visible: true,
          locked: false,
          outlineMode: false,
          outlineColor: "#ff0000",
          height: 20,
          parentFolderId: null,
          frames: [makeBlankFrame(0)],
          frameCount: 1,
        },
      ],
    },
  };
}

/** Build a frame with the given display objects (non-empty keyframe). */
function makeFrameWithObjects(index: number, displayObjects: Frame["displayObjects"]): Frame {
  return {
    index,
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

/** Build a Scene with a single layer containing the given frames. */
function makeSceneWithFrames(id: string, name: string, frames: Frame[]): Scene {
  return {
    id,
    name,
    timeline: {
      layers: [
        {
          id: `${id}-layer`,
          name: `${id}-layer`,
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
  };
}

/**
 * Return true when any DoAction (tag 12) tag body contains a raw
 * occurrence of the given ASCII substring.
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

// ---------------------------------------------------------------------------
// Tests: tab-order DoAction emission
// ---------------------------------------------------------------------------

describe("Tab-order DoAction emission", () => {
  it("useCustomTabOrder=true emits a DoAction with tabChildren", () => {
    const acc: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: true,
      useCustomTabOrder: true,
    };
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], acc);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    // At least one DoAction (tag 12) must carry "tabChildren"
    expect(doActionContains(tags, "tabChildren")).toBe(true);
  });

  it("useCustomTabOrder=false does NOT emit a tabChildren DoAction", () => {
    const acc: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: true,
      useCustomTabOrder: false,
    };
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], acc);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "tabChildren")).toBe(false);
  });

  it("accessibility=undefined does NOT emit tabChildren DoAction", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "tabChildren")).toBe(false);
  });

  it("SymbolInstance with tabIndex and instanceName emits tabIndex DoAction", () => {
    const sym = makeSymbol("sym-tab");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-tab",
      symbolId: "sym-tab",
      x: 50,
      y: 50,
      instanceName: "myClip",
      accessibility: {
        enabled: true,
        tabIndex: 3,
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], undefined, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    // DoAction body must contain "tabIndex" and "tabEnabled"
    expect(doActionContains(tags, "tabIndex")).toBe(true);
    expect(doActionContains(tags, "tabEnabled")).toBe(true);
    // The instance name must appear in the DoAction
    expect(doActionContains(tags, "myClip")).toBe(true);
  });

  it("SymbolInstance without instanceName does NOT emit tabIndex DoAction", () => {
    const sym = makeSymbol("sym-noinst");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-noinst",
      symbolId: "sym-noinst",
      x: 0,
      y: 0,
      // no instanceName
      accessibility: {
        enabled: true,
        tabIndex: 1,
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], undefined, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "tabIndex")).toBe(false);
  });

  it("SymbolInstance without accessibility.tabIndex does NOT emit tabIndex DoAction", () => {
    const sym = makeSymbol("sym-noidx");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-noidx",
      symbolId: "sym-noidx",
      x: 0,
      y: 0,
      instanceName: "noTabClip",
      accessibility: {
        enabled: true,
        // no tabIndex
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], undefined, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "tabIndex")).toBe(false);
    expect(doActionContains(tags, "noTabClip")).toBe(false);
  });

  it("useCustomTabOrder=true combined with tabIndex instance emits both scripts", () => {
    const acc: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: true,
      useCustomTabOrder: true,
    };
    const sym = makeSymbol("sym-combo");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-combo",
      symbolId: "sym-combo",
      x: 0,
      y: 0,
      instanceName: "comboClip",
      accessibility: {
        enabled: true,
        tabIndex: 2,
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], acc, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "tabChildren")).toBe(true);
    expect(doActionContains(tags, "tabIndex")).toBe(true);
    expect(doActionContains(tags, "comboClip")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: _accProps DoAction emission
// ---------------------------------------------------------------------------

describe("_accProps DoAction emission", () => {
  it("instance with accessibility.name emits _accProps DoAction containing the name", () => {
    const sym = makeSymbol("sym-acc-name");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-acc-name",
      symbolId: "sym-acc-name",
      x: 0,
      y: 0,
      instanceName: "myButton",
      accessibility: {
        enabled: true,
        name: "Submit Button",
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], undefined, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_accProps")).toBe(true);
    expect(doActionContains(tags, "Submit Button")).toBe(true);
    expect(doActionContains(tags, "myButton")).toBe(true);
  });

  it("instance with accessibility.description emits _accProps DoAction containing the description", () => {
    const sym = makeSymbol("sym-acc-desc");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-acc-desc",
      symbolId: "sym-acc-desc",
      x: 0,
      y: 0,
      instanceName: "descClip",
      accessibility: {
        enabled: true,
        description: "Activates the main menu",
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], undefined, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_accProps")).toBe(true);
    expect(doActionContains(tags, "Activates the main menu")).toBe(true);
    expect(doActionContains(tags, "descClip")).toBe(true);
  });

  it("instance with accessibility.shortcut emits _accProps DoAction containing the shortcut", () => {
    const sym = makeSymbol("sym-acc-sc");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-acc-sc",
      symbolId: "sym-acc-sc",
      x: 0,
      y: 0,
      instanceName: "scClip",
      accessibility: {
        enabled: true,
        shortcut: "Alt+M",
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], undefined, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_accProps")).toBe(true);
    expect(doActionContains(tags, "Alt+M")).toBe(true);
    expect(doActionContains(tags, "scClip")).toBe(true);
  });

  it("instance with all _accProps fields emits them all in the DoAction", () => {
    const sym = makeSymbol("sym-acc-all");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-acc-all",
      symbolId: "sym-acc-all",
      x: 0,
      y: 0,
      instanceName: "fullClip",
      accessibility: {
        enabled: true,
        name: "Nav Button",
        description: "Opens navigation",
        shortcut: "Ctrl+N",
        forceSimple: true,
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], undefined, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_accProps")).toBe(true);
    expect(doActionContains(tags, "Nav Button")).toBe(true);
    expect(doActionContains(tags, "Opens navigation")).toBe(true);
    expect(doActionContains(tags, "Ctrl+N")).toBe(true);
    expect(doActionContains(tags, "forceSimple")).toBe(true);
    expect(doActionContains(tags, "fullClip")).toBe(true);
  });

  it("instance with accessibility.enabled=false emits _accProps DoAction with silent=true", () => {
    // "Make object accessible" unchecked must hide the instance from MSAA
    // screen readers via _accProps.silent = true, even when no other a11y
    // fields (name/description/shortcut/forceSimple) are set.
    const sym = makeSymbol("sym-acc-silent");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-acc-silent",
      symbolId: "sym-acc-silent",
      x: 0,
      y: 0,
      instanceName: "silentClip",
      accessibility: {
        enabled: false,
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], undefined, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_accProps")).toBe(true);
    expect(doActionContains(tags, "silent")).toBe(true);
    expect(doActionContains(tags, "silentClip")).toBe(true);
  });

  it("instance with enabled=false AND other a11y fields silences while keeping the other fields", () => {
    // Flash silences the object (silent=true) even when name/description/etc.
    // are also set, so silent is emitted ALONGSIDE the other fields.
    const sym = makeSymbol("sym-acc-silent-plus");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-acc-silent-plus",
      symbolId: "sym-acc-silent-plus",
      x: 0,
      y: 0,
      instanceName: "silentPlusClip",
      accessibility: {
        enabled: false,
        name: "Hidden Nav",
        description: "Should still be silenced",
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], undefined, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_accProps")).toBe(true);
    expect(doActionContains(tags, "silent")).toBe(true);
    expect(doActionContains(tags, "Hidden Nav")).toBe(true);
    expect(doActionContains(tags, "Should still be silenced")).toBe(true);
    expect(doActionContains(tags, "silentPlusClip")).toBe(true);
  });

  it("instance WITHOUT instanceName does NOT emit _accProps DoAction", () => {
    const sym = makeSymbol("sym-acc-noname");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-acc-noname",
      symbolId: "sym-acc-noname",
      x: 0,
      y: 0,
      // no instanceName
      accessibility: {
        enabled: true,
        name: "Hidden Name",
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], undefined, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_accProps")).toBe(false);
  });

  it("instance with accessibility.enabled=true but no name/description/shortcut/forceSimple does NOT emit _accProps", () => {
    const sym = makeSymbol("sym-acc-empty");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst-acc-empty",
      symbolId: "sym-acc-empty",
      x: 0,
      y: 0,
      instanceName: "emptyClip",
      accessibility: {
        enabled: true,
        // no name, description, shortcut, forceSimple
      },
    };
    const scene = makeSceneWithFrames("s1", "Scene 1", [
      makeFrameWithObjects(0, [inst]),
    ]);
    const doc = makeDoc([scene], undefined, [sym]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(doActionContains(tags, "_accProps")).toBe(false);
  });
});
