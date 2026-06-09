/**
 * Tests for withProperties() — immutable document property update helper.
 *
 * Verifies that withProperties(doc, partial) returns a new FlashDocument with
 * only the specified properties changed and all others preserved.
 */

import { describe, it, expect } from "vitest";
import { withProperties } from "../document.js";
import { createDocument } from "../../model/document.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc() {
  return createDocument();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withProperties()", () => {
  it("returns a document with the updated frameRate", () => {
    const doc = makeDoc();
    const updated = withProperties(doc, { frameRate: 24 });
    expect(updated.properties.frameRate).toBe(24);
  });

  it("does not mutate the original document (immutability)", () => {
    const doc = makeDoc();
    const originalFps = doc.properties.frameRate;
    withProperties(doc, { frameRate: 30 });
    expect(doc.properties.frameRate).toBe(originalFps);
  });

  it("changes only backgroundColor when only that property is provided", () => {
    const doc = makeDoc();
    const updated = withProperties(doc, { backgroundColor: "#FF0000" });
    expect(updated.properties.backgroundColor).toBe("#FF0000");
    // Other properties remain unchanged
    expect(updated.properties.frameRate).toBe(doc.properties.frameRate);
    expect(updated.properties.width).toBe(doc.properties.width);
    expect(updated.properties.height).toBe(doc.properties.height);
  });

  it("changes width and height together", () => {
    const doc = makeDoc();
    const updated = withProperties(doc, { width: 800, height: 600 });
    expect(updated.properties.width).toBe(800);
    expect(updated.properties.height).toBe(600);
  });

  it("other properties are preserved when changing dimensions", () => {
    const doc = makeDoc();
    const updated = withProperties(doc, { width: 800, height: 600 });
    expect(updated.properties.frameRate).toBe(doc.properties.frameRate);
    expect(updated.properties.backgroundColor).toBe(doc.properties.backgroundColor);
  });

  it("toggles grid.showGrid via nested spread", () => {
    const doc = makeDoc();
    expect(doc.properties.grid.showGrid).toBe(false);
    const updated = withProperties(doc, {
      grid: { ...doc.properties.grid, showGrid: true },
    });
    expect(updated.properties.grid.showGrid).toBe(true);
    // Other grid settings unchanged
    expect(updated.properties.grid.snapToGrid).toBe(doc.properties.grid.snapToGrid);
    expect(updated.properties.grid.gridWidth).toBe(doc.properties.grid.gridWidth);
  });

  it("withProperties(doc, {}) returns a doc equivalent to the original", () => {
    const doc = makeDoc();
    const updated = withProperties(doc, {});
    expect(updated.properties).toEqual(doc.properties);
  });

  it("can update multiple properties at once (frameRate + backgroundColor)", () => {
    const doc = makeDoc();
    const updated = withProperties(doc, { frameRate: 24, backgroundColor: "#000000" });
    expect(updated.properties.frameRate).toBe(24);
    expect(updated.properties.backgroundColor).toBe("#000000");
  });

  it("non-updated properties are preserved when updating multiple properties", () => {
    const doc = makeDoc();
    const updated = withProperties(doc, { frameRate: 24, backgroundColor: "#000000" });
    expect(updated.properties.width).toBe(doc.properties.width);
    expect(updated.properties.height).toBe(doc.properties.height);
    expect(updated.properties.rulerUnits).toBe(doc.properties.rulerUnits);
    expect(updated.properties.grid).toEqual(doc.properties.grid);
  });
});
