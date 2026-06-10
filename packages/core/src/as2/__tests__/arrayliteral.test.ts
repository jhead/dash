/**
 * Tests for AS2 array and object literal compilation — stack ordering.
 *
 * The critical invariant (verified against Ruffle's action_init_array):
 *   ActionInitArray (0x42) pops count FIRST, then pops each element.
 *   Therefore count must be pushed LAST (on top of the stack), not first.
 *
 * Stack layout before ActionInitArray for [a, b, c]:
 *   ... elem[2]  elem[1]  elem[0]  count(3)   ← top
 *
 * The previous compiler had the count pushed BEFORE elements (at the bottom),
 * causing Ruffle to pop an element as the count → "Stack underflow" warnings.
 *
 * Same invariant applies to ActionInitObject (0x43).
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// AVM1 bytecode decoder
// ---------------------------------------------------------------------------

/** Walk the AVM1 action stream and return flat list of { opcode, payload } */
function decodeActions(bytes: Uint8Array): Array<{ op: number; payload: Uint8Array }> {
  const out: Array<{ op: number; payload: Uint8Array }> = [];
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i]!;
    if (op === 0) break; // ActionEnd
    if (op >= 0x80) {
      const len = bytes[i + 1]! | (bytes[i + 2]! << 8);
      out.push({ op, payload: bytes.slice(i + 3, i + 3 + len) });
      i += 3 + len;
    } else {
      out.push({ op, payload: new Uint8Array(0) });
      i += 1;
    }
  }
  return out;
}

/** Decode all values pushed by ActionPush (0x96) actions. */
function decodePushValues(actions: Array<{ op: number; payload: Uint8Array }>): unknown[] {
  const values: unknown[] = [];
  for (const { op, payload } of actions) {
    if (op !== 0x96) continue;
    let j = 0;
    while (j < payload.length) {
      const type = payload[j++]!;
      switch (type) {
        case 0: { // string
          let end = j;
          while (end < payload.length && payload[end] !== 0) end++;
          values.push(new TextDecoder().decode(payload.slice(j, end)));
          j = end + 1;
          break;
        }
        case 1: { // float (32-bit)
          const buf = new DataView(payload.buffer, payload.byteOffset + j, 4);
          values.push(buf.getFloat32(0, true));
          j += 4;
          break;
        }
        case 2: values.push(null); break;       // null
        case 3: values.push(undefined); break;  // undefined
        case 5: values.push(payload[j++] !== 0); break; // boolean
        case 6: { // double
          const buf = new DataView(payload.buffer, payload.byteOffset + j, 8);
          values.push(buf.getFloat64(0, true));
          j += 8;
          break;
        }
        case 7: { // integer (SI32 LE)
          const buf = new DataView(payload.buffer, payload.byteOffset + j, 4);
          values.push(buf.getInt32(0, true));
          j += 4;
          break;
        }
        default: j = payload.length; // unknown, bail
      }
    }
  }
  return values;
}

/** Return index of last ActionPush value immediately before the given opcode */
function countBeforeOp(bytes: Uint8Array, targetOp: number): number | null {
  const actions = decodeActions(bytes);
  // Find the target opcode
  const targetIdx = actions.findLastIndex(a => a.op === targetOp);
  if (targetIdx < 0) return null;

  // Gather all push values in order up to (not including) targetOp
  // The LAST push before targetOp is the count
  const before = actions.slice(0, targetIdx);
  const values = decodePushValues(before);
  if (values.length === 0) return null;
  return values[values.length - 1] as number;
}

// ---------------------------------------------------------------------------
// Array literal tests
// ---------------------------------------------------------------------------

describe("array literal stack ordering (task 0884)", () => {
  it("[1, 2, 3] — count 3 is the LAST value pushed before ActionInitArray", () => {
    const bytes = compileAS2("var a = [1, 2, 3];");
    const count = countBeforeOp(bytes, 0x42);
    expect(count).toBe(3);
  });

  it("[] — count 0 is the LAST value pushed before ActionInitArray", () => {
    const bytes = compileAS2("var a = [];");
    const count = countBeforeOp(bytes, 0x42);
    expect(count).toBe(0);
  });

  it("[x, y] — count 2 is the LAST value pushed before ActionInitArray", () => {
    const bytes = compileAS2("var a = [x, y];");
    const count = countBeforeOp(bytes, 0x42);
    expect(count).toBe(2);
  });

  it("[f1, f2] in assignment — count 2 is last push before ActionInitArray", () => {
    // Matches: display_mc.filters = [displace, bevel]
    const bytes = compileAS2("display_mc.filters = [f1, f2];");
    const count = countBeforeOp(bytes, 0x42);
    expect(count).toBe(2);
  });

  it("[a] single-element — count 1 is last push before ActionInitArray", () => {
    const bytes = compileAS2("var a = [x];");
    const count = countBeforeOp(bytes, 0x42);
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Object literal tests
// ---------------------------------------------------------------------------

describe("object literal stack ordering (task 0884)", () => {
  it("{x:1} — count 1 is the LAST value pushed before ActionInitObject", () => {
    const bytes = compileAS2("var o = {x: 1};");
    const count = countBeforeOp(bytes, 0x43);
    expect(count).toBe(1);
  });

  it("{x:1, y:2} — count 2 is the LAST value pushed before ActionInitObject", () => {
    const bytes = compileAS2("var o = {x: 1, y: 2};");
    const count = countBeforeOp(bytes, 0x43);
    expect(count).toBe(2);
  });

  it("{} empty object — count 0 is the LAST value pushed before ActionInitObject", () => {
    const bytes = compileAS2("var o = {};");
    const count = countBeforeOp(bytes, 0x43);
    expect(count).toBe(0);
  });
});
