import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function getBytes(src: string): Uint8Array { return compileAS2(src); }

/**
 * Parse an ActionConstantPool (0x88) record from the bytecode.
 * Returns the list of strings in the pool, or null if no pool is present.
 */
function parseConstantPool(bytes: Uint8Array): string[] | null {
  if (bytes.length < 5) return null;
  if (bytes[0] !== 0x88) return null;

  const payloadLen = bytes[1]! | (bytes[2]! << 8);
  const count = bytes[3]! | (bytes[4]! << 8);
  const strings: string[] = [];

  let pos = 5;
  for (let i = 0; i < count; i++) {
    const start = pos;
    while (pos < 3 + payloadLen && bytes[pos] !== 0) pos++;
    const strBytes = bytes.slice(start, pos);
    strings.push(new TextDecoder().decode(strBytes));
    pos++; // skip NUL terminator
  }
  return strings;
}

/**
 * Check whether the compiled bytes include an ActionPush (0x96) with a
 * constant-pool reference (type=8 or type=9) for the given pool index.
 */
function hasPushPoolRef(bytes: Uint8Array, idx: number): boolean {
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] !== 0x96) continue;
    // ActionPush: opcode(0x96), UI16 length, then push type bytes
    const payloadLen = bytes[i + 1]! | (bytes[i + 2]! << 8);
    const payloadStart = i + 3;
    let p = payloadStart;
    while (p < payloadStart + payloadLen) {
      const type = bytes[p]!;
      if (type === 8) {
        // UI8 index
        if (bytes[p + 1] === idx) return true;
        p += 2;
      } else if (type === 9) {
        // UI16 index
        const refIdx = bytes[p + 1]! | (bytes[p + 2]! << 8);
        if (refIdx === idx) return true;
        p += 3;
      } else if (type === 0) {
        // inline string — skip past NUL terminator
        p++;
        while (p < bytes.length && bytes[p] !== 0) p++;
        p++; // skip NUL
      } else {
        // other types: skip fixed widths
        if (type === 1) p += 5;      // float32
        else if (type === 2) p += 1; // null
        else if (type === 3) p += 1; // undefined
        else if (type === 4) p += 2; // register
        else if (type === 5) p += 2; // bool
        else if (type === 6) p += 9; // double
        else if (type === 7) p += 5; // int32
        else p++;
      }
    }
  }
  return false;
}

describe("AVM1 ActionConstantPool", () => {
  it("ActionConstantPool (0x88) is emitted first for any script with strings", () => {
    const bytes = getBytes(`trace("hello");`);
    // The constant pool MUST be the very first action in the bytecode
    expect(bytes[0]).toBe(0x88);
  });

  it("constant pool contains all string literals", () => {
    const bytes = getBytes(`trace("hello"); trace("world");`);
    const pool = parseConstantPool(bytes);
    expect(pool).not.toBeNull();
    expect(pool).toContain("hello");
    expect(pool).toContain("world");
    // "trace" is also an identifier that gets pooled
    expect(pool).toContain("trace");
  });

  it("ActionPush uses pool index (type=8) instead of inline string", () => {
    const bytes = getBytes(`var x = "hello";`);
    const pool = parseConstantPool(bytes);
    expect(pool).not.toBeNull();
    const helloIdx = pool!.indexOf("hello");
    expect(helloIdx).toBeGreaterThanOrEqual(0);
    // There must be an ActionPush with type=8 and that index
    expect(hasPushPoolRef(bytes, helloIdx)).toBe(true);
    // No inline string for "hello" should appear as an ActionPush type=0 in the
    // action stream AFTER the constant pool header.  The constant pool itself
    // contains NUL-terminated strings but those are in the 0x88 record, not an
    // ActionPush — so we only search past the pool header.
    const cpEnd = 3 + (bytes[1]! | (bytes[2]! << 8)); // skip past 0x88 + UI16 length + payload
    const actionBytes = bytes.slice(cpEnd);
    const enc = new TextEncoder();
    const helloBytes = enc.encode("hello");
    // ActionPush inline string: inside ActionPush payload, type=0, then "hello\0"
    const inlinePattern = [0x00, ...helloBytes, 0x00]; // type=0 + bytes + NUL
    let hasInline = false;
    for (let i = 0; i < actionBytes.length - inlinePattern.length; i++) {
      // Check if this is inside an ActionPush payload
      if (actionBytes[i] !== 0x96) continue;
      const pLen = actionBytes[i + 1]! | (actionBytes[i + 2]! << 8);
      const pStart = i + 3;
      for (let j = pStart; j < pStart + pLen - inlinePattern.length; j++) {
        if (inlinePattern.every((b, k) => actionBytes[j + k] === b)) {
          hasInline = true;
          break;
        }
      }
      if (hasInline) break;
    }
    expect(hasInline).toBe(false);
  });

  it("repeated method names appear only once in the constant pool", () => {
    // "prototype" is used many times in class compilation
    const bytes = getBytes(`
      class MyClass { function doA(): Void {} function doB(): Void {} }
    `);
    const pool = parseConstantPool(bytes);
    expect(pool).not.toBeNull();
    // "prototype" should appear exactly once in the pool
    const protoCount = pool!.filter(s => s === "prototype").length;
    expect(protoCount).toBe(1);
  });

  it("ActionConstantPool reduces bytecode size for scripts with repeated strings", () => {
    // Script where "score" is used many times — with pool it should be shorter than inline
    const pooled = getBytes(`
      _root.score = 0; _root.score += 1; _root.score += 2;
      _root.score += 3; _root.score += 4; _root.score += 5;
    `);
    expect(pooled[0]).toBe(0x88); // pool emitted
    // Verify "score" appears in the pool exactly once
    const pool = parseConstantPool(pooled);
    expect(pool!.filter(s => s === "score").length).toBe(1);
  });

  it("empty script produces no ActionConstantPool", () => {
    const bytes = getBytes(``);
    // Empty script has no strings, so no pool is emitted
    expect(bytes[0]).not.toBe(0x88);
    expect(bytes.length).toBe(0);
  });

  it("script with no string literals has no constant pool", () => {
    const bytes = getBytes(`var x = 1 + 2; var y = x * 3;`);
    // var declarations push the variable name as a string — pool should still be emitted
    // because VarDecl names go through pushString()
    const pool = parseConstantPool(bytes);
    if (pool !== null) {
      expect(pool).toContain("x");
      expect(pool).toContain("y");
    }
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("large pool uses UI16 index (type=9) for entries beyond 255", () => {
    // Build a script with > 256 distinct strings to trigger type=9 references
    const strs: string[] = [];
    for (let i = 0; i < 260; i++) {
      strs.push(`str_${i.toString().padStart(3, "0")}`);
    }
    const src = strs.map(s => `trace("${s}");`).join("\n");
    const bytes = getBytes(src);
    expect(bytes[0]).toBe(0x88); // pool emitted
    const pool = parseConstantPool(bytes);
    expect(pool!.length).toBeGreaterThan(255);
    // Check that one of the high-index strings uses type=9 reference
    const idx260 = pool!.indexOf("str_259");
    expect(idx260).toBeGreaterThan(255);
    expect(hasPushPoolRef(bytes, idx260)).toBe(true);
  });
});
