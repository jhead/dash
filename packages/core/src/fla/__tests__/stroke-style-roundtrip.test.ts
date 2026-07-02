/**
 * Non-solid stroke styles survive a full binary FLA write→read round-trip
 * (task 1410). Each dashed/dotted/ragged/stippled/hatched stroke is authored
 * with NON-DEFAULT parameters, serialized with saveRealFla(), re-imported with
 * the inverse-oracle importer (tryLoadRealFla), and its reconstructed
 * Stroke.style is asserted to deep-equal the authored style.
 *
 * Before this task the codec did `r.skip(4)` on read and wrote `0` on write, so
 * every non-solid stroke silently reverted to solid in both directions.
 */
import { describe, it, expect } from "vitest";
import { saveRealFla } from "../write/fla-write.js";
import { tryLoadRealFla } from "../ole.js";
import { createDocument, createDocumentProperties } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import { createLayer, createFrame } from "../../model/timeline.js";
import type { FlashDocument, Frame, Layer, Scene } from "../../model/types.js";
import type { ShapeDisplayObject, Stroke, StrokeStyle } from "../../engine/types.js";

function frameWith(objects: Frame["displayObjects"]): Frame {
  return createFrame(0, { isEmpty: objects.length === 0, displayObjects: objects });
}

function docWithStroke(stroke: Stroke): FlashDocument {
  const shape: ShapeDisplayObject = {
    type: "shape",
    id: "shape1",
    x: 0,
    y: 0,
    shape: {
      id: "geom1",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 100, y: 0 } },
            { type: "line", to: { x: 100, y: 60 } },
            { type: "line", to: { x: 0, y: 60 } },
            { type: "line", to: { x: 0, y: 0 } },
          ],
          fill: { type: "solid", color: { r: 200, g: 30, b: 40, a: 255 } },
          stroke,
          closed: true,
        },
      ],
    },
  };
  const layer: Layer = createLayer("Layer 1", "normal", {
    frames: [frameWith([shape])],
    frameCount: 1,
  });
  const scene: Scene = createScene("Scene 1", { timeline: { layers: [layer] } });
  return createDocument({
    properties: createDocumentProperties({ width: 640, height: 480, frameRate: 24 }),
    scenes: [scene],
    library: { items: [], folders: [] },
  });
}

function makeStroke(style: StrokeStyle): Stroke {
  return {
    type: "solid",
    strokeType: "solid",
    color: { r: 0, g: 0, b: 0, a: 255 },
    width: 2,
    caps: "round",
    joints: "round",
    miterLimit: 3,
    style,
  };
}

/** Recover the stroke's style from a re-imported document. */
function reimportedStrokeStyle(stroke: Stroke): StrokeStyle | undefined {
  const out = tryLoadRealFla(saveRealFla(docWithStroke(stroke)));
  expect(out).not.toBeNull();
  const objects = out!.scenes[0]!.timeline.layers[0]!.frames[0]!.displayObjects;
  const shape = objects.find((o): o is ShapeDisplayObject => o.type === "shape");
  expect(shape).toBeDefined();
  const strokePath = shape!.shape.paths.find((p) => p.stroke);
  expect(strokePath).toBeDefined();
  return strokePath!.stroke!.style;
}

describe("saveRealFla — non-solid stroke styles round-trip (task 1410)", () => {
  const cases: StrokeStyle[] = [
    { type: "dashed", dashLength: 10, gapLength: 5 },
    { type: "dotted", dotSpacing: 4.5 },
    { type: "ragged", pattern: "random", waveHeight: "wild", roughness: "fine" },
    { type: "stippled", dotSize: "large", dotVariation: "randomTransition", density: "verySparse" },
    {
      type: "hatched",
      hatchThickness: "varied",
      space: "veryDistant",
      jiggle: "wild",
      rotate: "free",
      curve: "veryCurved",
      length: "random",
    },
  ];

  for (const style of cases) {
    it(`preserves a ${style.type} stroke with non-default parameters`, () => {
      expect(reimportedStrokeStyle(makeStroke(style))).toEqual(style);
    });
  }

  it("a plain solid stroke reimports with no style field (byte-neutral params)", () => {
    const solid: Stroke = {
      type: "solid",
      strokeType: "solid",
      color: { r: 0, g: 0, b: 0, a: 255 },
      width: 2,
      caps: "round",
      joints: "round",
      miterLimit: 3,
    };
    expect(reimportedStrokeStyle(solid)).toBeUndefined();
  });
});
