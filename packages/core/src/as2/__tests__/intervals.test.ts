/**
 * Tests for AS2 compiler: setInterval, clearInterval, and getTimer built-ins.
 *
 * Verifies that interval/timer functions compile without error and emit the
 * correct AVM1 opcodes:
 *   - ActionCallFunction (0x3D): global function calls (setInterval, clearInterval, getTimer)
 *   - ActionGetVariable  (0x1c): variable reads (may be emitted for getTimer)
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

const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction — global function call
const ACTION_GET_VARIABLE  = 0x1c; // ActionGetVariable  — variable read

// ---------------------------------------------------------------------------
// setInterval(fn, delay)
// ---------------------------------------------------------------------------

describe("setInterval(fn, delay)", () => {
  it("1. setInterval(myFunc, 1000) compiles without error", () => {
    expect(compilesOk("setInterval(myFunc, 1000);")).toBe(true);
  });

  it("2. setInterval(myFunc, 1000) emits ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("setInterval(myFunc, 1000);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "setInterval")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setInterval(obj, "methodName", delay)
// ---------------------------------------------------------------------------

describe("setInterval(obj, method, delay)", () => {
  it("3. setInterval(obj, \"methodName\", 500) compiles without error", () => {
    expect(compilesOk('setInterval(obj, "methodName", 500);')).toBe(true);
  });

  it("4. setInterval(obj, \"methodName\", 500) emits ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2('setInterval(obj, "methodName", 500);');
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "setInterval")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// var id = setInterval(fn, delay)
// ---------------------------------------------------------------------------

describe("var id = setInterval(fn, delay)", () => {
  it("5. var id = setInterval(fn, 100) compiles without error", () => {
    expect(compilesOk("var id = setInterval(fn, 100);")).toBe(true);
  });

  it("6. var id = setInterval(fn, 100) emits ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("var id = setInterval(fn, 100);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "setInterval")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clearInterval(id)
// ---------------------------------------------------------------------------

describe("clearInterval(id)", () => {
  it("7. clearInterval(id) compiles without error", () => {
    expect(compilesOk("clearInterval(id);")).toBe(true);
  });

  it("8. clearInterval(id) emits ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("clearInterval(id);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "clearInterval")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getTimer()
// ---------------------------------------------------------------------------

describe("getTimer()", () => {
  it("9. getTimer() compiles without error", () => {
    expect(compilesOk("getTimer();")).toBe(true);
  });

  it("10. getTimer() emits ActionGetTime (0x34)", () => {
    const bytes = compileAS2("getTimer();");
    expect(containsByte(bytes, 0x34)).toBe(true); // ActionGetTime
  });
});

// ---------------------------------------------------------------------------
// var elapsed = getTimer()
// ---------------------------------------------------------------------------

describe("var elapsed = getTimer()", () => {
  it("11. var elapsed = getTimer() compiles without error", () => {
    expect(compilesOk("var elapsed = getTimer();")).toBe(true);
  });

  it("12. var elapsed = getTimer() emits ActionGetTime (0x34)", () => {
    const bytes = compileAS2("var elapsed = getTimer();");
    expect(containsByte(bytes, 0x34)).toBe(true); // ActionGetTime
  });
});

// ---------------------------------------------------------------------------
// Full interval pattern: set and clear with anonymous function
// ---------------------------------------------------------------------------

describe("Full interval pattern", () => {
  it("13. var id = setInterval(function() { trace(\"tick\"); }, 1000); clearInterval(id) — compiles without error", () => {
    expect(
      compilesOk(
        'var id = setInterval(function() { trace("tick"); }, 1000); clearInterval(id);'
      )
    ).toBe(true);
  });

  it("14. Full pattern emits ActionCallFunction (0x3D) for setInterval and clearInterval", () => {
    const bytes = compileAS2(
      'var id = setInterval(function() { trace("tick"); }, 1000); clearInterval(id);'
    );
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "setInterval")).toBe(true);
    expect(containsString(bytes, "clearInterval")).toBe(true);
  });
});
