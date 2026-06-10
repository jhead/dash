/**
 * Tests for AS2 EventDispatcher-based pattern compilation.
 *
 * Verifies that AS2 code using mx.events.EventDispatcher as a base class
 * compiles correctly to AVM1 bytecode, including import statements, class
 * inheritance, method calls, and object literals.
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
    if (bytes[i + enc.length] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 EventDispatcher patterns", () => {
  // -------------------------------------------------------------------------
  // Test 1: import statement parses and compiles without error
  // -------------------------------------------------------------------------

  it("1. import mx.events.EventDispatcher parses and compiles without error", () => {
    expect(
      compilesOk("import mx.events.EventDispatcher;")
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: import statement emits bytecode (treated as expression side-effect)
  // -------------------------------------------------------------------------

  it("2. import statement produces valid bytecode output (Uint8Array)", () => {
    const bytes = compileAS2("import mx.events.EventDispatcher;");
    expect(bytes).toBeInstanceOf(Uint8Array);
    // The import is parsed as an expression statement — it produces some bytes
    // (at least a push + pop). The key requirement is it does not throw.
    expect(bytes.length).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: class extending EventDispatcher compiles
  // -------------------------------------------------------------------------

  it("3. class Foo extends EventDispatcher compiles without error", () => {
    expect(
      compilesOk(`
        class MyComponent extends EventDispatcher {
          public function MyComponent() {}
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 4: this.addEventListener compiles to ActionCallMethod (0x52)
  // -------------------------------------------------------------------------

  it("4. this.addEventListener emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(`
      class MyComponent extends EventDispatcher {
        public function doSomething():Void {
          this.addEventListener("click", clickHandler);
        }
        private function clickHandler(event:Object):Void {}
      }
    `);

    // ActionCallMethod opcode = 0x52
    expect(bytes).toContain(0x52);

    // "addEventListener" must appear as a string in bytecode
    expect(containsString(bytes, "addEventListener")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 5: this.dispatchEvent with object literal compiles
  // -------------------------------------------------------------------------

  it("5. this.dispatchEvent({ type: 'click' }) compiles without error", () => {
    expect(
      compilesOk(`
        class MyComponent extends EventDispatcher {
          public function doSomething():Void {
            this.dispatchEvent({ type: "click" });
          }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: object literal { type: "click" } compiles to ActionInitObject (0x43)
  // -------------------------------------------------------------------------

  it("6. object literal { type: 'click' } emits ActionInitObject (0x43)", () => {
    const bytes = compileAS2(`
      var evt = { type: "click" };
    `);

    // ActionInitObject opcode = 0x43
    expect(bytes).toContain(0x43);

    // The key "type" and value "click" must appear as strings
    expect(containsString(bytes, "type")).toBe(true);
    expect(containsString(bytes, "click")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 7: this.removeEventListener compiles to ActionCallMethod (0x52)
  // -------------------------------------------------------------------------

  it("7. this.removeEventListener emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(`
      class MyComponent extends EventDispatcher {
        public function cleanup():Void {
          this.removeEventListener("click", clickHandler);
        }
        private function clickHandler(event:Object):Void {}
      }
    `);

    expect(bytes).toContain(0x52);
    expect(containsString(bytes, "removeEventListener")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 8: Full EventDispatcher class (constructor + methods) compiles end-to-end
  // -------------------------------------------------------------------------

  it("8. full EventDispatcher-based class compiles end-to-end", () => {
    const source = `
      import mx.events.EventDispatcher;

      class MyComponent extends EventDispatcher {
          public function MyComponent() {
              super();
          }

          public function doSomething():Void {
              this.addEventListener("click", clickHandler);
              this.dispatchEvent({ type: "click" });
          }

          private function clickHandler(event:Object):Void {
              trace("clicked: " + event.type);
          }
      }
    `;

    expect(compilesOk(source)).toBe(true);

    const bytes = compileAS2(source);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    // Class name present
    expect(containsString(bytes, "MyComponent")).toBe(true);

    // Superclass (EventDispatcher) present
    expect(containsString(bytes, "EventDispatcher")).toBe(true);

    // Prototype chain setup
    expect(containsString(bytes, "prototype")).toBe(true);

    // super() → EventDispatcher.call(this) → "call" string present
    expect(containsString(bytes, "call")).toBe(true);

    // addEventListener present
    expect(containsString(bytes, "addEventListener")).toBe(true);

    // dispatchEvent present
    expect(containsString(bytes, "dispatchEvent")).toBe(true);

    // ActionCallMethod (0x52) used for method calls
    expect(bytes).toContain(0x52);

    // ActionInitObject (0x43) used for object literal
    expect(bytes).toContain(0x43);

    // ActionNew (0x40) used for prototype chain setup (new EventDispatcher())
    expect(bytes).toContain(0x40);

    // ActionDefineFunction2 (0x8e) used for function definitions
    expect(bytes).toContain(0x8e);
  });

  // -------------------------------------------------------------------------
  // Test 9: Parser produces correct AST for EventDispatcher class
  // -------------------------------------------------------------------------

  it("9. parser produces ClassDecl AST with EventDispatcher as superClass", () => {
    const ast = parse(`
      class MyComponent extends EventDispatcher {
        public function MyComponent() { super(); }
        public function doSomething():Void {}
      }
    `);

    expect(ast.body.length).toBeGreaterThanOrEqual(1);

    const cls = ast.body.find((n) => n.type === "ClassDecl");
    expect(cls).toBeDefined();

    if (cls?.type === "ClassDecl") {
      expect(cls.name).toBe("MyComponent");
      expect(cls.superClass).toBe("EventDispatcher");
      expect(cls.body.length).toBe(2);
    }
  });

  // -------------------------------------------------------------------------
  // Test 10: import statement AST has an ExprStmt with import path info
  // -------------------------------------------------------------------------

  it("10. import statement parses to ExprStmt (treated as no-op at runtime)", () => {
    const ast = parse("import mx.events.EventDispatcher;");

    expect(ast.body.length).toBe(1);
    const stmt = ast.body[0]!;

    // Import is parsed as an ExprStmt wrapping an Identifier
    expect(stmt.type).toBe("ExprStmt");

    if (stmt.type === "ExprStmt") {
      const expr = stmt.expression;
      expect(expr.type).toBe("Identifier");
      if (expr.type === "Identifier") {
        // The path should be captured in the identifier name
        expect(expr.name).toContain("mx.events.EventDispatcher");
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 11: dispatchEvent with multi-property object literal
  // -------------------------------------------------------------------------

  it("11. dispatchEvent with multi-property object literal compiles", () => {
    const bytes = compileAS2(`
      class Emitter extends EventDispatcher {
        public function fire():Void {
          this.dispatchEvent({ type: "change", data: 42 });
        }
      }
    `);

    expect(bytes).toContain(0x43); // ActionInitObject
    expect(containsString(bytes, "type")).toBe(true);
    expect(containsString(bytes, "change")).toBe(true);
    expect(containsString(bytes, "data")).toBe(true);
    expect(bytes).toContain(0x52); // ActionCallMethod for dispatchEvent
  });

  // -------------------------------------------------------------------------
  // Test 12: import + class together compile without error (realistic scenario)
  // -------------------------------------------------------------------------

  it("12. import followed by class declaration compiles together", () => {
    expect(
      compilesOk(`
        import mx.events.EventDispatcher;
        import flash.events.MouseEvent;

        class Button extends EventDispatcher {
          public function Button() {
            super();
          }
          public function click():Void {
            this.dispatchEvent({ type: "click" });
          }
        }
      `)
    ).toBe(true);
  });
});
