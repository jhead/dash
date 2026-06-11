/**
 * Tests for AS2 compiler: new Array() / new Object() emit ActionNewObject (0x40).
 *
 * Flash 8's `new Array(...)` and `new Object()` are generic constructor calls
 * handled via ActionNewObject (0x40) in AVM1.
 *
 * AVM1 ActionNewObject pops from the stack TOP first:
 *   1. className string  ← must be on TOP (pushed last)
 *   2. nArgs count
 *   3. arg[0] (first argument)
 *   4. ...
 *   5. arg[n-1] (last argument, deepest)
 *
 * Correct push order: args deepest-first (arg[n-1] first), then nArgs, then
 * className LAST (on top). This mirrors ActionCallFunction which also puts the
 * function name on top.
 *
 * None of these should emit ActionCallFunction (0x3D).
 *
 * Task 0924: verify new Array()/new Object() emit ActionNewObject (0x40).
 * Task 1081: verify className bytes appear AFTER nArgs in the compiled output
 *            (i.e. className is pushed last = closer to ActionNewObject opcode).
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsByte(bytes: Uint8Array, byte: number): boolean {
  return bytes.includes(byte);
}

/** Returns true if the exact null-terminated UTF-8 string s appears in bytes. */
function containsString(bytes: Uint8Array, s: string): boolean {
  return stringOffset(bytes, s) !== -1;
}

/**
 * Returns the byte offset of the first occurrence of the null-terminated
 * UTF-8 string s in bytes, or -1 if not found.
 */
function stringOffset(bytes: Uint8Array, s: string): number {
  const enc = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= bytes.length - enc.length; i++) {
    for (let j = 0; j < enc.length; j++) {
      if (bytes[i + j] !== enc[j]) continue outer;
    }
    if (bytes[i + enc.length] === 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Opcode constants
// ---------------------------------------------------------------------------

const ACTION_NEW_OBJECT    = 0x40; // ActionNewObject   — constructor call
const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction — must NOT appear

// ---------------------------------------------------------------------------
// new Array()
// ---------------------------------------------------------------------------

describe("new Array() — no-arg constructor", () => {
  it("new Array() emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2("new Array();");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("new Array() pushes 'Array' as class name string", () => {
    const bytes = compileAS2("new Array();");
    expect(containsString(bytes, "Array")).toBe(true);
  });

  it("new Array() does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("new Array();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// new Array(1, 2, 3)
// ---------------------------------------------------------------------------

describe("new Array(1,2,3) — three-arg constructor", () => {
  it("new Array(1,2,3) emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2("new Array(1, 2, 3);");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("new Array(1,2,3) pushes 'Array' as class name string", () => {
    const bytes = compileAS2("new Array(1, 2, 3);");
    expect(containsString(bytes, "Array")).toBe(true);
  });

  it("new Array(1,2,3) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("new Array(1, 2, 3);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// new Object()
// ---------------------------------------------------------------------------

describe("new Object() — no-arg constructor", () => {
  it("new Object() emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2("new Object();");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("new Object() pushes 'Object' as class name string", () => {
    const bytes = compileAS2("new Object();");
    expect(containsString(bytes, "Object")).toBe(true);
  });

  it("new Object() does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("new Object();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// new MyClass(arg) — generic single-arg constructor (regression guard)
// ---------------------------------------------------------------------------

describe("new MyClass(arg) — generic single-arg constructor", () => {
  it("new MyClass(arg) emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2("new MyClass(arg);");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("new MyClass(arg) pushes 'MyClass' as class name string", () => {
    const bytes = compileAS2("new MyClass(arg);");
    expect(containsString(bytes, "MyClass")).toBe(true);
  });

  it("new MyClass(arg) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("new MyClass(arg);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Byte-order verification (task 1081)
// AVM1 ActionNewObject pops className FIRST (top of stack = last pushed).
// The compiler uses a constant pool (ActionConstantPool 0x88 at offset 0), so
// string bytes live in the pool header — not inline in push order. Instead we
// verify the ORDER of ActionPush (0x96) instructions in the body relative to
// ActionNewObject (0x40) by decoding push sequences.
//
// Each ActionPush is: 0x96 <UI16 len> <payload bytes…>
// For a pool-index push the payload is [type=8, idx] (2 bytes total, len=2)
//   or [type=9, idxLo, idxHi] (3 bytes total, len=3).
// For an integer push the payload is [type=7, i0, i1, i2, i3] (5 bytes, len=5).
//
// To verify that className is pushed LAST (just before 0x40), we:
//  1. Locate ActionNewObject (0x40) in the body.
//  2. Decode all ActionPush instructions up to that point.
//  3. The push immediately before 0x40 must be a string pool-index push, and
//     the pool index it references must correspond to the className string
//     (found at that index in the ActionConstantPool block at the start).
// ---------------------------------------------------------------------------

/**
 * Decode the ActionConstantPool (0x88) block at the start of bytes.
 * Returns an array of strings indexed by pool position, or null if not found.
 */
function decodeConstantPool(bytes: Uint8Array): string[] | null {
  if (bytes[0] !== 0x88) return null;
  const len = bytes[1]! | (bytes[2]! << 8);
  const count = bytes[3]! | (bytes[4]! << 8);
  const strings: string[] = [];
  let pos = 5;
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    let end = pos;
    while (end < bytes.length && bytes[end] !== 0) end++;
    strings.push(dec.decode(bytes.slice(pos, end)));
    pos = end + 1;
  }
  // sanity: pos should equal 1 + 2 + len (opcode not included in len)
  return strings;
}

/**
 * Returns an array of decoded push values (in push order) for all ActionPush
 * (0x96) instructions that appear BEFORE the first ActionNewObject (0x40)
 * opcode after the ActionConstantPool block.
 *
 * Each element is either a string (for pool-index pushes) or a number (for
 * integer pushes) or 'other' for other types.
 */
function decodePushesBeforeNewObject(
  bytes: Uint8Array,
  pool: string[]
): Array<string | number> {
  // Skip the ConstantPool block at the start
  let pos = 0;
  if (bytes[pos] === 0x88) {
    const len = bytes[1]! | (bytes[2]! << 8);
    pos = 1 + 2 + len; // skip opcode(1) + UI16len(2) + payload(len)
  }

  const pushes: Array<string | number> = [];
  while (pos < bytes.length) {
    const op = bytes[pos]!;
    if (op === 0x40) break; // ActionNewObject — stop
    if (op === 0x96) {
      // ActionPush
      const len = bytes[pos + 1]! | (bytes[pos + 2]! << 8);
      const type = bytes[pos + 3]!;
      if (type === 8) {
        // UI8 pool index
        const idx = bytes[pos + 4]!;
        pushes.push(pool[idx] ?? `<pool[${idx}]>`);
      } else if (type === 9) {
        // UI16 pool index
        const idx = bytes[pos + 4]! | (bytes[pos + 5]! << 8);
        pushes.push(pool[idx] ?? `<pool[${idx}]>`);
      } else if (type === 7) {
        // SI32 integer
        const v = new DataView(bytes.buffer, bytes.byteOffset + pos + 4).getInt32(0, true);
        pushes.push(v);
      } else {
        pushes.push('other');
      }
      pos += 1 + 2 + len;
    } else {
      // Unknown / other opcode — skip (no payload for opcodes < 0x80)
      if (op < 0x80) {
        pos += 1;
      } else {
        const len = bytes[pos + 1]! | (bytes[pos + 2]! << 8);
        pos += 1 + 2 + len;
      }
    }
  }
  return pushes;
}

describe("ActionNewObject byte order — className pushed last (task 1081)", () => {
  it("new MyClass('hello') — push sequence ends with nArgs=1, className='MyClass'", () => {
    // Correct push order (deepest first, top last):
    //   push 'hello'  (arg[0], deepest)
    //   push 1        (nArgs)
    //   push 'MyClass' (className, TOP — last push before ActionNewObject)
    const bytes = compileAS2("new MyClass('hello');");
    const pool = decodeConstantPool(bytes);
    expect(pool).not.toBeNull();
    const pushes = decodePushesBeforeNewObject(bytes, pool!);
    // Last push must be the className
    expect(pushes[pushes.length - 1]).toBe("MyClass");
    // Second-to-last must be nArgs=1
    expect(pushes[pushes.length - 2]).toBe(1);
    // Third-to-last must be the arg string 'hello'
    expect(pushes[pushes.length - 3]).toBe("hello");
  });

  it("new Foo(1, 2) — push sequence ends with nArgs=2, className='Foo'", () => {
    // Correct push order: arg[1]=2 (deepest), arg[0]=1, nArgs=2, 'Foo' (top)
    const bytes = compileAS2("new Foo(1, 2);");
    const pool = decodeConstantPool(bytes);
    expect(pool).not.toBeNull();
    const pushes = decodePushesBeforeNewObject(bytes, pool!);
    expect(pushes[pushes.length - 1]).toBe("Foo");       // className on top
    expect(pushes[pushes.length - 2]).toBe(2);            // nArgs
    expect(pushes[pushes.length - 3]).toBe(1);            // arg[0]
    expect(pushes[pushes.length - 4]).toBe(2);            // arg[1] (deepest)
  });

  it("new Array() no-arg — push sequence ends with nArgs=0, className='Array'", () => {
    // Correct push order: nArgs=0 (only push), 'Array' (top)
    const bytes = compileAS2("new Array();");
    const pool = decodeConstantPool(bytes);
    expect(pool).not.toBeNull();
    const pushes = decodePushesBeforeNewObject(bytes, pool!);
    expect(pushes[pushes.length - 1]).toBe("Array");     // className on top
    expect(pushes[pushes.length - 2]).toBe(0);            // nArgs=0
  });
});
