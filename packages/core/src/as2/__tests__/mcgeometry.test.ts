/**
 * Tests for AS2 compiler: MovieClip geometry methods — hitTest, getBounds,
 * localToGlobal, globalToLocal, getBytesLoaded, getBytesTotal, getURL.
 *
 * Verifies that all these instance method calls on a MovieClip reference
 * compile without error and emit ActionCallMethod (0x52).
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

// ---------------------------------------------------------------------------
// mc.hitTest(x, y, shapeFlag)
// ---------------------------------------------------------------------------

describe("MovieClip hitTest(x, y, shapeFlag)", () => {
  it("mc.hitTest(100, 200, true) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.hitTest(100, 200, true);")).toBe(true);
  });

  it("mc.hitTest(100, 200, true) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.hitTest(100, 200, true);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "hitTest")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.hitTest(target)
// ---------------------------------------------------------------------------

describe("MovieClip hitTest(target)", () => {
  it("mc.hitTest(target) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; var target = _root.other; mc.hitTest(target);")).toBe(true);
  });

  it("mc.hitTest(target) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; var target = _root.other; mc.hitTest(target);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "hitTest")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.getBounds(coordinateSpace)
// ---------------------------------------------------------------------------

describe("MovieClip getBounds()", () => {
  it("mc.getBounds(coordinateSpace) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; var coordinateSpace = _root; mc.getBounds(coordinateSpace);")).toBe(true);
  });

  it("mc.getBounds(coordinateSpace) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; var coordinateSpace = _root; mc.getBounds(coordinateSpace);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getBounds")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.localToGlobal(pt)
// ---------------------------------------------------------------------------

describe("MovieClip localToGlobal()", () => {
  it("mc.localToGlobal(pt) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; var pt = {x: 0, y: 0}; mc.localToGlobal(pt);")).toBe(true);
  });

  it("mc.localToGlobal(pt) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; var pt = {x: 0, y: 0}; mc.localToGlobal(pt);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "localToGlobal")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.globalToLocal(pt)
// ---------------------------------------------------------------------------

describe("MovieClip globalToLocal()", () => {
  it("mc.globalToLocal(pt) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; var pt = {x: 0, y: 0}; mc.globalToLocal(pt);")).toBe(true);
  });

  it("mc.globalToLocal(pt) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; var pt = {x: 0, y: 0}; mc.globalToLocal(pt);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "globalToLocal")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.getBytesLoaded()
// ---------------------------------------------------------------------------

describe("MovieClip getBytesLoaded()", () => {
  it("mc.getBytesLoaded() compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.getBytesLoaded();")).toBe(true);
  });

  it("mc.getBytesLoaded() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.getBytesLoaded();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getBytesLoaded")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.getBytesTotal()
// ---------------------------------------------------------------------------

describe("MovieClip getBytesTotal()", () => {
  it("mc.getBytesTotal() compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.getBytesTotal();")).toBe(true);
  });

  it("mc.getBytesTotal() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.getBytesTotal();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getBytesTotal")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.getURL()
// ---------------------------------------------------------------------------

describe("MovieClip getURL()", () => {
  it('mc.getURL("http://x.com", "_blank") compiles without error', () => {
    expect(compilesOk('var mc = _root.mc; mc.getURL("http://x.com", "_blank");')).toBe(true);
  });

  it('mc.getURL("http://x.com", "_blank") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var mc = _root.mc; mc.getURL("http://x.com", "_blank");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getURL")).toBe(true);
  });
});
