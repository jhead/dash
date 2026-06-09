/**
 * SoundInfo struct encoding and StartSound (tag 15) body builder.
 *
 * SoundInfo struct format (SWF spec):
 *   uint8  SoundFlags:
 *     bit 0: hasInPoint
 *     bit 1: hasOutPoint
 *     bit 2: hasLoops
 *     bit 3: hasEnvelope
 *     bit 4: noMultiple (don't start if already playing)
 *     bit 5: stop (stop the sound)
 *   uint32 InPoint     (present if hasInPoint)  — sample index
 *   uint32 OutPoint    (present if hasOutPoint) — sample index
 *   uint16 LoopCount   (present if hasLoops)    — 0 = loop forever, 1 = play once
 *   uint8  EnvelopeCount (present if hasEnvelope)
 *     for each envelope point:
 *       uint32 Pos44     — sample position at 44KHz
 *       uint16 LeftLevel  — 0-32768
 *       uint16 RightLevel — 0-32768
 *
 * StartSound (tag 15) body:
 *   uint16  SoundId    — character ID of the sound
 *   SoundInfo struct
 */
import { BitWriter } from "./bits.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SoundInfoOptions {
  /** Loop count: 0 = loop indefinitely, N = play N times. */
  loops?: number;
  /** In-point sample index. */
  inPoint?: number;
  /** Out-point sample index. */
  outPoint?: number;
  /** Don't start if already playing (SyncNoMultiple). */
  noMultiple?: boolean;
  /** Stop the sound. */
  stop?: boolean;
}

// ---------------------------------------------------------------------------
// encodeSoundInfo
// ---------------------------------------------------------------------------

/**
 * Encode a SoundInfo struct into a Uint8Array.
 *
 * The minimal encoding for an empty options object is a single byte (flags = 0).
 */
export function encodeSoundInfo(opts: SoundInfoOptions = {}): Uint8Array {
  const hasInPoint = opts.inPoint !== undefined ? 1 : 0;
  const hasOutPoint = opts.outPoint !== undefined ? 1 : 0;
  const hasLoops = opts.loops !== undefined ? 1 : 0;
  const noMultiple = opts.noMultiple ? 1 : 0;
  const stop = opts.stop ? 1 : 0;

  const flags =
    hasInPoint |
    (hasOutPoint << 1) |
    (hasLoops << 2) |
    // bit 3: hasEnvelope — always 0 for now
    (noMultiple << 4) |
    (stop << 5);

  const bw = new BitWriter();
  bw.writeUI8(flags);

  if (hasInPoint) {
    bw.writeUI32LE(opts.inPoint!);
  }
  if (hasOutPoint) {
    bw.writeUI32LE(opts.outPoint!);
  }
  if (hasLoops) {
    // loops: 0 = infinite, N = play N times — maps directly to SWF LoopCount
    bw.writeUI16LE(opts.loops!);
  }
  // hasEnvelope = 0, no envelope bytes written

  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// encodeStartSound
// ---------------------------------------------------------------------------

/**
 * Encode a StartSound (tag 15) body.
 *
 * Body layout:
 *   uint16  SoundId
 *   SoundInfo struct (from encodeSoundInfo)
 */
export function encodeStartSound(
  soundId: number,
  opts: SoundInfoOptions = {}
): Uint8Array {
  const soundInfo = encodeSoundInfo(opts);
  const bw = new BitWriter();
  bw.writeUI16LE(soundId);
  bw.writeBytes(soundInfo);
  return bw.getBytes();
}
