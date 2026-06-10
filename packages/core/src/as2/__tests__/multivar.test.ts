/**
 * Tests for multi-variable `var` declarations.
 *
 *   var x = 1, y = 2;
 *
 * Should compile to the same bytecode as two separate var declarations.
 *
 * Relevant AVM1 opcodes:
 *   ActionDefineLocal  0x3c  — define local variable with initializer
 *   ActionDefineLocal2 0x41  — define local variable, assign undefined
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";
import { parse } from "../parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsByte(bytes: Uint8Array, byte: number): boolean {
  return bytes.includes(byte);
}

function countByte(bytes: Uint8Array, byte: number): number {
  let n = 0;
  for (const b of bytes) if (b === byte) n++;
  return n;
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
// Parser tests
// ---------------------------------------------------------------------------

describe("multi-var declaration — parser", () => {
  it("parses var x = 1, y = 2 without error", () => {
    expect(() => parse("var x = 1, y = 2;")).not.toThrow();
  });

  it("parses var a, b, c without error", () => {
    expect(() => parse("var a, b, c;")).not.toThrow();
  });

  it("parses var x = _xmouse, y = _ymouse without error", () => {
    expect(() => parse("var x = _xmouse, y = _ymouse;")).not.toThrow();
  });

  it("multi-declarator var produces two VarDecl nodes", () => {
    const program = parse("var x = 1, y = 2;");
    expect(program.body.length).toBe(1);
    const stmt = program.body[0]!;
    // parseVarDeclList returns a Block wrapping two VarDecl nodes
    expect(stmt.type).toBe("Block");
    if (stmt.type === "Block") {
      expect(stmt.body.length).toBe(2);
      expect(stmt.body[0]!.type).toBe("VarDecl");
      expect(stmt.body[1]!.type).toBe("VarDecl");
    }
  });

  it("single-declarator var produces a plain VarDecl (no wrapping Block)", () => {
    const program = parse("var x = 1;");
    expect(program.body.length).toBe(1);
    expect(program.body[0]!.type).toBe("VarDecl");
  });

  it("three-declarator var produces three VarDecl nodes", () => {
    const program = parse("var a, b, c;");
    const stmt = program.body[0]!;
    expect(stmt.type).toBe("Block");
    if (stmt.type === "Block") {
      expect(stmt.body.length).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Compiler tests
// ---------------------------------------------------------------------------

describe("multi-var declaration — compiler", () => {
  it("compiles var x = 1, y = 2 without error", () => {
    expect(() => compileAS2("var x = 1, y = 2;")).not.toThrow();
  });

  it("compiles var a, b, c without error", () => {
    expect(() => compileAS2("var a, b, c;")).not.toThrow();
  });

  it("var x = 1, y = 2 emits ActionDefineLocal (0x3c) twice", () => {
    const bytes = compileAS2("var x = 1, y = 2;");
    expect(countByte(bytes, 0x3c)).toBe(2);
  });

  it("var a, b, c emits ActionDefineLocal2 (0x41) three times", () => {
    const bytes = compileAS2("var a, b, c;");
    expect(countByte(bytes, 0x41)).toBe(3);
  });

  it("var x = 1, y = 2 includes both variable names as strings", () => {
    const bytes = compileAS2("var x = 1, y = 2;");
    expect(containsString(bytes, "x")).toBe(true);
    expect(containsString(bytes, "y")).toBe(true);
  });

  it("var a, b, c includes all three variable names as strings", () => {
    const bytes = compileAS2("var a, b, c;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
    expect(containsString(bytes, "c")).toBe(true);
  });

  it("var x = 1, y = 2 compiles identically to two separate var statements", () => {
    const combined = compileAS2("var x = 1, y = 2;");
    const separate = compileAS2("var x = 1; var y = 2;");
    expect(combined).toEqual(separate);
  });

  it("var x = _xmouse, y = _ymouse compiles without error", () => {
    expect(() => compileAS2("var x = _xmouse, y = _ymouse;")).not.toThrow();
  });

  it("var with type annotation multi-decl compiles: var x:Number = 1, y:Number = 2", () => {
    expect(() => compileAS2("var x:Number = 1, y:Number = 2;")).not.toThrow();
  });
});
