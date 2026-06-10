/**
 * Tests for AS2 compiler: BitmapData object construction, method calls, and
 * property accesses.
 *
 * Verifies that BitmapData constructor calls, instance method calls, property
 * reads compile without error and emit the correct AVM1 opcodes:
 *   - ActionNew        (0x40): constructor calls (new BitmapData())
 *   - ActionCallMethod (0x52): method calls (bd.setPixel(), bd.getPixel(), etc.)
 *   - ActionGetMember  (0x4e): property reads (bd.width, bd.height)
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
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read

// ---------------------------------------------------------------------------
// BitmapData constructor
// ---------------------------------------------------------------------------

describe("BitmapData constructor", () => {
  it("new BitmapData(100, 100, true, 0xFFFFFFFF) compiles without error", () => {
    expect(compilesOk("new BitmapData(100, 100, true, 0xFFFFFFFF);")).toBe(true);
  });

  it("new BitmapData(100, 100, true, 0xFFFFFFFF) emits ActionNew (0x40)", () => {
    const bytes = compileAS2("new BitmapData(100, 100, true, 0xFFFFFFFF);");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "BitmapData")).toBe(true);
  });

  it("var bd = new BitmapData(100, 100, true, 0xFFFFFFFF) compiles without error", () => {
    expect(compilesOk("var bd = new BitmapData(100, 100, true, 0xFFFFFFFF);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bd.setPixel()
// ---------------------------------------------------------------------------

describe("BitmapData setPixel()", () => {
  it("bd.setPixel(10, 20, 0xFF0000) compiles without error", () => {
    expect(
      compilesOk("var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); bd.setPixel(10, 20, 0xFF0000);")
    ).toBe(true);
  });

  it("bd.setPixel(10, 20, 0xFF0000) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); bd.setPixel(10, 20, 0xFF0000);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setPixel")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bd.getPixel()
// ---------------------------------------------------------------------------

describe("BitmapData getPixel()", () => {
  it("bd.getPixel(10, 20) compiles without error", () => {
    expect(
      compilesOk("var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); bd.getPixel(10, 20);")
    ).toBe(true);
  });

  it("bd.getPixel(10, 20) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); bd.getPixel(10, 20);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getPixel")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bd.fillRect()
// ---------------------------------------------------------------------------

describe("BitmapData fillRect()", () => {
  it("bd.fillRect(r, color) compiles without error", () => {
    expect(
      compilesOk("var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); var r = {}; bd.fillRect(r, 0xFF0000);")
    ).toBe(true);
  });

  it("bd.fillRect(r, color) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); var r = {}; bd.fillRect(r, 0xFF0000);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "fillRect")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bd.copyPixels()
// ---------------------------------------------------------------------------

describe("BitmapData copyPixels()", () => {
  it("bd.copyPixels(src, srcRect, destPoint) compiles without error", () => {
    expect(
      compilesOk(
        "var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); " +
        "var src = new BitmapData(100, 100, true, 0xFFFFFFFF); " +
        "var srcRect = {}; var destPoint = {}; " +
        "bd.copyPixels(src, srcRect, destPoint);"
      )
    ).toBe(true);
  });

  it("bd.copyPixels(src, srcRect, destPoint) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); " +
      "var src = new BitmapData(100, 100, true, 0xFFFFFFFF); " +
      "var srcRect = {}; var destPoint = {}; " +
      "bd.copyPixels(src, srcRect, destPoint);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "copyPixels")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bd.draw()
// ---------------------------------------------------------------------------

describe("BitmapData draw()", () => {
  it("bd.draw(source) compiles without error", () => {
    expect(
      compilesOk("var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); var source = {}; bd.draw(source);")
    ).toBe(true);
  });

  it("bd.draw(source) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); var source = {}; bd.draw(source);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "draw")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bd.dispose()
// ---------------------------------------------------------------------------

describe("BitmapData dispose()", () => {
  it("bd.dispose() compiles without error", () => {
    expect(
      compilesOk("var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); bd.dispose();")
    ).toBe(true);
  });

  it("bd.dispose() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); bd.dispose();"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "dispose")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bd.width property read
// ---------------------------------------------------------------------------

describe("BitmapData width property", () => {
  it("bd.width compiles without error", () => {
    expect(
      compilesOk("var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); bd.width;")
    ).toBe(true);
  });

  it("bd.width emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2(
      "var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); bd.width;"
    );
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "width")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bd.height property read
// ---------------------------------------------------------------------------

describe("BitmapData height property", () => {
  it("bd.height compiles without error", () => {
    expect(
      compilesOk("var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); bd.height;")
    ).toBe(true);
  });

  it("bd.height emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2(
      "var bd = new BitmapData(100, 100, true, 0xFFFFFFFF); bd.height;"
    );
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "height")).toBe(true);
  });
});
