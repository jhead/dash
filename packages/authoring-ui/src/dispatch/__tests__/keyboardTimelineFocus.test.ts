// @vitest-environment jsdom
/**
 * Regression test for task 1376 — "Timeline + Stage global keydown double-fire".
 *
 * The Timeline panel owns the keyboard when it is focused (F5/F6/F7, Left/Right,
 * Enter, Ctrl+C/X/V, Delete/Backspace). The global `useCommandKeyboard`
 * dispatcher also listens on `window` and previously fired those same keys
 * regardless of Timeline focus, so a single Delete removed a frame AND deleted
 * the selected stage object (data loss); Enter toggled play twice; Ctrl+C/X/V
 * hit both the frame clipboard and the shape clipboard.
 *
 * Fix: `useCommandKeyboard` early-returns on `isTimelinePanelFocused()`. This
 * asserts that behaviour end-to-end (real jsdom focus + a real KeyboardEvent),
 * and that commands the Timeline does NOT consume still dispatch while another
 * element is focused.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useCommandKeyboard } from "../keyboard.js";

// Opt in to React's act() testing environment (silences the act-support warning).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ dispatch }: { dispatch: (id: string) => void }) {
  useCommandKeyboard({ dispatch });
  return null;
}

describe("useCommandKeyboard — Timeline focus routing (task 1376)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let dispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => root.render(React.createElement(Harness, { dispatch })));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function makeFocused(attrs: Record<string, string>): HTMLElement {
    const el = document.createElement("div");
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.tabIndex = 0;
    document.body.appendChild(el);
    el.focus();
    expect(document.activeElement).toBe(el);
    return el;
  }

  function press(key: string, init: KeyboardEventInit = {}): void {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
      );
    });
  }

  it("does NOT dispatch edit.delete when the Timeline panel is focused", () => {
    makeFocused({ "data-timeline-panel": "true" });
    press("Delete");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does NOT dispatch clipboard/playback commands when the Timeline is focused", () => {
    makeFocused({ "data-timeline-panel": "true" });
    press("c", { ctrlKey: true });
    press("v", { ctrlKey: true });
    press("Enter");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does NOT dispatch when focus is nested inside the Timeline panel", () => {
    const panel = makeFocused({ "data-timeline-panel": "true" });
    const inner = document.createElement("div");
    inner.tabIndex = 0;
    panel.appendChild(inner);
    inner.focus();
    press("Delete");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("DOES dispatch edit.delete when the stage (not the Timeline) is focused", () => {
    makeFocused({ "data-testid": "stage-canvas" });
    press("Delete");
    expect(dispatch).toHaveBeenCalledWith("edit.delete");
  });

  it("DOES dispatch undo even while the Timeline is focused (not a Timeline-consumed key)", () => {
    makeFocused({ "data-timeline-panel": "true" });
    press("z", { ctrlKey: true });
    expect(dispatch).toHaveBeenCalledWith("history.undo");
  });
});
