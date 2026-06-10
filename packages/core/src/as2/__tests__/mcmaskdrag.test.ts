/**
 * Tests for AS2 compiler: MovieClip setMask, startDrag, stopDrag,
 * _xmouse / _ymouse properties, hitArea, tabEnabled, focusEnabled.
 *
 * Verifies that method calls emit ActionCallMethod (0x52), property reads
 * emit ActionGetMember (0x4e), and property writes emit ActionSetMember (0x4f).
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
// mc.setMask(maskClip)
// ---------------------------------------------------------------------------

describe("MovieClip setMask(maskClip)", () => {
  it("mc.setMask(maskClip) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; var maskClip = _root.mask; mc.setMask(maskClip);")).toBe(true);
  });

  it("mc.setMask(maskClip) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; var maskClip = _root.mask; mc.setMask(maskClip);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setMask")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.setMask(null) — remove mask
// ---------------------------------------------------------------------------

describe("MovieClip setMask(null)", () => {
  it("mc.setMask(null) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.setMask(null);")).toBe(true);
  });

  it("mc.setMask(null) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.setMask(null);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setMask")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.startDrag(lockCenter, left, top, right, bottom)
// ---------------------------------------------------------------------------

describe("MovieClip startDrag(lockCenter, bounds)", () => {
  it("mc.startDrag(true, 0, 0, 100, 100) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.startDrag(true, 0, 0, 100, 100);")).toBe(true);
  });

  it("mc.startDrag(true, 0, 0, 100, 100) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.startDrag(true, 0, 0, 100, 100);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "startDrag")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.startDrag() — no-arg form
// ---------------------------------------------------------------------------

describe("MovieClip startDrag() no-arg", () => {
  it("mc.startDrag() compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.startDrag();")).toBe(true);
  });

  it("mc.startDrag() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.startDrag();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "startDrag")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.stopDrag()
// ---------------------------------------------------------------------------

describe("MovieClip stopDrag()", () => {
  it("mc.stopDrag() compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.stopDrag();")).toBe(true);
  });

  it("mc.stopDrag() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.stopDrag();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "stopDrag")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._xmouse property read
// ---------------------------------------------------------------------------

describe("MovieClip _xmouse property read", () => {
  it("mc._xmouse compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc._xmouse;")).toBe(true);
  });

  it("mc._xmouse emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc._xmouse;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_xmouse")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc._ymouse property read
// ---------------------------------------------------------------------------

describe("MovieClip _ymouse property read", () => {
  it("mc._ymouse compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc._ymouse;")).toBe(true);
  });

  it("mc._ymouse emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc._ymouse;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_ymouse")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.hitArea = hitClip property write
// ---------------------------------------------------------------------------

describe("MovieClip hitArea property write", () => {
  it("mc.hitArea = hitClip compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; var hitClip = _root.hit; mc.hitArea = hitClip;")).toBe(true);
  });

  it("mc.hitArea = hitClip emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var mc = _root.mc; var hitClip = _root.hit; mc.hitArea = hitClip;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "hitArea")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.tabEnabled = true property write
// ---------------------------------------------------------------------------

describe("MovieClip tabEnabled property write", () => {
  it("mc.tabEnabled = true compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.tabEnabled = true;")).toBe(true);
  });

  it("mc.tabEnabled = true emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.tabEnabled = true;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "tabEnabled")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.focusEnabled = true property write
// ---------------------------------------------------------------------------

describe("MovieClip focusEnabled property write", () => {
  it("mc.focusEnabled = true compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.focusEnabled = true;")).toBe(true);
  });

  it("mc.focusEnabled = true emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.focusEnabled = true;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "focusEnabled")).toBe(true);
  });
});
