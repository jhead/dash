/**
 * Tests for AS2 compiler: Object and Function prototype methods.
 *
 * Verifies that common Object.prototype and Function.prototype method calls,
 * as well as typeof, instanceof, and the in operator, compile correctly to
 * AVM1 bytecode.
 *
 * Key opcodes verified:
 *   - ActionCallMethod  (0x52): method dispatch (hasOwnProperty, isPrototypeOf,
 *                               toString, valueOf, call, apply)
 *   - ActionTypeOf      (0x44): typeof operator
 *   - ActionInstanceOf  (0x54): instanceof operator
 *
 * Note on the 'in' operator:
 *   AS2/AVM1 has no dedicated ActionIn opcode. The compiler implements
 *   "key in obj" as obj.hasOwnProperty(key), which emits ActionCallMethod (0x52).
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
const ACTION_TYPE_OF     = 0x44; // ActionTypeOf     — typeof operator
const ACTION_INSTANCE_OF = 0x54; // ActionInstanceOf — instanceof operator

// ---------------------------------------------------------------------------
// obj.hasOwnProperty()
// ---------------------------------------------------------------------------

describe("obj.hasOwnProperty()", () => {
  it('obj.hasOwnProperty("prop") compiles without error', () => {
    expect(compilesOk('var obj = {}; obj.hasOwnProperty("prop");')).toBe(true);
  });

  it('obj.hasOwnProperty("prop") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var obj = {}; obj.hasOwnProperty("prop");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "hasOwnProperty")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// obj.isPrototypeOf()
// ---------------------------------------------------------------------------

describe("obj.isPrototypeOf()", () => {
  it("obj.isPrototypeOf(proto) compiles without error", () => {
    expect(compilesOk("var obj = {}; var proto = {}; obj.isPrototypeOf(proto);")).toBe(true);
  });

  it("obj.isPrototypeOf(proto) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var obj = {}; var proto = {}; obj.isPrototypeOf(proto);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "isPrototypeOf")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// obj.toString()
// ---------------------------------------------------------------------------

describe("obj.toString()", () => {
  it("obj.toString() compiles without error", () => {
    expect(compilesOk("var obj = {}; obj.toString();")).toBe(true);
  });

  it("obj.toString() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var obj = {}; obj.toString();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "toString")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// obj.valueOf()
// ---------------------------------------------------------------------------

describe("obj.valueOf()", () => {
  it("obj.valueOf() compiles without error", () => {
    expect(compilesOk("var obj = {}; obj.valueOf();")).toBe(true);
  });

  it("obj.valueOf() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var obj = {}; obj.valueOf();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "valueOf")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fn.call()
// ---------------------------------------------------------------------------

describe("fn.call()", () => {
  it("fn.call(thisObj, arg1) compiles without error", () => {
    expect(
      compilesOk("var fn = function() {}; var thisObj = {}; var arg1 = 1; fn.call(thisObj, arg1);")
    ).toBe(true);
  });

  it("fn.call(thisObj, arg1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var fn = function() {}; var thisObj = {}; var arg1 = 1; fn.call(thisObj, arg1);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "call")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fn.apply()
// ---------------------------------------------------------------------------

describe("fn.apply()", () => {
  it("fn.apply(thisObj, [arg1, arg2]) compiles without error", () => {
    expect(
      compilesOk(
        "var fn = function() {}; var thisObj = {}; var arg1 = 1; var arg2 = 2; fn.apply(thisObj, [arg1, arg2]);"
      )
    ).toBe(true);
  });

  it("fn.apply(thisObj, [arg1, arg2]) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var fn = function() {}; var thisObj = {}; var arg1 = 1; var arg2 = 2; fn.apply(thisObj, [arg1, arg2]);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "apply")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// typeof operator
// ---------------------------------------------------------------------------

describe("typeof operator", () => {
  it("typeof x compiles without error", () => {
    expect(compilesOk("var x = 1; typeof x;")).toBe(true);
  });

  it("typeof x emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("var x = 1; typeof x;");
    expect(containsByte(bytes, ACTION_TYPE_OF)).toBe(true);
  });

  it("typeof x === 'string' compiles without error", () => {
    expect(compilesOk("var x = 'hello'; var t = typeof x;")).toBe(true);
  });

  it("typeof x === 'string' emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("var x = 'hello'; var t = typeof x;");
    expect(containsByte(bytes, ACTION_TYPE_OF)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// instanceof operator
// ---------------------------------------------------------------------------

describe("instanceof operator", () => {
  it("x instanceof MyClass compiles without error", () => {
    expect(
      compilesOk("function MyClass() {} var x = new MyClass(); x instanceof MyClass;")
    ).toBe(true);
  });

  it("x instanceof MyClass emits ActionInstanceOf (0x54)", () => {
    const bytes = compileAS2(
      "function MyClass() {} var x = new MyClass(); x instanceof MyClass;"
    );
    expect(containsByte(bytes, ACTION_INSTANCE_OF)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 'in' operator
// ---------------------------------------------------------------------------

describe("in operator", () => {
  it('"prop" in obj compiles without error', () => {
    // The compiler implements 'in' via a GetMember probe: typeof(obj[key]) !== "undefined"
    expect(compilesOk('var obj = { prop: 1 }; "prop" in obj;')).toBe(true);
  });

  it('"prop" in obj emits ActionGetMember (0x4e) — GetMember probe, not hasOwnProperty', () => {
    const bytes = compileAS2('var obj = { prop: 1 }; "prop" in obj;');
    // 'in' uses GetMember probe: push obj, push key, ActionGetMember, ActionTypeOf,
    // push "undefined", ActionEquals2, ActionNot
    expect(containsByte(bytes, 0x4e)).toBe(true); // ActionGetMember
    expect(containsByte(bytes, 0x44)).toBe(true); // ActionTypeOf
    expect(containsString(bytes, "undefined")).toBe(true);
    // must NOT use hasOwnProperty (misses inherited prototype properties)
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
    expect(containsString(bytes, "hasOwnProperty")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Combined: full prototype method usage
// ---------------------------------------------------------------------------

describe("combined Object/Function prototype usage", () => {
  it("multiple prototype method calls compile without error", () => {
    expect(
      compilesOk(`
        function Animal() {}
        var a = new Animal();
        var s = a.toString();
        var v = a.valueOf();
        var has = a.hasOwnProperty("name");
        var t = typeof a;
        var isAnimal = a instanceof Animal;
        var fn = function(x) { return x; };
        fn.call(a, 42);
        fn.apply(a, [1, 2]);
      `)
    ).toBe(true);
  });

  it("multiple prototype method calls emit all expected opcodes", () => {
    const bytes = compileAS2(`
      function Animal() {}
      var a = new Animal();
      a.toString();
      a.valueOf();
      a.hasOwnProperty("name");
      var t = typeof a;
      var isAnimal = a instanceof Animal;
      var fn = function(x) { return x; };
      fn.call(a, 42);
      fn.apply(a, [1, 2]);
    `);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsByte(bytes, ACTION_TYPE_OF)).toBe(true);
    expect(containsByte(bytes, ACTION_INSTANCE_OF)).toBe(true);
  });
});
