/**
 * Unit tests for compileFrameScript in actions.ts.
 *
 * Verifies:
 *   - nextFrame()              → ActionNextFrame (0x04)
 *   - prevFrame()              → ActionPrevFrame (0x05)
 *   - gotoAndStop('label')     → ActionPush string + ActionGotoFrame2 (0x9F, flags=0x00)
 *   - gotoAndPlay('label')     → ActionPush string + ActionGotoFrame2 (0x9F, flags=0x01)
 *   - gotoAndStop(N)           → ActionGotoFrame (0x81) + ActionStop (0x07)
 *   - gotoAndPlay(N)           → ActionGotoFrame (0x81) + ActionPlay (0x06)
 *   - stop()                   → ActionStop (0x07)
 *   - play()                   → ActionPlay (0x06)
 *
 * Opcodes verified against ruffle/swf/src/avm1/opcode.rs.
 */

import { describe, it, expect } from "vitest";
import { compileFrameScript } from "../actions.js";

// ---------------------------------------------------------------------------
// Opcode constants (verified against ruffle/swf/src/avm1/opcode.rs)
// ---------------------------------------------------------------------------

const OP_NEXT_FRAME     = 0x04;
const OP_PREV_FRAME     = 0x05;
const OP_ACTION_PLAY    = 0x06;
const OP_ACTION_STOP    = 0x07;
const OP_ACTION_PUSH    = 0x96;
const OP_GOTO_FRAME     = 0x81;
const OP_GOTO_FRAME2    = 0x9f;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all opcode bytes from a compiled action byte sequence. */
function opcodes(bytes: Uint8Array): number[] {
  const result: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i]!;
    result.push(op);
    if (op >= 0x80) {
      // Has a length prefix (UI16LE)
      const len = bytes[i + 1]! | (bytes[i + 2]! << 8);
      i += 3 + len;
    } else {
      i += 1;
    }
  }
  return result;
}

/** Extract the payload bytes of the first occurrence of a given opcode. */
function payloadOf(bytes: Uint8Array, opcode: number): Uint8Array | null {
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i]!;
    if (op >= 0x80) {
      const len = bytes[i + 1]! | (bytes[i + 2]! << 8);
      if (op === opcode) {
        return bytes.slice(i + 3, i + 3 + len);
      }
      i += 3 + len;
    } else {
      if (op === opcode) return new Uint8Array(0);
      i += 1;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests: nextFrame / prevFrame
// ---------------------------------------------------------------------------

describe("compileFrameScript: nextFrame / prevFrame", () => {
  it("nextFrame() emits ActionNextFrame (0x04)", () => {
    const bytes = compileFrameScript("nextFrame();");
    expect(bytes.length).toBeGreaterThan(0);
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_NEXT_FRAME);
    expect(ops).not.toContain(OP_PREV_FRAME);
  });

  it("prevFrame() emits ActionPrevFrame (0x05)", () => {
    const bytes = compileFrameScript("prevFrame();");
    expect(bytes.length).toBeGreaterThan(0);
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_PREV_FRAME);
    expect(ops).not.toContain(OP_NEXT_FRAME);
  });

  it("nextFrame() without semicolon also works", () => {
    const bytes = compileFrameScript("nextFrame()");
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_NEXT_FRAME);
  });

  it("prevFrame() without semicolon also works", () => {
    const bytes = compileFrameScript("prevFrame()");
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_PREV_FRAME);
  });

  it("nextFrame() emits exactly 1 byte", () => {
    const bytes = compileFrameScript("nextFrame();");
    expect(bytes.length).toBe(1);
    expect(bytes[0]).toBe(OP_NEXT_FRAME);
  });

  it("prevFrame() emits exactly 1 byte", () => {
    const bytes = compileFrameScript("prevFrame();");
    expect(bytes.length).toBe(1);
    expect(bytes[0]).toBe(OP_PREV_FRAME);
  });
});

// ---------------------------------------------------------------------------
// Tests: gotoAndStop / gotoAndPlay with string labels
// ---------------------------------------------------------------------------

describe("compileFrameScript: gotoAndStop/Play by label", () => {
  it("gotoAndStop('label') emits ActionPush + ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileFrameScript("gotoAndStop('game');");
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_ACTION_PUSH);
    expect(ops).toContain(OP_GOTO_FRAME2);
    // Must NOT emit ActionStop after GotoFrame2 (stop is encoded in flags)
    expect(ops).not.toContain(OP_ACTION_STOP);
  });

  it("gotoAndStop('label') ActionGotoFrame2 has flags=0x00 (stop)", () => {
    const bytes = compileFrameScript("gotoAndStop('game');");
    const payload = payloadOf(bytes, OP_GOTO_FRAME2);
    expect(payload).not.toBeNull();
    // flags byte = first byte of GotoFrame2 payload
    expect(payload![0]).toBe(0x00); // stop: PlayFlag bit 0 = 0
  });

  it("gotoAndPlay('label') emits ActionPush + ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileFrameScript("gotoAndPlay('level2');");
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_ACTION_PUSH);
    expect(ops).toContain(OP_GOTO_FRAME2);
    expect(ops).not.toContain(OP_ACTION_PLAY);
  });

  it("gotoAndPlay('label') ActionGotoFrame2 has flags=0x01 (play)", () => {
    const bytes = compileFrameScript("gotoAndPlay('level2');");
    const payload = payloadOf(bytes, OP_GOTO_FRAME2);
    expect(payload).not.toBeNull();
    // flags byte = first byte of GotoFrame2 payload
    expect(payload![0]).toBe(0x01); // play: PlayFlag bit 0 = 1
  });

  it("gotoAndStop('label') pushes the label string", () => {
    const bytes = compileFrameScript("gotoAndStop('end');");
    const pushPayload = payloadOf(bytes, OP_ACTION_PUSH);
    expect(pushPayload).not.toBeNull();
    // type byte 0x00 = string, followed by 'end' + null terminator
    expect(pushPayload![0]).toBe(0x00); // string type
    const str = new TextDecoder().decode(pushPayload!.slice(1, pushPayload!.length - 1));
    expect(str).toBe("end");
  });

  it('gotoAndStop("label") with double quotes works', () => {
    const bytes = compileFrameScript('gotoAndStop("menu");');
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_GOTO_FRAME2);
    const payload = payloadOf(bytes, OP_GOTO_FRAME2);
    expect(payload![0]).toBe(0x00); // stop
  });

  it('gotoAndPlay("label") with double quotes works', () => {
    const bytes = compileFrameScript('gotoAndPlay("start");');
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_GOTO_FRAME2);
    const payload = payloadOf(bytes, OP_GOTO_FRAME2);
    expect(payload![0]).toBe(0x01); // play
  });

  it("gotoAndFrame2 payload length is 1 (flags only, no scene bias)", () => {
    const bytes = compileFrameScript("gotoAndStop('game');");
    let i = 0;
    while (i < bytes.length) {
      const op = bytes[i]!;
      if (op === OP_GOTO_FRAME2) {
        const len = bytes[i + 1]! | (bytes[i + 2]! << 8);
        expect(len).toBe(1);
        break;
      }
      if (op >= 0x80) {
        const len = bytes[i + 1]! | (bytes[i + 2]! << 8);
        i += 3 + len;
      } else {
        i += 1;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: gotoAndStop/Play with numeric frames still use ActionGotoFrame (0x81)
// ---------------------------------------------------------------------------

describe("compileFrameScript: gotoAndStop/Play by number (regression)", () => {
  it("gotoAndStop(1) emits ActionGotoFrame (0x81) + ActionStop (0x07)", () => {
    const bytes = compileFrameScript("gotoAndStop(1);");
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_GOTO_FRAME);
    expect(ops).toContain(OP_ACTION_STOP);
    expect(ops).not.toContain(OP_GOTO_FRAME2);
  });

  it("gotoAndPlay(3) emits ActionGotoFrame (0x81) + ActionPlay (0x06)", () => {
    const bytes = compileFrameScript("gotoAndPlay(3);");
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_GOTO_FRAME);
    expect(ops).toContain(OP_ACTION_PLAY);
    expect(ops).not.toContain(OP_GOTO_FRAME2);
  });
});

// ---------------------------------------------------------------------------
// Tests: stop / play
// ---------------------------------------------------------------------------

describe("compileFrameScript: stop / play", () => {
  it("stop() emits ActionStop (0x07)", () => {
    const bytes = compileFrameScript("stop();");
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_ACTION_STOP);
  });

  it("play() emits ActionPlay (0x06)", () => {
    const bytes = compileFrameScript("play();");
    const ops = opcodes(bytes);
    expect(ops).toContain(OP_ACTION_PLAY);
  });
});
