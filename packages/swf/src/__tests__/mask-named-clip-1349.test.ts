/**
 * Regression test for task 1349.
 *
 * A NAMED, SCRIPTED MovieClip placed on a MASK layer used to be emitted as a
 * PlaceObject2 carrying ONLY HasClipDepth (0x40) — its instance name (HasName,
 * 0x20) and its onClipEvent clipActions (HasClipActions, 0x80) were silently
 * dropped. In Magnet.fla Scene 5 this stripped the `ballmask` clip's name and
 * its `onClipEvent(load){ … }` handler, so `_root.ballmask` was undefined and
 * the level-select menu could never be exited ("Scene 5 frozen").
 *
 * The fix: the mask-layer symbol-instance emit path (compiler/frames.ts, and the
 * symbol-internal mirror in sprite.ts) now passes the instance name + clip
 * actions through to encodePlaceObject2WithClipDepth, which emits HasName and
 * HasClipActions ALONGSIDE HasClipDepth (SWF allows all four flags together).
 *
 * This is a structural byte oracle. Runtime proof (the load handler firing in
 * Ruffle) is covered by the e2e — see CLAUDE.md's Verification learning; the
 * byte presence here is necessary but not sufficient, hence the e2e companion.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  ClipAction,
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Shape,
  ShapeDisplayObject,
  Symbol,
  SymbolInstance,
} from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parsing (same minimal parser as masklayer.test.ts)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function tagStreamOffset(bytes: Uint8Array): number {
  let byteOff = 8;
  let bitsLeft = 0;
  let bitBuf = 0;
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
  readBits(nBits);
  readBits(nBits);
  readBits(nBits);
  readBits(nBits);
  byteOff = Math.ceil((8 * 8 + 5 + nBits * 4) / 8);
  return byteOff + 4; // FrameRate (UI16) + FrameCount (UI16)
}

function parseTags(bytes: Uint8Array): SWFTag[] {
  const tags: SWFTag[] = [];
  let pos = tagStreamOffset(bytes);
  while (pos + 2 <= bytes.length) {
    const hdr = bytes[pos]! | (bytes[pos + 1]! << 8);
    const code = (hdr >> 6) & 0x3ff;
    let len = hdr & 0x3f;
    let hdrSize = 2;
    if (len === 0x3f) {
      len =
        bytes[pos + 2]! |
        (bytes[pos + 3]! << 8) |
        (bytes[pos + 4]! << 16) |
        (bytes[pos + 5]! << 24);
      hdrSize = 6;
    }
    const start = pos + hdrSize;
    tags.push({ code, body: bytes.slice(start, start + len) });
    pos = start + len;
    if (code === 0) break;
  }
  return tags;
}

const TAG_PLACE_OBJECT2 = 26;
const HAS_NAME = 0x20;
const HAS_CLIP_DEPTH = 0x40;
const HAS_CLIP_ACTIONS = 0x80;

/** Does `body` contain `needle` as a contiguous byte run? */
function bodyContains(body: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= body.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (body[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Document fixture
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
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  linkageIdentifier: "",
  sharedUrl: "",
  className: "",
} as const;

function makeShape(id: string): Shape {
  return {
    id,
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 90, y: 0 } },
          { type: "line", to: { x: 90, y: 90 } },
          { type: "line", to: { x: 0, y: 90 } },
        ],
        closed: true,
        fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
      },
    ],
  };
}

function makeShapeObj(objId: string, shapeId: string): ShapeDisplayObject {
  return {
    id: objId,
    type: "shape",
    shape: makeShape(shapeId),
    x: 10,
    y: 10,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

function makeFrame(displayObjects: Frame["displayObjects"]): Frame {
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

function makeLayer(id: string, name: string, type: Layer["type"], frames: Frame[]): Layer {
  return {
    id,
    name,
    type,
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

/** A movieclip symbol used as the mask clip (a single empty keyframe is enough). */
function makeMovieClipSymbol(id: string, name: string): Symbol {
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: {
      layers: [makeLayer("ml", "Layer 1", "normal", [makeFrame([])])],
    },
    linkage: DEFAULT_LINKAGE,
    scale9Grid: null,
  };
}

const BALLMASK_NAME = "ballmask";
const LOAD_SCRIPT = 'tgt = -1; gotoAndPlay("mid");';

function makeMaskInstance(symbolId: string): SymbolInstance {
  const clipActions: ClipAction[] = [{ event: "load", script: LOAD_SCRIPT }];
  return {
    id: "inst-ballmask",
    type: "instance",
    symbolId,
    instanceName: BALLMASK_NAME,
    x: 20,
    y: 20,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    skewX: 0,
    skewY: 0,
    visible: true,
    alpha: 1,
    blendMode: "normal",
    cacheAsBitmap: false,
    filters: [],
    colorEffect: { type: "none" },
    loopMode: "loop",
    firstFrame: 0,
    clipActions,
  };
}

/**
 * Scene 5 in miniature: a mask layer carrying a named, scripted MovieClip,
 * directly above a masked layer (a consecutive masked run is what makes the
 * compiler compute a clipDepth and take the HasClipDepth emit path).
 */
function makeMaskedClipDoc(): FlashDocument {
  const clipSym = makeMovieClipSymbol("sym-ballmask", "BallMask");

  const maskLayer = makeLayer("layer-mask", "Layer 5", "mask", [
    makeFrame([makeMaskInstance(clipSym.id)]),
  ]);
  const maskedLayer = makeLayer("layer-masked", "Masked", "masked", [
    makeFrame([makeShapeObj("obj-masked", "shape-masked")]),
  ]);

  const scene: Scene = {
    id: "scene-5",
    name: "Scene 5",
    timeline: { layers: [maskLayer, maskedLayer] },
  };

  return {
    id: "doc-1349",
    properties: BASE_PROPS,
    scenes: [scene],
    library: { items: [clipSym], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("task 1349: named/scripted MovieClip on a mask layer keeps name + clipActions", () => {
  it("the mask PlaceObject2 carries HasName + HasClipDepth + HasClipActions together", () => {
    const swf = compileDocument(makeMaskedClipDoc());
    const placeTags = parseTags(swf).filter((t) => t.code === TAG_PLACE_OBJECT2);

    const maskTag = placeTags.find((t) => (t.body[0]! & HAS_CLIP_DEPTH) !== 0);
    expect(maskTag, "a PlaceObject2 with HasClipDepth must exist").toBeDefined();

    const flags = maskTag!.body[0]!;
    expect(flags & HAS_CLIP_DEPTH, "HasClipDepth (0x40) set").toBe(HAS_CLIP_DEPTH);
    expect(flags & HAS_NAME, "HasName (0x20) set alongside clip depth").toBe(HAS_NAME);
    expect(flags & HAS_CLIP_ACTIONS, "HasClipActions (0x80) set alongside clip depth").toBe(
      HAS_CLIP_ACTIONS
    );
  });

  it("the mask PlaceObject2 body contains the instance name bytes", () => {
    const swf = compileDocument(makeMaskedClipDoc());
    const maskTag = parseTags(swf)
      .filter((t) => t.code === TAG_PLACE_OBJECT2)
      .find((t) => (t.body[0]! & HAS_CLIP_DEPTH) !== 0)!;

    // NUL-terminated UTF-8 instance name written after the MATRIX, before ClipDepth.
    const nameBytes = new Uint8Array([...new TextEncoder().encode(BALLMASK_NAME), 0x00]);
    expect(bodyContains(maskTag.body, nameBytes)).toBe(true);
  });

  it("the mask PlaceObject2 clip-actions block declares the onLoad event flag", () => {
    const swf = compileDocument(makeMaskedClipDoc());
    const maskTag = parseTags(swf)
      .filter((t) => t.code === TAG_PLACE_OBJECT2)
      .find((t) => (t.body[0]! & HAS_CLIP_DEPTH) !== 0)!;

    // The CLIPACTIONS block ends with: Reserved UI16=0, AllEventFlags UI32,
    // then per-record ClipEventFlags UI32 (onLoad = 0x00000001), size, bytecode,
    // terminator UI32=0. The onLoad AllEventFlags UI32 (01 00 00 00) must appear.
    const onLoadU32LE = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
    expect(bodyContains(maskTag.body, onLoadU32LE)).toBe(true);
  });

  it("a NAMELESS, scriptless mask clip still emits ONLY HasClipDepth (no false positives)", () => {
    const base = makeMaskedClipDoc();
    // Strip the name + clip actions off the mask instance (rebuild immutably).
    const inst = base.scenes[0]!.timeline.layers[0]!.frames[0]!.displayObjects[0] as SymbolInstance;
    const bare: SymbolInstance = { ...inst, instanceName: "", clipActions: [] };
    const clipSym = makeMovieClipSymbol("sym-ballmask", "BallMask");
    const maskLayer = makeLayer("layer-mask", "Layer 5", "mask", [makeFrame([bare])]);
    const maskedLayer = makeLayer("layer-masked", "Masked", "masked", [
      makeFrame([makeShapeObj("obj-masked", "shape-masked")]),
    ]);
    const doc: FlashDocument = {
      id: "doc-1349-bare",
      properties: BASE_PROPS,
      scenes: [{ id: "scene-5", name: "Scene 5", timeline: { layers: [maskLayer, maskedLayer] } }],
      library: { items: [clipSym], folders: [] },
    };

    const maskTag = parseTags(compileDocument(doc))
      .filter((t) => t.code === TAG_PLACE_OBJECT2)
      .find((t) => (t.body[0]! & HAS_CLIP_DEPTH) !== 0)!;

    const flags = maskTag.body[0]!;
    expect(flags & HAS_CLIP_DEPTH).toBe(HAS_CLIP_DEPTH);
    expect(flags & HAS_NAME).toBe(0);
    expect(flags & HAS_CLIP_ACTIONS).toBe(0);
  });
});
