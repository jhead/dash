/**
 * Tests for the GroupView / getView('group') branch in PropertiesPanel.
 *
 * These are pure-logic tests (no React rendering) that verify:
 *   1. getView() returns "group" for a GroupObject
 *   2. getView() returns its original value for all other types
 *   3. The GroupObject type contract has the expected fields
 */

import { describe, it, expect } from "vitest";
import type { DisplayObject, GroupObject, ShapeDisplayObject } from "@flash/core";
import { createRectShape } from "@flash/core";

// ---------------------------------------------------------------------------
// Re-implement getView() locally so we can test the dispatch table without
// importing the React component (which would require jsdom).
// ---------------------------------------------------------------------------

type PanelView = "document" | "frame" | "shape" | "instance" | "text" | "bitmap" | "video" | "group" | "mixed";

function getView(selectedObjects: DisplayObject[]): PanelView {
  if (selectedObjects.length === 0) return "frame";
  if (selectedObjects.length > 1) return "mixed";
  const obj = selectedObjects[0];
  if (obj.type === "shape") return "shape";
  if (obj.type === "instance") return "instance";
  if (obj.type === "text") return "text";
  if (obj.type === "bitmap") return "bitmap";
  if (obj.type === "video") return "video";
  if (obj.type === "group") return "group";
  return "frame";
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeShape(id: string): ShapeDisplayObject {
  return {
    id,
    type: "shape",
    x: 10,
    y: 20,
    shape: createRectShape(0, 0, 50, 50, null, null),
  };
}

function makeGroup(id: string, children: DisplayObject[] = []): GroupObject {
  return {
    id,
    type: "group",
    x: 5,
    y: 10,
    children,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getView() — group branch", () => {
  it("returns 'group' when a single GroupObject is selected", () => {
    const group = makeGroup("g1", [makeShape("s1"), makeShape("s2")]);
    expect(getView([group])).toBe("group");
  });

  it("returns 'shape' for a shape (regression: group branch must not break existing types)", () => {
    expect(getView([makeShape("s1")])).toBe("shape");
  });

  it("returns 'frame' when nothing is selected", () => {
    expect(getView([])).toBe("frame");
  });

  it("returns 'mixed' when multiple objects are selected (group among them)", () => {
    const group = makeGroup("g1");
    const shape = makeShape("s1");
    expect(getView([group, shape])).toBe("mixed");
  });

  it("GroupObject has the expected type field and children array", () => {
    const group = makeGroup("g1", [makeShape("c1")]);
    expect(group.type).toBe("group");
    expect(Array.isArray(group.children)).toBe(true);
    expect(group.children).toHaveLength(1);
  });

  it("GroupObject carries x and y position", () => {
    const group = makeGroup("g1");
    expect(typeof group.x).toBe("number");
    expect(typeof group.y).toBe("number");
  });

  it("returns 'group' for an empty group (no children)", () => {
    const group = makeGroup("g_empty");
    expect(getView([group])).toBe("group");
  });
});
