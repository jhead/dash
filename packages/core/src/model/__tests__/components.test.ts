/**
 * Unit tests for the built-in v2 component catalog (model/components.ts) and the
 * createComponent library factory. See docs/13-components.md (task 1222).
 */

import { describe, it, expect } from "vitest";
import {
  BUILTIN_COMPONENTS,
  getComponentDef,
  defaultComponentParameters,
} from "../components.js";
import { createComponent } from "../library.js";

describe("BUILTIN_COMPONENTS catalog", () => {
  it("includes the core v2 UI components", () => {
    const names = BUILTIN_COMPONENTS.map((c) => c.name);
    for (const expected of [
      "Button",
      "CheckBox",
      "RadioButton",
      "Label",
      "TextInput",
      "ComboBox",
      "List",
      "DataGrid",
      "NumericStepper",
      "ScrollPane",
      "ProgressBar",
      "UIScrollBar",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("every component has a class, package, category, size, and parameters array", () => {
    for (const c of BUILTIN_COMPONENTS) {
      expect(c.className.length).toBeGreaterThan(0);
      expect(c.packageName.length).toBeGreaterThan(0);
      expect(c.category.length).toBeGreaterThan(0);
      expect(c.defaultWidth).toBeGreaterThan(0);
      expect(c.defaultHeight).toBeGreaterThan(0);
      expect(Array.isArray(c.parameters)).toBe(true);
    }
  });

  it("list-type parameters declare their options", () => {
    for (const c of BUILTIN_COMPONENTS) {
      for (const p of c.parameters) {
        if (p.type === "list") {
          expect(p.options && p.options.length).toBeGreaterThan(0);
          // The default value must be one of the listed options.
          expect(p.options).toContain(p.defaultValue);
        }
      }
    }
  });

  it("component names are unique", () => {
    const names = BUILTIN_COMPONENTS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("getComponentDef", () => {
  it("resolves by display name and by class name", () => {
    expect(getComponentDef("Button")?.className).toBe("Button");
    expect(getComponentDef("CheckBox")?.name).toBe("CheckBox");
  });

  it("returns undefined for an unknown component", () => {
    expect(getComponentDef("NotAComponent")).toBeUndefined();
  });
});

describe("defaultComponentParameters", () => {
  it("builds a name → default-value map covering every parameter", () => {
    const def = getComponentDef("Button")!;
    const params = defaultComponentParameters(def);
    expect(params.label).toBe("Button");
    expect(params.selected).toBe("false");
    expect(params.enabled).toBe("true");
    expect(Object.keys(params).length).toBe(def.parameters.length);
  });
});

describe("createComponent factory", () => {
  it("creates a component library item with the given metadata", () => {
    const item = createComponent("Button", "Button", "mx.controls");
    expect(item.itemType).toBe("component");
    expect(item.name).toBe("Button");
    expect(item.componentName).toBe("Button");
    expect(item.packageName).toBe("mx.controls");
    expect(item.id.length).toBeGreaterThan(0);
  });

  it("applies overrides", () => {
    const item = createComponent("Button", "Button", "mx.controls", { name: "btn1" });
    expect(item.name).toBe("btn1");
  });
});
