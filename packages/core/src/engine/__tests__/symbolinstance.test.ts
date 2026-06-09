/**
 * Unit tests for SymbolInstance and DisplayObject property types.
 *
 * Verifies:
 *  1. Default x/y/scaleX/scaleY/rotation/alpha/visible field types
 *  2. Immutable spread update pattern
 *  3. blendMode property values
 *  4. filters array (empty and populated)
 *  5. libraryItemId (symbolId) reference field
 *  6. colorEffect field
 *  7. instanceName optional field
 *  8. loopMode optional field
 */

import { describe, it, expect } from "vitest";
import type { SymbolInstance, ColorEffect } from "../types.js";
import type { DropShadowFilter } from "../filters.js";

// ---------------------------------------------------------------------------
// Helpers — minimal SymbolInstance factories
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<SymbolInstance> = {}): SymbolInstance {
  return {
    type: "instance",
    id: "inst-1",
    symbolId: "sym-1",
    x: 0,
    y: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SymbolInstance display-object properties", () => {
  it("1. x and y are numbers", () => {
    const inst = makeInstance({ x: 120, y: 80 });
    expect(typeof inst.x).toBe("number");
    expect(typeof inst.y).toBe("number");
    expect(inst.x).toBe(120);
    expect(inst.y).toBe(80);
  });

  it("2. scaleX and scaleY default to undefined (treated as 1)", () => {
    const inst = makeInstance();
    expect(inst.scaleX).toBeUndefined();
    expect(inst.scaleY).toBeUndefined();
  });

  it("3. scaleX and scaleY accept numeric values", () => {
    const inst = makeInstance({ scaleX: 2, scaleY: 0.5 });
    expect(inst.scaleX).toBe(2);
    expect(inst.scaleY).toBe(0.5);
  });

  it("4. rotation defaults to undefined (treated as 0)", () => {
    const inst = makeInstance();
    expect(inst.rotation).toBeUndefined();
  });

  it("5. rotation accepts a number (degrees)", () => {
    const inst = makeInstance({ rotation: 45 });
    expect(typeof inst.rotation).toBe("number");
    expect(inst.rotation).toBe(45);
  });

  it("6. alpha defaults to undefined (treated as 1)", () => {
    const inst = makeInstance();
    expect(inst.alpha).toBeUndefined();
  });

  it("7. alpha accepts a value in 0–1 range", () => {
    const inst = makeInstance({ alpha: 0.5 });
    expect(inst.alpha).toBe(0.5);
  });

  it("8. spread update does not mutate original object", () => {
    const original = makeInstance({ x: 0, y: 0 });
    const updated: SymbolInstance = { ...original, x: 100 };
    expect(original.x).toBe(0);
    expect(updated.x).toBe(100);
    expect(original).not.toBe(updated);
  });

  it("9. blendMode accepts all valid Flash 8 modes", () => {
    const modes: SymbolInstance["blendMode"][] = [
      "normal", "layer", "multiply", "screen", "lighten", "darken",
      "difference", "add", "subtract", "invert", "alpha", "erase",
      "overlay", "hardlight",
    ];
    for (const mode of modes) {
      const inst = makeInstance({ blendMode: mode });
      expect(inst.blendMode).toBe(mode);
    }
  });

  it("10. filters defaults to undefined", () => {
    const inst = makeInstance();
    expect(inst.filters).toBeUndefined();
  });

  it("11. filters accepts an empty array", () => {
    const inst = makeInstance({ filters: [] });
    expect(Array.isArray(inst.filters)).toBe(true);
    expect(inst.filters?.length).toBe(0);
  });

  it("12. filters accepts a populated array", () => {
    const filter: DropShadowFilter = {
      type: "drop-shadow",
      distance: 4,
      angle: 45,
      color: { r: 0, g: 0, b: 0, a: 1 },
      alpha: 0.65,
      blurX: 4,
      blurY: 4,
      strength: 1,
      inner: false,
      knockout: false,
      hideObject: false,
      enabled: true,
    };
    const inst = makeInstance({ filters: [filter] });
    expect(inst.filters?.length).toBe(1);
    expect(inst.filters?.[0].type).toBe("drop-shadow");
  });

  it("13. symbolId is the library item reference field", () => {
    const inst = makeInstance({ symbolId: "lib-symbol-42" });
    expect(inst.symbolId).toBe("lib-symbol-42");
    expect(typeof inst.symbolId).toBe("string");
  });

  it("14. instanceName is optional and accepts a string", () => {
    const inst = makeInstance({ instanceName: "myClip" });
    expect(inst.instanceName).toBe("myClip");
  });

  it("15. colorEffect accepts an alpha color effect", () => {
    const effect: ColorEffect = { type: "alpha", alpha: 50 };
    const inst = makeInstance({ colorEffect: effect });
    expect(inst.colorEffect?.type).toBe("alpha");
    expect(inst.colorEffect?.alpha).toBe(50);
  });

  it("16. loopMode accepts 'loop', 'play-once', and 'single-frame'", () => {
    const modes: SymbolInstance["loopMode"][] = ["loop", "play-once", "single-frame"];
    for (const mode of modes) {
      const inst = makeInstance({ loopMode: mode });
      expect(inst.loopMode).toBe(mode);
    }
  });
});
