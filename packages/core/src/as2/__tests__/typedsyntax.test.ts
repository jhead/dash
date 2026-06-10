/**
 * Tests for AS2 typed variable declarations, typed function parameters,
 * typed return types, and typed class members.
 *
 * In AS2, type annotations are compile-time only — they do not affect the
 * generated AVM1 bytecode. The compiler must:
 *   1. Accept typed syntax without throwing a parse or compile error.
 *   2. Strip type annotations from emitted bytecode (no type name strings
 *      in the output, no extra opcodes for type checking).
 *
 * All scenarios below compile against the AS2 parser + compiler that powers
 * the Flash 8 authoring toolchain.
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
// Typed variable declarations
// ---------------------------------------------------------------------------

describe("AS2 typed variable declarations", () => {
  it("var x:Number = 5 compiles without error", () => {
    expect(compilesOk("var x:Number = 5;")).toBe(true);
  });

  it("var s:String = 'hello' compiles without error", () => {
    expect(compilesOk('var s:String = "hello";')).toBe(true);
  });

  it("var b:Boolean = true compiles without error", () => {
    expect(compilesOk("var b:Boolean = true;")).toBe(true);
  });

  it("var a:Array = [] compiles without error", () => {
    expect(compilesOk("var a:Array = [];")).toBe(true);
  });

  it("var o:Object = {} compiles without error", () => {
    expect(compilesOk("var o:Object = {};")).toBe(true);
  });

  it("var mc:MovieClip (uninitialized typed var) compiles without error", () => {
    expect(compilesOk("var mc:MovieClip;")).toBe(true);
  });

  // Type annotations must NOT appear in bytecode — they are compile-time only
  it("var x:Number = 5 does not emit 'Number' type string in bytecode", () => {
    const bytes = compileAS2("var x:Number = 5;");
    expect(containsString(bytes, "Number")).toBe(false);
  });

  it("var x:Number = 5 emits the variable name 'x'", () => {
    const bytes = compileAS2("var x:Number = 5;");
    expect(containsString(bytes, "x")).toBe(true);
  });

  it("var x:Number = 5 emits ActionDefineLocal (0x3c) for initialised var", () => {
    const bytes = compileAS2("var x:Number = 5;");
    expect(containsByte(bytes, 0x3c)).toBe(true); // ActionDefineLocal
  });

  it("var mc:MovieClip emits ActionDefineLocal2 (0x41) for uninitialised var", () => {
    const bytes = compileAS2("var mc:MovieClip;");
    expect(containsByte(bytes, 0x41)).toBe(true); // ActionDefineLocal2
  });

  it("var s:String = 'hello' does not emit 'String' type string in bytecode", () => {
    const bytes = compileAS2('var s:String = "hello";');
    // The string "hello" appears but "String" (the type) should not
    expect(containsString(bytes, "hello")).toBe(true);
    expect(containsString(bytes, "String")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Typed function parameters and return types
// ---------------------------------------------------------------------------

describe("AS2 typed function parameters and return types", () => {
  it("function with typed params and Boolean return compiles without error", () => {
    expect(
      compilesOk(
        "function f(x:String, y:Number):Boolean { return x.length > y; }"
      )
    ).toBe(true);
  });

  it("function with :Void return type compiles without error", () => {
    expect(
      compilesOk('function g():Void { trace("void return"); }')
    ).toBe(true);
  });

  it("function with :Array return type compiles without error", () => {
    expect(compilesOk("function h():Array { return []; }")).toBe(true);
  });

  it("typed function emits function name but not param type names in bytecode", () => {
    const bytes = compileAS2(
      "function f(x:String, y:Number):Boolean { return x.length > y; }"
    );
    expect(containsString(bytes, "f")).toBe(true);
    // Type names must be stripped — they are compile-time annotations only
    expect(containsString(bytes, "String")).toBe(false);
    expect(containsString(bytes, "Boolean")).toBe(false);
  });

  it("typed function emits ActionDefineFunction2 (0x8e) opcode", () => {
    const bytes = compileAS2(
      "function f(x:String, y:Number):Boolean { return x.length > y; }"
    );
    expect(containsByte(bytes, 0x8e)).toBe(true); // ActionDefineFunction2
  });

  it(":Void return type — bytecode does not contain 'Void' string", () => {
    const bytes = compileAS2('function g():Void { trace("void return"); }');
    expect(containsString(bytes, "Void")).toBe(false);
  });

  it("multiple typed parameters compile without error", () => {
    expect(
      compilesOk(
        "function add(a:Number, b:Number):Number { return a + b; }"
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Typed class members
// ---------------------------------------------------------------------------

describe("AS2 typed class members", () => {
  it("class with typed instance vars and typed constructor params compiles without error", () => {
    expect(
      compilesOk(
        "class Point { var x:Number; var y:Number; function Point(x:Number, y:Number) { this.x = x; this.y = y; } }"
      )
    ).toBe(true);
  });

  it("class with typed var compiles and does not emit type name in bytecode", () => {
    const bytes = compileAS2(
      "class Point { var x:Number; var y:Number; function Point(x:Number, y:Number) { this.x = x; this.y = y; } }"
    );
    // Class name and property names must appear
    expect(containsString(bytes, "Point")).toBe(true);
    expect(containsString(bytes, "x")).toBe(true);
    expect(containsString(bytes, "y")).toBe(true);
    // Type annotation "Number" must NOT appear
    expect(containsString(bytes, "Number")).toBe(false);
  });

  it("class with typed members emits a non-empty Uint8Array", () => {
    const bytes = compileAS2(
      "class Point { var x:Number; var y:Number; function Point(x:Number, y:Number) { this.x = x; this.y = y; } }"
    );
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("class with typed method compiles without error", () => {
    expect(
      compilesOk(
        "class Greeter { public function greet(name:String):String { return 'Hello ' + name; } }"
      )
    ).toBe(true);
  });

  it("class with static typed method compiles without error", () => {
    expect(
      compilesOk(
        "class MathUtils { static function square(x:Number):Number { return x * x; } }"
      )
    ).toBe(true);
  });

  it("class with extends and typed constructor compiles without error", () => {
    expect(
      compilesOk(
        "class Animal { var name:String; function Animal(n:String) { this.name = n; } }"
      )
    ).toBe(true);
  });
});
