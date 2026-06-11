/**
 * Tests for AS2 compiler handling of getURL(), loadMovie(), loadMovieNum().
 *
 * Verifies that these built-in navigation/loading functions compile to AVM1
 * ActionGetURL2 (0x9A) bytecode without errors, and that url/target are
 * pushed in the correct order for ActionGetURL2.
 *
 * ActionGetURL2 stack convention (per Ruffle activation.rs):
 *   pop target FIRST (i.e., target is on TOP of stack)
 *   pop url    SECOND (i.e., url is DEEPER in stack)
 * Therefore correct push order is: push url FIRST, push target LAST.
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
 * Find the pool index of a string inside the ActionConstantPool (0x88) block.
 * Returns -1 if the string is not in the pool.
 */
function findPoolIndex(bytes: Uint8Array, str: string): number {
  const encoded = new TextEncoder().encode(str + '\0');
  for (let i = 0; i < bytes.length; ) {
    if (bytes[i] !== 0x88) { i++; continue; }
    if (i + 2 >= bytes.length) break;
    const len = bytes[i + 1]! | (bytes[i + 2]! << 8);
    const payloadStart = i + 3;
    const payloadEnd = payloadStart + len;
    if (payloadEnd > bytes.length) break;
    const count = bytes[payloadStart]! | (bytes[payloadStart + 1]! << 8);
    let j = payloadStart + 2;
    let idx = 0;
    while (idx < count && j < payloadEnd) {
      // Check if this string matches
      let match = true;
      for (let k = 0; k < encoded.length; k++) {
        if (bytes[j + k] !== encoded[k]) { match = false; break; }
      }
      if (match) return idx;
      // Advance past this string
      while (j < payloadEnd && bytes[j] !== 0) j++;
      j++; // skip null terminator
      idx++;
    }
    break;
  }
  return -1;
}

/**
 * Find the byte offset of the ActionPush (0x96) instruction that pushes a
 * string by pool index (type=8) for the given pool index. Returns -1 if not found.
 * Also handles inline string pushes (type=0) as a fallback.
 */
function findPushForString(bytes: Uint8Array, str: string): number {
  const poolIdx = findPoolIndex(bytes, str);
  const encoded = new TextEncoder().encode(str + '\0');

  for (let i = 0; i < bytes.length; ) {
    if (bytes[i] !== 0x96) { i++; continue; }
    if (i + 2 >= bytes.length) break;
    const len = bytes[i + 1]! | (bytes[i + 2]! << 8);
    const payloadStart = i + 3;
    const payloadEnd = payloadStart + len;
    if (payloadEnd > bytes.length) break;

    // Scan payload entries
    let j = payloadStart;
    while (j < payloadEnd) {
      const type = bytes[j]!;
      if (type === 0) {
        // Inline string
        let match = true;
        for (let k = 0; k < encoded.length; k++) {
          if (bytes[j + 1 + k] !== encoded[k]) { match = false; break; }
        }
        if (match) return i; // return the offset of the ActionPush opcode
        j++;
        while (j < payloadEnd && bytes[j] !== 0) j++;
        j++;
      } else if (type === 8) {
        // Pool index (UI8)
        const idx = bytes[j + 1]!;
        if (poolIdx >= 0 && idx === poolIdx) return i;
        j += 2;
      } else if (type === 9) {
        // Pool index (UI16)
        const idx = bytes[j + 1]! | (bytes[j + 2]! << 8);
        if (poolIdx >= 0 && idx === poolIdx) return i;
        j += 3;
      } else if (type === 7) {
        j += 5; // integer: type + UI32
      } else if (type === 6) {
        j += 9; // double: type + 8 bytes
      } else if (type === 4) {
        j += 2; // register: type + UI8
      } else if (type === 5) {
        j += 2; // boolean: type + UI8
      } else if (type === 1) {
        j += 5; // float: type + 4 bytes
      } else if (type === 2 || type === 3) {
        j += 1; // null or undefined: type only
      } else {
        break;
      }
    }
    i = payloadEnd;
  }
  return -1;
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
  it('loadMovie("movie.swf", "_level0") compiles without error', () => {
    expect(compilesOk('loadMovie("movie.swf", "_level0");')).toBe(true);
  });

  it('loadMovie("movie.swf", "_level0") compiles to non-empty bytecode', () => {
    const bytes = compileAS2('loadMovie("movie.swf", "_level0");');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('loadMovie("movie.swf", "_level0") emits ActionGetURL2 (0x9A)', () => {
    const bytes = compileAS2('loadMovie("movie.swf", "_level0");');
    expect(containsByte(bytes, ACTION_GET_URL2)).toBe(true);
  });

  it('loadMovie url is pushed before target (url deeper on stack)', () => {
    // ActionGetURL2 pops target first (top), then url (deeper).
    // So url must appear earlier in the bytecode (pushed first = deeper).
    const bytes = compileAS2('loadMovie("movie.swf", "_level0");');
    const urlPos = findPushForString(bytes, 'movie.swf');
    const targetPos = findPushForString(bytes, '_level0');
    expect(urlPos).toBeGreaterThan(-1);    // url push found
    expect(targetPos).toBeGreaterThan(-1); // target push found
    expect(urlPos).toBeLessThan(targetPos); // url pushed BEFORE target
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

  it('loadMovieNum url is pushed before "_level" prefix (url deeper on stack)', () => {
    // ActionGetURL2 pops target first (top), then url (deeper).
    // loadMovieNum pushes url first, then builds "_level<N>" on top.
    // The url string "movie.swf" must appear earlier in bytecode than "_level".
    const bytes = compileAS2('loadMovieNum("movie.swf", 0);');
    const urlPos = findPushForString(bytes, 'movie.swf');
    const levelPrefixPos = findPushForString(bytes, '_level');
    expect(urlPos).toBeGreaterThan(-1);          // url push found
    expect(levelPrefixPos).toBeGreaterThan(-1);  // "_level" push found
    expect(urlPos).toBeLessThan(levelPrefixPos); // url pushed BEFORE "_level"
  });
});
