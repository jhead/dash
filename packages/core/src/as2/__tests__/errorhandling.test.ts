import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Error class and exception handling", () => {
  it("new Error(message) compiles", () => {
    compilesOk(`var e = new Error("something went wrong");`);
  });

  it("Error.message property compiles", () => {
    compilesOk(`
      var e = new Error("oops");
      var msg = e.message;
    `);
  });

  it("Error.name property compiles", () => {
    compilesOk(`
      var e = new Error("oops");
      var name = e.name;
    `);
  });

  it("throw new Error() compiles", () => {
    compilesOk(`
      throw new Error("something failed");
    `);
  });

  it("throw string literal compiles", () => {
    compilesOk(`
      throw "custom error string";
    `);
  });

  it("throw object compiles", () => {
    compilesOk(`
      throw {code: 404, message: "not found"};
    `);
  });

  it("try/catch block compiles", () => {
    compilesOk(`
      try {
        var x = riskyFunction();
      } catch(e) {
        trace("Error: " + e.message);
      }
    `);
  });

  it("try/catch/finally block compiles", () => {
    compilesOk(`
      try {
        doSomething();
      } catch(err) {
        trace("caught: " + err);
      } finally {
        cleanup();
      }
    `);
  });

  it("try/finally without catch compiles", () => {
    compilesOk(`
      try {
        doRiskyThing();
      } finally {
        alwaysRun();
      }
    `);
  });

  it("nested try/catch compiles", () => {
    compilesOk(`
      try {
        try {
          innerRisky();
        } catch(inner) {
          trace("inner: " + inner.message);
          throw inner;
        }
      } catch(outer) {
        trace("outer: " + outer.message);
      }
    `);
  });

  it("instanceof check in catch compiles", () => {
    compilesOk(`
      try {
        doSomething();
      } catch(e) {
        if (e instanceof Error) {
          trace(e.message);
        }
      }
    `);
  });

  it("custom Error subclass pattern compiles", () => {
    compilesOk(`
      function AppError(msg, code) {
        this.message = msg;
        this.code = code;
        this.name = "AppError";
      }
      AppError.prototype = new Error();
      try {
        throw new AppError("bad request", 400);
      } catch(e) {
        trace(e.code + ": " + e.message);
      }
    `);
  });

  it("throw new Error() emits ActionThrow (0x2a)", () => {
    const bytes = compileAS2(`throw new Error("oops");`);
    expect(bytes).toContain(0x2a); // ActionThrow
  });

  it("try/catch emits ActionTry (0x8f)", () => {
    const bytes = compileAS2(`try { throw "x"; } catch(e) { }`);
    expect(bytes).toContain(0x8f); // ActionTry
    expect(bytes).toContain(0x2a); // ActionThrow
  });
});
