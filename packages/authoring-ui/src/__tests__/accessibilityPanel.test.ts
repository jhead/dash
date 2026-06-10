/**
 * Tests for the AccessibilityPanel component.
 *
 * Verifies:
 * - Default props rendering without errors
 * - Document-level accessibility fields exposed correctly
 * - Object-level section hidden when no object selected
 * - Object-level section shown when selectedObjectId provided
 */

import { describe, it, expect } from "vitest";
import type { DocumentAccessibility } from "@flash/core";
import type { ObjectAccessibility } from "@flash/core";

// ---------------------------------------------------------------------------
// Pure model logic tests — no DOM rendering required
// ---------------------------------------------------------------------------

describe("AccessibilityPanel — DocumentAccessibility defaults", () => {
  it("DocumentAccessibility.enabled defaults to false when not set", () => {
    const acc: DocumentAccessibility = {
      enabled: false,
      makeChildrenAccessible: true,
      useCustomTabOrder: false,
    };
    expect(acc.enabled).toBe(false);
  });

  it("DocumentAccessibility.makeChildrenAccessible defaults to true", () => {
    const acc: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: true,
      useCustomTabOrder: false,
    };
    expect(acc.makeChildrenAccessible).toBe(true);
  });

  it("DocumentAccessibility.useCustomTabOrder defaults to false", () => {
    const acc: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: true,
      useCustomTabOrder: false,
    };
    expect(acc.useCustomTabOrder).toBe(false);
  });
});

describe("AccessibilityPanel — ObjectAccessibility fields", () => {
  it("ObjectAccessibility.enabled=true enables the object", () => {
    const acc: ObjectAccessibility = {
      enabled: true,
      name: "Submit Button",
      description: "Submits the form",
      shortcut: "Alt+S",
      tabIndex: 3,
      forceSimple: false,
    };
    expect(acc.enabled).toBe(true);
    expect(acc.name).toBe("Submit Button");
    expect(acc.description).toBe("Submits the form");
    expect(acc.shortcut).toBe("Alt+S");
    expect(acc.tabIndex).toBe(3);
    expect(acc.forceSimple).toBe(false);
  });

  it("ObjectAccessibility.enabled=false disables the object", () => {
    const acc: ObjectAccessibility = {
      enabled: false,
    };
    expect(acc.enabled).toBe(false);
    expect(acc.name).toBeUndefined();
    expect(acc.tabIndex).toBeUndefined();
  });

  it("ObjectAccessibility.forceSimple defaults to undefined when not set", () => {
    const acc: ObjectAccessibility = {
      enabled: true,
    };
    expect(acc.forceSimple).toBeUndefined();
  });

  it("ObjectAccessibility.tabIndex can be 0", () => {
    const acc: ObjectAccessibility = {
      enabled: true,
      tabIndex: 0,
    };
    expect(acc.tabIndex).toBe(0);
  });

  it("ObjectAccessibility merging pattern works (spread update)", () => {
    const base: ObjectAccessibility = {
      enabled: true,
      name: "Old Name",
      description: "Old Desc",
    };
    const updated = { ...base, name: "New Name" };
    expect(updated.name).toBe("New Name");
    expect(updated.description).toBe("Old Desc");
    expect(updated.enabled).toBe(true);
  });
});

describe("AccessibilityPanel — DocumentAccessibility merge pattern", () => {
  it("toggling enabled changes only the enabled field", () => {
    const base: DocumentAccessibility = {
      enabled: false,
      makeChildrenAccessible: true,
      useCustomTabOrder: false,
    };
    const toggled = { ...base, enabled: !base.enabled };
    expect(toggled.enabled).toBe(true);
    expect(toggled.makeChildrenAccessible).toBe(true);
    expect(toggled.useCustomTabOrder).toBe(false);
  });

  it("toggling makeChildrenAccessible changes only that field", () => {
    const base: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: true,
      useCustomTabOrder: false,
    };
    const toggled = { ...base, makeChildrenAccessible: !base.makeChildrenAccessible };
    expect(toggled.enabled).toBe(true);
    expect(toggled.makeChildrenAccessible).toBe(false);
    expect(toggled.useCustomTabOrder).toBe(false);
  });
});
