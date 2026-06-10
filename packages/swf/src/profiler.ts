/**
 * Bandwidth profiler — per-frame SWF size analysis.
 *
 * Parses a compiled SWF binary and splits it by ShowFrame (tag 1) tags,
 * reporting the number of bytes contributed to each frame.
 */

// ShowFrame tag code = 1
const TAG_SHOW_FRAME = 1;

export interface FrameSizeReport {
  /** Total number of frames found in the SWF. */
  frameCount: number;
  /** Bytes contributed to each frame (index = frame number, 0-based). */
  frameSizes: number[];
  /** Total byte size of the SWF. */
  totalBytes: number;
  /** Index of the largest frame (most bytes). */
  largestFrame: number;
  /** Average bytes per frame. */
  averageFrameBytes: number;
}

/**
 * Parse a compiled SWF binary, group tags by frame boundary (ShowFrame),
 * and return per-frame byte counts.
 *
 * SWF tag format:
 *   UI16  TagCodeAndLength  (bits 15:6 = tag code, bits 5:0 = length or 0x3f)
 *   [UI32 LongLength]       (only when bits 5:0 === 0x3f)
 *   [data bytes]
 *
 * Each ShowFrame (tag 1) tag closes the current frame.  Bytes before the
 * first ShowFrame (header + preamble tags) are counted into frame 0.
 */
export function analyzeFrameSizes(swfBytes: Uint8Array): FrameSizeReport {
  const totalBytes = swfBytes.length;

  // ---- Locate the start of the tag stream --------------------------------
  // SWF header: signature (3 bytes) + version (1 byte) + fileLength (4 bytes) = 8 bytes
  // Then RECT (variable bit-packed): first 5 bits of byte 8 give Nbits.
  const nbits = swfBytes[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  // After RECT: FrameRate (UI16) + FrameCount (UI16) = 4 bytes
  let pos = 8 + rectBytes + 4;

  // ---- Walk tags -----------------------------------------------------------
  const frameSizes: number[] = [];
  let currentFrameBytes = pos; // bytes consumed so far go into frame 0

  while (pos < swfBytes.length - 1) {
    const tagStart = pos;
    // Read tag record header (2 bytes)
    if (pos + 2 > swfBytes.length) break;
    const h = swfBytes[pos] | (swfBytes[pos + 1] << 8);
    pos += 2;
    const tagCode = (h >> 6) & 0x3ff;
    let tagBodyLen = h & 0x3f;
    if (tagBodyLen === 0x3f) {
      // Long form: next 4 bytes are UI32 body length
      if (pos + 4 > swfBytes.length) break;
      tagBodyLen =
        swfBytes[pos] |
        (swfBytes[pos + 1] << 8) |
        (swfBytes[pos + 2] << 16) |
        (swfBytes[pos + 3] << 24);
      pos += 4;
    }

    // Advance past the tag body
    pos += tagBodyLen;

    // Total bytes this tag record occupied (header + body)
    const tagTotalBytes = pos - tagStart;

    if (tagCode === 0) {
      // End tag — stop parsing; attribute its bytes to the last frame
      currentFrameBytes += tagTotalBytes;
      break;
    }

    if (tagCode === TAG_SHOW_FRAME) {
      // Close the current frame: add ShowFrame bytes then record
      currentFrameBytes += tagTotalBytes;
      frameSizes.push(currentFrameBytes);
      currentFrameBytes = 0;
    } else {
      currentFrameBytes += tagTotalBytes;
    }
  }

  // If there were trailing bytes not terminated by a ShowFrame, attribute them
  // to a final implicit frame (edge case: shouldn't happen in well-formed SWFs).
  if (currentFrameBytes > 0 && frameSizes.length === 0) {
    frameSizes.push(currentFrameBytes);
  }

  // Guard: ensure at least one frame entry
  if (frameSizes.length === 0) {
    frameSizes.push(totalBytes);
  }

  const frameCount = frameSizes.length;
  const sum = frameSizes.reduce((a, b) => a + b, 0);
  const averageFrameBytes = frameCount > 0 ? sum / frameCount : 0;

  let largestFrame = 0;
  for (let i = 1; i < frameSizes.length; i++) {
    if (frameSizes[i]! > frameSizes[largestFrame]!) largestFrame = i;
  }

  return { frameCount, frameSizes, totalBytes, largestFrame, averageFrameBytes };
}
