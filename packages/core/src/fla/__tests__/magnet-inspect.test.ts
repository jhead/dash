import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tryLoadRealFla, __readAllStreamsForTest } from "../ole.js";
import { parseFla8Timeline } from "../flash8-binary.js";
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

  // Task 1342 — Scene 5 ('Page 5') Ball-layer frame count + 'menu' label position.
  //
  // The QA report said Scene 5 "should be 1 frame" with 'menu' on "frame 1", and that
  // our import wrongly shows 2 frames with 'menu' on "frame 2". The raw byte evidence
  // refutes that: the 'Page 5' stream physically contains TWO distinct, fully-formed
  // CPicFrame records on the 'Ball' layer — a leading EMPTY keyframe (dur=1, label="",
  // script="", 0 elements) followed by the content keyframe (dur=1, label='menu',
  // script='stop()', 3 elements = Symbol 2 + Symbol 9 + static text). Both records are
  // present in the bytes (the empty frame's label BomString and the 'menu'/'stop()'
  // BomStrings were located in the stream), so there is NO phantom keyframe being
  // fabricated by the parser. Real Flash 8 reading the same file would likewise show a
  // blank keyframe at frame 1 and the menu content at frame 2; the "should be 1 frame"
  // recollection is an off-by-one (UI frame 2 = 0-based model index 1).
  //
  // The acceptance is therefore: the model import must faithfully match the raw
  // parseFla8Timeline ground truth. This test DERIVES its expectation from that ground
  // truth (rather than hard-coding the old, misleadingly-named `frame.index === 1`
  // assertion) and asserts the import reproduces it exactly.
  it("Scene 5 Ball layer imports its full ground-truth frame count + 'menu' label (task 1342)", () => {
    const bytes = new Uint8Array(readFileSync(MAGNET_FLA));

    // --- ground truth: raw timeline parse of the 'Page 5' stream ----------------
    const streams = __readAllStreamsForTest(bytes);
    let page5: Uint8Array | undefined;
    for (const [name, data] of streams) {
      if (/Page 5$/.test(name)) page5 = data;
    }
    if (!page5) throw new Error("Page 5 stream not found");
    const rawTl = parseFla8Timeline(page5);

    // The raw scene span is the max layer span (sum of per-layer frame durations).
    const rawSceneSpan = Math.max(
      ...rawTl.layers.map((l) =>
        Math.max(1, l.frames.reduce((sum, f) => sum + Math.max(1, f.duration), 0)),
      ),
    );
    const rawBall = rawTl.layers.find((l) => l.name === "Ball");
    if (!rawBall) throw new Error("raw Ball layer not found");

    // Ground-truth invariants we depend on (assert them so a future fixture/parse
    // change that alters the truth makes THIS test fail loudly rather than silently
    // pinning a stale expectation):
    expect(rawBall.frames.length).toBe(2); // leading empty kf + content kf
    expect(rawSceneSpan).toBe(2); // scene span driven by Ball's two keyframes
    const rawMenuIdx = rawBall.frames.findIndex((f) => f.label === "menu");
    expect(rawMenuIdx).toBe(1); // 'menu' is the SECOND keyframe (0-based)
    expect(rawBall.frames[rawMenuIdx]!.script).toBe("stop()");
    expect(rawBall.frames[rawMenuIdx]!.elements.length).toBe(3);
    expect(rawBall.frames[0]!.label).toBe(""); // leading keyframe is unlabelled…
    expect(rawBall.frames[0]!.elements.length).toBe(0); // …and empty

    // --- subject: the model import must match that ground truth ------------------
    const doc = tryLoadRealFla(bytes);
    if (!doc) throw new Error("failed to load");
    const scene5 = doc.scenes[1];
    expect(scene5.name).toBe("Scene 5");

    const modelBall = scene5.timeline.layers.find((l: Layer) => l.name === "Ball");
    expect(modelBall).toBeDefined();

    // Frame count parity: the imported Ball layer keeps BOTH keyframes (the leading
    // blank one is NOT dropped) — this is the "imports its full frame count" fix.
    expect(modelBall!.frames.length).toBe(rawBall.frames.length);
    expect(modelBall!.frameCount).toBe(rawSceneSpan);

    // The 'menu' label rides the SAME 0-based keyframe index as the ground truth
    // (index 1 = UI frame 2), with the correct label type and frame script.
    const menuFrame = modelBall!.frames.find((f) => f.label === "menu");
    expect(menuFrame).toBeDefined();
    expect(menuFrame!.index).toBe(rawMenuIdx);
    expect(menuFrame!.labelType).toBe("name");
    expect(menuFrame!.isKeyframe).toBe(true);
    expect(menuFrame!.script).toBe("stop()");
    expect(menuFrame!.displayObjects.length).toBe(3);

    // The leading keyframe imports as an empty keyframe at index 0 (the off-by-one
    // the QA report perceived: 'menu' on UI frame 2, not frame 1, because frame 1 is
    // genuinely blank in the authored file).
    const leadFrame = modelBall!.frames.find((f) => f.index === 0);
    expect(leadFrame).toBeDefined();
    expect(leadFrame!.label).toBe("");
    expect(leadFrame!.isEmpty).toBe(true);
    expect(leadFrame!.displayObjects.length).toBe(0);

    // And exactly one 'menu' label exists across the whole scene (no duplication).
    let menuCount = 0;
    for (const layer of scene5.timeline.layers)
      for (const frame of layer.frames)
        if (frame.label === "menu" && frame.isKeyframe) menuCount++;
    expect(menuCount).toBe(1);
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
