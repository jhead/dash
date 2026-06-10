/**
 * Tests for AS2 compiler: Stage, Key, and Mouse built-in class usage.
 *
 * Verifies that Stage property reads and writes, Stage method calls,
 * Key method calls and constant accesses, and Mouse method calls
 * compile without error and emit the correct AVM1 opcodes:
 *   - ActionGetMember  (0x4e): property reads (Stage.width, Key.UP, etc.)
 *   - ActionSetMember  (0x4f): property writes (Stage.align = "TL", etc.)
 *   - ActionCallMethod (0x52): method calls (Stage.addListener, Mouse.hide, etc.)
 *   - ActionGetVariable(0x1c): variable access (Stage, Key, etc.)
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

const ACTION_GET_VARIABLE = 0x1c; // ActionGetVariable — variable lookup
const ACTION_GET_MEMBER   = 0x4e; // ActionGetMember  — property read
const ACTION_SET_MEMBER   = 0x4f; // ActionSetMember  — property write
const ACTION_CALL_METHOD  = 0x52; // ActionCallMethod — method dispatch

// ---------------------------------------------------------------------------
// Stage.width
// ---------------------------------------------------------------------------

describe("Stage.width", () => {
  it("Stage.width compiles without error", () => {
    expect(compilesOk("Stage.width;")).toBe(true);
  });

  it("Stage.width emits ActionGetVariable (0x1c) and ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("Stage.width;");
    expect(containsByte(bytes, ACTION_GET_VARIABLE)).toBe(true);
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
    expect(containsString(bytes, "width")).toBe(true);
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
// Stage.align = "TL"
// ---------------------------------------------------------------------------

describe('Stage.align = "TL"', () => {
  it('Stage.align = "TL" compiles without error', () => {
    expect(compilesOk('Stage.align = "TL";')).toBe(true);
  });

  it('Stage.align = "TL" emits ActionSetMember (0x4f)', () => {
    const bytes = compileAS2('Stage.align = "TL";');
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "align")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.scaleMode = "noScale"
// ---------------------------------------------------------------------------

describe('Stage.scaleMode = "noScale"', () => {
  it('Stage.scaleMode = "noScale" compiles without error', () => {
    expect(compilesOk('Stage.scaleMode = "noScale";')).toBe(true);
  });

  it('Stage.scaleMode = "noScale" emits ActionSetMember (0x4f)', () => {
    const bytes = compileAS2('Stage.scaleMode = "noScale";');
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "scaleMode")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.addListener(obj)
// ---------------------------------------------------------------------------

describe("Stage.addListener(obj)", () => {
  it("Stage.addListener(obj) compiles without error", () => {
    expect(compilesOk("var obj = {}; Stage.addListener(obj);")).toBe(true);
  });

  it("Stage.addListener(obj) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var obj = {}; Stage.addListener(obj);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "addListener")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.removeListener(obj)
// ---------------------------------------------------------------------------

describe("Stage.removeListener(obj)", () => {
  it("Stage.removeListener(obj) compiles without error", () => {
    expect(compilesOk("var obj = {}; Stage.removeListener(obj);")).toBe(true);
  });

  it("Stage.removeListener(obj) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var obj = {}; Stage.removeListener(obj);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "removeListener")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key.isDown(Key.UP)
// ---------------------------------------------------------------------------

describe("Key.isDown(Key.UP)", () => {
  it("Key.isDown(Key.UP) compiles without error", () => {
    expect(compilesOk("Key.isDown(Key.UP);")).toBe(true);
  });

  it("Key.isDown(Key.UP) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Key.isDown(Key.UP);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "isDown")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key.UP
// ---------------------------------------------------------------------------

describe("Key.UP constant", () => {
  it("Key.UP compiles without error", () => {
    expect(compilesOk("var k = Key.UP;")).toBe(true);
  });

  it("Key.UP emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var k = Key.UP;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "UP")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key.ENTER
// ---------------------------------------------------------------------------

describe("Key.ENTER constant", () => {
  it("Key.ENTER compiles without error", () => {
    expect(compilesOk("var k = Key.ENTER;")).toBe(true);
  });

  it("Key.ENTER emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var k = Key.ENTER;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "ENTER")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key.SPACE
// ---------------------------------------------------------------------------

describe("Key.SPACE constant", () => {
  it("Key.SPACE compiles without error", () => {
    expect(compilesOk("var k = Key.SPACE;")).toBe(true);
  });

  it("Key.SPACE emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var k = Key.SPACE;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "SPACE")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
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
// Mouse.addListener(obj)
// ---------------------------------------------------------------------------

describe("Mouse.addListener(obj)", () => {
  it("Mouse.addListener(obj) compiles without error", () => {
    expect(compilesOk("var obj = {}; Mouse.addListener(obj);")).toBe(true);
  });

  it("Mouse.addListener(obj) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var obj = {}; Mouse.addListener(obj);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "addListener")).toBe(true);
    expect(containsString(bytes, "Mouse")).toBe(true);
  });
});
