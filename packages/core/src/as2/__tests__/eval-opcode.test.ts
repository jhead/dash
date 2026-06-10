/**
 * Tests for AS2 compiler eval(str) native opcode emission.
 *
 * Flash Professional emits ActionGetVariable instead of ActionCallFunction for
 * the built-in eval() function:
 *   eval(str) → ActionGetVariable (0x1C)
 *
 * eval() must NOT fall through to ActionCallFunction (0x3D).
 * "eval" must NOT appear in the constant pool.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Opcode constants
// ---------------------------------------------------------------------------

const ACTION_GET_VARIABLE  = 0x1c; // ActionGetVariable  — pops name, pushes value
const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction — generic call (should NOT appear)

// ---------------------------------------------------------------------------
// eval(str) — ActionGetVariable (0x1C)
// ---------------------------------------------------------------------------

describe("eval(str)", () => {
  it('eval("myVar") compiles without error', () => {
    expect(() => compileAS2('var v = eval("myVar");')).not.toThrow();
  });

  it('eval("myVar") emits ActionGetVariable (0x1C)', () => {
    const bytes = compileAS2('eval("myVar");');
    expect(containsByte(bytes, ACTION_GET_VARIABLE)).toBe(true);
  });

  it('eval("myVar") does NOT emit ActionCallFunction (0x3D)', () => {
    const bytes = compileAS2('eval("myVar");');
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it('"eval" is NOT in the constant pool', () => {
    const bytes = compileAS2('eval("myVar");');
    expect(containsString(bytes, "eval")).toBe(false);
  });

  it("eval(expr) with a variable argument emits ActionGetVariable (0x1C)", () => {
    const bytes = compileAS2("var v = eval(myVar);");
    expect(containsByte(bytes, ACTION_GET_VARIABLE)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("eval(a + b) with complex expression emits ActionGetVariable (0x1C)", () => {
    const bytes = compileAS2('var v = eval(prefix + "_suffix");');
    expect(containsByte(bytes, ACTION_GET_VARIABLE)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it('eval("a","b") with 2 args falls through to ActionCallFunction (0x3D)', () => {
    // Only exactly 1 argument is special-cased
    const bytes = compileAS2('eval("a", "b");');
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_GET_VARIABLE)).toBe(false);
  });
});
