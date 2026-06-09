/**
 * Tests for AS2 compiler: PrintJob object construction, method calls, and
 * property accesses.
 *
 * Verifies that PrintJob constructor calls, instance method calls, and
 * property reads compile without error and emit the correct AVM1 opcodes:
 *   - ActionNew        (0x4a): constructor calls (new PrintJob())
 *   - ActionCallMethod (0x52): method calls (pj.start(), pj.addPage(), pj.send())
 *   - ActionGetMember  (0x4f): property reads (pj.paperWidth, pj.paperHeight, pj.orientation)
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

// ---------------------------------------------------------------------------
// PrintJob constructor
// ---------------------------------------------------------------------------

describe("PrintJob constructor", () => {
  it("new PrintJob() compiles without error", () => {
    expect(compilesOk("new PrintJob();")).toBe(true);
  });

  it("new PrintJob() emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("new PrintJob();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "PrintJob")).toBe(true);
  });

  it("var pj = new PrintJob() compiles without error", () => {
    expect(compilesOk("var pj = new PrintJob();")).toBe(true);
  });

  it("var pj = new PrintJob() emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("var pj = new PrintJob();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "PrintJob")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pj.start()
// ---------------------------------------------------------------------------

describe("PrintJob start()", () => {
  it("pj.start() compiles without error", () => {
    expect(compilesOk("var pj = new PrintJob(); pj.start();")).toBe(true);
  });

  it("pj.start() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var pj = new PrintJob(); pj.start();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "start")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pj.addPage()
// ---------------------------------------------------------------------------

describe("PrintJob addPage()", () => {
  it("pj.addPage(_root, null, null, 1) compiles without error", () => {
    expect(
      compilesOk("var pj = new PrintJob(); pj.addPage(_root, null, null, 1);")
    ).toBe(true);
  });

  it("pj.addPage(_root, null, null, 1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var pj = new PrintJob(); pj.addPage(_root, null, null, 1);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "addPage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pj.send()
// ---------------------------------------------------------------------------

describe("PrintJob send()", () => {
  it("pj.send() compiles without error", () => {
    expect(compilesOk("var pj = new PrintJob(); pj.send();")).toBe(true);
  });

  it("pj.send() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var pj = new PrintJob(); pj.send();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "send")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pj.paperWidth property read
// ---------------------------------------------------------------------------

describe("PrintJob paperWidth property", () => {
  it("pj.paperWidth compiles without error", () => {
    expect(compilesOk("var pj = new PrintJob(); pj.paperWidth;")).toBe(true);
  });

  it("pj.paperWidth emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var pj = new PrintJob(); pj.paperWidth;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "paperWidth")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pj.paperHeight property read
// ---------------------------------------------------------------------------

describe("PrintJob paperHeight property", () => {
  it("pj.paperHeight compiles without error", () => {
    expect(compilesOk("var pj = new PrintJob(); pj.paperHeight;")).toBe(true);
  });

  it("pj.paperHeight emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var pj = new PrintJob(); pj.paperHeight;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "paperHeight")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pj.orientation property read
// ---------------------------------------------------------------------------

describe("PrintJob orientation property", () => {
  it("pj.orientation compiles without error", () => {
    expect(compilesOk("var pj = new PrintJob(); pj.orientation;")).toBe(true);
  });

  it("pj.orientation emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var pj = new PrintJob(); pj.orientation;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "orientation")).toBe(true);
  });
});
