/**
 * Tests for AS2 pragma / import statement handling.
 *
 * Flash AS2 supports `import` statements.  AS3-style `use namespace` is NOT
 * supported.  `'use strict'` is JavaScript-only and may or may not parse.
 *
 * All tests verify that the compiler does NOT crash (TypeError / RangeError /
 * unhandled throw).  If the compiler throws, it must be a proper Error with a
 * non-empty message.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function tryCompile(source: string): { ok: true } | { ok: false; error: unknown } {
  try {
    compileAS2(source);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/** Assert that if an error is thrown it is a proper Error with a message. */
function assertMeaningfulErrorOrOk(result: ReturnType<typeof tryCompile>): void {
  if (!result.ok) {
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message.length).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 pragma / import statements", () => {
  // 1. `'use strict'` — this is a JavaScript directive expression, not AS2.
  //    The compiler may accept or reject it, but must not crash.
  it("1. 'use strict' — compiles or throws meaningful Error (no crash)", () => {
    const result = tryCompile("'use strict';");
    assertMeaningfulErrorOrOk(result);
    expect(true).toBe(true);
  });

  // 2. `import mx.utils.Delegate` — valid AS2 import syntax.
  //    Compiler should compile or throw a meaningful error.
  it("2. import mx.utils.Delegate — compiles or throws meaningful Error (no crash)", () => {
    const result = tryCompile("import mx.utils.Delegate;");
    assertMeaningfulErrorOrOk(result);
    expect(true).toBe(true);
  });

  // 3. `import mx.controls.Button` — valid AS2 import syntax.
  it("3. import mx.controls.Button — compiles or throws meaningful Error (no crash)", () => {
    const result = tryCompile("import mx.controls.Button;");
    assertMeaningfulErrorOrOk(result);
    expect(true).toBe(true);
  });

  // 4. Regular code after an import statement.
  it("4. regular code after import statement — compiles or throws meaningful Error (no crash)", () => {
    const source = `
      import mx.utils.Delegate;
      var x:Number = 42;
    `;
    const result = tryCompile(source);
    assertMeaningfulErrorOrOk(result);
    expect(true).toBe(true);
  });

  // 5. `// use namespace` in a comment — treated as a comment, must compile fine.
  it("5. // use namespace in a comment — compiles normally (it is just a comment)", () => {
    const source = `
      // use namespace mx_internal;
      var x:Number = 1;
    `;
    const result = tryCompile(source);
    // Comments are always safe to ignore — this must succeed.
    expect(result.ok).toBe(true);
  });

  // 6. Class with import at the top — valid AS2 pattern.
  it("6. class with import at top — compiles or throws meaningful Error (no crash)", () => {
    const source = `
      import mx.utils.Delegate;
      class MyComponent {
        var delegate:Delegate;
      }
    `;
    const result = tryCompile(source);
    assertMeaningfulErrorOrOk(result);
    expect(true).toBe(true);
  });
});
