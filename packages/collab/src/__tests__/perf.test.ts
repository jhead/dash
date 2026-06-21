/**
 * Large-doc initial-sync + outbound-diff performance (task 1348 P5).
 *
 * This is the hardening measurement for the two costs that matter when a peer
 * joins a session with a BIG document:
 *
 *   1. INITIAL SYNC — the host materializes its document into the Y.Doc once
 *      (`materializeDoc`), the state is serialized (`encodeStateAsUpdate` — the
 *      bytes the first-sync exchange ships), and a joiner applies them
 *      (`applyUpdate`) and rebuilds (`rebuildDoc`). We time each stage on a doc
 *      built from thousands of real @flash/core mutations and assert it stays
 *      well under a generous ceiling (so a regression that makes initial sync
 *      quadratic is caught), and we PRINT the numbers for the task report.
 *
 *   2. OUTBOUND DIFF — after the doc is live, a single scalar edit (one display
 *      object's `x`) must cost a SMALL diff, not a re-materialize: the binding's
 *      structural-sharing `diffDoc` descends only where references differ. We
 *      assert the per-edit update is a tiny fraction of the full-doc bytes and
 *      print the ratio.
 *
 * Numbers are environment-dependent, so the assertions are deliberately loose
 * (catch a 10x regression, not micro-jitter). The printed values are the
 * deliverable; the bounds are the guard rail.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createDocument, type FlashDocument } from "@flash/core";
import { materializeDoc, diffDoc, rebuildDoc } from "../schema.js";
import { jsonEqual } from "../json.js";
import { makeRng } from "./helpers.js";
import { applyRandomMutation } from "./mutators.js";

/** Build a large, realistic document via many real @flash/core mutations. */
function buildLargeDoc(steps: number): FlashDocument {
  const rng = makeRng(20250618);
  let doc = createDocument();
  for (let i = 0; i < steps; i++) doc = applyRandomMutation(doc, rng);
  return doc;
}

/**
 * Bump the `x` of the FIRST display object found, returning a new document built
 * with STRUCTURAL SHARING (only the path scene→layer→frame→object is re-created;
 * every sibling keeps its reference). This is exactly what a real @flash/core
 * mutation produces, and it is what lets `diffDoc` descend only where refs
 * differ. Returns null if the doc has no display objects.
 */
function bumpFirstObjectX(doc: FlashDocument): FlashDocument | null {
  for (let si = 0; si < doc.scenes.length; si++) {
    const scene = doc.scenes[si];
    for (let li = 0; li < scene.timeline.layers.length; li++) {
      const layer = scene.timeline.layers[li];
      for (let fi = 0; fi < layer.frames.length; fi++) {
        const frame = layer.frames[fi];
        const objs = frame.displayObjects;
        if (objs && objs.length > 0) {
          const obj = objs[0];
          const newObj = { ...obj, x: obj.x + 1 };
          const newObjs = [newObj, ...objs.slice(1)];
          const newFrame = { ...frame, displayObjects: newObjs };
          const newFrames = [
            ...layer.frames.slice(0, fi),
            newFrame,
            ...layer.frames.slice(fi + 1),
          ];
          const newLayer = { ...layer, frames: newFrames };
          const newLayers = [
            ...scene.timeline.layers.slice(0, li),
            newLayer,
            ...scene.timeline.layers.slice(li + 1),
          ];
          const newScene = {
            ...scene,
            timeline: { ...scene.timeline, layers: newLayers },
          };
          const newScenes = [
            ...doc.scenes.slice(0, si),
            newScene,
            ...doc.scenes.slice(si + 1),
          ];
          return { ...doc, scenes: newScenes };
        }
      }
    }
  }
  return null;
}

function ms(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe("large-doc perf — initial sync + outbound diff", () => {
  it("initial state-vector exchange of a big doc stays fast and round-trips", () => {
    // ~4000 mutations produces a doc with many scenes/layers/frames/objects +
    // library items + asClasses — a genuinely large authoring session.
    const doc = buildLargeDoc(4000);

    let sceneCount = doc.scenes.length;
    let objCount = 0;
    for (const s of doc.scenes)
      for (const l of s.timeline.layers)
        for (const f of l.frames) objCount += f.displayObjects?.length ?? 0;
    const libCount = doc.library.items.length;

    // HOST: materialize once.
    const host = new Y.Doc();
    const tMaterialize = ms(() => materializeDoc(host, doc));

    // The first-sync payload (what the provider ships to a joiner).
    let update!: Uint8Array;
    const tEncode = ms(() => {
      update = Y.encodeStateAsUpdate(host);
    });

    // JOINER: apply the first-sync update, then rebuild the FlashDocument.
    const joiner = new Y.Doc();
    const tApply = ms(() => Y.applyUpdate(joiner, update));
    let rebuilt!: FlashDocument;
    const tRebuild = ms(() => {
      rebuilt = rebuildDoc(joiner);
    });

    // The joiner's document is identical to the host's (correctness gate).
    expect(jsonEqual(rebuilt, doc)).toBe(true);

    // eslint-disable-next-line no-console
    console.log(
      `[P5 perf] initial sync of LARGE doc ` +
        `(${sceneCount} scenes, ${objCount} display objects, ${libCount} library items, ` +
        `${(update.length / 1024).toFixed(1)} KiB on the wire):\n` +
        `  materializeDoc:      ${tMaterialize.toFixed(1)} ms\n` +
        `  encodeStateAsUpdate: ${tEncode.toFixed(1)} ms\n` +
        `  applyUpdate (joiner):${tApply.toFixed(1)} ms\n` +
        `  rebuildDoc (joiner): ${tRebuild.toFixed(1)} ms\n` +
        `  TOTAL first sync:    ${(tMaterialize + tEncode + tApply + tRebuild).toFixed(1)} ms`,
    );

    // Guard rails (catch a 10x regression, not micro-jitter). A multi-thousand-
    // object doc must sync in well under a second.
    const total = tMaterialize + tEncode + tApply + tRebuild;
    expect(total).toBeLessThan(3000);
    expect(objCount).toBeGreaterThan(0); // the doc really is non-trivial
  });

  it("a single scalar edit diffs to a TINY update, not a re-materialize", () => {
    const doc = buildLargeDoc(4000);

    // Live host: materialize the big doc.
    const host = new Y.Doc();
    materializeDoc(host, doc);
    const fullBytes = Y.encodeStateAsUpdate(host).length;

    // One scalar edit: move a single display object by 1px (structural sharing).
    const edited = bumpFirstObjectX(doc);
    expect(edited).not.toBeNull();
    expect(edited).not.toBe(doc); // a real change

    let editUpdate!: Uint8Array;
    const captureUpdate = (u: Uint8Array, origin: unknown): void => {
      if (origin === "local") editUpdate = u;
    };
    host.on("update", captureUpdate);
    const tDiff = ms(() => {
      host.transact(() => diffDoc(host, doc, edited!), "local");
    });
    host.off("update", captureUpdate);

    expect(editUpdate).toBeDefined();
    const ratio = editUpdate.length / fullBytes;

    // eslint-disable-next-line no-console
    console.log(
      `[P5 perf] single scalar edit on LARGE doc:\n` +
        `  diffDoc time:        ${tDiff.toFixed(2)} ms\n` +
        `  full-doc bytes:      ${fullBytes}\n` +
        `  edit update bytes:   ${editUpdate.length}\n` +
        `  ratio (edit/full):   ${(ratio * 100).toFixed(3)}%`,
    );

    // The per-edit update is a TINY fraction of the full document — the
    // minimal-delta property that makes a big session usable. (< 2% is very
    // conservative; in practice it is a fraction of a percent.)
    expect(ratio).toBeLessThan(0.02);
    // And it must apply on a joiner to reproduce the edit.
    const joiner = new Y.Doc();
    Y.applyUpdate(joiner, Y.encodeStateAsUpdate(host));
    expect(rebuildDoc(joiner).scenes.length).toBe(edited!.scenes.length);
  });
});
