/**
 * Tests for AS2 compiler: LoadVars and SharedObject construction and method calls.
 *
 * Verifies that LoadVars and SharedObject constructor calls, instance method
 * calls, property accesses, and callbacks compile without error and emit
 * the correct AVM1 opcodes:
 *   - ActionNew        (0x40): constructor calls (new LoadVars(), etc.)
 *   - ActionCallMethod (0x52): method calls (lv.load(), lv.send(), etc.)
 *   - ActionGetMember  (0x4e): property reads (lv.getBytesLoaded, etc.)
 *   - ActionSetMember  (0x4f): property writes (lv.onLoad = ..., so.data.score = ...)
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

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

function containsByte(bytes: Uint8Array, byte: number): boolean {
  return bytes.includes(byte);
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
// AVM1 opcodes under test
// ---------------------------------------------------------------------------

const ACTION_NEW         = 0x40; // ActionNew        — constructor call
const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read
const ACTION_SET_MEMBER  = 0x4f; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// LoadVars constructor
// ---------------------------------------------------------------------------

describe("LoadVars constructor", () => {
  it("new LoadVars() compiles without error", () => {
    expect(compilesOk("var lv = new LoadVars();")).toBe(true);
  });

  it("new LoadVars() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("var lv = new LoadVars();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "LoadVars")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LoadVars.load()
// ---------------------------------------------------------------------------

describe("LoadVars.load()", () => {
  it('lv.load("data.txt") compiles without error', () => {
    expect(compilesOk('var lv = new LoadVars(); lv.load("data.txt");')).toBe(true);
  });

  it('lv.load("data.txt") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var lv = new LoadVars(); lv.load("data.txt");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "load")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LoadVars.send()
// ---------------------------------------------------------------------------

describe("LoadVars.send()", () => {
  it('lv.send("submit.php") compiles without error', () => {
    expect(compilesOk('var lv = new LoadVars(); lv.send("submit.php");')).toBe(true);
  });

  it('lv.send("submit.php") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var lv = new LoadVars(); lv.send("submit.php");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "send")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LoadVars.sendAndLoad()
// ---------------------------------------------------------------------------

describe("LoadVars.sendAndLoad()", () => {
  it('lv.sendAndLoad("submit.php", target) compiles without error', () => {
    expect(compilesOk('var lv = new LoadVars(); var target = new LoadVars(); lv.sendAndLoad("submit.php", target);')).toBe(true);
  });

  it('lv.sendAndLoad("submit.php", target) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var lv = new LoadVars(); var target = new LoadVars(); lv.sendAndLoad("submit.php", target);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "sendAndLoad")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LoadVars.onLoad callback assignment
// ---------------------------------------------------------------------------

describe("LoadVars.onLoad callback", () => {
  it("lv.onLoad = function(success) {} compiles without error", () => {
    expect(compilesOk('var lv = new LoadVars(); lv.onLoad = function(success) {};')).toBe(true);
  });

  it("lv.onLoad = function(success) {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2('var lv = new LoadVars(); lv.onLoad = function(success) {};');
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onLoad")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LoadVars.getBytesLoaded()
// ---------------------------------------------------------------------------

describe("LoadVars.getBytesLoaded()", () => {
  it("lv.getBytesLoaded() compiles without error", () => {
    expect(compilesOk('var lv = new LoadVars(); lv.getBytesLoaded();')).toBe(true);
  });

  it("lv.getBytesLoaded() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('var lv = new LoadVars(); lv.getBytesLoaded();');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getBytesLoaded")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SharedObject.getLocal()
// ---------------------------------------------------------------------------

describe("SharedObject.getLocal()", () => {
  it('SharedObject.getLocal("prefs") compiles without error', () => {
    expect(compilesOk('var so = SharedObject.getLocal("prefs");')).toBe(true);
  });

  it('SharedObject.getLocal("prefs") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var so = SharedObject.getLocal("prefs");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getLocal")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SharedObject data property assignment
// ---------------------------------------------------------------------------

describe("SharedObject data property assignment", () => {
  it("so.data.score = 100 compiles without error", () => {
    expect(compilesOk('var so = SharedObject.getLocal("prefs"); so.data.score = 100;')).toBe(true);
  });

  it("so.data.score = 100 emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2('var so = SharedObject.getLocal("prefs"); so.data.score = 100;');
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "score")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SharedObject.flush()
// ---------------------------------------------------------------------------

describe("SharedObject.flush()", () => {
  it("so.flush() compiles without error", () => {
    expect(compilesOk('var so = SharedObject.getLocal("prefs"); so.flush();')).toBe(true);
  });

  it("so.flush() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('var so = SharedObject.getLocal("prefs"); so.flush();');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "flush")).toBe(true);
  });
});
