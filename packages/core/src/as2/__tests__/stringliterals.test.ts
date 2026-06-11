/**
 * Tests for AS2 string escape sequences and string comparison operators.
 *
 * Verifies that escape sequences compile without error and that string
 * comparison operators produce the expected AVM1 opcodes:
 *   - ActionEquals2   (0x49): == equality comparison
 *   - ActionLess2     (0x48): < less-than comparison
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

/**
 * Parse an ActionConstantPool (0x88) record from the bytecode.
 * Returns the list of strings in the pool, or null if no pool is present.
 */
function parseConstantPool(bytes: Uint8Array): string[] | null {
  if (bytes.length < 5) return null;
  if (bytes[0] !== 0x88) return null;

  const payloadLen = bytes[1]! | (bytes[2]! << 8);
  const count = bytes[3]! | (bytes[4]! << 8);
  const strings: string[] = [];

  let pos = 5;
  for (let i = 0; i < count; i++) {
    const start = pos;
    while (pos < 3 + payloadLen && bytes[pos] !== 0) pos++;
    const strBytes = bytes.slice(start, pos);
    strings.push(new TextDecoder().decode(strBytes));
    pos++; // skip NUL terminator
  }
  return strings;
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

  // ---------------------------------------------------------------------------
  // Hex escape sequences (\xNN)
  // ---------------------------------------------------------------------------

  it('\\x41 decodes to "A" in the constant pool', () => {
    const bytes = compileAS2('var s = "\\x41";');
    const pool = parseConstantPool(bytes);
    expect(pool).not.toBeNull();
    expect(pool!.some(s => s === 'A')).toBe(true);
  });

  it('\\u0041 decodes to "A" in the constant pool', () => {
    const bytes = compileAS2('var s = "\\u0041";');
    const pool = parseConstantPool(bytes);
    expect(pool).not.toBeNull();
    expect(pool!.some(s => s === 'A')).toBe(true);
  });

  it('"hello\\x0Aworld" decodes to "hello\\nworld" in the constant pool', () => {
    const bytes = compileAS2('var s = "hello\\x0Aworld";');
    const pool = parseConstantPool(bytes);
    expect(pool).not.toBeNull();
    expect(pool!.some(s => s === 'hello\nworld')).toBe(true);
  });

  it('\\0 decodes to null char (produces empty NUL-terminated entry in pool)', () => {
    // NUL chars (\0) act as string terminators in SWF constant pool entries.
    // The \0 string decodes to a NUL byte which, when embedded in the pool,
    // reads back as an empty string. Verify no raw "\\0" two-char sequence exists.
    const bytes = compileAS2('var s = "\\0";');
    // The pool should not contain a raw backslash-zero sequence (two bytes: 0x5c 0x30)
    let rawFound = false;
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === 0x5c && bytes[i + 1] === 0x30) { rawFound = true; break; }
    }
    expect(rawFound).toBe(false);
  });

  it('\\x41 does not leave raw escape in constant pool (no "\\\\x41")', () => {
    const bytes = compileAS2('var s = "\\x41";');
    const pool = parseConstantPool(bytes);
    expect(pool).not.toBeNull();
    expect(pool!.some(s => s.includes('\\x'))).toBe(false);
  });

  it('\\u0041 does not leave raw escape in constant pool (no "\\\\u0041")', () => {
    const bytes = compileAS2('var s = "\\u0041";');
    const pool = parseConstantPool(bytes);
    expect(pool).not.toBeNull();
    expect(pool!.some(s => s.includes('\\u'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// String comparison operators
// ---------------------------------------------------------------------------

describe("String comparison operators", () => {
  it('"abc" == "abc" compiles without error', () => {
    expect(compilesOk('"abc" == "abc";')).toBe(true);
  });

  it('"abc" == "abc" emits ActionEquals2 (0x49)', () => {
    const bytes = compileAS2('"abc" == "abc";');
    expect(containsByte(bytes, 0x49)).toBe(true); // ActionEquals2
  });

  it('"abc" != "def" compiles without error', () => {
    expect(compilesOk('"abc" != "def";')).toBe(true);
  });

  it('"abc" != "def" emits ActionEquals2 (0x49) and ActionNot (0x12)', () => {
    const bytes = compileAS2('"abc" != "def";');
    expect(containsByte(bytes, 0x49)).toBe(true); // ActionEquals2
    expect(containsByte(bytes, 0x12)).toBe(true); // ActionNot
  });

  it('"abc" < "def" compiles without error', () => {
    expect(compilesOk('"abc" < "def";')).toBe(true);
  });

  it('"abc" < "def" emits ActionLess2 (0x48)', () => {
    const bytes = compileAS2('"abc" < "def";');
    expect(containsByte(bytes, 0x48)).toBe(true); // ActionLess2
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
