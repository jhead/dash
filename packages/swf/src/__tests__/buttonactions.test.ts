/**
 * Tests for DefineButton2 BUTTONCONDACTION encoding.
 *
 * Verifies that button symbols with event scripts (on(press){}, on(release){}, etc.)
 * compile to valid SWF DefineButton2 tags with properly encoded BUTTONCONDACTION records.
 *
 * SWF spec §12.14: BUTTONCONDACTION
 *   UI16  CondActionSize   — offset to next record (0 for last)
 *   UI16  ConditionBits    — event bitmask
 *   ACTIONRECORD[]         — AVM1 bytecode terminated by EndAction (0x00)
 *
 * Condition bits:
 *   bit 0: release          (overDownToIdle)
 *   bit 1: press            (idleToOverDown)
 *   bit 2: dragOut          (overDownToOutDown)
 *   bit 3: dragOver         (outDownToOverDown)
 *   bit 4: releaseOutside   (outDownToIdle)
 *   bit 5: rollOut          (overUpToIdle)
 *   bit 6: rollOver         (overUpToOverDown)
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  ButtonAction,
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_DEFINE_BUTTON2 = 34;
const TAG_END = 0;

// ---------------------------------------------------------------------------
// SWF parser helpers
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
    if (tagCode === TAG_END) break;
  }
  return tags;
}

/** Read a little-endian UI16 from a Uint8Array at the given offset. */
function readUI16LE(buf: Uint8Array, offset: number): number {
  return (buf[offset] | (buf[offset + 1] << 8)) >>> 0;
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

const BASE_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

function makeFrame(index: number, overrides: Partial<Frame> = {}): Frame {
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
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects: [],
    ...overrides,
  };
}

function makeLayer(id: string, frames: Frame[]): Layer {
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
    frameCount: frames.length,
  };
}

function makeEmptyScene(): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: {
      layers: [
        makeLayer("layer-1", [
          makeFrame(0, { isEmpty: true }),
        ]),
      ],
    },
  };
}

/**
 * Build a button symbol with optional buttonActions.
 */
function makeButtonSymbol(
  id: string,
  buttonActions?: readonly ButtonAction[]
): Symbol {
  return {
    id,
    name: `Button_${id}`,
    itemType: "symbol",
    symbolType: "button",
    timeline: {
      layers: [
        makeLayer(`${id}-layer`, [
          makeFrame(0, { isEmpty: true }),
        ]),
      ],
    },
    linkage: BASE_LINKAGE,
    scale9Grid: null,
    buttonActions,
  };
}

function makeDoc(symbols: Symbol[]): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeEmptyScene()],
    library: {
      items: symbols,
      folders: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: parse DefineButton2 body into its component parts
// ---------------------------------------------------------------------------

interface ParsedButton2 {
  buttonId: number;
  trackAsMenu: number;
  actionOffset: number;
  /** Raw bytes from ActionOffset field position to BUTTONCONDACTION start (= ButtonRecords + null) */
  buttonRecordsAndTerminator: Uint8Array;
  /** All BUTTONCONDACTION records as raw bytes */
  condActionBytes: Uint8Array;
}

function parseButton2Body(body: Uint8Array): ParsedButton2 {
  const buttonId = readUI16LE(body, 0);      // [0..1]
  const trackAsMenu = body[2];               // [2]
  const actionOffset = readUI16LE(body, 3);  // [3..4]

  // ButtonRecords extend from offset 5 to the null terminator (0x00 state-flags byte)
  // then BUTTONCONDACTION starts at: 3 (ActionOffset pos) + actionOffset
  let buttonRecordsEnd = 5;
  while (buttonRecordsEnd < body.length && body[buttonRecordsEnd] !== 0x00) {
    // Skip a ButtonRecord: flags(1) + charId(2) + depth(2) + matrix(?) + cxform(?)
    // Each ButtonRecord starts with a non-zero flags byte, but we can just find
    // the null terminator by scanning (flags=0x00 means end of ButtonRecords).
    buttonRecordsEnd++;
  }
  // buttonRecordsEnd is the position of the null terminator
  buttonRecordsEnd++; // include the null terminator byte

  const buttonRecordsAndTerminator = body.slice(5, buttonRecordsEnd);

  // BUTTONCONDACTION starts right after the null terminator
  const condActionBytes =
    actionOffset > 0 ? body.slice(buttonRecordsEnd) : new Uint8Array(0);

  return {
    buttonId,
    trackAsMenu,
    actionOffset,
    buttonRecordsAndTerminator,
    condActionBytes,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineButton2 — button action encoding", () => {
  // ---------------------------------------------------------------------------
  // Test 1: button with on(press){ trace("clicked"); } compiles to tag 34
  // ---------------------------------------------------------------------------
  it("1: button symbol with on(press) script compiles to DefineButton2 (tag 34)", () => {
    const btn = makeButtonSymbol("btn1", [
      { event: "press", script: 'trace("clicked");' },
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Test 2: button with on(press) has non-zero ActionOffset
  // ---------------------------------------------------------------------------
  it("2: button with on(press) script has non-zero ActionOffset in tag body", () => {
    const btn = makeButtonSymbol("btn2", [
      { event: "press", script: 'trace("clicked");' },
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);

    const parsed = parseButton2Body(btn2Tags[0].body);
    expect(parsed.actionOffset).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Test 3: button with on(press) has non-empty condition byte stream
  // ---------------------------------------------------------------------------
  it("3: button with on(press) script has non-empty BUTTONCONDACTION byte stream", () => {
    const btn = makeButtonSymbol("btn3", [
      { event: "press", script: 'trace("clicked");' },
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    const parsed = parseButton2Body(btn2Tags[0].body);
    expect(parsed.condActionBytes.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Test 4: button without any actions still compiles (ActionOffset=0 is valid)
  // ---------------------------------------------------------------------------
  it("4: button without actions compiles successfully with ActionOffset=0", () => {
    const btn = makeButtonSymbol("btn4", undefined);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);

    const parsed = parseButton2Body(btn2Tags[0].body);
    expect(parsed.actionOffset).toBe(0);
    expect(parsed.condActionBytes.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 5: on(press) condition bits = 0x0002 (idleToOverDown)
  // ---------------------------------------------------------------------------
  it("5: on(press) handler encodes ConditionBits = 0x0002 (bit 1 = idleToOverDown)", () => {
    const btn = makeButtonSymbol("btn5", [
      { event: "press", script: 'trace("press");' },
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    const parsed = parseButton2Body(btn2Tags[0].body);

    // First BUTTONCONDACTION: [0..1]=CondActionSize, [2..3]=ConditionBits
    expect(parsed.condActionBytes.length).toBeGreaterThanOrEqual(4);
    const condBits = readUI16LE(parsed.condActionBytes, 2);
    expect(condBits).toBe(0x0002); // bit 1: press
  });

  // ---------------------------------------------------------------------------
  // Test 6: on(release) condition bits = 0x0001 (overDownToIdle)
  // ---------------------------------------------------------------------------
  it("6: on(release) handler encodes ConditionBits = 0x0001 (bit 0 = overDownToIdle)", () => {
    const btn = makeButtonSymbol("btn6", [
      { event: "release", script: 'trace("release");' },
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    const parsed = parseButton2Body(btn2Tags[0].body);

    expect(parsed.condActionBytes.length).toBeGreaterThanOrEqual(4);
    const condBits = readUI16LE(parsed.condActionBytes, 2);
    expect(condBits).toBe(0x0001); // bit 0: release
  });

  // ---------------------------------------------------------------------------
  // Test 7: multiple button events each get their own BUTTONCONDACTION record
  // ---------------------------------------------------------------------------
  it("7: multiple button events (press + release) each get their own BUTTONCONDACTION", () => {
    const btn = makeButtonSymbol("btn7", [
      { event: "press",   script: 'trace("press");' },
      { event: "release", script: 'trace("release");' },
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    const parsed = parseButton2Body(btn2Tags[0].body);

    // We should have at least 2 BUTTONCONDACTION records (each = 4+ bytes)
    expect(parsed.condActionBytes.length).toBeGreaterThanOrEqual(8);

    // First record: CondActionSize > 0 (points to next record)
    const firstCondActionSize = readUI16LE(parsed.condActionBytes, 0);
    expect(firstCondActionSize).toBeGreaterThan(0);

    // Parse the two records
    const firstCondBits = readUI16LE(parsed.condActionBytes, 2);
    const secondOffset = firstCondActionSize; // offset from start of first record
    const secondCondBits = readUI16LE(parsed.condActionBytes, secondOffset + 2);
    const secondCondActionSize = readUI16LE(parsed.condActionBytes, secondOffset);

    // Last record has CondActionSize = 0
    expect(secondCondActionSize).toBe(0);

    // One record has press bit (0x0002) and one has release bit (0x0001)
    const condBitsSet = new Set([firstCondBits, secondCondBits]);
    expect(condBitsSet.has(0x0002)).toBe(true); // press
    expect(condBitsSet.has(0x0001)).toBe(true); // release
  });

  // ---------------------------------------------------------------------------
  // Test 8: button with empty script array produces ActionOffset=0
  // ---------------------------------------------------------------------------
  it("8: button with empty buttonActions array produces ActionOffset=0", () => {
    const btn = makeButtonSymbol("btn8", []);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    const parsed = parseButton2Body(btn2Tags[0].body);
    expect(parsed.actionOffset).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 9: ActionOffset correctly accounts for ButtonRecords size
  // ---------------------------------------------------------------------------
  it("9: ActionOffset field value = 2 + sizeof(ButtonRecords+null) when conditions present", () => {
    const btn = makeButtonSymbol("btn9", [
      { event: "press", script: 'trace("p");' },
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    const parsed = parseButton2Body(btn2Tags[0].body);

    // ActionOffset = 2 (ActionOffset field size) + buttonRecordsAndTerminator.length
    const expectedOffset = 2 + parsed.buttonRecordsAndTerminator.length;
    expect(parsed.actionOffset).toBe(expectedOffset);
  });

  // ---------------------------------------------------------------------------
  // Test 10: rollOver and rollOut events use correct condition bits
  // ---------------------------------------------------------------------------
  it("10: on(rollOver) encodes ConditionBits = 0x0040 (bit 6)", () => {
    const btn = makeButtonSymbol("btn10", [
      { event: "rollOver", script: 'trace("over");' },
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    const parsed = parseButton2Body(btn2Tags[0].body);
    const condBits = readUI16LE(parsed.condActionBytes, 2);
    expect(condBits).toBe(0x0040); // bit 6: rollOver
  });

  it("10b: on(rollOut) encodes ConditionBits = 0x0020 (bit 5)", () => {
    const btn = makeButtonSymbol("btn10b", [
      { event: "rollOut", script: 'trace("out");' },
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    const parsed = parseButton2Body(btn2Tags[0].body);
    const condBits = readUI16LE(parsed.condActionBytes, 2);
    expect(condBits).toBe(0x0020); // bit 5: rollOut
  });
});

// ---------------------------------------------------------------------------
// Instance-level buttonHandlers tests
// ---------------------------------------------------------------------------

import type { ButtonHandler, Scene } from "@flash/core";

/**
 * Build a scene that places a button instance with optional buttonHandlers.
 */
function makeSceneWithButtonInstance(
  symbolId: string,
  buttonHandlers?: readonly ButtonHandler[]
): Scene {
  const instance = {
    id: "inst-1",
    type: "instance" as const,
    symbolId,
    x: 10,
    y: 10,
    ...(buttonHandlers && buttonHandlers.length > 0 ? { buttonHandlers } : {}),
  };
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: {
      layers: [
        {
          id: "layer-1",
          name: "layer-1",
          type: "normal" as const,
          visible: true,
          locked: false,
          outlineMode: false,
          outlineColor: "#ff0000",
          height: 20,
          parentFolderId: null,
          frames: [
            {
              index: 0,
              isKeyframe: true,
              isEmpty: false,
              tweenType: "none" as const,
              label: "",
              labelType: "name" as const,
              script: "",
              sound: null,
              motionEase: 0,
              motionRotate: "none" as const,
              motionRotateCount: 0,
              motionOrientToPath: false,
              motionSync: false,
              motionScale: false,
              shapeEase: 0,
              shapeBlend: "distributive" as const,
              displayObjects: [instance],
            },
          ],
          frameCount: 1,
        },
      ],
    },
  };
}

describe("DefineButton2 — instance-level buttonHandlers", () => {
  // ---------------------------------------------------------------------------
  // Test A: button instance with buttonHandlers emits TWO DefineButton2 tags
  // ---------------------------------------------------------------------------
  it("A: button instance with buttonHandlers emits a second DefineButton2 for the instance", () => {
    const btn = makeButtonSymbol("btn-ih-A");
    const scene = makeSceneWithButtonInstance("btn-ih-A", [
      { event: "release", script: 'gotoAndStop(2);' },
    ]);
    const doc = {
      id: "doc-ih-A",
      properties: {
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
      },
      scenes: [scene],
      library: { items: [btn], folders: [] },
    };
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // Symbol-level DefineButton2 + instance-level DefineButton2 = 2 total
    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Test B: the instance-level DefineButton2 carries the on(release) handler
  // ---------------------------------------------------------------------------
  it("B: the second DefineButton2 carries the instance on(release) BUTTONCONDACTION", () => {
    const btn = makeButtonSymbol("btn-ih-B");
    const scene = makeSceneWithButtonInstance("btn-ih-B", [
      { event: "release", script: 'stop();' },
    ]);
    const doc = {
      id: "doc-ih-B",
      properties: {
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
      },
      scenes: [scene],
      library: { items: [btn], folders: [] },
    };
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    // Second tag is the instance-level one
    const instParsed = parseButton2Body(btn2Tags[1].body);
    // ActionOffset > 0 means BUTTONCONDACTION records are present
    expect(instParsed.actionOffset).toBeGreaterThan(0);
    // First BUTTONCONDACTION: ConditionBits bit 0 = release
    const condBits = readUI16LE(instParsed.condActionBytes, 2);
    expect(condBits & 0x0001).toBe(1); // bit 0: release
  });

  // ---------------------------------------------------------------------------
  // Test C: PlaceObject2 references the instance-level char ID (not the symbol)
  // ---------------------------------------------------------------------------
  it("C: PlaceObject2 references the instance-level DefineButton2 char ID", () => {
    const btn = makeButtonSymbol("btn-ih-C");
    const scene = makeSceneWithButtonInstance("btn-ih-C", [
      { event: "press", script: 'play();' },
    ]);
    const doc = {
      id: "doc-ih-C",
      properties: {
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
      },
      scenes: [scene],
      library: { items: [btn], folders: [] },
    };
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    // The instance-level DefineButton2 is the second one
    const instCharId = readUI16LE(btn2Tags[1].body, 0);

    // Find PlaceObject2 that references the instance char ID
    const TAG_PLACE_OBJECT2 = 26;
    const place2Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    const foundPlace = place2Tags.some((tag) => {
      const flags = tag.body[0];
      const hasCharacter = (flags & 0x02) !== 0;
      if (!hasCharacter) return false;
      const cid = tag.body[3] | (tag.body[4] << 8);
      return cid === instCharId;
    });
    expect(foundPlace).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test D: button instance without buttonHandlers still emits only one DefineButton2
  // ---------------------------------------------------------------------------
  it("D: button instance without buttonHandlers emits only one DefineButton2", () => {
    const btn = makeButtonSymbol("btn-ih-D");
    const scene = makeSceneWithButtonInstance("btn-ih-D"); // no handlers
    const doc = {
      id: "doc-ih-D",
      properties: {
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
      },
      scenes: [scene],
      library: { items: [btn], folders: [] },
    };
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);
  });
});
