import { describe, it, expect, vi } from "vitest";
import { createDocument } from "@flash/core";
import { createPopulatedRegistry } from "../commands/index.js";
import type { CommandContext } from "../commands/types.js";
import { createDocumentStore, selectDoc } from "../store/documentStore.js";
import { createUiStore } from "../store/uiStore.js";

function setup() {
  const doc = createDocumentStore(createDocument());
  const ui = createUiStore();
  const startPlayback = vi.fn();
  const stopPlayback = vi.fn();
  // Mutations go through the rev-bumping service (here just the store's pushDoc).
  const pushDoc = (next: ReturnType<typeof selectDoc>) => doc.getState().pushDoc(next);
  const ctx: CommandContext = { doc, ui, services: { pushDoc, startPlayback, stopPlayback } };
  const registry = createPopulatedRegistry();
  return { registry, ctx, doc, ui, startPlayback, stopPlayback };
}

describe("commands integration", () => {
  it("timeline.insertKeyframe records one undo entry at the active frame", () => {
    const { registry, ctx, doc, ui } = setup();
    ui.getState().setCurrentFrame(3);
    expect(doc.getState().history.past.length).toBe(0);
    registry.dispatch("timeline.insertKeyframe", ctx);
    expect(doc.getState().history.past.length).toBe(1);
    const layer = selectDoc(doc.getState()).scenes[0].timeline.layers[0];
    expect(layer.frames.some((f) => f.index === 3 && f.isKeyframe)).toBe(true);
  });

  it("view.toggleGrid flips doc.properties.grid.showGrid through history", () => {
    const { registry, ctx, doc } = setup();
    const before = selectDoc(doc.getState()).properties.grid.showGrid;
    registry.dispatch("view.toggleGrid", ctx);
    expect(selectDoc(doc.getState()).properties.grid.showGrid).toBe(!before);
  });

  it("view.toggleRulers flips UI state without touching history", () => {
    const { registry, ctx, doc, ui } = setup();
    const before = ui.getState().showRulers;
    registry.dispatch("view.toggleRulers", ctx);
    expect(ui.getState().showRulers).toBe(!before);
    expect(doc.getState().history.past.length).toBe(0);
  });

  it("history.undo/redo enabled-state gates dispatch", () => {
    const { registry, ctx, doc } = setup();
    expect(registry.isEnabled("history.undo", ctx)).toBe(false);
    registry.dispatch("view.toggleGrid", ctx); // create an undo entry
    expect(registry.isEnabled("history.undo", ctx)).toBe(true);
    registry.dispatch("history.undo", ctx);
    expect(doc.getState().history.past.length).toBe(0);
    expect(registry.isEnabled("history.redo", ctx)).toBe(true);
  });

  it("playback commands delegate to services", () => {
    const { registry, ctx, startPlayback, stopPlayback, ui } = setup();
    registry.dispatch("playback.toggle", ctx);
    expect(startPlayback).toHaveBeenCalledTimes(1);
    ui.getState().setIsPlaying(true);
    registry.dispatch("playback.toggle", ctx);
    expect(stopPlayback).toHaveBeenCalledTimes(1);
  });

  it("edit.selectAll selects the governing keyframe's objects", () => {
    const { registry, ctx, ui } = setup();
    // Fresh doc's first keyframe has no objects → selection stays empty (no throw).
    registry.dispatch("edit.selectAll", ctx);
    expect(ui.getState().selectedShapeIds).toEqual([]);
    ui.getState().setSelectedShapeIds(["a", "b"]);
    registry.dispatch("edit.deselectAll", ctx);
    expect(ui.getState().selectedShapeIds).toEqual([]);
  });

  // task 1361 — Delete with a selected VECTOR SHAPE.
  // A vector shape selected via the Selection tool populates the planar
  // SUBSELECTION model, not selectedShapeIds. Before the fix, edit.delete's
  // isEnabled gate only consulted selectedShapeIds, so Delete/Backspace was
  // DISABLED (no-op) for a selected vector shape.
  describe("edit.delete enablement (task 1361)", () => {
    it("is disabled with no selection of either kind", () => {
      const { registry, ctx } = setup();
      expect(registry.isEnabled("edit.delete", ctx)).toBe(false);
    });

    it("is enabled by a standard selection (selectedShapeIds)", () => {
      const { registry, ctx, ui } = setup();
      ui.getState().setSelectedShapeIds(["text-1"]);
      expect(registry.isEnabled("edit.delete", ctx)).toBe(true);
    });

    it("is enabled by a planar subselection of a vector shape", () => {
      const { registry, ctx, ui } = setup();
      // No standard selection — only a subselection, as the Selection tool sets
      // for a vector shape.
      expect(ui.getState().selectedShapeIds).toEqual([]);
      ui.getState().setSubSelection({
        shapeId: "shape-1",
        keys: [{ kind: "face", interior: "1000,1000" }],
      });
      expect(registry.isEnabled("edit.delete", ctx)).toBe(true);
    });

    it("dispatch with a subselection delegates to the editor deleteSelected service", () => {
      const deleteSelected = vi.fn();
      const doc = createDocumentStore(createDocument());
      const ui = createUiStore();
      const ctx: CommandContext = {
        doc,
        ui,
        services: { editor: { deleteSelected } as never },
      };
      const registry = createPopulatedRegistry();
      ui.getState().setSubSelection({
        shapeId: "shape-1",
        keys: [{ kind: "face", interior: "1000,1000" }],
      });
      registry.dispatch("edit.delete", ctx);
      expect(deleteSelected).toHaveBeenCalledTimes(1);
    });
  });
});
