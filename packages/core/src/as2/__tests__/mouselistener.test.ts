/**
 * Tests for AS2 compiler: Mouse event listener registration and handler
 * assignment patterns.
 *
 * Verifies that Mouse.addListener(), Mouse.removeListener(), Mouse.hide(),
 * Mouse.show(), and listener handler assignments (onMouseDown, onMouseUp,
 * onMouseMove) compile without error and emit the correct AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls (Mouse.addListener(), etc.)
 *   - ActionSetMember  (0x4e): handler assignments (listener.onMouseDown = ...)
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compilesOk(source: string): boolean {
  try {
    compileAS2(source);
    return true;
  } catch {
    return false;
  }
}

function containsByte(bytes: Uint8Array, byte: number): boolean {
  return bytes.includes(byte);
}

function containsString(bytes: Uint8Array, s: string): boolean {
  const enc = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= bytes.length - enc.length; i++) {
    for (let j = 0; j < enc.length; j++) {
      if (bytes[i + j] !== enc[j]) continue outer;
    }
    if (bytes[i + enc.length] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// AVM1 opcodes under test
// ---------------------------------------------------------------------------

const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_SET_MEMBER  = 0x4e; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// Mouse.addListener()
// ---------------------------------------------------------------------------

describe("Mouse.addListener()", () => {
  it("Mouse.addListener(obj) compiles without error", () => {
    expect(compilesOk("var obj = {}; Mouse.addListener(obj);")).toBe(true);
  });

  it("Mouse.addListener(obj) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var obj = {}; Mouse.addListener(obj);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "addListener")).toBe(true);
    expect(containsString(bytes, "Mouse")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mouse.removeListener()
// ---------------------------------------------------------------------------

describe("Mouse.removeListener()", () => {
  it("Mouse.removeListener(obj) compiles without error", () => {
    expect(compilesOk("var obj = {}; Mouse.removeListener(obj);")).toBe(true);
  });

  it("Mouse.removeListener(obj) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var obj = {}; Mouse.removeListener(obj);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "removeListener")).toBe(true);
    expect(containsString(bytes, "Mouse")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mouse.hide()
// ---------------------------------------------------------------------------

describe("Mouse.hide()", () => {
  it("Mouse.hide() compiles without error", () => {
    expect(compilesOk("Mouse.hide();")).toBe(true);
  });

  it("Mouse.hide() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Mouse.hide();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "hide")).toBe(true);
    expect(containsString(bytes, "Mouse")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mouse.show()
// ---------------------------------------------------------------------------

describe("Mouse.show()", () => {
  it("Mouse.show() compiles without error", () => {
    expect(compilesOk("Mouse.show();")).toBe(true);
  });

  it("Mouse.show() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Mouse.show();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "show")).toBe(true);
    expect(containsString(bytes, "Mouse")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listener.onMouseDown assignment
// ---------------------------------------------------------------------------

describe("listener.onMouseDown handler assignment", () => {
  it("listener.onMouseDown = function() {} compiles without error", () => {
    expect(compilesOk("var listener = {}; listener.onMouseDown = function() {};")).toBe(true);
  });

  it("listener.onMouseDown = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var listener = {}; listener.onMouseDown = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onMouseDown")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listener.onMouseUp assignment
// ---------------------------------------------------------------------------

describe("listener.onMouseUp handler assignment", () => {
  it("listener.onMouseUp = function() {} compiles without error", () => {
    expect(compilesOk("var listener = {}; listener.onMouseUp = function() {};")).toBe(true);
  });

  it("listener.onMouseUp = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var listener = {}; listener.onMouseUp = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onMouseUp")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listener.onMouseMove assignment
// ---------------------------------------------------------------------------

describe("listener.onMouseMove handler assignment", () => {
  it("listener.onMouseMove = function() {} compiles without error", () => {
    expect(compilesOk("var listener = {}; listener.onMouseMove = function() {};")).toBe(true);
  });

  it("listener.onMouseMove = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var listener = {}; listener.onMouseMove = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onMouseMove")).toBe(true);
  });
});
