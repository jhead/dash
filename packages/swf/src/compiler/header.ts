/**
 * Header / document-attribute tag bodies.
 *
 * Pure builders for the fixed tags emitted at the top of every SWF
 * (FileAttributes, ProductInfo, SetBackgroundColor) plus the CSS hex-colour
 * parser they share. No shared compile state — safe to call standalone.
 */
import type { FlashDocument } from "@flash/core";
import { BitWriter } from "../bits.js";
import { Tag } from "../tags.js";
import { SwfWriter } from "../writer.js";
import { buildXmpMetadata } from "../metadata.js";
import type { CompileOptions } from "./options.js";

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

/**
 * Emit the fixed header tags at the top of every SWF, in order:
 * FileAttributes (69, must be first), ProductInfo (41), optional Protect (24),
 * optional EnableDebugger2 (64) + DebugId (63), optional Metadata (77), and
 * SetBackgroundColor (9).
 *
 * SceneAndFrameLabelData (86) and ScriptLimits (65) are intentionally NOT
 * emitted — real Flash 8 omits them, and emitting them breaks golden parity.
 */
export function emitHeaderTags(
  writer: SwfWriter,
  props: FlashDocument["properties"],
  options?: CompileOptions
): void {
  // 1. FileAttributes — MUST be first tag in SWF 8
  writer.writeTag(Tag.FileAttributes, buildFileAttributes(!!options?.metadata));

  // 1b. SceneAndFrameLabelData (tag 86) — Flash 9+ tag; not emitted for Flash 8 targets.
  //     Real Flash 8 does not emit this tag. Suppressed to match golden output.

  // 1c-pre. ProductInfo (tag 41) — authoring tool identity; always emitted.
  writer.writeTag(Tag.ProductInfo, buildProductInfo());

  // 1c. Protect tag (24) — marks SWF as password-protected (empty body).
  if (options?.protect) {
    writer.writeTag(Tag.Protect, new Uint8Array(0));
  }

  // 1d. EnableDebugger2 tag (64) — stores debugger password.
  //     Body: uint16 reserved=0, null-terminated password string.
  //     DebugId (tag 63) — 16-byte UUID linking SWF to debug symbols; emitted
  //     alongside EnableDebugger2 (zero UUID = no real debug session).
  if (options?.debugPassword) {
    const encoder = new TextEncoder();
    const pwBytes = encoder.encode(options.debugPassword);
    const body = new Uint8Array(2 + pwBytes.length + 1); // 2 reserved + pw + null
    // body[0] and body[1] are already 0x00 (reserved uint16 = 0)
    body.set(pwBytes, 2);
    // body[2 + pwBytes.length] is already 0x00 (null terminator)
    writer.writeTag(Tag.EnableDebugger2, body);
    // DebugId (tag 63): 16-byte zero UUID
    writer.writeTag(Tag.DebugId, new Uint8Array(16));
  }

  // 1e. Metadata tag (77) — emits XMP metadata when options.metadata is set.
  if (options?.metadata) {
    const xml = buildXmpMetadata(options.metadata);
    const body = new TextEncoder().encode(xml); // UTF-8, no null terminator
    writer.writeTag(Tag.Metadata, body);
  }

  // 2. SetBackgroundColor
  writer.writeTag(
    Tag.SetBackgroundColor,
    buildSetBackgroundColor(props.backgroundColor)
  );

  // 2b. ScriptLimits (tag 65) — not emitted for Flash 8 targets.
  //     Real Flash 8 does not emit this tag; Flash 8 default limits apply.
  //     Suppressed to match golden output.
}
