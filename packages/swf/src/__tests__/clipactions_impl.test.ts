/**
 * Tests for the clip actions implementation:
 *   - ClipAction type in model (SymbolInstance.clipActions)
 *   - encodePlaceObject2WithClipActions in shapes.ts
 *   - exportSWF routing clip actions through PlaceObject2
 *
 * SWF spec (Flash 8):
 *   HasClipActions flag = bit 7 of PlaceObject2 flags byte = 0x80
 *
 * CLIPACTIONRECORD layout (SWF ≥ 6):
 *   ClipEventFlags   UI32
 *   ActionRecordSize UI32
 *   ActionBytes      UI8[] (compileAS2 output, includes 0x00 ActionEnd)
 *
 * AllEventFlags    UI32  (union of all ClipEventFlags, written before records)
 * Terminator       UI32 = 0x00000000 (written after last record)
 *
 * ClipEventFlags (SWF spec 8.4.6.2):
 *   load       = 0x00000001
 *   enterFrame = 0x00000002
 *   unload     = 0x00000004
 *   mouseMove  = 0x00000008
 *   mouseDown  = 0x00000010
 *   mouseUp    = 0x00000020
 *   keyDown    = 0x00000040
 *   keyUp      = 0x00000080
 *   data       = 0x00000100
 */

import { describe, it, expect } from "vitest";
import { encodePlaceObject2WithClipActions } from "../shapes.js";
import { exportSWF } from "../export.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
  SymbolInstance,
  ClipAction,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Helpers: read little-endian integers from a Uint8Array
// ---------------------------------------------------------------------------

function readUI32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

// ---------------------------------------------------------------------------
// SWF binary helpers (reused from clipactions.test.ts)
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
// Minimal document fixture helpers
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

function makeEmptyFrame(displayObjects: readonly SymbolInstance[] = []): Frame {
  return {
    index: 0,
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

function makeSymbol(id: string, name: string): Symbol {
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: { layers: [makeLayer([makeEmptyFrame()])] },
    linkage: DEFAULT_LINKAGE,
    scale9Grid: null,
  };
}

function makeInstance(
  id: string,
  symbolId: string,
  x: number,
  y: number,
  clipActions?: readonly ClipAction[]
): SymbolInstance {
  return clipActions && clipActions.length > 0
    ? { id, type: "instance", symbolId, x, y, clipActions }
    : { id, type: "instance", symbolId, x, y };
}

function makeDoc(instance: SymbolInstance): FlashDocument {
  const sym = makeSymbol("sym-1", "MyClip");
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene([makeEmptyFrame([instance])])],
    library: { items: [sym], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Unit tests — encodePlaceObject2WithClipActions
// ---------------------------------------------------------------------------

describe("encodePlaceObject2WithClipActions — unit", () => {
  it("sets HasClipActions flag (0x80) in flags byte", () => {
    const clipActions: ClipAction[] = [
      { event: "enterFrame", script: "this._x++;" },
    ];
    const body = encodePlaceObject2WithClipActions(1, 1, 0, 0, clipActions);
    // Flags byte must have HasClipActions (0x80) set
    expect(body[0]! & 0x80).toBe(0x80);
  });

  it("flags byte = 0x86 for HasCharacter | HasMatrix | HasClipActions", () => {
    const clipActions: ClipAction[] = [
      { event: "load", script: "trace('loaded');" },
    ];
    const body = encodePlaceObject2WithClipActions(1, 1, 0, 0, clipActions);
    // HasCharacter (0x02) | HasMatrix (0x04) | HasClipActions (0x80) = 0x86
    expect(body[0]).toBe(0x86);
  });

  it("flags byte = 0xa6 when instanceName is provided (HasName | HasClipActions)", () => {
    const clipActions: ClipAction[] = [
      { event: "enterFrame", script: "" },
    ];
    const body = encodePlaceObject2WithClipActions(1, 1, 0, 0, clipActions, undefined, "mc1");
    // HasCharacter (0x02) | HasMatrix (0x04) | HasName (0x20) | HasClipActions (0x80) = 0xa6
    expect(body[0]).toBe(0xa6);
  });

  it("contains AllEventFlags UI32 with enterFrame bit (0x00000002)", () => {
    const clipActions: ClipAction[] = [
      { event: "enterFrame", script: "" },
    ];
    const body = encodePlaceObject2WithClipActions(1, 1, 0, 0, clipActions);
    // Body layout: flags(1) + depth(2) + charId(2) + MATRIX(variable)
    // After MATRIX comes AllEventFlags UI32.
    // We need to find where the MATRIX ends; parse the MATRIX manually.
    // The simplest approach: scan for AllEventFlags = 0x00000002 (enterFrame).
    // We know the body ends with terminator UI32 = 0x00000000.
    // Find AllEventFlags by scanning from offset 5 onward for 0x00000002.
    let found = false;
    for (let i = 5; i <= body.length - 4; i++) {
      const val = readUI32LE(body, i);
      if (val === 0x00000002) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("AllEventFlags is union of all event bits for multiple events", () => {
    const clipActions: ClipAction[] = [
      { event: "load", script: "" },
      { event: "enterFrame", script: "" },
    ];
    const body = encodePlaceObject2WithClipActions(1, 1, 0, 0, clipActions);
    // AllEventFlags should be load(1) | enterFrame(2) = 3
    let found = false;
    for (let i = 5; i <= body.length - 4; i++) {
      const val = readUI32LE(body, i);
      if (val === 0x00000003) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("terminates with UI32 = 0x00000000", () => {
    const clipActions: ClipAction[] = [
      { event: "enterFrame", script: "" },
    ];
    const body = encodePlaceObject2WithClipActions(1, 1, 0, 0, clipActions);
    // Last 4 bytes must be the terminator = 0x00000000
    const last4 = readUI32LE(body, body.length - 4);
    expect(last4).toBe(0x00000000);
  });

  it("body is longer than a plain PlaceObject2 (clip action payload present)", () => {
    // A plain PlaceObject2 at (0,0) with identity matrix is short.
    // With clip actions we add: AllEventFlags(4) + ClipEventFlags(4) + ActionRecordSize(4) + bytecode + Terminator(4) = 16+ bytes
    const clipActions: ClipAction[] = [
      { event: "enterFrame", script: "this._x++;" },
    ];
    const withClips = encodePlaceObject2WithClipActions(1, 1, 0, 0, clipActions);
    // A minimal PlaceObject2 without clip actions is ~6-15 bytes; with clip actions it must be > 20
    expect(withClips.length).toBeGreaterThan(20);
  });

  it("enterFrame ClipEventFlags record is 0x00000002", () => {
    const clipActions: ClipAction[] = [
      { event: "enterFrame", script: "" },
    ];
    const body = encodePlaceObject2WithClipActions(1, 1, 0, 0, clipActions);
    // After AllEventFlags (4 bytes), the first ClipEventFlags record should be 0x00000002.
    // Locate AllEventFlags by finding the value 0x00000002 (same as enterFrame).
    // Then the next UI32 after it is also ClipEventFlags = 0x00000002.
    let allEventFlagsOffset = -1;
    for (let i = 5; i <= body.length - 4; i++) {
      const val = readUI32LE(body, i);
      if (val === 0x00000002) {
        allEventFlagsOffset = i;
        break;
      }
    }
    expect(allEventFlagsOffset).toBeGreaterThan(4);
    // The first CLIPACTIONRECORD starts immediately after AllEventFlags
    const firstRecordClipEventFlags = readUI32LE(body, allEventFlagsOffset + 4);
    expect(firstRecordClipEventFlags).toBe(0x00000002);
  });

  it("load ClipEventFlags record is 0x00000001", () => {
    const clipActions: ClipAction[] = [{ event: "load", script: "" }];
    const body = encodePlaceObject2WithClipActions(1, 1, 0, 0, clipActions);
    // AllEventFlags = 0x00000001
    let allEventFlagsOffset = -1;
    for (let i = 5; i <= body.length - 4; i++) {
      const val = readUI32LE(body, i);
      if (val === 0x00000001) {
        allEventFlagsOffset = i;
        break;
      }
    }
    expect(allEventFlagsOffset).toBeGreaterThan(4);
    const firstRecordClipEventFlags = readUI32LE(body, allEventFlagsOffset + 4);
    expect(firstRecordClipEventFlags).toBe(0x00000001);
  });

  it("returns a Uint8Array", () => {
    const body = encodePlaceObject2WithClipActions(1, 1, 0, 0, [
      { event: "enterFrame", script: "" },
    ]);
    expect(body).toBeInstanceOf(Uint8Array);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — encodePlaceObject2WithClipActions export check
// ---------------------------------------------------------------------------

describe("encodePlaceObject2WithClipActions — export check", () => {
  it("encodePlaceObject2WithClipActions is a function", () => {
    expect(typeof encodePlaceObject2WithClipActions).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Integration tests — exportSWF routes clipActions through PlaceObject2
// ---------------------------------------------------------------------------

describe("exportSWF with clipActions — integration", () => {
  it("does not throw when instance has clipActions", () => {
    const inst = makeInstance("inst-1", "sym-1", 0, 0, [
      { event: "enterFrame", script: "this._x++;" },
    ]);
    const doc = makeDoc(inst);
    expect(() => exportSWF(doc)).not.toThrow();
  });

  it("HasClipActions (0x80) is set in PlaceObject2 flags byte", () => {
    const inst = makeInstance("inst-1", "sym-1", 0, 0, [
      { event: "enterFrame", script: "this._x++;" },
    ]);
    const doc = makeDoc(inst);
    const bytes = exportSWF(doc);
    const tags = parseSWFTags(bytes);

    const po2Tags = tags.filter(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2Tags.length).toBeGreaterThan(0);

    // At least one PlaceObject2 should have HasClipActions set
    const withClipActions = po2Tags.filter((t) => (t.body[0]! & 0x80) !== 0);
    expect(withClipActions.length).toBeGreaterThan(0);
  });

  it("instance without clipActions does NOT have HasClipActions set", () => {
    const inst = makeInstance("inst-1", "sym-1", 0, 0);
    const doc = makeDoc(inst);
    const bytes = exportSWF(doc);
    const tags = parseSWFTags(bytes);

    const po2Tags = tags.filter(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2Tags.length).toBeGreaterThan(0);

    for (const tag of po2Tags) {
      expect(tag.body[0]! & 0x80).toBe(0);
    }
  });

  it("PlaceObject2 body with clipActions is longer (includes ClipAction records)", () => {
    const instPlain = makeInstance("inst-1", "sym-1", 0, 0);
    const instWithActions = makeInstance("inst-2", "sym-1", 0, 0, [
      { event: "enterFrame", script: "this._x++;" },
    ]);

    const docPlain = makeDoc(instPlain);
    const docWithActions = makeDoc(instWithActions);

    const bytesPlain = exportSWF(docPlain);
    const bytesWithActions = exportSWF(docWithActions);

    const tagsPlain = parseSWFTags(bytesPlain);
    const tagsWithActions = parseSWFTags(bytesWithActions);

    const po2Plain = tagsPlain.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    const po2WithActions = tagsWithActions.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x80) !== 0
    );

    expect(po2Plain).toBeDefined();
    expect(po2WithActions).toBeDefined();
    // The clip-action body must be longer (AllEventFlags + records + terminator)
    expect(po2WithActions!.body.length).toBeGreaterThan(po2Plain!.body.length);
  });

  it("multiple clip events produce multiple CLIPACTIONRECORD entries", () => {
    const inst = makeInstance("inst-1", "sym-1", 0, 0, [
      { event: "load", script: "trace('load');" },
      { event: "enterFrame", script: "this._x++;" },
    ]);
    const doc = makeDoc(inst);
    const bytes = exportSWF(doc);
    const tags = parseSWFTags(bytes);

    const po2WithActions = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x80) !== 0
    );
    expect(po2WithActions).toBeDefined();

    // AllEventFlags should be load(1) | enterFrame(2) = 3
    // Scan the body for the value 3 (AllEventFlags)
    const body = po2WithActions!.body;
    let foundAllFlags = false;
    for (let i = 5; i <= body.length - 4; i++) {
      if (readUI32LE(body, i) === 0x00000003) {
        foundAllFlags = true;
        break;
      }
    }
    expect(foundAllFlags).toBe(true);
  });

  it("instance with clipActions AND instanceName has HasName and HasClipActions set", () => {
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      instanceName: "myMC",
      clipActions: [{ event: "enterFrame", script: "this._x++;" }],
    };
    const doc = makeDoc(inst);
    const bytes = exportSWF(doc);
    const tags = parseSWFTags(bytes);

    const po2Tags = tags.filter(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x80) !== 0
    );
    expect(po2Tags.length).toBeGreaterThan(0);
    // HasName (0x20) and HasClipActions (0x80) both set → flags & 0xa0 = 0xa0
    const withBoth = po2Tags.filter((t) => (t.body[0]! & 0xa0) === 0xa0);
    expect(withBoth.length).toBeGreaterThan(0);
  });

  it("terminator UI32=0 is present at end of clip-action block", () => {
    const inst = makeInstance("inst-1", "sym-1", 0, 0, [
      { event: "enterFrame", script: "" },
    ]);
    const doc = makeDoc(inst);
    const bytes = exportSWF(doc);
    const tags = parseSWFTags(bytes);

    const po2Tag = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x80) !== 0
    );
    expect(po2Tag).toBeDefined();
    // Last 4 bytes = terminator = 0x00000000
    const last4 = readUI32LE(po2Tag!.body, po2Tag!.body.length - 4);
    expect(last4).toBe(0x00000000);
  });
});

// ---------------------------------------------------------------------------
// Model type tests
// ---------------------------------------------------------------------------

describe("ClipAction model type", () => {
  it("ClipAction interface is importable from @flash/core", async () => {
    // Type-only test — if this compiles, the type exists
    const action: ClipAction = { event: "enterFrame", script: "this._x++;" };
    expect(action.event).toBe("enterFrame");
    expect(action.script).toBe("this._x++;");
  });

  it("SymbolInstance accepts clipActions field", () => {
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      clipActions: [
        { event: "load", script: "trace('hi');" },
        { event: "enterFrame", script: "this._x++;" },
      ],
    };
    expect(inst.clipActions).toHaveLength(2);
    expect(inst.clipActions![0]!.event).toBe("load");
    expect(inst.clipActions![1]!.event).toBe("enterFrame");
  });

  it("SymbolInstance.clipActions is optional (undefined when not set)", () => {
    const inst: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 0,
      y: 0,
    };
    expect(inst.clipActions).toBeUndefined();
  });

  it("ClipAction supports all specified event types", () => {
    const events: ClipAction["event"][] = [
      "load", "enterFrame", "unload",
      "mouseMove", "mouseDown", "mouseUp",
      "keyDown", "keyUp", "data",
    ];
    for (const event of events) {
      const action: ClipAction = { event, script: "" };
      expect(action.event).toBe(event);
    }
  });
});
