/**
 * Tests for DefineButton2 on(keyPress) event — model type, FLA import,
 * and SWF ConditionBits encoding.
 *
 * SWF spec §12.14 BUTTONCONDACTION ConditionBits:
 *   bits 9-15: keyPress key code (0 = no key press condition)
 *   keyCode << 9 encodes the key in the upper 7 bits of the UI16.
 *
 * Key codes (from Ruffle ButtonKeyCode enum):
 *   Left=1, Right=2, Home=3, End=4, Insert=5, Delete=6, Backspace=8,
 *   Return/Enter=13, Up=14, Down=15, PgUp=16, PgDown=17, Tab=18, Escape=19,
 *   Space=32, printable ASCII chars use their code (a=97, A=65, etc.)
 */

import { describe, it, expect } from "vitest";
import { parseButtonHandlers } from "@flash/core";
import { compileDocument } from "../compile.js";
import type { ButtonHandler, FlashDocument, Frame, Layer, Scene, Symbol } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag parsing helpers (identical to buttonactions.test.ts)
// ---------------------------------------------------------------------------

const TAG_DEFINE_BUTTON2 = 34;
const TAG_END = 0;

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

function readUI16LE(buf: Uint8Array, offset: number): number {
  return (buf[offset] | (buf[offset + 1] << 8)) >>> 0;
}

// ---------------------------------------------------------------------------
// Document / symbol factory helpers
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: "#ffffff",
  rulerUnits: "px" as const,
  grid: { showGrid: false, snapToGrid: false, gridColor: "#999999", gridWidth: 18, gridHeight: 18 },
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

function makeButtonSymbolWithHandlers(
  id: string,
  buttonHandlers?: readonly ButtonHandler[]
): Symbol {
  return {
    id,
    name: `Btn_${id}`,
    itemType: "symbol",
    symbolType: "button",
    timeline: {
      layers: [makeLayer(`${id}-layer`, [makeFrame(0, { isEmpty: true })])],
    },
    linkage: BASE_LINKAGE,
    scale9Grid: null,
    buttonActions: buttonHandlers as any, // ButtonAction and ButtonHandler share the same event union
  };
}

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
        makeLayer("layer-1", [makeFrame(0, { displayObjects: [instance] })]),
      ],
    },
  };
}

function makeDoc(symbols: Symbol[], scene?: Scene): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [scene ?? {
      id: "scene-1",
      name: "Scene 1",
      timeline: { layers: [makeLayer("layer-1", [makeFrame(0, { isEmpty: true })])] },
    }],
    library: { items: symbols, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Helper: extract ConditionBits from the first BUTTONCONDACTION record
// ---------------------------------------------------------------------------

interface ParsedButton2 {
  actionOffset: number;
  condActionBytes: Uint8Array;
}

function parseButton2Body(body: Uint8Array): ParsedButton2 {
  const actionOffset = readUI16LE(body, 3); // [3..4]
  // Find null terminator of ButtonRecords (flags byte = 0x00 terminates list)
  let buttonRecordsEnd = 5;
  while (buttonRecordsEnd < body.length && body[buttonRecordsEnd] !== 0x00) {
    buttonRecordsEnd++;
  }
  buttonRecordsEnd++; // include null terminator
  const condActionBytes = actionOffset > 0 ? body.slice(buttonRecordsEnd) : new Uint8Array(0);
  return { actionOffset, condActionBytes };
}

// ---------------------------------------------------------------------------
// Part 1: parseButtonHandlers — FLA import tests
// ---------------------------------------------------------------------------

describe("parseButtonHandlers — keyPress event parsing", () => {
  it("parses on(keyPress 'a') into { keyPress: 'a' }", () => {
    const handlers = parseButtonHandlers(`on(keyPress 'a') { trace("a"); }`);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]!.event).toEqual({ keyPress: "a" });
    expect(handlers[0]!.script).toBe(`trace("a");`);
  });

  it("parses on(keyPress \"a\") with double quotes", () => {
    const handlers = parseButtonHandlers(`on(keyPress "a") { trace("a"); }`);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]!.event).toEqual({ keyPress: "a" });
  });

  it("parses on(keyPress '<Left>') into { keyPress: '<Left>' }", () => {
    const handlers = parseButtonHandlers(`on(keyPress '<Left>') { _x -= 5; }`);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]!.event).toEqual({ keyPress: "<Left>" });
  });

  it("parses on(keyPress '<Enter>') into { keyPress: '<Enter>' }", () => {
    const handlers = parseButtonHandlers(`on(keyPress '<Enter>') { gotoAndStop(2); }`);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]!.event).toEqual({ keyPress: "<Enter>" });
  });

  it("parses on(keyPress '<Escape>') into { keyPress: '<Escape>' }", () => {
    const handlers = parseButtonHandlers(`on(keyPress '<Escape>') { stop(); }`);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]!.event).toEqual({ keyPress: "<Escape>" });
  });

  it("parses multiple keyPress handlers independently", () => {
    const src = `
      on(keyPress '<Left>') { _x -= 5; }
      on(keyPress '<Right>') { _x += 5; }
    `;
    const handlers = parseButtonHandlers(src);
    expect(handlers).toHaveLength(2);
    expect(handlers[0]!.event).toEqual({ keyPress: "<Left>" });
    expect(handlers[1]!.event).toEqual({ keyPress: "<Right>" });
  });

  it("parses a mix of keyPress and regular events", () => {
    const src = `
      on(release) { stop(); }
      on(keyPress '<Enter>') { gotoAndPlay(2); }
    `;
    const handlers = parseButtonHandlers(src);
    expect(handlers).toHaveLength(2);
    expect(handlers[0]!.event).toBe("release");
    expect(handlers[1]!.event).toEqual({ keyPress: "<Enter>" });
  });
});

// ---------------------------------------------------------------------------
// Part 2: SWF ConditionBits encoding
// ---------------------------------------------------------------------------

describe("DefineButton2 — keyPress ConditionBits encoding", () => {
  it("on(keyPress 'a') encodes ConditionBits = 97 << 9 (ASCII 'a')", () => {
    const btn = makeButtonSymbolWithHandlers("kp-a", [
      { event: { keyPress: "a" }, script: 'trace("a");' },
    ]);
    const swf = compileDocument(makeDoc([btn]));
    const tags = parseTags(swf);
    const btn2 = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2.length).toBe(1);
    const { condActionBytes } = parseButton2Body(btn2[0]!.body);
    expect(condActionBytes.length).toBeGreaterThanOrEqual(4);
    const condBits = readUI16LE(condActionBytes, 2);
    expect(condBits).toBe(97 << 9); // 'a' = 97
  });

  it("on(keyPress '<Left>') encodes ConditionBits = 1 << 9", () => {
    const btn = makeButtonSymbolWithHandlers("kp-left", [
      { event: { keyPress: "<Left>" }, script: '_x -= 5;' },
    ]);
    const swf = compileDocument(makeDoc([btn]));
    const tags = parseTags(swf);
    const { condActionBytes } = parseButton2Body(
      tags.filter((t) => t.code === TAG_DEFINE_BUTTON2)[0]!.body
    );
    const condBits = readUI16LE(condActionBytes, 2);
    expect(condBits).toBe(1 << 9); // Left = 1
  });

  it("on(keyPress '<Right>') encodes ConditionBits = 2 << 9", () => {
    const btn = makeButtonSymbolWithHandlers("kp-right", [
      { event: { keyPress: "<Right>" }, script: '_x += 5;' },
    ]);
    const swf = compileDocument(makeDoc([btn]));
    const tags = parseTags(swf);
    const { condActionBytes } = parseButton2Body(
      tags.filter((t) => t.code === TAG_DEFINE_BUTTON2)[0]!.body
    );
    const condBits = readUI16LE(condActionBytes, 2);
    expect(condBits).toBe(2 << 9); // Right = 2
  });

  it("on(keyPress '<Enter>') encodes ConditionBits = 13 << 9", () => {
    const btn = makeButtonSymbolWithHandlers("kp-enter", [
      { event: { keyPress: "<Enter>" }, script: 'gotoAndStop(2);' },
    ]);
    const swf = compileDocument(makeDoc([btn]));
    const tags = parseTags(swf);
    const { condActionBytes } = parseButton2Body(
      tags.filter((t) => t.code === TAG_DEFINE_BUTTON2)[0]!.body
    );
    const condBits = readUI16LE(condActionBytes, 2);
    expect(condBits).toBe(13 << 9); // Enter = 13
  });

  it("on(keyPress '<Escape>') encodes ConditionBits = 19 << 9", () => {
    const btn = makeButtonSymbolWithHandlers("kp-esc", [
      { event: { keyPress: "<Escape>" }, script: 'stop();' },
    ]);
    const swf = compileDocument(makeDoc([btn]));
    const tags = parseTags(swf);
    const { condActionBytes } = parseButton2Body(
      tags.filter((t) => t.code === TAG_DEFINE_BUTTON2)[0]!.body
    );
    const condBits = readUI16LE(condActionBytes, 2);
    expect(condBits).toBe(19 << 9); // Escape = 19
  });

  it("on(keyPress '<Space>') encodes ConditionBits = 32 << 9", () => {
    const btn = makeButtonSymbolWithHandlers("kp-space", [
      { event: { keyPress: "<Space>" }, script: 'play();' },
    ]);
    const swf = compileDocument(makeDoc([btn]));
    const tags = parseTags(swf);
    const { condActionBytes } = parseButton2Body(
      tags.filter((t) => t.code === TAG_DEFINE_BUTTON2)[0]!.body
    );
    const condBits = readUI16LE(condActionBytes, 2);
    expect(condBits).toBe(32 << 9); // Space = 32
  });

  it("on(keyPress 'A') encodes ConditionBits = 65 << 9 (uppercase ASCII)", () => {
    const btn = makeButtonSymbolWithHandlers("kp-A", [
      { event: { keyPress: "A" }, script: 'trace("A");' },
    ]);
    const swf = compileDocument(makeDoc([btn]));
    const tags = parseTags(swf);
    const { condActionBytes } = parseButton2Body(
      tags.filter((t) => t.code === TAG_DEFINE_BUTTON2)[0]!.body
    );
    const condBits = readUI16LE(condActionBytes, 2);
    expect(condBits).toBe(65 << 9); // 'A' = 65
  });

  it("multiple keyPress handlers get separate BUTTONCONDACTION records with correct codes", () => {
    const btn = makeButtonSymbolWithHandlers("kp-multi", [
      { event: { keyPress: "<Left>" },  script: '_x -= 5;' },
      { event: { keyPress: "<Right>" }, script: '_x += 5;' },
    ]);
    const swf = compileDocument(makeDoc([btn]));
    const tags = parseTags(swf);
    const { condActionBytes } = parseButton2Body(
      tags.filter((t) => t.code === TAG_DEFINE_BUTTON2)[0]!.body
    );
    // Two records: first has non-zero CondActionSize, second has 0
    expect(condActionBytes.length).toBeGreaterThanOrEqual(8);
    const firstCondActionSize = readUI16LE(condActionBytes, 0);
    expect(firstCondActionSize).toBeGreaterThan(0);
    const firstCondBits  = readUI16LE(condActionBytes, 2);
    const secondCondBits = readUI16LE(condActionBytes, firstCondActionSize + 2);
    const codes = new Set([firstCondBits, secondCondBits]);
    expect(codes.has(1 << 9)).toBe(true);  // Left = 1
    expect(codes.has(2 << 9)).toBe(true);  // Right = 2
  });

  it("instance-level buttonHandlers with keyPress produces correct ConditionBits", () => {
    const btn = makeButtonSymbolWithHandlers("kp-inst");
    const scene = makeSceneWithButtonInstance("kp-inst", [
      { event: { keyPress: "<Enter>" }, script: 'gotoAndStop(2);' },
    ]);
    const swf = compileDocument(makeDoc([btn], scene));
    const tags = parseTags(swf);
    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    // Symbol + instance-level = 2 DefineButton2 tags
    expect(btn2Tags.length).toBe(2);
    const { condActionBytes } = parseButton2Body(btn2Tags[1]!.body);
    const condBits = readUI16LE(condActionBytes, 2);
    expect(condBits).toBe(13 << 9); // Enter = 13
  });
});
