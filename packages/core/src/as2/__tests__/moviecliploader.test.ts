/**
 * Tests for AS2 compiler: MovieClipLoader construction, method calls,
 * and event handler property assignments.
 *
 * Verifies that MovieClipLoader constructor calls, instance method calls,
 * and callback property assignments compile without error and emit the
 * correct AVM1 opcodes:
 *   - ActionNew        (0x40): constructor calls (new MovieClipLoader())
 *   - ActionCallMethod (0x52): method calls (mcl.loadClip(), etc.)
 *   - ActionSetMember  (0x4f): property writes (mcl.onLoadStart = ..., etc.)
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

const ACTION_NEW         = 0x40; // ActionNew        — constructor call
const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_SET_MEMBER  = 0x4f; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// MovieClipLoader constructor
// ---------------------------------------------------------------------------

describe("MovieClipLoader constructor", () => {
  it("new MovieClipLoader() compiles without error", () => {
    expect(compilesOk("new MovieClipLoader();")).toBe(true);
  });

  it("new MovieClipLoader() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("new MovieClipLoader();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "MovieClipLoader")).toBe(true);
  });

  it("var mcl = new MovieClipLoader() compiles without error", () => {
    expect(compilesOk("var mcl = new MovieClipLoader();")).toBe(true);
  });

  it("var mcl = new MovieClipLoader() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("var mcl = new MovieClipLoader();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "MovieClipLoader")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mcl.loadClip()
// ---------------------------------------------------------------------------

describe("MovieClipLoader loadClip()", () => {
  it('mcl.loadClip(url, target) compiles without error', () => {
    expect(
      compilesOk('var mcl = new MovieClipLoader(); mcl.loadClip("clip.swf", _root);')
    ).toBe(true);
  });

  it('mcl.loadClip(url, target) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var mcl = new MovieClipLoader(); mcl.loadClip("clip.swf", _root);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "loadClip")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mcl.unloadClip()
// ---------------------------------------------------------------------------

describe("MovieClipLoader unloadClip()", () => {
  it("mcl.unloadClip(target) compiles without error", () => {
    expect(
      compilesOk("var mcl = new MovieClipLoader(); mcl.unloadClip(_root);")
    ).toBe(true);
  });

  it("mcl.unloadClip(target) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var mcl = new MovieClipLoader(); mcl.unloadClip(_root);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "unloadClip")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mcl.getProgress()
// ---------------------------------------------------------------------------

describe("MovieClipLoader getProgress()", () => {
  it("mcl.getProgress(target) compiles without error", () => {
    expect(
      compilesOk("var mcl = new MovieClipLoader(); mcl.getProgress(_root);")
    ).toBe(true);
  });

  it("mcl.getProgress(target) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var mcl = new MovieClipLoader(); mcl.getProgress(_root);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getProgress")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mcl.addListener()
// ---------------------------------------------------------------------------

describe("MovieClipLoader addListener()", () => {
  it("mcl.addListener(listener) compiles without error", () => {
    expect(
      compilesOk(
        "var mcl = new MovieClipLoader(); var listener = new Object(); mcl.addListener(listener);"
      )
    ).toBe(true);
  });

  it("mcl.addListener(listener) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var mcl = new MovieClipLoader(); var listener = new Object(); mcl.addListener(listener);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "addListener")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mcl.onLoadStart callback assignment
// ---------------------------------------------------------------------------

describe("MovieClipLoader onLoadStart callback", () => {
  it("mcl.onLoadStart = function() {} compiles without error", () => {
    expect(
      compilesOk("var mcl = new MovieClipLoader(); mcl.onLoadStart = function() {};")
    ).toBe(true);
  });

  it("mcl.onLoadStart = function() {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      "var mcl = new MovieClipLoader(); mcl.onLoadStart = function() {};"
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onLoadStart")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mcl.onLoadProgress callback assignment
// ---------------------------------------------------------------------------

describe("MovieClipLoader onLoadProgress callback", () => {
  it("mcl.onLoadProgress = function(target, bytesLoaded, bytesTotal) {} compiles without error", () => {
    expect(
      compilesOk(
        "var mcl = new MovieClipLoader(); mcl.onLoadProgress = function(target, bytesLoaded, bytesTotal) {};"
      )
    ).toBe(true);
  });

  it("mcl.onLoadProgress = function(target, bytesLoaded, bytesTotal) {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      "var mcl = new MovieClipLoader(); mcl.onLoadProgress = function(target, bytesLoaded, bytesTotal) {};"
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onLoadProgress")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mcl.onLoadComplete callback assignment
// ---------------------------------------------------------------------------

describe("MovieClipLoader onLoadComplete callback", () => {
  it("mcl.onLoadComplete = function(target) {} compiles without error", () => {
    expect(
      compilesOk(
        "var mcl = new MovieClipLoader(); mcl.onLoadComplete = function(target) {};"
      )
    ).toBe(true);
  });

  it("mcl.onLoadComplete = function(target) {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      "var mcl = new MovieClipLoader(); mcl.onLoadComplete = function(target) {};"
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onLoadComplete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mcl.onLoadError callback assignment
// ---------------------------------------------------------------------------

describe("MovieClipLoader onLoadError callback", () => {
  it("mcl.onLoadError = function(target, errorCode) {} compiles without error", () => {
    expect(
      compilesOk(
        "var mcl = new MovieClipLoader(); mcl.onLoadError = function(target, errorCode) {};"
      )
    ).toBe(true);
  });

  it("mcl.onLoadError = function(target, errorCode) {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      "var mcl = new MovieClipLoader(); mcl.onLoadError = function(target, errorCode) {};"
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onLoadError")).toBe(true);
  });
});
