/**
 * Tests for AS2 compiler: delete operator and in operator.
 *
 * Documents and verifies the AVM1 opcodes emitted for:
 *   - delete obj.prop      → ActionDelete  (0x3A): object + name form
 *   - delete myVar         → ActionDelete2 (0x3B): scope-chain form
 *   - delete arr[0]        → ActionDelete  (0x3A): computed-index form (object + key)
 *   - for (var k in obj)   → ActionEnumerate2 (0x55)
 *   - "key" in obj         → GetMember probe: typeof(obj[key]) !== "undefined"
 *                            emits ActionGetMember (0x4e) + ActionTypeOf (0x44) +
 *                            ActionEquals2 (0x49) + ActionNot (0x12)
 *
 * The delete and in operators have nuanced AVM1 semantics:
 *   - ActionDelete  (0x3A) requires an explicit object reference and property name/key.
 *   - ActionDelete2 (0x3B) removes a named variable from the scope chain.
 *   - Computed-index deletion (delete arr[0]) uses ActionDelete (0x3A) with the
 *     computed index as the key — same opcode as the MemberExpr form.
 *   - The `in` operator is a GetMember probe (typeof(obj[key]) !== "undefined") — NOT
 *     ActionEnumerate2 (0x55), which is reserved for for..in enumeration. This approach
 *     correctly handles inherited prototype properties (unlike hasOwnProperty).
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

const ACTION_DELETE       = 0x3a; // ActionDelete     — delete object property (object + name)
const ACTION_DELETE2      = 0x3b; // ActionDelete2    — delete scope-chain variable (name only)
const ACTION_ENUMERATE2   = 0x55; // ActionEnumerate2 — push all enumerable keys for for..in
const ACTION_CALL_METHOD  = 0x52; // ActionCallMethod — method dispatch
const ACTION_GET_MEMBER   = 0x4e; // ActionGetMember  — obj[key] property read
const ACTION_TYPEOF       = 0x44; // ActionTypeOf     — type string of stack top
const ACTION_EQUALS2      = 0x49; // ActionEquals2    — abstract equality
const ACTION_NOT          = 0x12; // ActionNot        — boolean negation

// ---------------------------------------------------------------------------
// 1. delete obj.prop — ActionDelete (0x3A)
//
// MemberExpr form: compiler emits object reference + property name string,
// then ActionDelete (0x3A).
// ---------------------------------------------------------------------------

describe("delete operator: obj.prop form (ActionDelete 0x3A)", () => {
  it("1a. delete obj.prop; compiles without error", () => {
    expect(compilesOk("delete obj.prop;")).toBe(true);
  });

  it("1b. delete obj.prop; emits ActionDelete (0x3A)", () => {
    const bytes = compileAS2("delete obj.prop;");
    expect(containsByte(bytes, ACTION_DELETE)).toBe(true);
  });

  it("1c. delete obj.prop; does NOT emit ActionDelete2 (0x3B)", () => {
    const bytes = compileAS2("delete obj.prop;");
    expect(containsByte(bytes, ACTION_DELETE2)).toBe(false);
  });

  it("1d. delete obj.prop; bytecode contains the property name string", () => {
    const bytes = compileAS2("delete obj.prop;");
    expect(containsString(bytes, "prop")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. delete arr[0] — computed-index deletion
//
// Computed-index form (IndexExpr): compiler emits object reference + computed
// key, then ActionDelete (0x3A). AVM1 ActionDelete accepts any key, not just
// string literals — so delete arr[i] works the same as delete obj.prop.
// ---------------------------------------------------------------------------

describe("delete operator: computed-index form (arr[0])", () => {
  it("2a. delete arr[0]; compiles without error", () => {
    expect(compilesOk("var arr = [1, 2, 3]; delete arr[0];")).toBe(true);
  });

  it("2b. delete arr[0]; emits ActionDelete (0x3A) — IndexExpr uses same opcode as MemberExpr", () => {
    const bytes = compileAS2("var arr = []; delete arr[0];");
    expect(containsByte(bytes, ACTION_DELETE)).toBe(true);
  });

  it("2c. delete arr[0]; does NOT emit ActionDelete2 (0x3B)", () => {
    const bytes = compileAS2("var arr = []; delete arr[0];");
    expect(containsByte(bytes, ACTION_DELETE2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. delete myVar — ActionDelete2 (0x3B)
//
// Identifier form: compiler emits the variable name string, then
// ActionDelete2 (0x3B) which removes the named variable from the scope chain.
// ---------------------------------------------------------------------------

describe("delete operator: local variable form (ActionDelete2 0x3B)", () => {
  it("3a. delete myVar; compiles without error", () => {
    expect(compilesOk("delete myVar;")).toBe(true);
  });

  it("3b. delete myVar; emits ActionDelete2 (0x3B)", () => {
    const bytes = compileAS2("delete myVar;");
    expect(containsByte(bytes, ACTION_DELETE2)).toBe(true);
  });

  it("3c. delete myVar; does NOT emit ActionDelete (0x3A)", () => {
    const bytes = compileAS2("delete myVar;");
    expect(containsByte(bytes, ACTION_DELETE)).toBe(false);
  });

  it("3d. delete myVar; bytecode contains the variable name string", () => {
    const bytes = compileAS2("delete myVar;");
    expect(containsString(bytes, "myVar")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. for (var k in obj) { trace(k); } — ActionEnumerate2 (0x55)
// ---------------------------------------------------------------------------

describe("for..in loop: ActionEnumerate2 (0x55)", () => {
  it("4a. for (var k in obj) { trace(k); } compiles without error", () => {
    expect(compilesOk("for (var k in obj) { trace(k); }")).toBe(true);
  });

  it("4b. for (var k in obj) emits ActionEnumerate2 (0x55)", () => {
    const bytes = compileAS2("for (var k in obj) { trace(k); }");
    expect(containsByte(bytes, ACTION_ENUMERATE2)).toBe(true);
  });

  it("4c. for..in loop variable name appears in bytecode", () => {
    const bytes = compileAS2("for (var k in obj) { trace(k); }");
    expect(containsString(bytes, "k")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. for (var key in myArray) {} — compiles
// ---------------------------------------------------------------------------

describe("for..in loop: array enumeration", () => {
  it("5a. for (var key in myArray) {} compiles without error", () => {
    expect(compilesOk("var myArray = [1, 2, 3]; for (var key in myArray) {}")).toBe(true);
  });

  it("5b. for (var key in myArray) {} emits ActionEnumerate2 (0x55)", () => {
    const bytes = compileAS2("var myArray = [1, 2, 3]; for (var key in myArray) {}");
    expect(containsByte(bytes, ACTION_ENUMERATE2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. for (var p in this) {} — compiles
// ---------------------------------------------------------------------------

describe("for..in loop: this enumeration", () => {
  it("6a. for (var p in this) {} compiles without error", () => {
    expect(compilesOk("for (var p in this) {}")).toBe(true);
  });

  it("6b. for (var p in this) {} emits ActionEnumerate2 (0x55)", () => {
    const bytes = compileAS2("for (var p in this) {}");
    expect(containsByte(bytes, ACTION_ENUMERATE2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. "key" in obj — in operator (GetMember probe: typeof(obj[key]) !== "undefined")
//
// AVM1 has no ActionIn opcode. The `in` operator is approximated via a
// GetMember probe: push obj, push key, ActionGetMember → value, ActionTypeOf →
// type string, push "undefined", ActionEquals2, ActionNot → boolean result.
// This correctly handles inherited prototype-chain properties (unlike the old
// hasOwnProperty approach). Limitation: returns false when the value IS
// undefined (acceptable AVM1 approximation).
// ---------------------------------------------------------------------------

describe("in operator: key in obj", () => {
  it('7a. "key" in obj; compiles without error', () => {
    expect(compilesOk('"key" in obj;')).toBe(true);
  });

  it('7b. "key" in obj; emits ActionGetMember (0x4e) — GetMember probe approach', () => {
    const bytes = compileAS2('"key" in obj;');
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });

  it('7c. "key" in obj; emits ActionTypeOf (0x44)', () => {
    const bytes = compileAS2('"key" in obj;');
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });

  it('7d. "key" in obj; emits ActionEquals2 (0x49) + ActionNot (0x12) for the !== "undefined" check', () => {
    const bytes = compileAS2('"key" in obj;');
    expect(containsByte(bytes, ACTION_EQUALS2)).toBe(true);
    expect(containsByte(bytes, ACTION_NOT)).toBe(true);
  });

  it('7e. "key" in obj; contains "undefined" string in bytecode', () => {
    const bytes = compileAS2('"key" in obj;');
    expect(containsString(bytes, 'undefined')).toBe(true);
  });

  it('7f. "key" in obj; does NOT emit ActionCallMethod (0x52) — no hasOwnProperty call', () => {
    const bytes = compileAS2('"key" in obj;');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });

  it('7g. "key" in obj; does NOT emit ActionEnumerate2 (0x55) — that is for for..in', () => {
    const bytes = compileAS2('"key" in obj;');
    expect(containsByte(bytes, ACTION_ENUMERATE2)).toBe(false);
  });

  it("7h. variable in obj compiles without error", () => {
    expect(compilesOk("var key = 'x'; var obj = {}; key in obj;")).toBe(true);
  });
});
