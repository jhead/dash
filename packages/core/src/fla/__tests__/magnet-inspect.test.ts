import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { tryLoadRealFla } from "../ole.js";
import type { Layer } from "../../model/types.js";

describe("Magnet.fla inspection", () => {
  it("has 6 scenes in authored play order (Contents-stream order, not Page-N order)", () => {
    const bytes = new Uint8Array(readFileSync("/Users/jhead/dev/flash/packages/core/fixtures/Magnet.fla"));
    const doc = tryLoadRealFla(bytes);
    if (!doc) throw new Error("failed to load");

    // Authored scene order is the order CDocumentPage records appear in the
    // Contents stream. The OLE2 "Page N" stream numbers are creation order
    // (AA was authored first as "Page 1" but lives 3rd in the Scenes panel),
    // so ordering by stream number would wrongly start the movie on "AA".
    expect(doc.scenes.length).toBe(6);
    expect(doc.scenes.map((s) => s.name)).toEqual([
      "Scene 2",
      "Scene 5",
      "AA",
      "BA",
      "AB",
      "BB",
    ]);
  });

  it("has 'menu' frame label in Scene 5 at frame 1", () => {
    const bytes = new Uint8Array(readFileSync("/Users/jhead/dev/flash/packages/core/fixtures/Magnet.fla"));
    const doc = tryLoadRealFla(bytes);
    if (!doc) throw new Error("failed to load");

    const scene5 = doc.scenes[1];
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

    const sceneAA = doc.scenes[2];
    expect(sceneAA.name).toBe("AA");

    const layers = sceneAA.timeline.layers;
    expect(layers.length).toBe(6);

    // The mask group: Ball, Walls, Magnets should be type=masked
    // Layer 5 should be type=mask and appear BEFORE its masked children
    // (lower model index = higher in panel = in front of the masked layers).
    // compile.ts expects the model convention: mask at li=X, masked at li=X+1, X+2, …
    const ball = layers.find((l: Layer) => l.name === "Ball");
    const walls = layers.find((l: Layer) => l.name === "Walls");
    const magnets = layers.find((l: Layer) => l.name === "Magnets");
    const maskLayer = layers.find((l: Layer) => l.type === "mask");

    expect(ball?.type).toBe("masked");
    expect(walls?.type).toBe("masked");
    expect(magnets?.type).toBe("masked");
    expect(maskLayer?.name).toBe("Layer 5");

    // Mask layer must be at a LOWER index than its masked children so that
    // compile.ts can find masked children at li+1, li+2, … when it iterates.
    const maskIdx = layers.findIndex((l: Layer) => l.type === "mask");
    const ballIdx = layers.findIndex((l: Layer) => l.name === "Ball");
    expect(maskIdx).toBeLessThan(ballIdx);
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
