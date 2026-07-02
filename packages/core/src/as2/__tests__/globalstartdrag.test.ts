/**
 * Tests for the AS2 compiler's GLOBAL (built-in) startDrag(...) call.
 *
 * Unlike the method form `mc.startDrag(...)` (which routes through the generic
 * CallMethod path and emits 0x52), the global `startDrag(target, ...)` built-in
 * emits ActionStartDrag (0x27) directly. It must accept the full AVM1 argument
 * range without crashing the compiler:
 *   - startDrag()                                    — drag `this`
 *   - startDrag(target)                              — 1-arg form
 *   - startDrag(target, lockCenter)                  — 2-arg form
 *   - startDrag(target, lockCenter, l, t, r, b)      — 6-arg constrain form
 * The 3–5 arg forms are non-standard but must not read past the args list.
 *
 * Regression: previously `startDrag(target)` (1 arg) and the 3–5 arg forms fell
 * into an `else` branch that read `args[2..5]` out of bounds, throwing
 * "Cannot read properties of undefined (reading 'type')".
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

const ACTION_START_DRAG = 0x27; // ActionStartDrag

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

describe("global startDrag() built-in — all arities", () => {
  it("startDrag() (0 args) compiles and emits ActionStartDrag (0x27)", () => {
    expect(compilesOk("startDrag();")).toBe(true);
    expect(containsByte(compileAS2("startDrag();"), ACTION_START_DRAG)).toBe(true);
  });

  it("startDrag(_root.mc) (1 arg) compiles and emits ActionStartDrag (0x27)", () => {
    // The regression case: this used to throw.
    expect(compilesOk("startDrag(_root.mc);")).toBe(true);
    expect(containsByte(compileAS2("startDrag(_root.mc);"), ACTION_START_DRAG)).toBe(true);
  });

  it("startDrag(_root.mc, true) (2 args) compiles and emits ActionStartDrag (0x27)", () => {
    expect(compilesOk("startDrag(_root.mc, true);")).toBe(true);
    expect(containsByte(compileAS2("startDrag(_root.mc, true);"), ACTION_START_DRAG)).toBe(true);
  });

  it("startDrag(_root.mc, true, 0) (3 args) compiles and emits ActionStartDrag (0x27)", () => {
    expect(compilesOk("startDrag(_root.mc, true, 0);")).toBe(true);
    expect(containsByte(compileAS2("startDrag(_root.mc, true, 0);"), ACTION_START_DRAG)).toBe(true);
  });

  it("startDrag(_root.mc, true, 0, 0) (4 args) compiles and emits ActionStartDrag (0x27)", () => {
    expect(compilesOk("startDrag(_root.mc, true, 0, 0);")).toBe(true);
    expect(containsByte(compileAS2("startDrag(_root.mc, true, 0, 0);"), ACTION_START_DRAG)).toBe(true);
  });

  it("startDrag(_root.mc, true, 0, 0, 100) (5 args) compiles and emits ActionStartDrag (0x27)", () => {
    expect(compilesOk("startDrag(_root.mc, true, 0, 0, 100);")).toBe(true);
    expect(containsByte(compileAS2("startDrag(_root.mc, true, 0, 0, 100);"), ACTION_START_DRAG)).toBe(true);
  });

  it("startDrag(_root.mc, true, 0, 0, 100, 100) (6-arg constrain) compiles and emits ActionStartDrag (0x27)", () => {
    expect(compilesOk("startDrag(_root.mc, true, 0, 0, 100, 100);")).toBe(true);
    expect(containsByte(compileAS2("startDrag(_root.mc, true, 0, 0, 100, 100);"), ACTION_START_DRAG)).toBe(true);
  });
});
