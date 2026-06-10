/**
 * Tests for AS2 compiler: MovieClip timeline navigation method compilation.
 *
 * Verifies that gotoAndPlay(), gotoAndStop(), play(), stop(), nextFrame(), and
 * prevFrame() compile without error and emit the correct AVM1 opcodes:
 *   - ActionGotoFrame2 (0x9F): gotoAndPlay / gotoAndStop
 *   - ActionPlay       (0x06): play
 *   - ActionStop       (0x07): stop
 *   - ActionNextFrame  (0x04): nextFrame
 *   - ActionPrevFrame  (0x05): prevFrame
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

// ---------------------------------------------------------------------------
// AVM1 opcodes under test
// ---------------------------------------------------------------------------

const ACTION_GOTO_FRAME2 = 0x9f; // ActionGotoFrame2
const ACTION_PLAY        = 0x06; // ActionPlay
const ACTION_STOP        = 0x07; // ActionStop
const ACTION_NEXT_FRAME  = 0x04; // ActionNextFrame
const ACTION_PREV_FRAME  = 0x05; // ActionPrevFrame

// ---------------------------------------------------------------------------
// gotoAndPlay(frame) — numeric
// ---------------------------------------------------------------------------

describe("gotoAndPlay(number)", () => {
  it("gotoAndPlay(2) compiles without error", () => {
    expect(compilesOk("gotoAndPlay(2);")).toBe(true);
  });

  it("gotoAndPlay(2) emits ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileAS2("gotoAndPlay(2);");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
  });

  it("gotoAndPlay(2) ActionGotoFrame2 flags has PlayFlag set", () => {
    const bytes = compileAS2("gotoAndPlay(2);");
    const idx = bytes.indexOf(ACTION_GOTO_FRAME2);
    expect(idx).toBeGreaterThanOrEqual(0);
    const flags = bytes[idx + 3]!;
    // PlayFlag is bit 0 (0x01) per SWF spec; bit 1 is SceneBiasFlag
    expect(flags & 0x01).toBe(0x01);
  });
});

// ---------------------------------------------------------------------------
// gotoAndStop(frame) — numeric
// ---------------------------------------------------------------------------

describe("gotoAndStop(number)", () => {
  it("gotoAndStop(3) compiles without error", () => {
    expect(compilesOk("gotoAndStop(3);")).toBe(true);
  });

  it("gotoAndStop(3) emits ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileAS2("gotoAndStop(3);");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
  });

  it("gotoAndStop(3) ActionGotoFrame2 flags has PlayFlag cleared", () => {
    const bytes = compileAS2("gotoAndStop(3);");
    const idx = bytes.indexOf(ACTION_GOTO_FRAME2);
    expect(idx).toBeGreaterThanOrEqual(0);
    const flags = bytes[idx + 3]!;
    expect(flags & 0x01).toBe(0x00);
  });
});

// ---------------------------------------------------------------------------
// gotoAndPlay(label) — string label
// ---------------------------------------------------------------------------

describe("gotoAndPlay(string)", () => {
  it('gotoAndPlay("intro") compiles without error', () => {
    expect(compilesOk('gotoAndPlay("intro");')).toBe(true);
  });

  it('gotoAndPlay("intro") emits ActionGotoFrame2 (0x9F)', () => {
    const bytes = compileAS2('gotoAndPlay("intro");');
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gotoAndStop(scene, frame) — optional 2-argument form
// ---------------------------------------------------------------------------

describe("gotoAndStop(scene, frame)", () => {
  it('gotoAndStop("scene1", "frame1") compiles without error', () => {
    expect(compilesOk('gotoAndStop("scene1", "frame1");')).toBe(true);
  });

  it('gotoAndStop("scene1", "frame1") emits ActionGotoFrame2 (0x9F)', () => {
    const bytes = compileAS2('gotoAndStop("scene1", "frame1");');
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// play()
// ---------------------------------------------------------------------------

describe("play()", () => {
  it("play() compiles without error", () => {
    expect(compilesOk("play();")).toBe(true);
  });

  it("play() emits ActionPlay (0x06)", () => {
    const bytes = compileAS2("play();");
    expect(containsByte(bytes, ACTION_PLAY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

describe("stop()", () => {
  it("stop() compiles without error", () => {
    expect(compilesOk("stop();")).toBe(true);
  });

  it("stop() emits ActionStop (0x07)", () => {
    const bytes = compileAS2("stop();");
    expect(containsByte(bytes, ACTION_STOP)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nextFrame()
// ---------------------------------------------------------------------------

describe("nextFrame()", () => {
  it("nextFrame() compiles without error", () => {
    expect(compilesOk("nextFrame();")).toBe(true);
  });

  it("nextFrame() emits ActionNextFrame (0x04)", () => {
    const bytes = compileAS2("nextFrame();");
    expect(containsByte(bytes, ACTION_NEXT_FRAME)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// prevFrame()
// ---------------------------------------------------------------------------

describe("prevFrame()", () => {
  it("prevFrame() compiles without error", () => {
    expect(compilesOk("prevFrame();")).toBe(true);
  });

  it("prevFrame() emits ActionPrevFrame (0x05)", () => {
    const bytes = compileAS2("prevFrame();");
    expect(containsByte(bytes, ACTION_PREV_FRAME)).toBe(true);
  });
});
