import { describe, it, expect } from "vitest";
import {
  createHistory,
  pushState,
  undo,
  redo,
  canUndo,
  canRedo,
} from "../../history/history.js";
import { createDocument } from "../document.js";
import { addScene } from "../document-mutations.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc() {
  return createDocument();
}

/** Produce a document variant by adding a scene named `label`. */
function docWithScene(label: string) {
  return addScene(makeDoc(), label);
}

// ---------------------------------------------------------------------------
// Document mutation history integration
// ---------------------------------------------------------------------------

describe("Document mutation history", () => {
  it("initial state has canUndo=false and canRedo=false", () => {
    const h = createHistory(makeDoc());
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("after one pushState, canUndo=true and canRedo=false", () => {
    const doc0 = makeDoc();
    const doc1 = docWithScene("Scene 2");
    const h = pushState(createHistory(doc0), doc1);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it("after undo, canRedo=true", () => {
    const doc0 = makeDoc();
    const doc1 = docWithScene("Scene 2");
    const h = undo(pushState(createHistory(doc0), doc1));
    expect(canRedo(h)).toBe(true);
  });

  it("history stack accepts new documents (present is updated)", () => {
    const doc0 = makeDoc();
    const doc1 = docWithScene("Scene 2");
    const h = pushState(createHistory(doc0), doc1);
    expect(h.present).toBe(doc1);
  });

  it("undo reverts to previous document", () => {
    const doc0 = makeDoc();
    const doc1 = docWithScene("Scene 2");
    const h0 = createHistory(doc0);
    const h1 = pushState(h0, doc1);
    const h2 = undo(h1);
    expect(h2.present).toBe(doc0);
  });

  it("redo re-applies the reverted document", () => {
    const doc0 = makeDoc();
    const doc1 = docWithScene("Scene 2");
    const h1 = pushState(createHistory(doc0), doc1);
    const h2 = undo(h1);
    const h3 = redo(h2);
    expect(h3.present).toBe(doc1);
  });

  it("multiple undo/redo work in sequence (10+ operations)", () => {
    // Build a history with 12 distinct document states.
    let h = createHistory(makeDoc());
    const docs = [h.present];
    for (let i = 1; i <= 12; i++) {
      const next = docWithScene(`Scene ${i + 1}`);
      docs.push(next);
      h = pushState(h, next);
    }
    // Present should be docs[12].
    expect(h.present).toBe(docs[12]);

    // Undo 12 times to reach the initial document.
    for (let i = 0; i < 12; i++) {
      h = undo(h);
    }
    expect(h.present).toBe(docs[0]);
    expect(canUndo(h)).toBe(false);

    // Redo 12 times back to the most recent state.
    for (let i = 0; i < 12; i++) {
      h = redo(h);
    }
    expect(h.present).toBe(docs[12]);
    expect(canRedo(h)).toBe(false);
  });

  it("new mutation after undo discards the redo stack", () => {
    const doc0 = makeDoc();
    const doc1 = docWithScene("Scene 2");
    const doc2 = docWithScene("Scene 3");
    const docBranch = docWithScene("Branch");

    // Push doc1 and doc2, then undo once (present = doc1).
    let h = createHistory(doc0);
    h = pushState(h, doc1);
    h = pushState(h, doc2);
    h = undo(h); // present = doc1, future = [doc2]

    // Push a new doc — future must be cleared.
    h = pushState(h, docBranch);
    expect(h.present).toBe(docBranch);
    expect(canRedo(h)).toBe(false);
  });

  it("undo on initial state returns the same HistoryState unchanged", () => {
    const h = createHistory(makeDoc());
    const h2 = undo(h);
    expect(h2).toBe(h);
  });

  it("redo on empty future returns the same HistoryState unchanged", () => {
    const h = pushState(createHistory(makeDoc()), docWithScene("Scene 2"));
    const h2 = redo(h);
    expect(h2).toBe(h);
  });

  it("history respects maxSize — oldest entry is trimmed when exceeded", () => {
    const maxSize = 5;
    let h = createHistory(makeDoc(), maxSize);
    const initial = h.present;

    // Push 6 documents so the initial one should fall off.
    for (let i = 1; i <= 6; i++) {
      h = pushState(h, docWithScene(`Scene ${i + 1}`));
    }

    // past should have at most maxSize entries.
    expect(h.past.length).toBeLessThanOrEqual(maxSize);
    // The very first document should have been trimmed.
    expect(h.past).not.toContain(initial);
  });

  it("history preserves maxSize through undo/redo cycles", () => {
    const maxSize = 3;
    let h = createHistory(makeDoc(), maxSize);
    for (let i = 0; i < 10; i++) {
      h = pushState(h, docWithScene(`S${i}`));
    }
    // Undo several times.
    for (let i = 0; i < 3; i++) {
      h = undo(h);
    }
    // Re-push — maxSize must not have changed.
    h = pushState(h, docWithScene("New"));
    expect(h.maxSize).toBe(maxSize);
    expect(h.past.length).toBeLessThanOrEqual(maxSize);
  });
});
