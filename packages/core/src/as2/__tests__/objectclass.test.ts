/**
 * Tests for AS2 Object class built-in methods.
 *
 * Verifies that Object class construction, static methods, and prototype
 * methods compile correctly to AVM1 bytecode.
 *
 * Key opcodes verified:
 *   - ActionNew        (0x4a): new Object()
 *   - ActionCallMethod (0x52): method dispatch
 *   - ActionGetMember  (0x4f): property access (obj.constructor)
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

const ACTION_NEW         = 0x4a; // ActionNew        — constructor call
const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_GET_MEMBER  = 0x4f; // ActionGetMember  — property access

// ---------------------------------------------------------------------------
// 1. new Object()
// ---------------------------------------------------------------------------

describe("new Object()", () => {
  it("var o = new Object() compiles without error", () => {
    expect(compilesOk("var o = new Object();")).toBe(true);
  });

  it("var o = new Object() emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("var o = new Object();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Object.registerClass()
// ---------------------------------------------------------------------------

describe("Object.registerClass()", () => {
  it('Object.registerClass("MyClip", MyClass) compiles without error', () => {
    expect(
      compilesOk('function MyClass() {} Object.registerClass("MyClip", MyClass);')
    ).toBe(true);
  });

  it('Object.registerClass("MyClip", MyClass) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'function MyClass() {} Object.registerClass("MyClip", MyClass);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "registerClass")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. obj.hasOwnProperty()
// ---------------------------------------------------------------------------

describe("obj.hasOwnProperty()", () => {
  it('obj.hasOwnProperty("key") compiles without error', () => {
    expect(compilesOk('var obj = {}; obj.hasOwnProperty("key");')).toBe(true);
  });

  it('obj.hasOwnProperty("key") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var obj = {}; obj.hasOwnProperty("key");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "hasOwnProperty")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. obj.isPrototypeOf()
// ---------------------------------------------------------------------------

describe("obj.isPrototypeOf()", () => {
  it("obj.isPrototypeOf(other) compiles without error", () => {
    expect(compilesOk("var obj = {}; var other = {}; obj.isPrototypeOf(other);")).toBe(true);
  });

  it("obj.isPrototypeOf(other) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var obj = {}; var other = {}; obj.isPrototypeOf(other);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "isPrototypeOf")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. obj.propertyIsEnumerable()
// ---------------------------------------------------------------------------

describe("obj.propertyIsEnumerable()", () => {
  it('obj.propertyIsEnumerable("key") compiles without error', () => {
    expect(compilesOk('var obj = {}; obj.propertyIsEnumerable("key");')).toBe(true);
  });

  it('obj.propertyIsEnumerable("key") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var obj = {}; obj.propertyIsEnumerable("key");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "propertyIsEnumerable")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. obj.toString()
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
// 7. obj.valueOf()
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
// 8. obj.constructor
// ---------------------------------------------------------------------------

describe("obj.constructor", () => {
  it("var ctor = obj.constructor compiles without error", () => {
    expect(compilesOk("var obj = {}; var ctor = obj.constructor;")).toBe(true);
  });

  it("var ctor = obj.constructor emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var obj = {}; var ctor = obj.constructor;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "constructor")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. obj.watch()
// ---------------------------------------------------------------------------

describe("obj.watch()", () => {
  it("obj.watch(name, callback) compiles without error", () => {
    expect(
      compilesOk(
        'var obj = {}; obj.watch("name", function(id, old, newv) { return newv; });'
      )
    ).toBe(true);
  });

  it("obj.watch(name, callback) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      'var obj = {}; obj.watch("name", function(id, old, newv) { return newv; });'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "watch")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. obj.unwatch()
// ---------------------------------------------------------------------------

describe("obj.unwatch()", () => {
  it('obj.unwatch("name") compiles without error', () => {
    expect(compilesOk('var obj = {}; obj.unwatch("name");')).toBe(true);
  });

  it('obj.unwatch("name") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var obj = {}; obj.unwatch("name");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "unwatch")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined: full Object class usage
// ---------------------------------------------------------------------------

describe("combined Object class usage", () => {
  it("all Object methods compile without error together", () => {
    expect(
      compilesOk(`
        function MyClass() {}
        var o = new Object();
        Object.registerClass("MyClip", MyClass);
        var has = o.hasOwnProperty("key");
        var isP = o.isPrototypeOf({});
        var pie = o.propertyIsEnumerable("key");
        var str = o.toString();
        var val = o.valueOf();
        var ctor = o.constructor;
        o.watch("name", function(id, old, newv) { return newv; });
        o.unwatch("name");
      `)
    ).toBe(true);
  });
});
