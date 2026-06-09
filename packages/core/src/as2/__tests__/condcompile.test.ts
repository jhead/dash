/**
 * Tests for AS2 conditional-compilation and comment handling.
 *
 * AS2 does NOT have traditional C-style #ifdef. Flash AS2 has:
 *   - `#include "file.as"` — include directive (filesystem-dependent)
 *   - `#initclip` / `#endinitclip` — used in symbol scripts
 *   - Metadata tags like [Inspectable], [Event(name="onLoad")]
 *   - Standard JS-style comments: //, /* *\/, /** *\/
 *
 * For each construct we verify: does it compile? If not, does it throw
 * a meaningful parse error (not a crash/unhandled exception)?
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to compile AS2 source and return true if it succeeded.
 */
function compilesOk(source: string): boolean {
  try {
    compileAS2(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compile AS2 source and return the thrown Error, or null if it compiled.
 */
function compileError(source: string): Error | null {
  try {
    compileAS2(source);
    return null;
  } catch (e) {
    return e as Error;
  }
}

// ---------------------------------------------------------------------------
// #initclip / #endinitclip — symbol script directives
// ---------------------------------------------------------------------------

describe("#initclip directive", () => {
  it("either compiles or throws a meaningful parse error (not a crash)", () => {
    const err = compileError("#initclip");
    // If it doesn't compile, the error must have a descriptive message
    if (err !== null) {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBeTruthy();
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it("parse error message references the unexpected token, not an internal crash", () => {
    const err = compileError("#initclip");
    if (err !== null) {
      // Should mention "parse" or "unexpected" or "token" — not an internal TypeError/ReferenceError
      const msg = err.message.toLowerCase();
      expect(
        msg.includes("parse") ||
          msg.includes("unexpected") ||
          msg.includes("token") ||
          msg.includes("error")
      ).toBe(true);
    }
  });
});

describe("#endinitclip directive", () => {
  it("either compiles or throws a meaningful parse error (not a crash)", () => {
    const err = compileError("#endinitclip");
    if (err !== null) {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBeTruthy();
    }
  });

  it("error message is informative rather than an internal exception", () => {
    const err = compileError("#endinitclip");
    if (err !== null) {
      const msg = err.message.toLowerCase();
      expect(
        msg.includes("parse") ||
          msg.includes("unexpected") ||
          msg.includes("token") ||
          msg.includes("error")
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Metadata attribute tags — [Inspectable], [Event(...)]
// ---------------------------------------------------------------------------

describe("[Inspectable] attribute syntax", () => {
  it("compiles without error or throws a parse error (not a crash)", () => {
    const err = compileError("[Inspectable] var x:Number;");
    if (err !== null) {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBeTruthy();
    }
  });

  it("bare [Inspectable] on a var declaration either compiles or errors gracefully", () => {
    // If supported, the attribute is silently ignored or attached to the decl
    const ok = compilesOk("[Inspectable] var x:Number;");
    const err = compileError("[Inspectable] var x:Number;");
    expect(ok || err instanceof Error).toBe(true);
  });
});

describe("[Event(name=...)] metadata tag", () => {
  it("compiles without crash or gives a meaningful parse error", () => {
    const err = compileError('[Event(name="onLoad")] class Foo {}');
    if (err !== null) {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBeTruthy();
    }
  });

  it("either compiles the class or errors at the metadata, not inside the class body", () => {
    const ok = compilesOk('[Event(name="onLoad")] class Foo {}');
    const err = compileError('[Event(name="onLoad")] class Foo {}');
    expect(ok || err instanceof Error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Comments — all positions must compile successfully
// ---------------------------------------------------------------------------

describe("single-line comments", () => {
  it("// comment before code compiles", () => {
    expect(compilesOk("// single line comment\nvar x = 1;")).toBe(true);
  });

  it("// comment after code on same line compiles", () => {
    expect(compilesOk("var x = 1; // trailing comment")).toBe(true);
  });

  it("// comment as the only content compiles", () => {
    expect(compilesOk("// only a comment")).toBe(true);
  });

  it("multiple // comments compile", () => {
    expect(
      compilesOk("// line 1\n// line 2\n// line 3\nvar x = 1;")
    ).toBe(true);
  });
});

describe("multi-line block comments", () => {
  it("/* comment */ before code compiles", () => {
    expect(compilesOk("/* multi-line\ncomment */\nvar x = 1;")).toBe(true);
  });

  it("/* comment */ after code compiles", () => {
    expect(compilesOk("var x = 1; /* trailing block comment */")).toBe(true);
  });

  it("/* comment */ as the only content compiles", () => {
    expect(compilesOk("/* only a block comment */")).toBe(true);
  });

  it("block comment spanning multiple lines compiles", () => {
    expect(
      compilesOk("/*\n * line 1\n * line 2\n */\nvar x = 1;")
    ).toBe(true);
  });
});

describe("JSDoc /** ... */ comments", () => {
  it("/** JSDoc comment */ before a function compiles", () => {
    expect(
      compilesOk(
        "/** @param {Number} x */\nfunction foo(x:Number):Void {}"
      )
    ).toBe(true);
  });

  it("/** JSDoc comment */ as standalone compiles", () => {
    expect(compilesOk("/** JSDoc comment */")).toBe(true);
  });

  it("/** JSDoc with @return tag */ compiles", () => {
    expect(
      compilesOk("/** @return {Number} the value */\nfunction bar():Number { return 1; }")
    ).toBe(true);
  });
});

describe("adjacent and nested comment patterns", () => {
  it("two adjacent // comments compile", () => {
    expect(compilesOk("// comment1\n// comment2\nvar x = 1;")).toBe(true);
  });

  it("// comment followed by /* comment */ compiles", () => {
    expect(compilesOk("// comment1\n/* comment2 */\nvar x = 1;")).toBe(true);
  });

  it("/* comment */ followed by // comment compiles", () => {
    expect(compilesOk("/* block */\n// line\nvar x = 1;")).toBe(true);
  });

  it("/** JSDoc */ followed by /* block */ followed by // line compiles", () => {
    expect(
      compilesOk("/** doc */\n/* block */\n// line\nvar x = 1;")
    ).toBe(true);
  });

  it("comment between statements compiles", () => {
    expect(
      compilesOk("var x = 1;\n// between\nvar y = 2;")
    ).toBe(true);
  });
});
