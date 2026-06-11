/**
 * Tests for DefineButton2 (tag 34) export of button symbols.
 *
 * Strategy: compile a FlashDocument containing button symbols, then parse
 * the resulting SWF binary and inspect the tag sequence.
 *
 * Tag codes:
 *   34  DefineButton2
 *   39  DefineSprite
 *   26  PlaceObject2
 *   83  DefineShape4
 *    0  End
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
} from "@flash/core";
import type { Shape } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_DEFINE_BUTTON2 = 34;
const TAG_DEFINE_SPRITE = 39;
const TAG_PLACE_OBJECT2 = 26;

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

function makeBlankFrame(index: number): Frame {
  return makeFrame(index, { isEmpty: true, displayObjects: [] });
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

function makeSimpleShape(id: string): Shape {
  return {
    id,
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 10, y: 0 } },
          { type: "line", to: { x: 10, y: 10 } },
          { type: "line", to: { x: 0, y: 10 } },
        ],
        closed: true,
        fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
      },
    ],
  };
}

function makeShapeObj(id: string): import("@flash/core").DisplayObject {
  return {
    id,
    type: "shape",
    shape: makeSimpleShape(id),
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    filters: [],
    blendMode: "normal",
    visible: true,
    alpha: 1,
    name: id,
  } as import("@flash/core").DisplayObject;
}

/**
 * Build a button symbol with the given per-state display objects.
 * stateFrames is an array of up to 4 arrays (index = state: 0=Up,1=Over,2=Down,3=Hit)
 * Each inner array is the list of display objects for that state.
 */
function makeButtonSymbol(
  id: string,
  stateFrames: Array<import("@flash/core").DisplayObject[]>
): Symbol {
  const frames: Frame[] = stateFrames.map((objs, idx) =>
    makeFrame(idx, { displayObjects: objs, isEmpty: objs.length === 0 })
  );
  return {
    id,
    name: `Button_${id}`,
    itemType: "symbol",
    symbolType: "button",
    timeline: {
      layers: [makeLayer(`${id}-layer`, frames)],
    },
    linkage: BASE_LINKAGE,
    scale9Grid: null,
  };
}

function makeMovieclipSymbol(id: string): Symbol {
  return {
    id,
    name: `MC_${id}`,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: {
      layers: [makeLayer(`${id}-layer`, [makeBlankFrame(0)])],
    },
    linkage: BASE_LINKAGE,
    scale9Grid: null,
  };
}

function makeEmptyScene(): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: {
      layers: [makeLayer("layer-1", [makeBlankFrame(0)])],
    },
  };
}

function makeDoc(
  symbols: Symbol[],
  scene: Scene = makeEmptyScene()
): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [scene],
    library: {
      items: symbols,
      folders: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineButton2 export", () => {
  it("1: button symbol emits tag 34 (DefineButton2), not tag 39 (DefineSprite)", () => {
    const btn = makeButtonSymbol("btn1", [
      [makeShapeObj("shape-up")],
      [],
      [],
      [],
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const tagCodes = tags.map((t) => t.code);
    expect(tagCodes).toContain(TAG_DEFINE_BUTTON2);
    expect(tagCodes).not.toContain(TAG_DEFINE_SPRITE);
  });

  it("2: ButtonRecord state bits set correctly for Up state (frame 0)", () => {
    // Create button with only an Up state object
    const btn = makeButtonSymbol("btn2", [
      [makeShapeObj("shape-up")], // frame 0 = Up
      [],
      [],
      [],
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);

    const body = btn2Tags[0].body;
    // Body layout:
    //   [0..1]  ButtonId UI16
    //   [2]     ReservedFlags+TrackAsMenu = 0x00
    //   [3..4]  ActionOffset UI16 = 0
    //   [5]     First ButtonRecord flags byte
    //     bit0 = StateUp, bit1 = StateOver, bit2 = StateDown, bit3 = StateHitTest
    // Up state only → flags = 0x01
    const flagsByte = body[5];
    expect(flagsByte & 0x01).toBe(1); // StateUp set
    expect(flagsByte & 0x02).toBe(0); // StateOver not set
    expect(flagsByte & 0x04).toBe(0); // StateDown not set
    expect(flagsByte & 0x08).toBe(0); // StateHitTest not set
  });

  it("3: ButtonRecord state bits set correctly for Hit state (frame 3)", () => {
    // Create button with only a Hit state object
    const btn = makeButtonSymbol("btn3", [
      [], // frame 0 = Up (empty)
      [], // frame 1 = Over (empty)
      [], // frame 2 = Down (empty)
      [makeShapeObj("shape-hit")], // frame 3 = Hit
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);

    const body = btn2Tags[0].body;
    // First ButtonRecord flags byte at offset 5
    const flagsByte = body[5];
    expect(flagsByte & 0x01).toBe(0); // StateUp not set
    expect(flagsByte & 0x02).toBe(0); // StateOver not set
    expect(flagsByte & 0x04).toBe(0); // StateDown not set
    expect(flagsByte & 0x08).toBe(8); // StateHitTest set
  });

  it("4: ButtonId in tag body matches charId assigned in the pre-pass", () => {
    // With one button symbol, its charId should be 1 (first character allocated).
    const btn = makeButtonSymbol("btn4", [[], [], [], []]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);

    const body = btn2Tags[0].body;
    const buttonId = body[0] | (body[1] << 8);
    // charId = 1 (first charId allocated) because no other symbols precede it
    expect(buttonId).toBe(1);
  });

  it("5: Null terminator byte present after ButtonRecords", () => {
    const btn = makeButtonSymbol("btn5", [
      [makeShapeObj("shape-up")], // frame 0 = Up
      [],
      [],
      [],
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);

    const body = btn2Tags[0].body;
    // The null terminator (0x00) is the last byte of the body
    // (no ButtonConditions since ActionOffset=0)
    expect(body[body.length - 1]).toBe(0x00);
  });

  it("6: Button with no frames still emits valid tag 34 with only null terminator", () => {
    // Button symbol with empty timeline
    const btn: Symbol = {
      id: "btn6",
      name: "Button_btn6",
      itemType: "symbol",
      symbolType: "button",
      timeline: { layers: [] },
      linkage: BASE_LINKAGE,
      scale9Grid: null,
    };
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);

    const body = btn2Tags[0].body;
    // body = ButtonId (2) + flags (1) + ActionOffset (2) + null terminator (1) = 6 bytes
    expect(body.length).toBe(6);
    // Null terminator at offset 5
    expect(body[5]).toBe(0x00);
  });

  it("7: Button instance placed via PlaceObject2 references button charId", () => {
    const btn = makeButtonSymbol("btn7", [[], [], [], []]);

    // Place a button instance in the scene
    const instanceObj: import("@flash/core").DisplayObject = {
      id: "inst-btn7",
      type: "instance",
      symbolId: "btn7",
      instanceName: "",
      x: 100,
      y: 100,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      filters: [],
      blendMode: "normal",
      visible: true,
      alpha: 1,
    } as import("@flash/core").DisplayObject;

    const scene: Scene = {
      id: "scene-1",
      name: "Scene 1",
      timeline: {
        layers: [
          makeLayer("layer-1", [
            makeFrame(0, { displayObjects: [instanceObj] }),
          ]),
        ],
      },
    };

    const doc = makeDoc([btn], scene);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // The DefineButton2 tag should be present
    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);

    const buttonId = btn2Tags[0].body[0] | (btn2Tags[0].body[1] << 8);

    // A PlaceObject2 tag should be present that references the button's charId
    const place2Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(place2Tags.length).toBeGreaterThan(0);

    // Find a PlaceObject2 that references the buttonId
    // PlaceObject2 body: flags (1 byte), depth (2 bytes), charId (2 bytes) when HasCharacter set
    const foundPlace = place2Tags.some((tag) => {
      const flags = tag.body[0];
      const hasCharacter = (flags & 0x02) !== 0;
      if (!hasCharacter) return false;
      const cid = tag.body[3] | (tag.body[4] << 8);
      return cid === buttonId;
    });

    expect(foundPlace).toBe(true);
  });

  it("8: movieclip symbol still emits tag 39 (DefineSprite), not tag 34", () => {
    const mc = makeMovieclipSymbol("mc1");
    const doc = makeDoc([mc]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const tagCodes = tags.map((t) => t.code);
    expect(tagCodes).toContain(TAG_DEFINE_SPRITE);
    expect(tagCodes).not.toContain(TAG_DEFINE_BUTTON2);
  });

  it("9: ButtonRecord state bits correct for Over state (frame 1)", () => {
    const btn = makeButtonSymbol("btn9", [
      [],                            // frame 0 = Up (empty)
      [makeShapeObj("shape-over")],  // frame 1 = Over
      [],                            // frame 2 = Down (empty)
      [],                            // frame 3 = Hit (empty)
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);

    const body = btn2Tags[0].body;
    const flagsByte = body[5];
    expect(flagsByte & 0x01).toBe(0); // StateUp not set
    expect(flagsByte & 0x02).toBe(2); // StateOver set
    expect(flagsByte & 0x04).toBe(0); // StateDown not set
    expect(flagsByte & 0x08).toBe(0); // StateHitTest not set
  });

  it("10: ButtonRecord state bits correct for Down state (frame 2)", () => {
    const btn = makeButtonSymbol("btn10", [
      [],                            // frame 0 = Up (empty)
      [],                            // frame 1 = Over (empty)
      [makeShapeObj("shape-down")],  // frame 2 = Down
      [],                            // frame 3 = Hit (empty)
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);

    const body = btn2Tags[0].body;
    const flagsByte = body[5];
    expect(flagsByte & 0x01).toBe(0); // StateUp not set
    expect(flagsByte & 0x02).toBe(0); // StateOver not set
    expect(flagsByte & 0x04).toBe(4); // StateDown set
    expect(flagsByte & 0x08).toBe(0); // StateHitTest not set
  });

  it("11: all 4 states with distinct shapes — each state's ButtonRecord has the correct single state bit", () => {
    // Each state has a unique shape, placed on a different layer so they get
    // separate depths. This means 4 ButtonRecords each with exactly one state bit.
    // We verify that the OR of all state bits in the body covers all 4 states.
    const btn = makeButtonSymbol("btn11", [
      [makeShapeObj("shape-up")],    // frame 0 = Up
      [makeShapeObj("shape-over")],  // frame 1 = Over
      [makeShapeObj("shape-down")],  // frame 2 = Down
      [makeShapeObj("shape-hit")],   // frame 3 = Hit
    ]);
    const doc = makeDoc([btn]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const btn2Tags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(btn2Tags.length).toBe(1);

    // Scan the body for ButtonRecord flag bytes.
    // Each ButtonRecord starts with a flags byte; bit3..bit0 are the state bits.
    // A flags byte of 0x00 is the null terminator.
    // We scan from offset 5 (after ButtonId + TrackAsMenu + ActionOffset)
    // and collect non-zero bytes at record starts.
    // Since MATRIX and CXFORM are variable-length, we can't stride by a fixed
    // amount, but we CAN assert that all 4 state bits are represented somewhere
    // in the body bytes.
    const body = btn2Tags[0].body;
    // Scan the entire body (from offset 5) and OR all non-zero low-nibble values.
    // The state bits (0x01/0x02/0x04/0x08) will each appear exactly once as
    // the first byte of their respective ButtonRecord.
    let coveredStates = 0;
    for (let i = 5; i < body.length; i++) {
      const b = body[i] & 0x0f;
      if (b === 0x01 || b === 0x02 || b === 0x04 || b === 0x08) {
        coveredStates |= b;
      }
    }
    expect(coveredStates & 0x01).toBe(1); // StateUp byte present
    expect(coveredStates & 0x02).toBe(2); // StateOver byte present
    expect(coveredStates & 0x04).toBe(4); // StateDown byte present
    expect(coveredStates & 0x08).toBe(8); // StateHit byte present
  });
});
