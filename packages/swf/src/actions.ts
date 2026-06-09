/**
 * AVM1 action record encoders for SWF DoAction (tag 12).
 *
 * Supports a minimal subset of ActionScript 2 commonly used in frame scripts.
 */
import { BitWriter } from "./bits.js";

/** Encode an AVM1 ActionPush for a string value. */
export function actionPushString(value: string): Uint8Array {
  const bw = new BitWriter();
  const strBytes = new TextEncoder().encode(value);
  const payloadLen = 1 + strBytes.length + 1; // type byte + string bytes + null terminator
  bw.writeUI8(0x96); // ActionPush opcode
  bw.writeUI16LE(payloadLen);
  bw.writeUI8(0); // type = string
  for (const b of strBytes) bw.writeUI8(b);
  bw.writeUI8(0); // null terminator
  return bw.getBytes();
}

/** Encode a no-payload AVM1 action (opcodes < 0x80). */
export function actionNoArg(opcode: number): Uint8Array {
  const bw = new BitWriter();
  bw.writeUI8(opcode);
  return bw.getBytes();
}

export const ACTION_TRACE = (): Uint8Array => actionNoArg(0x26);
export const ACTION_STOP = (): Uint8Array => actionNoArg(0x07);
export const ACTION_PLAY = (): Uint8Array => actionNoArg(0x06);
export const ACTION_STOP_SOUNDS = (): Uint8Array => actionNoArg(0x1d);

/**
 * Parse a simple frame script and emit AVM1 bytecode.
 *
 * Handles a minimal subset of ActionScript commonly used in frame scripts:
 *   stop();           → ActionStop (0x07)
 *   play();           → ActionPlay (0x06)
 *   stopAllSounds();  → ActionStopSounds (0x1D)
 *   trace("...");     → ActionPush string + ActionTrace
 *   gotoAndPlay(N);   → ActionGotoFrame (0x81) + ActionPlay
 *   gotoAndStop(N);   → ActionGotoFrame (0x81) + ActionStop
 *
 * For unrecognized lines: emit nothing (skip safely).
 * Returns the concatenated action bytes WITHOUT the EndAction 0x00.
 */
export function compileFrameScript(script: string): Uint8Array {
  const actions: Uint8Array[] = [];

  // Strip single-line and multi-line comments, then split into lines
  const lines = script
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // stop()
    if (/^stop\s*\(\s*\)\s*;?$/.test(line)) {
      actions.push(ACTION_STOP());
      continue;
    }
    // play()
    if (/^play\s*\(\s*\)\s*;?$/.test(line)) {
      actions.push(ACTION_PLAY());
      continue;
    }
    // stopAllSounds()
    if (/^stopAllSounds\s*\(\s*\)\s*;?$/.test(line)) {
      actions.push(ACTION_STOP_SOUNDS());
      continue;
    }
    // trace("message") or trace('message')
    const traceMatch = line.match(/^trace\s*\(\s*["'](.*)["']\s*\)\s*;?$/);
    if (traceMatch) {
      actions.push(actionPushString(traceMatch[1]));
      actions.push(ACTION_TRACE());
      continue;
    }
    // gotoAndPlay(N) — ActionGotoFrame (0x81) is >= 0x80, so it has a length prefix
    const gotoPlayMatch = line.match(/^gotoAndPlay\s*\(\s*(\d+)\s*\)\s*;?$/);
    if (gotoPlayMatch) {
      const frameNum = parseInt(gotoPlayMatch[1], 10) - 1; // 0-indexed
      const bw = new BitWriter();
      bw.writeUI8(0x81); // ActionGotoFrame opcode
      bw.writeUI16LE(2); // payload length = 2 bytes
      bw.writeUI16LE(frameNum);
      actions.push(bw.getBytes());
      actions.push(ACTION_PLAY());
      continue;
    }
    // gotoAndStop(N)
    const gotoStopMatch = line.match(/^gotoAndStop\s*\(\s*(\d+)\s*\)\s*;?$/);
    if (gotoStopMatch) {
      const frameNum = parseInt(gotoStopMatch[1], 10) - 1; // 0-indexed
      const bw = new BitWriter();
      bw.writeUI8(0x81); // ActionGotoFrame opcode
      bw.writeUI16LE(2); // payload length = 2 bytes
      bw.writeUI16LE(frameNum);
      actions.push(bw.getBytes());
      actions.push(ACTION_STOP());
      continue;
    }
    // Unknown line: skip silently (safer than erroring)
  }

  // Concatenate all action byte arrays
  const totalLen = actions.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of actions) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Encode a complete DoAction tag body (actions + EndAction 0x00).
 * Returns null if the script produces no recognized actions.
 */
export function encodeDoAction(script: string): Uint8Array | null {
  const actionBytes = compileFrameScript(script);
  if (actionBytes.length === 0) return null;

  const bw = new BitWriter();
  bw.writeBytes(actionBytes);
  bw.writeUI8(0); // EndAction
  return bw.getBytes();
}
