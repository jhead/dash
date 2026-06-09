/**
 * Tests for AS2 compiler: MovieClip management — attachMovie, createEmptyMovieClip,
 * removeMovieClip, duplicateMovieClip, swapDepths, getDepth, and property
 * reads/writes.
 *
 * Verifies that all MovieClip management calls compile without error and emit
 * the correct AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls (attachMovie, createEmptyMovieClip, etc.)
 *   - ActionSetMember  (0x4e): property writes (_x, _y, _alpha)
 *   - ActionGetMember  (0x4f): property reads (_width, _height)
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
// AVM1 opcodes under test
// ---------------------------------------------------------------------------

const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_SET_MEMBER  = 0x4e; // ActionSetMember  — property write
const ACTION_GET_MEMBER  = 0x4f; // ActionGetMember  — property read

// ---------------------------------------------------------------------------
// _root.attachMovie()
// ---------------------------------------------------------------------------

describe("MovieClip attachMovie()", () => {
  it('_root.attachMovie("linkageId", "name", 1) compiles without error', () => {
    expect(
      compilesOk('_root.attachMovie("linkageId", "name", 1);')
    ).toBe(true);
  });

  it('_root.attachMovie("linkageId", "name", 1) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('_root.attachMovie("linkageId", "name", 1);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "attachMovie")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _root.createEmptyMovieClip()
// ---------------------------------------------------------------------------

describe("MovieClip createEmptyMovieClip()", () => {
  it('_root.createEmptyMovieClip("name", 1) compiles without error', () => {
    expect(
      compilesOk('_root.createEmptyMovieClip("name", 1);')
    ).toBe(true);
  });

  it('_root.createEmptyMovieClip("name", 1) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('_root.createEmptyMovieClip("name", 1);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "createEmptyMovieClip")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.removeMovieClip()
// ---------------------------------------------------------------------------

describe("MovieClip removeMovieClip()", () => {
  it("mc.removeMovieClip() compiles without error", () => {
    expect(
      compilesOk('var mc = _root.createEmptyMovieClip("name", 1); mc.removeMovieClip();')
    ).toBe(true);
  });

  it("mc.removeMovieClip() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); mc.removeMovieClip();'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "removeMovieClip")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.duplicateMovieClip()
// ---------------------------------------------------------------------------

describe("MovieClip duplicateMovieClip()", () => {
  it('mc.duplicateMovieClip("name", 2) compiles without error', () => {
    expect(
      compilesOk(
        'var mc = _root.createEmptyMovieClip("name", 1); mc.duplicateMovieClip("name", 2);'
      )
    ).toBe(true);
  });

  it('mc.duplicateMovieClip("name", 2) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); mc.duplicateMovieClip("name", 2);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "duplicateMovieClip")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.swapDepths()
// ---------------------------------------------------------------------------

describe("MovieClip swapDepths()", () => {
  it("mc.swapDepths(target) compiles without error", () => {
    expect(
      compilesOk(
        'var mc = _root.createEmptyMovieClip("mc", 1); var target = _root.createEmptyMovieClip("target", 2); mc.swapDepths(target);'
      )
    ).toBe(true);
  });

  it("mc.swapDepths(target) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("mc", 1); var target = _root.createEmptyMovieClip("target", 2); mc.swapDepths(target);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "swapDepths")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.getDepth()
// ---------------------------------------------------------------------------

describe("MovieClip getDepth()", () => {
  it("mc.getDepth() compiles without error", () => {
    expect(
      compilesOk('var mc = _root.createEmptyMovieClip("name", 1); mc.getDepth();')
    ).toBe(true);
  });

  it("mc.getDepth() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); mc.getDepth();'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getDepth")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._x property write
// ---------------------------------------------------------------------------

describe("MovieClip _x property write", () => {
  it("mc._x = 100 compiles without error", () => {
    expect(
      compilesOk('var mc = _root.createEmptyMovieClip("name", 1); mc._x = 100;')
    ).toBe(true);
  });

  it("mc._x = 100 emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); mc._x = 100;'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_x")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._y property write
// ---------------------------------------------------------------------------

describe("MovieClip _y property write", () => {
  it("mc._y = 50 compiles without error", () => {
    expect(
      compilesOk('var mc = _root.createEmptyMovieClip("name", 1); mc._y = 50;')
    ).toBe(true);
  });

  it("mc._y = 50 emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); mc._y = 50;'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_y")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._alpha property write
// ---------------------------------------------------------------------------

describe("MovieClip _alpha property write", () => {
  it("mc._alpha = 80 compiles without error", () => {
    expect(
      compilesOk('var mc = _root.createEmptyMovieClip("name", 1); mc._alpha = 80;')
    ).toBe(true);
  });

  it("mc._alpha = 80 emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); mc._alpha = 80;'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_alpha")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._width property read
// ---------------------------------------------------------------------------

describe("MovieClip _width property read", () => {
  it("mc._width compiles without error", () => {
    expect(
      compilesOk('var mc = _root.createEmptyMovieClip("name", 1); mc._width;')
    ).toBe(true);
  });

  it("mc._width emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); mc._width;'
    );
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_width")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._height property read
// ---------------------------------------------------------------------------

describe("MovieClip _height property read", () => {
  it("mc._height compiles without error", () => {
    expect(
      compilesOk('var mc = _root.createEmptyMovieClip("name", 1); mc._height;')
    ).toBe(true);
  });

  it("mc._height emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); mc._height;'
    );
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_height")).toBe(true);
  });
});
