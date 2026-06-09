/**
 * Tests for AS2 compiler: Key class static method calls and constant property
 * accesses.
 *
 * Verifies that Key.isDown(), Key.getCode(), Key.getAscii(),
 * Key.addListener(), Key.removeListener(), Key constant properties
 * (Key.UP, Key.DOWN, Key.LEFT, Key.RIGHT, Key.ENTER, Key.SPACE), and the
 * common keyboard-movement pattern compile without error and emit the correct
 * AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls (Key.isDown(), Key.getCode(), etc.)
 *   - ActionGetMember  (0x4f): property reads (Key.UP, Key.DOWN, etc.)
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
const ACTION_GET_MEMBER  = 0x4f; // ActionGetMember  — property read

// ---------------------------------------------------------------------------
// Key.isDown()
// ---------------------------------------------------------------------------

describe("Key.isDown()", () => {
  it("Key.isDown(38) compiles without error", () => {
    expect(compilesOk("Key.isDown(38);")).toBe(true);
  });

  it("Key.isDown(38) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Key.isDown(38);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "isDown")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key.getCode()
// ---------------------------------------------------------------------------

describe("Key.getCode()", () => {
  it("Key.getCode() compiles without error", () => {
    expect(compilesOk("Key.getCode();")).toBe(true);
  });

  it("Key.getCode() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Key.getCode();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getCode")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key.getAscii()
// ---------------------------------------------------------------------------

describe("Key.getAscii()", () => {
  it("Key.getAscii() compiles without error", () => {
    expect(compilesOk("Key.getAscii();")).toBe(true);
  });

  it("Key.getAscii() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Key.getAscii();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getAscii")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key.addListener()
// ---------------------------------------------------------------------------

describe("Key.addListener()", () => {
  it("Key.addListener(l) compiles without error", () => {
    expect(compilesOk("var l = {}; Key.addListener(l);")).toBe(true);
  });

  it("Key.addListener(l) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var l = {}; Key.addListener(l);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "addListener")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key.removeListener()
// ---------------------------------------------------------------------------

describe("Key.removeListener()", () => {
  it("Key.removeListener(l) compiles without error", () => {
    expect(compilesOk("var l = {}; Key.removeListener(l);")).toBe(true);
  });

  it("Key.removeListener(l) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var l = {}; Key.removeListener(l);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "removeListener")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key constant properties
// ---------------------------------------------------------------------------

describe("Key.UP constant", () => {
  it("Key.UP compiles without error", () => {
    expect(compilesOk("var k = Key.UP;")).toBe(true);
  });

  it("Key.UP emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var k = Key.UP;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "UP")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

describe("Key.DOWN constant", () => {
  it("Key.DOWN compiles without error", () => {
    expect(compilesOk("var k = Key.DOWN;")).toBe(true);
  });

  it("Key.DOWN emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var k = Key.DOWN;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "DOWN")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

describe("Key.LEFT constant", () => {
  it("Key.LEFT compiles without error", () => {
    expect(compilesOk("var k = Key.LEFT;")).toBe(true);
  });

  it("Key.LEFT emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var k = Key.LEFT;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "LEFT")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

describe("Key.RIGHT constant", () => {
  it("Key.RIGHT compiles without error", () => {
    expect(compilesOk("var k = Key.RIGHT;")).toBe(true);
  });

  it("Key.RIGHT emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var k = Key.RIGHT;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "RIGHT")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

describe("Key.ENTER constant", () => {
  it("Key.ENTER compiles without error", () => {
    expect(compilesOk("var k = Key.ENTER;")).toBe(true);
  });

  it("Key.ENTER emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var k = Key.ENTER;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "ENTER")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

describe("Key.SPACE constant", () => {
  it("Key.SPACE compiles without error", () => {
    expect(compilesOk("var k = Key.SPACE;")).toBe(true);
  });

  it("Key.SPACE emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var k = Key.SPACE;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "SPACE")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Common movement pattern: if (Key.isDown(Key.LEFT)) { _x -= 5; }
// ---------------------------------------------------------------------------

describe("Key movement pattern", () => {
  it("if (Key.isDown(Key.LEFT)) { _x -= 5; } compiles without error", () => {
    expect(compilesOk("if (Key.isDown(Key.LEFT)) { _x -= 5; }")).toBe(true);
  });

  it("movement pattern emits ActionCallMethod (0x52) for Key.isDown", () => {
    const bytes = compileAS2("if (Key.isDown(Key.LEFT)) { _x -= 5; }");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "isDown")).toBe(true);
  });

  it("movement pattern emits ActionGetMember (0x4f) for Key.LEFT", () => {
    const bytes = compileAS2("if (Key.isDown(Key.LEFT)) { _x -= 5; }");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "LEFT")).toBe(true);
  });
});
