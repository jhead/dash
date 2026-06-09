/**
 * Tests for AS2 compiler: Accessibility and AccessibilityProperties class compilation.
 *
 * Verifies that Accessibility static method calls, AccessibilityProperties constructor
 * calls, and property writes compile without error and emit the correct AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls
 *   - ActionNew        (0x4a): constructor calls
 *   - ActionSetMember  (0x4e): property writes
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
const ACTION_NEW         = 0x4a; // ActionNew        — constructor call
const ACTION_SET_MEMBER  = 0x4e; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// Accessibility.isActive()
// ---------------------------------------------------------------------------

describe("Accessibility.isActive()", () => {
  it("Accessibility.isActive() compiles without error", () => {
    expect(compilesOk("Accessibility.isActive();")).toBe(true);
  });

  it("Accessibility.isActive() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Accessibility.isActive();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "isActive")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Accessibility.updateProperties()
// ---------------------------------------------------------------------------

describe("Accessibility.updateProperties()", () => {
  it("Accessibility.updateProperties() compiles without error", () => {
    expect(compilesOk("Accessibility.updateProperties();")).toBe(true);
  });

  it("Accessibility.updateProperties() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Accessibility.updateProperties();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "updateProperties")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Accessibility.sendEvent()
// ---------------------------------------------------------------------------

describe("Accessibility.sendEvent()", () => {
  it("Accessibility.sendEvent(mc, 0, 1, false) compiles without error", () => {
    expect(
      compilesOk("var mc = _root; Accessibility.sendEvent(mc, 0, 1, false);")
    ).toBe(true);
  });

  it("Accessibility.sendEvent(mc, 0, 1, false) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var mc = _root; Accessibility.sendEvent(mc, 0, 1, false);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "sendEvent")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// new AccessibilityProperties()
// ---------------------------------------------------------------------------

describe("AccessibilityProperties constructor", () => {
  it("new AccessibilityProperties() compiles without error", () => {
    expect(compilesOk("new AccessibilityProperties();")).toBe(true);
  });

  it("new AccessibilityProperties() emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("new AccessibilityProperties();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "AccessibilityProperties")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.accessibilityProperties = new AccessibilityProperties()
// ---------------------------------------------------------------------------

describe("mc.accessibilityProperties assignment", () => {
  it("mc.accessibilityProperties = new AccessibilityProperties() compiles without error", () => {
    expect(
      compilesOk(
        "var mc = _root; mc.accessibilityProperties = new AccessibilityProperties();"
      )
    ).toBe(true);
  });

  it("mc.accessibilityProperties = new AccessibilityProperties() emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2(
      "var mc = _root; mc.accessibilityProperties = new AccessibilityProperties();"
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "accessibilityProperties")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ap.name property write
// ---------------------------------------------------------------------------

describe("AccessibilityProperties name property", () => {
  it('ap.name = "button" compiles without error', () => {
    expect(
      compilesOk(
        'var ap = new AccessibilityProperties(); ap.name = "button";'
      )
    ).toBe(true);
  });

  it('ap.name = "button" emits ActionSetMember (0x4e)', () => {
    const bytes = compileAS2(
      'var ap = new AccessibilityProperties(); ap.name = "button";'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "name")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ap.description property write
// ---------------------------------------------------------------------------

describe("AccessibilityProperties description property", () => {
  it('ap.description = "desc" compiles without error', () => {
    expect(
      compilesOk(
        'var ap = new AccessibilityProperties(); ap.description = "desc";'
      )
    ).toBe(true);
  });

  it('ap.description = "desc" emits ActionSetMember (0x4e)', () => {
    const bytes = compileAS2(
      'var ap = new AccessibilityProperties(); ap.description = "desc";'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "description")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ap.silent property write
// ---------------------------------------------------------------------------

describe("AccessibilityProperties silent property", () => {
  it("ap.silent = true compiles without error", () => {
    expect(
      compilesOk(
        "var ap = new AccessibilityProperties(); ap.silent = true;"
      )
    ).toBe(true);
  });

  it("ap.silent = true emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2(
      "var ap = new AccessibilityProperties(); ap.silent = true;"
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "silent")).toBe(true);
  });
});
