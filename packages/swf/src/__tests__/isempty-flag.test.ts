/**
 * Regression test: compile.ts must not silently drop displayObjects on frames
 * whose `isEmpty` flag is set to true but which have actual displayObjects.
 *
 * The `isEmpty` flag can become stale (e.g. deserialized from an old .fla,
 * or set incorrectly by a mutation that forgot to clear it). The compiler
 * must use the actual `displayObjects` array as the truth, not the flag.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";
import type { Shape } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF parser helpers (shared pattern from moveflag.test.ts)
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
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
    tags.push({ code: tagCode, body: swf.slice(bodyStart, bodyStart + bodyLength) });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

function groupByFrame(tags: SwfTag[]): SwfTag[][] {
  const frames: SwfTag[][] = [];
  let current: SwfTag[] = [];
  for (const tag of tags) {
    if (tag.code === Tag.ShowFrame) {
      frames.push(current);
      current = [];
    } else {
      current.push(tag);
    }
  }
  return frames;
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

function makeShape(id = "shape-1"): Shape {
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

function makeShapeObj(id: string) {
  return {
    id,
    type: "shape" as const,
    shape: makeShape(id),
    x: 10,
    y: 20,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 1,
    visible: true,
    filters: [],
    blendMode: "normal" as const,
    cacheAsBitmap: false,
  };
}

/**
 * Build a keyframe with `isEmpty: true` but with actual displayObjects.
 * This is the "stale flag" scenario the fix must handle.
 */
function makeStaleIsEmptyFrame(index: number, objId: string): Frame {
  return {
    index,
    isKeyframe: true,
    // Stale flag: isEmpty=true even though displayObjects is non-empty
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
    displayObjects: [makeShapeObj(objId)],
  };
}

function makeLayer(id: string, frames: Frame[], frameCount: number): Layer {
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

function makeScene(id: string, name: string, layers: Layer[]): Scene {
  return { id, name, timeline: { layers } };
}

function makeDoc(scenes: Scene[]): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Regression tests
// ---------------------------------------------------------------------------

describe("isEmpty flag regression — compile must not drop displayObjects", () => {
  it("emits DefineShape4 and PlaceObject2 for a frame with isEmpty:true but non-empty displayObjects", () => {
    // Construct a keyframe where isEmpty=true (stale flag) but displayObjects has a shape.
    const frame = makeStaleIsEmptyFrame(0, "obj-stale");
    const layer = makeLayer("l1", [frame], 1);
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // A DefineShape4 (tag 83) must be emitted for the shape character definition.
    const defineShape = tags.find((t) => t.code === Tag.DefineShape4);
    expect(
      defineShape,
      "DefineShape4 must be emitted even when frame.isEmpty is true"
    ).toBeDefined();

    // A PlaceObject2 (tag 26) must be emitted to put the shape on screen.
    const frames = groupByFrame(tags);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const frame0Tags = frames[0];
    const placeObj = frame0Tags.find((t) => t.code === Tag.PlaceObject2);
    expect(
      placeObj,
      "PlaceObject2 must be emitted for the shape even when frame.isEmpty is true"
    ).toBeDefined();
  });

  it("emits PlaceObject2 for every frame in a multi-frame timeline where isEmpty:true is stale", () => {
    // Two keyframes, both with stale isEmpty:true but both containing a shape at the same objId.
    const frame0 = makeStaleIsEmptyFrame(0, "obj-multi");
    const frame1: Frame = {
      ...makeStaleIsEmptyFrame(1, "obj-multi"),
      // Move the object slightly so a PlaceObject2+Move is emitted on frame 1
      displayObjects: [{ ...makeShapeObj("obj-multi"), x: 100, y: 20 }],
    };
    const layer = makeLayer("l1", [frame0, frame1], 2);
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);

    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(2);

    // Frame 0: fresh PlaceObject2
    const place0 = frames[0].find((t) => t.code === Tag.PlaceObject2);
    expect(place0, "Frame 0 must have PlaceObject2 for stale isEmpty frame").toBeDefined();

    // Frame 1: PlaceObject2+Move (position changed)
    const place1 = frames[1].find((t) => t.code === Tag.PlaceObject2);
    expect(place1, "Frame 1 must have PlaceObject2 for stale isEmpty frame").toBeDefined();
  });
});
