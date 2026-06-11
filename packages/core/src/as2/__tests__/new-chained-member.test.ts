/**
 * Tests for AS2 compiler: `new` on chained member expressions (task 1137).
 *
 * `new mx.transitions.Tween(...)` must emit ActionNewMethod (0x53), NOT
 * ActionNewObject (0x40). Ruffle's ActionNewObject uses a flat scope lookup that
 * does NOT split on dots, so pushing "mx.transitions.Tween" as a string fails at
 * runtime. ActionNewMethod resolves the object chain via GetVariable/GetMember
 * and calls new on the last property name.
 *
 * AVM1 ActionNewMethod stack layout (Ruffle pops TOP first):
 *   method_name  ← TOP  (last property, e.g. "Tween")
 *   object              (result of evaluating chain minus last property)
 *   nArgs
 *   arg[n-1] ... arg[0] ← deepest
 *
 * Key opcodes:
 *   ActionNewMethod  (0x53) — constructor call for MemberExpr callee
 *   ActionNewObject  (0x40) — constructor call for plain Identifier callee only
 *   ActionGetMember  (0x4e) — resolves each step of the namespace chain
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

/** Returns true if the exact null-terminated UTF-8 string s appears in bytes. */
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
// Opcode constants
// ---------------------------------------------------------------------------

const ACTION_NEW_METHOD  = 0x53; // ActionNewMethod  — constructor call for MemberExpr callee
const ACTION_NEW_OBJECT  = 0x40; // ActionNewObject  — constructor call for Identifier callee only
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember
const ACTION_GET_VAR     = 0x1c; // ActionGetVariable

// ---------------------------------------------------------------------------
// Two-segment chain: new pkg.ClassName()
// ---------------------------------------------------------------------------

describe("new on two-segment member chain", () => {
  it("1. new pkg.ClassName() compiles without error", () => {
    expect(compilesOk("var t = new pkg.ClassName();")).toBe(true);
  });

  it("2. new pkg.ClassName() emits ActionNewMethod (0x53)", () => {
    const bytes = compileAS2("var t = new pkg.ClassName();");
    expect(containsByte(bytes, ACTION_NEW_METHOD)).toBe(true);
  });

  it("3. new pkg.ClassName() pushes 'ClassName' as the method_name string", () => {
    const bytes = compileAS2("var t = new pkg.ClassName();");
    // ActionNewMethod pops the last property as method_name
    expect(containsString(bytes, "ClassName")).toBe(true);
  });

  it("4. new pkg.ClassName() resolves 'pkg' via GetVariable (ActionGetVariable)", () => {
    // The object part (pkg) is resolved via GetVariable, not pushed as a dotted string
    const bytes = compileAS2("var t = new pkg.ClassName();");
    expect(containsString(bytes, "pkg")).toBe(true);
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    // The full dotted string "pkg.ClassName" must NOT appear — no flat-string lookup
    expect(containsString(bytes, "pkg.ClassName")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Three-segment chain: new mx.transitions.Tween()
// ---------------------------------------------------------------------------

describe("new on three-segment member chain (mx.transitions.Tween)", () => {
  it("5. new mx.transitions.Tween() compiles without error", () => {
    expect(compilesOk("var t = new mx.transitions.Tween();")).toBe(true);
  });

  it("6. new mx.transitions.Tween() emits ActionNewMethod (0x53)", () => {
    const bytes = compileAS2("var t = new mx.transitions.Tween();");
    expect(containsByte(bytes, ACTION_NEW_METHOD)).toBe(true);
  });

  it("7. new mx.transitions.Tween() pushes 'Tween' as the method_name string", () => {
    const bytes = compileAS2("var t = new mx.transitions.Tween();");
    // The last property "Tween" is pushed as method_name for ActionNewMethod
    expect(containsString(bytes, "Tween")).toBe(true);
  });

  it("8. new mx.transitions.Tween() resolves 'mx' via GetVariable for the object chain", () => {
    const bytes = compileAS2("var t = new mx.transitions.Tween();");
    // The object chain (mx.transitions) is resolved via GetVariable + GetMember
    expect(containsString(bytes, "mx")).toBe(true);
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    // The full dotted string must NOT appear — ActionNewObject flat lookup is not used
    expect(containsString(bytes, "mx.transitions.Tween")).toBe(false);
  });

  it("9. new mx.transitions.Tween() pushes 'transitions' via GetMember for object resolution", () => {
    const bytes = compileAS2("var t = new mx.transitions.Tween();");
    // "transitions" appears as a GetMember key when resolving mx.transitions
    expect(containsString(bytes, "transitions")).toBe(true);
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Four-segment chain: new mx.transitions.easing.Strong()
// ---------------------------------------------------------------------------

describe("new on four-segment member chain (mx.transitions.easing.Strong)", () => {
  it("10. new mx.transitions.easing.Strong() compiles without error", () => {
    expect(compilesOk("var s = new mx.transitions.easing.Strong();")).toBe(true);
  });

  it("11. new mx.transitions.easing.Strong() emits ActionNewMethod (0x53)", () => {
    const bytes = compileAS2("var s = new mx.transitions.easing.Strong();");
    expect(containsByte(bytes, ACTION_NEW_METHOD)).toBe(true);
  });

  it("12. new mx.transitions.easing.Strong() pushes 'Strong' as method_name", () => {
    const bytes = compileAS2("var s = new mx.transitions.easing.Strong();");
    // The last property "Strong" is pushed as method_name for ActionNewMethod
    expect(containsString(bytes, "Strong")).toBe(true);
  });

  it("13. new mx.transitions.easing.Strong() resolves object chain via GetMember", () => {
    const bytes = compileAS2("var s = new mx.transitions.easing.Strong();");
    // Object chain (mx.transitions.easing) is resolved via GetVariable + GetMember calls
    expect(containsString(bytes, "easing")).toBe(true);
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    // The full dotted string must NOT appear
    expect(containsString(bytes, "mx.transitions.easing.Strong")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Constructor with arguments
// ---------------------------------------------------------------------------

describe("new on chained member with arguments", () => {
  it("14. new mx.transitions.Tween(obj, '_x', easing, 0, 100, 1) compiles", () => {
    expect(
      compilesOk("var t = new mx.transitions.Tween(obj, '_x', easing, 0, 100, 1);")
    ).toBe(true);
  });

  it("15. new mx.transitions.Tween with args emits ActionNewMethod (0x53)", () => {
    const bytes = compileAS2(
      "var t = new mx.transitions.Tween(obj, '_x', easing, 0, 100, 1);"
    );
    expect(containsByte(bytes, ACTION_NEW_METHOD)).toBe(true);
  });

  it("16. new mx.transitions.Tween with args pushes 'Tween' as method_name", () => {
    const bytes = compileAS2(
      "var t = new mx.transitions.Tween(obj, '_x', easing, 0, 100, 1);"
    );
    expect(containsString(bytes, "Tween")).toBe(true);
  });

  it("17. new mx.transitions.Tween with args includes arg strings in output", () => {
    const bytes = compileAS2(
      "var t = new mx.transitions.Tween(obj, '_x', easing, 0, 100, 1);"
    );
    expect(containsString(bytes, "_x")).toBe(true);
    expect(containsString(bytes, "obj")).toBe(true);
    expect(containsString(bytes, "easing")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Plain identifier still works correctly
// ---------------------------------------------------------------------------

describe("new on plain identifier (regression guard)", () => {
  it("18. new MyClass() still pushes 'MyClass' as string and uses ActionNewObject", () => {
    const bytes = compileAS2("var x = new MyClass();");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
    expect(containsString(bytes, "MyClass")).toBe(true);
    // Plain identifier must NOT use ActionNewMethod
    expect(containsByte(bytes, ACTION_NEW_METHOD)).toBe(false);
  });

  it("19. new Array() still works correctly", () => {
    const bytes = compileAS2("var a = new Array();");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
    expect(containsString(bytes, "Array")).toBe(true);
    expect(containsByte(bytes, ACTION_NEW_METHOD)).toBe(false);
  });
});
