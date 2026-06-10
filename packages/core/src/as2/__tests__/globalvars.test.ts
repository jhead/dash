/**
 * Tests for AS2 _global variable assignments and top-level var declarations.
 *
 * Verifies that:
 * - _global.foo = value compiles via ActionSetMember (0x4f) on the _global object
 * - _global is treated as an identifier that resolves via ActionGetVariable
 * - var x = 5 at the top level compiles to ActionDefineLocal (0x3c)
 * - var x without initializer compiles to ActionDefineLocal2 (0x41)
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
    // Check null terminator after the string (as it's stored in ActionPush payloads)
    if (bytes[i + enc.length] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// _global assignment tests
// ---------------------------------------------------------------------------

describe("_global variable assignments", () => {
  // Test 1: _global.foo = 5 compiles without error
  it("_global.foo = 5 compiles without error", () => {
    expect(compilesOk("_global.foo = 5;")).toBe(true);
  });

  // Test 2: Compiled output contains ActionSetMember (0x4f) for _global assignment
  it("_global.foo = 5 emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("_global.foo = 5;");
    // ActionSetMember (0x4f) should be present
    expect(containsByte(bytes, 0x4f)).toBe(true);
  });

  // Test 3: _global is resolved via ActionGetVariable (0x1c) as a regular identifier
  it("_global is resolved via ActionGetVariable (0x1c)", () => {
    const bytes = compileAS2("_global.foo = 5;");
    // ActionGetVariable (0x1c) should appear to load the _global object
    expect(containsByte(bytes, 0x1c)).toBe(true);
  });

  // Test 4: _global.version = "1.0" compiles — string value
  it('_global.version = "1.0" compiles without error', () => {
    expect(compilesOk('_global.version = "1.0";')).toBe(true);
  });

  // Test 4b: _global.version = "1.0" emits string "1.0" and ActionSetMember
  it('_global.version = "1.0" encodes the string value and ActionSetMember', () => {
    const bytes = compileAS2('_global.version = "1.0";');
    expect(containsString(bytes, "1.0")).toBe(true);
    expect(containsByte(bytes, 0x4f)).toBe(true); // ActionSetMember
  });

  // Test 5: trace(_global.foo) compiles — reads from _global via ActionGetMember (0x4e)
  it("trace(_global.foo) compiles without error", () => {
    expect(compilesOk("trace(_global.foo);")).toBe(true);
  });

  // Test 5b: trace(_global.foo) emits ActionGetMember (0x4e) to read from _global
  it("trace(_global.foo) emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("trace(_global.foo);");
    // ActionGetMember (0x4e) is used for member access reads
    expect(containsByte(bytes, 0x4e)).toBe(true);
  });

  // Test 6: Multiple _global assignments in same script compile
  it("multiple _global assignments in one script compile without error", () => {
    const src = `
      _global.name = "MyApp";
      _global.version = "1.0";
      _global.debug = true;
    `;
    expect(compilesOk(src)).toBe(true);
  });

  // Test 6b: Multiple _global assignments emit ActionSetMember multiple times
  it("multiple _global assignments emit ActionSetMember for each assignment", () => {
    const src = `
      _global.name = "MyApp";
      _global.version = "1.0";
    `;
    const bytes = compileAS2(src);
    // Count occurrences of ActionSetMember (0x4f)
    let count = 0;
    for (const b of bytes) {
      if (b === 0x4f) count++;
    }
    // Each _global.x = y should emit one ActionSetMember
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Top-level var declaration tests
// ---------------------------------------------------------------------------

describe("top-level var declarations", () => {
  // Test 7: var x = 5 compiles to ActionDefineLocal (0x3c)
  it("var x = 5 compiles to ActionDefineLocal (0x3c)", () => {
    const bytes = compileAS2("var x = 5;");
    // ActionDefineLocal (0x3c) should be present
    expect(containsByte(bytes, 0x3c)).toBe(true);
  });

  // Test 8: var x without init compiles to ActionDefineLocal2 (0x41)
  it("var x without initializer compiles to ActionDefineLocal2 (0x41)", () => {
    const bytes = compileAS2("var x;");
    expect(containsByte(bytes, 0x41)).toBe(true);
  });

  // Test 9: var x = 5 also stores the variable name "x" as a string
  it("var x = 5 encodes the variable name as a string", () => {
    const bytes = compileAS2("var x = 5;");
    expect(containsString(bytes, "x")).toBe(true);
  });

  // Test 10: var declaration inside a function uses ActionDefineLocal
  it("var y = 10 inside a function compiles to ActionDefineLocal (0x3c)", () => {
    const src = `
      function init() {
        var y = 10;
      }
    `;
    const bytes = compileAS2(src);
    expect(containsByte(bytes, 0x3c)).toBe(true);
  });
});
