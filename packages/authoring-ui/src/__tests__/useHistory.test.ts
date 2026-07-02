/**
 * Unit tests for the useHistory hook reducer.
 *
 * Tests the pure `historyReducer` directly (no React/DOM required).
 *
 * Covers:
 *   1. Initial state — doc = initialDoc, canUndo=false, canRedo=false
 *   2. pushDoc adds to history, canUndo becomes true
 *   3. undo moves cursor back, redo moves forward
 *   4. pushDoc after undo truncates forward history
 *   5. history capped at 50 entries (oldest dropped)
 *   6. canRedo=false after new pushDoc
 *   7. Multiple undos/redos in sequence
 */

import { describe, it, expect } from "vitest";
import {
  createHistory,
  canUndo,
  canRedo,
} from "@flash/core";
import type { HistoryState } from "@flash/core";
import type { FlashDocument } from "@flash/core";
import { historyReducer } from "../store/history.js";
import type { HistoryAction } from "../store/history.js";

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
  it("present is the initial document", () => {
    const doc = makeDoc("d0");
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
// PUSH action
// ---------------------------------------------------------------------------

describe("PUSH action", () => {
  it("updates present to the new document", () => {
    const d0 = makeDoc("d0");
    const d1 = makeDoc("d1");
    let state = createHistory(d0);
    state = dispatch(state, { type: "PUSH", nextDoc: d1 });
    expect(state.present).toBe(d1);
  });

  it("canUndo becomes true after a push", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    expect(canUndo(state)).toBe(true);
  });

  it("moves old present into past", () => {
    const d0 = makeDoc("d0");
    let state = createHistory(d0);
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    expect(state.past).toHaveLength(1);
    expect(state.past[0]).toBe(d0);
  });

  it("clears the redo stack (future) when a new doc is pushed", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "UNDO" });
    // There is now a redo entry
    expect(canRedo(state)).toBe(true);
    // Pushing new doc clears redo stack
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d2") });
    expect(canRedo(state)).toBe(false);
    expect(state.future).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// UNDO / REDO actions
// ---------------------------------------------------------------------------

describe("UNDO action", () => {
  it("restores the previous document", () => {
    const d0 = makeDoc("d0");
    const d1 = makeDoc("d1");
    let state = createHistory(d0);
    state = dispatch(state, { type: "PUSH", nextDoc: d1 });
    state = dispatch(state, { type: "UNDO" });
    expect(state.present).toBe(d0);
  });

  it("canUndo becomes false after undoing to initial state", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "UNDO" });
    expect(canUndo(state)).toBe(false);
  });

  it("canRedo becomes true after undo", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "UNDO" });
    expect(canRedo(state)).toBe(true);
  });

  it("is a no-op when there is nothing to undo", () => {
    const initial = createHistory(makeDoc("d0"));
    const after = dispatch(initial, { type: "UNDO" });
    expect(after).toBe(initial);
  });
});

describe("REDO action", () => {
  it("restores the undone document", () => {
    const d1 = makeDoc("d1");
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: d1 });
    state = dispatch(state, { type: "UNDO" });
    state = dispatch(state, { type: "REDO" });
    expect(state.present).toBe(d1);
  });

  it("canRedo becomes false after redo exhausts future stack", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "UNDO" });
    state = dispatch(state, { type: "REDO" });
    expect(canRedo(state)).toBe(false);
  });

  it("is a no-op when there is nothing to redo", () => {
    const initial = createHistory(makeDoc("d0"));
    const after = dispatch(initial, { type: "REDO" });
    expect(after).toBe(initial);
  });
});

// ---------------------------------------------------------------------------
// Multiple undo/redo steps in sequence
// ---------------------------------------------------------------------------

describe("multiple undo/redo steps in sequence", () => {
  it("can undo and redo through a multi-step history", () => {
    const docs = ["d0", "d1", "d2", "d3"].map(makeDoc);
    let state = createHistory(docs[0]);
    state = dispatch(state, { type: "PUSH", nextDoc: docs[1] });
    state = dispatch(state, { type: "PUSH", nextDoc: docs[2] });
    state = dispatch(state, { type: "PUSH", nextDoc: docs[3] });

    // undo 3 times
    state = dispatch(state, { type: "UNDO" });
    expect(state.present).toBe(docs[2]);
    state = dispatch(state, { type: "UNDO" });
    expect(state.present).toBe(docs[1]);
    state = dispatch(state, { type: "UNDO" });
    expect(state.present).toBe(docs[0]);

    // redo 2 times
    state = dispatch(state, { type: "REDO" });
    expect(state.present).toBe(docs[1]);
    state = dispatch(state, { type: "REDO" });
    expect(state.present).toBe(docs[2]);
  });
});

// ---------------------------------------------------------------------------
// pushDoc after undo truncates forward history
// ---------------------------------------------------------------------------

describe("push after undo truncates forward history", () => {
  it("discards redo entries when a new state is pushed after undo", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d2") });
    state = dispatch(state, { type: "UNDO" }); // future=[d2]
    state = dispatch(state, { type: "UNDO" }); // future=[d1,d2]
    expect(state.future).toHaveLength(2);
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d3") });
    expect(state.future).toHaveLength(0);
    expect(state.present.id).toBe("d3");
  });
});

// ---------------------------------------------------------------------------
// REPLACE action (used for drag updates — no history entry)
// ---------------------------------------------------------------------------

describe("REPLACE action", () => {
  it("updates present without recording an undo entry", () => {
    const d0 = makeDoc("d0");
    let state = createHistory(d0);
    state = dispatch(state, { type: "REPLACE", nextDoc: makeDoc("d1") });
    // past remains empty — no undo entry was created
    expect(state.past).toHaveLength(0);
    expect(state.present.id).toBe("d1");
  });

  it("clears future on replace", () => {
    let state = createHistory(makeDoc("d0"));
    state = dispatch(state, { type: "PUSH", nextDoc: makeDoc("d1") });
    state = dispatch(state, { type: "UNDO" });
    expect(canRedo(state)).toBe(true);
    state = dispatch(state, { type: "REPLACE", nextDoc: makeDoc("d2") });
    expect(state.future).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// COMMIT_DRAG action
// ---------------------------------------------------------------------------

describe("COMMIT_DRAG action", () => {
  it("records the pre-drag snapshot as one undo entry with final doc as present", () => {
    const preDrag = makeDoc("pre-drag");
    const final = makeDoc("final");
    let state = createHistory(makeDoc("d0"));
    // Simulate in-progress drag (replaces)
    state = dispatch(state, { type: "REPLACE", nextDoc: makeDoc("mid-drag") });
    // Commit the drag
    state = dispatch(state, { type: "COMMIT_DRAG", preDragDoc: preDrag, finalDoc: final });
    expect(state.present).toBe(final);
    expect(state.past[state.past.length - 1]).toBe(preDrag);
  });
});

// ---------------------------------------------------------------------------
// history capped at 50 entries (oldest dropped)
// ---------------------------------------------------------------------------

describe("maxSize trimming", () => {
  it("trims history to maxSize=100 by default (oldest dropped)", () => {
    // Default maxSize is 100
    let state = createHistory(makeDoc("d0"));
    for (let i = 1; i <= 102; i++) {
      state = dispatch(state, { type: "PUSH", nextDoc: makeDoc(`d${i}`) });
    }
    // past should be capped at 100
    expect(state.past).toHaveLength(100);
    // The oldest (d0) should have been evicted
    expect(state.past[0].id).toBe("d2");
  });

  it("trims to custom maxSize (50) — oldest entries dropped", () => {
    const maxSize = 50;
    let state = createHistory(makeDoc("d0"), maxSize);
    // Push 51 more docs — past should never exceed 50.
    // After 51 pushes: past grows to 51 entries then gets trimmed to 50 on the
    // 51st push, evicting the oldest (d0).  present = d51, past[0] = d1.
    for (let i = 1; i <= 51; i++) {
      state = dispatch(state, { type: "PUSH", nextDoc: makeDoc(`d${i}`) });
    }
    expect(state.past).toHaveLength(maxSize);
    // d0 should have been evicted; d1 is now the oldest surviving entry
    expect(state.past[0].id).toBe("d1");
  });
});
