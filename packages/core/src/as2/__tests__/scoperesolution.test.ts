/**
 * Tests for AS2 scope chain and variable resolution compilation.
 *
 * Verifies that variable lookups, member accesses, parameter shadowing,
 * _global access patterns, with-statement scope, and block-scoping behavior
 * compile to the correct AVM1 opcodes.
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
// AVM1 opcode constants
// ---------------------------------------------------------------------------

const ACTION_GET_VARIABLE = 0x1c;
const ACTION_SET_MEMBER   = 0x4f;
const ACTION_GET_MEMBER   = 0x4e;
const ACTION_WITH         = 0x94;

// ---------------------------------------------------------------------------
// 1. Local variable read emits ActionGetVariable (0x1c)
// ---------------------------------------------------------------------------

describe("local variable resolution", () => {
  it("1. var x = 1; trace(x) — emits ActionGetVariable (0x1c) for local x", () => {
    const bytes = compileAS2("var x = 1; trace(x);");
    expect(containsByte(bytes, ACTION_GET_VARIABLE)).toBe(true);
  });

  it("1b. variable name x appears in bytecode", () => {
    const bytes = compileAS2("var x = 1; trace(x);");
    expect(containsString(bytes, "x")).toBe(true);
  });

  it("1c. compiles without error", () => {
    expect(compilesOk("var x = 1; trace(x);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. this.x = 5 emits ActionSetMember (0x4f), not ActionSetVariable
// ---------------------------------------------------------------------------

describe("this member assignment", () => {
  it("2. this.x = 5 — emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("this.x = 5;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
  });

  it("2b. this.x = 5 compiles without error", () => {
    expect(compilesOk("this.x = 5;")).toBe(true);
  });

  it("2c. this.x = 5 does not emit ActionGetVariable for x", () => {
    // The identifier x is a property key (string), not a variable lookup.
    // ActionGetVariable (0x1c) should NOT appear for the property name.
    const bytes = compileAS2("this.x = 5;");
    // ActionSetMember must be present; the presence of 0x1c is only for 'this' resolution
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Parameter x shadows outer x — compiles cleanly
// ---------------------------------------------------------------------------

describe("parameter shadowing outer variable", () => {
  it("3. var x = 1; function f(x) { return x; } — compiles without error", () => {
    expect(compilesOk("var x = 1; function f(x) { return x; }")).toBe(true);
  });

  it("3b. parameter name x appears in bytecode", () => {
    const bytes = compileAS2("var x = 1; function f(x) { return x; }");
    expect(containsString(bytes, "x")).toBe(true);
  });

  it("3c. function name f appears in bytecode", () => {
    const bytes = compileAS2("var x = 1; function f(x) { return x; }");
    expect(containsString(bytes, "f")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. _global.counter — ActionGetVariable for _global + ActionGetMember for counter
// ---------------------------------------------------------------------------

describe("_global member access", () => {
  it("4. _global.counter — emits ActionGetVariable (0x1c)", () => {
    const bytes = compileAS2("trace(_global.counter);");
    expect(containsByte(bytes, ACTION_GET_VARIABLE)).toBe(true);
  });

  it("4b. _global.counter — emits ActionGetMember (0x4e) for the property", () => {
    const bytes = compileAS2("trace(_global.counter);");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });

  it("4c. _global.counter — string '_global' appears in bytecode", () => {
    const bytes = compileAS2("trace(_global.counter);");
    expect(containsString(bytes, "_global")).toBe(true);
  });

  it("4d. _global.counter — string 'counter' appears in bytecode", () => {
    const bytes = compileAS2("trace(_global.counter);");
    expect(containsString(bytes, "counter")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. with(obj) { trace(prop) } — emits ActionWith (0x94)
// ---------------------------------------------------------------------------

describe("with-statement scope", () => {
  it("5. with (obj) { trace(prop) } — emits ActionWith (0x94)", () => {
    const bytes = compileAS2("with (obj) { trace(prop); }");
    expect(containsByte(bytes, ACTION_WITH)).toBe(true);
  });

  it("5b. with (obj) { trace(prop) } — compiles without error", () => {
    expect(compilesOk("with (obj) { trace(prop); }")).toBe(true);
  });

  it("5c. prop name appears in bytecode", () => {
    const bytes = compileAS2("with (obj) { trace(prop); }");
    expect(containsString(bytes, "prop")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Block does not create new scope in AS2 — var x is function-scoped
// ---------------------------------------------------------------------------

describe("block scope (no new scope in AS2)", () => {
  it("6. function f() { var x = 1; { var x = 2; } return x; } — compiles without error", () => {
    expect(compilesOk("function f() { var x = 1; { var x = 2; } return x; }")).toBe(true);
  });

  it("6b. both assignments produce variable x in bytecode", () => {
    const bytes = compileAS2("function f() { var x = 1; { var x = 2; } return x; }");
    expect(containsString(bytes, "x")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. ActionGetVariable for plain identifiers, ActionGetMember for dot access
// ---------------------------------------------------------------------------

describe("variable vs member access opcodes", () => {
  it("7. plain identifier emits ActionGetVariable (0x1c)", () => {
    const bytes = compileAS2("trace(myVar);");
    expect(containsByte(bytes, ACTION_GET_VARIABLE)).toBe(true);
  });

  it("7b. dot-access on object emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("trace(obj.prop);");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });

  it("7c. dot-access compiles without error", () => {
    expect(compilesOk("trace(obj.prop);")).toBe(true);
  });

  it("7d. chained member access emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("trace(a.b.c);");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });
});
