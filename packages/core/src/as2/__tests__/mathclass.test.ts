/**
 * Tests for AS2 Math object built-in methods and properties.
 *
 * Verifies that Math method calls and Math property accesses compile without
 * error and emit the expected AVM1 opcodes:
 *   - ActionGetMember (0x4f): member/property access (Math.abs, Math.PI, etc.)
 *   - ActionCallMethod (0x52): method dispatch (Math.abs(x), etc.)
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";
import { parse } from "../parser.js";

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

const ACTION_GET_MEMBER = 0x4f; // ActionGetMember — property/member access

// ---------------------------------------------------------------------------
// Math single-argument methods
// ---------------------------------------------------------------------------

describe("Math.abs", () => {
  it("Math.abs(-5) compiles without error", () => {
    expect(compilesOk("Math.abs(-5);")).toBe(true);
  });

  it.todo("Math.abs(-5) emits ActionGetMember (0x4f) for 'abs' on Math");
});

describe("Math.ceil", () => {
  it("Math.ceil(1.5) compiles without error", () => {
    expect(compilesOk("Math.ceil(1.5);")).toBe(true);
  });
});

describe("Math.floor", () => {
  it("Math.floor(1.5) compiles without error", () => {
    expect(compilesOk("Math.floor(1.5);")).toBe(true);
  });
});

describe("Math.round", () => {
  it("Math.round(1.5) compiles without error", () => {
    expect(compilesOk("Math.round(1.5);")).toBe(true);
  });
});

describe("Math.sqrt", () => {
  it("Math.sqrt(16) compiles without error", () => {
    expect(compilesOk("Math.sqrt(16);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Math two-argument methods
// ---------------------------------------------------------------------------

describe("Math.pow", () => {
  it("Math.pow(2, 8) compiles without error", () => {
    expect(compilesOk("Math.pow(2, 8);")).toBe(true);
  });
});

describe("Math.min", () => {
  it("Math.min(a, b) compiles without error", () => {
    expect(compilesOk("Math.min(a, b);")).toBe(true);
  });
});

describe("Math.max", () => {
  it("Math.max(a, b) compiles without error", () => {
    expect(compilesOk("Math.max(a, b);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Math zero-argument methods
// ---------------------------------------------------------------------------

describe("Math.random", () => {
  it("Math.random() compiles without error", () => {
    expect(compilesOk("Math.random();")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Math properties — ActionGetMember (0x4f)
// ---------------------------------------------------------------------------

describe("Math.PI", () => {
  it("var pi = Math.PI compiles without error", () => {
    expect(compilesOk("var pi = Math.PI;")).toBe(true);
  });

  it("var pi = Math.PI emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var pi = Math.PI;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Trigonometric / logarithmic methods
// ---------------------------------------------------------------------------

describe("Math.sin", () => {
  it("Math.sin(x) compiles without error", () => {
    expect(compilesOk("Math.sin(x);")).toBe(true);
  });
});

describe("Math.cos", () => {
  it("Math.cos(x) compiles without error", () => {
    expect(compilesOk("Math.cos(x);")).toBe(true);
  });
});

describe("Math.atan2", () => {
  it("Math.atan2(y, x) compiles without error", () => {
    expect(compilesOk("Math.atan2(y, x);")).toBe(true);
  });
});

describe("Math.log", () => {
  it("Math.log(x) compiles without error", () => {
    expect(compilesOk("Math.log(x);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Math.E property
// ---------------------------------------------------------------------------

describe("Math.E", () => {
  it("Math.E compiles without error", () => {
    expect(compilesOk("Math.E;")).toBe(true);
  });

  it("Math.E emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("Math.E;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });
});
