/**
 * Tests for AS2 TextFormat class built-in compilation.
 *
 * Verifies that TextFormat construction, property assignments, and usage with
 * TextField compile correctly and emit the correct AVM1 opcodes:
 *   - ActionNew        (0x40): constructor calls (new TextFormat())
 *   - ActionSetMember  (0x4f): property writes (fmt.font = ..., etc.)
 *   - ActionGetMember  (0x4e): property reads (var f = fmt.font)
 *   - ActionCallMethod (0x52): method calls (tf.setTextFormat(fmt))
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
const ACTION_SET_MEMBER  = 0x4f; // ActionSetMember  — property write
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read
const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch

// ---------------------------------------------------------------------------
// 1. var fmt = new TextFormat()
// ---------------------------------------------------------------------------

describe("TextFormat constructor", () => {
  it("var fmt = new TextFormat() compiles without error", () => {
    expect(compilesOk("var fmt = new TextFormat();")).toBe(true);
  });

  it("var fmt = new TextFormat() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("var fmt = new TextFormat();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "TextFormat")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. fmt.font = "Arial"
// ---------------------------------------------------------------------------

describe("TextFormat font property", () => {
  it('fmt.font = "Arial" compiles without error', () => {
    expect(compilesOk('var fmt = new TextFormat(); fmt.font = "Arial";')).toBe(true);
  });

  it('fmt.font = "Arial" emits ActionSetMember (0x4f)', () => {
    const bytes = compileAS2('var fmt = new TextFormat(); fmt.font = "Arial";');
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "font")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. fmt.size = 12
// ---------------------------------------------------------------------------

describe("TextFormat size property", () => {
  it("fmt.size = 12 compiles without error", () => {
    expect(compilesOk("var fmt = new TextFormat(); fmt.size = 12;")).toBe(true);
  });

  it("fmt.size = 12 emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var fmt = new TextFormat(); fmt.size = 12;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "size")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. fmt.bold = true
// ---------------------------------------------------------------------------

describe("TextFormat bold property", () => {
  it("fmt.bold = true compiles without error", () => {
    expect(compilesOk("var fmt = new TextFormat(); fmt.bold = true;")).toBe(true);
  });

  it("fmt.bold = true emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var fmt = new TextFormat(); fmt.bold = true;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "bold")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. fmt.italic = false
// ---------------------------------------------------------------------------

describe("TextFormat italic property", () => {
  it("fmt.italic = false compiles without error", () => {
    expect(compilesOk("var fmt = new TextFormat(); fmt.italic = false;")).toBe(true);
  });

  it("fmt.italic = false emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var fmt = new TextFormat(); fmt.italic = false;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "italic")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. fmt.underline = false
// ---------------------------------------------------------------------------

describe("TextFormat underline property", () => {
  it("fmt.underline = false compiles without error", () => {
    expect(compilesOk("var fmt = new TextFormat(); fmt.underline = false;")).toBe(true);
  });

  it("fmt.underline = false emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var fmt = new TextFormat(); fmt.underline = false;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "underline")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. fmt.color = 0x000000
// ---------------------------------------------------------------------------

describe("TextFormat color property", () => {
  it("fmt.color = 0x000000 compiles without error", () => {
    expect(compilesOk("var fmt = new TextFormat(); fmt.color = 0x000000;")).toBe(true);
  });

  it("fmt.color = 0x000000 emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var fmt = new TextFormat(); fmt.color = 0x000000;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "color")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. fmt.align = "left"
// ---------------------------------------------------------------------------

describe("TextFormat align property", () => {
  it('fmt.align = "left" compiles without error', () => {
    expect(compilesOk('var fmt = new TextFormat(); fmt.align = "left";')).toBe(true);
  });

  it('fmt.align = "left" emits ActionSetMember (0x4f)', () => {
    const bytes = compileAS2('var fmt = new TextFormat(); fmt.align = "left";');
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "align")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. fmt.leftMargin = 5
// ---------------------------------------------------------------------------

describe("TextFormat leftMargin property", () => {
  it("fmt.leftMargin = 5 compiles without error", () => {
    expect(compilesOk("var fmt = new TextFormat(); fmt.leftMargin = 5;")).toBe(true);
  });

  it("fmt.leftMargin = 5 emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var fmt = new TextFormat(); fmt.leftMargin = 5;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "leftMargin")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. fmt.leading = 2
// ---------------------------------------------------------------------------

describe("TextFormat leading property", () => {
  it("fmt.leading = 2 compiles without error", () => {
    expect(compilesOk("var fmt = new TextFormat(); fmt.leading = 2;")).toBe(true);
  });

  it("fmt.leading = 2 emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var fmt = new TextFormat(); fmt.leading = 2;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "leading")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. var f = fmt.font  (ActionGetMember)
// ---------------------------------------------------------------------------

describe("TextFormat font property read", () => {
  it("var f = fmt.font compiles without error", () => {
    expect(compilesOk('var fmt = new TextFormat(); fmt.font = "Arial"; var f = fmt.font;')).toBe(true);
  });

  it("var f = fmt.font emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2('var fmt = new TextFormat(); fmt.font = "Arial"; var f = fmt.font;');
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "font")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. Full pattern: new TextFormat + set properties + setTextFormat
// ---------------------------------------------------------------------------

describe("TextFormat full usage pattern", () => {
  it("var fmt = new TextFormat(); fmt.font=...; fmt.size=14; tf.setTextFormat(fmt) compiles without error", () => {
    expect(
      compilesOk(
        'var tf = new Object(); var fmt = new TextFormat(); fmt.font = "Arial"; fmt.size = 14; tf.setTextFormat(fmt);'
      )
    ).toBe(true);
  });

  it("full pattern emits ActionNew (0x40), ActionSetMember (0x4f), ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      'var tf = new Object(); var fmt = new TextFormat(); fmt.font = "Arial"; fmt.size = 14; tf.setTextFormat(fmt);'
    );
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "TextFormat")).toBe(true);
    expect(containsString(bytes, "setTextFormat")).toBe(true);
  });
});
