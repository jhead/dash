/**
 * Tests for AS2 compiler: System and System.capabilities class compilation.
 *
 * Verifies that System static property reads, writes, method calls, and
 * chained System.capabilities member accesses compile without error and emit
 * the correct AVM1 opcodes:
 *   - ActionGetMember  (0x4e): property reads
 *   - ActionSetMember  (0x4f): property writes
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
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read
const ACTION_SET_MEMBER  = 0x4f; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// System.useCodepage
// ---------------------------------------------------------------------------

describe("System.useCodepage", () => {
  it("System.useCodepage compiles without error", () => {
    expect(compilesOk("System.useCodepage;")).toBe(true);
  });

  it("System.useCodepage emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.useCodepage;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "useCodepage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// System.exactSettings
// ---------------------------------------------------------------------------

describe("System.exactSettings", () => {
  it("System.exactSettings = true compiles without error", () => {
    expect(compilesOk("System.exactSettings = true;")).toBe(true);
  });

  it("System.exactSettings = true emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("System.exactSettings = true;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "exactSettings")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// System.setClipboard()
// ---------------------------------------------------------------------------

describe("System.setClipboard()", () => {
  it('System.setClipboard("text") compiles without error', () => {
    expect(compilesOk('System.setClipboard("text");')).toBe(true);
  });

  it('System.setClipboard("text") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('System.setClipboard("text");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setClipboard")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// System.showSettings()
// ---------------------------------------------------------------------------

describe("System.showSettings()", () => {
  it("System.showSettings(0) compiles without error", () => {
    expect(compilesOk("System.showSettings(0);")).toBe(true);
  });

  it("System.showSettings(0) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("System.showSettings(0);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "showSettings")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// System.capabilities.os
// ---------------------------------------------------------------------------

describe("System.capabilities.os", () => {
  it("System.capabilities.os compiles without error", () => {
    expect(compilesOk("System.capabilities.os;")).toBe(true);
  });

  it("System.capabilities.os emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.os;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "capabilities")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// System.capabilities.language
// ---------------------------------------------------------------------------

describe("System.capabilities.language", () => {
  it("System.capabilities.language compiles without error", () => {
    expect(compilesOk("System.capabilities.language;")).toBe(true);
  });

  it("System.capabilities.language emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.language;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "language")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// System.capabilities.version
// ---------------------------------------------------------------------------

describe("System.capabilities.version", () => {
  it("System.capabilities.version compiles without error", () => {
    expect(compilesOk("System.capabilities.version;")).toBe(true);
  });

  it("System.capabilities.version emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.version;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "version")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// System.capabilities.playerType
// ---------------------------------------------------------------------------

describe("System.capabilities.playerType", () => {
  it("System.capabilities.playerType compiles without error", () => {
    expect(compilesOk("System.capabilities.playerType;")).toBe(true);
  });

  it("System.capabilities.playerType emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.playerType;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "playerType")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// System.capabilities.screenResolutionX
// ---------------------------------------------------------------------------

describe("System.capabilities.screenResolutionX", () => {
  it("System.capabilities.screenResolutionX compiles without error", () => {
    expect(compilesOk("System.capabilities.screenResolutionX;")).toBe(true);
  });

  it("System.capabilities.screenResolutionX emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.screenResolutionX;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "screenResolutionX")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// System.capabilities.screenResolutionY
// ---------------------------------------------------------------------------

describe("System.capabilities.screenResolutionY", () => {
  it("System.capabilities.screenResolutionY compiles without error", () => {
    expect(compilesOk("System.capabilities.screenResolutionY;")).toBe(true);
  });

  it("System.capabilities.screenResolutionY emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.screenResolutionY;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "screenResolutionY")).toBe(true);
  });
});
