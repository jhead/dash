import { describe, it, expect } from "vitest";
import { compileAS2, CompileError } from "../compiler.js";

/**
 * Task 1403 — the AS2 compiler must raise a clear compile-time diagnostic when a
 * generated script exceeds an AVM1/SWF 16-bit encoding limit, instead of wrapping
 * the field mod 65536 and silently emitting a corrupt tag (the "Length mismatch
 * in AVM1 action" desync). Constant-pool overflow is handled gracefully by
 * capping the pool (strings beyond the cap inline), so it must NOT corrupt output.
 */

/** Build a source string of `n` distinct trivial statements. */
function repeatStmt(n: number, make: (i: number) => string): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(make(i));
  return parts.join("\n");
}

describe("AS2 compiler overflow diagnostics (task 1403)", () => {
  it("throws a clear CompileError when a function body exceeds the UI16 codeSize limit", () => {
    // ~15000 statements compiles well past the 65535-byte codeSize limit.
    const body = repeatStmt(15000, (i) => `acc = acc + ${i % 9};`);
    const src = `function big() {\n${body}\n}`;
    let err: unknown;
    try {
      compileAS2(src);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CompileError);
    expect((err as Error).message).toMatch(/codeSize|function-body/i);
    // The function name and its source line are surfaced for the author.
    expect((err as Error).message).toContain("big");
    expect((err as Error).message).toMatch(/line 1/);
  });

  it("throws a clear CompileError when a branch offset exceeds the SI16 range", () => {
    // A top-level if whose body compiles past 32767 bytes cannot be skipped by a
    // single signed-16-bit ActionIf offset.
    const body = repeatStmt(6000, (i) => `acc = acc + ${i % 9};`);
    const src = `if (cond) {\n${body}\n}`;
    let err: unknown;
    try {
      compileAS2(src);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CompileError);
    expect((err as Error).message).toMatch(/out of range|16-bit signed/i);
  });

  it("caps the constant pool at the UI16 budget and inlines the overflow (no corruption)", () => {
    // Far more distinct string literals than fit in one ActionConstantPool
    // record: the pool must cap at the UI16 payload budget and the remaining
    // strings fall back to inline ActionPush — never a wrapped count/length that
    // would corrupt the tag.
    const N = 66000;
    const src = repeatStmt(N, (i) => `trace("s${i}");`);
    let bytes: Uint8Array | undefined;
    expect(() => {
      bytes = compileAS2(src);
    }).not.toThrow();
    expect(bytes).toBeDefined();
    // The ActionConstantPool (0x88) is present and its UI16 record length and
    // count both fit the field (no wrap-around).
    expect(bytes![0]).toBe(0x88);
    const payloadLen = bytes![1]! | (bytes![2]! << 8);
    const count = bytes![3]! | (bytes![4]! << 8);
    expect(payloadLen).toBeLessThanOrEqual(0xffff);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(N); // capped: not every string got pooled
    // At least one overflow string must appear as an inline ActionPush (type 0)
    // in the action stream after the pool header — proving graceful fallback.
    const cpEnd = 3 + payloadLen;
    let hasInlineString = false;
    for (let i = cpEnd; i < bytes!.length - 2; i++) {
      if (bytes![i] !== 0x96) continue; // ActionPush
      const pLen = bytes![i + 1]! | (bytes![i + 2]! << 8);
      if (bytes![i + 3] === 0x00) {
        // first push element is a type-0 inline string
        hasInlineString = true;
        break;
      }
      i += 2 + pLen - 1;
    }
    expect(hasInlineString).toBe(true);
  });

  it("CompileError carries the offending source line for the codeSize case", () => {
    const body = repeatStmt(15000, (i) => `acc = acc + ${i % 9};`);
    // Function declared on line 3.
    const src = `var a = 1;\nvar b = 2;\nfunction huge() {\n${body}\n}`;
    let err: CompileError | undefined;
    try {
      compileAS2(src);
    } catch (e) {
      err = e as CompileError;
    }
    expect(err).toBeInstanceOf(CompileError);
    expect(err!.line).toBe(3);
    expect(err!.message).toMatch(/line 3/);
  });

  it("compiles a normal (in-range) script without raising an overflow error", () => {
    const src = `
      function loop() {
        var i = 0;
        while (i < 10) {
          trace("i=" + i);
          i = i + 1;
        }
      }
      loop();
    `;
    expect(() => compileAS2(src)).not.toThrow();
  });
});
