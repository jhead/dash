import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { tryLoadRealFla } from "../ole.js";
import type { Layer } from "../../model/types.js";

describe("Magnet.fla inspection", () => {
  it("has 6 scenes with expected names", () => {
    const bytes = new Uint8Array(readFileSync("/Users/jhead/dev/flash/packages/core/fixtures/Magnet.fla"));
    const doc = tryLoadRealFla(bytes);
    if (!doc) throw new Error("failed to load");

    expect(doc.scenes.length).toBe(6);
    expect(doc.scenes[0].name).toBe("AA");
    expect(doc.scenes[2].name).toBe("Scene 5"); // contains "menu" frame label
  });

  it("has 'menu' frame label in Scene 5 at frame 1", () => {
    const bytes = new Uint8Array(readFileSync("/Users/jhead/dev/flash/packages/core/fixtures/Magnet.fla"));
    const doc = tryLoadRealFla(bytes);
    if (!doc) throw new Error("failed to load");

    const scene5 = doc.scenes[2];
    expect(scene5.name).toBe("Scene 5");

    let menuFound = false;
    for (const layer of scene5.timeline.layers) {
      for (const frame of layer.frames) {
        if (frame.label === "menu" && frame.isKeyframe) {
          expect(frame.index).toBe(1);
          expect(frame.labelType).toBe("name");
          menuFound = true;
        }
      }
    }
    expect(menuFound).toBe(true);
  });

  it("scene AA (scene 0) has Ball/Walls/Magnets as masked under Layer 5 mask", () => {
    const bytes = new Uint8Array(readFileSync("/Users/jhead/dev/flash/packages/core/fixtures/Magnet.fla"));
    const doc = tryLoadRealFla(bytes);
    if (!doc) throw new Error("failed to load");

    const sceneAA = doc.scenes[0];
    expect(sceneAA.name).toBe("AA");

    const layers = sceneAA.timeline.layers;
    expect(layers.length).toBe(6);

    // The mask group: Ball, Walls, Magnets should be type=masked
    // Layer 5 should be type=mask and appear AFTER the masked layers
    // (higher model index = lower in panel = rendered first in bottom-up pass).
    const ball = layers.find((l: Layer) => l.name === "Ball");
    const walls = layers.find((l: Layer) => l.name === "Walls");
    const magnets = layers.find((l: Layer) => l.name === "Magnets");
    const maskLayer = layers.find((l: Layer) => l.type === "mask");

    expect(ball?.type).toBe("masked");
    expect(walls?.type).toBe("masked");
    expect(magnets?.type).toBe("masked");
    expect(maskLayer?.name).toBe("Layer 5");

    // Mask layer is below the masked layers in the panel (higher model index).
    const maskIdx = layers.findIndex((l: Layer) => l.type === "mask");
    const ballIdx = layers.findIndex((l: Layer) => l.name === "Ball");
    expect(maskIdx).toBeGreaterThan(ballIdx);
  });

  it("ballmask symbol (Symbol 27) has gotoAndPlay navigation script at frame 9", () => {
    const bytes = new Uint8Array(readFileSync("/Users/jhead/dev/flash/packages/core/fixtures/Magnet.fla"));
    const doc = tryLoadRealFla(bytes);
    if (!doc) throw new Error("failed to load");

    // ballmask = Symbol 27, which is the transition MovieClip
    // Its frame 9 script calls _parent.gotoAndPlay(tgt) for scene navigation
    let ballmaskFound = false;
    for (const item of doc.library.items) {
      if (item.itemType === "symbol" && item.name === "Symbol 27") {
        const sym = item as any;
        let hasNavScript = false;
        for (const layer of sym.timeline.layers) {
          for (const frame of layer.frames) {
            if (frame.index === 9 && frame.script && frame.script.includes("gotoAndPlay")) {
              hasNavScript = true;
            }
          }
        }
        expect(hasNavScript).toBe(true);
        ballmaskFound = true;
      }
    }
    expect(ballmaskFound).toBe(true);
  });
});
