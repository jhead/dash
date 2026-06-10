/**
 * Tests for AS2 compiler: Stage and Mouse built-in class usage.
 *
 * Verifies that Stage property reads, Stage property assignments, Stage method
 * calls, and Mouse method calls compile without error and emit the correct
 * AVM1 opcodes:
 *   - ActionGetMember  (0x4e): property reads (Stage.width, Stage.height, etc.)
 *   - ActionSetMember  (0x4f): property writes (Stage.showMenu = false)
 *   - ActionCallMethod (0x52): method calls (Stage.addListener(), Mouse.hide(), etc.)
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
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read
const ACTION_SET_MEMBER  = 0x4f; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// Stage.width
// ---------------------------------------------------------------------------

describe("Stage.width", () => {
  it("Stage.width compiles without error", () => {
    expect(compilesOk("Stage.width;")).toBe(true);
  });

  it("Stage.width emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("Stage.width;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "width")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.height
// ---------------------------------------------------------------------------

describe("Stage.height", () => {
  it("Stage.height compiles without error", () => {
    expect(compilesOk("Stage.height;")).toBe(true);
  });

  it("Stage.height emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("Stage.height;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "height")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.align
// ---------------------------------------------------------------------------

describe("Stage.align", () => {
  it("Stage.align compiles without error", () => {
    expect(compilesOk("Stage.align;")).toBe(true);
  });

  it("Stage.align emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("Stage.align;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "align")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.scaleMode
// ---------------------------------------------------------------------------

describe("Stage.scaleMode", () => {
  it("Stage.scaleMode compiles without error", () => {
    expect(compilesOk("Stage.scaleMode;")).toBe(true);
  });

  it("Stage.scaleMode emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("Stage.scaleMode;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "scaleMode")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.showMenu assignment
// ---------------------------------------------------------------------------

describe("Stage.showMenu assignment", () => {
  it("Stage.showMenu = false compiles without error", () => {
    expect(compilesOk("Stage.showMenu = false;")).toBe(true);
  });

  it("Stage.showMenu = false emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("Stage.showMenu = false;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "showMenu")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.addListener()
// ---------------------------------------------------------------------------

describe("Stage.addListener()", () => {
  it("Stage.addListener(l) compiles without error", () => {
    expect(compilesOk("var l = {}; Stage.addListener(l);")).toBe(true);
  });

  it("Stage.addListener(l) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var l = {}; Stage.addListener(l);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "addListener")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.removeListener()
// ---------------------------------------------------------------------------

describe("Stage.removeListener()", () => {
  it("Stage.removeListener(l) compiles without error", () => {
    expect(compilesOk("var l = {}; Stage.removeListener(l);")).toBe(true);
  });

  it("Stage.removeListener(l) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var l = {}; Stage.removeListener(l);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "removeListener")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mouse.hide()
// ---------------------------------------------------------------------------

describe("Mouse.hide()", () => {
  it("Mouse.hide() compiles without error", () => {
    expect(compilesOk("Mouse.hide();")).toBe(true);
  });

  it("Mouse.hide() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Mouse.hide();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "hide")).toBe(true);
    expect(containsString(bytes, "Mouse")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mouse.show()
// ---------------------------------------------------------------------------

describe("Mouse.show()", () => {
  it("Mouse.show() compiles without error", () => {
    expect(compilesOk("Mouse.show();")).toBe(true);
  });

  it("Mouse.show() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Mouse.show();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "show")).toBe(true);
    expect(containsString(bytes, "Mouse")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mouse.addListener()
// ---------------------------------------------------------------------------

describe("Mouse.addListener()", () => {
  it("Mouse.addListener(l) compiles without error", () => {
    expect(compilesOk("var l = {}; Mouse.addListener(l);")).toBe(true);
  });

  it("Mouse.addListener(l) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var l = {}; Mouse.addListener(l);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "addListener")).toBe(true);
    expect(containsString(bytes, "Mouse")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mouse.removeListener()
// ---------------------------------------------------------------------------

describe("Mouse.removeListener()", () => {
  it("Mouse.removeListener(l) compiles without error", () => {
    expect(compilesOk("var l = {}; Mouse.removeListener(l);")).toBe(true);
  });

  it("Mouse.removeListener(l) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var l = {}; Mouse.removeListener(l);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "removeListener")).toBe(true);
    expect(containsString(bytes, "Mouse")).toBe(true);
  });
});
