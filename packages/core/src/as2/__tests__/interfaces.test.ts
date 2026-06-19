/**
 * Tests for AS2 interface declarations and the `implements` keyword.
 *
 * In AS2/AVM1, interfaces are purely compile-time constructs. No bytecode is
 * emitted for `interface` declarations or `implements` clauses on classes.
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

describe("AS2 interface declarations and implements keyword", () => {
  // -------------------------------------------------------------------------
  // Test 1: Empty interface compiles without error
  // -------------------------------------------------------------------------

  it("1. empty interface compiles without error", () => {
    expect(compilesOk("interface IFoo {}")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: Interface with method signatures compiles without error
  // -------------------------------------------------------------------------

  it("2. interface with method signatures compiles without error", () => {
    expect(
      compilesOk(`
        interface IAnimal {
          function speak():Void;
          function move(dx:Number, dy:Number):Void;
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: Interface with extends compiles without error
  // -------------------------------------------------------------------------

  it("3. interface with extends compiles without error", () => {
    expect(
      compilesOk(`
        interface IBase {
          function getId():Number;
        }
        interface IDerived extends IBase {
          function getName():String;
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 4: Interface emits an empty constructor (task 1299)
  // -------------------------------------------------------------------------

  it("4. interface declaration emits its constructor so implements can resolve it", () => {
    // An AS2 interface MUST exist as a global constructor function at runtime so
    // a class's `implements` clause (compiled to ActionImplementsOp, which does
    // ActionGetVariable "IEmpty") resolves to a real value. We emit
    // `IEmpty = function() {};` (ActionDefineFunction2 0x8e + ActionSetVariable
    // 0x1d). Previously this was a no-op (0 bytes), which left implements broken.
    const bytes = compileAS2("interface IEmpty {}");
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes).toContain(0x8e); // ActionDefineFunction2 (the empty ctor)
    expect(bytes).toContain(0x1d); // ActionSetVariable (binds the interface name)
  });

  // -------------------------------------------------------------------------
  // Test 5: Class with implements compiles without error
  // -------------------------------------------------------------------------

  it("5. class with implements compiles without error", () => {
    expect(
      compilesOk(`
        interface IRunnable {
          function run():Void;
        }
        class Task implements IRunnable {
          function Task() {}
          function run():Void {}
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: Class with implements emits correct class bytecode
  //         (same structure as a class without implements)
  // -------------------------------------------------------------------------

  it("6. class with implements emits ActionImplementsOp and correct class bytecode", () => {
    const withImpl = compileAS2(`
      class Worker implements IRunnable {
        function Worker() {}
      }
    `);

    const withoutImpl = compileAS2(`
      class Worker {
        function Worker() {}
      }
    `);

    // With implements must be longer (contains ActionImplementsOp extra bytes)
    expect(withImpl.length).toBeGreaterThan(withoutImpl.length);

    // ActionImplementsOp (0x2c) must appear in the implements variant
    expect(withImpl).toContain(0x2c);
    expect(withoutImpl).not.toContain(0x2c);

    // The class name should appear in the bytecode
    expect(containsString(withImpl, "Worker")).toBe(true);

    // The interface name must appear in the implements bytecode
    expect(containsString(withImpl, "IRunnable")).toBe(true);

    // ActionDefineFunction2 (0x8e) must be emitted for the constructor
    expect(withImpl).toContain(0x8e);
  });

  // -------------------------------------------------------------------------
  // Test 7: Class implementing multiple interfaces compiles without error
  // -------------------------------------------------------------------------

  it("7. class implementing multiple interfaces compiles without error", () => {
    expect(
      compilesOk(`
        interface IBar {
          function bar():Void;
        }
        interface IBaz {
          function baz():Void;
        }
        class Foo implements IBar, IBaz {
          function Foo() {}
          function bar():Void {}
          function baz():Void {}
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 8: Interface extending another interface — parser shape check
  // -------------------------------------------------------------------------

  it("8. interface extending another interface has correct AST shape", () => {
    const ast = parse(`
      interface IBase {
        function getId():Number;
      }
      interface IFoo extends IBase {
        function getName():String;
      }
    `);

    expect(ast.body.length).toBe(2);

    const base = ast.body[0]!;
    expect(base.type).toBe("InterfaceDecl");
    if (base.type === "InterfaceDecl") {
      expect(base.name).toBe("IBase");
      expect(base.superInterfaces).toEqual([]);
      expect(base.body.length).toBe(1);
    }

    const derived = ast.body[1]!;
    expect(derived.type).toBe("InterfaceDecl");
    if (derived.type === "InterfaceDecl") {
      expect(derived.name).toBe("IFoo");
      expect(derived.superInterfaces).toEqual(["IBase"]);
      expect(derived.body.length).toBe(1);
    }
  });

  // -------------------------------------------------------------------------
  // Bonus: implements list is parsed into ClassDecl.interfaces
  // -------------------------------------------------------------------------

  it("9. implements list is captured in ClassDecl AST", () => {
    const ast = parse("class Foo implements IBar, IBaz {}");

    expect(ast.body.length).toBe(1);
    const cls = ast.body[0]!;
    expect(cls.type).toBe("ClassDecl");
    if (cls.type === "ClassDecl") {
      expect(cls.interfaces).toEqual(["IBar", "IBaz"]);
    }
  });
});
