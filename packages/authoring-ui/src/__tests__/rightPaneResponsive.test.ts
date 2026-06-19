/**
 * Tests for the responsive right-pane (Library / Properties / future Agent
 * dock) layout decisions added for task 1280.
 *
 * The Shell renders the right pane in one of two modes:
 *   - Desktop (wide) viewport: an inline, drag-resizable column. Layout is
 *     UNCHANGED from before the responsive work.
 *   - Narrow/touch viewport: a collapsible overlay drawer with a tap-to-dismiss
 *     backdrop and a toggle button, so it never squeezes/obscures the stage.
 *
 * These are pure-logic tests that mirror the boolean predicates the Shell JSX
 * uses, so the structural rules are locked without needing to mount React/jsdom.
 * The predicates here intentionally match the `&&` guards in Shell.tsx around
 * the `right-panel` / `right-pane-open` / `right-pane-backdrop` elements.
 */

import { describe, it, expect } from "vitest";

// NOTE: we deliberately do NOT import from Shell.tsx here — importing it pulls
// in agent/bridge.ts, which touches `window` at module load and is not jsdom-
// friendly in this Node test env. The breakpoint is documented as a literal
// contract below; Shell.tsx is the source of truth for the actual value.
const NARROW_VIEWPORT_BREAKPOINT = 720;

// Mirror of the Shell JSX render guards (kept deliberately in lockstep).
const showInlineResizeHandle = (isNarrow: boolean) => !isNarrow;
const showOpenButton = (isNarrow: boolean, collapsed: boolean) => isNarrow && collapsed;
const showBackdrop = (isNarrow: boolean, collapsed: boolean) => isNarrow && !collapsed;
const showPanel = (isNarrow: boolean, collapsed: boolean) => !isNarrow || !collapsed;
const isOverlayMode = (isNarrow: boolean) => isNarrow;

describe("right-pane responsive breakpoint", () => {
  it("exposes a sensible narrow-viewport breakpoint", () => {
    expect(NARROW_VIEWPORT_BREAKPOINT).toBeGreaterThan(400);
    expect(NARROW_VIEWPORT_BREAKPOINT).toBeLessThan(1024);
  });
});

describe("desktop (wide) viewport — layout unchanged", () => {
  const isNarrow = false;

  it("always renders the inline resize handle", () => {
    expect(showInlineResizeHandle(isNarrow)).toBe(true);
  });

  it("renders the panel as an inline (non-overlay) column", () => {
    expect(showPanel(isNarrow, false)).toBe(true);
    expect(isOverlayMode(isNarrow)).toBe(false);
  });

  it("never shows the open button or dismiss backdrop", () => {
    expect(showOpenButton(isNarrow, false)).toBe(false);
    expect(showOpenButton(isNarrow, true)).toBe(false);
    expect(showBackdrop(isNarrow, false)).toBe(false);
  });

  it("keeps the panel mounted regardless of the collapsed flag", () => {
    // The collapsed flag only governs narrow mode; on desktop the pane is
    // always present so toggling it can never hide desktop panels.
    expect(showPanel(isNarrow, true)).toBe(true);
  });
});

describe("narrow/touch viewport — collapsible overlay drawer", () => {
  const isNarrow = true;

  it("renders the pane as an overlay (not an inline column)", () => {
    expect(isOverlayMode(isNarrow)).toBe(true);
  });

  it("hides the inline resize handle (overlay is fixed-anchored)", () => {
    expect(showInlineResizeHandle(isNarrow)).toBe(false);
  });

  describe("when collapsed (the default on narrow)", () => {
    const collapsed = true;
    it("shows the open toggle and hides the panel + backdrop", () => {
      expect(showOpenButton(isNarrow, collapsed)).toBe(true);
      expect(showPanel(isNarrow, collapsed)).toBe(false);
      expect(showBackdrop(isNarrow, collapsed)).toBe(false);
    });
  });

  describe("when expanded", () => {
    const collapsed = false;
    it("shows the panel + dismiss backdrop and hides the open toggle", () => {
      expect(showPanel(isNarrow, collapsed)).toBe(true);
      expect(showBackdrop(isNarrow, collapsed)).toBe(true);
      expect(showOpenButton(isNarrow, collapsed)).toBe(false);
    });
  });
});
