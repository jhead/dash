/**
 * FLA round-trip tests: frame script preservation.
 *
 * Verifies that AS2 scripts attached to keyframes survive a saveFla/loadFla
 * round-trip without modification.
 */

import { describe, it, expect } from "vitest";
import { createDocument } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import {
  createLayer,
  createFrame,
} from "../../model/timeline.js";
import { saveFla, loadFla } from "../zip.js";
import type { FlashDocument, Scene } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal FlashDocument with a single scene + single layer
// containing the given frames.
// ---------------------------------------------------------------------------
function buildDoc(layers: ReturnType<typeof createLayer>[]): FlashDocument {
  const scene: Scene = {
    id: "sc-script-test",
    name: "Scene 1",
    timeline: { layers },
  };
  return { ...createDocument(), scenes: [scene] };
}

// ---------------------------------------------------------------------------
// 1. Frame with script: 'trace("hello")' survives saveFla/loadFla
// ---------------------------------------------------------------------------
describe("framescript: simple trace", () => {
  it('1. script: trace("hello") survives round-trip', () => {
    const script = 'trace("hello")';
    const layer = createLayer("Layer 1", "normal", {
      frames: [createFrame(0, { isKeyframe: true, isEmpty: false, script })],
      frameCount: 1,
    });
    const doc = buildDoc([layer]);
    const restored = loadFla(saveFla(doc));
    const restoredFrame = restored.scenes[0]?.timeline.layers[0]?.frames[0];
    expect(restoredFrame?.script).toBe(script);
  });
});

// ---------------------------------------------------------------------------
// 2. Multiline script survives round-trip
// ---------------------------------------------------------------------------
describe("framescript: multiline script", () => {
  it("2. multiline script survives round-trip", () => {
    const script = "var x:Number = 42;\ntrace(x);";
    const layer = createLayer("Layer 1", "normal", {
      frames: [createFrame(0, { isKeyframe: true, isEmpty: false, script })],
      frameCount: 1,
    });
    const doc = buildDoc([layer]);
    const restored = loadFla(saveFla(doc));
    const restoredFrame = restored.scenes[0]?.timeline.layers[0]?.frames[0];
    expect(restoredFrame?.script).toBe(script);
  });
});

// ---------------------------------------------------------------------------
// 3. Script with special characters (escaped quotes) survives round-trip
// ---------------------------------------------------------------------------
describe("framescript: special characters", () => {
  it('3. script with escaped quotes survives round-trip', () => {
    const script = 'trace("quotes: \\"test\\"");';
    const layer = createLayer("Layer 1", "normal", {
      frames: [createFrame(0, { isKeyframe: true, isEmpty: false, script })],
      frameCount: 1,
    });
    const doc = buildDoc([layer]);
    const restored = loadFla(saveFla(doc));
    const restoredFrame = restored.scenes[0]?.timeline.layers[0]?.frames[0];
    expect(restoredFrame?.script).toBe(script);
  });
});

// ---------------------------------------------------------------------------
// 4. Two frames on different layers with different scripts — both survive
// ---------------------------------------------------------------------------
describe("framescript: two layers with different scripts", () => {
  it("4. scripts on two different layers both survive round-trip", () => {
    const script1 = 'trace("layer1");';
    const script2 = 'trace("layer2");';
    const layer1 = createLayer("Layer 1", "normal", {
      frames: [createFrame(0, { isKeyframe: true, isEmpty: false, script: script1 })],
      frameCount: 1,
    });
    const layer2 = createLayer("Layer 2", "normal", {
      frames: [createFrame(0, { isKeyframe: true, isEmpty: false, script: script2 })],
      frameCount: 1,
    });
    const doc = buildDoc([layer1, layer2]);
    const restored = loadFla(saveFla(doc));
    const restoredFrame1 = restored.scenes[0]?.timeline.layers[0]?.frames[0];
    const restoredFrame2 = restored.scenes[0]?.timeline.layers[1]?.frames[0];
    expect(restoredFrame1?.script).toBe(script1);
    expect(restoredFrame2?.script).toBe(script2);
  });
});

// ---------------------------------------------------------------------------
// 5. Frame with script: '' — empty string survives as empty string
// ---------------------------------------------------------------------------
describe("framescript: empty script", () => {
  it("5. empty script string survives round-trip as empty string", () => {
    const script = "";
    const layer = createLayer("Layer 1", "normal", {
      frames: [createFrame(0, { isKeyframe: true, isEmpty: true, script })],
      frameCount: 1,
    });
    const doc = buildDoc([layer]);
    const restored = loadFla(saveFla(doc));
    const restoredFrame = restored.scenes[0]?.timeline.layers[0]?.frames[0];
    // Empty script should be preserved (either empty string or undefined/absent, but not corrupted)
    expect(restoredFrame?.script ?? "").toBe(script);
  });
});

// ---------------------------------------------------------------------------
// 6. Multiple keyframes with scripts — all scripts preserved
// ---------------------------------------------------------------------------
describe("framescript: multiple keyframes", () => {
  it("6. multiple keyframes with scripts all survive round-trip", () => {
    const script0 = 'stop();';
    const script5 = 'gotoAndPlay(1);';
    const script10 = 'trace("end");';
    const layer = createLayer("Actions", "normal", {
      frames: [
        createFrame(0,  { isKeyframe: true, isEmpty: false, script: script0 }),
        createFrame(5,  { isKeyframe: true, isEmpty: false, script: script5 }),
        createFrame(10, { isKeyframe: true, isEmpty: false, script: script10 }),
      ],
      frameCount: 15,
    });
    const doc = buildDoc([layer]);
    const restored = loadFla(saveFla(doc));
    const restoredFrames = restored.scenes[0]?.timeline.layers[0]?.frames ?? [];
    const byIndex = new Map(restoredFrames.map((f) => [f.index, f.script]));
    expect(byIndex.get(0)).toBe(script0);
    expect(byIndex.get(5)).toBe(script5);
    expect(byIndex.get(10)).toBe(script10);
  });
});
