/**
 * Tests for AS2 compiler: flash.filters classes compilation.
 *
 * Verifies that DropShadowFilter, BlurFilter, and GlowFilter constructor calls,
 * the mc.filters assignment, and mc.cacheAsBitmap assignment compile correctly
 * to AVM1 bytecode.
 *
 * Because flash.filters.DropShadowFilter uses a nested namespace path (not a plain
 * identifier), the compiler resolves it via a member-access chain:
 *   GetVariable("flash") → GetMember("filters") → GetMember("DropShadowFilter")
 *
 * Key opcodes verified:
 *   - ActionNew       (0x40): constructor calls
 *   - ActionSetMember (0x4f): property assignments (mc.filters, mc.cacheAsBitmap)
 *   - ActionGetMember (0x4e): namespace traversal (flash.filters.*)
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

const ACTION_NEW        = 0x40; // ActionNewObject  — constructor call (Identifier callee)
const ACTION_NEW_METHOD = 0x53; // ActionNewMethod  — constructor call (MemberExpr callee)
const ACTION_SET_MEMBER = 0x4f; // ActionSetMember  — property write
const ACTION_GET_MEMBER = 0x4e; // ActionGetMember  — property / member read

// ---------------------------------------------------------------------------
// flash.filters.DropShadowFilter
// ---------------------------------------------------------------------------

// Using alias pattern (same as tweenclass.test.ts) so ActionNew fires
const DROP_SHADOW_SETUP = `
  var DropShadowFilter = flash.filters.DropShadowFilter;
  var filter = new DropShadowFilter(4, 45, 0x000000, 0.5, 4, 4, 1, 1);
`;

describe("flash.filters.DropShadowFilter constructor", () => {
  it("new flash.filters.DropShadowFilter(...) via alias compiles without error", () => {
    expect(compilesOk(DROP_SHADOW_SETUP)).toBe(true);
  });

  it("new flash.filters.DropShadowFilter(...) via alias emits ActionNew (0x40)", () => {
    const bytes = compileAS2(DROP_SHADOW_SETUP);
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
  });

  it("var DropShadowFilter = flash.filters.DropShadowFilter emits ActionGetMember (0x4e) for namespace chain", () => {
    const bytes = compileAS2("var DropShadowFilter = flash.filters.DropShadowFilter;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "flash")).toBe(true);
    expect(containsString(bytes, "filters")).toBe(true);
    expect(containsString(bytes, "DropShadowFilter")).toBe(true);
  });

  it("direct new flash.filters.DropShadowFilter(...) compiles without error", () => {
    expect(
      compilesOk("new flash.filters.DropShadowFilter(4, 45, 0x000000, 0.5, 4, 4, 1, 1);")
    ).toBe(true);
  });

  it("direct new flash.filters.DropShadowFilter(...) emits ActionNewMethod (0x53)", () => {
    // MemberExpr callee (flash.filters.DropShadowFilter) uses ActionNewMethod,
    // not ActionNewObject — Ruffle's flat scope lookup cannot resolve dotted paths.
    const bytes = compileAS2(
      "new flash.filters.DropShadowFilter(4, 45, 0x000000, 0.5, 4, 4, 1, 1);"
    );
    expect(containsByte(bytes, ACTION_NEW_METHOD)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// flash.filters.BlurFilter
// ---------------------------------------------------------------------------

const BLUR_SETUP = `
  var BlurFilter = flash.filters.BlurFilter;
  var filter = new BlurFilter(4, 4, 1);
`;

describe("flash.filters.BlurFilter constructor", () => {
  it("new flash.filters.BlurFilter(4, 4, 1) via alias compiles without error", () => {
    expect(compilesOk(BLUR_SETUP)).toBe(true);
  });

  it("new flash.filters.BlurFilter(4, 4, 1) via alias emits ActionNew (0x40)", () => {
    const bytes = compileAS2(BLUR_SETUP);
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
  });

  it("var BlurFilter = flash.filters.BlurFilter emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var BlurFilter = flash.filters.BlurFilter;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "BlurFilter")).toBe(true);
  });

  it("direct new flash.filters.BlurFilter(4, 4, 1) compiles without error", () => {
    expect(compilesOk("new flash.filters.BlurFilter(4, 4, 1);")).toBe(true);
  });

  it("direct new flash.filters.BlurFilter(4, 4, 1) emits ActionNewMethod (0x53)", () => {
    // MemberExpr callee (flash.filters.BlurFilter) uses ActionNewMethod.
    const bytes = compileAS2("new flash.filters.BlurFilter(4, 4, 1);");
    expect(containsByte(bytes, ACTION_NEW_METHOD)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// flash.filters.GlowFilter
// ---------------------------------------------------------------------------

const GLOW_SETUP = `
  var GlowFilter = flash.filters.GlowFilter;
  var filter = new GlowFilter(0xFF0000, 0.8, 4, 4, 2, 1);
`;

describe("flash.filters.GlowFilter constructor", () => {
  it("new flash.filters.GlowFilter(...) via alias compiles without error", () => {
    expect(compilesOk(GLOW_SETUP)).toBe(true);
  });

  it("new flash.filters.GlowFilter(...) via alias emits ActionNew (0x40)", () => {
    const bytes = compileAS2(GLOW_SETUP);
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
  });

  it("var GlowFilter = flash.filters.GlowFilter emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var GlowFilter = flash.filters.GlowFilter;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "GlowFilter")).toBe(true);
  });

  it("direct new flash.filters.GlowFilter(...) compiles without error", () => {
    expect(compilesOk("new flash.filters.GlowFilter(0xFF0000, 0.8, 4, 4, 2, 1);")).toBe(true);
  });

  it("direct new flash.filters.GlowFilter(...) emits ActionNewMethod (0x53)", () => {
    // MemberExpr callee (flash.filters.GlowFilter) uses ActionNewMethod.
    const bytes = compileAS2("new flash.filters.GlowFilter(0xFF0000, 0.8, 4, 4, 2, 1);");
    expect(containsByte(bytes, ACTION_NEW_METHOD)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.filters = [filter]  assignment
// ---------------------------------------------------------------------------

describe("mc.filters assignment", () => {
  it("mc.filters = [filter] compiles without error", () => {
    expect(
      compilesOk(`
        var mc = {};
        var BlurFilter = flash.filters.BlurFilter;
        var filter = new BlurFilter(4, 4, 1);
        mc.filters = [filter];
      `)
    ).toBe(true);
  });

  it("mc.filters = [filter] emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(`
      var mc = {};
      var BlurFilter = flash.filters.BlurFilter;
      var filter = new BlurFilter(4, 4, 1);
      mc.filters = [filter];
    `);
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "filters")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.cacheAsBitmap = true  assignment
// ---------------------------------------------------------------------------

describe("mc.cacheAsBitmap assignment", () => {
  it("mc.cacheAsBitmap = true compiles without error", () => {
    expect(compilesOk("var mc = {}; mc.cacheAsBitmap = true;")).toBe(true);
  });

  it("mc.cacheAsBitmap = true emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2("var mc = {}; mc.cacheAsBitmap = true;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "cacheAsBitmap")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined: full filter usage pattern
// ---------------------------------------------------------------------------

describe("full filter usage pattern", () => {
  it("complete filter sequence compiles without error", () => {
    expect(
      compilesOk(`
        var mc = {};
        var DropShadowFilter = flash.filters.DropShadowFilter;
        var filter = new DropShadowFilter(4, 45, 0x000000, 0.5, 4, 4, 1, 1);
        mc.filters = [filter];
        mc.cacheAsBitmap = true;
      `)
    ).toBe(true);
  });

  it("complete filter sequence emits ActionNew, ActionSetMember, ActionGetMember", () => {
    const bytes = compileAS2(`
      var mc = {};
      var DropShadowFilter = flash.filters.DropShadowFilter;
      var filter = new DropShadowFilter(4, 45, 0x000000, 0.5, 4, 4, 1, 1);
      mc.filters = [filter];
      mc.cacheAsBitmap = true;
    `);
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
  });
});
