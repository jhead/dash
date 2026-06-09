/**
 * Tests for AS2 compiler: Sound object construction, method calls, and
 * property accesses.
 *
 * Verifies that Sound constructor calls, instance method calls, property
 * reads and writes, and callback assignments compile without error and emit
 * the correct AVM1 opcodes:
 *   - ActionNew        (0x4a): constructor calls (new Sound())
 *   - ActionCallMethod (0x52): method calls (s.attachSound(), s.start(), etc.)
 *   - ActionGetMember  (0x4f): property reads (s.duration, s.position)
 *   - ActionSetMember  (0x4e): property writes (s.onSoundComplete = ...)
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
const ACTION_GET_MEMBER  = 0x4f; // ActionGetMember  — property read
const ACTION_SET_MEMBER  = 0x4e; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// Sound constructor
// ---------------------------------------------------------------------------

describe("Sound constructor", () => {
  it("new Sound() compiles without error", () => {
    expect(compilesOk("new Sound();")).toBe(true);
  });

  it("new Sound() emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("new Sound();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Sound")).toBe(true);
  });

  it("var s = new Sound() compiles without error", () => {
    expect(compilesOk("var s = new Sound();")).toBe(true);
  });

  it("var s = new Sound() emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("var s = new Sound();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Sound")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// s.attachSound()
// ---------------------------------------------------------------------------

describe("Sound attachSound()", () => {
  it('s.attachSound("boom") compiles without error', () => {
    expect(compilesOk('var s = new Sound(); s.attachSound("boom");')).toBe(true);
  });

  it('s.attachSound("boom") emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var s = new Sound(); s.attachSound("boom");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "attachSound")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// s.start()
// ---------------------------------------------------------------------------

describe("Sound start()", () => {
  it("s.start(0, 1) compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.start(0, 1);")).toBe(true);
  });

  it("s.start(0, 1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var s = new Sound(); s.start(0, 1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "start")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// s.stop()
// ---------------------------------------------------------------------------

describe("Sound stop()", () => {
  it("s.stop() compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.stop();")).toBe(true);
  });

  it("s.stop() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var s = new Sound(); s.stop();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "stop")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// s.setVolume()
// ---------------------------------------------------------------------------

describe("Sound setVolume()", () => {
  it("s.setVolume(75) compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.setVolume(75);")).toBe(true);
  });

  it("s.setVolume(75) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var s = new Sound(); s.setVolume(75);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setVolume")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// s.getVolume()
// ---------------------------------------------------------------------------

describe("Sound getVolume()", () => {
  it("s.getVolume() compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.getVolume();")).toBe(true);
  });

  it("s.getVolume() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var s = new Sound(); s.getVolume();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getVolume")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// s.setPan()
// ---------------------------------------------------------------------------

describe("Sound setPan()", () => {
  it("s.setPan(-50) compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.setPan(-50);")).toBe(true);
  });

  it("s.setPan(-50) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var s = new Sound(); s.setPan(-50);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setPan")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// s.onSoundComplete callback assignment
// ---------------------------------------------------------------------------

describe("Sound onSoundComplete callback", () => {
  it("s.onSoundComplete = function() {} compiles without error", () => {
    expect(
      compilesOk("var s = new Sound(); s.onSoundComplete = function() {};")
    ).toBe(true);
  });

  it("s.onSoundComplete = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2(
      "var s = new Sound(); s.onSoundComplete = function() {};"
    );
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onSoundComplete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// s.duration property read
// ---------------------------------------------------------------------------

describe("Sound duration property", () => {
  it("s.duration compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.duration;")).toBe(true);
  });

  it("s.duration emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var s = new Sound(); s.duration;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "duration")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// s.position property read
// ---------------------------------------------------------------------------

describe("Sound position property", () => {
  it("s.position compiles without error", () => {
    expect(compilesOk("var s = new Sound(); s.position;")).toBe(true);
  });

  it("s.position emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var s = new Sound(); s.position;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "position")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// s.loadSound()
// ---------------------------------------------------------------------------

describe("Sound loadSound()", () => {
  it('s.loadSound("song.mp3", true) compiles without error', () => {
    expect(
      compilesOk('var s = new Sound(); s.loadSound("song.mp3", true);')
    ).toBe(true);
  });

  it('s.loadSound("song.mp3", true) emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2(
      'var s = new Sound(); s.loadSound("song.mp3", true);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "loadSound")).toBe(true);
  });
});
