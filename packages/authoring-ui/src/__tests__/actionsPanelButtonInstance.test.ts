// @vitest-environment jsdom
/**
 * Acceptance tests for task 1197 — the Actions panel must surface (and allow
 * editing of) the on() handlers attached to a selected BUTTON INSTANCE placed on
 * the stage (`SymbolInstance.buttonHandlers`). These are the handlers imported
 * from a Flash 8 FLA's `on(release){...}` blocks; before this fix they were in the
 * model but invisible/uneditable in the authoring UI.
 *
 * Two layers of coverage:
 *   1. Pure-logic tests for the read/update helpers (getButtonHandlerScript /
 *      updateButtonHandlerScript) — these are the model read/write path.
 *   2. A real react-dom render test that mounts <ActionsPanel> with a selected
 *      button instance, asserts the on(release) script text is shown in the
 *      editor, and that typing a new script calls back with an updated handler
 *      list (the same path Shell uses to persist into the model).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React, { act } from "react";

// Tell React 18 the environment supports act() (silences the act warning under jsdom).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import type { ButtonHandler, SymbolInstance } from "@flash/core";
import {
  ActionsPanel,
  getButtonHandlerScript,
  updateButtonHandlerScript,
  buttonHandlerEventKey,
} from "../ActionsPanel";

// ---------------------------------------------------------------------------
// 1. Pure-logic: read/update helpers
// ---------------------------------------------------------------------------

describe("getButtonHandlerScript", () => {
  const handlers: ButtonHandler[] = [
    { event: "release", script: 'gotoAndPlay("game");' },
    { event: "press", script: "trace(1);" },
  ];

  it("returns the script for a matching event", () => {
    expect(getButtonHandlerScript(handlers, "release")).toBe('gotoAndPlay("game");');
    expect(getButtonHandlerScript(handlers, "press")).toBe("trace(1);");
  });

  it("returns empty string for an event with no handler", () => {
    expect(getButtonHandlerScript(handlers, "rollOver")).toBe("");
  });

  it("matches keyPress handlers by key", () => {
    const kp: ButtonHandler[] = [{ event: { keyPress: "<Left>" }, script: "left();" }];
    expect(getButtonHandlerScript(kp, { keyPress: "<Left>" })).toBe("left();");
    expect(getButtonHandlerScript(kp, { keyPress: "<Right>" })).toBe("");
  });
});

describe("updateButtonHandlerScript", () => {
  it("adds a new handler when none exists for the event", () => {
    const out = updateButtonHandlerScript([], "release", 'gotoAndPlay("game");');
    expect(out).toEqual([{ event: "release", script: 'gotoAndPlay("game");' }]);
  });

  it("replaces an existing handler's script in place", () => {
    const handlers: ButtonHandler[] = [{ event: "release", script: "old();" }];
    const out = updateButtonHandlerScript(handlers, "release", "new();");
    expect(out).toEqual([{ event: "release", script: "new();" }]);
  });

  it("removes a handler when the new script is empty", () => {
    const handlers: ButtonHandler[] = [
      { event: "press", script: "p();" },
      { event: "release", script: "r();" },
    ];
    const out = updateButtonHandlerScript(handlers, "release", "   ");
    expect(out).toEqual([{ event: "press", script: "p();" }]);
  });

  it("preserves canonical event ordering when inserting", () => {
    // Insert 'press' (index 0) into a list that already has 'release' (index 1):
    const handlers: ButtonHandler[] = [{ event: "release", script: "r();" }];
    const out = updateButtonHandlerScript(handlers, "press", "p();");
    expect(out.map((h) => h.event)).toEqual(["press", "release"]);
  });

  it("does not mutate the input array", () => {
    const handlers: ButtonHandler[] = [{ event: "release", script: "r();" }];
    const snapshot = JSON.parse(JSON.stringify(handlers));
    updateButtonHandlerScript(handlers, "press", "p();");
    expect(handlers).toEqual(snapshot);
  });
});

describe("buttonHandlerEventKey", () => {
  it("returns the event name for string events", () => {
    expect(buttonHandlerEventKey("release")).toBe("release");
  });
  it("encodes keyPress events", () => {
    expect(buttonHandlerEventKey({ keyPress: "<Left>" })).toBe("keyPress:<Left>");
  });
});

// ---------------------------------------------------------------------------
// 2. Component: <ActionsPanel> in button-instance mode
// ---------------------------------------------------------------------------

describe("<ActionsPanel> button-instance mode", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function makeButtonInstance(handlers: ButtonHandler[]): SymbolInstance {
    return {
      type: "instance",
      id: "inst-1",
      symbolId: "sym-btn",
      x: 0,
      y: 0,
      instanceName: "PlayButton",
      buttonHandlers: handlers,
    };
  }

  it("shows the imported on(release) script for a selected button instance", () => {
    const inst = makeButtonInstance([
      { event: "release", script: 'gotoAndPlay("game");' },
    ]);

    act(() => {
      root.render(
        React.createElement(ActionsPanel, {
          embedded: true,
          isVisible: true,
          script: "",
          frameIndex: 0,
          layerName: "Layer 1",
          onScriptChange: () => {},
          onClose: () => {},
          selectedButtonInstance: inst,
          onButtonHandlersChange: () => {},
        })
      );
    });

    // Title indicates Button mode for the named instance is implied; the editor
    // textarea must contain the imported release script (the default selected
    // event is 'press', so first switch to the 'release' tab).
    const releaseTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-handler-event-release"]'
    );
    expect(releaseTab).not.toBeNull();
    act(() => {
      releaseTab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea!.value).toBe('gotoAndPlay("game");');
  });

  it("persists an edit to the release handler via onButtonHandlersChange", () => {
    const inst = makeButtonInstance([
      { event: "release", script: 'gotoAndPlay("game");' },
    ]);
    let lastHandlers: readonly ButtonHandler[] | null = null;

    act(() => {
      root.render(
        React.createElement(ActionsPanel, {
          embedded: true,
          isVisible: true,
          script: "",
          frameIndex: 0,
          layerName: "Layer 1",
          onScriptChange: () => {},
          onClose: () => {},
          selectedButtonInstance: inst,
          onButtonHandlersChange: (h) => {
            lastHandlers = h;
          },
        })
      );
    });

    // Select the release event tab so its script is loaded into the editor.
    const releaseTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-handler-event-release"]'
    )!;
    act(() => {
      releaseTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Edit the textarea (simulate a user typing a new script).
    const textarea = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )!.set!;
    act(() => {
      setter.call(textarea, 'gotoAndStop("menu");');
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(lastHandlers).not.toBeNull();
    expect(lastHandlers).toEqual([{ event: "release", script: 'gotoAndStop("menu");' }]);
  });
});
