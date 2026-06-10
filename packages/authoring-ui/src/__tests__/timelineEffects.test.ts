/**
 * Unit tests for the Timeline Effects macro expansion logic.
 *
 * These tests verify the pure model transformation performed by
 * handleApplyTimelineEffect in Shell.tsx — specifically the Transform and
 * Transition effects.
 *
 * Because the handler is a React callback, the tests inline an equivalent
 * pure-function version of the macro that operates on model primitives.
 */

import { describe, it, expect } from "vitest";
import type { Layer as FlashLayer, Frame as FlashFrame, DisplayObject as FlashDisplayObject } from "@flash/core";
import {
  createFrame,
  createLayer,
  createTimeline,
  createSymbolInLibrary,
  insertKeyframe,
  setMotionTween,
  getUnionBounds,
} from "@flash/core";
import type {
  FlashDocument,
  Frame,
  Library,
  Timeline as TimelineModel,
  SymbolInstance,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Minimal document helpers
// ---------------------------------------------------------------------------

function makeLibrary(): Library {
  return { items: [], folders: [] };
}

function makeDoc(tl: TimelineModel, library: Library): FlashDocument {
  return {
    id: "test-doc",
    properties: {
      width: 550,
      height: 400,
      frameRate: 24,
      backgroundColor: "#ffffff",
      rulerUnits: "px",
      grid: { showGrid: false, snapToGrid: false, gridColor: "#999", gridWidth: 18, gridHeight: 18 },
      guides: [],
      snapToObjects: false,
      snapToPixels: false,
      snapToGuides: false,
    },
    scenes: [{ id: "scene-1", name: "Scene 1", timeline: tl }],
    library,
  };
}

/** Shape display object factory */
function makeShapeObj(id: string, x = 0, y = 0) {
  return {
    type: "shape" as const,
    id,
    shape: { id: `shape-${id}`, paths: [] as const },
    x,
    y,
  };
}

// ---------------------------------------------------------------------------
// Inline macro expansion (mirrors handleApplyTimelineEffect in Shell.tsx)
// ---------------------------------------------------------------------------

interface TransformParams {
  effect: "transform";
  duration: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
  ease: number;
}

interface TransitionParams {
  effect: "transition";
  duration: number;
  direction: "in" | "out";
  type: "fade" | "wipe";
  ease: number;
}

type EffectParams = TransformParams | TransitionParams;

let effectCounter = 0;

/**
 * Pure-function version of handleApplyTimelineEffect.
 * Returns the updated document and the id of the new symbol instance.
 */
function applyTimelineEffect(
  doc: FlashDocument,
  sceneIndex: number,
  layerIndex: number,
  currentFrame: number,
  selectedId: string | null,
  params: EffectParams
): { doc: FlashDocument; instanceId: string } | null {
  const scene = doc.scenes[sceneIndex];
  if (!scene) return null;
  const tl = scene.timeline;
  const layer = tl.layers[layerIndex];
  if (!layer) return null;

  const kf = [...layer.frames]
    .filter((f) => f.isKeyframe && f.index <= currentFrame)
    .sort((a, b) => b.index - a.index)[0];
  if (!kf) return null;

  const objectsToConvert = selectedId
    ? kf.displayObjects.filter((o) => o.id === selectedId)
    : kf.displayObjects;
  if (objectsToConvert.length === 0) return null;

  effectCounter += 1;
  const effectLabel = params.effect === "transform" ? "Transform" : "Transition";
  const symbolName = `${effectLabel} ${effectCounter}`;

  const selectionBounds = getUnionBounds([...objectsToConvert]);
  const originX = selectionBounds ? selectionBounds.x + selectionBounds.width / 2 : 0;
  const originY = selectionBounds ? selectionBounds.y + selectionBounds.height / 2 : 0;

  const symbolObjects = objectsToConvert.map((o) => ({
    ...o,
    x: o.x - originX,
    y: o.y - originY,
  }));

  const { library: libWithSym, item: newSymbol } = createSymbolInLibrary(
    doc.library,
    symbolName,
    "movieclip"
  );

  const symbolWithObjects = {
    ...newSymbol,
    timeline: {
      layers: [
        {
          ...newSymbol.timeline.layers[0],
          frames: [
            {
              ...newSymbol.timeline.layers[0].frames[0],
              displayObjects: symbolObjects,
              isEmpty: false,
            },
          ],
        },
      ],
    },
  };

  const finalLib: Library = {
    ...libWithSym,
    items: libWithSym.items.map((i) => (i.id === newSymbol.id ? symbolWithObjects : i)),
  };

  const symNatW = selectionBounds?.width ?? 0;
  const symNatH = selectionBounds?.height ?? 0;

  const instId = `effect-inst-${effectCounter}`;

  const startAlpha: number | undefined =
    params.effect === "transition" && params.direction === "in" ? 0 : undefined;

  const startInstance: SymbolInstance = {
    type: "instance",
    id: instId,
    symbolId: newSymbol.id,
    x: originX,
    y: originY,
    ...(symNatW > 0 ? { naturalWidth: symNatW } : {}),
    ...(symNatH > 0 ? { naturalHeight: symNatH } : {}),
    ...(startAlpha !== undefined ? { colorEffect: { type: "alpha", alpha: startAlpha * 100 } } : {}),
  };

  const endFrameIndex = currentFrame + params.duration - 1;

  // Build as a mutable record (SymbolInstance is all-readonly)
  type ColorEffect = { type: "alpha"; alpha: number };
  const endUpdatesBuilder: {
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    colorEffect?: ColorEffect;
  } = {};
  if (params.effect === "transform") {
    if (params.scaleX !== 1 || params.scaleY !== 1) {
      endUpdatesBuilder.scaleX = params.scaleX;
      endUpdatesBuilder.scaleY = params.scaleY;
    }
    if (params.rotation !== 0) {
      endUpdatesBuilder.rotation = params.rotation;
    }
    if (params.alpha !== 100) {
      endUpdatesBuilder.colorEffect = { type: "alpha", alpha: params.alpha };
    }
  } else {
    const endAlpha = params.direction === "out" ? 0 : 100;
    endUpdatesBuilder.colorEffect = { type: "alpha", alpha: endAlpha };
  }
  const endInstanceUpdates = endUpdatesBuilder as Partial<SymbolInstance>;

  const convertedIds = new Set(objectsToConvert.map((o) => o.id));
  const ease = params.ease ?? 0;
  const layerId = layer.id;

  const applyToTimeline = (t: TimelineModel): TimelineModel => {
    // Replace originals with start instance
    let result: TimelineModel = {
      ...t,
      layers: t.layers.map((l) => {
        if (l.id !== layerId) return l;
        const frames = l.frames.map((f) => {
          if (!f.isKeyframe || f.index !== kf.index) return f;
          const remaining = f.displayObjects.filter((o) => !convertedIds.has(o.id));
          return { ...f, displayObjects: [...remaining, startInstance] as readonly FlashDisplayObject[], isEmpty: false };
        }) as readonly FlashFrame[];
        return { ...l, frames };
      }) as readonly FlashLayer[],
    };

    // Insert end keyframe
    result = insertKeyframe(result, layerId, endFrameIndex);

    // Update end keyframe instance
    result = {
      ...result,
      layers: result.layers.map((l) => {
        if (l.id !== layerId) return l;
        const frames = l.frames.map((f) => {
          if (!f.isKeyframe || f.index !== endFrameIndex) return f;
          const newObjs: readonly FlashDisplayObject[] = f.displayObjects.map((o) =>
            o.id === instId ? ({ ...o, ...endInstanceUpdates } as FlashDisplayObject) : o
          );
          return { ...f, displayObjects: newObjs };
        }) as readonly FlashFrame[];
        return { ...l, frames };
      }) as readonly FlashLayer[],
    };

    // Motion tween on start keyframe
    result = setMotionTween(result, layerId, kf.index, ease);

    return result;
  };

  const newTimeline = applyToTimeline(tl);
  const newDoc: FlashDocument = {
    ...doc,
    scenes: doc.scenes.map((s, i) =>
      i === sceneIndex ? { ...s, timeline: newTimeline } : s
    ),
    library: finalLib,
  };

  return { doc: newDoc, instanceId: instId };
}

// ---------------------------------------------------------------------------
// Helper — get the governing keyframe from the result document
// ---------------------------------------------------------------------------

function getKfAtFrame(doc: FlashDocument, sceneIdx: number, layerIdx: number, frameIdx: number): Frame | undefined {
  const tl = doc.scenes[sceneIdx]?.timeline;
  const layer = tl?.layers[layerIdx];
  return layer?.frames
    .filter((f) => f.isKeyframe && f.index === frameIdx)[0];
}

// ---------------------------------------------------------------------------
// Tests — Transform effect
// ---------------------------------------------------------------------------

describe("applyTimelineEffect — Transform", () => {
  it("creates a motion tween spanning the specified duration", () => {
    const shape = makeShapeObj("s1", 100, 100);
    const kf0 = createFrame(0, { isKeyframe: true, isEmpty: false, displayObjects: [shape] });
    const layer = createLayer("Layer 1", "normal", { frames: [kf0], frameCount: 1 });
    const tl = createTimeline({ layers: [layer] });
    const doc = makeDoc(tl, makeLibrary());

    const result = applyTimelineEffect(doc, 0, 0, 0, "s1", {
      effect: "transform",
      duration: 10,
      scaleX: 2,
      scaleY: 2,
      rotation: 90,
      alpha: 100,
      ease: 0,
    });

    expect(result).not.toBeNull();
    const newTl = result!.doc.scenes[0].timeline;
    const layer0 = newTl.layers[0];

    // Start keyframe (frame 0) should have a motion tween
    const kf0After = layer0.frames.find((f) => f.isKeyframe && f.index === 0);
    expect(kf0After?.tweenType).toBe("motion");

    // End keyframe (frame 9) should exist (duration 10: frames 0–9)
    const kf9 = layer0.frames.find((f) => f.isKeyframe && f.index === 9);
    expect(kf9).toBeDefined();
  });

  it("end keyframe instance has scaleX=2, scaleY=2, rotation=90", () => {
    const shape = makeShapeObj("s1", 50, 50);
    const kf0 = createFrame(0, { isKeyframe: true, isEmpty: false, displayObjects: [shape] });
    const layer = createLayer("Layer 1", "normal", { frames: [kf0], frameCount: 1 });
    const tl = createTimeline({ layers: [layer] });
    const doc = makeDoc(tl, makeLibrary());

    const result = applyTimelineEffect(doc, 0, 0, 0, "s1", {
      effect: "transform",
      duration: 10,
      scaleX: 2,
      scaleY: 3,
      rotation: 90,
      alpha: 100,
      ease: 0,
    });

    const endKf = getKfAtFrame(result!.doc, 0, 0, 9);
    expect(endKf).toBeDefined();

    const endInst = endKf!.displayObjects.find((o) => o.id === result!.instanceId) as SymbolInstance;
    expect(endInst).toBeDefined();
    expect(endInst.scaleX).toBe(2);
    expect(endInst.scaleY).toBe(3);
    expect(endInst.rotation).toBe(90);
  });

  it("wraps the original object in a new MovieClip symbol in the library", () => {
    const shape = makeShapeObj("s1", 10, 20);
    const kf0 = createFrame(0, { isKeyframe: true, isEmpty: false, displayObjects: [shape] });
    const layer = createLayer("Layer 1", "normal", { frames: [kf0], frameCount: 1 });
    const tl = createTimeline({ layers: [layer] });
    const doc = makeDoc(tl, makeLibrary());

    const result = applyTimelineEffect(doc, 0, 0, 0, null, {
      effect: "transform",
      duration: 5,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 100,
      ease: 0,
    });

    const newLib = result!.doc.library;
    const newSymbol = newLib.items.find((i) => i.itemType === "symbol");
    expect(newSymbol).toBeDefined();
    expect(newSymbol?.name).toMatch(/^Transform/);
  });

  it("original object is replaced by a SymbolInstance on the start keyframe", () => {
    const shape = makeShapeObj("s1", 0, 0);
    const kf0 = createFrame(0, { isKeyframe: true, isEmpty: false, displayObjects: [shape] });
    const layer = createLayer("Layer 1", "normal", { frames: [kf0], frameCount: 1 });
    const tl = createTimeline({ layers: [layer] });
    const doc = makeDoc(tl, makeLibrary());

    const result = applyTimelineEffect(doc, 0, 0, 0, "s1", {
      effect: "transform",
      duration: 5,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 100,
      ease: 0,
    });

    const startKf = getKfAtFrame(result!.doc, 0, 0, 0);
    expect(startKf?.displayObjects).toHaveLength(1);
    expect(startKf?.displayObjects[0]?.type).toBe("instance");
    expect(startKf?.displayObjects[0]?.id).toBe(result!.instanceId);
  });

  it("applies ease to the motion tween", () => {
    const shape = makeShapeObj("s1");
    const kf0 = createFrame(0, { isKeyframe: true, isEmpty: false, displayObjects: [shape] });
    const layer = createLayer("Layer 1", "normal", { frames: [kf0], frameCount: 1 });
    const tl = createTimeline({ layers: [layer] });
    const doc = makeDoc(tl, makeLibrary());

    const result = applyTimelineEffect(doc, 0, 0, 0, "s1", {
      effect: "transform",
      duration: 20,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 100,
      ease: 75,
    });

    const newLayer = result!.doc.scenes[0].timeline.layers[0];
    const startKf = newLayer.frames.find((f) => f.isKeyframe && f.index === 0);
    expect(startKf?.motionEase).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Tests — Transition effect
// ---------------------------------------------------------------------------

describe("applyTimelineEffect — Transition", () => {
  it("fade in: start instance has alpha=0, end instance has alpha=100", () => {
    const shape = makeShapeObj("s2", 30, 30);
    const kf0 = createFrame(0, { isKeyframe: true, isEmpty: false, displayObjects: [shape] });
    const layer = createLayer("Layer 1", "normal", { frames: [kf0], frameCount: 1 });
    const tl = createTimeline({ layers: [layer] });
    const doc = makeDoc(tl, makeLibrary());

    const result = applyTimelineEffect(doc, 0, 0, 0, "s2", {
      effect: "transition",
      duration: 15,
      direction: "in",
      type: "fade",
      ease: 0,
    });

    expect(result).not.toBeNull();

    const startKf = getKfAtFrame(result!.doc, 0, 0, 0);
    const startInst = startKf?.displayObjects.find((o) => o.id === result!.instanceId) as SymbolInstance;
    expect(startInst?.colorEffect?.type).toBe("alpha");
    expect(startInst?.colorEffect?.alpha).toBe(0); // 0% = 0 alpha * 100

    const endKf = getKfAtFrame(result!.doc, 0, 0, 14);
    const endInst = endKf?.displayObjects.find((o) => o.id === result!.instanceId) as SymbolInstance;
    expect(endInst?.colorEffect?.alpha).toBe(100);
  });

  it("fade out: start instance has full alpha, end instance has alpha=0", () => {
    const shape = makeShapeObj("s3", 30, 30);
    const kf0 = createFrame(0, { isKeyframe: true, isEmpty: false, displayObjects: [shape] });
    const layer = createLayer("Layer 1", "normal", { frames: [kf0], frameCount: 1 });
    const tl = createTimeline({ layers: [layer] });
    const doc = makeDoc(tl, makeLibrary());

    const result = applyTimelineEffect(doc, 0, 0, 0, "s3", {
      effect: "transition",
      duration: 10,
      direction: "out",
      type: "fade",
      ease: 0,
    });

    expect(result).not.toBeNull();

    // Start instance: no colorEffect (fully opaque by default)
    const startKf = getKfAtFrame(result!.doc, 0, 0, 0);
    const startInst = startKf?.displayObjects.find((o) => o.id === result!.instanceId) as SymbolInstance;
    // no colorEffect set on start for fade-out
    expect(startInst?.colorEffect).toBeUndefined();

    // End instance: alpha=0
    const endKf = getKfAtFrame(result!.doc, 0, 0, 9);
    const endInst = endKf?.displayObjects.find((o) => o.id === result!.instanceId) as SymbolInstance;
    expect(endInst?.colorEffect?.alpha).toBe(0);
  });

  it("sets a motion tween on the start keyframe", () => {
    const shape = makeShapeObj("s4", 0, 0);
    const kf0 = createFrame(0, { isKeyframe: true, isEmpty: false, displayObjects: [shape] });
    const layer = createLayer("Layer 1", "normal", { frames: [kf0], frameCount: 1 });
    const tl = createTimeline({ layers: [layer] });
    const doc = makeDoc(tl, makeLibrary());

    const result = applyTimelineEffect(doc, 0, 0, 0, "s4", {
      effect: "transition",
      duration: 20,
      direction: "in",
      type: "fade",
      ease: -50,
    });

    const newLayer = result!.doc.scenes[0].timeline.layers[0];
    const startKf = newLayer.frames.find((f) => f.isKeyframe && f.index === 0);
    expect(startKf?.tweenType).toBe("motion");
    expect(startKf?.motionEase).toBe(-50);
  });

  it("no-op when the keyframe has no display objects", () => {
    const kf0 = createFrame(0, { isKeyframe: true, isEmpty: true, displayObjects: [] });
    const layer = createLayer("Layer 1", "normal", { frames: [kf0], frameCount: 1 });
    const tl = createTimeline({ layers: [layer] });
    const doc = makeDoc(tl, makeLibrary());

    const result = applyTimelineEffect(doc, 0, 0, 0, null, {
      effect: "transition",
      duration: 10,
      direction: "in",
      type: "fade",
      ease: 0,
    });

    expect(result).toBeNull();
  });
});
