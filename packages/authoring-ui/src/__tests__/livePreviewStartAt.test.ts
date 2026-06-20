import { describe, it, expect } from "vitest";
import { createDocument, addScene } from "@flash/core";
import type { FlashDocument } from "@flash/core";
import {
  applyStartAt,
  buildStartScript,
  sceneFrameCount,
} from "../preview/startAt.js";

/**
 * Extend scene 0 / layer 0 to `count` frames (only the first is a keyframe), so
 * a start-from-frame seek isn't clamped back to frame 1 (a 1-frame movie can't
 * seek past its only frame — correct behaviour, but not what these tests probe).
 */
function withFrames(doc: FlashDocument, count: number): FlashDocument {
  const scene0 = doc.scenes[0];
  const layer0 = scene0.timeline.layers[0];
  const base = layer0.frames[0];
  const frames = [];
  for (let i = 0; i < count; i++) {
    frames.push(i === 0 ? base : { ...base, index: i, isKeyframe: false });
  }
  const newLayer0 = { ...layer0, frames };
  const newScene0 = {
    ...scene0,
    timeline: { ...scene0.timeline, layers: [newLayer0, ...scene0.timeline.layers.slice(1)] },
  };
  return { ...doc, scenes: [newScene0, ...doc.scenes.slice(1)] };
}

function extendScene<S extends FlashDocument["scenes"][number]>(scene: S, count: number): S {
  const layer0 = scene.timeline.layers[0];
  const base = layer0.frames[0];
  const frames = [];
  for (let i = 0; i < count; i++) {
    frames.push(i === 0 ? base : { ...base, index: i, isKeyframe: false });
  }
  return {
    ...scene,
    timeline: { ...scene.timeline, layers: [{ ...layer0, frames }, ...scene.timeline.layers.slice(1)] },
  };
}

describe("startAt — buildStartScript", () => {
  it("returns null for the default (scene 0, frame 1, play)", () => {
    const doc = createDocument();
    expect(buildStartScript(doc, { sceneIndex: 0, frame: 1 })).toBeNull();
  });

  it("emits gotoAndPlay(frame) for a later frame in scene 0", () => {
    const doc = withFrames(createDocument(), 10);
    expect(buildStartScript(doc, { sceneIndex: 0, frame: 5 })).toBe("gotoAndPlay(5);");
  });

  it("clamps a start frame past the scene length", () => {
    const doc = withFrames(createDocument(), 3);
    // Only 3 frames; asking for frame 9 clamps to 3.
    expect(buildStartScript(doc, { sceneIndex: 0, frame: 9 })).toBe("gotoAndPlay(3);");
  });

  it("emits gotoAndStop when hold is set", () => {
    const doc = createDocument();
    expect(buildStartScript(doc, { sceneIndex: 0, frame: 1, hold: true })).toBe(
      "gotoAndStop(1);"
    );
  });

  it("targets a later scene by name", () => {
    let doc = createDocument();
    doc = addScene(doc, "Level Two");
    doc = { ...doc, scenes: [doc.scenes[0], extendScene(doc.scenes[1], 5)] };
    const script = buildStartScript(doc, { sceneIndex: 1, frame: 3 });
    expect(script).toBe('gotoAndPlay("Level Two", 3);');
  });

  it("clamps an out-of-range scene index", () => {
    const doc = createDocument();
    // Only one scene; index 9 clamps to 0 → default frame 1 play → null.
    expect(buildStartScript(doc, { sceneIndex: 9, frame: 1 })).toBeNull();
  });
});

describe("startAt — sceneFrameCount", () => {
  it("counts at least 1 frame for a fresh scene", () => {
    const doc = createDocument();
    expect(sceneFrameCount(doc, 0)).toBeGreaterThanOrEqual(1);
  });
});

describe("startAt — applyStartAt", () => {
  it("returns the SAME doc reference when no seek is needed", () => {
    const doc = createDocument();
    expect(applyStartAt(doc, { sceneIndex: 0, frame: 1 })).toBe(doc);
  });

  it("prepends the seek to scene-0 layer-0 keyframe-1 without mutating the original", () => {
    const doc = withFrames(createDocument(), 10);
    const out = applyStartAt(doc, { sceneIndex: 0, frame: 4 });
    expect(out).not.toBe(doc);
    const kf = out.scenes[0].timeline.layers[0].frames.find((f) => f.isKeyframe);
    expect(kf?.script).toContain("gotoAndPlay(4);");
    // Original is untouched.
    const origKf = doc.scenes[0].timeline.layers[0].frames.find((f) => f.isKeyframe);
    expect(origKf?.script ?? "").not.toContain("gotoAndPlay");
  });

  it("preserves an existing author script after the seek", () => {
    let doc = withFrames(createDocument(), 10);
    const layer0 = doc.scenes[0].timeline.layers[0];
    const kfIdx = layer0.frames.findIndex((f) => f.isKeyframe);
    const frames = layer0.frames.map((f, i) =>
      i === kfIdx ? { ...f, script: 'trace("hi");' } : f
    );
    const scene0 = {
      ...doc.scenes[0],
      timeline: { ...doc.scenes[0].timeline, layers: [{ ...layer0, frames }, ...doc.scenes[0].timeline.layers.slice(1)] },
    };
    doc = { ...doc, scenes: [scene0, ...doc.scenes.slice(1)] };

    const out = applyStartAt(doc, { sceneIndex: 0, frame: 2 });
    const kf = out.scenes[0].timeline.layers[0].frames.find((f) => f.isKeyframe);
    expect(kf?.script).toBe('gotoAndPlay(2);\ntrace("hi");');
  });
});
