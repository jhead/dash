/**
 * Tests for AS2 compiler: Selection class static method calls.
 *
 * Verifies that Selection.setFocus(), Selection.getFocus(),
 * Selection.setSelection(), Selection.getBeginIndex(),
 * Selection.getEndIndex(), Selection.getCaretIndex(),
 * Selection.addListener(), and Selection.removeListener()
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
// Selection.setFocus()
// ---------------------------------------------------------------------------

describe("Selection.setFocus()", () => {
  it("Selection.setFocus(textField) compiles without error", () => {
    expect(compilesOk("var textField = _root.tf; Selection.setFocus(textField);")).toBe(true);
  });

  it("Selection.setFocus(textField) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var textField = _root.tf; Selection.setFocus(textField);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setFocus")).toBe(true);
    expect(containsString(bytes, "Selection")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Selection.getFocus()
// ---------------------------------------------------------------------------

describe("Selection.getFocus()", () => {
  it("Selection.getFocus() compiles without error", () => {
    expect(compilesOk("Selection.getFocus();")).toBe(true);
  });

  it("Selection.getFocus() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Selection.getFocus();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getFocus")).toBe(true);
    expect(containsString(bytes, "Selection")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Selection.setSelection()
// ---------------------------------------------------------------------------

describe("Selection.setSelection()", () => {
  it("Selection.setSelection(0, 5) compiles without error", () => {
    expect(compilesOk("Selection.setSelection(0, 5);")).toBe(true);
  });

  it("Selection.setSelection(0, 5) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Selection.setSelection(0, 5);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setSelection")).toBe(true);
    expect(containsString(bytes, "Selection")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Selection.getBeginIndex()
// ---------------------------------------------------------------------------

describe("Selection.getBeginIndex()", () => {
  it("Selection.getBeginIndex() compiles without error", () => {
    expect(compilesOk("Selection.getBeginIndex();")).toBe(true);
  });

  it("Selection.getBeginIndex() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Selection.getBeginIndex();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getBeginIndex")).toBe(true);
    expect(containsString(bytes, "Selection")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Selection.getEndIndex()
// ---------------------------------------------------------------------------

describe("Selection.getEndIndex()", () => {
  it("Selection.getEndIndex() compiles without error", () => {
    expect(compilesOk("Selection.getEndIndex();")).toBe(true);
  });

  it("Selection.getEndIndex() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Selection.getEndIndex();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getEndIndex")).toBe(true);
    expect(containsString(bytes, "Selection")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Selection.getCaretIndex()
// ---------------------------------------------------------------------------

describe("Selection.getCaretIndex()", () => {
  it("Selection.getCaretIndex() compiles without error", () => {
    expect(compilesOk("Selection.getCaretIndex();")).toBe(true);
  });

  it("Selection.getCaretIndex() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Selection.getCaretIndex();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getCaretIndex")).toBe(true);
    expect(containsString(bytes, "Selection")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Selection.addListener()
// ---------------------------------------------------------------------------

describe("Selection.addListener()", () => {
  it("Selection.addListener(l) compiles without error", () => {
    expect(compilesOk("var l = {}; Selection.addListener(l);")).toBe(true);
  });

  it("Selection.addListener(l) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var l = {}; Selection.addListener(l);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "addListener")).toBe(true);
    expect(containsString(bytes, "Selection")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Selection.removeListener()
// ---------------------------------------------------------------------------

describe("Selection.removeListener()", () => {
  it("Selection.removeListener(l) compiles without error", () => {
    expect(compilesOk("var l = {}; Selection.removeListener(l);")).toBe(true);
  });

  it("Selection.removeListener(l) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var l = {}; Selection.removeListener(l);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "removeListener")).toBe(true);
    expect(containsString(bytes, "Selection")).toBe(true);
  });
});
