/**
 * Unit tests for the document-level undo/redo history.
 *
 * Covers:
 *   1. push → undo → redo round-trip
 *   2. maxSize trimming (oldest entries discarded)
 *   3. canUndo/canRedo boundary conditions
 *   4. Pushing a new state clears the redo stack
 */

import {
  createHistory,
  pushState,
  undo,
  redo,
  canUndo,
  canRedo,
} from "../history.js";
import type { FlashDocument } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal FlashDocument stub — id is the only thing that varies in tests. */
function makeDoc(id: string): FlashDocument {
  return {
    id,
    properties: {
      width: 550,
      height: 400,
      frameRate: 12,
      backgroundColor: "#ffffff",
      rulerUnits: "px",
      grid: {
        showGrid: false,
        snapToGrid: false,
        gridColor: "#999999",
        gridWidth: 18,
        gridHeight: 18,
      },
      guides: [],
      snapToObjects: false,
      snapToPixels: false,
      snapToGuides: false,
    },
    scenes: [],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// createHistory
// ---------------------------------------------------------------------------

describe("createHistory", () => {
  it("sets present to the initial document", () => {
    const doc = makeDoc("d0");
    const h = createHistory(doc);
    expect(h.present).toBe(doc);
  });

  it("starts with empty past and future", () => {
    const h = createHistory(makeDoc("d0"));
    expect(h.past).toHaveLength(0);
    expect(h.future).toHaveLength(0);
  });

  it("uses provided maxSize", () => {
    const h = createHistory(makeDoc("d0"), 10);
    expect(h.maxSize).toBe(10);
  });

  it("defaults maxSize to 100", () => {
    const h = createHistory(makeDoc("d0"));
    expect(h.maxSize).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// push → undo → redo round-trip
// ---------------------------------------------------------------------------

describe("push → undo → redo round-trip", () => {
  it("moves present to past on push and sets new present", () => {
    const d0 = makeDoc("d0");
    const d1 = makeDoc("d1");
    let h = createHistory(d0);
    h = pushState(h, d1);

    expect(h.present).toBe(d1);
    expect(h.past).toHaveLength(1);
    expect(h.past[0]).toBe(d0);
    expect(h.future).toHaveLength(0);
  });

  it("undo restores previous present and puts current into future", () => {
    const d0 = makeDoc("d0");
    const d1 = makeDoc("d1");
    let h = createHistory(d0);
    h = pushState(h, d1);
    h = undo(h);

    expect(h.present).toBe(d0);
    expect(h.past).toHaveLength(0);
    expect(h.future).toHaveLength(1);
    expect(h.future[0]).toBe(d1);
  });

  it("redo restores the undone state", () => {
    const d0 = makeDoc("d0");
    const d1 = makeDoc("d1");
    let h = createHistory(d0);
    h = pushState(h, d1);
    h = undo(h);
    h = redo(h);

    expect(h.present).toBe(d1);
    expect(h.past).toHaveLength(1);
    expect(h.future).toHaveLength(0);
  });

  it("supports multiple undo/redo steps", () => {
    const docs = ["d0", "d1", "d2", "d3"].map(makeDoc);
    let h = createHistory(docs[0]);
    h = pushState(h, docs[1]);
    h = pushState(h, docs[2]);
    h = pushState(h, docs[3]);

    // undo 3 times
    h = undo(h);
    expect(h.present).toBe(docs[2]);
    h = undo(h);
    expect(h.present).toBe(docs[1]);
    h = undo(h);
    expect(h.present).toBe(docs[0]);

    // redo 2 times
    h = redo(h);
    expect(h.present).toBe(docs[1]);
    h = redo(h);
    expect(h.present).toBe(docs[2]);
  });
});

// ---------------------------------------------------------------------------
// Push clears redo stack
// ---------------------------------------------------------------------------

describe("push clears redo stack", () => {
  it("discards future states when a new state is pushed after undo", () => {
    const d0 = makeDoc("d0");
    const d1 = makeDoc("d1");
    const d2 = makeDoc("d2");
    let h = createHistory(d0);
    h = pushState(h, d1);
    h = undo(h); // future = [d1]
    h = pushState(h, d2); // should clear future

    expect(h.present).toBe(d2);
    expect(h.future).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// maxSize trimming
// ---------------------------------------------------------------------------

describe("maxSize trimming", () => {
  it("trims past to maxSize oldest entries when exceeded", () => {
    const maxSize = 3;
    let h = createHistory(makeDoc("d0"), maxSize);
    // Push 4 more docs — past should never exceed maxSize=3
    for (let i = 1; i <= 4; i++) {
      h = pushState(h, makeDoc(`d${i}`));
    }

    expect(h.past).toHaveLength(maxSize);
    // The oldest (d0) should have been evicted; d1 is now oldest.
    expect(h.past[0].id).toBe("d1");
  });

  it("does not trim when at exactly maxSize", () => {
    const maxSize = 2;
    let h = createHistory(makeDoc("d0"), maxSize);
    h = pushState(h, makeDoc("d1")); // past=[d0], length=1
    h = pushState(h, makeDoc("d2")); // past=[d0,d1], length=2

    expect(h.past).toHaveLength(2);
    expect(h.past[0].id).toBe("d0");
  });
});

// ---------------------------------------------------------------------------
// canUndo / canRedo boundary conditions
// ---------------------------------------------------------------------------

describe("canUndo / canRedo", () => {
  it("canUndo is false on initial state", () => {
    expect(canUndo(createHistory(makeDoc("d0")))).toBe(false);
  });

  it("canUndo is true after a push", () => {
    let h = createHistory(makeDoc("d0"));
    h = pushState(h, makeDoc("d1"));
    expect(canUndo(h)).toBe(true);
  });

  it("canUndo is false after undoing to initial state", () => {
    let h = createHistory(makeDoc("d0"));
    h = pushState(h, makeDoc("d1"));
    h = undo(h);
    expect(canUndo(h)).toBe(false);
  });

  it("canRedo is false on initial state", () => {
    expect(canRedo(createHistory(makeDoc("d0")))).toBe(false);
  });

  it("canRedo is true after undo", () => {
    let h = createHistory(makeDoc("d0"));
    h = pushState(h, makeDoc("d1"));
    h = undo(h);
    expect(canRedo(h)).toBe(true);
  });

  it("canRedo is false after redo exhausts future stack", () => {
    let h = createHistory(makeDoc("d0"));
    h = pushState(h, makeDoc("d1"));
    h = undo(h);
    h = redo(h);
    expect(canRedo(h)).toBe(false);
  });

  it("undo is a no-op when canUndo is false", () => {
    const h = createHistory(makeDoc("d0"));
    const after = undo(h);
    expect(after).toBe(h); // same reference
  });

  it("redo is a no-op when canRedo is false", () => {
    const h = createHistory(makeDoc("d0"));
    const after = redo(h);
    expect(after).toBe(h); // same reference
  });
});
