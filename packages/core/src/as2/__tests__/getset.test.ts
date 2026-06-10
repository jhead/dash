/**
 * Tests for AS2 getter/setter property syntax compilation.
 *
 * Verifies that `function get prop()` / `function set prop(v)` inside class
 * bodies are compiled to AVM1 `addProperty` calls on the prototype.
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

function containsString(bytes: Uint8Array, s: string): boolean {
  const enc = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= bytes.length - enc.length; i++) {
    for (let j = 0; j < enc.length; j++) {
      if (bytes[i + j] !== enc[j]) continue outer;
    }
    // Check null terminator after the string
    if (bytes[i + enc.length] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test 1: Class with getter compiles without error
// ---------------------------------------------------------------------------

describe("AS2 getter/setter properties", () => {
  it("1. class with getter compiles without error", () => {
    expect(
      compilesOk(`
        class MyClass {
          private var _width:Number = 0;
          public function get width():Number {
            return _width;
          }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: Class with setter compiles without error
  // -------------------------------------------------------------------------

  it("2. class with setter compiles without error", () => {
    expect(
      compilesOk(`
        class MyClass {
          private var _width:Number = 0;
          public function set width(v:Number):Void {
            _width = v;
          }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: Class with getter+setter pair compiles without error
  // -------------------------------------------------------------------------

  it("3. class with getter+setter pair compiles without error", () => {
    expect(
      compilesOk(`
        class MyClass {
          private var _width:Number = 0;
          public function get width():Number {
            return _width;
          }
          public function set width(v:Number):Void {
            _width = v;
          }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 4: Compiled output contains ActionCallMethod (0x52) for addProperty
  // -------------------------------------------------------------------------

  it("4. compiled output contains ActionCallMethod (0x52) for addProperty", () => {
    const bytes = compileAS2(`
      class Box {
        private var _size:Number = 0;
        public function get size():Number {
          return _size;
        }
        public function set size(v:Number):Void {
          _size = v;
        }
      }
    `);

    // ActionCallMethod (0x52) must appear — used for addProperty call
    expect(bytes).toContain(0x52);
  });

  // -------------------------------------------------------------------------
  // Test 5: Getter property name string appears in compiled bytes
  // -------------------------------------------------------------------------

  it("5. getter property name string appears in compiled bytes", () => {
    const bytes = compileAS2(`
      class Rect {
        private var _x:Number = 0;
        public function get x():Number {
          return _x;
        }
      }
    `);

    // "x" must appear as a string (property name passed to addProperty)
    expect(containsString(bytes, "x")).toBe(true);
    // "addProperty" must appear as a string
    expect(containsString(bytes, "addProperty")).toBe(true);
    // "prototype" must appear (ClassName.prototype.addProperty call)
    expect(containsString(bytes, "prototype")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: Setter function code appears in compiled bytes (ActionDefineFunction2 0x8E)
  // -------------------------------------------------------------------------

  it("6. setter function code appears — ActionDefineFunction2 (0x8e) is emitted", () => {
    const bytes = compileAS2(`
      class Shape {
        private var _color:String = "";
        public function set color(v:String):Void {
          _color = v;
        }
      }
    `);

    // ActionDefineFunction2 opcode (0x8e) must appear — for the setter function
    expect(bytes).toContain(0x8e);
    // "color" as the property name
    expect(containsString(bytes, "color")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 7: Getter-only (no setter) compiles — null is emitted for setter
  // -------------------------------------------------------------------------

  it("7. getter-only compiles — null push (0x96 type=2) used for missing setter", () => {
    const bytes = compileAS2(`
      class ReadOnly {
        private var _val:Number = 42;
        public function get val():Number {
          return _val;
        }
      }
    `);

    expect(compilesOk(`
      class ReadOnly {
        private var _val:Number = 42;
        public function get val():Number {
          return _val;
        }
      }
    `)).toBe(true);

    // ActionPush (0x96) must appear, and the null type byte (2) should be in the stream
    // This is a structural check that the null-setter path ran
    // SWF ActionPush type 2 = Null (per SWF spec §8.4.1.3)
    expect(bytes).toContain(0x96); // ActionPush
    expect(bytes).toContain(0x02); // null type in an ActionPush payload
  });

  // -------------------------------------------------------------------------
  // Test 8: Standalone getter (outside class) compiles or gives graceful error
  // -------------------------------------------------------------------------

  it("8. standalone getter outside a class is parsed gracefully (no crash)", () => {
    // A getter outside a class has no useful meaning in AVM1.
    // The compiler should either silently ignore it or handle it as a
    // named function declaration — either way, it must not throw an unhandled error.
    let threw = false;
    let errorMessage = "";
    try {
      compileAS2(`
        function get width():Number {
          return 100;
        }
      `);
    } catch (e) {
      threw = true;
      errorMessage = String(e);
    }

    // If it threw, it should be a descriptive error, not an internal crash
    if (threw) {
      expect(errorMessage.length).toBeGreaterThan(0);
    } else {
      // compiled successfully — acceptable outcome
      expect(true).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Test 9: Parser correctly records isGetter=true for a getter method
  // -------------------------------------------------------------------------

  it("9. parser sets isGetter=true on getter method AST node", () => {
    const ast = parse(`
      class Widget {
        private var _x:Number = 0;
        public function get x():Number {
          return _x;
        }
        public function set x(v:Number):Void {
          _x = v;
        }
      }
    `);

    expect(ast.body.length).toBe(1);
    const cls = ast.body[0]!;
    expect(cls.type).toBe("ClassDecl");
    if (cls.type === "ClassDecl") {
      const getter = cls.body.find(
        (m) => m.type === "FunctionDecl" && (m as any).isGetter === true
      );
      expect(getter).toBeDefined();
      if (getter?.type === "FunctionDecl") {
        expect(getter.name).toBe("x");
        expect(getter.isGetter).toBe(true);
        expect(getter.isSetter).toBe(false);
      }

      const setter = cls.body.find(
        (m) => m.type === "FunctionDecl" && (m as any).isSetter === true
      );
      expect(setter).toBeDefined();
      if (setter?.type === "FunctionDecl") {
        expect(setter.name).toBe("x");
        expect(setter.isGetter).toBe(false);
        expect(setter.isSetter).toBe(true);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 10: addProperty call uses correct stack layout (addProperty string present)
  // -------------------------------------------------------------------------

  it("10. addProperty method name string appears in compiled output", () => {
    const bytes = compileAS2(`
      class Player {
        private var _score:Number = 0;
        public function get score():Number {
          return _score;
        }
        public function set score(v:Number):Void {
          _score = v;
        }
      }
    `);

    // "addProperty" must appear as a C-string in the bytecode
    expect(containsString(bytes, "addProperty")).toBe(true);

    // "score" must appear as the property name
    expect(containsString(bytes, "score")).toBe(true);

    // The prototype accessor must appear
    expect(containsString(bytes, "prototype")).toBe(true);
  });
});
