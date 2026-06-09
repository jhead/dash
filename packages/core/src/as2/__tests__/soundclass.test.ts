/**
 * Tests for AS2 compiler: Sound class built-in methods.
 *
 * Verifies that Sound constructor calls, method calls, property assignments,
 * and real-world patterns compile without error and emit the correct AVM1
 * opcodes:
 *   - ActionNew        (0x4a): new Sound() / new Sound(mc)
 *   - ActionCallMethod (0x52): s.attachSound(), s.start(), s.stop(), etc.
 *   - ActionSetMember  (0x4e): s.onSoundComplete = function() { ... }
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
const ACTION_SET_MEMBER  = 0x4e; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// 1. var s = new Sound(mc) — emits ActionNew (0x4a)
// ---------------------------------------------------------------------------

describe("Sound class: new Sound(mc)", () => {
  it("1a. var s = new Sound(mc) compiles without error", () => {
    expect(compilesOk("var mc; var s = new Sound(mc);")).toBe(true);
  });

  it("1b. var s = new Sound(mc) emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("var mc; var s = new Sound(mc);");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Sound")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. var s = new Sound() — emits ActionNew (0x4a)
// ---------------------------------------------------------------------------

describe("Sound class: new Sound()", () => {
  it("2a. var s = new Sound() compiles without error", () => {
    expect(compilesOk("var s = new Sound();")).toBe(true);
  });

  it("2b. var s = new Sound() emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("var s = new Sound();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Sound")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. s.attachSound("mySound") — emits ActionCallMethod (0x52)
// ---------------------------------------------------------------------------

describe("Sound class: s.attachSound()", () => {
  it('3a. s.attachSound("mySound") compiles without error', () => {
    expect(compilesOk('var s = new Sound(); s.attachSound("mySound");')).toBe(true);
  });

  it('3b. s.attachSound("mySound") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var s = new Sound(); s.attachSound("mySound");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "attachSound")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. s.start(0, 1) — compiles
// ---------------------------------------------------------------------------

describe("Sound class: s.start()", () => {
  it("4a. s.start(0, 1) compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.start(0, 1);")).toBe(true);
  });

  it("4b. s.start(0, 1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var s = new Sound(); s.start(0, 1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "start")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. s.stop() — compiles
// ---------------------------------------------------------------------------

describe("Sound class: s.stop()", () => {
  it("5a. s.stop() compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.stop();")).toBe(true);
  });

  it("5b. s.stop() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var s = new Sound(); s.stop();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "stop")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. s.setVolume(80) — compiles
// ---------------------------------------------------------------------------

describe("Sound class: s.setVolume()", () => {
  it("6a. s.setVolume(80) compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.setVolume(80);")).toBe(true);
  });

  it("6b. s.setVolume(80) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var s = new Sound(); s.setVolume(80);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setVolume")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. s.getVolume() — compiles
// ---------------------------------------------------------------------------

describe("Sound class: s.getVolume()", () => {
  it("7a. s.getVolume() compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.getVolume();")).toBe(true);
  });

  it("7b. s.getVolume() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var s = new Sound(); s.getVolume();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getVolume")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. s.setPan(0) — compiles
// ---------------------------------------------------------------------------

describe("Sound class: s.setPan()", () => {
  it("8a. s.setPan(0) compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.setPan(0);")).toBe(true);
  });

  it("8b. s.setPan(0) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var s = new Sound(); s.setPan(0);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setPan")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. s.loadSound("url", false) — compiles
// ---------------------------------------------------------------------------

describe("Sound class: s.loadSound()", () => {
  it('9a. s.loadSound("http://example.com/snd.mp3", false) compiles without error', () => {
    expect(
      compilesOk('var s = new Sound(); s.loadSound("http://example.com/snd.mp3", false);')
    ).toBe(true);
  });

  it('9b. s.loadSound() emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var s = new Sound(); s.loadSound("http://example.com/snd.mp3", false);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "loadSound")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. s.onSoundComplete = function() { trace("done"); } — emits ActionSetMember (0x4e)
// ---------------------------------------------------------------------------

describe("Sound class: s.onSoundComplete callback", () => {
  it('10a. s.onSoundComplete = function() { trace("done"); } compiles without error', () => {
    expect(
      compilesOk('var s = new Sound(); s.onSoundComplete = function() { trace("done"); };')
    ).toBe(true);
  });

  it('10b. s.onSoundComplete = function() {} emits ActionSetMember (0x4e)', () => {
    const bytes = compileAS2(
      'var s = new Sound(); s.onSoundComplete = function() { trace("done"); };'
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onSoundComplete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. Full bgMusic pattern: new Sound, attachSound, start
// ---------------------------------------------------------------------------

describe("Sound class: full bgMusic pattern", () => {
  it("11a. bgMusic pattern compiles without error", () => {
    expect(
      compilesOk(
        'var bgMusic = new Sound(); bgMusic.attachSound("bgloop"); bgMusic.start(0, 99999);'
      )
    ).toBe(true);
  });

  it("11b. bgMusic pattern emits ActionNew (0x4a)", () => {
    const bytes = compileAS2(
      'var bgMusic = new Sound(); bgMusic.attachSound("bgloop"); bgMusic.start(0, 99999);'
    );
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Sound")).toBe(true);
  });

  it("11c. bgMusic pattern emits ActionCallMethod (0x52) for attachSound", () => {
    const bytes = compileAS2(
      'var bgMusic = new Sound(); bgMusic.attachSound("bgloop"); bgMusic.start(0, 99999);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "attachSound")).toBe(true);
    expect(containsString(bytes, "start")).toBe(true);
  });
});
