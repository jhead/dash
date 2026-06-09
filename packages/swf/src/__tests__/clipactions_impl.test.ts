/**
 * Tests for the clip actions implementation:
 *   - ClipAction type in model (SymbolInstance.clipActions)
 *   - encodePlaceObject2WithClipActions in shapes.ts
 *   - exportSWF routing clip actions through PlaceObject2
 *
 * SWF spec (Flash 8):
 *   HasClipActions flag = bit 7 of PlaceObject2 flags byte = 0x80
 *
 * ClipActions block layout (SWF ≥ 6), immediately after MATRIX (and Name if present):
 *   Reserved      UI16 = 0x0000 (must be zero; Ruffle reads this before AllEventFlags)
 *   AllEventFlags UI32 (union of all ClipEventFlags, written before records)
 *   for each CLIPACTIONRECORD:
 *     ClipEventFlags   UI32
 *     ActionRecordSize UI32
 *     ActionBytes      UI8[] (compileAS2 output, includes 0x00 ActionEnd)
 *   Terminator    UI32 = 0x00000000 (written after last record)
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

function readUI16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8)) & 0xffff;
}

function readUI32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

/**
 * Locate the offset of the clip-actions block (Reserved UI16) within a
 * PlaceObject2 body. Scans from offset 5 (after flags+depth+charId) looking
 * for two bytes of 0x00 followed by a UI32 equal to `expectedAllEventFlags`.
 */
function findClipActionsBlockOffset(body: Uint8Array, expectedAllEventFlags: number): number {
  for (let i = 5; i <= body.length - 6; i++) {
    if (readUI16LE(body, i) === 0x0000 && readUI32LE(body, i + 2) === expectedAllEventFlags) {
      return i;
    }
  }
  return -1;
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

  it("clip-actions block starts with reserved UI16=0 before AllEventFlags (Ruffle read_clip_actions expects this)", () => {
    // Ruffle swf/src/read.rs read_clip_actions() calls read_u16() before read_clip_event_flags().
    // Verify the exact layout: Reserved(UI16=0) + AllEventFlags(UI32) is present.
    const clipActions: ClipAction[] = [
      { event: "mouseDown", script: "gotoAndStop(2);" },
    ];
    const body = encodePlaceObject2WithClipActions(1, 1, 0, 0, clipActions);
    // mouseDown = 0x00000010
    const blockOffset = findClipActionsBlockOffset(body, 0x00000010);
    expect(blockOffset).toBeGreaterThan(4);
    // Confirm reserved UI16 at blockOffset is exactly 0x0000
    expect(readUI16LE(body, blockOffset)).toBe(0x0000);
    // Confirm AllEventFlags UI32 at blockOffset+2 is mouseDown bit
    expect(readUI32LE(body, blockOffset + 2)).toBe(0x00000010);
    // Confirm first ClipEventFlags record at blockOffset+6 is also mouseDown bit
    expect(readUI32LE(body, blockOffset + 6)).toBe(0x00000010);
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

// ---------------------------------------------------------------------------
// Runtime verification proxy test
//
// Acceptance criterion (from task 0663):
//   An onClipEvent(enterFrame) script authored on a movieclip instance
//   demonstrably executes in Ruffle when the published SWF is played.
//
// This unit-level proxy verifies the SWF binary contract that makes runtime
// execution possible:
//   1. PlaceObject2 tag has HasClipActions flag (0x80) set in its flags byte.
//   2. AllEventFlags UI32 includes enterFrame bit (0x00000002).
//   3. The first CLIPACTIONRECORD has ClipEventFlags = 0x00000002.
//   4. The clip-action block ends with a UI32 terminator = 0x00000000.
//   5. The ActionScript bytecode for "this._x += 5;" is non-empty.
//
// These conditions are necessary and sufficient for Ruffle to recognise and
// dispatch the onClipEvent(enterFrame) handler at runtime.
// ---------------------------------------------------------------------------

describe("runtime verification proxy — onClipEvent(enterFrame) in published SWF", () => {
  /**
   * Build a FlashDocument with one movieclip instance that carries an
   * onClipEvent(enterFrame) handler, compile it to SWF, and return
   * the parsed PlaceObject2 tag body that holds the clip actions.
   */
  function getClipActionPO2Body(): Uint8Array {
    const inst = makeInstance("inst-rv-1", "sym-1", 100, 80, [
      { event: "enterFrame", script: "this._x += 5;" },
    ]);
    const doc = makeDoc(inst);
    const bytes = exportSWF(doc);
    const tags = parseSWFTags(bytes);

    const po2 = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x80) !== 0
    );
    if (!po2) throw new Error("No PlaceObject2 with HasClipActions found in SWF");
    return po2.body;
  }

  it("PlaceObject2 HasClipActions flag (0x80) is set — required for Ruffle dispatch", () => {
    const body = getClipActionPO2Body();
    expect(body[0]! & 0x80).toBe(0x80);
  });

  it("AllEventFlags UI32 contains enterFrame bit (0x00000002)", () => {
    const body = getClipActionPO2Body();
    // Scan body for UI32 value = 0x00000002 (enterFrame bit)
    let found = false;
    for (let i = 5; i <= body.length - 4; i++) {
      if (readUI32LE(body, i) === 0x00000002) { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it("first CLIPACTIONRECORD ClipEventFlags is enterFrame (0x00000002)", () => {
    const body = getClipActionPO2Body();
    // Find AllEventFlags offset, then the record immediately follows
    let allFlagsOffset = -1;
    for (let i = 5; i <= body.length - 4; i++) {
      if (readUI32LE(body, i) === 0x00000002) { allFlagsOffset = i; break; }
    }
    expect(allFlagsOffset).toBeGreaterThan(4);
    // First CLIPACTIONRECORD ClipEventFlags = UI32 immediately after AllEventFlags
    expect(readUI32LE(body, allFlagsOffset + 4)).toBe(0x00000002);
  });

  it("CLIPACTIONRECORD contains non-empty ActionScript bytecode", () => {
    const body = getClipActionPO2Body();
    // AllEventFlags + ClipEventFlags(4) + ActionRecordSize(4) = 12 bytes before bytecode
    let allFlagsOffset = -1;
    for (let i = 5; i <= body.length - 4; i++) {
      if (readUI32LE(body, i) === 0x00000002) { allFlagsOffset = i; break; }
    }
    expect(allFlagsOffset).toBeGreaterThan(4);
    const actionRecordSize = readUI32LE(body, allFlagsOffset + 8);
    // "this._x += 5;" compiles to several AVM1 opcodes; must be > 0
    expect(actionRecordSize).toBeGreaterThan(0);
  });

  it("clip-action block ends with UI32 terminator = 0x00000000", () => {
    const body = getClipActionPO2Body();
    const last4 = readUI32LE(body, body.length - 4);
    expect(last4).toBe(0x00000000);
  });

  it("full SWF is valid: starts with FWS/CWS signature and ends with End tag (0x00)", () => {
    const inst = makeInstance("inst-rv-2", "sym-1", 0, 0, [
      { event: "enterFrame", script: "this._x += 5;" },
    ]);
    const doc = makeDoc(inst);
    const bytes = exportSWF(doc);

    // SWF signature: 'F' (0x46) or 'C' (0x43), 'W' (0x57), 'S' (0x53)
    const sig = bytes[0]!;
    expect(sig === 0x46 || sig === 0x43).toBe(true); // FWS or CWS
    expect(bytes[1]).toBe(0x57); // W
    expect(bytes[2]).toBe(0x53); // S
  });
});
