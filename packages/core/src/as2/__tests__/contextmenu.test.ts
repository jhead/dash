/**
 * Tests for AS2 compiler: ContextMenu and ContextMenuItem object construction,
 * method calls, and property accesses.
 *
 * Verifies that ContextMenu/ContextMenuItem constructor calls, instance method
 * calls, property reads and writes compile without error and emit the correct
 * AVM1 opcodes:
 *   - ActionNew        (0x40): constructor calls
 *   - ActionCallMethod (0x52): method calls
 *   - ActionGetMember  (0x4e): property reads
 *   - ActionSetMember  (0x4f): property writes
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
// ContextMenu constructor
// ---------------------------------------------------------------------------

describe("ContextMenu constructor", () => {
  it("new ContextMenu() compiles without error", () => {
    expect(compilesOk("new ContextMenu();")).toBe(true);
  });

  it("new ContextMenu() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("new ContextMenu();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "ContextMenu")).toBe(true);
  });

  it("var cm = new ContextMenu() compiles without error", () => {
    expect(compilesOk("var cm = new ContextMenu();")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cm.hideBuiltInItems()
// ---------------------------------------------------------------------------

describe("ContextMenu hideBuiltInItems()", () => {
  it("cm.hideBuiltInItems() compiles without error", () => {
    expect(
      compilesOk("var cm = new ContextMenu(); cm.hideBuiltInItems();")
    ).toBe(true);
  });

  it("cm.hideBuiltInItems() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var cm = new ContextMenu(); cm.hideBuiltInItems();"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "hideBuiltInItems")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cm.customItems.push(item)
// ---------------------------------------------------------------------------

describe("ContextMenu customItems.push()", () => {
  it("cm.customItems.push(item) compiles without error", () => {
    expect(
      compilesOk(
        "var cm = new ContextMenu(); " +
        "var item = new ContextMenuItem(\"label\", function() {}); " +
        "cm.customItems.push(item);"
      )
    ).toBe(true);
  });

  it("cm.customItems.push(item) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var cm = new ContextMenu(); " +
      "var item = new ContextMenuItem(\"label\", function() {}); " +
      "cm.customItems.push(item);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "push")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ContextMenuItem constructor
// ---------------------------------------------------------------------------

describe("ContextMenuItem constructor", () => {
  it('new ContextMenuItem("label", handler) compiles without error', () => {
    expect(
      compilesOk('var handler = function() {}; new ContextMenuItem("label", handler);')
    ).toBe(true);
  });

  it('new ContextMenuItem("label", handler) emits ActionNew (0x40)', () => {
    const bytes = compileAS2(
      'var handler = function() {}; new ContextMenuItem("label", handler);'
    );
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "ContextMenuItem")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// item.caption property read
// ---------------------------------------------------------------------------

describe("ContextMenuItem caption property", () => {
  it("item.caption compiles without error", () => {
    expect(
      compilesOk(
        'var item = new ContextMenuItem("label", function() {}); item.caption;'
      )
    ).toBe(true);
  });

  it("item.caption emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2(
      'var item = new ContextMenuItem("label", function() {}); item.caption;'
    );
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "caption")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// item.onSelect callback assignment
// ---------------------------------------------------------------------------

describe("ContextMenuItem onSelect callback", () => {
  it("item.onSelect = function(obj, item) {} compiles without error", () => {
    expect(
      compilesOk(
        'var item = new ContextMenuItem("label", function() {}); ' +
        "item.onSelect = function(obj, item) {};"
      )
    ).toBe(true);
  });

  it("item.onSelect = function(obj, item) {} emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(
      'var item = new ContextMenuItem("label", function() {}); ' +
      "item.onSelect = function(obj, item) {};"
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onSelect")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _root.menu assignment
// ---------------------------------------------------------------------------

describe("ContextMenu _root.menu assignment", () => {
  it("_root.menu = cm compiles without error", () => {
    expect(
      compilesOk("var cm = new ContextMenu(); _root.menu = cm;")
    ).toBe(true);
  });

  it("_root.menu = cm emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var cm = new ContextMenu(); _root.menu = cm;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "menu")).toBe(true);
  });
});
