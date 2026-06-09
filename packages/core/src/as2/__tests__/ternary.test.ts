/**
 * Tests for AS2 ternary operator (? :) compilation.
 *
 * Verifies that the conditional (ternary) expression compiles to AVM1 bytecode
 * using ActionIf (0x9D) and ActionJump (0x99) for branching.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";
import { parse } from "../parser.js";

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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
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
// Ternary operator tests
// ---------------------------------------------------------------------------

describe("AS2 ternary operator (? :)", () => {
  // Test 1: basic ternary compiles and emits branching opcodes
  it("1. x > 0 ? 'positive' : 'negative' compiles and contains ActionIf or ActionJump", () => {
    const bytes = compileAS2(`x > 0 ? "positive" : "negative";`);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // Ternary uses ActionIf (0x9D) and/or ActionJump (0x99)
    const hasIf   = Array.from(bytes).includes(0x9d);
    const hasJump = Array.from(bytes).includes(0x99);
    expect(hasIf || hasJump).toBe(true);
    // Both branch strings should be embedded
    expect(containsString(bytes, "positive")).toBe(true);
    expect(containsString(bytes, "negative")).toBe(true);
  });

  // Test 2: nested ternary compiles without error
  it("2. nested ternary a ? (b ? 1 : 2) : 3 compiles without error", () => {
    expect(compilesOk(`var r = a ? (b ? 1 : 2) : 3;`)).toBe(true);
  });

  // Test 3: ternary in variable assignment compiles without error
  it("3. ternary in variable assignment compiles without error", () => {
    expect(compilesOk(`var x = flag ? trueVal : falseVal;`)).toBe(true);
  });

  // Test 4: ternary with function calls on both branches compiles
  it("4. ternary with function calls: cond ? fn1() : fn2() compiles", () => {
    expect(compilesOk(`cond ? fn1() : fn2();`)).toBe(true);
  });

  // Test 5: ternary in function argument compiles
  it("5. ternary in function argument: trace(x > 0 ? 'pos' : 'neg') compiles", () => {
    const bytes = compileAS2(`trace(x > 0 ? "pos" : "neg");`);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    expect(containsString(bytes, "pos")).toBe(true);
    expect(containsString(bytes, "neg")).toBe(true);
  });

  // Test 6: chained ternary compiles without error
  it("6. chained ternary a ? b : c ? d : e compiles without error", () => {
    expect(compilesOk(`var r = a ? b : c ? d : e;`)).toBe(true);
  });

  // Test 7: true branch value is emitted separately from false branch value
  it("7. true and false branches both emit their respective string values", () => {
    const bytes = compileAS2(`var result = cond ? "trueBranch" : "falseBranch";`);
    expect(containsString(bytes, "trueBranch")).toBe(true);
    expect(containsString(bytes, "falseBranch")).toBe(true);
  });

  // Test 8: ternary emits ActionIf (0x9D) for conditional branching
  it("8. ternary emits ActionIf opcode (0x9D)", () => {
    const bytes = compileAS2(`var r = x ? 1 : 2;`);
    expect(Array.from(bytes)).toContain(0x9d);
  });

  // Test 9: ternary emits ActionJump (0x99) to skip alternate branch
  it("9. ternary emits ActionJump opcode (0x99) to skip alternate", () => {
    const bytes = compileAS2(`var r = x ? 1 : 2;`);
    expect(Array.from(bytes)).toContain(0x99);
  });

  // Test 10: parser produces TernaryExpr AST node
  it("10. parser produces TernaryExpr node with test, consequent, and alternate", () => {
    const ast = parse(`x > 0 ? "yes" : "no";`);
    expect(ast.body.length).toBe(1);
    const stmt = ast.body[0]!;
    // Expression statement wraps the ternary
    expect(stmt.type).toBe("ExprStmt");
    if (stmt.type === "ExprStmt") {
      const expr = stmt.expression;
      expect(expr.type).toBe("TernaryExpr");
      if (expr.type === "TernaryExpr") {
        expect(expr.test).toBeDefined();
        expect(expr.consequent).toBeDefined();
        expect(expr.alternate).toBeDefined();
      }
    }
  });
});
