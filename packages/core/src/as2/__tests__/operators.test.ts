/**
 * Tests for AS2 operator compilation: for...in, delete, typeof, void, instanceof, in.
 *
 * Verifies that these language features compile to valid AVM1 bytecode and
 * produce the expected opcodes.
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

function containsByte(bytes: Uint8Array, byte: number): boolean {
  return bytes.includes(byte);
}

// ---------------------------------------------------------------------------
// for...in
// ---------------------------------------------------------------------------

describe("for...in loop", () => {
  it("compiles for (var k in obj) {}", () => {
    expect(compilesOk("for (var k in obj) {}")).toBe(true);
  });

  it("compiles for (k in obj) without var", () => {
    expect(compilesOk("for (k in obj) {}")).toBe(true);
  });

  it("emits ActionEnumerate2 (0x55) for for...in", () => {
    const bytes = compileAS2("for (var k in obj) {}");
    expect(containsByte(bytes, 0x55)).toBe(true); // ActionEnumerate2
  });

  it("emits ActionDefineLocal2 (0x41) for var k in for...in", () => {
    const bytes = compileAS2("for (var k in obj) {}");
    expect(containsByte(bytes, 0x41)).toBe(true); // ActionDefineLocal2
  });

  it("does not emit ActionDefineLocal2 for non-var for...in", () => {
    const bytes = compileAS2("for (k in obj) {}");
    const hex = toHex(bytes);
    // 0x41 should NOT appear (no var declaration)
    expect(containsByte(bytes, 0x41)).toBe(false);
  });

  it("compiles for...in with body statements", () => {
    const src = `
      for (var k in obj) {
        trace(k);
      }
    `;
    expect(compilesOk(src)).toBe(true);
    const bytes = compileAS2(src);
    expect(containsByte(bytes, 0x55)).toBe(true); // ActionEnumerate2
    expect(containsByte(bytes, 0x26)).toBe(true); // ActionTrace
    expect(containsString(bytes, "k")).toBe(true);
  });

  it("compiles nested for...in loops", () => {
    const src = `
      for (var k in outer) {
        for (var j in inner) {
          trace(j);
        }
      }
    `;
    expect(compilesOk(src)).toBe(true);
    const bytes = compileAS2(src);
    // Two ActionEnumerate2 opcodes
    let count = 0;
    for (const b of bytes) if (b === 0x55) count++;
    expect(count).toBe(2);
  });

  it("uses ActionSetVariable (0x1d) to assign keys in for...in", () => {
    const bytes = compileAS2("for (var k in obj) {}");
    expect(containsByte(bytes, 0x1d)).toBe(true); // ActionSetVariable
  });
});

// ---------------------------------------------------------------------------
// delete operator
// ---------------------------------------------------------------------------

describe("delete operator", () => {
  it("compiles delete obj.prop", () => {
    expect(compilesOk("delete obj.prop;")).toBe(true);
  });

  it("emits ActionDelete (0x3a) for delete obj.prop", () => {
    const bytes = compileAS2("delete obj.prop;");
    expect(containsByte(bytes, 0x3a)).toBe(true); // ActionDelete
  });

  it("compiles delete x (identifier)", () => {
    expect(compilesOk("delete x;")).toBe(true);
  });

  it("emits ActionDelete2 (0x3b) for delete x", () => {
    const bytes = compileAS2("delete x;");
    expect(containsByte(bytes, 0x3b)).toBe(true); // ActionDelete2
    expect(containsString(bytes, "x")).toBe(true);
  });

  it("emits object name string for delete obj.prop", () => {
    const bytes = compileAS2("delete myObj.myProp;");
    expect(containsString(bytes, "myObj")).toBe(true);
    expect(containsString(bytes, "myProp")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// typeof operator
// ---------------------------------------------------------------------------

describe("typeof operator", () => {
  it("compiles typeof x", () => {
    expect(compilesOk("typeof x;")).toBe(true);
  });

  it("emits ActionTypeOf (0x44) for typeof x", () => {
    const bytes = compileAS2("typeof x;");
    expect(containsByte(bytes, 0x44)).toBe(true); // ActionTypeOf
  });

  it('compiles typeof "string literal"', () => {
    expect(compilesOk('typeof "hello";')).toBe(true);
  });

  it("emits ActionTypeOf (0x44) for typeof string literal", () => {
    const bytes = compileAS2('typeof "hello";');
    expect(containsByte(bytes, 0x44)).toBe(true); // ActionTypeOf
  });

  it("compiles typeof in expression context", () => {
    expect(compilesOk('var t = typeof x;')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// void operator
// ---------------------------------------------------------------------------

describe("void operator", () => {
  it("compiles void 0", () => {
    expect(compilesOk("void 0;")).toBe(true);
  });

  it("emits ActionPop (0x17) and undefined push for void", () => {
    const bytes = compileAS2("void 0;");
    // void evaluates expr, pops it, pushes undefined
    // Should contain ActionPop (0x17)
    expect(containsByte(bytes, 0x17)).toBe(true);
  });

  it("compiles void expression with side effects", () => {
    expect(compilesOk("void someFunction();")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// instanceof operator
// ---------------------------------------------------------------------------

describe("instanceof operator", () => {
  it("compiles a instanceof B", () => {
    expect(compilesOk("a instanceof B;")).toBe(true);
  });

  it("emits ActionInstanceOf (0x54) for instanceof", () => {
    const bytes = compileAS2("a instanceof B;");
    expect(containsByte(bytes, 0x54)).toBe(true); // ActionInstanceOf
  });

  it("compiles instanceof in conditional", () => {
    expect(compilesOk("if (obj instanceof MyClass) { trace(obj); }")).toBe(true);
  });

  it("emits ActionInstanceOf in conditional context", () => {
    const bytes = compileAS2("if (obj instanceof MyClass) { trace(obj); }");
    expect(containsByte(bytes, 0x54)).toBe(true); // ActionInstanceOf
    expect(containsString(bytes, "MyClass")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// in operator
// ---------------------------------------------------------------------------

describe("in operator", () => {
  it('compiles "x" in obj', () => {
    expect(compilesOk('"x" in obj;')).toBe(true);
  });

  it("emits ActionGetMember (0x4e) for in operator — GetMember probe approach", () => {
    const bytes = compileAS2('"x" in obj;');
    // typeof(obj[key]) !== "undefined" probe
    expect(containsByte(bytes, 0x4e)).toBe(true); // ActionGetMember
    expect(containsByte(bytes, 0x44)).toBe(true); // ActionTypeOf
    expect(containsString(bytes, "undefined")).toBe(true);
    // must NOT use hasOwnProperty (it misses inherited prototype properties)
    expect(containsByte(bytes, 0x52)).toBe(false); // ActionCallMethod
    expect(containsString(bytes, "hasOwnProperty")).toBe(false);
  });

  it("compiles key in obj with identifier key", () => {
    expect(compilesOk("key in obj;")).toBe(true);
  });

  it("compiles in operator in conditional", () => {
    expect(compilesOk('if ("prop" in myObj) { trace("found"); }')).toBe(true);
  });
});
