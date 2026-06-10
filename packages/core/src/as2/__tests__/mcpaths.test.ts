/**
 * Tests for AS2 MovieClip path navigation compilation.
 *
 * Verifies that _root, _parent, _level0 identifiers and property accesses
 * on MovieClip path variables compile to valid AVM1 bytecode with the
 * expected opcodes (ActionGetVariable, ActionPush, ActionGetMember).
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

const ACTION_GET_VARIABLE = 0x1c; // ActionGetVariable
const ACTION_GET_MEMBER   = 0x4e; // ActionGetMember
const ACTION_PUSH         = 0x96; // ActionPush

// ---------------------------------------------------------------------------
// _root identifier
// ---------------------------------------------------------------------------

describe("AS2 _root identifier", () => {
  it("_root compiles without error", () => {
    expect(compilesOk("var r = _root;")).toBe(true);
  });

  it("_root emits ActionGetVariable (0x1c) or ActionPush (0x96)", () => {
    const bytes = compileAS2("var r = _root;");
    const hasGetVar = containsByte(bytes, ACTION_GET_VARIABLE);
    const hasPush   = containsByte(bytes, ACTION_PUSH);
    expect(hasGetVar || hasPush).toBe(true);
  });

  it("_root identifier name appears in bytecode", () => {
    const bytes = compileAS2("var r = _root;");
    expect(containsString(bytes, "_root")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _parent identifier
// ---------------------------------------------------------------------------

describe("AS2 _parent identifier", () => {
  it("_parent compiles without error", () => {
    expect(compilesOk("var p = _parent;")).toBe(true);
  });

  it("_parent emits ActionGetVariable (0x1c) or ActionPush (0x96)", () => {
    const bytes = compileAS2("var p = _parent;");
    const hasGetVar = containsByte(bytes, ACTION_GET_VARIABLE);
    const hasPush   = containsByte(bytes, ACTION_PUSH);
    expect(hasGetVar || hasPush).toBe(true);
  });

  it("_parent identifier name appears in bytecode", () => {
    const bytes = compileAS2("var p = _parent;");
    expect(containsString(bytes, "_parent")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _level0 identifier (level notation)
// ---------------------------------------------------------------------------

describe("AS2 _level0 identifier (level notation)", () => {
  it("_level0 compiles without error", () => {
    expect(compilesOk("var lv = _level0;")).toBe(true);
  });

  it("_level0 emits ActionGetVariable (0x1c) or ActionPush (0x96)", () => {
    const bytes = compileAS2("var lv = _level0;");
    const hasGetVar = containsByte(bytes, ACTION_GET_VARIABLE);
    const hasPush   = containsByte(bytes, ACTION_PUSH);
    expect(hasGetVar || hasPush).toBe(true);
  });

  it("_level0 identifier name appears in bytecode", () => {
    const bytes = compileAS2("var lv = _level0;");
    expect(containsString(bytes, "_level0")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _root.mc — member access on _root
// ---------------------------------------------------------------------------

describe("AS2 _root.mc member access", () => {
  it("_root.mc compiles without error", () => {
    expect(compilesOk("var m = _root.mc;")).toBe(true);
  });

  it("_root.mc emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var m = _root.mc;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });

  it("_root.mc bytecode contains '_root' and 'mc' strings", () => {
    const bytes = compileAS2("var m = _root.mc;");
    expect(containsString(bytes, "_root")).toBe(true);
    expect(containsString(bytes, "mc")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _parent.mc — member access on _parent
// ---------------------------------------------------------------------------

describe("AS2 _parent.mc member access", () => {
  it("_parent.mc compiles without error", () => {
    expect(compilesOk("var m = _parent.mc;")).toBe(true);
  });

  it("_parent.mc emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var m = _parent.mc;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });

  it("_parent.mc bytecode contains '_parent' and 'mc' strings", () => {
    const bytes = compileAS2("var m = _parent.mc;");
    expect(containsString(bytes, "_parent")).toBe(true);
    expect(containsString(bytes, "mc")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._name — special MovieClip property access
// ---------------------------------------------------------------------------

describe("AS2 mc._name property access", () => {
  it("mc._name compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; var n = mc._name;")).toBe(true);
  });

  it("mc._name emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var mc = _root.mc; var n = mc._name;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });

  it("mc._name bytecode contains '_name' string", () => {
    const bytes = compileAS2("var mc = _root.mc; var n = mc._name;");
    expect(containsString(bytes, "_name")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._target — special MovieClip property access
// ---------------------------------------------------------------------------

describe("AS2 mc._target property access", () => {
  it("mc._target compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; var t = mc._target;")).toBe(true);
  });

  it("mc._target emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var mc = _root.mc; var t = mc._target;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });

  it("mc._target bytecode contains '_target' string", () => {
    const bytes = compileAS2("var mc = _root.mc; var t = mc._target;");
    expect(containsString(bytes, "_target")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._url — special MovieClip property access
// ---------------------------------------------------------------------------

describe("AS2 mc._url property access", () => {
  it("mc._url compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; var u = mc._url;")).toBe(true);
  });

  it("mc._url emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var mc = _root.mc; var u = mc._url;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });

  it("mc._url bytecode contains '_url' string", () => {
    const bytes = compileAS2("var mc = _root.mc; var u = mc._url;");
    expect(containsString(bytes, "_url")).toBe(true);
  });
});
