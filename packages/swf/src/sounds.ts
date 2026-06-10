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
import type { SoundEffect } from "@flash/core";
import { BitWriter } from "./bits.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One SoundEnvelope point: sample position + left/right levels (0-32768). */
export interface SoundEnvelopePoint {
  /** Sample position in 44100 Hz units. */
  pos44: number;
  /** Left channel level (0-32768). */
  leftLevel: number;
  /** Right channel level (0-32768). */
  rightLevel: number;
}

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
  /** Explicit envelope points. Mutually exclusive with `effect`. */
  envelope?: SoundEnvelopePoint[];
  /** Preset effect to expand into envelope points. Ignored if `envelope` is set. */
  effect?: SoundEffect;
}

// ---------------------------------------------------------------------------
// effectToEnvelope
// ---------------------------------------------------------------------------

/**
 * Expand a SoundEffect preset into SoundEnvelope points.
 * All positions are in 44100 Hz sample units, levels 0-32768.
 *
 * Flash standard presets (matches Flash authoring tool output):
 *   fadeIn         : silence → full over ~44100 samples (1 s at 44 kHz)
 *   fadeOut        : full → silence over ~44100 samples
 *   left           : left channel at full, right channel at 0
 *   right          : right channel at full, left channel at 0
 *   fadeLeftToRight: left full→0, right 0→full
 *   fadeRightToLeft: right full→0, left 0→full
 */
export function effectToEnvelope(effect: SoundEffect): SoundEnvelopePoint[] | null {
  switch (effect) {
    case "none":
      return null;
    case "fadeIn":
      return [
        { pos44: 0,     leftLevel: 0,     rightLevel: 0 },
        { pos44: 44100, leftLevel: 32768, rightLevel: 32768 },
      ];
    case "fadeOut":
      return [
        { pos44: 0,     leftLevel: 32768, rightLevel: 32768 },
        { pos44: 44100, leftLevel: 0,     rightLevel: 0 },
      ];
    case "left":
      return [
        { pos44: 0,     leftLevel: 32768, rightLevel: 0 },
        { pos44: 44100, leftLevel: 32768, rightLevel: 0 },
      ];
    case "right":
      return [
        { pos44: 0,     leftLevel: 0,     rightLevel: 32768 },
        { pos44: 44100, leftLevel: 0,     rightLevel: 32768 },
      ];
    case "fadeLeftToRight":
      return [
        { pos44: 0,     leftLevel: 32768, rightLevel: 0 },
        { pos44: 44100, leftLevel: 0,     rightLevel: 32768 },
      ];
    case "fadeRightToLeft":
      return [
        { pos44: 0,     leftLevel: 0,     rightLevel: 32768 },
        { pos44: 44100, leftLevel: 32768, rightLevel: 0 },
      ];
    default:
      return null;
  }
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

  // Resolve envelope: explicit points win; fall back to preset expansion
  const envelopePoints: SoundEnvelopePoint[] =
    opts.envelope && opts.envelope.length > 0
      ? opts.envelope
      : (opts.effect ? (effectToEnvelope(opts.effect) ?? []) : []);
  const hasEnvelope = envelopePoints.length > 0 ? 1 : 0;

  const flags =
    hasInPoint |
    (hasOutPoint << 1) |
    (hasLoops << 2) |
    (hasEnvelope << 3) |
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
  if (hasEnvelope) {
    bw.writeUI8(envelopePoints.length);
    for (const pt of envelopePoints) {
      bw.writeUI32LE(pt.pos44);
      bw.writeUI16LE(pt.leftLevel);
      bw.writeUI16LE(pt.rightLevel);
    }
  }

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

// ---------------------------------------------------------------------------
// encodeStartSound2
// ---------------------------------------------------------------------------

/**
 * Encode a StartSound2 (tag 89) body.
 *
 * Body layout (SWF spec §12.5):
 *   SoundClassName (null-terminated string) — linkage class name of the sound
 *   SoundInfo struct (from encodeSoundInfo)
 *
 * StartSound2 triggers a sound by its AS2 linkage class name rather than by
 * SWF character ID, enabling attachSound() and new Sound() class patterns.
 */
export function encodeStartSound2(
  soundClassName: string,
  opts: SoundInfoOptions = {}
): Uint8Array {
  const soundInfo = encodeSoundInfo(opts);
  const bw = new BitWriter();
  bw.writeString(soundClassName); // null-terminated
  bw.writeBytes(soundInfo);
  return bw.getBytes();
}
