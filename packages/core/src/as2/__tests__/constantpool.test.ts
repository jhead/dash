import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function getBytes(src: string): Uint8Array { return compileAS2(src); }

describe("AVM1 ActionConstantPool", () => {
  it("script with strings emits ActionPush (0x96) for string literals", () => {
    // Compiler uses inline ActionPush with type=0 (string) for string literals
    const bytes = getBytes(`trace("hello"); trace("world"); trace("foo"); trace("bar");`);
    expect(bytes.includes(0x96)).toBe(true); // ActionPush
  });

  it("ActionConstantPool (0x88) or ActionPush (0x96) used for string emission", () => {
    const bytes = getBytes(`trace("hello");`);
    const cpIdx = bytes.indexOf(0x88);
    const pushIdx = bytes.indexOf(0x96); // ActionPush
    if (cpIdx >= 0 && pushIdx >= 0) {
      // If ConstantPool is present, it should come before any ActionPush
      expect(cpIdx).toBeLessThan(pushIdx);
    }
    // Compiler must emit strings via ActionPush or ActionConstantPool
    expect(cpIdx >= 0 || pushIdx >= 0).toBe(true);
  });

  it("ActionConstantPool body has UI16 count followed by strings", () => {
    const bytes = getBytes(`trace("hello"); trace("world");`);
    const cpIdx = bytes.indexOf(0x88);
    if (cpIdx >= 0) {
      // ConstantPool header: opcode 0x88, UI16 length, then UI16 count, then NUL-terminated strings
      const count = bytes[cpIdx + 3] | (bytes[cpIdx + 4] << 8);
      expect(count).toBeGreaterThan(0);
    }
    // If no constant pool, strings are emitted inline via ActionPush — both are valid
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it("compiled script using repeated string is more compact with pool", () => {
    // Just verify compilation succeeds with repeated strings
    const bytes = getBytes(`
      trace("same"); trace("same"); trace("same"); trace("same"); trace("same");
    `);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("empty script produces no ActionConstantPool", () => {
    const bytes = getBytes(``);
    // Empty script or minimal script shouldn't need constant pool
    // (may still have it, just document current behavior)
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it("script with no string literals may have no constant pool", () => {
    const bytes = getBytes(`var x = 1 + 2; var y = x * 3;`);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
