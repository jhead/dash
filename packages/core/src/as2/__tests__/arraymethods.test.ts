/**
 * Tests for AS2 compiler handling of Array method calls.
 *
 * Verifies that array method calls compile to correct AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls (arr.push(4), arr.pop(), etc.)
 *   - ActionGetMember  (0x4f): property reads (arr.length)
 *   - ActionNew        (0x4a): constructor calls (new Array(5))
 *   - ActionInitArray  (0x36): array literal ([1,2,3])
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

const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_GET_MEMBER  = 0x4f; // ActionGetMember  — property read
const ACTION_NEW         = 0x4a; // ActionNew        — constructor call
const ACTION_INIT_ARRAY  = 0x36; // ActionInitArray  — array literal

// ---------------------------------------------------------------------------
// Array declaration and push
// ---------------------------------------------------------------------------

describe("Array push", () => {
  it("var a = [1,2,3]; a.push(4) compiles without error", () => {
    expect(compilesOk("var a = [1,2,3]; a.push(4);")).toBe(true);
  });

  it("a.push(4) bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var a = []; a.push(4);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "push")).toBe(true);
  });

  it("a.push(4) bytecode references the array variable", () => {
    const bytes = compileAS2("var a = []; a.push(4);");
    expect(containsString(bytes, "a")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array pop
// ---------------------------------------------------------------------------

describe("Array pop", () => {
  it("a.pop() compiles without error", () => {
    expect(compilesOk("a.pop();")).toBe(true);
  });

  it("a.pop() bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("a.pop();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "pop")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array splice
// ---------------------------------------------------------------------------

describe("Array splice", () => {
  it("a.splice(0, 1) compiles without error", () => {
    expect(compilesOk("a.splice(0, 1);")).toBe(true);
  });

  it("a.splice(0, 1) bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("a.splice(0, 1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "splice")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array sort
// ---------------------------------------------------------------------------

describe("Array sort", () => {
  it("a.sort() compiles without error", () => {
    expect(compilesOk("a.sort();")).toBe(true);
  });

  it("a.sort() bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("a.sort();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "sort")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array join
// ---------------------------------------------------------------------------

describe("Array join", () => {
  it('a.join(",") compiles without error', () => {
    expect(compilesOk('a.join(",");')).toBe(true);
  });

  it('a.join(",") bytecode contains ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('a.join(",");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "join")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array reverse
// ---------------------------------------------------------------------------

describe("Array reverse", () => {
  it("a.reverse() compiles without error", () => {
    expect(compilesOk("a.reverse();")).toBe(true);
  });

  it("a.reverse() bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("a.reverse();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "reverse")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array concat
// ---------------------------------------------------------------------------

describe("Array concat", () => {
  it("a.concat([4,5]) compiles without error", () => {
    expect(compilesOk("a.concat([4,5]);")).toBe(true);
  });

  it("a.concat([4,5]) bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("a.concat([4,5]);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "concat")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array slice
// ---------------------------------------------------------------------------

describe("Array slice", () => {
  it("a.slice(1, 3) compiles without error", () => {
    expect(compilesOk("a.slice(1, 3);")).toBe(true);
  });

  it("a.slice(1, 3) bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("a.slice(1, 3);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "slice")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array indexOf
// ---------------------------------------------------------------------------

describe("Array indexOf", () => {
  it("a.indexOf(2) compiles without error", () => {
    expect(compilesOk("a.indexOf(2);")).toBe(true);
  });

  it("a.indexOf(2) bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("a.indexOf(2);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "indexOf")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array length property
// ---------------------------------------------------------------------------

describe("Array length property", () => {
  it("a.length compiles without error", () => {
    expect(compilesOk("var n = a.length;")).toBe(true);
  });

  it("a.length emits ActionGetMember (0x4f), not ActionCallMethod", () => {
    const bytes = compileAS2("var n = a.length;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "length")).toBe(true);
    // Property access must NOT emit ActionCallMethod
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Array constructor
// ---------------------------------------------------------------------------

describe("Array constructor", () => {
  it("new Array(5) compiles without error", () => {
    expect(compilesOk("var a = new Array(5);")).toBe(true);
  });

  it("new Array(5) emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("var a = new Array(5);");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Array")).toBe(true);
  });

  it("new Array() (no args) compiles without error", () => {
    expect(compilesOk("var a = new Array();")).toBe(true);
  });

  it("new Array() emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("var a = new Array();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Array")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array literal
// ---------------------------------------------------------------------------

describe("Array literal", () => {
  it("[1,2,3] compiles without error", () => {
    expect(compilesOk("var a = [1,2,3];")).toBe(true);
  });

  it("[1,2,3] emits ActionInitArray (0x36)", () => {
    const bytes = compileAS2("var a = [1,2,3];");
    expect(containsByte(bytes, ACTION_INIT_ARRAY)).toBe(true);
  });

  it("empty array literal [] compiles without error", () => {
    expect(compilesOk("var a = [];")).toBe(true);
  });

  it("empty array literal [] emits ActionInitArray (0x36)", () => {
    const bytes = compileAS2("var a = [];");
    expect(containsByte(bytes, ACTION_INIT_ARRAY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined: declare array and call methods on it
// ---------------------------------------------------------------------------

describe("Array declaration with method calls", () => {
  it("var a = [1,2,3]; a.push(4) — declaration then push compiles without error", () => {
    expect(compilesOk("var a = [1,2,3]; a.push(4);")).toBe(true);
  });

  it("var a = [1,2,3]; a.push(4) — bytecode has both ActionInitArray and ActionCallMethod", () => {
    const bytes = compileAS2("var a = [1,2,3]; a.push(4);");
    expect(containsByte(bytes, ACTION_INIT_ARRAY)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "push")).toBe(true);
  });

  it("var a = [1,2,3]; a.pop() — declaration then pop compiles without error", () => {
    expect(compilesOk("var a = [1,2,3]; a.pop();")).toBe(true);
  });

  it("var a = [1,2,3]; a.splice(0,1) — declaration then splice compiles without error", () => {
    expect(compilesOk("var a = [1,2,3]; a.splice(0,1);")).toBe(true);
  });
});
