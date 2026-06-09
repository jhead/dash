/**
 * Tests for AS2 compiler handling of getURL, loadMovie, loadMovieNum, and FSCommand.
 *
 * Verifies that navigation/loading functions compile correctly to AVM1 bytecode.
 * Specifically:
 *   - getURL(url)         → ActionGetURL2 (0x9A)
 *   - getURL(url, target) → ActionGetURL2 (0x9A)
 *   - loadMovie(url, tgt) → ActionGetURL2 (0x9A)
 *   - loadMovieNum(url,n) → ActionGetURL2 (0x9A)
 *   - FSCommand(cmd, arg) → ActionCallFunction (0x3D) or equivalent
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
const ACTION_GET_URL2       = 0x9a; // ActionGetURL2
const ACTION_CALL_FUNCTION  = 0x3d; // ActionCallFunction

// ---------------------------------------------------------------------------
// getURL() — single argument
// ---------------------------------------------------------------------------

describe('getURL() with one argument', () => {
  it('getURL("http://example.com") compiles without error', () => {
    expect(compilesOk('getURL("http://example.com");')).toBe(true);
  });

  it('getURL("http://example.com") produces non-empty bytecode', () => {
    const bytes = compileAS2('getURL("http://example.com");');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('getURL("http://example.com") emits ActionGetURL2 (0x9A)', () => {
    const bytes = compileAS2('getURL("http://example.com");');
    expect(containsByte(bytes, ACTION_GET_URL2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getURL() — two arguments
// ---------------------------------------------------------------------------

describe('getURL() with two arguments', () => {
  it('getURL("http://example.com", "_blank") compiles without error', () => {
    expect(compilesOk('getURL("http://example.com", "_blank");')).toBe(true);
  });

  it('getURL("http://example.com", "_blank") produces non-empty bytecode', () => {
    const bytes = compileAS2('getURL("http://example.com", "_blank");');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('getURL("http://example.com", "_blank") emits ActionGetURL2 (0x9A)', () => {
    const bytes = compileAS2('getURL("http://example.com", "_blank");');
    expect(containsByte(bytes, ACTION_GET_URL2)).toBe(true);
  });

  it('getURL("http://example.com", "_self") compiles without error', () => {
    expect(compilesOk('getURL("http://example.com", "_self");')).toBe(true);
  });

  it('getURL("http://example.com", "_self") emits ActionGetURL2 (0x9A)', () => {
    const bytes = compileAS2('getURL("http://example.com", "_self");');
    expect(containsByte(bytes, ACTION_GET_URL2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadMovie()
// ---------------------------------------------------------------------------

describe('loadMovie()', () => {
  it('loadMovie("movie.swf", _root) compiles without error', () => {
    expect(compilesOk('loadMovie("movie.swf", _root);')).toBe(true);
  });

  it('loadMovie("movie.swf", _root) produces non-empty bytecode', () => {
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

describe('loadMovieNum()', () => {
  it('loadMovieNum("movie.swf", 0) compiles without error', () => {
    expect(compilesOk('loadMovieNum("movie.swf", 0);')).toBe(true);
  });

  it('loadMovieNum("movie.swf", 0) produces non-empty bytecode', () => {
    const bytes = compileAS2('loadMovieNum("movie.swf", 0);');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('loadMovieNum("movie.swf", 0) emits ActionGetURL2 (0x9A)', () => {
    const bytes = compileAS2('loadMovieNum("movie.swf", 0);');
    expect(containsByte(bytes, ACTION_GET_URL2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FSCommand()
// ---------------------------------------------------------------------------

describe('FSCommand()', () => {
  it('FSCommand("fullscreen", "true") compiles without error', () => {
    expect(compilesOk('FSCommand("fullscreen", "true");')).toBe(true);
  });

  it('FSCommand("fullscreen", "true") produces non-empty bytecode', () => {
    const bytes = compileAS2('FSCommand("fullscreen", "true");');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('FSCommand("fullscreen", "true") emits a call opcode', () => {
    const bytes = compileAS2('FSCommand("fullscreen", "true");');
    // FSCommand compiles to ActionCallFunction (0x3D) since it is treated as a
    // regular function call; getURL-based FSCommand targets ("FSCommand:fullscreen")
    // would also emit ActionGetURL2 (0x9A). Either opcode is acceptable.
    const hasCallFunction = containsByte(bytes, ACTION_CALL_FUNCTION);
    const hasGetURL2 = containsByte(bytes, ACTION_GET_URL2);
    expect(hasCallFunction || hasGetURL2).toBe(true);
  });
});
