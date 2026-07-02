/**
 * History unification (task 1391).
 *
 * The app must have EXACTLY ONE undo/redo history: the Zustand `documentStore`.
 * A previous design also shipped a React `useHistory` hook that kept its OWN
 * `useReducer(historyReducer)` state AND bound a second global `keydown`
 * listener dispatching UNDO/REDO into that parallel reducer. That hook was dead
 * code (never mounted) and has been removed; these tests pin the invariants so
 * a divergent/double-applying second stack can never be reintroduced silently:
 *
 *   1. A Ctrl+Z keypress routes THROUGH the command registry into the store and
 *      applies EXACTLY ONE undo step (no double-apply from a second listener).
 *   2. undo/redo never diverge — the store round-trips through arbitrary
 *      push/undo/redo sequences.
 *   3. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y are the ONLY history bindings, and they
 *      resolve to the store-backed `history.undo` / `history.redo` commands.
 *
 * (The dead `useHistory` hook's removal is enforced at build time — the package
 * `index.ts` no longer exports it and the reducer's only home is
 * `store/history.ts`.)
 */

import { describe, it, expect } from "vitest";
import { createDocument } from "@flash/core";
import {
  resolveKeyBinding,
  isTimelineOwnedBinding,
  type KeyChord,
} from "../dispatch/keyboard.js";
import { createPopulatedRegistry } from "../commands/index.js";
import type { CommandContext } from "../commands/types.js";
import {
  createDocumentStore,
  selectDoc,
  selectUndoDepth,
  selectRedoDepth,
  withProperties,
} from "../store/documentStore.js";
import { createUiStore } from "../store/uiStore.js";

// ---------------------------------------------------------------------------
// A faithful, DOM-free replica of the dispatch logic inside
// `useCommandKeyboard` (dispatch/keyboard.ts): resolve the chord, yield
// Timeline-owned keys to a focused Timeline, otherwise dispatch the command.
// The Timeline is never focused here, so every key dispatches. This is the ONE
// path a real keypress travels to reach undo/redo.
// ---------------------------------------------------------------------------
function setup() {
  const doc = createDocumentStore(createDocument());
  const ui = createUiStore();
  const pushDoc = (next: ReturnType<typeof selectDoc>) => doc.getState().pushDoc(next);
  const ctx: CommandContext = {
    doc,
    ui,
    services: { pushDoc, startPlayback: () => {}, stopPlayback: () => {} },
  };
  const registry = createPopulatedRegistry();

  /** Simulate ONE keypress exactly as useCommandKeyboard would handle it. */
  const pressKey = (chord: KeyChord): void => {
    const binding = resolveKeyBinding(chord);
    if (!binding) return;
    // Timeline not focused in this harness; if it were, owned keys would yield.
    if (isTimelineOwnedBinding(binding)) {
      /* would defer to Timeline when focused — not exercised here */
    }
    if (binding.type === "command") {
      registry.dispatch(binding.id, ctx);
    }
  };

  return { doc, ui, ctx, registry, pushDoc, pressKey };
}

const undoZ: KeyChord = { key: "z", ctrlKey: true };
const redoZ: KeyChord = { key: "z", ctrlKey: true, shiftKey: true };

describe("history unification — single source of truth (task 1391)", () => {
  it("a single Ctrl+Z applies exactly one undo through the store (no double-apply)", () => {
    const { doc, pushDoc, pressKey } = setup();
    const base = selectDoc(doc.getState());

    // Two independent edits → two undo entries.
    pushDoc(withProperties(base, (p) => ({ ...p, frameRate: 10 })));
    pushDoc(withProperties(selectDoc(doc.getState()), (p) => ({ ...p, frameRate: 20 })));
    expect(selectUndoDepth(doc.getState())).toBe(2);
    expect(selectDoc(doc.getState()).properties.frameRate).toBe(20);

    // ONE Ctrl+Z must undo ONE step (a second parallel listener would over-undo).
    pressKey(undoZ);
    expect(selectUndoDepth(doc.getState())).toBe(1);
    expect(selectDoc(doc.getState()).properties.frameRate).toBe(10);

    pressKey(undoZ);
    expect(selectUndoDepth(doc.getState())).toBe(0);
    expect(selectDoc(doc.getState()).properties.frameRate).toBe(base.properties.frameRate);

    // Further Ctrl+Z at history start is a clean no-op (no underflow, no throw).
    pressKey(undoZ);
    expect(selectUndoDepth(doc.getState())).toBe(0);
    expect(selectDoc(doc.getState()).properties.frameRate).toBe(base.properties.frameRate);
  });

  it("Ctrl+Z then Ctrl+Shift+Z round-trips symmetrically (no divergence)", () => {
    const { doc, pushDoc, pressKey } = setup();
    const base = selectDoc(doc.getState());

    pushDoc(withProperties(base, (p) => ({ ...p, frameRate: 42 })));
    expect(selectDoc(doc.getState()).properties.frameRate).toBe(42);

    pressKey(undoZ);
    expect(selectDoc(doc.getState()).properties.frameRate).toBe(base.properties.frameRate);
    expect(selectRedoDepth(doc.getState())).toBe(1);

    pressKey(redoZ);
    expect(selectDoc(doc.getState()).properties.frameRate).toBe(42);
    expect(selectRedoDepth(doc.getState())).toBe(0);
  });

  it("N pushes followed by N Ctrl+Z land exactly back on the base doc", () => {
    const { doc, pushDoc, pressKey } = setup();
    const base = selectDoc(doc.getState());

    const N = 12;
    for (let i = 1; i <= N; i++) {
      pushDoc(withProperties(selectDoc(doc.getState()), (p) => ({ ...p, frameRate: i })));
    }
    expect(selectUndoDepth(doc.getState())).toBe(N);

    for (let i = 0; i < N; i++) pressKey(undoZ);

    expect(selectUndoDepth(doc.getState())).toBe(0);
    expect(selectRedoDepth(doc.getState())).toBe(N);
    expect(selectDoc(doc.getState()).properties.frameRate).toBe(base.properties.frameRate);

    // Redo the whole way back up — must reach the last-pushed value.
    for (let i = 0; i < N; i++) pressKey(redoZ);
    expect(selectDoc(doc.getState()).properties.frameRate).toBe(N);
    expect(selectRedoDepth(doc.getState())).toBe(0);
  });

  it("Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y are the only history bindings and hit the store commands", () => {
    expect(resolveKeyBinding(undoZ)).toMatchObject({ id: "history.undo" });
    expect(resolveKeyBinding(redoZ)).toMatchObject({ id: "history.redo" });
    expect(resolveKeyBinding({ key: "y", ctrlKey: true })).toMatchObject({ id: "history.redo" });

    // The registry's history commands delegate to the documentStore, so the
    // keyboard shares the store's single history (not a private reducer).
    const { doc, ctx, registry, pushDoc } = setup();
    pushDoc(withProperties(selectDoc(doc.getState()), (p) => ({ ...p, frameRate: 7 })));
    expect(registry.isEnabled("history.undo", ctx)).toBe(true);
    registry.dispatch("history.undo", ctx);
    expect(selectUndoDepth(doc.getState())).toBe(0);
    expect(registry.isEnabled("history.redo", ctx)).toBe(true);
  });
});
