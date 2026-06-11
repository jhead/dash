/**
 * Tests for AS2 switch/case, try/catch/finally, and throw compilation.
 *
 * Verifies that these control-flow constructs compile to valid AVM1 bytecode
 * and produce correct byte patterns (opcodes, strings, structure).
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

/** Count occurrences of a byte value in the array. */
function countByte(bytes: Uint8Array, byte: number): number {
  let n = 0;
  for (const b of bytes) if (b === byte) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 switch/case", () => {
  // Test 1: switch with matching case executes body (structural: bytecode shape)
  it("1. switch with matching case produces discriminant push + equality checks", () => {
    const bytes = compileAS2(`
      var x = 2;
      switch (x) {
        case 1:
          var a = 10;
          break;
        case 2:
          var b = 20;
          break;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    // ActionDuplicate (0x4c) should appear — one per non-default case
    expect(countByte(bytes, 0x4c)).toBeGreaterThanOrEqual(2);

    // ActionStrictEquals (0x66) should appear — one per non-default case
    expect(countByte(bytes, 0x66)).toBeGreaterThanOrEqual(2);

    // ActionNot (0x12) should appear (at least one per case for skip logic)
    expect(countByte(bytes, 0x12)).toBeGreaterThanOrEqual(2);

    // ActionIf (0x9d) should appear for branching
    expect(bytes).toContain(0x9d);
  });

  // Test 2: switch with no match skips all case bodies
  it("2. switch with no matching case compiles without error", () => {
    expect(compilesOk(`
      switch (99) {
        case 1:
          var r = 1;
          break;
        case 2:
          var r = 2;
          break;
      }
    `)).toBe(true);
  });

  // Test 3: switch with default case
  it("3. switch with default case contains ActionPop before default body", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1:
          var a = 1;
          break;
        default:
          var b = 99;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    // "b" variable name should appear in the bytecode (default body compiled)
    expect(containsString(bytes, "b")).toBe(true);
    // ActionPop (0x17) used for discriminant cleanup
    expect(bytes).toContain(0x17);
  });

  // Test 4: break in switch emits ActionJump (0x99)
  it("4. break in switch emits ActionJump for exit", () => {
    const bytes = compileAS2(`
      switch (v) {
        case 1:
          var x = 1;
          break;
      }
    `);
    // ActionJump (0x99) must appear from the break statement
    expect(bytes).toContain(0x99);
  });

  // Test 5: fall-through (no break between cases) — both bodies are compiled
  it("5. fall-through: both case bodies appear in bytecode", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1:
          var first = 1;
        case 2:
          var second = 2;
      }
    `);
    expect(containsString(bytes, "first")).toBe(true);
    expect(containsString(bytes, "second")).toBe(true);
  });

  // Test 10: nested switch inside switch
  it("10. nested switch inside switch compiles without error", () => {
    expect(compilesOk(`
      switch (a) {
        case 1:
          switch (b) {
            case 10:
              var r = 10;
              break;
          }
          break;
        case 2:
          var r = 2;
          break;
      }
    `)).toBe(true);
  });

  // Test 11: switch with only a default case
  it("11. switch with only a default case compiles without error", () => {
    const bytes = compileAS2(`
      switch (x) {
        default:
          var fallback = 42;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // The "fallback" variable should be compiled
    expect(containsString(bytes, "fallback")).toBe(true);
    // ActionPop for discriminant cleanup
    expect(bytes).toContain(0x17);
  });
});

describe("AS2 throw", () => {
  // Test 6: throw compiles to a Uint8Array without error
  it("6. throw compiles without error and produces valid bytecode", () => {
    const bytes = compileAS2(`throw "oops";`);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // ActionThrow = 0x2a
    expect(bytes).toContain(0x2a);
  });

  it("6b. throw with expression compiles to bytecode with ActionThrow", () => {
    const bytes = compileAS2(`
      var e = new Error("bad");
      throw e;
    `);
    expect(bytes).toContain(0x2a); // ActionThrow
  });
});

describe("AS2 try/catch/finally", () => {
  // Test 7: try/catch compiles without error
  it("7. try/catch compiles to valid bytecode", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } catch (e) {
        var y = 2;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // ActionTry opcode = 0x8f
    expect(bytes).toContain(0x8f);
    // catch param name "e" should appear as a null-terminated string
    expect(containsString(bytes, "e")).toBe(true);
  });

  // Test 8: try/finally compiles without error
  it("8. try/finally compiles to valid bytecode", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } finally {
        var z = 3;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // ActionTry opcode = 0x8f
    expect(bytes).toContain(0x8f);
  });

  // Test 9: try/catch/finally compiles without error
  it("9. try/catch/finally compiles to valid bytecode", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } catch (err) {
        var y = 2;
      } finally {
        var z = 3;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // ActionTry opcode = 0x8f
    expect(bytes).toContain(0x8f);
    // catch param "err" in bytecode
    expect(containsString(bytes, "err")).toBe(true);
  });

  it("9b. ActionTry record has correct flags for try/catch/finally", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } catch (myErr) {
        trace(myErr);
      } finally {
        var cleanup = true;
      }
    `);

    // Find the 0x8f opcode position
    const tryPos = bytes.indexOf(0x8f);
    expect(tryPos).toBeGreaterThanOrEqual(0);

    // Record: opcode(1) + length(2) + flags(1) ...
    // flags should be 0x03 (HasCatch=1, HasFinally=1, CatchInRegister=0)
    const flagsByte = bytes[tryPos + 3];
    expect(flagsByte).toBe(0x03);

    // The catch name "myErr" should follow the flags byte
    expect(containsString(bytes, "myErr")).toBe(true);
  });

  it("9c. ActionTry record has correct flags for try/catch only", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } catch (ex) {
        var y = 2;
      }
    `);

    const tryPos = bytes.indexOf(0x8f);
    expect(tryPos).toBeGreaterThanOrEqual(0);

    // flags should be 0x01 (HasCatch=1, HasFinally=0)
    const flagsByte = bytes[tryPos + 3];
    expect(flagsByte).toBe(0x01);
  });

  it("9d. ActionTry record has correct flags for try/finally only", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } finally {
        var z = 2;
      }
    `);

    const tryPos = bytes.indexOf(0x8f);
    expect(tryPos).toBeGreaterThanOrEqual(0);

    // flags should be 0x02 (HasCatch=0, HasFinally=1)
    const flagsByte = bytes[tryPos + 3];
    expect(flagsByte).toBe(0x02);
  });
});

describe("AS2 parser produces correct AST for switch/throw/try", () => {
  it("parser produces SwitchStmt with correct shape", () => {
    const ast = parse(`
      switch (x) {
        case 1:
          var a = 1;
          break;
        default:
          var b = 0;
      }
    `);
    expect(ast.body.length).toBe(1);
    const stmt = ast.body[0]!;
    expect(stmt.type).toBe("SwitchStmt");
    if (stmt.type === "SwitchStmt") {
      expect(stmt.cases.length).toBe(2);
      expect(stmt.cases[0]!.test).not.toBeNull();
      expect(stmt.cases[1]!.test).toBeNull(); // default
    }
  });

  it("parser produces ThrowStmt with correct shape", () => {
    const ast = parse(`throw new Error("oops");`);
    expect(ast.body.length).toBe(1);
    const stmt = ast.body[0]!;
    expect(stmt.type).toBe("ThrowStmt");
  });

  it("parser produces TryStmt with correct shape", () => {
    const ast = parse(`
      try {
        var x = 1;
      } catch (e) {
        var y = 2;
      } finally {
        var z = 3;
      }
    `);
    expect(ast.body.length).toBe(1);
    const stmt = ast.body[0]!;
    expect(stmt.type).toBe("TryStmt");
    if (stmt.type === "TryStmt") {
      expect(stmt.catchClause).not.toBeNull();
      expect(stmt.finallyBlock).not.toBeNull();
      expect(stmt.catchClause?.param).toBe("e");
    }
  });
});
