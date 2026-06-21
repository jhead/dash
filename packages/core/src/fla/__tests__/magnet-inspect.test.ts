import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tryLoadRealFla } from "../ole.js";
import type { Layer } from "../../model/types.js";

const MAGNET_FLA = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/Magnet.fla");

describe("Magnet.fla inspection", () => {
  it("has 6 scenes in authored play order (Contents-stream order, not Page-N order)", () => {
    const bytes = new Uint8Array(readFileSync(MAGNET_FLA));
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
    const bytes = new Uint8Array(readFileSync(MAGNET_FLA));
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
    const bytes = new Uint8Array(readFileSync(MAGNET_FLA));
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

  it("scene 5 (scene 1) mask clips BOTH 'Layer 5' and 'Ball' (task 1341)", () => {
    // Regression for task 1341: in Scene 5 ('Page 5') the mask 'Layer 5' has two
    // masked children stored on OPPOSITE sides of it in the bottom-to-top binary:
    //   [bin 0] 'Layer 3' normal
    //   [bin 1] 'Ball'    masked child (parentRef is the 0x8000 backref form)
    //   [bin 2] 'Layer 5' MASK (type=4)
    //   [bin 3] 'Layer 5' masked child (parentRef = mask's running object index)
    // The old single forward scan only promoted children AFTER the mask, so
    // 'Ball' (before the mask) was dropped from the mask group and rendered
    // un-masked. Assert the mask now owns BOTH masked children.
    const bytes = new Uint8Array(readFileSync(MAGNET_FLA));
    const doc = tryLoadRealFla(bytes);
    if (!doc) throw new Error("failed to load");

    const scene5 = doc.scenes[1];
    expect(scene5.name).toBe("Scene 5");

    const layers = scene5.timeline.layers;
    expect(layers.length).toBe(4);

    // The mask is named 'Layer 5'; one masked child is the other 'Layer 5'.
    const maskLayer = layers.find((l: Layer) => l.type === "mask");
    expect(maskLayer?.name).toBe("Layer 5");

    // Both 'Ball' and the masked 'Layer 5' must be masked children — order
    // independent (the bug dropped 'Ball' to type 'normal').
    const ball = layers.find((l: Layer) => l.name === "Ball");
    expect(ball?.type).toBe("masked");
    const maskedLayer5 = layers.find(
      (l: Layer) => l.name === "Layer 5" && l.type === "masked",
    );
    expect(maskedLayer5).toBeDefined();

    // 'Layer 3' stays a normal, un-masked layer.
    const layer3 = layers.find((l: Layer) => l.name === "Layer 3");
    expect(layer3?.type).toBe("normal");

    // Model invariant (compile.ts depends on it): the mask sits ABOVE its masked
    // children at contiguous lower indices, i.e. mask at li=k and the masked
    // children at li=k+1, k+2.
    const maskIdx = layers.findIndex((l: Layer) => l.type === "mask");
    const maskedIdxs = layers
      .map((l: Layer, i: number) => (l.type === "masked" ? i : -1))
      .filter((i: number) => i >= 0);
    expect(maskedIdxs.length).toBe(2);
    for (const mi of maskedIdxs) expect(mi).toBeGreaterThan(maskIdx);
    expect(maskedIdxs).toEqual([maskIdx + 1, maskIdx + 2]);
  });

  it("ballmask symbol (Symbol 27) has gotoAndPlay navigation script at frame 9", () => {
    const bytes = new Uint8Array(readFileSync(MAGNET_FLA));
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
