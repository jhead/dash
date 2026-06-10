/**
 * Tests for AS2 compiler: XMLSocket and LoadVars built-ins.
 *
 * Verifies that XMLSocket and LoadVars constructor calls, instance method
 * calls, property accesses, and callbacks compile without error and emit
 * the correct AVM1 opcodes:
 *   - ActionNew        (0x40): constructor calls (new XMLSocket(), new LoadVars())
 *   - ActionCallMethod (0x52): method calls (xs.connect(), xs.send(), xs.close(), etc.)
 *   - ActionGetMember  (0x4e): property reads (lv.loaded)
 *   - ActionSetMember  (0x4f): property writes (xs.onConnect = ..., xs.onData = ..., lv.onLoad = ...)
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
// XMLSocket constructor
// ---------------------------------------------------------------------------

describe("XMLSocket constructor", () => {
  it("new XMLSocket() compiles without error", () => {
    expect(compilesOk("var xs = new XMLSocket();")).toBe(true);
  });

  it("new XMLSocket() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("var xs = new XMLSocket();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "XMLSocket")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// XMLSocket.connect()
// ---------------------------------------------------------------------------

describe("XMLSocket.connect()", () => {
  it('xs.connect("host", 1234) compiles without error', () => {
    expect(compilesOk('var xs = new XMLSocket(); xs.connect("host", 1234);')).toBe(true);
  });

  it('xs.connect("host", 1234) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var xs = new XMLSocket(); xs.connect("host", 1234);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "connect")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// XMLSocket.send()
// ---------------------------------------------------------------------------

describe("XMLSocket.send()", () => {
  it('xs.send("hello") compiles without error', () => {
    expect(compilesOk('var xs = new XMLSocket(); xs.send("hello");')).toBe(true);
  });

  it('xs.send("hello") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var xs = new XMLSocket(); xs.send("hello");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "send")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// XMLSocket.close()
// ---------------------------------------------------------------------------

describe("XMLSocket.close()", () => {
  it("xs.close() compiles without error", () => {
    expect(compilesOk("var xs = new XMLSocket(); xs.close();")).toBe(true);
  });

  it("xs.close() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var xs = new XMLSocket(); xs.close();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "close")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// XMLSocket.onConnect callback assignment
// ---------------------------------------------------------------------------

describe("XMLSocket.onConnect callback", () => {
  it("xs.onConnect = function(ok) {} compiles without error", () => {
    expect(compilesOk("var xs = new XMLSocket(); xs.onConnect = function(ok) { trace(ok); };")).toBe(true);
  });

  it("xs.onConnect = function(ok) {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var xs = new XMLSocket(); xs.onConnect = function(ok) { trace(ok); };");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onConnect")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// XMLSocket.onData callback assignment
// ---------------------------------------------------------------------------

describe("XMLSocket.onData callback", () => {
  it("xs.onData = function(s) {} compiles without error", () => {
    expect(compilesOk("var xs = new XMLSocket(); xs.onData = function(s) { trace(s); };")).toBe(true);
  });

  it("xs.onData = function(s) {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var xs = new XMLSocket(); xs.onData = function(s) { trace(s); };");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onData")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LoadVars constructor (via xmlsocket.test.ts coverage)
// ---------------------------------------------------------------------------

describe("LoadVars constructor (xmlsocket suite)", () => {
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

describe("LoadVars.load() (xmlsocket suite)", () => {
  it('lv.load("http://example.com/data.txt") compiles without error', () => {
    expect(compilesOk('var lv = new LoadVars(); lv.load("http://example.com/data.txt");')).toBe(true);
  });

  it('lv.load("http://example.com/data.txt") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var lv = new LoadVars(); lv.load("http://example.com/data.txt");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "load")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LoadVars.sendAndLoad()
// ---------------------------------------------------------------------------

describe("LoadVars.sendAndLoad() (xmlsocket suite)", () => {
  it('lv.sendAndLoad("url", target, "POST") compiles without error', () => {
    expect(compilesOk('var lv = new LoadVars(); var target = new LoadVars(); lv.sendAndLoad("url", target, "POST");')).toBe(true);
  });

  it('lv.sendAndLoad("url", target, "POST") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var lv = new LoadVars(); var target = new LoadVars(); lv.sendAndLoad("url", target, "POST");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "sendAndLoad")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LoadVars.onLoad callback assignment
// ---------------------------------------------------------------------------

describe("LoadVars.onLoad callback (xmlsocket suite)", () => {
  it("lv.onLoad = function(ok) {} compiles without error", () => {
    expect(compilesOk("var lv = new LoadVars(); lv.onLoad = function(ok) {};")).toBe(true);
  });

  it("lv.onLoad = function(ok) {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var lv = new LoadVars(); lv.onLoad = function(ok) {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onLoad")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LoadVars.loaded property read
// ---------------------------------------------------------------------------

describe("LoadVars.loaded property read (xmlsocket suite)", () => {
  it("if (lv.loaded) {} compiles without error", () => {
    expect(compilesOk("var lv = new LoadVars(); if (lv.loaded) {}")).toBe(true);
  });

  it("if (lv.loaded) {} emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var lv = new LoadVars(); if (lv.loaded) {}");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "loaded")).toBe(true);
  });
});
