/**
 * Unit tests for factory helpers in engine/factory.ts.
 *
 * Verifies:
 *  - createSymbolInstance: correct type discriminant, required fields, defaults
 *  - createTextInstance: correct type discriminant, required fields, defaults
 *  - createShapeInstance: correct type discriminant, required fields, defaults
 *  - isDisplayObject type guard
 *  - Unique id generation across calls
 */

import { describe, it, expect } from "vitest";
import {
  createSymbolInstance,
  createTextInstance,
  createShapeInstance,
  isDisplayObject,
} from "../factory.js";

// ---------------------------------------------------------------------------
// createSymbolInstance
// ---------------------------------------------------------------------------

describe("createSymbolInstance", () => {
  it("1. returns object with correct symbolId", () => {
    const inst = createSymbolInstance("lib-sym-1");
    expect(inst.symbolId).toBe("lib-sym-1");
  });

  it("2. sets instanceName when provided", () => {
    const inst = createSymbolInstance("sym", "myClip");
    expect(inst.instanceName).toBe("myClip");
  });

  it("3. instanceName is undefined when not provided", () => {
    const inst = createSymbolInstance("sym");
    expect(inst.instanceName).toBeUndefined();
  });

  it("4. default x and y are 0", () => {
    const inst = createSymbolInstance("sym");
    expect(inst.x).toBe(0);
    expect(inst.y).toBe(0);
  });

  it("5. custom x and y are set", () => {
    const inst = createSymbolInstance("sym", undefined, 120, 80);
    expect(inst.x).toBe(120);
    expect(inst.y).toBe(80);
  });

  it("6. type discriminant is 'instance'", () => {
    const inst = createSymbolInstance("sym");
    expect(inst.type).toBe("instance");
  });

  it("7. two calls return different id values", () => {
    const a = createSymbolInstance("sym");
    const b = createSymbolInstance("sym");
    expect(a.id).not.toBe(b.id);
  });

  it("8. factory result passes isDisplayObject type guard", () => {
    const inst = createSymbolInstance("sym");
    expect(isDisplayObject(inst)).toBe(true);
  });

  it("9. does not throw with only symbolId", () => {
    expect(() => createSymbolInstance("minimal-sym")).not.toThrow();
  });

  it("10. alpha defaults to 1", () => {
    const inst = createSymbolInstance("sym");
    expect(inst.alpha).toBe(1);
  });

  it("11. blendMode defaults to 'normal'", () => {
    const inst = createSymbolInstance("sym");
    expect(inst.blendMode).toBe("normal");
  });

  it("12. scaleX and scaleY default to 1", () => {
    const inst = createSymbolInstance("sym");
    expect(inst.scaleX).toBe(1);
    expect(inst.scaleY).toBe(1);
  });

  it("13. rotation defaults to 0", () => {
    const inst = createSymbolInstance("sym");
    expect(inst.rotation).toBe(0);
  });

  it("14. id is a non-empty string", () => {
    const inst = createSymbolInstance("sym");
    expect(typeof inst.id).toBe("string");
    expect(inst.id.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// createTextInstance
// ---------------------------------------------------------------------------

describe("createTextInstance", () => {
  it("15. returns object with correct type 'text'", () => {
    const t = createTextInstance("Hello");
    expect(t.type).toBe("text");
  });

  it("16. sets text content", () => {
    const t = createTextInstance("world");
    expect(t.text).toBe("world");
  });

  it("17. default position is (0, 0)", () => {
    const t = createTextInstance("hi");
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
  });

  it("18. custom position is set", () => {
    const t = createTextInstance("hi", 50, 75);
    expect(t.x).toBe(50);
    expect(t.y).toBe(75);
  });

  it("19. default width and height have positive values", () => {
    const t = createTextInstance("hi");
    expect(t.width).toBeGreaterThan(0);
    expect(t.height).toBeGreaterThan(0);
  });

  it("20. passes isDisplayObject type guard", () => {
    const t = createTextInstance("hi");
    expect(isDisplayObject(t)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createShapeInstance
// ---------------------------------------------------------------------------

describe("createShapeInstance", () => {
  it("21. returns object with correct type 'shape'", () => {
    const s = createShapeInstance();
    expect(s.type).toBe("shape");
  });

  it("22. default position is (0, 0)", () => {
    const s = createShapeInstance();
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });

  it("23. custom position is set", () => {
    const s = createShapeInstance(undefined, 30, 40);
    expect(s.x).toBe(30);
    expect(s.y).toBe(40);
  });

  it("24. passes isDisplayObject type guard", () => {
    const s = createShapeInstance();
    expect(isDisplayObject(s)).toBe(true);
  });

  it("25. has a non-empty id string", () => {
    const s = createShapeInstance();
    expect(typeof s.id).toBe("string");
    expect(s.id.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// isDisplayObject type guard
// ---------------------------------------------------------------------------

describe("isDisplayObject", () => {
  it("26. returns false for null", () => {
    expect(isDisplayObject(null)).toBe(false);
  });

  it("27. returns false for plain number", () => {
    expect(isDisplayObject(42)).toBe(false);
  });

  it("28. returns false for object with unknown type", () => {
    expect(isDisplayObject({ type: "unknown" })).toBe(false);
  });

  it("29. returns true for all known DisplayObject type variants", () => {
    const types = ["instance", "shape", "drawing-object", "text", "bitmap", "group"];
    for (const type of types) {
      expect(isDisplayObject({ type })).toBe(true);
    }
  });
});
