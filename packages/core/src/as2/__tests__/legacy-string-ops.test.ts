/**
 * Tests for Flash 4 legacy string operators: add, eq, ne, lt, gt, le, ge.
 * Tasks 1113 (add) and 1114 (eq/ne/lt/gt/le/ge).
 *
 * Verified opcodes (ruffle/swf/src/avm1/opcode.rs):
 *   StringAdd    0x21
 *   StringEquals 0x13
 *   StringLess   0x29
 *   StringGreater 0x68
 *   Not          0x12
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function bytes(source: string): Uint8Array {
  return compileAS2(source);
}

function has(b: Uint8Array, byte: number): boolean {
  return b.includes(byte);
}

function hasStr(b: Uint8Array, s: string): boolean {
  const enc = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= b.length - enc.length; i++) {
    for (let j = 0; j < enc.length; j++) {
      if (b[i + j] !== enc[j]) continue outer;
    }
    if (b[i + enc.length] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Task 1113 — add keyword (ActionStringAdd 0x21)
// ---------------------------------------------------------------------------

describe("add keyword (Flash 4 string concatenation)", () => {
  it("x add y compiles without error", () => {
    expect(() => bytes("x add y;")).not.toThrow();
  });

  it("x add y emits ActionStringAdd (0x21)", () => {
    expect(has(bytes("x add y;"), 0x21)).toBe(true);
  });

  it("x add y — operand names in bytecode", () => {
    const b = bytes("x add y;");
    expect(hasStr(b, "x")).toBe(true);
    expect(hasStr(b, "y")).toBe(true);
  });

  it("string literal add: 'hello' add ' world' compiles", () => {
    expect(() => bytes('"hello" add " world";')).not.toThrow();
  });

  it("string literal add emits ActionStringAdd (0x21)", () => {
    expect(has(bytes('"hello" add " world";'), 0x21)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 1114 — eq keyword (ActionStringEquals 0x13)
// ---------------------------------------------------------------------------

describe("eq keyword (Flash 4 string equality)", () => {
  it("x eq y compiles without error", () => {
    expect(() => bytes("x eq y;")).not.toThrow();
  });

  it("x eq y emits ActionStringEquals (0x13)", () => {
    expect(has(bytes("x eq y;"), 0x13)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ne keyword (StringEquals + Not)
// ---------------------------------------------------------------------------

describe("ne keyword (Flash 4 string not-equal)", () => {
  it("x ne y compiles without error", () => {
    expect(() => bytes("x ne y;")).not.toThrow();
  });

  it("x ne y emits ActionStringEquals (0x13)", () => {
    expect(has(bytes("x ne y;"), 0x13)).toBe(true);
  });

  it("x ne y emits ActionNot (0x12)", () => {
    expect(has(bytes("x ne y;"), 0x12)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lt keyword (ActionStringLess 0x29)
// ---------------------------------------------------------------------------

describe("lt keyword (Flash 4 string less-than)", () => {
  it("x lt y compiles without error", () => {
    expect(() => bytes("x lt y;")).not.toThrow();
  });

  it("x lt y emits ActionStringLess (0x29)", () => {
    expect(has(bytes("x lt y;"), 0x29)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gt keyword (ActionStringGreater 0x68)
// ---------------------------------------------------------------------------

describe("gt keyword (Flash 4 string greater-than)", () => {
  it("x gt y compiles without error", () => {
    expect(() => bytes("x gt y;")).not.toThrow();
  });

  it("x gt y emits ActionStringGreater (0x68)", () => {
    expect(has(bytes("x gt y;"), 0x68)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// le keyword (StringGreater + Not)
// ---------------------------------------------------------------------------

describe("le keyword (Flash 4 string less-or-equal)", () => {
  it("x le y compiles without error", () => {
    expect(() => bytes("x le y;")).not.toThrow();
  });

  it("x le y emits ActionStringGreater (0x68)", () => {
    expect(has(bytes("x le y;"), 0x68)).toBe(true);
  });

  it("x le y emits ActionNot (0x12)", () => {
    expect(has(bytes("x le y;"), 0x12)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ge keyword (StringLess + Not)
// ---------------------------------------------------------------------------

describe("ge keyword (Flash 4 string greater-or-equal)", () => {
  it("x ge y compiles without error", () => {
    expect(() => bytes("x ge y;")).not.toThrow();
  });

  it("x ge y emits ActionStringLess (0x29)", () => {
    expect(has(bytes("x ge y;"), 0x29)).toBe(true);
  });

  it("x ge y emits ActionNot (0x12)", () => {
    expect(has(bytes("x ge y;"), 0x12)).toBe(true);
  });
});
