/**
 * Tests for useHistory hook — verifies undo/redo behaviour, max-depth limiting,
 * and the replace (no-op undo-entry) operation.
 *
 * Tests the pure `historyReducer` directly (no React/DOM required).
 * The hook delegates all state transitions to @flash/core's history primitives,
 * so testing the reducer directly gives full coverage without needing
 * @testing-library/react.
 */

import { describe, it, expect } from "vitest";
import {
  createHistory,
  canUndo,
  canRedo,
} from "@flash/core";
import type { HistoryState } from "@flash/core";
import type { FlashDocument } from "@flash/core";
import { historyReducer } from "../../store/history.js";
import type { HistoryAction } from "../../store/history.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal FlashDocument stub for testing. */
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

function dispatch(state: HistoryState, action: HistoryAction): HistoryState {
  return historyReducer(state, action);
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("initial state", () => {
  it("present matches the initial document passed in", () => {
    const doc = makeDoc("initial");
    const state = createHistory(doc);
    expect(state.present).toBe(doc);
  });

  it("canUndo is false on initial state", () => {
    const state = createHistory(makeDoc("d0"));
    expect(canUndo(state)).toBe(false);
  });

  it("canRedo is false on initial state", () => {
    const state = createHistory(makeDoc("d0"));
    expect(canRedo(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// push adds an entry accessible via undo
// ---------------------------------------------------------------------------

describe("push adds an entry accessible via undo", () => {
  it("canUndo becomes true after push", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    expect(canUndo(state)).toBe(true);
  });

  it("undo after push restores the previous document", () => {
    const d0 = makeDoc("d0");
    let state = createHistory(d0);
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "UNDO" });
    expect(state.present).toBe(d0);
  });

  it("present is the pushed document after push", () => {
    const d1 = makeDoc("d1");
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: d1 });
    expect(state.present).toBe(d1);
  });
});

// ---------------------------------------------------------------------------
// Multiple pushes and undos work correctly
// ---------------------------------------------------------------------------

describe("multiple pushes and undos", () => {
  it("can push multiple times and undo through the stack", () => {
    const docs = ["d0", "d1", "d2", "d3"].map(makeDoc);
    let state = createHistory(docs[0]);
    state = dispatch(state, { type: "PUSH", nextDoc: docs[1] });
    state = dispatch(state, { type: "PUSH", nextDoc: docs[2] });
    state = dispatch(state, { type: "PUSH", nextDoc: docs[3] });

    state = dispatch(state, { type: "UNDO" });
    expect(state.present).toBe(docs[2]);
    state = dispatch(state, { type: "UNDO" });
    expect(state.present).toBe(docs[1]);
    state = dispatch(state, { type: "UNDO" });
    expect(state.present).toBe(docs[0]);
  });
});

// ---------------------------------------------------------------------------
// At history start, undo() is a no-op
// ---------------------------------------------------------------------------

describe("undo is a no-op at history start", () => {
  it("state is unchanged when undo is called with empty past", () => {
    const initial = createHistory(makeDoc("d0"));
    const after = dispatch(initial, { type: "UNDO" });
    expect(after).toBe(initial);
  });

  it("canUndo is false when at history start", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "UNDO" });
    expect(canUndo(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// At history end (after all undos), redo() works
// ---------------------------------------------------------------------------

describe("redo works at history end", () => {
  it("redo restores the last undone document", () => {
    const d1 = makeDoc("d1");
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: d1 });
    state = dispatch(state, { type: "UNDO" });
    state = dispatch(state, { type: "REDO" });
    expect(state.present).toBe(d1);
  });

  it("can undo to start then redo through entire future stack", () => {
    const docs = ["d0", "d1", "d2"].map(makeDoc);
    let state = createHistory(docs[0]);
    state = dispatch(state, { type: "PUSH", nextDoc: docs[1] });
    state = dispatch(state, { type: "PUSH", nextDoc: docs[2] });

    state = dispatch(state, { type: "UNDO" });
    state = dispatch(state, { type: "UNDO" });
    expect(state.present).toBe(docs[0]);

    state = dispatch(state, { type: "REDO" });
    expect(state.present).toBe(docs[1]);
    state = dispatch(state, { type: "REDO" });
    expect(state.present).toBe(docs[2]);
  });
});

// ---------------------------------------------------------------------------
// At newest state, canRedo is false
// ---------------------------------------------------------------------------

describe("canRedo is false at newest state", () => {
  it("canRedo is false on fresh history", () => {
    const state = createHistory(makeDoc("d0"));
    expect(canRedo(state)).toBe(false);
  });

  it("canRedo is false after redo exhausts the future stack", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "UNDO" });
    state = dispatch(state, { type: "REDO" });
    expect(canRedo(state)).toBe(false);
  });

  it("redo is a no-op when there is nothing to redo", () => {
    const initial = createHistory(makeDoc("d0"));
    const after = dispatch(initial, { type: "REDO" });
    expect(after).toBe(initial);
  });
});

// ---------------------------------------------------------------------------
// Pushing 101 items: history stays at 100, oldest is dropped
// ---------------------------------------------------------------------------

describe("max history depth = 100", () => {
  it("pushing 101 items keeps past length at 100, oldest is dropped", () => {
    // Start with d0, then push d1..d101 (101 pushes total)
    let state = createHistory(makeDoc("d0"));
    for (let i = 1; i <= 101; i++) {
      state = dispatch(state, { type: "PUSH", nextDoc: makeDoc(`d${i}`) });
    }
    // past holds old presents; after 101 pushes it should be capped at 100
    expect(state.past).toHaveLength(100);
    // d0 (oldest) must have been evicted; d1 is now the oldest surviving entry
    expect(state.past[0].id).toBe("d1");
  });

  it("default maxSize is 100", () => {
    const state = createHistory(makeDoc("d0"));
    expect(state.maxSize).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// After undo, pushing a new state clears the redo stack
// ---------------------------------------------------------------------------

describe("push after undo clears redo stack", () => {
  it("future is empty after pushing following an undo", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d2") });
    state = dispatch(state, { type: "UNDO" });
    // There is a redo entry now
    expect(canRedo(state)).toBe(true);
    // Pushing new doc should clear the redo stack
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d3") });
    expect(canRedo(state)).toBe(false);
    expect(state.future).toHaveLength(0);
  });

  it("canRedo is false immediately after push following undo", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "UNDO" });
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d2") });
    expect(canRedo(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// replace updates current entry without adding undo step
// ---------------------------------------------------------------------------

describe("replace updates current entry without adding undo step", () => {
  it("replace updates present without touching the past stack", () => {
    const d0 = makeDoc("d0");
    let state = createHistory(d0);
    state = dispatch(state, { type: "REPLACE", nextDoc: makeDoc("d1") });
    // past must still be empty — no undo entry was recorded
    expect(state.past).toHaveLength(0);
    expect(state.present.id).toBe("d1");
  });

  it("canUndo remains false after replace on initial state", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "REPLACE", nextDoc: makeDoc("d1") });
    expect(canUndo(state)).toBe(false);
  });

  it("replace clears the redo stack (future)", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "UNDO" });
    expect(canRedo(state)).toBe(true);
    state = dispatch(state, { type: "REPLACE", nextDoc: makeDoc("d2") });
    expect(state.future).toHaveLength(0);
  });

  it("multiple replaces still produce no undo history", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "REPLACE", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "REPLACE", nextDoc: makeDoc("d2") });
    state = dispatch(state, { type: "REPLACE", nextDoc: makeDoc("d3") });
    expect(state.past).toHaveLength(0);
    expect(state.present.id).toBe("d3");
  });
});
