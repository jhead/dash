/**
 * Tests for AS2 compiler: Stage resize event and onResize handler patterns.
 *
 * Verifies that Stage.onResize assignment, Stage.addListener() with an onResize
 * handler, Stage.scaleMode assignment, Stage.align assignment,
 * Stage.width / Stage.height reads, and Stage.removeListener() compile without
 * error and emit the correct AVM1 opcodes:
 *   - ActionSetMember  (0x4f): property writes (Stage.onResize = ..., etc.)
 *   - ActionCallMethod (0x52): method calls (Stage.addListener(), Stage.removeListener())
 *   - ActionGetMember  (0x4e): property reads (Stage.width, Stage.height)
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

const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read
const ACTION_SET_MEMBER  = 0x4f; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// Stage.onResize assignment
// ---------------------------------------------------------------------------

describe("Stage.onResize handler assignment", () => {
  it("Stage.onResize = function() {} compiles without error", () => {
    expect(compilesOk("Stage.onResize = function() {};")).toBe(true);
  });

  it("Stage.onResize = function() {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("Stage.onResize = function() {};");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onResize")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.addListener() with onResize handler
// ---------------------------------------------------------------------------

describe("Stage.addListener() with onResize handler", () => {
  it("Stage.addListener({ onResize: function() {} }) compiles without error", () => {
    expect(compilesOk("Stage.addListener({ onResize: function() {} });")).toBe(true);
  });

  it("Stage.addListener({ onResize: function() {} }) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Stage.addListener({ onResize: function() {} });");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "addListener")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.scaleMode = "noScale"
// ---------------------------------------------------------------------------

describe('Stage.scaleMode = "noScale"', () => {
  it('Stage.scaleMode = "noScale" compiles without error', () => {
    expect(compilesOk('Stage.scaleMode = "noScale";')).toBe(true);
  });

  it('Stage.scaleMode = "noScale" emits ActionSetMember (0x4f)', () => {
    const bytes = compileAS2('Stage.scaleMode = "noScale";');
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "scaleMode")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.scaleMode = "showAll"
// ---------------------------------------------------------------------------

describe('Stage.scaleMode = "showAll"', () => {
  it('Stage.scaleMode = "showAll" compiles without error', () => {
    expect(compilesOk('Stage.scaleMode = "showAll";')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.align = "TL"
// ---------------------------------------------------------------------------

describe('Stage.align = "TL"', () => {
  it('Stage.align = "TL" compiles without error', () => {
    expect(compilesOk('Stage.align = "TL";')).toBe(true);
  });

  it('Stage.align = "TL" emits ActionSetMember (0x4f)', () => {
    const bytes = compileAS2('Stage.align = "TL";');
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "align")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.width
// ---------------------------------------------------------------------------

describe("Stage.width read", () => {
  it("Stage.width compiles without error", () => {
    expect(compilesOk("var w = Stage.width;")).toBe(true);
  });

  it("Stage.width emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var w = Stage.width;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "width")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.height
// ---------------------------------------------------------------------------

describe("Stage.height read", () => {
  it("Stage.height compiles without error", () => {
    expect(compilesOk("var h = Stage.height;")).toBe(true);
  });

  it("Stage.height emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var h = Stage.height;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "height")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.removeListener()
// ---------------------------------------------------------------------------

describe("Stage.removeListener()", () => {
  it("Stage.removeListener(l) compiles without error", () => {
    expect(compilesOk("var l = {}; Stage.removeListener(l);")).toBe(true);
  });

  it("Stage.removeListener(l) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var l = {}; Stage.removeListener(l);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "removeListener")).toBe(true);
    expect(containsString(bytes, "Stage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage.displayState
// ---------------------------------------------------------------------------

describe("Stage.displayState", () => {
  it("Stage.displayState read compiles without error", () => {
    expect(compilesOk("var ds = Stage.displayState;")).toBe(true);
  });

  it("Stage.displayState = 'fullScreen' compiles without error", () => {
    expect(compilesOk('Stage.displayState = "fullScreen";')).toBe(true);
  });

  it("Stage.displayState = 'normal' compiles without error", () => {
    expect(compilesOk('Stage.displayState = "normal";')).toBe(true);
  });

  it("Stage.displayState read emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var ds = Stage.displayState;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "displayState")).toBe(true);
  });

  it("Stage.displayState write emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2('Stage.displayState = "fullScreen";');
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "displayState")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key constants
// ---------------------------------------------------------------------------

describe("Key constants", () => {
  it("Key.HOME constant compiles without error", () => {
    expect(compilesOk("var k = Key.HOME;")).toBe(true);
  });

  it("Key.END constant compiles without error", () => {
    expect(compilesOk("var k = Key.END;")).toBe(true);
  });

  it("Key.PGUP constant compiles without error", () => {
    expect(compilesOk("var k = Key.PGUP;")).toBe(true);
  });

  it("Key.DELETEKEY constant compiles without error", () => {
    expect(compilesOk("var k = Key.DELETEKEY;")).toBe(true);
  });

  it("Key.TAB constant compiles without error", () => {
    expect(compilesOk("var k = Key.TAB;")).toBe(true);
  });

  it("Key.HOME emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var k = Key.HOME;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "HOME")).toBe(true);
    expect(containsString(bytes, "Key")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Responsive layout pattern
// ---------------------------------------------------------------------------

describe("Responsive layout pattern", () => {
  it("noScale + addListener + layout function compiles without error", () => {
    expect(compilesOk(`
      Stage.scaleMode = "noScale";
      Stage.align = "TL";
      function layout() {
        var w = Stage.width;
        var h = Stage.height;
        this.bg._width = w;
        this.bg._height = h;
        this.content._x = w / 2 - this.content._width / 2;
        this.content._y = h / 2 - this.content._height / 2;
      }
      Stage.addListener({onResize: layout});
      layout.call(this);
    `)).toBe(true);
  });
});
