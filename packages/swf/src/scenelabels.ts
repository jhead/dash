/**
 * SceneAndFrameLabelData (SWF tag 86) encoding.
 *
 * This tag tells the Flash player about scene boundaries and named frame labels.
 * It uses SWF's EncodedU32 (variable-length encoding) for counts and frame numbers,
 * and null-terminated UTF-8 strings for names.
 *
 * Body format:
 *   EncodedU32  SceneCount
 *   for each scene:
 *     EncodedU32  FrameOffset    // cumulative frame offset (0 for first scene)
 *     string      Name           // null-terminated UTF-8
 *
 *   EncodedU32  FrameLabelCount
 *   for each labeled frame:
 *     EncodedU32  FrameNum       // 0-based absolute frame number across all scenes
 *     string      Name           // null-terminated UTF-8
 *
 * Frames with label !== '' AND labelType === 'name' or labelType === 'anchor' are included
 * as frame labels. Frames with labelType === 'comment' are excluded.
 * Anchor-type labels must appear in tag 86 so that cross-scene gotoAndPlay("anchorName")
 * resolves correctly in Flash Player.
 */

import type { FlashDocument } from '@flash/core';

// ---------------------------------------------------------------------------
// EncodedU32 helper (SWF variable-length encoding, similar to LEB128)
// ---------------------------------------------------------------------------

/**
 * Encode a 32-bit unsigned integer using SWF's EncodedU32 format.
 * Each byte contributes 7 bits; the high bit indicates more bytes follow.
 */
export function encodeU32(value: number): Uint8Array {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// Null-terminated string helper
// ---------------------------------------------------------------------------

/**
 * Encode a string as null-terminated UTF-8 bytes.
 * Falls back to Latin1/ASCII encoding if TextEncoder is unavailable.
 */
export function encodeString(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    const encoded = new TextEncoder().encode(s);
    const result = new Uint8Array(encoded.length + 1);
    result.set(encoded);
    result[encoded.length] = 0;
    return result;
  }
  // Fallback: Latin1 encoding for ASCII strings
  const result = new Uint8Array(s.length + 1);
  for (let i = 0; i < s.length; i++) {
    result[i] = s.charCodeAt(i) & 0xff;
  }
  result[s.length] = 0;
  return result;
}

// ---------------------------------------------------------------------------
// Concatenate multiple Uint8Arrays
// ---------------------------------------------------------------------------

function concat(...arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const a of arrays) totalLen += a.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tag header builder
// ---------------------------------------------------------------------------

/**
 * Wrap a tag body with the SWF record header for the given tag code.
 * Short header: (tagCode << 6) | length  (if length < 63)
 * Long header:  (tagCode << 6) | 0x3F, then UI32LE length
 */
function buildTagRecord(tagCode: number, body: Uint8Array): Uint8Array {
  if (body.length < 63) {
    const header = new Uint8Array(2);
    const code = (tagCode << 6) | body.length;
    header[0] = code & 0xff;
    header[1] = (code >> 8) & 0xff;
    return concat(header, body);
  } else {
    const header = new Uint8Array(6);
    const code = (tagCode << 6) | 0x3f;
    header[0] = code & 0xff;
    header[1] = (code >> 8) & 0xff;
    header[2] = body.length & 0xff;
    header[3] = (body.length >> 8) & 0xff;
    header[4] = (body.length >> 16) & 0xff;
    header[5] = (body.length >> 24) & 0xff;
    return concat(header, body);
  }
}

// ---------------------------------------------------------------------------
// Scene frame count helper
// ---------------------------------------------------------------------------

function sceneFrameCount(scene: import('@flash/core').Scene): number {
  let max = 1;
  for (const layer of scene.timeline.layers) {
    if (layer.frameCount > max) max = layer.frameCount;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Tag code for SceneAndFrameLabelData */
export const TAG_SCENE_AND_FRAME_LABEL_DATA = 86;

/**
 * Check whether the document has any labeled frames
 * (label !== '' and labelType === 'name' or 'anchor').
 */
export function hasAnyLabels(doc: FlashDocument): boolean {
  for (const scene of doc.scenes) {
    for (const layer of scene.timeline.layers) {
      for (const frame of layer.frames) {
        if (frame.label !== '' && (frame.labelType === 'name' || frame.labelType === 'anchor')) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Encode the SceneAndFrameLabelData (tag 86) as a complete tag record
 * (header + body).
 *
 * @param doc  The FlashDocument to encode scene/label data from.
 * @returns    A Uint8Array containing the full tag record (header + body).
 */
export function encodeSceneAndFrameLabelData(doc: FlashDocument): Uint8Array {
  const scenes = doc.scenes;

  // Build scene data: compute cumulative frame offsets
  const sceneParts: Uint8Array[] = [];
  let frameOffset = 0;
  for (const scene of scenes) {
    sceneParts.push(encodeU32(frameOffset));
    sceneParts.push(encodeString(scene.name));
    frameOffset += sceneFrameCount(scene);
  }

  // Build frame label data: collect labeled frames (labelType === 'name' or 'anchor')
  // Anchor labels must be included so gotoAndPlay("anchorName") resolves across scenes.
  // Track absolute frame numbers across all scenes
  const labelParts: Uint8Array[] = [];
  let labelCount = 0;
  let absoluteFrameBase = 0;

  for (const scene of scenes) {
    // Use a set to deduplicate frame indices (multiple layers may share a label at same index)
    const seenFrameIndices = new Set<number>();

    for (const layer of scene.timeline.layers) {
      for (const frame of layer.frames) {
        if (
          frame.isKeyframe &&
          frame.label !== '' &&
          (frame.labelType === 'name' || frame.labelType === 'anchor') &&
          !seenFrameIndices.has(frame.index)
        ) {
          seenFrameIndices.add(frame.index);
          const absoluteFrameNum = absoluteFrameBase + frame.index;
          labelParts.push(encodeU32(absoluteFrameNum));
          labelParts.push(encodeString(frame.label));
          labelCount++;
        }
      }
    }

    absoluteFrameBase += sceneFrameCount(scene);
  }

  // Assemble body: SceneCount + scene data + FrameLabelCount + label data
  const body = concat(
    encodeU32(scenes.length),
    ...sceneParts,
    encodeU32(labelCount),
    ...labelParts
  );

  // Wrap with tag header
  return buildTagRecord(TAG_SCENE_AND_FRAME_LABEL_DATA, body);
}
