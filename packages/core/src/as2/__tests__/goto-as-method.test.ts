/**
 * Tests for AS2 compiler: gotoAndPlay/gotoAndStop as method calls on objects (task 0868).
 *
 * When called as a method on an object (`_root.gotoAndPlay(2)`, `mc.gotoAndStop(1)`),
 * the compiler must use ActionCallMethod (0x52), NOT the built-in ActionGotoFrame2
 * (0x9F) fast path.
 *
 * The built-in path (ActionGotoFrame2) fires only when the callee is a bare
 * Identifier: `gotoAndPlay(2)` / `gotoAndStop(2)`. When the callee is a
 * MemberExpr (e.g. `_root.gotoAndPlay`), the generic CallMethod path must be
 * used so that AVM1 routes the call to the correct timeline object.
 *
 * Key opcodes:
 *   ActionCallMethod  (0x52) — method dispatch on an object
 *   ActionGotoFrame2  (0x9F) — built-in timeline navigation (bare identifier only)
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
// Opcode constants
// ---------------------------------------------------------------------------

const ACTION_CALL_METHOD  = 0x52; // ActionCallMethod — used for obj.method(...)
const ACTION_GOTO_FRAME2  = 0x9f; // ActionGotoFrame2 — used for bare gotoAndPlay/gotoAndStop
const ACTION_CALL_FUNC    = 0x3d; // ActionCallFunction — NOT expected here

// ---------------------------------------------------------------------------
// _root.gotoAndPlay(frame)
// ---------------------------------------------------------------------------

describe("_root.gotoAndPlay as method call", () => {
  it("1. _root.gotoAndPlay(2) compiles without error", () => {
    expect(compilesOk("_root.gotoAndPlay(2);")).toBe(true);
  });

  it("2. _root.gotoAndPlay(2) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("_root.gotoAndPlay(2);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
  });

  it("3. _root.gotoAndPlay(2) does NOT emit ActionGotoFrame2 (0x9F)", () => {
    // The built-in ActionGotoFrame2 path only fires for bare gotoAndPlay(); not
    // for the method-call form _root.gotoAndPlay() which targets a specific object.
    const bytes = compileAS2("_root.gotoAndPlay(2);");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(false);
  });

  it("4. _root.gotoAndPlay(2) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("_root.gotoAndPlay(2);");
    expect(containsByte(bytes, ACTION_CALL_FUNC)).toBe(false);
  });

  it("5. _root.gotoAndPlay(2) pushes method name 'gotoAndPlay'", () => {
    const bytes = compileAS2("_root.gotoAndPlay(2);");
    expect(containsString(bytes, "gotoAndPlay")).toBe(true);
  });

  it("6. _root.gotoAndPlay(2) pushes '_root' for object lookup", () => {
    const bytes = compileAS2("_root.gotoAndPlay(2);");
    expect(containsString(bytes, "_root")).toBe(true);
  });

  it("7. _root.gotoAndPlay('label') compiles — string frame label", () => {
    expect(compilesOk("_root.gotoAndPlay('scene2');")).toBe(true);
  });

  it("8. _root.gotoAndPlay('label') emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("_root.gotoAndPlay('scene2');");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// _root.gotoAndStop(frame)
// ---------------------------------------------------------------------------

describe("_root.gotoAndStop as method call", () => {
  it("9. _root.gotoAndStop(1) compiles without error", () => {
    expect(compilesOk("_root.gotoAndStop(1);")).toBe(true);
  });

  it("10. _root.gotoAndStop(1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("_root.gotoAndStop(1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
  });

  it("11. _root.gotoAndStop(1) does NOT emit ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileAS2("_root.gotoAndStop(1);");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(false);
  });

  it("12. _root.gotoAndStop(1) pushes method name 'gotoAndStop'", () => {
    const bytes = compileAS2("_root.gotoAndStop(1);");
    expect(containsString(bytes, "gotoAndStop")).toBe(true);
  });

  it("13. _root.gotoAndStop('frame1') compiles — string frame label", () => {
    expect(compilesOk("_root.gotoAndStop('frame1');")).toBe(true);
  });

  it("14. _root.gotoAndStop('frame1') emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("_root.gotoAndStop('frame1');");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Movie clip variable: mc.gotoAndPlay / mc.gotoAndStop
// ---------------------------------------------------------------------------

describe("mc.gotoAndPlay / mc.gotoAndStop as method calls", () => {
  it("15. mc.gotoAndPlay(3) compiles without error", () => {
    expect(compilesOk("mc.gotoAndPlay(3);")).toBe(true);
  });

  it("16. mc.gotoAndPlay(3) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("mc.gotoAndPlay(3);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(false);
  });

  it("17. mc.gotoAndStop(2) compiles without error", () => {
    expect(compilesOk("mc.gotoAndStop(2);")).toBe(true);
  });

  it("18. mc.gotoAndStop(2) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("mc.gotoAndStop(2);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// this.gotoAndPlay / this.gotoAndStop
// ---------------------------------------------------------------------------

describe("this.gotoAndPlay / this.gotoAndStop as method calls", () => {
  it("19. this.gotoAndPlay(1) compiles without error", () => {
    expect(compilesOk("this.gotoAndPlay(1);")).toBe(true);
  });

  it("20. this.gotoAndPlay(1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("this.gotoAndPlay(1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(false);
  });

  it("21. this.gotoAndStop(1) compiles without error", () => {
    expect(compilesOk("this.gotoAndStop(1);")).toBe(true);
  });

  it("22. this.gotoAndStop(1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("this.gotoAndStop(1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regression guard: bare gotoAndPlay/gotoAndStop still use built-in fast path
// ---------------------------------------------------------------------------

describe("bare gotoAndPlay/gotoAndStop still use ActionGotoFrame2 (regression guard)", () => {
  it("23. bare gotoAndPlay(2) still emits ActionGotoFrame2 (0x9F)", () => {
    // The built-in path must NOT be broken by the method-call fix
    const bytes = compileAS2("gotoAndPlay(2);");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });

  it("24. bare gotoAndStop(1) still emits ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileAS2("gotoAndStop(1);");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });

  it("25. bare gotoAndPlay PlayFlag is still 0x01", () => {
    const bytes = compileAS2("gotoAndPlay(1);");
    const idx = bytes.indexOf(ACTION_GOTO_FRAME2);
    expect(idx).toBeGreaterThanOrEqual(0);
    const flags = bytes[idx + 3]!;
    expect(flags & 0x01).toBe(0x01);
  });

  it("26. bare gotoAndStop PlayFlag is still 0x00", () => {
    const bytes = compileAS2("gotoAndStop(1);");
    const idx = bytes.indexOf(ACTION_GOTO_FRAME2);
    expect(idx).toBeGreaterThanOrEqual(0);
    const flags = bytes[idx + 3]!;
    expect(flags & 0x01).toBe(0x00);
  });
});
