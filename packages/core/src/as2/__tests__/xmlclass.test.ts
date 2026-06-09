/**
 * Tests for AS2 compiler: XML and XMLNode object construction, property
 * access, and method calls.
 *
 * Verifies that XML/XMLNode constructor calls, instance method calls, property
 * accesses, and static property assignments compile without error and emit
 * the correct AVM1 opcodes:
 *   - ActionNew        (0x4a): constructor calls (new XML(), new XMLNode(...))
 *   - ActionCallMethod (0x52): method calls (x.appendChild(), x.load(), etc.)
 *   - ActionGetMember  (0x4f): property reads (x.firstChild, x.childNodes, etc.)
 *   - ActionSetMember  (0x4e): static property assignment (XML.ignoreWhite = true)
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

const ACTION_NEW         = 0x4a; // ActionNew        — constructor call
const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_GET_MEMBER  = 0x4f; // ActionGetMember  — property read
const ACTION_SET_MEMBER  = 0x4e; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// XML constructor
// ---------------------------------------------------------------------------

describe("XML constructor", () => {
  it("new XML() compiles without error", () => {
    expect(compilesOk("new XML();")).toBe(true);
  });

  it("new XML() emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("new XML();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "XML")).toBe(true);
  });

  it("var x = new XML() compiles without error", () => {
    expect(compilesOk("var x = new XML();")).toBe(true);
  });

  it("var x = new XML() emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("var x = new XML();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "XML")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// XMLNode constructor
// ---------------------------------------------------------------------------

describe("XMLNode constructor", () => {
  it('new XMLNode(1, "tag") compiles without error', () => {
    expect(compilesOk('new XMLNode(1, "tag");')).toBe(true);
  });

  it('new XMLNode(1, "tag") emits ActionNew (0x4a)', () => {
    const bytes = compileAS2('new XMLNode(1, "tag");');
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "XMLNode")).toBe(true);
  });

  it('var node = new XMLNode(1, "tag") compiles without error', () => {
    expect(compilesOk('var node = new XMLNode(1, "tag");')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// XML property reads
// ---------------------------------------------------------------------------

describe("XML property reads", () => {
  it("x.firstChild compiles without error", () => {
    expect(compilesOk("var x = new XML(); x.firstChild;")).toBe(true);
  });

  it("x.firstChild emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var x = new XML(); x.firstChild;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "firstChild")).toBe(true);
  });

  it("x.childNodes compiles without error", () => {
    expect(compilesOk("var x = new XML(); x.childNodes;")).toBe(true);
  });

  it("x.childNodes emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var x = new XML(); x.childNodes;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "childNodes")).toBe(true);
  });

  it("x.attributes compiles without error", () => {
    expect(compilesOk("var x = new XML(); x.attributes;")).toBe(true);
  });

  it("x.attributes emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var x = new XML(); x.attributes;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "attributes")).toBe(true);
  });

  it("x.nodeName compiles without error", () => {
    expect(compilesOk("var x = new XML(); x.nodeName;")).toBe(true);
  });

  it("x.nodeName emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var x = new XML(); x.nodeName;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "nodeName")).toBe(true);
  });

  it("x.nodeValue compiles without error", () => {
    expect(compilesOk("var x = new XML(); x.nodeValue;")).toBe(true);
  });

  it("x.nodeValue emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var x = new XML(); x.nodeValue;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "nodeValue")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// XML method calls
// ---------------------------------------------------------------------------

describe("XML method calls", () => {
  it("x.appendChild(node) compiles without error", () => {
    expect(compilesOk('var x = new XML(); var node = new XMLNode(1, "tag"); x.appendChild(node);')).toBe(true);
  });

  it("x.appendChild(node) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('var x = new XML(); var node = new XMLNode(1, "tag"); x.appendChild(node);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "appendChild")).toBe(true);
  });

  it('x.load("data.xml") compiles without error', () => {
    expect(compilesOk('var x = new XML(); x.load("data.xml");')).toBe(true);
  });

  it('x.load("data.xml") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var x = new XML(); x.load("data.xml");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "load")).toBe(true);
  });

  it('x.parseXML("<root/>") compiles without error', () => {
    expect(compilesOk('var x = new XML(); x.parseXML("<root/>");')).toBe(true);
  });

  it('x.parseXML("<root/>") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var x = new XML(); x.parseXML("<root/>");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "parseXML")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// XML static property assignment
// ---------------------------------------------------------------------------

describe("XML static property assignment", () => {
  it("XML.ignoreWhite = true compiles without error", () => {
    expect(compilesOk("XML.ignoreWhite = true;")).toBe(true);
  });

  it("XML.ignoreWhite = true emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("XML.ignoreWhite = true;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "ignoreWhite")).toBe(true);
    expect(containsString(bytes, "XML")).toBe(true);
  });
});
