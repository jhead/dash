/**
 * Tests for AS2 compiler handling of trace(), FSCommand(), and special
 * literal/expression forms: undefined, null, Infinity, NaN, typeof, void.
 *
 * AVM1 opcodes verified:
 *   - ActionTrace        (0x26): trace(x)
 *   - ActionCallFunction (0x3D): FSCommand(cmd, arg)
 *   - ActionTypeOf       (0x44): typeof expr
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

// ---------------------------------------------------------------------------
// AVM1 opcodes under test
// ---------------------------------------------------------------------------

const ACTION_TRACE         = 0x26; // ActionTrace
const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction
const ACTION_GET_URL2      = 0x9a; // ActionGetURL2
const ACTION_TYPE_OF       = 0x44; // ActionTypeOf

// ---------------------------------------------------------------------------
// trace()
// ---------------------------------------------------------------------------

describe("trace()", () => {
  it('1. trace("hello") compiles without error', () => {
    expect(compilesOk('trace("hello");')).toBe(true);
  });

  it('2. trace("hello") emits ActionTrace (0x26)', () => {
    const bytes = compileAS2('trace("hello");');
    expect(containsByte(bytes, ACTION_TRACE)).toBe(true);
  });

  it("3. trace(variable) compiles without error", () => {
    expect(compilesOk("var x = 42; trace(x);")).toBe(true);
  });

  it("4. trace(variable) emits ActionTrace (0x26)", () => {
    const bytes = compileAS2("var x = 42; trace(x);");
    expect(containsByte(bytes, ACTION_TRACE)).toBe(true);
  });

  it("5. trace(expr) compiles without error", () => {
    expect(compilesOk("trace(1 + 2);")).toBe(true);
  });

  it("6. trace(expr) emits ActionTrace (0x26)", () => {
    const bytes = compileAS2("trace(1 + 2);");
    expect(containsByte(bytes, ACTION_TRACE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FSCommand()
// ---------------------------------------------------------------------------

describe("FSCommand()", () => {
  it('7. FSCommand("fullscreen", "true") compiles without error', () => {
    expect(compilesOk('FSCommand("fullscreen", "true");')).toBe(true);
  });

  it('8. FSCommand("fullscreen", "true") emits a call opcode (ActionCallFunction 0x3D or ActionGetURL2 0x9A)', () => {
    const bytes = compileAS2('FSCommand("fullscreen", "true");');
    const hasCallFunction = containsByte(bytes, ACTION_CALL_FUNCTION);
    const hasGetURL2      = containsByte(bytes, ACTION_GET_URL2);
    expect(hasCallFunction || hasGetURL2).toBe(true);
  });

  it('9. FSCommand("quit", "") compiles without error', () => {
    expect(compilesOk('FSCommand("quit", "");')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Special literals: undefined, null, Infinity, NaN
// ---------------------------------------------------------------------------

describe("Special literals", () => {
  it("10. undefined literal in expression compiles without error", () => {
    expect(compilesOk("var x = undefined;")).toBe(true);
  });

  it("11. undefined compiles to non-empty bytecode", () => {
    const bytes = compileAS2("var x = undefined;");
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("12. null literal compiles without error", () => {
    expect(compilesOk("var x = null;")).toBe(true);
  });

  it("13. null compiles to non-empty bytecode", () => {
    const bytes = compileAS2("var x = null;");
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("14. Infinity compiles without error", () => {
    expect(compilesOk("var x = Infinity;")).toBe(true);
  });

  it("15. Infinity compiles to non-empty bytecode", () => {
    const bytes = compileAS2("var x = Infinity;");
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("16. NaN compiles without error", () => {
    expect(compilesOk("var x = NaN;")).toBe(true);
  });

  it("17. NaN compiles to non-empty bytecode", () => {
    const bytes = compileAS2("var x = NaN;");
    expect(bytes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// typeof operator
// ---------------------------------------------------------------------------

describe("typeof operator", () => {
  it("18. typeof undefined compiles without error", () => {
    expect(compilesOk("var t = typeof undefined;")).toBe(true);
  });

  it("19. typeof undefined emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("var t = typeof undefined;");
    expect(containsByte(bytes, ACTION_TYPE_OF)).toBe(true);
  });

  it("20. typeof x compiles without error", () => {
    expect(compilesOk("var x = 1; var t = typeof x;")).toBe(true);
  });

  it("21. typeof x emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("var x = 1; var t = typeof x;");
    expect(containsByte(bytes, ACTION_TYPE_OF)).toBe(true);
  });

  it('22. typeof "string" emits ActionTypeOf (0x44)', () => {
    const bytes = compileAS2('var t = typeof "hello";');
    expect(containsByte(bytes, ACTION_TYPE_OF)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// void operator
// ---------------------------------------------------------------------------

describe("void operator", () => {
  it("23. void 0 compiles without error", () => {
    expect(compilesOk("var x = void 0;")).toBe(true);
  });

  it("24. void 0 compiles to non-empty bytecode", () => {
    const bytes = compileAS2("var x = void 0;");
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("25. void expression compiles without error", () => {
    expect(compilesOk("void trace('hi');")).toBe(true);
  });

  it("26. void expression compiles to non-empty bytecode", () => {
    const bytes = compileAS2("void trace('hi');");
    expect(bytes.length).toBeGreaterThan(0);
  });
});
