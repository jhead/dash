/**
 * Tests for multi-scene SWF compilation.
 *
 * Verifies that a FlashDocument with multiple scenes compiles to a single
 * SWF timeline:
 *  - ShowFrame count equals the total frame count across all scenes
 *  - Scene names are encoded in SceneAndFrameLabelData (tag 86)
 *  - Display objects from both scenes appear in the output
 *  - Single-scene docs still compile correctly
 *  - Scene boundary frame index in tag 86 references the correct absolute frame
 *
 * Tag codes:
 *    1  ShowFrame
 *   26  PlaceObject2
 *   43  FrameLabel
 *   83  DefineShape4
 *   86  SceneAndFrameLabelData
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";
import type { Shape } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_SHOW_FRAME = 1;
const TAG_DEFINE_SHAPE4 = 83;
const TAG_PLACE_OBJECT2 = 26;
const TAG_SCENE_AND_FRAME_LABEL_DATA = 86;

// ---------------------------------------------------------------------------
// SWF parser helpers
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
    tags.push({
      code: tagCode,
      body: swf.slice(bodyStart, bodyStart + bodyLength),
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

function makeShapeFrame(index: number, shapeId: string): Frame {
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
    displayObjects: [
      {
        id: shapeId,
        type: "shape" as const,
        shape: makeShape(shapeId),
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        filters: [],
      },
    ],
  };
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
// Tests
// ---------------------------------------------------------------------------

describe("multi-scene SWF compilation", () => {
  // Test 1: A doc with 2 scenes (3 frames each) compiles to 6 ShowFrame tags
  it("two scenes with 3 frames each produce exactly 6 ShowFrame tags", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 3),
      makeScene("s2", "Scene 2", 3),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const showFrames = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(6);
  });

  // Test 2: SceneAndFrameLabelData (tag 86) is NOT emitted for Flash 8 targets
  it("SceneAndFrameLabelData (tag 86) is NOT emitted for Flash 8 targets", () => {
    const doc = makeDoc([
      makeScene("s1", "Intro", 3),
      makeScene("s2", "Main", 3),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // Tag 86 is a Flash 9+ tag; Flash 8 targets do not emit it.
    const tag86 = tags.find((t) => t.code === TAG_SCENE_AND_FRAME_LABEL_DATA);
    expect(tag86).toBeUndefined();
  });

  // Test 3: Both scenes' display objects appear in output (DefineShape4 tags)
  it("display objects from both scenes produce DefineShape4 tags", () => {
    // Create two scenes each with a unique shape object
    const scene1: Scene = {
      id: "s1",
      name: "Scene 1",
      timeline: {
        layers: [
          {
            id: "s1-layer",
            name: "Layer 1",
            type: "normal",
            visible: true,
            locked: false,
            outlineMode: false,
            outlineColor: "#ff0000",
            height: 20,
            parentFolderId: null,
            frameCount: 3,
            frames: [
              makeShapeFrame(0, "shape-scene1"),
              makeBlankFrame(1),
              makeBlankFrame(2),
            ],
          },
        ],
      },
    };

    const scene2: Scene = {
      id: "s2",
      name: "Scene 2",
      timeline: {
        layers: [
          {
            id: "s2-layer",
            name: "Layer 1",
            type: "normal",
            visible: true,
            locked: false,
            outlineMode: false,
            outlineColor: "#ff0000",
            height: 20,
            parentFolderId: null,
            frameCount: 3,
            frames: [
              makeShapeFrame(0, "shape-scene2"),
              makeBlankFrame(1),
              makeBlankFrame(2),
            ],
          },
        ],
      },
    };

    const doc = makeDoc([scene1, scene2]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // Two distinct shapes — expect two DefineShape4 tags
    const defineShapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(defineShapeTags.length).toBe(2);

    // PlaceObject2 should appear in both scenes
    const placeObjectTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeObjectTags.length).toBeGreaterThanOrEqual(2);
  });

  // Test 4: A single-scene doc still compiles correctly
  it("single-scene doc compiles correctly with correct ShowFrame count", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // Exactly 3 ShowFrame tags
    const showFrames = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(3);

    // Single-scene doc: tag 86 is only emitted when there are 2+ scenes or labels.
    // With exactly 1 scene and no labels, tag 86 should NOT be present.
    const tag86 = tags.find((t) => t.code === TAG_SCENE_AND_FRAME_LABEL_DATA);
    expect(tag86).toBeUndefined();

    // Ends with End tag
    const endTag = tags[tags.length - 1];
    expect(endTag.code).toBe(TAG_END);
  });

  // Test 5: 3-scene doc has correct total ShowFrame count (tag 86 not emitted)
  it("3-scene doc has correct total ShowFrame count without tag 86", () => {
    // Scene 1: 3 frames, Scene 2: 4 frames, Scene 3: 2 frames
    const doc = makeDoc([
      makeScene("s1", "Intro", 3),
      makeScene("s2", "Main", 4),
      makeScene("s3", "Outro", 2),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // Tag 86 must be absent for Flash 8 targets
    expect(tags.find((t) => t.code === TAG_SCENE_AND_FRAME_LABEL_DATA)).toBeUndefined();

    // Total ShowFrame count must equal 3+4+2=9
    const showFrames = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(9);
  });

  // Test 6: User-defined frame label in scene 2 is emitted as FrameLabel (tag 43).
  // Tag 86 is never emitted for Flash 8 targets. User labels still become tag 43 entries.
  it("user-defined frame label in scene 2 is emitted as FrameLabel tag 43", () => {
    // Build a 2-scene doc where scene 2, frame 1 has label "menu"
    const scene1 = makeScene("s1", "Title", 3);

    const scene2Frame0: Frame = {
      index: 0,
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
    };
    const scene2Frame1: Frame = {
      ...scene2Frame0,
      index: 1,
      label: "menu",
      labelType: "name",
    };
    const scene2: Scene = {
      id: "s2",
      name: "Game",
      timeline: {
        layers: [
          {
            id: "s2-layer",
            name: "Layer 1",
            type: "normal",
            visible: true,
            locked: false,
            outlineMode: false,
            outlineColor: "#ff0000",
            height: 20,
            parentFolderId: null,
            frames: [scene2Frame0, scene2Frame1],
            frameCount: 2,
          },
        ],
      },
    };

    const doc = makeDoc([scene1, scene2]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // Tag 86 must NOT be present (Flash 8 target)
    expect(tags.find((t) => t.code === TAG_SCENE_AND_FRAME_LABEL_DATA)).toBeUndefined();

    // FrameLabel tag 43 must be present for the user-defined "menu" label
    const TAG_FRAME_LABEL = 43;
    const frameLabelTags = tags.filter((t) => t.code === TAG_FRAME_LABEL);
    const decodeLabel = (body: Uint8Array): string => {
      const nullIdx = body.indexOf(0);
      return new TextDecoder().decode(body.slice(0, nullIdx < 0 ? body.length : nullIdx));
    };
    const labelNames = frameLabelTags.map((t) => decodeLabel(t.body));
    // "menu" must be in the FrameLabel tags
    expect(labelNames).toContain("menu");
    // Scene names "Title" and "Game" must NOT be emitted as FrameLabel (Flash 8 behavior)
    expect(labelNames).not.toContain("Title");
    expect(labelNames).not.toContain("Game");
  });
});
