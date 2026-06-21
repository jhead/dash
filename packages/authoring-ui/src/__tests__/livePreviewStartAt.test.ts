import { describe, it, expect } from "vitest";
import { createDocument, addScene, compileAS2 } from "@flash/core";
import type { FlashDocument } from "@flash/core";
import {
  applyStartAt,
  buildStartScript,
  sceneFrameCount,
} from "../preview/startAt.js";

/**
 * Compile an AS2 source string and decode the integer operand of the LAST
 * ActionPush (0x96) that immediately precedes ActionGotoFrame2 (0x9F). Returns
 * the frame number the GotoFrame2 will seek to. Also asserts the GotoFrame2
 * flags byte has SceneBiasFlag (bit 1) = 0 — i.e. it's a plain absolute-frame
 * goto, not a scene-biased one. (Verifies the fix at the bytecode level.)
 */
function decodeGotoFrameOperand(source: string): { frame: number; play: boolean } {
  const bytes = compileAS2(source);
  const gotoIdx = bytes.indexOf(0x9f);
  expect(gotoIdx).toBeGreaterThanOrEqual(0);
  // GotoFrame2 payload: length (UI16 LE) then flags byte. SceneBiasFlag = bit 1.
  const flags = bytes[gotoIdx + 3]!;
  expect(flags & 0x02).toBe(0); // SceneBiasFlag must be 0 (no scene operand follows)
  // Walk the ActionPush record right before GotoFrame2.
  // ActionPush: 0x96, len(UI16 LE), then typed values. Type 0x07 = UI32 integer.
  const pushIdx = bytes.lastIndexOf(0x96, gotoIdx);
  expect(pushIdx).toBeGreaterThanOrEqual(0);
  const type = bytes[pushIdx + 3];
  expect(type).toBe(0x07); // a literal integer was pushed (not a string)
  const lo = bytes[pushIdx + 4]!;
  const b1 = bytes[pushIdx + 5]!;
  const b2 = bytes[pushIdx + 6]!;
  const hi = bytes[pushIdx + 7]!;
  const frame = (lo | (b1 << 8) | (b2 << 16) | (hi << 24)) >>> 0;
  return { frame, play: (flags & 0x01) === 0x01 };
}

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
  // frameCount must reflect the new span — layerFrameCount (used by both
  // sceneFrameCount and the SWF compiler) prefers the explicit frameCount field
  // over max-keyframe-index, so a stale frameCount:1 would under-count.
  const newLayer0 = { ...layer0, frames, frameCount: count };
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
    timeline: {
      ...scene.timeline,
      layers: [{ ...layer0, frames, frameCount: count }, ...scene.timeline.layers.slice(1)],
    },
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

  it("targets a later scene by ABSOLUTE frame, not by scene name (task 1339)", () => {
    // Scene 0 has 1 frame (createDocument default), scene 1 ("Level Two") has 5.
    // The compiled main timeline concatenates scenes, so scene 1 begins at
    // absolute frame 2 (1 frame of scene 0 + 1). Frame 3 within scene 1 is
    // absolute frame 1 (scene-0 offset) + 3 = 4.
    let doc = createDocument();
    doc = addScene(doc, "Level Two");
    doc = { ...doc, scenes: [doc.scenes[0], extendScene(doc.scenes[1], 5)] };
    const script = buildStartScript(doc, { sceneIndex: 1, frame: 3 });
    // NOT the old no-op gotoAndPlay("Level Two", 3) — an absolute numeric frame.
    expect(script).toBe("gotoAndPlay(4);");
    expect(script).not.toContain("Level Two");
  });

  it("maps scene 1 frame 1 to the scene's absolute START frame (task 1339)", () => {
    let doc = createDocument(); // scene 0 = 1 frame
    doc = addScene(doc, "Level Two");
    doc = { ...doc, scenes: [doc.scenes[0], extendScene(doc.scenes[1], 5)] };
    // scene-0 offset is 1, so scene 1 / frame 1 = absolute frame 2.
    expect(buildStartScript(doc, { sceneIndex: 1, frame: 1 })).toBe("gotoAndPlay(2);");
  });

  it("sums multiple preceding scenes for the absolute offset (task 1339)", () => {
    let doc = createDocument();
    doc = addScene(doc, "Two");
    doc = addScene(doc, "Three");
    // scene 0 = 10 frames, scene 1 = 7 frames, scene 2 = 5 frames.
    doc = {
      ...doc,
      scenes: [
        extendScene(doc.scenes[0], 10),
        extendScene(doc.scenes[1], 7),
        extendScene(doc.scenes[2], 5),
      ],
    };
    // scene 2 begins at absolute frame 10 + 7 + 1 = 18; frame 3 within = 20.
    expect(buildStartScript(doc, { sceneIndex: 2, frame: 3 })).toBe("gotoAndPlay(20);");
  });

  it("emits gotoAndStop with the absolute frame when hold is set (task 1339)", () => {
    let doc = createDocument();
    doc = addScene(doc, "Two");
    doc = { ...doc, scenes: [extendScene(doc.scenes[0], 4), extendScene(doc.scenes[1], 5)] };
    // scene 1 begins at absolute frame 5; frame 2 within = 6.
    expect(buildStartScript(doc, { sceneIndex: 1, frame: 2, hold: true })).toBe(
      "gotoAndStop(6);"
    );
  });

  it("clamps an out-of-range scene index", () => {
    const doc = createDocument();
    // Only one scene; index 9 clamps to 0 → default frame 1 play → null.
    expect(buildStartScript(doc, { sceneIndex: 9, frame: 1 })).toBeNull();
  });
});

describe("startAt — emitted GotoFrame2 lands at the absolute frame (task 1339)", () => {
  it("scene 1 / frame 3 compiles to GotoFrame2(absolute 4), play, no scene bias", () => {
    let doc = createDocument(); // scene 0 = 1 frame
    doc = addScene(doc, "Level Two");
    doc = { ...doc, scenes: [doc.scenes[0], extendScene(doc.scenes[1], 5)] };
    const script = buildStartScript(doc, { sceneIndex: 1, frame: 3 })!;
    const { frame, play } = decodeGotoFrameOperand(script);
    expect(frame).toBe(4); // scene-0 offset (1) + frame 3
    expect(play).toBe(true);
  });

  it("differs from the WITHOUT-override default (frame 1) — proves the override takes effect", () => {
    let doc = createDocument();
    doc = addScene(doc, "Level Two");
    doc = { ...doc, scenes: [doc.scenes[0], extendScene(doc.scenes[1], 5)] };
    // Default: scene 0 / frame 1 → null (no seek, plays from frame 1).
    expect(buildStartScript(doc, { sceneIndex: 0, frame: 1 })).toBeNull();
    // Override: scene 1 / frame 1 → GotoFrame2(2) (the start of scene 1).
    const overridden = buildStartScript(doc, { sceneIndex: 1, frame: 1 })!;
    expect(decodeGotoFrameOperand(overridden).frame).toBe(2);
  });

  it("hold (gotoAndStop) decodes the absolute frame with PlayFlag=0", () => {
    let doc = createDocument();
    doc = addScene(doc, "Two");
    doc = { ...doc, scenes: [extendScene(doc.scenes[0], 4), extendScene(doc.scenes[1], 5)] };
    const script = buildStartScript(doc, { sceneIndex: 1, frame: 2, hold: true })!;
    const { frame, play } = decodeGotoFrameOperand(script);
    expect(frame).toBe(6); // scene-0 offset (4) + frame 2
    expect(play).toBe(false);
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
