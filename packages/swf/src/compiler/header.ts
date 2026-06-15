/**
 * Header / document-attribute tag bodies.
 *
 * Pure builders for the fixed tags emitted at the top of every SWF
 * (FileAttributes, ProductInfo, SetBackgroundColor) plus the CSS hex-colour
 * parser they share. No shared compile state — safe to call standalone.
 */
import { BitWriter } from "../bits.js";

/** Parse a CSS hex color string like "#rrggbb" → { r, g, b }. */
export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

/**
 * FileAttributes (tag 69) — MUST be the first tag in SWF v8+.
 * 4-byte UI32 flags:
 *   bit 0: useNetwork (0 = local/sandbox, 1 = network)
 *   bit 3: actionScript3
 *   bit 4: hasMetadata (set when a Metadata tag (77) is present)
 * For AS2, local sandbox: 0x00000000
 */
export function buildFileAttributes(hasMetadata?: boolean): Uint8Array {
  const bw = new BitWriter();
  const flags = hasMetadata ? 0x00000010 : 0x00000000;
  bw.writeUI32LE(flags);
  return bw.getBytes();
}

/**
 * SetBackgroundColor (tag 9) — 3 bytes: R G B.
 */
export function buildSetBackgroundColor(hex: string): Uint8Array {
  const { r, g, b } = parseHexColor(hex);
  const bw = new BitWriter();
  bw.writeUI8(r);
  bw.writeUI8(g);
  bw.writeUI8(b);
  return bw.getBytes();
}

/**
 * ProductInfo (tag 41) — identifies the authoring tool that produced the SWF.
 * Body layout (26 bytes):
 *   UI32 productId    = 8  (Flash 8 authoring tool)
 *   UI32 edition      = 0  (Standard)
 *   UI8  majorVersion = 8
 *   UI8  minorVersion = 0
 *   UI64 buildNumber  = 0  (two UI32s LE)
 *   UI64 compileTime  = 0  (milliseconds since 1 Jan 1970 UTC, two UI32s LE)
 */
export function buildProductInfo(): Uint8Array {
  // 4 + 4 + 1 + 1 + 8 + 8 = 26 bytes
  const buf = new ArrayBuffer(26);
  const view = new DataView(buf);
  view.setUint32(0, 8, true);  // productId = 8 (Flash 8)
  view.setUint32(4, 0, true);  // edition   = 0
  view.setUint8(8, 8);         // majorVersion = 8
  view.setUint8(9, 0);         // minorVersion = 0
  // buildNumber UI64 @ offset 10 — low/high UI32, both zero
  view.setUint32(10, 0, true);
  view.setUint32(14, 0, true);
  // compileTime UI64 @ offset 18 — low/high UI32, both zero
  view.setUint32(18, 0, true);
  view.setUint32(22, 0, true);
  return new Uint8Array(buf);
}
