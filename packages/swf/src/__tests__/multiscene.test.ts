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

/**
 * Decode a SWF EncodedU32 (variable-length LEB128-like) value.
 * Returns { value, bytesRead }.
 */
function decodeU32(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < bytes.length) {
    const byte = bytes[offset + bytesRead];
    bytesRead++;
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) === 0) break;
  }
  return { value, bytesRead };
}

/**
 * Decode a null-terminated string from bytes at the given offset.
 * Returns { str, bytesRead } where bytesRead includes the null terminator.
 */
function decodeString(bytes: Uint8Array, offset: number): { str: string; bytesRead: number } {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  const str = new TextDecoder().decode(bytes.slice(offset, end));
  return { str, bytesRead: end - offset + 1 }; // +1 for null terminator
}

/**
 * Parse the SceneAndFrameLabelData (tag 86) body.
 * Returns an array of { frameOffset, name } scene entries and frame label entries.
 */
function parseSceneAndFrameLabelData(body: Uint8Array): {
  scenes: Array<{ frameOffset: number; name: string }>;
  frameLabels: Array<{ frameNum: number; name: string }>;
} {
  let pos = 0;

  const sceneCountResult = decodeU32(body, pos);
  pos += sceneCountResult.bytesRead;
  const sceneCount = sceneCountResult.value;

  const scenes: Array<{ frameOffset: number; name: string }> = [];
  for (let i = 0; i < sceneCount; i++) {
    const offsetResult = decodeU32(body, pos);
    pos += offsetResult.bytesRead;
    const nameResult = decodeString(body, pos);
    pos += nameResult.bytesRead;
    scenes.push({ frameOffset: offsetResult.value, name: nameResult.str });
  }

  const labelCountResult = decodeU32(body, pos);
  pos += labelCountResult.bytesRead;
  const labelCount = labelCountResult.value;

  const frameLabels: Array<{ frameNum: number; name: string }> = [];
  for (let i = 0; i < labelCount; i++) {
    const frameNumResult = decodeU32(body, pos);
    pos += frameNumResult.bytesRead;
    const nameResult = decodeString(body, pos);
    pos += nameResult.bytesRead;
    frameLabels.push({ frameNum: frameNumResult.value, name: nameResult.str });
  }

  return { scenes, frameLabels };
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
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
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
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
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

  // Test 2: Scene names are encoded in SceneAndFrameLabelData (tag 86)
  it("scene names are encoded in SceneAndFrameLabelData (tag 86)", () => {
    const doc = makeDoc([
      makeScene("s1", "Intro", 3),
      makeScene("s2", "Main", 3),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const tag86 = tags.find((t) => t.code === TAG_SCENE_AND_FRAME_LABEL_DATA);
    expect(tag86).toBeDefined();

    const parsed = parseSceneAndFrameLabelData(tag86!.body);
    expect(parsed.scenes.length).toBe(2);
    expect(parsed.scenes[0].name).toBe("Intro");
    expect(parsed.scenes[1].name).toBe("Main");
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

  // Test 5: Scene boundary frame offsets in tag 86 reference correct absolute frame indices
  it("tag 86 scene frame offsets are correct cumulative frame indices", () => {
    // Scene 1: 3 frames → offset 0
    // Scene 2: 4 frames → offset 3
    // Scene 3: 2 frames → offset 7
    const doc = makeDoc([
      makeScene("s1", "Intro", 3),
      makeScene("s2", "Main", 4),
      makeScene("s3", "Outro", 2),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const tag86 = tags.find((t) => t.code === TAG_SCENE_AND_FRAME_LABEL_DATA);
    expect(tag86).toBeDefined();

    const parsed = parseSceneAndFrameLabelData(tag86!.body);
    expect(parsed.scenes.length).toBe(3);

    // First scene always starts at frame offset 0
    expect(parsed.scenes[0].frameOffset).toBe(0);
    expect(parsed.scenes[0].name).toBe("Intro");

    // Second scene starts after 3 frames
    expect(parsed.scenes[1].frameOffset).toBe(3);
    expect(parsed.scenes[1].name).toBe("Main");

    // Third scene starts after 3+4=7 frames
    expect(parsed.scenes[2].frameOffset).toBe(7);
    expect(parsed.scenes[2].name).toBe("Outro");
  });

  // Test 6: A frame label in scene 2 is encoded in tag 86 at the correct absolute frame number.
  // This verifies that cross-scene gotoAndPlay("label") navigation works correctly.
  // In Magnet.fla, scene 5 has a "menu" label at scene-relative frame 1; the title-screen
  // Play button uses `_root.gotoAndPlay("menu")` to navigate there.
  it("frame label in scene 2 is encoded in tag 86 at correct absolute frame number", () => {
    // Build a 2-scene doc where scene 2, frame 1 has label "menu"
    // Scene 1: 3 frames (offsets 0-2), Scene 2: 2 frames (offsets 3-4)
    // "menu" label is at scene 2 frame 1 → absolute frame 4
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
      motionRotate: "none",
      motionRotateCount: 0,
      motionOrientToPath: false,
      motionSync: false,
      motionScale: false,
      shapeEase: 0,
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

    // 1. Tag 86 must exist and encode "menu" at absolute frame 4 (3 + 1)
    const tag86 = tags.find((t) => t.code === TAG_SCENE_AND_FRAME_LABEL_DATA);
    expect(tag86).toBeDefined();
    const parsed = parseSceneAndFrameLabelData(tag86!.body);

    // Scene 1 starts at 0, Scene 2 starts at 3
    expect(parsed.scenes[0].frameOffset).toBe(0);
    expect(parsed.scenes[1].frameOffset).toBe(3);

    // "menu" label at absolute frame 4.
    // Tag 86 frame labels now also include scene names ("Title" at 0, "Game" at 3) so that
    // gotoAndPlay("Title") / gotoAndPlay("Game") resolve via frame_labels_map in AVM1.
    // Total: 3 labels ("menu" + "Title" + "Game").
    expect(parsed.frameLabels.length).toBe(3);
    const menuLabel = parsed.frameLabels.find((l) => l.name === "menu");
    expect(menuLabel).toBeDefined();
    expect(menuLabel!.frameNum).toBe(4); // 3 (scene 1 frames) + 1 (scene 2 frame index)
    // Scene name aliases
    const titleLabel = parsed.frameLabels.find((l) => l.name === "Title");
    expect(titleLabel).toBeDefined();
    expect(titleLabel!.frameNum).toBe(0);
    const gameLabel = parsed.frameLabels.find((l) => l.name === "Game");
    expect(gameLabel).toBeDefined();
    expect(gameLabel!.frameNum).toBe(3);

    // 2. A FrameLabel tag with "menu" must also appear in the tag stream
    //    (Ruffle uses FrameLabel tags for within-scene navigation by label)
    const TAG_FRAME_LABEL = 43;
    const frameLabelTags = tags.filter((t) => t.code === TAG_FRAME_LABEL);
    const decodeLabel = (body: Uint8Array): string => {
      const nullIdx = body.indexOf(0);
      return new TextDecoder().decode(body.slice(0, nullIdx < 0 ? body.length : nullIdx));
    };
    const labelNames = frameLabelTags.map((t) => decodeLabel(t.body));
    // "menu" must be in the FrameLabel tags (as well as scene names "Title" and "Game")
    expect(labelNames).toContain("menu");
    expect(labelNames).toContain("Title");
    expect(labelNames).toContain("Game");
  });
});
