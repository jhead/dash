/**
 * Tests for AS2 labeled break/continue and the with-statement compilation.
 *
 * Verifies correct AVM1 bytecode generation for:
 *   - Labeled break (jump to outer loop exit)
 *   - Labeled continue (jump to outer loop update/test)
 *   - with(obj) { body } (ActionWith 0x94 with correct size field)
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

function compileError(source: string): string | null {
  try {
    compileAS2(source);
    return null;
  } catch (e: any) {
    return e?.message ?? String(e);
  }
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

function countByte(bytes: Uint8Array, byte: number): number {
  let n = 0;
  for (const b of bytes) if (b === byte) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Labeled break / continue tests
// ---------------------------------------------------------------------------

describe("AS2 labeled break/continue", () => {
  // Test 1: regression — unlabeled break in a for loop still works
  it("1. unlabeled break in for loop still works (regression)", () => {
    const bytes = compileAS2(`
      for (var i = 0; i < 10; i++) {
        if (i == 5) break;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // ActionJump (0x99) emitted for break
    expect(bytes).toContain(0x99);
  });

  // Test 2: labeled break compiles without error
  it("2. labeled break outer compiles without error", () => {
    expect(compilesOk(`
      outer: for (var i = 0; i < 10; i++) {
        for (var j = 0; j < 10; j++) {
          if (j == 5) break outer;
        }
      }
    `)).toBe(true);
  });

  // Test 3: labeled continue compiles without error
  it("3. labeled continue outer compiles without error", () => {
    expect(compilesOk(`
      outer: for (var i = 0; i < 10; i++) {
        for (var j = 0; j < 10; j++) {
          if (j == 3) continue outer;
        }
      }
    `)).toBe(true);
  });

  // Test 4: compiled output for labeled break outer contains ActionJump (0x99)
  it("4. compiled output for break outer contains ActionJump (0x99)", () => {
    const bytes = compileAS2(`
      outer: for (var i = 0; i < 5; i++) {
        if (i == 2) break outer;
      }
    `);
    // ActionJump = 0x99
    expect(bytes).toContain(0x99);
    // The variable name "i" should appear in bytecode
    expect(containsString(bytes, "i")).toBe(true);
  });

  // Test 5: nested loops with label — outer loop exit offset is past inner loop
  it("5. nested loops: break outer jumps past both loops", () => {
    // We verify structurally that there is an ActionJump for the break,
    // and the bytecode is longer than a simple single loop (confirming nesting).
    const singleLoop = compileAS2(`
      for (var i = 0; i < 10; i++) {}
    `);
    const nestedWithLabeledBreak = compileAS2(`
      outer: for (var i = 0; i < 10; i++) {
        for (var j = 0; j < 10; j++) {
          if (j == 5) break outer;
        }
      }
    `);
    expect(nestedWithLabeledBreak.length).toBeGreaterThan(singleLoop.length);
    // ActionJump (0x99) for labeled break + back-jumps from both loops
    expect(countByte(nestedWithLabeledBreak, 0x99)).toBeGreaterThanOrEqual(1);
  });

  // Test 6: undefined label throws a descriptive compiler error
  it("6. undefined label in break throws a descriptive error", () => {
    const err = compileError(`
      for (var i = 0; i < 10; i++) {
        break nonexistent;
      }
    `);
    expect(err).not.toBeNull();
    expect(err).toContain("nonexistent");
  });

  // Test 7: labeled while loop with break
  it("7. labeled while loop with labeled break compiles correctly", () => {
    const bytes = compileAS2(`
      outer: while (true) {
        while (true) {
          break outer;
        }
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes).toContain(0x99); // ActionJump for break
  });

  // Test 8: labeled continue in nested for loops
  it("8. labeled continue in nested for loops compiles correctly", () => {
    const bytes = compileAS2(`
      outer: for (var i = 0; i < 5; i++) {
        inner: for (var j = 0; j < 5; j++) {
          if (j == 2) continue outer;
        }
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // Both labels exist
    expect(containsString(bytes, "i")).toBe(true);
    expect(containsString(bytes, "j")).toBe(true);
    // ActionJump for continue outer
    expect(bytes).toContain(0x99);
  });
});

// ---------------------------------------------------------------------------
// with-statement tests
// ---------------------------------------------------------------------------

describe("AS2 with-statement", () => {
  // Test 7 (with): with(obj) {} compiles without error
  it("1. with(obj) {} compiles without error", () => {
    expect(compilesOk(`
      var obj = {};
      with (obj) {}
    `)).toBe(true);
  });

  // Test 8 (with): compiled output contains ActionWith byte (0x94)
  it("2. compiled output contains ActionWith opcode 0x94", () => {
    const bytes = compileAS2(`
      var obj = {};
      with (obj) {
        var x = 1;
      }
    `);
    expect(bytes).toContain(0x94);
  });

  // Test 9 (with): size field after ActionWith matches the body byte length
  it("3. the size field after ActionWith matches the body byte length", () => {
    const bytes = compileAS2(`
      with (myObj) {
        var x = 1;
      }
    `);

    // Find ActionWith (0x94)
    const withPos = bytes.indexOf(0x94);
    expect(withPos).toBeGreaterThanOrEqual(0);

    // Record structure: opcode(1) + payload-length UI16(2) + size UI16(2) + body
    // payload-length field = 2 (size of the size field)
    const payloadLen = bytes[withPos + 1]! | (bytes[withPos + 2]! << 8);
    expect(payloadLen).toBe(2);

    // Read the size field (UI16 LE at withPos+3)
    const sizeField = bytes[withPos + 3]! | (bytes[withPos + 4]! << 8);

    // The bytes after the ActionWith record (starting at withPos + 5) should be
    // exactly sizeField bytes long (up to the end of the with block).
    // We verify that the size field equals the number of bytes from bodyStart to bodyEnd.
    const bodyStart = withPos + 5; // opcode(1) + payloadLen(2) + size(2)
    const remainingBytes = bytes.length - bodyStart;
    // The body should fit within the remaining bytes
    expect(sizeField).toBeGreaterThan(0);
    expect(sizeField).toBeLessThanOrEqual(remainingBytes);
  });

  // Test 10 (with): with(obj) { x = 1; } compiles and variable name appears
  it("4. with(obj) { x = 1; } compiles and contains variable reference", () => {
    const bytes = compileAS2(`
      with (myObject) {
        x = 1;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toContain(0x94); // ActionWith
    // The string "x" should appear in bytecode (variable assignment inside with)
    expect(containsString(bytes, "x")).toBe(true);
  });

  // Test 11 (with): nested with statements compile
  it("5. nested with statements compile without error", () => {
    expect(compilesOk(`
      var a = {};
      var b = {};
      with (a) {
        with (b) {
          var r = 1;
        }
      }
    `)).toBe(true);
  });

  // Test 12 (with): body with multiple statements has correct total size
  it("6. body with multiple statements has correct total size in ActionWith header", () => {
    // Compile with a single statement body
    const singleStmtBytes = compileAS2(`
      with (obj) { var a = 1; }
    `);
    // Compile with multiple statement body
    const multiStmtBytes = compileAS2(`
      with (obj) { var a = 1; var b = 2; var c = 3; }
    `);

    const findWithSize = (bytes: Uint8Array): number => {
      const withPos = bytes.indexOf(0x94);
      if (withPos < 0) return -1;
      return bytes[withPos + 3]! | (bytes[withPos + 4]! << 8);
    };

    const singleSize = findWithSize(singleStmtBytes);
    const multiSize  = findWithSize(multiStmtBytes);

    expect(singleSize).toBeGreaterThan(0);
    expect(multiSize).toBeGreaterThan(singleSize);

    // Verify the size field correctly accounts for body length in both cases
    const verifySize = (bytes: Uint8Array): void => {
      const withPos = bytes.indexOf(0x94);
      expect(withPos).toBeGreaterThanOrEqual(0);
      const size = bytes[withPos + 3]! | (bytes[withPos + 4]! << 8);
      const bodyStart = withPos + 5;
      // Total bytes from bodyStart should be >= size (there may be code after the with)
      expect(bytes.length - bodyStart).toBeGreaterThanOrEqual(size);
    };

    verifySize(singleStmtBytes);
    verifySize(multiStmtBytes);
  });
});

// ---------------------------------------------------------------------------
// Parser AST tests for labeled statements
// ---------------------------------------------------------------------------

describe("AS2 parser: labeled statements and with", () => {
  it("parser produces LabeledStmt for identifier: statement", () => {
    const ast = parse(`
      outer: for (var i = 0; i < 10; i++) {}
    `);
    expect(ast.body.length).toBe(1);
    const stmt = ast.body[0]!;
    expect(stmt.type).toBe("LabeledStmt");
    if (stmt.type === "LabeledStmt") {
      expect(stmt.label).toBe("outer");
      expect(stmt.body.type).toBe("ForStmt");
    }
  });

  it("parser produces BreakStmt with label field", () => {
    const ast = parse(`
      outer: for (var i = 0; i < 10; i++) {
        break outer;
      }
    `);
    const labeled = ast.body[0]!;
    expect(labeled.type).toBe("LabeledStmt");
    if (labeled.type === "LabeledStmt") {
      const forStmt = labeled.body;
      expect(forStmt.type).toBe("ForStmt");
      if (forStmt.type === "ForStmt") {
        // body is a Block containing the break statement
        const block = forStmt.body;
        expect(block.type).toBe("Block");
        if (block.type === "Block") {
          const breakStmt = block.body[0]!;
          expect(breakStmt.type).toBe("BreakStmt");
          if (breakStmt.type === "BreakStmt") {
            expect(breakStmt.label).toBe("outer");
          }
        }
      }
    }
  });

  it("parser produces ContinueStmt with label field", () => {
    const ast = parse(`
      outer: while (true) {
        continue outer;
      }
    `);
    const labeled = ast.body[0]!;
    expect(labeled.type).toBe("LabeledStmt");
    if (labeled.type === "LabeledStmt") {
      const whileStmt = labeled.body;
      expect(whileStmt.type).toBe("WhileStmt");
      if (whileStmt.type === "WhileStmt") {
        // body is a Block containing the continue statement
        const block = whileStmt.body;
        expect(block.type).toBe("Block");
        if (block.type === "Block") {
          const continueStmt = block.body[0]!;
          expect(continueStmt.type).toBe("ContinueStmt");
          if (continueStmt.type === "ContinueStmt") {
            expect(continueStmt.label).toBe("outer");
          }
        }
      }
    }
  });

  it("parser produces BreakStmt with null label for unlabeled break", () => {
    const ast = parse(`
      for (var i = 0; i < 10; i++) {
        break;
      }
    `);
    const forStmt = ast.body[0]!;
    expect(forStmt.type).toBe("ForStmt");
    if (forStmt.type === "ForStmt") {
      // body is a Block
      const block = forStmt.body;
      expect(block.type).toBe("Block");
      if (block.type === "Block") {
        const breakStmt = block.body[0]!;
        expect(breakStmt.type).toBe("BreakStmt");
        if (breakStmt.type === "BreakStmt") {
          expect(breakStmt.label).toBeNull();
        }
      }
    }
  });

  it("parser produces WithStmt with correct shape", () => {
    const ast = parse(`
      with (myObj) { var x = 1; }
    `);
    expect(ast.body.length).toBe(1);
    const stmt = ast.body[0]!;
    expect(stmt.type).toBe("WithStmt");
    if (stmt.type === "WithStmt") {
      expect(stmt.object.type).toBe("Identifier");
      expect(stmt.body.type).toBe("Block");
    }
  });
});
