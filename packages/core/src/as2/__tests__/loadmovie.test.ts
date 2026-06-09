/**
 * Tests for AS2 compiler handling of getURL(), loadMovie(), loadMovieNum().
 *
 * Verifies that these built-in navigation/loading functions compile to AVM1
 * ActionGetURL2 (0x9A) bytecode without errors.
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

// AVM1 opcodes
const ACTION_GET_URL2 = 0x9a; // ActionGetURL2

// ---------------------------------------------------------------------------
// getURL()
// ---------------------------------------------------------------------------

describe("getURL()", () => {
  it('getURL("http://example.com") compiles without error', () => {
    expect(compilesOk('getURL("http://example.com");')).toBe(true);
  });

  it('getURL("http://example.com") compiles to non-empty bytecode', () => {
    const bytes = compileAS2('getURL("http://example.com");');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('getURL("http://example.com") emits ActionGetURL2 (0x9A)', () => {
    const bytes = compileAS2('getURL("http://example.com");');
    expect(containsByte(bytes, ACTION_GET_URL2)).toBe(true);
  });

  it('getURL("http://example.com", "_blank") compiles without error', () => {
    expect(compilesOk('getURL("http://example.com", "_blank");')).toBe(true);
  });

  it('getURL("http://example.com", "_blank") compiles to non-empty bytecode', () => {
    const bytes = compileAS2('getURL("http://example.com", "_blank");');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('getURL("http://example.com", "_blank") emits ActionGetURL2 (0x9A)', () => {
    const bytes = compileAS2('getURL("http://example.com", "_blank");');
    expect(containsByte(bytes, ACTION_GET_URL2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadMovie()
// ---------------------------------------------------------------------------

describe("loadMovie()", () => {
  it('loadMovie("movie.swf", _root) compiles without error', () => {
    expect(compilesOk('loadMovie("movie.swf", _root);')).toBe(true);
  });

  it('loadMovie("movie.swf", _root) compiles to non-empty bytecode', () => {
    const bytes = compileAS2('loadMovie("movie.swf", _root);');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('loadMovie("movie.swf", _root) emits ActionGetURL2 (0x9A)', () => {
    const bytes = compileAS2('loadMovie("movie.swf", _root);');
    expect(containsByte(bytes, ACTION_GET_URL2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadMovieNum()
// ---------------------------------------------------------------------------

describe("loadMovieNum()", () => {
  it('loadMovieNum("movie.swf", 0) compiles without error', () => {
    expect(compilesOk('loadMovieNum("movie.swf", 0);')).toBe(true);
  });

  it('loadMovieNum("movie.swf", 0) compiles to non-empty bytecode', () => {
    const bytes = compileAS2('loadMovieNum("movie.swf", 0);');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('loadMovieNum("movie.swf", 0) emits ActionGetURL2 (0x9A)', () => {
    const bytes = compileAS2('loadMovieNum("movie.swf", 0);');
    expect(containsByte(bytes, ACTION_GET_URL2)).toBe(true);
  });
});
