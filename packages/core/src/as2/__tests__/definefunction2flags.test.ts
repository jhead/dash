/**
 * Tests for task 0881: DefineFunction2 preload/suppress flags.
 *
 * Real Flash 8 sets SUPPRESS_ARGUMENTS (bit 3, value 0x0008) when a function
 * body doesn't reference `arguments`. This avoids needlessly constructing the
 * arguments array-object on every call and matches Flash 8 output.
 *
 * Flag bits (per Ruffle swf/src/avm1/types.rs FunctionFlags):
 *   Bit 0 (0x0001): PRELOAD_THIS
 *   Bit 1 (0x0002): SUPPRESS_THIS
 *   Bit 2 (0x0004): PRELOAD_ARGUMENTS
 *   Bit 3 (0x0008): SUPPRESS_ARGUMENTS
 *   Bit 4 (0x0010): PRELOAD_SUPER
 *   Bit 5 (0x0020): SUPPRESS_SUPER
 *   Bit 6 (0x0040): PRELOAD_ROOT
 *   Bit 7 (0x0080): PRELOAD_PARENT
 *   Bit 8 (0x0100): PRELOAD_GLOBAL
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the first ActionDefineFunction2 (0x8E) record in the bytecode and
 * return the 2-byte little-endian flags field at the expected position.
 *
 * DefineFunction2 format after opcode+length:
 *   name (C-string), numParams (UI16), registerCount (UI8), flags (UI16), ...
 */
function extractDefineFunction2Flags(bytes: Uint8Array): number | null {
  let i = 0;
  while (i < bytes.length) {
    const code = bytes[i]!;
    if (code >= 0x80) {
      const len = bytes[i + 1]! | (bytes[i + 2]! << 8);
      if (code === 0x8e) {
        // Skip opcode (1) + length field (2) = start of payload at i+3
        const base = i + 3;
        // Skip C-string name: find the null terminator
        let p = base;
        while (p < bytes.length && bytes[p] !== 0) p++;
        p++; // skip the null
        // Skip numParams (2 bytes), registerCount (1 byte) → flags at p+3
        const flagsOffset = p + 3;
        if (flagsOffset + 1 < bytes.length) {
          return bytes[flagsOffset]! | (bytes[flagsOffset + 1]! << 8);
        }
        return null;
      }
      i += 3 + len;
    } else {
      i += 1;
    }
  }
  return null;
}

const SUPPRESS_ARGUMENTS = 0x0008;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineFunction2 preload/suppress flags (task 0881)", () => {
  // -------------------------------------------------------------------------
  // 1. Simple function without 'arguments' → SUPPRESS_ARGUMENTS set
  // -------------------------------------------------------------------------
  it("1. simple function not using arguments has SUPPRESS_ARGUMENTS set", () => {
    const bytes = compileAS2(`
      function greet(name) {
        trace(name);
      }
    `);
    const flags = extractDefineFunction2Flags(bytes);
    expect(flags).not.toBeNull();
    expect(flags! & SUPPRESS_ARGUMENTS).toBe(SUPPRESS_ARGUMENTS);
  });

  // -------------------------------------------------------------------------
  // 2. Function that uses 'arguments' → SUPPRESS_ARGUMENTS not set
  // -------------------------------------------------------------------------
  it("2. function using arguments does NOT have SUPPRESS_ARGUMENTS set", () => {
    const bytes = compileAS2(`
      function variadic() {
        var len = arguments.length;
        trace(len);
      }
    `);
    const flags = extractDefineFunction2Flags(bytes);
    expect(flags).not.toBeNull();
    expect(flags! & SUPPRESS_ARGUMENTS).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 3. Class method that doesn't use 'arguments' → SUPPRESS_ARGUMENTS set
  // -------------------------------------------------------------------------
  it("3. class method not using arguments has SUPPRESS_ARGUMENTS set", () => {
    const bytes = compileAS2(`
      class Greeter {
        function greet() {
          trace("hi");
        }
      }
    `);
    const flags = extractDefineFunction2Flags(bytes);
    expect(flags).not.toBeNull();
    expect(flags! & SUPPRESS_ARGUMENTS).toBe(SUPPRESS_ARGUMENTS);
  });

  // -------------------------------------------------------------------------
  // 4. Top-level function using 'arguments' → SUPPRESS_ARGUMENTS not set
  // -------------------------------------------------------------------------
  it("4. top-level function using arguments does NOT have SUPPRESS_ARGUMENTS set", () => {
    // Use a top-level function (not a class method) so the FIRST
    // DefineFunction2 in the bytecode is the one that references `arguments`.
    const bytes = compileAS2(`
      function log() {
        trace(arguments[0]);
      }
    `);
    const flags = extractDefineFunction2Flags(bytes);
    expect(flags).not.toBeNull();
    expect(flags! & SUPPRESS_ARGUMENTS).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 5. Anonymous function expression without 'arguments' → SUPPRESS_ARGUMENTS set
  // -------------------------------------------------------------------------
  it("5. anonymous function expression without arguments has SUPPRESS_ARGUMENTS set", () => {
    const bytes = compileAS2(`
      var fn = function(x) { return x * 2; };
    `);
    const flags = extractDefineFunction2Flags(bytes);
    expect(flags).not.toBeNull();
    expect(flags! & SUPPRESS_ARGUMENTS).toBe(SUPPRESS_ARGUMENTS);
  });

  // -------------------------------------------------------------------------
  // 6. 'arguments' in a nested function does NOT affect the outer function
  // -------------------------------------------------------------------------
  it("6. arguments in nested function does not suppress outer function suppression", () => {
    const bytes = compileAS2(`
      function outer() {
        var inner = function() { return arguments.length; };
      }
    `);
    // The OUTER function's DefineFunction2 (the first one encountered) should
    // have SUPPRESS_ARGUMENTS set because the outer body doesn't reference
    // 'arguments' directly (only the inner function does).
    const flags = extractDefineFunction2Flags(bytes);
    expect(flags).not.toBeNull();
    expect(flags! & SUPPRESS_ARGUMENTS).toBe(SUPPRESS_ARGUMENTS);
  });
});
