import { describe, it, expect } from "vitest";
import { createDocument } from "@flash/core";
import {
  createDocumentStore,
  selectDoc,
  selectCanUndo,
  selectCanRedo,
  selectUndoDepth,
  withProperties,
} from "../store/documentStore.js";

describe("documentStore", () => {
  it("starts with the initial doc and no undo history", () => {
    const store = createDocumentStore(createDocument());
    const s = store.getState();
    expect(selectDoc(s).scenes.length).toBeGreaterThan(0);
    expect(selectCanUndo(s)).toBe(false);
    expect(selectCanRedo(s)).toBe(false);
    expect(selectUndoDepth(s)).toBe(0);
  });

  it("pushDoc records an undo entry; undo/redo round-trips", () => {
    const store = createDocumentStore(createDocument());
    const before = selectDoc(store.getState());

    const next = withProperties(before, (p) => ({ ...p, frameRate: 99 }));
    store.getState().pushDoc(next);

    expect(selectDoc(store.getState()).properties.frameRate).toBe(99);
    expect(selectCanUndo(store.getState())).toBe(true);

    store.getState().undo();
    expect(selectDoc(store.getState()).properties.frameRate).toBe(before.properties.frameRate);
    expect(selectCanRedo(store.getState())).toBe(true);

    store.getState().redo();
    expect(selectDoc(store.getState()).properties.frameRate).toBe(99);
  });

  it("replaceDoc does not grow the undo stack; commitDrag adds one entry", () => {
    const store = createDocumentStore(createDocument());
    const base = selectDoc(store.getState());

    store.getState().replaceDoc(withProperties(base, (p) => ({ ...p, frameRate: 10 })));
    expect(selectUndoDepth(store.getState())).toBe(0);

    const interim = selectDoc(store.getState());
    store.getState().commitDrag(base, withProperties(interim, (p) => ({ ...p, frameRate: 20 })));
    expect(selectUndoDepth(store.getState())).toBe(1);
    expect(selectDoc(store.getState()).properties.frameRate).toBe(20);

    store.getState().undo();
    expect(selectDoc(store.getState()).properties.frameRate).toBe(base.properties.frameRate);
  });

  it("instances are isolated (no shared module state)", () => {
    const a = createDocumentStore(createDocument());
    const b = createDocumentStore(createDocument());
    a.getState().pushDoc(withProperties(selectDoc(a.getState()), (p) => ({ ...p, frameRate: 7 })));
    expect(selectDoc(a.getState()).properties.frameRate).toBe(7);
    expect(selectDoc(b.getState()).properties.frameRate).not.toBe(7);
  });
});
