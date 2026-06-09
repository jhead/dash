/**
 * Tests for AS2 compiler: TextSnapshot class compilation.
 *
 * Verifies that TextSnapshot method calls obtained via mc.getTextSnapshot()
 * compile without error and emit the correct AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls
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
// mc.getTextSnapshot()
// ---------------------------------------------------------------------------

describe("mc.getTextSnapshot()", () => {
  it("var ts = mc.getTextSnapshot() compiles without error", () => {
    expect(
      compilesOk("var mc = _root; var ts = mc.getTextSnapshot();")
    ).toBe(true);
  });

  it("mc.getTextSnapshot() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root; var ts = mc.getTextSnapshot();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getTextSnapshot")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ts.getText()
// ---------------------------------------------------------------------------

describe("TextSnapshot.getText()", () => {
  it("ts.getText(0, 10, true) compiles without error", () => {
    expect(
      compilesOk(
        "var mc = _root; var ts = mc.getTextSnapshot(); ts.getText(0, 10, true);"
      )
    ).toBe(true);
  });

  it("ts.getText(0, 10, true) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var mc = _root; var ts = mc.getTextSnapshot(); ts.getText(0, 10, true);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getText")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ts.getCount()
// ---------------------------------------------------------------------------

describe("TextSnapshot.getCount()", () => {
  it("ts.getCount() compiles without error", () => {
    expect(
      compilesOk(
        "var mc = _root; var ts = mc.getTextSnapshot(); ts.getCount();"
      )
    ).toBe(true);
  });

  it("ts.getCount() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var mc = _root; var ts = mc.getTextSnapshot(); ts.getCount();"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getCount")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ts.setSelectColor()
// ---------------------------------------------------------------------------

describe("TextSnapshot.setSelectColor()", () => {
  it("ts.setSelectColor(0xFF0000) compiles without error", () => {
    expect(
      compilesOk(
        "var mc = _root; var ts = mc.getTextSnapshot(); ts.setSelectColor(0xFF0000);"
      )
    ).toBe(true);
  });

  it("ts.setSelectColor(0xFF0000) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var mc = _root; var ts = mc.getTextSnapshot(); ts.setSelectColor(0xFF0000);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setSelectColor")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ts.setSelected()
// ---------------------------------------------------------------------------

describe("TextSnapshot.setSelected()", () => {
  it("ts.setSelected(0, 5, true) compiles without error", () => {
    expect(
      compilesOk(
        "var mc = _root; var ts = mc.getTextSnapshot(); ts.setSelected(0, 5, true);"
      )
    ).toBe(true);
  });

  it("ts.setSelected(0, 5, true) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var mc = _root; var ts = mc.getTextSnapshot(); ts.setSelected(0, 5, true);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setSelected")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ts.getSelected()
// ---------------------------------------------------------------------------

describe("TextSnapshot.getSelected()", () => {
  it("ts.getSelected(0, 5) compiles without error", () => {
    expect(
      compilesOk(
        "var mc = _root; var ts = mc.getTextSnapshot(); ts.getSelected(0, 5);"
      )
    ).toBe(true);
  });

  it("ts.getSelected(0, 5) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var mc = _root; var ts = mc.getTextSnapshot(); ts.getSelected(0, 5);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getSelected")).toBe(true);
  });
});
