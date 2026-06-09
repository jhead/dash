/**
 * Tests for AS2 compiler: Button event handler assignments and property writes.
 *
 * Verifies that assigning handler functions and properties on Button instances
 * (onPress, onRelease, onRollOver, onRollOut, onReleaseOutside, onDragOver,
 * onDragOut, onKeyDown, onKeyUp, enabled, useHandCursor) compiles without error
 * and emits the correct AVM1 opcode:
 *   - ActionSetMember (0x4e): property / handler assignment
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

const ACTION_SET_MEMBER = 0x4e; // ActionSetMember — property write

// ---------------------------------------------------------------------------
// btn.onPress
// ---------------------------------------------------------------------------

describe("btn.onPress handler assignment", () => {
  it("btn.onPress = function() {} compiles without error", () => {
    expect(compilesOk("var btn = {}; btn.onPress = function() {};")).toBe(true);
  });

  it("btn.onPress = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var btn = {}; btn.onPress = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onPress")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// btn.onRelease
// ---------------------------------------------------------------------------

describe("btn.onRelease handler assignment", () => {
  it("btn.onRelease = function() {} compiles without error", () => {
    expect(compilesOk("var btn = {}; btn.onRelease = function() {};")).toBe(true);
  });

  it("btn.onRelease = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var btn = {}; btn.onRelease = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onRelease")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// btn.onRollOver
// ---------------------------------------------------------------------------

describe("btn.onRollOver handler assignment", () => {
  it("btn.onRollOver = function() {} compiles without error", () => {
    expect(compilesOk("var btn = {}; btn.onRollOver = function() {};")).toBe(true);
  });

  it("btn.onRollOver = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var btn = {}; btn.onRollOver = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onRollOver")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// btn.onRollOut
// ---------------------------------------------------------------------------

describe("btn.onRollOut handler assignment", () => {
  it("btn.onRollOut = function() {} compiles without error", () => {
    expect(compilesOk("var btn = {}; btn.onRollOut = function() {};")).toBe(true);
  });

  it("btn.onRollOut = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var btn = {}; btn.onRollOut = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onRollOut")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// btn.onReleaseOutside
// ---------------------------------------------------------------------------

describe("btn.onReleaseOutside handler assignment", () => {
  it("btn.onReleaseOutside = function() {} compiles without error", () => {
    expect(compilesOk("var btn = {}; btn.onReleaseOutside = function() {};")).toBe(true);
  });

  it("btn.onReleaseOutside = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var btn = {}; btn.onReleaseOutside = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onReleaseOutside")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// btn.onDragOver
// ---------------------------------------------------------------------------

describe("btn.onDragOver handler assignment", () => {
  it("btn.onDragOver = function() {} compiles without error", () => {
    expect(compilesOk("var btn = {}; btn.onDragOver = function() {};")).toBe(true);
  });

  it("btn.onDragOver = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var btn = {}; btn.onDragOver = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onDragOver")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// btn.onDragOut
// ---------------------------------------------------------------------------

describe("btn.onDragOut handler assignment", () => {
  it("btn.onDragOut = function() {} compiles without error", () => {
    expect(compilesOk("var btn = {}; btn.onDragOut = function() {};")).toBe(true);
  });

  it("btn.onDragOut = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var btn = {}; btn.onDragOut = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onDragOut")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// btn.onKeyDown
// ---------------------------------------------------------------------------

describe("btn.onKeyDown handler assignment", () => {
  it("btn.onKeyDown = function() {} compiles without error", () => {
    expect(compilesOk("var btn = {}; btn.onKeyDown = function() {};")).toBe(true);
  });

  it("btn.onKeyDown = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var btn = {}; btn.onKeyDown = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onKeyDown")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// btn.onKeyUp
// ---------------------------------------------------------------------------

describe("btn.onKeyUp handler assignment", () => {
  it("btn.onKeyUp = function() {} compiles without error", () => {
    expect(compilesOk("var btn = {}; btn.onKeyUp = function() {};")).toBe(true);
  });

  it("btn.onKeyUp = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var btn = {}; btn.onKeyUp = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onKeyUp")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// btn.enabled
// ---------------------------------------------------------------------------

describe("btn.enabled property assignment", () => {
  it("btn.enabled = false compiles without error", () => {
    expect(compilesOk("var btn = {}; btn.enabled = false;")).toBe(true);
  });

  it("btn.enabled = false emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var btn = {}; btn.enabled = false;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "enabled")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// btn.useHandCursor
// ---------------------------------------------------------------------------

describe("btn.useHandCursor property assignment", () => {
  it("btn.useHandCursor = true compiles without error", () => {
    expect(compilesOk("var btn = {}; btn.useHandCursor = true;")).toBe(true);
  });

  it("btn.useHandCursor = true emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("var btn = {}; btn.useHandCursor = true;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "useHandCursor")).toBe(true);
  });
});
