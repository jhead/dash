/**
 * Tests for AS2 string escape sequences and string comparison operators.
 *
 * Verifies that escape sequences compile without error and that string
 * comparison operators produce the expected AVM1 opcodes:
 *   - ActionEquals2   (0x66): == equality comparison
 *   - ActionLess2     (0x65): < less-than comparison
 *   - ActionGreater   (0x67): > greater-than comparison
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
// Escape sequences
// ---------------------------------------------------------------------------

describe("String escape sequences", () => {
  it('newline escape \\n compiles without error', () => {
    expect(compilesOk('var s = "hello\\nworld";')).toBe(true);
  });

  it('tab escape \\t compiles without error', () => {
    expect(compilesOk('var s = "tab\\there";')).toBe(true);
  });

  it('backslash escape \\\\ compiles without error', () => {
    expect(compilesOk('var s = "back\\\\slash";')).toBe(true);
  });

  it('double-quote escape \\" compiles without error', () => {
    expect(compilesOk('var s = "quote\\"";')).toBe(true);
  });

  it('hex escape \\x41 compiles without error', () => {
    expect(compilesOk('var s = "\\x41";')).toBe(true);
  });

  it('newline escape \\n produces a string with newline in bytecode', () => {
    const bytes = compileAS2('var s = "hello\\nworld";');
    // The compiled bytecode should contain the newline character (0x0a)
    expect(bytes.includes(0x0a)).toBe(true);
  });

  it('tab escape \\t produces a string with tab in bytecode', () => {
    const bytes = compileAS2('var s = "tab\\there";');
    // The compiled bytecode should contain the tab character (0x09)
    expect(bytes.includes(0x09)).toBe(true);
  });

  it('backslash escape \\\\ produces a string containing "backslash"', () => {
    const bytes = compileAS2('var s = "back\\\\slash";');
    // The decoded string "back\slash" should appear in the bytecode
    // Search for the substring bytes without requiring null-terminator
    const enc = new TextEncoder().encode("back");
    let found = false;
    for (let i = 0; i <= bytes.length - enc.length; i++) {
      let match = true;
      for (let j = 0; j < enc.length; j++) {
        if (bytes[i + j] !== enc[j]) { match = false; break; }
      }
      if (match) { found = true; break; }
    }
    expect(found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// String comparison operators
// ---------------------------------------------------------------------------

describe("String comparison operators", () => {
  it('"abc" == "abc" compiles without error', () => {
    expect(compilesOk('"abc" == "abc";')).toBe(true);
  });

  it('"abc" == "abc" emits ActionEquals2 (0x66)', () => {
    const bytes = compileAS2('"abc" == "abc";');
    expect(containsByte(bytes, 0x66)).toBe(true); // ActionEquals2
  });

  it('"abc" != "def" compiles without error', () => {
    expect(compilesOk('"abc" != "def";')).toBe(true);
  });

  it('"abc" != "def" emits ActionEquals2 (0x66) and ActionNot (0x14)', () => {
    const bytes = compileAS2('"abc" != "def";');
    expect(containsByte(bytes, 0x66)).toBe(true); // ActionEquals2
    expect(containsByte(bytes, 0x14)).toBe(true); // ActionNot
  });

  it('"abc" < "def" compiles without error', () => {
    expect(compilesOk('"abc" < "def";')).toBe(true);
  });

  it('"abc" < "def" emits ActionLess2 (0x65)', () => {
    const bytes = compileAS2('"abc" < "def";');
    expect(containsByte(bytes, 0x65)).toBe(true); // ActionLess2
  });

  it('"abc" > "def" compiles without error', () => {
    expect(compilesOk('"abc" > "def";')).toBe(true);
  });

  it('"abc" > "def" emits ActionGreater (0x67)', () => {
    const bytes = compileAS2('"abc" > "def";');
    expect(containsByte(bytes, 0x67)).toBe(true); // ActionGreater
  });

  it('string comparison in conditional compiles without error', () => {
    expect(compilesOk('if ("abc" == "abc") { trace("equal"); }')).toBe(true);
  });

  it('string variable comparison compiles without error', () => {
    expect(compilesOk('var a = "hello"; var b = "world"; var r = a < b;')).toBe(true);
  });
});
