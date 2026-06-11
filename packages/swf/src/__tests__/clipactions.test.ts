/**
 * Tests for PlaceObject2 clip actions (HasClipActions flag, bit 7 = 0x80).
 *
 * SWF spec (Flash 8): PlaceObject2 flags byte
 *   bit 0: HasMove       (0x01)
 *   bit 1: HasCharacter  (0x02)
 *   bit 2: HasMatrix     (0x04)
 *   bit 3: HasColorTransform (0x08)
 *   bit 4: HasRatio      (0x10)
 *   bit 5: HasName       (0x20)
 *   bit 6: HasClipDepth  (0x40)
 *   bit 7: HasClipActions (0x80)  ← set when clip-event handlers are attached
 *
 * When HasClipActions is set the tag body continues after the MATRIX with:
 *   - UI16 (SWF ≤ 5) or UI32 (SWF ≥ 6): AllEventFlags
 *   - One or more CLIPACTION records:
 *       ClipEventFlags  UI32   — bitmask of events this handler fires on
 *       ActionRecordSize UI32  — byte length of the following bytecode
 *       ActionRecords   UI8[]  — AVM1 bytecode
 *       ActionEnd       UI8   — 0x00 terminator
 *   - Terminator: UI32 = 0
 *
 * ClipEventFlags bit positions (SWF spec 8.4.6.2):
 *   bit 0  = onLoad       (0x00000001)
 *   bit 1  = onEnterFrame (0x00000002)
 *   bit 2  = onUnload     (0x00000004)
 *   bit 3  = onMouseMove  (0x00000008)
 *   bit 4  = onMouseDown  (0x00000010)
 *   bit 5  = onMouseUp    (0x00000020)
 *   bit 6  = onKeyDown    (0x00000040)
 *   bit 7  = onKeyUp      (0x00000080)
 *   bit 8  = onData       (0x00000100)
 *   bit 9  = onInitialize (0x00000200)
 *   bit 10 = onPress      (0x00000400)
 *   bit 11 = onRelease    (0x00000800)
 *   bit 12 = onReleaseOutside (0x00001000)
 *   bit 13 = onRollOver   (0x00002000)
 *   bit 14 = onRollOut    (0x00004000)
 *   bit 15 = onDragOver   (0x00008000)
 *   bit 16 = onDragOut    (0x00010000)
 *   bit 17 = onKeyPress   (0x00020000)
 *   bit 18 = onConstruct  (0x00040000)
 *
 * Current implementation status (as of this writing):
 *   - SymbolInstance has no clipActions / instanceScript field in the model.
 *   - encodePlaceObject2 and its variants always emit the flags byte WITHOUT
 *     the HasClipActions bit set (verified by the tests below).
 *   - Clip-event support (onClipEvent / onEnterFrame wired to SWF export)
 *     is a future task; these tests document the baseline and will need to
 *     be updated when clip actions are wired.
 */

import { describe, it, expect } from "vitest";
import { encodePlaceObject2, encodePlaceObject2WithName } from "../shapes.js";
import { exportSWF } from "../export.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
  SymbolInstance,
} from "@flash/core";

// ---------------------------------------------------------------------------
// SWF binary helpers (reused from placeobject2.test.ts pattern)
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
  y: number
): SymbolInstance {
  return { id, type: "instance", symbolId, x, y };
}

function makeDoc(
  symbolId: string,
  symbolName: string,
  instance: SymbolInstance
): FlashDocument {
  const sym = makeSymbol(symbolId, symbolName);
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene([makeEmptyFrame([instance])])],
    library: { items: [sym], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Unit tests — encodePlaceObject2 flags byte (HasClipActions absent)
// ---------------------------------------------------------------------------

describe("PlaceObject2 clip actions — unit: flags byte HasClipActions absent", () => {
  it("encodePlaceObject2: flags byte is 0x06 (no HasClipActions bit)", () => {
    const body = encodePlaceObject2(1, 1, 0, 0);
    // bit 7 (0x80) must NOT be set; standard flags = 0x06
    expect(body[0]).toBe(0x06);
    expect(body[0]! & 0x80).toBe(0);
  });

  it("encodePlaceObject2WithName: flags byte has HasName (0x26) but no HasClipActions", () => {
    const body = encodePlaceObject2WithName(1, 1, 0, 0, "mc");
    expect(body[0]! & 0x80).toBe(0);
    // HasCharacter | HasMatrix | HasName = 0x26
    expect(body[0]).toBe(0x26);
  });

  it("HasClipActions bit (0x80) is not set for encodePlaceObject2 at non-zero position", () => {
    const body = encodePlaceObject2(3, 2, 100, 50);
    expect(body[0]! & 0x80).toBe(0);
  });

  it("HasClipActions flag value is 0x80 per SWF spec (documentation test)", () => {
    // The HasClipActions flag occupies bit 7 of the PlaceObject2 flags byte.
    // This constant documents the expected bit position for future implementation.
    const HasClipActions = 0x80;
    expect(HasClipActions).toBe(128);
    expect(HasClipActions >> 7).toBe(1); // bit 7
  });

  it("ClipEventFlags enterFrame bit is 0x00000002 per SWF spec (documentation test)", () => {
    // When HasClipActions is set, each CLIPACTION record carries ClipEventFlags.
    // These document the correct bit assignments for the future implementation.
    const ClipEventLoad       = 0x00000001;
    const ClipEventEnterFrame = 0x00000002;
    const ClipEventUnload     = 0x00000004;
    const ClipEventKeyDown    = 0x00000040;
    const ClipEventKeyPress   = 0x00020000;

    expect(ClipEventLoad).toBe(1);
    expect(ClipEventEnterFrame).toBe(2);
    expect(ClipEventUnload).toBe(4);
    expect(ClipEventKeyDown).toBe(64);
    expect(ClipEventKeyPress).toBe(131072);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — exportSWF produces PlaceObject2 without HasClipActions
// ---------------------------------------------------------------------------

describe("PlaceObject2 clip actions — integration: exportSWF baseline", () => {
  it("PlaceObject2 tag is emitted without error for a plain instance", () => {
    const inst = makeInstance("inst-1", "sym-1", 0, 0);
    const doc = makeDoc("sym-1", "MyClip", inst);
    expect(() => exportSWF(doc)).not.toThrow();
  });

  it("PlaceObject2 tag body flags byte does not have HasClipActions (0x80) set", () => {
    const inst = makeInstance("inst-1", "sym-1", 50, 50);
    const doc = makeDoc("sym-1", "MyClip", inst);
    const bytes = exportSWF(doc);
    const tags = parseSWFTags(bytes);

    // Collect all PlaceObject2 tags that have HasCharacter set (i.e. place new instances)
    const po2Tags = tags.filter(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2Tags.length).toBeGreaterThan(0);

    for (const tag of po2Tags) {
      expect(tag.body[0]! & 0x80).toBe(0); // HasClipActions must NOT be set
    }
  });

  it("PlaceObject2 tag body length is not extended by clip-action records", () => {
    // Without clip actions the tag body is: 1 (flags) + 2 (depth) + 2 (charId) + MATRIX bytes.
    // With clip actions it would include AllEventFlags + CLIPACTION records + UI32 terminator.
    // The minimal body (identity-scale, zero-translate MATRIX) should be short.
    const inst = makeInstance("inst-1", "sym-1", 0, 0);
    const doc = makeDoc("sym-1", "MyClip", inst);
    const bytes = exportSWF(doc);
    const tags = parseSWFTags(bytes);

    const po2Tag = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2Tag).toBeDefined();

    // A minimal PlaceObject2 without clip actions: 1+2+2+MATRIX ≥ 6 bytes.
    // With clip actions there would be at least 8 extra bytes.
    // Verify it is small (no extra records appended).
    expect(po2Tag!.body.length).toBeGreaterThanOrEqual(6);
    expect(po2Tag!.body.length).toBeLessThan(30); // sanity: no clip action payload
  });

  it("all PlaceObject2 tags in a document with multiple instances lack HasClipActions", () => {
    const inst1 = makeInstance("inst-1", "sym-1", 0, 0);
    const inst2 = makeInstance("inst-2", "sym-1", 100, 100);
    const sym = makeSymbol("sym-1", "MyClip");
    const doc: FlashDocument = {
      id: "doc-1",
      properties: BASE_PROPS,
      scenes: [makeScene([makeEmptyFrame([inst1, inst2])])],
      library: { items: [sym], folders: [] },
    };

    const bytes = exportSWF(doc);
    const tags = parseSWFTags(bytes);
    const po2Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);

    expect(po2Tags.length).toBeGreaterThanOrEqual(2);
    for (const tag of po2Tags) {
      expect(tag.body[0]! & 0x80).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Gap documentation — clip actions not yet wired in the model
// ---------------------------------------------------------------------------

describe("PlaceObject2 clip actions — gap documentation", () => {
  it("SymbolInstance does not have a clipActions field (feature not yet implemented)", () => {
    // SymbolInstance currently has: id, type, symbolId, x, y, scaleX, scaleY,
    // rotation, skewX, skewY, alpha, instanceName, colorEffect, filters,
    // loopMode, firstFrame, blendMode.
    // There is no clipActions / instanceScript field.
    // When this feature is added, SymbolInstance should gain a clipActions array
    // and compile.ts / sprite.ts should use encodePlaceObject2WithClipActions.
    const inst: SymbolInstance = makeInstance("inst-1", "sym-1", 0, 0);
    expect((inst as unknown as Record<string, unknown>)["clipActions"]).toBeUndefined();
  });

  it("encodePlaceObject2 does not accept a clip-actions parameter (API gap)", () => {
    // encodePlaceObject2 signature: (charId, depth, x, y, transform?) → Uint8Array
    // There is no overload / variant that accepts clip-action records.
    // A future encodePlaceObject2WithClipActions function will be needed.
    const body = encodePlaceObject2(1, 1, 0, 0);
    expect(body).toBeInstanceOf(Uint8Array);
    // Flags byte: 0x06 confirms no optional fields beyond charId + matrix
    expect(body[0]).toBe(0x06);
  });
});
