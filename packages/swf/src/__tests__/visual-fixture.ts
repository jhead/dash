/**
 * Visual fixture document builders for use in visual regression tests and the
 * Playwright visual oracle suite.
 *
 * These functions return pure FlashDocument data structures — no rendering
 * or browser APIs are involved. They are reusable from both unit tests and
 * the Playwright e2e tests.
 */

import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Shape,
  ShapeDisplayObject,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Internal helpers (mirrors integration.test.ts helpers, kept local to avoid
// coupling the two test files)
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

function makeFrame(
  displayObjects: readonly ShapeDisplayObject[],
  overrides: Partial<Frame> = {}
): Frame {
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
    ...overrides,
  };
}

function makeLayer(name: string, frames: Frame[]): Layer {
  return {
    id: `layer-${name}`,
    name,
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

function makeScene(id: string, name: string, layers: Layer[]): Scene {
  return {
    id,
    name,
    timeline: { layers },
  };
}

/**
 * Parse a CSS hex color string like "#rrggbb" → { r, g, b }.
 * Supports both 3-char (#rgb) and 6-char (#rrggbb) forms.
 */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

/**
 * Build a rectangle ShapeDisplayObject with a solid fill.
 */
function makeColoredRect(
  id: string,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number
): ShapeDisplayObject {
  const { r, g, b } = parseHexColor(color);

  const shape: Shape = {
    id: `shape-${id}`,
    paths: [
      {
        start: { x, y },
        segments: [
          { type: "line", to: { x: x + w, y } },
          { type: "line", to: { x: x + w, y: y + h } },
          { type: "line", to: { x, y: y + h } },
        ],
        closed: true,
        fill: { type: "solid", color: { r, g, b, a: 255 } },
      },
    ],
  };

  return {
    id,
    type: "shape",
    shape,
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

// ---------------------------------------------------------------------------
// Public fixture builders
// ---------------------------------------------------------------------------

/**
 * Returns a single-scene, single-frame document that shows one colored
 * rectangle at the given position with the given dimensions.
 *
 * Useful for basic visual-oracle comparisons: "same colored box in same
 * place in both the Canvas renderer and Ruffle".
 */
export function makeColoredRectDoc(
  color: string,
  x: number,
  y: number,
  w: number,
  h: number
): FlashDocument {
  const rect = makeColoredRect("rect-1", color, x, y, w, h);
  const frame = makeFrame([rect]);
  const layer = makeLayer("Layer 1", [frame]);
  const scene = makeScene("scene-1", "Scene 1", [layer]);

  const bgColor = color.toLowerCase() === "#ffffff" ? "#cccccc" : "#ffffff";

  return {
    id: "visual-rect-doc",
    properties: { ...BASE_PROPS, backgroundColor: bgColor },
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}

/**
 * Returns a document with three non-overlapping colored rectangles arranged
 * horizontally across the stage:
 *   - Red   50×50 at (50, 175)
 *   - Green 50×50 at (250, 175)
 *   - Blue  50×50 at (450, 175)
 *
 * Non-overlapping placement ensures each shape compiles to a distinct
 * DefineShape4 tag and allows structural comparison in both the Canvas
 * renderer and Ruffle output.
 */
export function makeMultiShapeDoc(): FlashDocument {
  const red = makeColoredRect("rect-red", "#ff0000", 50, 175, 50, 50);
  const green = makeColoredRect("rect-green", "#00ff00", 250, 175, 50, 50);
  const blue = makeColoredRect("rect-blue", "#0000ff", 450, 175, 50, 50);

  const frame = makeFrame([red, green, blue]);
  const layer = makeLayer("Layer 1", [frame]);
  const scene = makeScene("scene-1", "Scene 1", [layer]);

  return {
    id: "visual-multi-shape-doc",
    properties: { ...BASE_PROPS, backgroundColor: "#ffffff" },
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}

/**
 * Returns a document where a red rectangle moves from the left to the right
 * side of the stage over 5 frames using a motion tween.
 *
 * Frame 0 (keyframe): rect at x=50
 * Frame 4 (keyframe): rect at x=450
 * Frames 1–3: tweened (interpolated by getTweenedFrame)
 *
 * This tests that the compiler emits the correct number of ShowFrame and
 * PlaceObject2+Move tags for tweened objects.
 */
export function makeTweenedDoc(): FlashDocument {
  // Start keyframe: rect at x=50
  const startRect = makeColoredRect("tween-rect", "#ff0000", 50, 175, 50, 50);
  const startFrame: Frame = {
    index: 0,
    isKeyframe: true,
    isEmpty: false,
    tweenType: "motion",
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
    displayObjects: [startRect],
  };

  // Intermediate non-keyframes (frames 1–3)
  const tweenFrames: Frame[] = [1, 2, 3].map((i) => ({
    index: i,
    isKeyframe: false,
    isEmpty: false,
    tweenType: "motion" as const,
    label: "",
    labelType: "name" as const,
    script: "",
    sound: null,
    motionEase: 0,
    motionEaseType: "none",
    motionRotate: "none" as const,
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionSnap: false,
    motionScale: false,
    shapeEase: 0,
    shapeEaseType: "none",
    shapeBlend: "distributive" as const,
    displayObjects: [],
  }));

  // End keyframe: rect at x=450
  const endRect = makeColoredRect("tween-rect", "#ff0000", 450, 175, 50, 50);
  const endFrame: Frame = {
    index: 4,
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
    displayObjects: [endRect],
  };

  const layer = makeLayer("Layer 1", [startFrame, ...tweenFrames, endFrame]);
  const scene = makeScene("scene-1", "Scene 1", [layer]);

  return {
    id: "visual-tweened-doc",
    properties: { ...BASE_PROPS, backgroundColor: "#ffffff" },
    scenes: [scene],
    library: { items: [], folders: [] },
  };
}
