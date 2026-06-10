/**
 * Tests for AS2 compiler: TextField creation, property assignments, method
 * calls, and TextFormat construction and usage.
 *
 * Verifies that TextField and TextFormat API calls compile without error and
 * emit the correct AVM1 opcodes:
 *   - ActionNew        (0x40): constructor calls (new TextFormat())
 *   - ActionCallMethod (0x52): method calls (createTextField(), setTextFormat(), etc.)
 *   - ActionSetMember  (0x4f): property writes (tf.text = ..., fmt.font = ..., etc.)
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
const ACTION_SET_MEMBER  = 0x4f; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// TextField createTextField()
// ---------------------------------------------------------------------------

describe("TextField createTextField()", () => {
  it('_root.createTextField("myTF", 1, 10, 10, 100, 20) compiles without error', () => {
    expect(
      compilesOk('_root.createTextField("myTF", 1, 10, 10, 100, 20);')
    ).toBe(true);
  });

  it('_root.createTextField("myTF", 1, 10, 10, 100, 20) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('_root.createTextField("myTF", 1, 10, 10, 100, 20);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "createTextField")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tf.text property assignment
// ---------------------------------------------------------------------------

describe("TextField text property", () => {
  it('tf.text = "hello" compiles without error', () => {
    expect(
      compilesOk(
        '_root.createTextField("myTF", 1, 10, 10, 100, 20); var tf = _root.myTF; tf.text = "hello";'
      )
    ).toBe(true);
  });

  it('tf.text = "hello" emits ActionSetMember (0x4f)', () => {
    const bytes = compileAS2(
      '_root.createTextField("myTF", 1, 10, 10, 100, 20); var tf = _root.myTF; tf.text = "hello";'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "text")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tf.htmlText property assignment
// ---------------------------------------------------------------------------

describe("TextField htmlText property", () => {
  it('tf.htmlText = "<b>bold</b>" compiles without error', () => {
    expect(
      compilesOk(
        'var tf = new Object(); tf.htmlText = "<b>bold</b>";'
      )
    ).toBe(true);
  });

  it('tf.htmlText = "<b>bold</b>" emits ActionSetMember (0x4f)', () => {
    const bytes = compileAS2(
      'var tf = new Object(); tf.htmlText = "<b>bold</b>";'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "htmlText")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tf.multiline, tf.wordWrap, tf.border property assignments
// ---------------------------------------------------------------------------

describe("TextField multiline property", () => {
  it("tf.multiline = true compiles without error", () => {
    expect(compilesOk("var tf = new Object(); tf.multiline = true;")).toBe(true);
  });

  it("tf.multiline = true emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var tf = new Object(); tf.multiline = true;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "multiline")).toBe(true);
  });
});

describe("TextField wordWrap property", () => {
  it("tf.wordWrap = true compiles without error", () => {
    expect(compilesOk("var tf = new Object(); tf.wordWrap = true;")).toBe(true);
  });

  it("tf.wordWrap = true emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var tf = new Object(); tf.wordWrap = true;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "wordWrap")).toBe(true);
  });
});

describe("TextField border property", () => {
  it("tf.border = true compiles without error", () => {
    expect(compilesOk("var tf = new Object(); tf.border = true;")).toBe(true);
  });

  it("tf.border = true emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var tf = new Object(); tf.border = true;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "border")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tf.autoSize property assignment
// ---------------------------------------------------------------------------

describe("TextField autoSize property", () => {
  it('tf.autoSize = "left" compiles without error', () => {
    expect(compilesOk('var tf = new Object(); tf.autoSize = "left";')).toBe(true);
  });

  it('tf.autoSize = "left" emits ActionSetMember (0x4f)', () => {
    const bytes = compileAS2('var tf = new Object(); tf.autoSize = "left";');
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "autoSize")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tf.selectable, tf.type, tf.embedFonts property assignments
// ---------------------------------------------------------------------------

describe("TextField selectable property", () => {
  it("tf.selectable = false compiles without error", () => {
    expect(compilesOk("var tf = new Object(); tf.selectable = false;")).toBe(true);
  });

  it("tf.selectable = false emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var tf = new Object(); tf.selectable = false;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "selectable")).toBe(true);
  });
});

describe("TextField type property", () => {
  it('tf.type = "input" compiles without error', () => {
    expect(compilesOk('var tf = new Object(); tf.type = "input";')).toBe(true);
  });

  it('tf.type = "input" emits ActionSetMember (0x4f)', () => {
    const bytes = compileAS2('var tf = new Object(); tf.type = "input";');
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "type")).toBe(true);
  });
});

describe("TextField embedFonts property", () => {
  it("tf.embedFonts = false compiles without error", () => {
    expect(compilesOk("var tf = new Object(); tf.embedFonts = false;")).toBe(true);
  });

  it("tf.embedFonts = false emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var tf = new Object(); tf.embedFonts = false;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "embedFonts")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TextFormat constructor
// ---------------------------------------------------------------------------

describe("TextFormat constructor", () => {
  it("new TextFormat() compiles without error", () => {
    expect(compilesOk("new TextFormat();")).toBe(true);
  });

  it("new TextFormat() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("new TextFormat();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "TextFormat")).toBe(true);
  });

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
// TextFormat property assignments
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
// tf.setTextFormat()
// ---------------------------------------------------------------------------

describe("TextField setTextFormat()", () => {
  it("tf.setTextFormat(fmt) compiles without error", () => {
    expect(
      compilesOk(
        "var tf = new Object(); var fmt = new TextFormat(); tf.setTextFormat(fmt);"
      )
    ).toBe(true);
  });

  it("tf.setTextFormat(fmt) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var tf = new Object(); var fmt = new TextFormat(); tf.setTextFormat(fmt);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setTextFormat")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tf.getTextFormat()
// ---------------------------------------------------------------------------

describe("TextField getTextFormat()", () => {
  it("tf.getTextFormat() compiles without error", () => {
    expect(
      compilesOk("var tf = new Object(); tf.getTextFormat();")
    ).toBe(true);
  });

  it("tf.getTextFormat() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var tf = new Object(); tf.getTextFormat();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getTextFormat")).toBe(true);
  });
});
