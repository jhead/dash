/**
 * Tests for AS2 interface keyword support.
 *
 * Verifies that `interface` declarations and `implements` clauses are parsed
 * and compiled correctly. In AVM1/AS2, interfaces are purely compile-time
 * constructs — no bytecode is emitted for them.
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
// IAnimal / Dog fixture used across multiple tests
// ---------------------------------------------------------------------------

const IANIMAL_DOG_SOURCE = `
  interface IAnimal {
    function getName():String;
  }
  class Dog implements IAnimal {
    var name:String;
    function Dog(n:String) { this.name = n; }
    function getName():String { return name; }
  }
`;

// ---------------------------------------------------------------------------

describe("AS2 interface keyword support", () => {
  // -------------------------------------------------------------------------
  // Test 1: Interface declaration compiles without error
  // -------------------------------------------------------------------------

  it("1. interface declaration compiles without error", () => {
    expect(compilesOk("interface IAnimal { function getName():String; }")).toBe(
      true
    );
  });

  // -------------------------------------------------------------------------
  // Test 2: implements IAnimal on a class compiles without error
  // -------------------------------------------------------------------------

  it("2. implements IAnimal on a class compiles without error", () => {
    expect(compilesOk(IANIMAL_DOG_SOURCE)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: Class implementing interface still produces correct prototype chain
  // -------------------------------------------------------------------------

  it("3. class implementing interface produces correct prototype chain bytecode", () => {
    const withImpl = compileAS2(IANIMAL_DOG_SOURCE);

    // Class name must appear
    expect(containsString(withImpl, "Dog")).toBe(true);

    // Instance method getName must be on prototype
    expect(containsString(withImpl, "prototype")).toBe(true);
    expect(containsString(withImpl, "getName")).toBe(true);

    // ActionDefineFunction2 (0x8e) for constructor + instance method
    expect(withImpl).toContain(0x8e);

    // ActionSetMember (0x4f) to assign onto prototype
    expect(withImpl).toContain(0x4f);

    // The bytecode with implements should be identical to without implements
    const withoutImpl = compileAS2(`
      class Dog {
        var name:String;
        function Dog(n:String) { this.name = n; }
        function getName():String { return name; }
      }
    `);
    expect(withImpl).toEqual(withoutImpl);
  });

  // -------------------------------------------------------------------------
  // Test 4: Interface with multiple methods compiles
  // -------------------------------------------------------------------------

  it("4. interface with multiple methods compiles without error", () => {
    expect(
      compilesOk(`
        interface IVehicle {
          function start():Void;
          function stop():Void;
          function accelerate(speed:Number):Void;
          function getSpeed():Number;
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 5: interface ICar extends IVehicle compiles without error
  // -------------------------------------------------------------------------

  it("5. interface extending another interface compiles without error", () => {
    expect(
      compilesOk(`
        interface IVehicle {
          function getSpeed():Number;
        }
        interface ICar extends IVehicle {
          function getModel():String;
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: Interface declaration emits no bytecode
  // -------------------------------------------------------------------------

  it("6. interface declaration emits no bytecode", () => {
    const bytes = compileAS2("interface IAnimal { function getName():String; }");
    expect(bytes.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 7: Class implementing interface produces same bytecode as without
  // -------------------------------------------------------------------------

  it("7. implements clause is purely compile-time — no extra bytecode", () => {
    const withImpl = compileAS2(`
      class Cat implements IAnimal {
        function Cat() {}
        function getName():String { return "Cat"; }
      }
    `);
    const withoutImpl = compileAS2(`
      class Cat {
        function Cat() {}
        function getName():String { return "Cat"; }
      }
    `);
    expect(withImpl).toEqual(withoutImpl);
  });

  // -------------------------------------------------------------------------
  // Test 8: Class implementing multiple interfaces compiles without error
  // -------------------------------------------------------------------------

  it("8. class implementing multiple interfaces compiles without error", () => {
    expect(
      compilesOk(`
        interface IRunnable {
          function run():Void;
        }
        interface ISerializable {
          function serialize():String;
        }
        class Task implements IRunnable, ISerializable {
          function Task() {}
          function run():Void {}
          function serialize():String { return "task"; }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 9: Parser correctly captures interface AST shape
  // -------------------------------------------------------------------------

  it("9. parser produces InterfaceDecl AST with correct shape", () => {
    const ast = parse(`
      interface IAnimal {
        function getName():String;
      }
    `);

    expect(ast.body.length).toBe(1);
    const iface = ast.body[0]!;
    expect(iface.type).toBe("InterfaceDecl");
    if (iface.type === "InterfaceDecl") {
      expect(iface.name).toBe("IAnimal");
      expect(iface.superInterfaces).toEqual([]);
      expect(iface.body.length).toBe(1);
    }
  });

  // -------------------------------------------------------------------------
  // Test 10: Parser captures implements list in ClassDecl
  // -------------------------------------------------------------------------

  it("10. parser captures implements list in ClassDecl.interfaces", () => {
    const ast = parse("class Dog implements IAnimal {}");

    expect(ast.body.length).toBe(1);
    const cls = ast.body[0]!;
    expect(cls.type).toBe("ClassDecl");
    if (cls.type === "ClassDecl") {
      expect(cls.interfaces).toEqual(["IAnimal"]);
    }
  });

  // -------------------------------------------------------------------------
  // Test 11: Parser captures interface extends in InterfaceDecl
  // -------------------------------------------------------------------------

  it("11. parser captures interface extends in InterfaceDecl.superInterfaces", () => {
    const ast = parse(`
      interface ICar extends IVehicle {}
    `);

    expect(ast.body.length).toBe(1);
    const iface = ast.body[0]!;
    expect(iface.type).toBe("InterfaceDecl");
    if (iface.type === "InterfaceDecl") {
      expect(iface.name).toBe("ICar");
      expect(iface.superInterfaces).toEqual(["IVehicle"]);
    }
  });
});
