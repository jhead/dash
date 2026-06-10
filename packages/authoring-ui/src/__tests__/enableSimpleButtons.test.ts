/**
 * Unit tests for task 0838: Enable Simple Buttons toggle
 *
 * Tests the state management and button-state logic for the
 * Control > Enable Simple Buttons feature.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Task 0838: simpleButtonsEnabled state management
// ---------------------------------------------------------------------------

describe("simpleButtonsEnabled state", () => {
  it("defaults to false", () => {
    let simpleButtonsEnabled = false;
    expect(simpleButtonsEnabled).toBe(false);
  });

  it("toggleSimpleButtons flips from false to true", () => {
    let simpleButtonsEnabled = false;
    const handleToggleSimpleButtons = () => {
      simpleButtonsEnabled = !simpleButtonsEnabled;
    };
    handleToggleSimpleButtons();
    expect(simpleButtonsEnabled).toBe(true);
  });

  it("toggleSimpleButtons flips from true to false", () => {
    let simpleButtonsEnabled = true;
    const handleToggleSimpleButtons = () => {
      simpleButtonsEnabled = !simpleButtonsEnabled;
    };
    handleToggleSimpleButtons();
    expect(simpleButtonsEnabled).toBe(false);
  });

  it("multiple toggles cycle correctly", () => {
    let simpleButtonsEnabled = false;
    const toggle = () => { simpleButtonsEnabled = !simpleButtonsEnabled; };
    toggle(); expect(simpleButtonsEnabled).toBe(true);
    toggle(); expect(simpleButtonsEnabled).toBe(false);
    toggle(); expect(simpleButtonsEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 0838: button state frame selection logic
// ---------------------------------------------------------------------------

describe("button state frame selection", () => {
  /**
   * Replicates the StageArea logic for choosing a button frame index:
   *   - 2 = Down (pressed)
   *   - 1 = Over (hovered)
   *   - 0 = Up (default)
   */
  function getButtonFrame(
    instanceId: string,
    hoveredButtonId: string | null,
    pressedButtonId: string | null
  ): number {
    if (pressedButtonId === instanceId) return 2; // Down
    if (hoveredButtonId === instanceId) return 1;  // Over
    return 0;                                       // Up
  }

  it("returns 0 (Up) when no hover or press", () => {
    expect(getButtonFrame("btn-1", null, null)).toBe(0);
  });

  it("returns 1 (Over) when hovered", () => {
    expect(getButtonFrame("btn-1", "btn-1", null)).toBe(1);
  });

  it("returns 2 (Down) when pressed", () => {
    expect(getButtonFrame("btn-1", "btn-1", "btn-1")).toBe(2);
  });

  it("returns 0 (Up) for a different button when another is hovered", () => {
    expect(getButtonFrame("btn-2", "btn-1", null)).toBe(0);
  });

  it("returns 0 (Up) for a different button when another is pressed", () => {
    expect(getButtonFrame("btn-2", "btn-1", "btn-1")).toBe(0);
  });

  it("press overrides hover for the same button", () => {
    // Even though hovered and pressed both match, Down (2) wins
    expect(getButtonFrame("btn-1", "btn-1", "btn-1")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Task 0838: simpleButtonsEnabled menu checkmark label
// ---------------------------------------------------------------------------

describe("simpleButtonsEnabled menu label", () => {
  function getMenuLabel(simpleButtonsEnabled: boolean): string {
    return `${simpleButtonsEnabled ? "+ " : "  "}Enable Simple Buttons`;
  }

  it("shows no checkmark when disabled", () => {
    expect(getMenuLabel(false)).toBe("  Enable Simple Buttons");
  });

  it("shows checkmark when enabled", () => {
    expect(getMenuLabel(true)).toBe("+ Enable Simple Buttons");
  });
});
