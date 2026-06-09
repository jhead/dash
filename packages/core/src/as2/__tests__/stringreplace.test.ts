/**
 * Tests for AS2 string methods: replace, split, match, search.
 *
 * Verifies that these string methods compile to AVM1 bytecode containing
 * ActionCallMethod (0x52) and the method name string.
 *
 * Note: replace (string arg) and split are also covered in stringmethods.test.ts;
 * replace (regex arg) and match are covered in regexp.test.ts. This file adds
 * consolidated smoke tests and covers the missing search method.
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

const ACTION_CALL_METHOD = 0x52;

// ---------------------------------------------------------------------------
// replace with string argument
// ---------------------------------------------------------------------------

describe('String replace (string arg)', () => {
  it('s.replace("a", "b") compiles without error', () => {
    expect(compilesOk('var s = "abcabc"; s.replace("a", "b");')).toBe(true);
  });

  it('s.replace("a", "b") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var s = "abcabc"; s.replace("a", "b");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "replace")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// replace with regex argument
// ---------------------------------------------------------------------------

describe('String replace (regex arg)', () => {
  it('s.replace(/a/g, "b") compiles without error', () => {
    expect(compilesOk('var s = "abcabc"; s.replace(/a/g, "b");')).toBe(true);
  });

  it('s.replace(/a/g, "b") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var s = "abcabc"; s.replace(/a/g, "b");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "replace")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// split
// ---------------------------------------------------------------------------

describe('String split', () => {
  it('s.split(",") compiles without error', () => {
    expect(compilesOk('var s = "a,b,c"; s.split(",");')).toBe(true);
  });

  it('s.split(",") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var s = "a,b,c"; s.split(",");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "split")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// match
// ---------------------------------------------------------------------------

describe('String match', () => {
  it('s.match(/pattern/) compiles without error', () => {
    expect(compilesOk('var s = "hello world"; s.match(/pattern/);')).toBe(true);
  });

  it('s.match(/pattern/) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var s = "hello world"; s.match(/pattern/);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "match")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('String search', () => {
  it('s.search(/pattern/) compiles without error', () => {
    expect(compilesOk('var s = "hello world"; s.search(/pattern/);')).toBe(true);
  });

  it('s.search(/pattern/) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var s = "hello world"; s.search(/pattern/);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "search")).toBe(true);
  });
});
