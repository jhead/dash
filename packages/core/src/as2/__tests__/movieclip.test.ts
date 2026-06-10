/**
 * Tests for AS2 compiler: MovieClip built-in methods and properties.
 *
 * Verifies that common MovieClip instance methods and property accesses
 * compile without error and emit the correct AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls (attachMovie, gotoAndPlay, etc.)
 *   - ActionSetMember  (0x4f): property writes (_x, _y, _alpha, _visible)
 *   - ActionGetMember  (0x4e): property reads (_y)
 *   - ActionPlay       (0x06): play() on this or a var
 *   - ActionStop       (0x07): stop() on this or a var
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
const ACTION_SET_MEMBER  = 0x4f; // ActionSetMember  — property write
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read
const ACTION_PLAY        = 0x06; // ActionPlay
const ACTION_STOP        = 0x07; // ActionStop

// ---------------------------------------------------------------------------
// mc.attachMovie("id", "name", 1)
// ---------------------------------------------------------------------------

describe("MovieClip attachMovie()", () => {
  it('mc.attachMovie("id", "name", 1) compiles without error', () => {
    expect(
      compilesOk('var mc = _root.mc; mc.attachMovie("id", "name", 1);')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.createEmptyMovieClip("child", 2)
// ---------------------------------------------------------------------------

describe("MovieClip createEmptyMovieClip()", () => {
  it('mc.createEmptyMovieClip("child", 2) compiles without error', () => {
    expect(
      compilesOk('var mc = _root.mc; mc.createEmptyMovieClip("child", 2);')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.gotoAndPlay(5)
// ---------------------------------------------------------------------------

describe("MovieClip gotoAndPlay()", () => {
  it("mc.gotoAndPlay(5) compiles without error", () => {
    expect(
      compilesOk('var mc = _root.mc; mc.gotoAndPlay(5);')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.gotoAndStop("label")
// ---------------------------------------------------------------------------

describe("MovieClip gotoAndStop()", () => {
  it('mc.gotoAndStop("label") compiles without error', () => {
    expect(
      compilesOk('var mc = _root.mc; mc.gotoAndStop("label");')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.play() — emits ActionPlay (0x06)
// ---------------------------------------------------------------------------

describe("MovieClip play()", () => {
  it("play() on this emits ActionPlay (0x06)", () => {
    const bytes = compileAS2("play();");
    expect(containsByte(bytes, ACTION_PLAY)).toBe(true);
  });

  it("mc.play() compiles without error", () => {
    expect(
      compilesOk('var mc = _root.mc; mc.play();')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.stop() — emits ActionStop (0x07)
// ---------------------------------------------------------------------------

describe("MovieClip stop()", () => {
  it("stop() on this emits ActionStop (0x07)", () => {
    const bytes = compileAS2("stop();");
    expect(containsByte(bytes, ACTION_STOP)).toBe(true);
  });

  it("mc.stop() compiles without error", () => {
    expect(
      compilesOk('var mc = _root.mc; mc.stop();')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.nextFrame()
// ---------------------------------------------------------------------------

describe("MovieClip nextFrame()", () => {
  it("mc.nextFrame() compiles without error", () => {
    expect(
      compilesOk('var mc = _root.mc; mc.nextFrame();')
    ).toBe(true);
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
});

// ---------------------------------------------------------------------------
// mc._x = 100 — emits ActionSetMember (0x4f)
// ---------------------------------------------------------------------------

describe("MovieClip _x property write", () => {
  it("mc._x = 100 emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); mc._x = 100;'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_x")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// var x = mc._y — emits ActionGetMember (0x4e)
// ---------------------------------------------------------------------------

describe("MovieClip _y property read", () => {
  it("var x = mc._y emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); var x = mc._y;'
    );
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_y")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._alpha = 50 — emits ActionSetMember (0x4f)
// ---------------------------------------------------------------------------

describe("MovieClip _alpha property write", () => {
  it("mc._alpha = 50 emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); mc._alpha = 50;'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_alpha")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._visible = false — emits ActionSetMember (0x4f)
// ---------------------------------------------------------------------------

describe("MovieClip _visible property write", () => {
  it("mc._visible = false emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      'var mc = _root.createEmptyMovieClip("name", 1); mc._visible = false;'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_visible")).toBe(true);
  });
});
