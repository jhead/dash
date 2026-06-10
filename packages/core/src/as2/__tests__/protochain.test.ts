/**
 * Tests for AS2 compiler: prototype chain and __proto__ access.
 *
 * Verifies that prototype property assignments, prototype-based inheritance
 * setup, __proto__ access, and chained member access all compile correctly
 * and emit the expected AVM1 opcodes.
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

const ACTION_SET_MEMBER = 0x4f; // ActionSetMember — property write
const ACTION_GET_MEMBER = 0x4e; // ActionGetMember — property read

// ---------------------------------------------------------------------------
// MyClass.prototype.greet = function() { return "hi"; }
// ---------------------------------------------------------------------------

describe("prototype method assignment", () => {
  it("MyClass.prototype.greet = function(){} compiles without error", () => {
    expect(
      compilesOk(
        'function MyClass() {}\n' +
        'MyClass.prototype.greet = function() { return "hi"; };'
      )
    ).toBe(true);
  });

  it("MyClass.prototype.greet assignment emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      'function MyClass() {}\n' +
      'MyClass.prototype.greet = function() { return "hi"; };'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);
    expect(containsString(bytes, "greet")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MyClass.prototype = new BaseClass()
// ---------------------------------------------------------------------------

describe("prototype chain assignment", () => {
  it("MyClass.prototype = new BaseClass() compiles without error", () => {
    expect(
      compilesOk(
        'function BaseClass() {}\n' +
        'function MyClass() {}\n' +
        'MyClass.prototype = new BaseClass();'
      )
    ).toBe(true);
  });

  it("prototype chain assignment emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      'function BaseClass() {}\n' +
      'function MyClass() {}\n' +
      'MyClass.prototype = new BaseClass();'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// obj.__proto__
// ---------------------------------------------------------------------------

describe("__proto__ access", () => {
  it("obj.__proto__ compiles without error", () => {
    expect(
      compilesOk('var obj = {}; var p = obj.__proto__;')
    ).toBe(true);
  });

  it("obj.__proto__ emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2('var obj = {}; var p = obj.__proto__;');
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "__proto__")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// obj.constructor.prototype  (chained member access)
// ---------------------------------------------------------------------------

describe("chained member access: obj.constructor.prototype", () => {
  it("obj.constructor.prototype compiles without error", () => {
    expect(
      compilesOk('var obj = {}; var p = obj.constructor.prototype;')
    ).toBe(true);
  });

  it("obj.constructor.prototype emits ActionGetMember (0x4e) twice", () => {
    const bytes = compileAS2('var obj = {}; var p = obj.constructor.prototype;');
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "constructor")).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Object.prototype.toString
// ---------------------------------------------------------------------------

describe("Object.prototype.toString", () => {
  it("Object.prototype.toString compiles without error", () => {
    expect(
      compilesOk('var fn = Object.prototype.toString;')
    ).toBe(true);
  });

  it("Object.prototype.toString emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2('var fn = Object.prototype.toString;');
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "Object")).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);
    expect(containsString(bytes, "toString")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Function.prototype.call
// ---------------------------------------------------------------------------

describe("Function.prototype.call", () => {
  it("Function.prototype.call compiles without error", () => {
    expect(
      compilesOk('var fn = Function.prototype.call;')
    ).toBe(true);
  });

  it("Function.prototype.call emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2('var fn = Function.prototype.call;');
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "Function")).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);
    expect(containsString(bytes, "call")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full prototype inheritance setup (Animal / Dog)
// ---------------------------------------------------------------------------

const ANIMAL_DOG_SOURCE =
  'function Animal(name) { this.name = name; }\n' +
  'Animal.prototype.speak = function() { return this.name; };\n' +
  'function Dog(name) { Animal.call(this, name); }\n' +
  'Dog.prototype = new Animal("");\n' +
  'Dog.prototype.constructor = Dog;';

describe("Full prototype inheritance setup (Animal / Dog)", () => {
  it("Animal constructor definition compiles without error", () => {
    expect(compilesOk('function Animal(name) { this.name = name; }')).toBe(true);
  });

  it("Animal.prototype.speak assignment compiles without error", () => {
    expect(
      compilesOk(
        'function Animal(name) { this.name = name; }\n' +
        'Animal.prototype.speak = function() { return this.name; };'
      )
    ).toBe(true);
  });

  it("Dog constructor with Animal.call compiles without error", () => {
    expect(
      compilesOk(
        'function Animal(name) { this.name = name; }\n' +
        'function Dog(name) { Animal.call(this, name); }'
      )
    ).toBe(true);
  });

  it("Dog.prototype = new Animal() compiles without error", () => {
    expect(
      compilesOk(
        'function Animal(name) { this.name = name; }\n' +
        'function Dog(name) { Animal.call(this, name); }\n' +
        'Dog.prototype = new Animal("");'
      )
    ).toBe(true);
  });

  it("Dog.prototype.constructor = Dog compiles without error", () => {
    expect(
      compilesOk(
        'function Animal(name) { this.name = name; }\n' +
        'function Dog(name) { Animal.call(this, name); }\n' +
        'Dog.prototype = new Animal("");\n' +
        'Dog.prototype.constructor = Dog;'
      )
    ).toBe(true);
  });

  it("full Animal/Dog prototype setup compiles without error", () => {
    expect(compilesOk(ANIMAL_DOG_SOURCE)).toBe(true);
  });

  it("full Animal/Dog setup emits ActionSetMember (0x4f) for prototype assignments", () => {
    const bytes = compileAS2(ANIMAL_DOG_SOURCE);
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);
    expect(containsString(bytes, "Animal")).toBe(true);
    expect(containsString(bytes, "Dog")).toBe(true);
  });
});
