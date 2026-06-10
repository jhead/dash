/**
 * Tests for AS2 System.capabilities class compilation.
 *
 * Verifies that System.capabilities property accesses and System method calls
 * compile without error and emit the correct AVM1 opcodes:
 *   - ActionGetMember  (0x4e): property reads
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

// ---------------------------------------------------------------------------
// 1. System.capabilities.os — compiles; emits ActionGetMember (0x4e)
// ---------------------------------------------------------------------------

describe("System.capabilities.os", () => {
  it("1. System.capabilities.os compiles without error", () => {
    expect(compilesOk("System.capabilities.os;")).toBe(true);
  });

  it("1. System.capabilities.os emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.os;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "capabilities")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. System.capabilities.playerType — compiles
// ---------------------------------------------------------------------------

describe("System.capabilities.playerType", () => {
  it("2. System.capabilities.playerType compiles without error", () => {
    expect(compilesOk("System.capabilities.playerType;")).toBe(true);
  });

  it("2. System.capabilities.playerType emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.playerType;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "playerType")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. System.capabilities.version — compiles
// ---------------------------------------------------------------------------

describe("System.capabilities.version", () => {
  it("3. System.capabilities.version compiles without error", () => {
    expect(compilesOk("System.capabilities.version;")).toBe(true);
  });

  it("3. System.capabilities.version emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.version;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "version")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. System.capabilities.screenResolutionX — compiles
// ---------------------------------------------------------------------------

describe("System.capabilities.screenResolutionX", () => {
  it("4. System.capabilities.screenResolutionX compiles without error", () => {
    expect(compilesOk("System.capabilities.screenResolutionX;")).toBe(true);
  });

  it("4. System.capabilities.screenResolutionX emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.screenResolutionX;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "screenResolutionX")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. System.capabilities.screenResolutionY — compiles
// ---------------------------------------------------------------------------

describe("System.capabilities.screenResolutionY", () => {
  it("5. System.capabilities.screenResolutionY compiles without error", () => {
    expect(compilesOk("System.capabilities.screenResolutionY;")).toBe(true);
  });

  it("5. System.capabilities.screenResolutionY emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.screenResolutionY;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "screenResolutionY")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. System.capabilities.hasAudio — compiles
// ---------------------------------------------------------------------------

describe("System.capabilities.hasAudio", () => {
  it("6. System.capabilities.hasAudio compiles without error", () => {
    expect(compilesOk("System.capabilities.hasAudio;")).toBe(true);
  });

  it("6. System.capabilities.hasAudio emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.hasAudio;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "hasAudio")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. System.capabilities.language — compiles
// ---------------------------------------------------------------------------

describe("System.capabilities.language", () => {
  it("7. System.capabilities.language compiles without error", () => {
    expect(compilesOk("System.capabilities.language;")).toBe(true);
  });

  it("7. System.capabilities.language emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("System.capabilities.language;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "language")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. System.setClipboard("text") — compiles (ActionCallMethod 0x52)
// ---------------------------------------------------------------------------

describe("System.setClipboard()", () => {
  it('8. System.setClipboard("text") compiles without error', () => {
    expect(compilesOk('System.setClipboard("text");')).toBe(true);
  });

  it('8. System.setClipboard("text") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('System.setClipboard("text");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setClipboard")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. System.showSettings(0) — compiles
// ---------------------------------------------------------------------------

describe("System.showSettings()", () => {
  it("9. System.showSettings(0) compiles without error", () => {
    expect(compilesOk("System.showSettings(0);")).toBe(true);
  });

  it("9. System.showSettings(0) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("System.showSettings(0);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "showSettings")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. var os = System.capabilities.os — compiles, "os" string in bytecode
// ---------------------------------------------------------------------------

describe("var os = System.capabilities.os", () => {
  it("10. var os = System.capabilities.os compiles without error", () => {
    expect(compilesOk("var os = System.capabilities.os;")).toBe(true);
  });

  it('10. var os = System.capabilities.os has "os" string in bytecode', () => {
    const bytes = compileAS2("var os = System.capabilities.os;");
    expect(containsString(bytes, "os")).toBe(true);
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });
});
