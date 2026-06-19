// @vitest-environment jsdom
/**
 * Acceptance tests for task 1222 — the Components panel and the Component
 * Inspector (Parameters tab).
 *
 *   1. <ComponentsPanel> lists the built-in v2 components and instantiates one on
 *      double-click (and exposes a drag payload via the component MIME).
 *   2. <ComponentInspectorPanel> renders one editor per parameter of the selected
 *      component instance and commits edits back through onChange — the same path
 *      Shell uses to persist `componentParameters` onto the instance model.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React, { act } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { BUILTIN_COMPONENTS } from "@flash/core";
import { ComponentsPanel } from "../ComponentsPanel";
import { ComponentInspectorPanel } from "../ComponentInspectorPanel";

/** Set a controlled input's value through React's tracked native setter so the
 *  synthetic onChange fires (plain `el.value = ...` is swallowed by React). */
function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(el, value);
}
function setNativeChecked(el: HTMLInputElement, checked: boolean) {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
  desc?.set?.call(el, checked);
}

describe("<ComponentsPanel>", () => {
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

  it("lists the built-in components", () => {
    act(() => {
      root.render(
        React.createElement(ComponentsPanel, {
          onInstantiate: () => {},
          onClose: () => {},
        })
      );
    });
    expect(container.querySelector('[data-testid="component-row-Button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="component-row-CheckBox"]')).not.toBeNull();
    const rows = container.querySelectorAll('[data-testid^="component-row-"]');
    expect(rows.length).toBe(BUILTIN_COMPONENTS.length);
  });

  it("instantiates a component on double-click", () => {
    let instantiated: string | null = null;
    act(() => {
      root.render(
        React.createElement(ComponentsPanel, {
          onInstantiate: (name: string) => { instantiated = name; },
          onClose: () => {},
        })
      );
    });
    const row = container.querySelector<HTMLDivElement>('[data-testid="component-row-Button"]')!;
    act(() => {
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(instantiated).toBe("Button");
  });

  it("closes via the close button", () => {
    let closed = false;
    act(() => {
      root.render(
        React.createElement(ComponentsPanel, {
          onInstantiate: () => {},
          onClose: () => { closed = true; },
        })
      );
    });
    const btn = container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(closed).toBe(true);
  });
});

describe("<ComponentInspectorPanel> Parameters tab", () => {
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

  it("renders an editor for every parameter of the component", () => {
    act(() => {
      root.render(
        React.createElement(ComponentInspectorPanel, {
          componentName: "Button",
          values: {},
          onChange: () => {},
        })
      );
    });
    const def = BUILTIN_COMPONENTS.find((c) => c.name === "Button")!;
    for (const p of def.parameters) {
      expect(container.querySelector(`[data-testid="param-${p.name}"]`)).not.toBeNull();
    }
  });

  it("shows the current value, falling back to the default when unset", () => {
    act(() => {
      root.render(
        React.createElement(ComponentInspectorPanel, {
          componentName: "Button",
          values: { label: "Play" },
          onChange: () => {},
        })
      );
    });
    const labelInput = container.querySelector<HTMLInputElement>('[data-testid="param-label"]')!;
    expect(labelInput.value).toBe("Play");
    // 'selected' is unset → falls back to the catalog default "false"
    const selected = container.querySelector<HTMLInputElement>('[data-testid="param-selected"]')!;
    expect(selected.checked).toBe(false);
  });

  it("commits a text-parameter edit on blur as a full parameter map", () => {
    let committed: Record<string, string> | null = null;
    act(() => {
      root.render(
        React.createElement(ComponentInspectorPanel, {
          componentName: "Button",
          values: {},
          onChange: (v: Record<string, string>) => { committed = v; },
        })
      );
    });
    const labelInput = container.querySelector<HTMLInputElement>('[data-testid="param-label"]')!;
    act(() => {
      setNativeValue(labelInput, "Start");
      labelInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      // React listens for onBlur via the bubbling "focusout" event at the root.
      labelInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(committed).not.toBeNull();
    expect(committed!.label).toBe("Start");
    // A complete default-backed map is persisted (so every param exists on the model).
    expect(committed!.selected).toBe("false");
  });

  it("commits a boolean-parameter toggle", () => {
    let committed: Record<string, string> | null = null;
    act(() => {
      root.render(
        React.createElement(ComponentInspectorPanel, {
          componentName: "Button",
          values: {},
          onChange: (v: Record<string, string>) => { committed = v; },
        })
      );
    });
    const toggle = container.querySelector<HTMLInputElement>('[data-testid="param-selected"]')!;
    act(() => {
      setNativeChecked(toggle, true);
      toggle.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(committed!.selected).toBe("true");
  });

  it("commits a list-parameter selection", () => {
    let committed: Record<string, string> | null = null;
    act(() => {
      root.render(
        React.createElement(ComponentInspectorPanel, {
          componentName: "Button",
          values: {},
          onChange: (v: Record<string, string>) => { committed = v; },
        })
      );
    });
    const select = container.querySelector<HTMLSelectElement>('[data-testid="param-labelPlacement"]')!;
    act(() => {
      setNativeValue(select, "left");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(committed!.labelPlacement).toBe("left");
  });
});
