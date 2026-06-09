/**
 * Tests for AS2 compiler: ExternalInterface static property and method calls.
 *
 * Verifies that ExternalInterface static property accesses and method calls
 * compile without error and emit the correct AVM1 opcodes:
 *   - ActionGetMember  (0x4f): property reads (ExternalInterface.available)
 *   - ActionCallMethod (0x52): method calls (ExternalInterface.call(), ExternalInterface.addCallback())
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
// ExternalInterface.available property
// ---------------------------------------------------------------------------

describe("ExternalInterface available property", () => {
  it("ExternalInterface.available compiles without error", () => {
    expect(compilesOk("ExternalInterface.available;")).toBe(true);
  });

  it("ExternalInterface.available emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("ExternalInterface.available;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "available")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExternalInterface.call() with one argument
// ---------------------------------------------------------------------------

describe("ExternalInterface call() with one argument", () => {
  it('ExternalInterface.call("myFunction", arg1) compiles without error', () => {
    expect(
      compilesOk('var arg1 = 1; ExternalInterface.call("myFunction", arg1);')
    ).toBe(true);
  });

  it('ExternalInterface.call("myFunction", arg1) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var arg1 = 1; ExternalInterface.call("myFunction", arg1);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "call")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExternalInterface.call() with two arguments
// ---------------------------------------------------------------------------

describe("ExternalInterface call() with two arguments", () => {
  it('ExternalInterface.call("myFunction", arg1, arg2) compiles without error', () => {
    expect(
      compilesOk(
        'var arg1 = 1; var arg2 = 2; ExternalInterface.call("myFunction", arg1, arg2);'
      )
    ).toBe(true);
  });

  it('ExternalInterface.call("myFunction", arg1, arg2) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var arg1 = 1; var arg2 = 2; ExternalInterface.call("myFunction", arg1, arg2);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "call")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExternalInterface.addCallback()
// ---------------------------------------------------------------------------

describe("ExternalInterface addCallback()", () => {
  it('ExternalInterface.addCallback("methodName", this, method) compiles without error', () => {
    expect(
      compilesOk(
        'var method = function() {}; ExternalInterface.addCallback("methodName", this, method);'
      )
    ).toBe(true);
  });

  it('ExternalInterface.addCallback("methodName", this, method) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var method = function() {}; ExternalInterface.addCallback("methodName", this, method);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "addCallback")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExternalInterface.objectID property
// ---------------------------------------------------------------------------

describe("ExternalInterface objectID property", () => {
  it("ExternalInterface.objectID compiles without error", () => {
    expect(compilesOk("var id = ExternalInterface.objectID;")).toBe(true);
  });

  it("ExternalInterface.objectID emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var id = ExternalInterface.objectID;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "objectID")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExternalInterface.call() with return value
// ---------------------------------------------------------------------------

describe("ExternalInterface call() return value", () => {
  it("ExternalInterface.call() return value compiles without error", () => {
    expect(
      compilesOk('var result = ExternalInterface.call("getPlayerName"); trace(result);')
    ).toBe(true);
  });

  it("ExternalInterface.call() return value emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('var result = ExternalInterface.call("getPlayerName"); trace(result);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "call")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fscommand() global function
// ---------------------------------------------------------------------------

describe("fscommand() global function", () => {
  it('fscommand("quit") compiles without error', () => {
    expect(compilesOk('fscommand("quit");')).toBe(true);
  });

  it('fscommand("fullscreen", "true") compiles without error', () => {
    expect(compilesOk('fscommand("fullscreen", "true");')).toBe(true);
  });

  it('fscommand("exec", "myScript.exe") compiles without error', () => {
    expect(compilesOk('fscommand("exec", "myScript.exe");')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// System.security
// ---------------------------------------------------------------------------

describe("System.security domain methods", () => {
  it('System.security.allowDomain("*") compiles without error', () => {
    expect(compilesOk('System.security.allowDomain("*");')).toBe(true);
  });

  it('System.security.allowInsecureDomain("*") compiles without error', () => {
    expect(compilesOk('System.security.allowInsecureDomain("*");')).toBe(true);
  });

  it("System.security.allowDomain emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('System.security.allowDomain("*");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "allowDomain")).toBe(true);
  });
});
