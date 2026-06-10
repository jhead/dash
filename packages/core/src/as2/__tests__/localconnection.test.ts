/**
 * Tests for AS2 compiler: LocalConnection object construction, method calls,
 * and property accesses.
 *
 * Verifies that LocalConnection constructor calls, instance method calls, and
 * domain-related API calls compile without error and emit the correct AVM1
 * opcodes:
 *   - ActionNew        (0x40): constructor calls (new LocalConnection())
 *   - ActionCallMethod (0x52): method calls (lc.connect(), lc.send(), etc.)
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

// ---------------------------------------------------------------------------
// LocalConnection constructor
// ---------------------------------------------------------------------------

describe("LocalConnection constructor", () => {
  it("new LocalConnection() compiles without error", () => {
    expect(compilesOk("new LocalConnection();")).toBe(true);
  });

  it("new LocalConnection() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("new LocalConnection();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "LocalConnection")).toBe(true);
  });

  it("var lc = new LocalConnection() compiles without error", () => {
    expect(compilesOk("var lc = new LocalConnection();")).toBe(true);
  });

  it("var lc = new LocalConnection() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("var lc = new LocalConnection();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "LocalConnection")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lc.connect()
// ---------------------------------------------------------------------------

describe("LocalConnection connect()", () => {
  it('lc.connect("myConnection") compiles without error', () => {
    expect(
      compilesOk('var lc = new LocalConnection(); lc.connect("myConnection");')
    ).toBe(true);
  });

  it('lc.connect("myConnection") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var lc = new LocalConnection(); lc.connect("myConnection");'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "connect")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lc.send()
// ---------------------------------------------------------------------------

describe("LocalConnection send()", () => {
  it('lc.send("otherConn", "methodName", arg1) compiles without error', () => {
    expect(
      compilesOk(
        'var lc = new LocalConnection(); var arg1 = 1; lc.send("otherConn", "methodName", arg1);'
      )
    ).toBe(true);
  });

  it('lc.send("otherConn", "methodName", arg1) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var lc = new LocalConnection(); var arg1 = 1; lc.send("otherConn", "methodName", arg1);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "send")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lc.close()
// ---------------------------------------------------------------------------

describe("LocalConnection close()", () => {
  it("lc.close() compiles without error", () => {
    expect(
      compilesOk("var lc = new LocalConnection(); lc.close();")
    ).toBe(true);
  });

  it("lc.close() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var lc = new LocalConnection(); lc.close();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "close")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lc.domain()
// ---------------------------------------------------------------------------

describe("LocalConnection domain()", () => {
  it("lc.domain() compiles without error", () => {
    expect(
      compilesOk("var lc = new LocalConnection(); lc.domain();")
    ).toBe(true);
  });

  it("lc.domain() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var lc = new LocalConnection(); lc.domain();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "domain")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lc.allowDomain()
// ---------------------------------------------------------------------------

describe("LocalConnection allowDomain()", () => {
  it('lc.allowDomain("*") compiles without error', () => {
    expect(
      compilesOk('var lc = new LocalConnection(); lc.allowDomain("*");')
    ).toBe(true);
  });

  it('lc.allowDomain("*") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var lc = new LocalConnection(); lc.allowDomain("*");'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "allowDomain")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lc.allowInsecureDomain()
// ---------------------------------------------------------------------------

describe("LocalConnection allowInsecureDomain()", () => {
  it('lc.allowInsecureDomain("*") compiles without error', () => {
    expect(
      compilesOk('var lc = new LocalConnection(); lc.allowInsecureDomain("*");')
    ).toBe(true);
  });

  it('lc.allowInsecureDomain("*") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var lc = new LocalConnection(); lc.allowInsecureDomain("*");'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "allowInsecureDomain")).toBe(true);
  });
});
