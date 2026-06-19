// @vitest-environment jsdom
/**
 * Regression test for task 1304 — "Open menu doesn't close when clicking
 * outside it (e.g. on the stage)".
 *
 * BUG: an open MenuBar dropdown was dismissed by a document-level listener that
 * was registered for the bubbling `mousedown` event only. After the task-1275
 * stage pointer-events migration, the stage work area captures the pointer on
 * its own `pointerdown` (setPointerCapture) and/or calls preventDefault on the
 * compat mousedown — both of which SUPPRESS the compatibility `mousedown` for
 * that gesture. So a press that began on the stage never reached the MenuBar's
 * `mousedown` listener and the open menu stayed open. Clicking other chrome
 * (which still emits a plain mousedown) DID dismiss it — confirming the
 * event-type gap rather than a z-index/overlay issue.
 *
 * FIX (MenuBar.tsx MenuBarItem useEffect): the dismiss listener now uses
 * `pointerdown` in the CAPTURE phase. `pointerdown` is dispatched to the
 * document BEFORE the stage element captures the pointer, and the capture phase
 * runs even when a child stops propagation of the bubbling event.
 *
 * These tests mount the real <MenuBarItem> in jsdom and drive DOM events:
 *  (1) a `pointerdown` OUTSIDE the menu closes it (the bug fix);
 *  (2) a `pointerdown` on a target INSIDE the menu (a dropdown item) does NOT
 *      close it (so item clicks/actions still fire);
 *  (3) a bare `mousedown` outside the menu is IGNORED (proving the listener no
 *      longer depends on the compat mousedown the stage suppresses).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React, { act } from "react";

// Tell React 18 the environment supports act() (silences the act warning under jsdom).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
import { createRoot, type Root } from "react-dom/client";
import { MenuBarItem } from "../MenuBar";

const MENU = {
  name: "Modify",
  items: [
    { label: "Document...  Ctrl+J", action: () => {} },
    { label: "Convert to Symbol...  F8", action: () => {} },
  ],
};

let container: HTMLDivElement;
let root: Root;
let outside: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  // A separate element standing in for the stage / other chrome.
  outside = document.createElement("div");
  outside.setAttribute("data-testid", "outside");
  document.body.appendChild(outside);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  outside.remove();
});

/** Mount a controlled MenuBarItem that starts open; returns a close-call counter. */
function mountOpenMenu(): { closes: () => number } {
  let closeCount = 0;
  act(() => {
    root.render(
      React.createElement(MenuBarItem, {
        menu: MENU,
        isOpen: true,
        onOpen: () => {},
        onClose: () => {
          closeCount += 1;
        },
      })
    );
  });
  return { closes: () => closeCount };
}

/** True when the dropdown (the menu items container) is currently rendered. */
function dropdownIsOpen(): boolean {
  // The dropdown renders its item labels; the menu label text always renders.
  return container.textContent?.includes("Document") ?? false;
}

describe("MenuBar outside-click dismissal (task 1304)", () => {
  it("renders the dropdown items when open", () => {
    mountOpenMenu();
    expect(dropdownIsOpen()).toBe(true);
  });

  it("closes the open menu on a pointerdown OUTSIDE it (the stage case)", () => {
    const { closes } = mountOpenMenu();
    expect(closes()).toBe(0);
    act(() => {
      outside.dispatchEvent(
        new Event("pointerdown", { bubbles: true })
      );
    });
    expect(closes()).toBe(1);
  });

  it("does NOT close when the pointerdown target is INSIDE the menu", () => {
    const { closes } = mountOpenMenu();
    // Find a dropdown item element inside the menu and press on it.
    const inside = container.querySelector("div");
    expect(inside).not.toBeNull();
    act(() => {
      inside!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(closes()).toBe(0);
  });

  it("listens on pointerdown (capture), not the suppressible compat mousedown", () => {
    const { closes } = mountOpenMenu();
    // A bare mousedown outside must NOT be what dismisses the menu — the stage's
    // pointer capture suppresses exactly this event, which was the original bug.
    act(() => {
      outside.dispatchEvent(new Event("mousedown", { bubbles: true }));
    });
    expect(closes()).toBe(0);
    // ...but a pointerdown outside still dismisses.
    act(() => {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(closes()).toBe(1);
  });
});
