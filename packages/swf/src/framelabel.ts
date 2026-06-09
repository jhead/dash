/**
 * FrameLabel (SWF tag 43) encoding.
 *
 * Tag body:
 *   "<label>\0"          — standard named frame label
 *   "<label>\0\x01"      — named anchor (second byte = 0x01)
 *
 * Standard SWF tag record header:
 *   If body < 63 bytes:  (43 << 2) | bodyLen  as uint16  ← NOTE: SWF uses (type << 6) | len
 *   Actually: (43 << 6) | bodyLen as uint16 for short form
 *   If body >= 63 bytes: (43 << 6) | 0x3F as uint16, then int32 bodyLen
 *
 * This module exports only the *body* bytes; callers use SwfWriter.writeTag() to
 * wrap with the record header.
 */

/**
 * Encode the body of a FrameLabel (tag 43) tag.
 *
 * @param label     The frame label string (must not be empty).
 * @param isAnchor  When true, appends the named-anchor flag byte (0x01) after the
 *                  null terminator.
 * @returns         Uint8Array body bytes (null-terminated string, optionally + 0x01).
 */
export function encodeFrameLabel(label: string, isAnchor: boolean): Uint8Array {
  // Encode label as UTF-8
  const encoded = new TextEncoder().encode(label);
  // Body = encoded label + NUL + optional anchor byte
  const bodyLen = encoded.length + 1 + (isAnchor ? 1 : 0);
  const body = new Uint8Array(bodyLen);
  body.set(encoded, 0);
  body[encoded.length] = 0x00; // NUL terminator
  if (isAnchor) {
    body[encoded.length + 1] = 0x01; // named anchor flag
  }
  return body;
}
