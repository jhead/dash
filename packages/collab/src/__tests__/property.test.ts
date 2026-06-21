/**
 * ACCEPTANCE PROPERTY TEST (the P0 gate).
 *
 * For many random seeds we drive a long sequence of mutations through the REAL
 * @flash/core pure functions (timeline.ts / document-mutations.ts / library.ts),
 * sync the source document through the FlashCollabBinding into a second
 * (remote) Y.Doc over an in-process wire, rebuild a FlashDocument from the
 * REMOTE Y.Doc, and assert it deep-equals the source — after EVERY mutation,
 * not just at the end. This proves the binding is a faithful projection:
 *   FlashDocument --(diff/transact)--> Y.Doc --(replicate)--> Y.Doc --(rebuild)--> FlashDocument
 * is the identity over the full mutation surface.
 *
 * Coverage (see mutators.ts): add/remove/move/update across scenes, layers,
 * frames, displayObjects, library items + folders, asClasses, document
 * properties, and SYMBOL nested timelines.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createDocument, type FlashDocument } from "@flash/core";
import { rebuildDoc, materializeDoc } from "../schema.js";
import { jsonEqual } from "../json.js";
import { makeRng } from "./helpers.js";
import { makeTwoPeers } from "./helpers.js";
import { applyRandomMutation } from "./mutators.js";

const SEEDS = 120;
const STEPS_PER_SEED = 60;

/** Normalize a doc for comparison: strip volatile/absent-undefined noise via JSON. */
function deepEqualDoc(a: FlashDocument, b: FlashDocument): boolean {
  return jsonEqual(a, b);
}

describe("FlashDocument <-> Y.Doc binding — property test (the P0 gate)", () => {
  it(`is identity over ${SEEDS} random mutation sequences (${STEPS_PER_SEED} steps each)`, () => {
    let totalSteps = 0;
    let totalMutationsThatChanged = 0;

    for (let s = 0; s < SEEDS; s++) {
      const rng = makeRng(0xc0ffee + s * 7919);
      let doc = createDocument();
      const { source, ydocB, binding, unwire } = makeTwoPeers(doc);

      try {
        for (let step = 0; step < STEPS_PER_SEED; step++) {
          const next = applyRandomMutation(doc, rng);
          totalSteps++;
          if (next !== doc) {
            totalMutationsThatChanged++;
            doc = next;
            source.set(doc); // drives the outbound binding (one transaction)
          }

          // Rebuild from the REMOTE peer's Y.Doc and compare.
          const rebuilt = rebuildDoc(ydocB);
          if (!deepEqualDoc(doc, rebuilt)) {
            // Surface a readable diff location.
            expect(rebuilt, `seed=${s} step=${step}`).toEqual(doc);
          }
        }

        // Final exhaustive structural check (object identity of values).
        expect(rebuildDoc(ydocB)).toEqual(doc);
      } finally {
        binding.destroy();
        unwire();
      }
    }

    // Sanity: the sequences actually mutated the doc most of the time.
    expect(totalSteps).toBe(SEEDS * STEPS_PER_SEED);
    expect(totalMutationsThatChanged).toBeGreaterThan(SEEDS * STEPS_PER_SEED * 0.5);
  });

  it("round-trips a full materialize on the LOCAL peer too (no provider)", () => {
    const rng = makeRng(42);
    let doc = createDocument();
    const { source, ydocA, binding, unwire } = makeTwoPeers(doc);
    try {
      for (let i = 0; i < 200; i++) {
        const next = applyRandomMutation(doc, rng);
        if (next !== doc) {
          doc = next;
          source.set(doc);
        }
      }
      // The LOCAL Y.Doc (the one the binding writes) must also rebuild to the doc.
      expect(rebuildDoc(ydocA)).toEqual(doc);
    } finally {
      binding.destroy();
      unwire();
    }
  });
});

describe("structural-sharing diff writes a minimal delta", () => {
  it("a single scalar edit produces only a few Y updates, not a full re-materialize", () => {
    const doc = createDocument();
    const { source, ydocA, binding, unwire } = makeTwoPeers(doc);
    try {
      let updateBytes = 0;
      const onUpdate = (u: Uint8Array) => {
        updateBytes += u.length;
      };
      ydocA.on("update", onUpdate);

      // Change ONLY the background color.
      const next: FlashDocument = {
        ...doc,
        properties: { ...doc.properties, backgroundColor: "#123456" },
      };
      source.set(next);

      ydocA.off("update", onUpdate);

      // Compare against the cost of a FULL re-materialize of the same doc: a
      // structural-sharing diff of one scalar must be a small fraction of it.
      const fullDoc = new Y.Doc();
      fullDoc.transact(() => materializeDoc(fullDoc, next));
      const fullBytes = Y.encodeStateAsUpdate(fullDoc).length;

      expect(updateBytes).toBeGreaterThan(0);
      expect(updateBytes).toBeLessThan(fullBytes / 2);
      expect(rebuildDoc(ydocA)).toEqual(next);
    } finally {
      binding.destroy();
      unwire();
    }
  });
});
