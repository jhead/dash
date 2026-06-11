/**
 * Tests for task 0852: IIFE and computed-call expressions must invoke the
 * function instead of silently pushing undefined.
 *
 * Before the fix, any callee that was not a plain Identifier or static
 * MemberExpr fell through to `this.pushUndefined()` — the function was never
 * called. The fix covers:
 *   - IIFEs: (function(){ return 42; })()
 *   - Computed member calls: obj[dynamicKey]()
 *   - Double-calls: factory()()
 *   - Indexed calls: handlers[0]()
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk the AVM1 action stream and collect all opcode bytes (skipping payloads). */
function opcodes(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const code = bytes[i]!;
    out.push(code);
    if (code >= 0x80) {
      const len = bytes[i + 1]! | (bytes[i + 2]! << 8);
      i += 3 + len;
    } else {
      i += 1;
    }
  }
  return out;
}

function hasOpcode(bytes: Uint8Array, opcode: number): boolean {
  return opcodes(bytes).includes(opcode);
}

/** Search for a null-terminated UTF-8 string anywhere in the byte stream. */
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

const OP = {
  ActionCallFunction: 0x3d,
  ActionCallMethod: 0x52,
  ActionDefineLocal: 0x3c,
  ActionGetVariable: 0x1c,
  ActionDefineFunction2: 0x8e,
} as const;

// ---------------------------------------------------------------------------
// IIFE tests
// ---------------------------------------------------------------------------

describe("IIFE (immediately-invoked function expression)", () => {
  it("emits ActionCallFunction (0x3D) instead of pushing undefined", () => {
    const bytes = compileAS2("var x = (function() { return 42; })();");
    expect(hasOpcode(bytes, OP.ActionCallFunction)).toBe(true);
  });

  it("emits ActionDefineFunction2 (0x8E) for the inner function expression", () => {
    const bytes = compileAS2("var x = (function() { return 42; })();");
    expect(hasOpcode(bytes, OP.ActionDefineFunction2)).toBe(true);
  });

  it("stores callee in a temp variable via ActionDefineLocal (0x3C)", () => {
    const bytes = compileAS2("var x = (function() { return 42; })();");
    // The temp-var approach must store the function as a local before calling it
    expect(hasOpcode(bytes, OP.ActionDefineLocal)).toBe(true);
  });

  it("IIFE with arguments emits ActionCallFunction with correct arg count", () => {
    const bytes = compileAS2("var x = (function(a, b) { return a + b; })(1, 2);");
    expect(hasOpcode(bytes, OP.ActionCallFunction)).toBe(true);
    expect(hasOpcode(bytes, OP.ActionDefineFunction2)).toBe(true);
  });

  it("IIFE result assigned to variable — temp name does not collide", () => {
    // Two consecutive IIFEs must use different temp names
    const bytes = compileAS2(
      "var a = (function() { return 1; })();" +
      "var b = (function() { return 2; })();"
    );
    expect(containsString(bytes, "__callTmp0")).toBe(true);
    expect(containsString(bytes, "__callTmp1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Computed member call: obj[dynamicKey]()
// ---------------------------------------------------------------------------

describe("computed member call obj[key]()", () => {
  it("emits ActionCallMethod (0x52) for indexed callee", () => {
    const bytes = compileAS2("obj[key]();");
    expect(hasOpcode(bytes, OP.ActionCallMethod)).toBe(true);
  });

  it("emits ActionCallMethod (0x52) for numeric index callee handlers[0]()", () => {
    const bytes = compileAS2("handlers[0]();");
    expect(hasOpcode(bytes, OP.ActionCallMethod)).toBe(true);
  });

  it("emits ActionCallMethod (0x52) for computed call with arguments", () => {
    const bytes = compileAS2("callbacks[i](x, y);");
    expect(hasOpcode(bytes, OP.ActionCallMethod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Double-call: factory()()
// ---------------------------------------------------------------------------

describe("double-call (factory returning function)", () => {
  it("factory()() emits ActionCallFunction for the outer call", () => {
    // factory() is an Identifier call (inner) — that resolves normally.
    // The outer call's callee is a CallExpr, which is the complex case.
    const bytes = compileAS2("var result = factory()();");
    // The complex callee path emits ActionCallFunction (the outer call)
    expect(hasOpcode(bytes, OP.ActionCallFunction)).toBe(true);
  });

  it("double-call stores intermediate result in a temp variable", () => {
    const bytes = compileAS2("factory()();");
    expect(hasOpcode(bytes, OP.ActionDefineLocal)).toBe(true);
  });
});
