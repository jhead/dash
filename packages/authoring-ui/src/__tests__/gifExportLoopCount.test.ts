/**
 * Regression test for task 1289 — GIF export: finite Loop count was ignored.
 *
 * The Animated GIF export path (useExportHandlers.handleExportGifConfirm) used to derive
 * gifenc's `repeat` as `options.loopForever ? 0 : -1`. gifenc only writes the NETSCAPE2.0
 * application-extension (which carries the loop count) when repeat >= 0, so -1 meant NO
 * extension was emitted and the GIF played exactly once — the user's finite Loop count was
 * silently discarded.
 *
 * These tests pin both halves of the fix:
 *   1. gifLoopRepeat() derives the correct gifenc `repeat` from the dialog options
 *      (0 = forever, N = finite N).
 *   2. Feeding that repeat through the REAL encoder (gifenc, same version the export uses)
 *      produces GIF bytes whose NETSCAPE2.0 sub-block encodes the requested loop count for a
 *      finite value, and 0 (forever) for loopForever.
 */

import { describe, it, expect } from "vitest";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { gifLoopRepeat } from "../hooks/useExportHandlers.js";

/**
 * Scan a GIF byte stream for the NETSCAPE2.0 application extension and return its encoded
 * loop count (2-byte little-endian), or null if no such extension is present.
 *
 * Layout per GIF89a spec:
 *   0x21 0xFF 0x0B "NETSCAPE2.0" 0x03 0x01 <loopLo> <loopHi> 0x00
 */
function readNetscapeLoopCount(bytes: Uint8Array): number | null {
  const id = "NETSCAPE2.0";
  for (let i = 0; i + 2 + id.length < bytes.length; i++) {
    if (bytes[i] !== 0x21 || bytes[i + 1] !== 0xff || bytes[i + 2] !== id.length) {
      continue;
    }
    let matches = true;
    for (let k = 0; k < id.length; k++) {
      if (bytes[i + 3 + k] !== id.charCodeAt(k)) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    // After the 11-byte identifier: sub-block size (0x03), sub-block id (0x01),
    // then the 2-byte LE loop count.
    const subStart = i + 3 + id.length;
    expect(bytes[subStart]).toBe(0x03); // sub-block byte size
    expect(bytes[subStart + 1]).toBe(0x01); // NETSCAPE loop sub-block id
    return bytes[subStart + 2] | (bytes[subStart + 3] << 8);
  }
  return null;
}

/** Encode a tiny 2-frame GIF the same way the export path does, with the given repeat. */
function encode2FrameGif(repeat: number): Uint8Array {
  const w = 2;
  const h = 2;
  const gif = GIFEncoder();
  for (let fi = 0; fi < 2; fi++) {
    // 2x2 solid RGBA frame (alternating colors so the two frames differ).
    const rgba = new Uint8Array(w * h * 4);
    const v = fi === 0 ? 0 : 255;
    for (let p = 0; p < w * h; p++) {
      rgba[p * 4] = v;
      rgba[p * 4 + 1] = v;
      rgba[p * 4 + 2] = v;
      rgba[p * 4 + 3] = 255;
    }
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, w, h, {
      palette,
      delay: 100,
      repeat: fi === 0 ? repeat : undefined,
    });
  }
  gif.finish();
  return gif.bytes();
}

describe("gifLoopRepeat (task 1289)", () => {
  it("maps loopForever -> 0 (NETSCAPE loop count for infinite)", () => {
    expect(gifLoopRepeat({ loopForever: true, loopCount: 5 })).toBe(0);
  });

  it("maps a finite loop count through unchanged", () => {
    expect(gifLoopRepeat({ loopForever: false, loopCount: 3 })).toBe(3);
    expect(gifLoopRepeat({ loopForever: false, loopCount: 1 })).toBe(1);
    expect(gifLoopRepeat({ loopForever: false, loopCount: 65535 })).toBe(65535);
  });

  it("clamps a sub-1 finite loop count to 1 (matches the dialog's clamp)", () => {
    expect(gifLoopRepeat({ loopForever: false, loopCount: 0 })).toBe(1);
    expect(gifLoopRepeat({ loopForever: false, loopCount: -4 })).toBe(1);
  });
});

describe("GIF export NETSCAPE2.0 loop encoding (task 1289)", () => {
  it("encodes a finite loop count (3) into the NETSCAPE2.0 extension", () => {
    const repeat = gifLoopRepeat({ loopForever: false, loopCount: 3 });
    const bytes = encode2FrameGif(repeat);
    expect(readNetscapeLoopCount(bytes)).toBe(3);
  });

  it("encodes loopForever as a NETSCAPE2.0 extension with count 0 (infinite)", () => {
    const repeat = gifLoopRepeat({ loopForever: true, loopCount: 1 });
    const bytes = encode2FrameGif(repeat);
    expect(readNetscapeLoopCount(bytes)).toBe(0);
  });

  it("a finite loop count is NOT dropped (regression: old code emitted no extension)", () => {
    // Old behaviour: repeat = -1 -> gifenc omits the extension entirely -> plays once.
    const oldBytes = encode2FrameGif(-1);
    expect(readNetscapeLoopCount(oldBytes)).toBeNull();

    // Fixed behaviour: a finite count now produces the extension carrying that count.
    const fixedBytes = encode2FrameGif(
      gifLoopRepeat({ loopForever: false, loopCount: 7 })
    );
    expect(readNetscapeLoopCount(fixedBytes)).toBe(7);
  });
});
