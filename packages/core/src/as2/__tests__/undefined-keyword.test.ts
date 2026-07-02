/**
 * Tests for the AS2 `undefined` keyword literal (task 1374).
 *
 * AVM1 distinguishes null (ActionPush type 2) from undefined (type 3):
 *   - `x === undefined` is always false when x is truly undefined and the RHS
 *     is null; only a type-3 undefined push makes StrictEquals correct.
 *   - `typeof undefined` yields "null" if the value is null, "undefined" if it
 *     is a real undefined.
 *   - `return undefined` stores null instead of undefined.
 *
 * The parser used to intercept the `undefined` keyword and emit
 * Literal{value:null} (type 2). It now emits Identifier{name:'undefined'},
 * routing through compileIdentifier's pushUndefined() → ActionPush type 3.
 *
 * ActionPush (0x96): opcode, UI16 payload length (LE), then a sequence of typed
 * values. Type tag byte: 0=string(NUL-term), 1=float32, 2=null, 3=undefined,
 * 4=register(1B), 5=boolean(1B), 6=double(8B), 7=int32, 8=const8(1B),
 * 9=const16(2B).
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

/** Decode every ActionPush value type tag present in a bytecode buffer. */
function collectPushTypes(bytes: Uint8Array): number[] {
  const types: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i];
    if (op === 0) {
      // ActionEnd
      i += 1;
      continue;
    }
    if (op < 0x80) {
      // no-payload action
      i += 1;
      continue;
    }
    // action with UI16 length
    const len = bytes[i + 1] | (bytes[i + 2] << 8);
    const payloadStart = i + 3;
    const payloadEnd = payloadStart + len;
    if (op === 0x96) {
      let p = payloadStart;
      while (p < payloadEnd) {
        const type = bytes[p];
        types.push(type);
        p += 1;
        switch (type) {
          case 0: // string, NUL-terminated
            while (p < payloadEnd && bytes[p] !== 0) p += 1;
            p += 1; // skip NUL
            break;
          case 1: p += 4; break; // float32
          case 2: break;         // null
          case 3: break;         // undefined
          case 4: p += 1; break; // register
          case 5: p += 1; break; // boolean
          case 6: p += 8; break; // double
          case 7: p += 4; break; // int32
          case 8: p += 1; break; // const8
          case 9: p += 2; break; // const16
          default: p = payloadEnd; break; // unknown → bail this record
        }
      }
    }
    i = payloadEnd;
  }
  return types;
}

const PUSH_UNDEFINED = 3;
const PUSH_NULL = 2;

describe("AS2 undefined keyword literal (task 1374)", () => {
  it("`var x = undefined;` pushes undefined (type 3), not null (type 2)", () => {
    const bytes = compileAS2("var x = undefined;");
    const types = collectPushTypes(bytes);
    expect(types).toContain(PUSH_UNDEFINED);
    expect(types).not.toContain(PUSH_NULL);
  });

  it("`if (x === undefined)` uses ActionPush type 3 and StrictEquals (0x66)", () => {
    const bytes = compileAS2("if (x === undefined) { trace('u'); }");
    const types = collectPushTypes(bytes);
    expect(types).toContain(PUSH_UNDEFINED);
    expect(bytes).toContain(0x66); // ActionStrictEquals
  });

  it("`return undefined;` pushes undefined (type 3), not null", () => {
    const bytes = compileAS2("function f() { return undefined; }");
    const types = collectPushTypes(bytes);
    expect(types).toContain(PUSH_UNDEFINED);
  });

  it("`typeof undefined` pushes undefined (type 3) then ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("var t = typeof undefined;");
    const types = collectPushTypes(bytes);
    expect(types).toContain(PUSH_UNDEFINED);
    expect(bytes).toContain(0x44); // ActionTypeOf
  });

  it("`null` keyword still pushes null (type 2), not undefined — no regression", () => {
    const bytes = compileAS2("var y = null;");
    const types = collectPushTypes(bytes);
    expect(types).toContain(PUSH_NULL);
    expect(types).not.toContain(PUSH_UNDEFINED);
  });

  it("`undefined` used as an argument pushes type 3", () => {
    const bytes = compileAS2("foo(undefined);");
    const types = collectPushTypes(bytes);
    expect(types).toContain(PUSH_UNDEFINED);
    expect(types).not.toContain(PUSH_NULL);
  });
});
