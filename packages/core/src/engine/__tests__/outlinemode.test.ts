/**
 * Tests for Layer outline mode properties and renderer outline-mode behavior.
 *
 * outlineMode is defined on the model Layer type (model/types.ts).
 * The Canvas 2D renderer (engine/renderer.ts) does not yet implement outline-mode
 * rendering — tests for that behavior are marked .todo.
 *
 * Passing tests (property access):
 *   1. Layer with outlineMode: true  → outlineMode === true
 *   2. Layer with outlineMode: false → outlineMode === false (default)
 *   3. Layer with outlineColor: '#FF0000' → outlineColor accessible
 */

import { describe, it, expect } from "vitest";
import { createLayer } from "../../model/timeline.js";

// ---------------------------------------------------------------------------
// Property access — always-passing tests
// ---------------------------------------------------------------------------

describe("Layer outlineMode property", () => {
  it("layer created with outlineMode: true has outlineMode === true", () => {
    const layer = createLayer("Test", "normal", { outlineMode: true });
    expect(layer.outlineMode).toBe(true);
  });

  it("layer created with default outlineMode has outlineMode === false", () => {
    const layer = createLayer("Test");
    expect(layer.outlineMode).toBe(false);
  });

  it("layer created with outlineMode: false explicitly has outlineMode === false", () => {
    const layer = createLayer("Test", "normal", { outlineMode: false });
    expect(layer.outlineMode).toBe(false);
  });
});

describe("Layer outlineColor property", () => {
  it("layer created with outlineColor: '#FF0000' has that outlineColor accessible", () => {
    const layer = createLayer("Test", "normal", { outlineColor: "#FF0000" });
    expect(layer.outlineColor).toBe("#FF0000");
  });

  it("layer has a default outlineColor string value", () => {
    const layer = createLayer("Test");
    // Default color is defined in createLayer — a non-empty CSS hex string
    expect(typeof layer.outlineColor).toBe("string");
    expect(layer.outlineColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("outlineColor is independent from outlineMode", () => {
    const layerOn = createLayer("A", "normal", {
      outlineMode: true,
      outlineColor: "#00FF00",
    });
    const layerOff = createLayer("B", "normal", {
      outlineMode: false,
      outlineColor: "#0000FF",
    });
    expect(layerOn.outlineMode).toBe(true);
    expect(layerOn.outlineColor).toBe("#00FF00");
    expect(layerOff.outlineMode).toBe(false);
    expect(layerOff.outlineColor).toBe("#0000FF");
  });
});

// ---------------------------------------------------------------------------
// Renderer outline-mode behavior
// These tests document expected behavior that is NOT yet implemented in
// engine/renderer.ts — the SceneLayer type does not carry outlineMode, and
// CanvasRenderer.renderLayer() ignores it.
// ---------------------------------------------------------------------------

describe("Renderer outline-mode rendering (not yet implemented)", () => {
  it.todo(
    "when outlineMode is true, fill calls are suppressed and only strokes are emitted"
  );

  it.todo(
    "when outlineMode is true, strokes are drawn using outlineColor instead of the shape's own stroke color"
  );

  it.todo(
    "when outlineMode is false (default), shapes are rendered normally with fills and strokes"
  );

  it.todo(
    "outlineColor is passed through to the canvas strokeStyle when outlineMode is active"
  );
});
