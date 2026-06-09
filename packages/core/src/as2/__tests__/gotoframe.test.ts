/**
 * Tests for AVM1 opcode emission for timeline navigation built-ins:
 *   gotoAndPlay(), gotoAndStop(), nextFrame(), prevFrame(), stop(), play()
 *
 * Key opcodes:
 *   ActionGotoFrame2  (0x9F) — goto with optional play flag
 *   ActionNextFrame   (0x04)
 *   ActionPrevFrame   (0x05)
 *   ActionStop        (0x07)
 *   ActionPlay        (0x06)
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
// Opcode constants
// ---------------------------------------------------------------------------

const ACTION_GOTO_FRAME2 = 0x9f; // ActionGotoFrame2
const ACTION_NEXT_FRAME  = 0x04; // ActionNextFrame
const ACTION_PREV_FRAME  = 0x05; // ActionPrevFrame
const ACTION_STOP        = 0x07; // ActionStop
const ACTION_PLAY        = 0x06; // ActionPlay
const ACTION_CALL_FUNC   = 0x3d; // ActionCallFunction (should NOT appear for built-ins)

// ---------------------------------------------------------------------------
// gotoAndPlay()
// ---------------------------------------------------------------------------

describe("gotoAndPlay()", () => {
  it("1. gotoAndPlay(5) compiles without error", () => {
    expect(compilesOk("gotoAndPlay(5);")).toBe(true);
  });

  it("2. gotoAndPlay(5) emits ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileAS2("gotoAndPlay(5);");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
  });

  it("3. gotoAndPlay(5) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("gotoAndPlay(5);");
    expect(containsByte(bytes, ACTION_CALL_FUNC)).toBe(false);
  });

  it("4. gotoAndPlay(5) ActionGotoFrame2 flags byte has PlayFlag=1 (0x02)", () => {
    const bytes = compileAS2("gotoAndPlay(5);");
    // Find 0x9F opcode and check the flags byte in the payload
    // Format: 0x9F | length_lo | length_hi | flags
    const idx = bytes.indexOf(ACTION_GOTO_FRAME2);
    expect(idx).toBeGreaterThanOrEqual(0);
    // length field = 1 (two bytes LE), then flags byte
    // bytes[idx+1] = 0x01, bytes[idx+2] = 0x00 (length=1 LE), bytes[idx+3] = flags
    const flags = bytes[idx + 3];
    // PlayFlag is bit 1 (0x02)
    expect(flags! & 0x02).toBe(0x02);
  });

  it("5. gotoAndPlay('scene1') compiles — string label support", () => {
    expect(compilesOk("gotoAndPlay('scene1');")).toBe(true);
  });

  it("6. gotoAndPlay('scene1') emits ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileAS2("gotoAndPlay('scene1');");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
  });

  it("7. gotoAndPlay(1+2) compiles — expression argument", () => {
    expect(compilesOk("gotoAndPlay(1+2);")).toBe(true);
  });

  it("8. gotoAndPlay(1+2) emits ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileAS2("gotoAndPlay(1+2);");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gotoAndStop()
// ---------------------------------------------------------------------------

describe("gotoAndStop()", () => {
  it("9. gotoAndStop(3) compiles without error", () => {
    expect(compilesOk("gotoAndStop(3);")).toBe(true);
  });

  it("10. gotoAndStop(3) emits ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileAS2("gotoAndStop(3);");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
  });

  it("11. gotoAndStop(3) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("gotoAndStop(3);");
    expect(containsByte(bytes, ACTION_CALL_FUNC)).toBe(false);
  });

  it("12. gotoAndStop(3) ActionGotoFrame2 flags byte has PlayFlag=0", () => {
    const bytes = compileAS2("gotoAndStop(3);");
    const idx = bytes.indexOf(ACTION_GOTO_FRAME2);
    expect(idx).toBeGreaterThanOrEqual(0);
    const flags = bytes[idx + 3];
    // PlayFlag (bit 1) must be 0
    expect(flags! & 0x02).toBe(0x00);
  });

  it("13. gotoAndStop(1) compiles — frame 1", () => {
    expect(compilesOk("gotoAndStop(1);")).toBe(true);
  });

  it("14. gotoAndStop('label') compiles — string label support", () => {
    expect(compilesOk("gotoAndStop('label');")).toBe(true);
  });

  it("15. gotoAndStop('label') emits ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileAS2("gotoAndStop('label');");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
  });

  it("16. gotoAndStop(1+2) compiles — expression argument", () => {
    expect(compilesOk("gotoAndStop(1+2);")).toBe(true);
  });

  it("17. gotoAndStop(1+2) emits ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileAS2("gotoAndStop(1+2);");
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nextFrame() and prevFrame()
// ---------------------------------------------------------------------------

describe("nextFrame() and prevFrame()", () => {
  it("18. nextFrame() compiles without error", () => {
    expect(compilesOk("nextFrame();")).toBe(true);
  });

  it("19. nextFrame() emits ActionNextFrame (0x04)", () => {
    const bytes = compileAS2("nextFrame();");
    expect(containsByte(bytes, ACTION_NEXT_FRAME)).toBe(true);
  });

  it("20. nextFrame() does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("nextFrame();");
    expect(containsByte(bytes, ACTION_CALL_FUNC)).toBe(false);
  });

  it("21. prevFrame() compiles without error", () => {
    expect(compilesOk("prevFrame();")).toBe(true);
  });

  it("22. prevFrame() emits ActionPrevFrame (0x05)", () => {
    const bytes = compileAS2("prevFrame();");
    expect(containsByte(bytes, ACTION_PREV_FRAME)).toBe(true);
  });

  it("23. prevFrame() does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("prevFrame();");
    expect(containsByte(bytes, ACTION_CALL_FUNC)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stop() and play()
// ---------------------------------------------------------------------------

describe("stop() and play()", () => {
  it("24. stop() emits ActionStop (0x07)", () => {
    const bytes = compileAS2("stop();");
    expect(containsByte(bytes, ACTION_STOP)).toBe(true);
  });

  it("25. stop() does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("stop();");
    expect(containsByte(bytes, ACTION_CALL_FUNC)).toBe(false);
  });

  it("26. play() emits ActionPlay (0x06)", () => {
    const bytes = compileAS2("play();");
    expect(containsByte(bytes, ACTION_PLAY)).toBe(true);
  });

  it("27. play() does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("play();");
    expect(containsByte(bytes, ACTION_CALL_FUNC)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PlayFlag distinction — gotoAndPlay vs gotoAndStop emit different flags
// ---------------------------------------------------------------------------

describe("PlayFlag distinction", () => {
  it("28. gotoAndPlay(1) and gotoAndStop(1) both emit 0x9F but with different flags", () => {
    const playBytes = compileAS2("gotoAndPlay(1);");
    const stopBytes = compileAS2("gotoAndStop(1);");

    const playIdx = playBytes.indexOf(ACTION_GOTO_FRAME2);
    const stopIdx = stopBytes.indexOf(ACTION_GOTO_FRAME2);

    expect(playIdx).toBeGreaterThanOrEqual(0);
    expect(stopIdx).toBeGreaterThanOrEqual(0);

    const playFlags = playBytes[playIdx + 3]!;
    const stopFlags = stopBytes[stopIdx + 3]!;

    // gotoAndPlay: PlayFlag (bit 1) = 1
    expect(playFlags & 0x02).toBe(0x02);
    // gotoAndStop: PlayFlag (bit 1) = 0
    expect(stopFlags & 0x02).toBe(0x00);
  });
});
