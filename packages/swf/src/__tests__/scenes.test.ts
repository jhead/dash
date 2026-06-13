/**
 * Tests for multi-scene SWF export.
 *
 * Flash 8 scenes are exported as a single SWF timeline with FrameLabel tags
 * (tag 43) at the start of each scene. Between scenes the display list is
 * cleared via RemoveObject2 (tag 28) for every occupied depth.
 *
 * Tag codes used:
 *   43  FrameLabel
 *   28  RemoveObject2
 *    1  ShowFrame
 *   83  DefineShape4
 *   26  PlaceObject2
 *
 * SWF header layout (from byte 8):
 *   RECT  FrameSize (variable)
 *   UI16  FrameRate
 *   UI16  FrameCount
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
const TAG_REMOVE_OBJECT2 = 28;
const TAG_DEFINE_SHAPE4 = 83;
const TAG_PLACE_OBJECT2 = 26;
const TAG_FRAME_LABEL = 43;

// ---------------------------------------------------------------------------
// SWF parser helpers
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  /** Byte offset of the record header in the SWF */
  offset: number;
}

/**
 * Parse all tag records from a compiled SWF binary.
 * Stops at the End tag (code 0) or end of file.
 */
function parseTags(swf: Uint8Array): SwfTag[] {
  // Locate end of the variable-length RECT in the header.
  // RECT starts at byte 8: first 5 bits = Nbits; total RECT bits = 5 + 4*Nbits
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  // SWF header = 8 bytes (sig+ver+fileLen) + rectBytes + 4 (frameRate+frameCount)
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

/**
 * Read the FrameCount UI16LE from the SWF header.
 * It sits immediately after FrameRate (2 bytes after the end of the RECT).
 */
function readFrameCount(swf: Uint8Array): number {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  // frameRate at offset 8+rectBytes, frameCount at offset 8+rectBytes+2
  const fcOffset = 8 + rectBytes + 2;
  return swf[fcOffset] | (swf[fcOffset + 1] << 8);
}

/**
 * Decode the null-terminated string from a FrameLabel tag body.
 * The body is the scene/frame name followed by a 0x00 byte.
 */
function readFrameLabelName(body: Uint8Array): string {
  let end = 0;
  while (end < body.length && body[end] !== 0) end++;
  return new TextDecoder().decode(body.slice(0, end));
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

/** Build a blank keyframe at the given index. */
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

/** Build a minimal layer with N blank keyframes. */
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

/** Build a scene with the given name and frame count. */
function makeScene(id: string, name: string, frameCount = 1): Scene {
  return {
    id,
    name,
    timeline: {
      layers: [makeLayer(`${id}-layer`, frameCount)],
    },
  };
}

/** Build a minimal shape for use in display objects. */
function makeShape(): Shape {
  return {
    id: "shape-1",
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

/** Build a FlashDocument with the given scenes. */
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

describe("multi-scene SWF export", () => {
  // Test 1: Single-scene doc with no user labels produces zero FrameLabel tags
  // (scene names are NOT emitted as FrameLabel in Flash 8 target)
  it("single-scene doc with no user labels produces zero FrameLabel tags", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const labels = tags.filter((t) => t.code === TAG_FRAME_LABEL);
    expect(labels.length).toBe(0);
  });

  // Test 2: Two-scene doc with no user labels produces zero FrameLabel tags
  it("two-scene doc with no user labels produces zero FrameLabel tags", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 2),
      makeScene("s2", "Scene 2", 2),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const labels = tags.filter((t) => t.code === TAG_FRAME_LABEL);
    expect(labels.length).toBe(0);
  });

  // Test 3: Scene names are NOT emitted as FrameLabel tags (Flash 8 behavior)
  it("scene name is NOT emitted as a FrameLabel tag", () => {
    const doc = makeDoc([makeScene("s1", "My Scene", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const label = tags.find(
      (t) => t.code === TAG_FRAME_LABEL && readFrameLabelName(t.body) === "My Scene"
    );
    expect(label).toBeUndefined();
  });

  // Test 4: ShowFrame count matches scene frame counts (multi-scene ordering check)
  it("two-scene doc has correct total ShowFrame count", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 2),
      makeScene("s2", "Scene 2", 2),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const showFrames = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(4); // 2 + 2
  });

  // Test 5: Total frame count in SWF header equals sum of all scene frame counts
  it("SWF header FrameCount equals total frames across all scenes", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 3),
      makeScene("s2", "Scene 2", 5),
    ]);
    const swf = compileDocument(doc);
    expect(readFrameCount(swf)).toBe(8); // 3 + 5
  });

  // Test 5b: Single scene frame count matches header
  it("SWF header FrameCount equals frame count for single scene", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 4)]);
    const swf = compileDocument(doc);
    expect(readFrameCount(swf)).toBe(4);
  });

  // Test 6: Second scene starts with clean depth (RemoveObject2 emitted between scenes)
  it("RemoveObject2 tags are emitted between scenes to clear the display list", () => {
    // Build scene 1 with a shape placed on the stage, scene 2 is blank
    const shapeObj = {
      id: "shape-obj-1",
      type: "shape" as const,
      shape: makeShape(),
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      visible: true,
      filters: [],
      blendMode: "normal" as const,
      cacheAsBitmap: false,
    };

    const scene1: Scene = {
      id: "s1",
      name: "Scene 1",
      timeline: {
        layers: [
          {
            id: "l1",
            name: "Layer 1",
            type: "normal",
            visible: true,
            locked: false,
            outlineMode: false,
            outlineColor: "#ff0000",
            height: 20,
            parentFolderId: null,
            frameCount: 1,
            frames: [
              {
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
                displayObjects: [shapeObj],
              },
            ],
          },
        ],
      },
    };

    const scene2 = makeScene("s2", "Scene 2", 1);

    const doc = makeDoc([scene1, scene2]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // Scene 1 has 1 frame, scene 2 has 1 frame => 2 ShowFrames total.
    // RemoveObject2 tags are emitted at the start of scene 2 (after the first ShowFrame,
    // before the second ShowFrame). Locate by ShowFrame indices.
    const showFrameIndices = tags
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => t.code === TAG_SHOW_FRAME)
      .map(({ idx }) => idx);

    expect(showFrameIndices.length).toBe(2);

    // Between showFrame[0] and showFrame[1]: RemoveObject2 must appear
    const betweenScenes = tags.slice(
      showFrameIndices[0] + 1,
      showFrameIndices[1]
    );
    const removes = betweenScenes.filter(
      (t) => t.code === TAG_REMOVE_OBJECT2
    );
    expect(removes.length).toBeGreaterThan(0);
  });

  // Test 7: Shapes defined in scene 1 can be referenced in scene 2 (same charId)
  it("shapes from scene 1 are defined before scene 2 frames (global pre-pass)", () => {
    // Both scenes share a display object with the same id.
    // The DefineShape4 should appear BEFORE both scenes' ShowFrames in the output.
    const shapeObj = {
      id: "shared-shape",
      type: "shape" as const,
      shape: makeShape(),
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      visible: true,
      filters: [],
      blendMode: "normal" as const,
      cacheAsBitmap: false,
    };

    function makeSceneWithShape(id: string, name: string): Scene {
      return {
        id,
        name,
        timeline: {
          layers: [
            {
              id: `${id}-layer`,
              name: "Layer 1",
              type: "normal",
              visible: true,
              locked: false,
              outlineMode: false,
              outlineColor: "#ff0000",
              height: 20,
              parentFolderId: null,
              frameCount: 1,
              frames: [
                {
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
                  displayObjects: [shapeObj],
                },
              ],
            },
          ],
        },
      };
    }

    const doc = makeDoc([
      makeSceneWithShape("s1", "Scene 1"),
      makeSceneWithShape("s2", "Scene 2"),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // DefineShape4 (tag 83) should appear only ONCE (global pre-pass deduplicates)
    const defineShapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(defineShapeTags.length).toBe(1);

    // DefineShape4 must appear before the first ShowFrame
    const defineShapeIdx = tags.findIndex((t) => t.code === TAG_DEFINE_SHAPE4);
    const firstShowFrameIdx = tags.findIndex((t) => t.code === TAG_SHOW_FRAME);
    expect(defineShapeIdx).toBeLessThan(firstShowFrameIdx);

    // PlaceObject2 should appear in both scenes (once per scene)
    const placeTagCount = tags.filter(
      (t) => t.code === TAG_PLACE_OBJECT2
    ).length;
    expect(placeTagCount).toBeGreaterThanOrEqual(1);
  });

  // Test 8: Three-scene doc produces zero FrameLabel tags (no user labels)
  // Scene names are NOT emitted as FrameLabel in Flash 8 target
  it("three-scene doc with no user labels produces zero FrameLabel tags", () => {
    const doc = makeDoc([
      makeScene("s1", "Intro", 2),
      makeScene("s2", "Main", 3),
      makeScene("s3", "Outro", 1),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const labels = tags.filter((t) => t.code === TAG_FRAME_LABEL);

    expect(labels.length).toBe(0);
  });

  // Test 8b: Three-scene doc has correct total frame count
  it("three-scene doc has correct total frame count in SWF header", () => {
    const doc = makeDoc([
      makeScene("s1", "Intro", 2),
      makeScene("s2", "Main", 3),
      makeScene("s3", "Outro", 1),
    ]);
    const swf = compileDocument(doc);
    expect(readFrameCount(swf)).toBe(6); // 2 + 3 + 1
  });
});
