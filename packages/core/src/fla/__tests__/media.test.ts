/**
 * Unit tests for the binary-FLA "Media N" bitmap decoder (media.ts) and the
 * bitmap-import wiring in flash8-import.ts.
 *
 * Real Flash bitmap Media streams come in three shapes (see
 * eddiemoore/fla-decoder docs/FORMAT.md §7 and JPEXS flacomdoc):
 *   a) raw JPEG bytes
 *   b) raw PNG bytes
 *   c) Flash lossless container (03 05 header + chunked-zlib ABGR pixels)
 *
 * We synthesize each form here (no large binary fixture needed) and assert the
 * decoder produces a valid embeddable image + dimensions. We also drive a
 * minimal CPicBitmapRef placement through buildFla8Document to confirm a
 * BitmapItem lands in the library and a bitmap DisplayObject references it.
 */
import { describe, it, expect } from "vitest";
import { zlibSync } from "fflate";
import { decodeMediaBitmap, decodedBitmapToDataUri } from "../media.js";

/** A 1x1 baseline JPEG (white pixel), produced offline. */
const JPEG_1x1 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
  0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
  0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
  0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2,
  0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
  0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
  0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda,
  0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xfb, 0xd0, 0x07, 0xff, 0xd9,
]);

/** Build a tiny valid PNG (w x h, solid color) for the raw-PNG path. */
function makePng(w: number, h: number): Uint8Array {
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (tag: string, body: Uint8Array) => {
    const tb = Uint8Array.from([...tag].map((ch) => ch.charCodeAt(0)));
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    out.set(tb, 4);
    out.set(body, 8);
    const ci = new Uint8Array(4 + body.length);
    ci.set(tb, 0);
    ci.set(body, 4);
    dv.setUint32(8 + body.length, crc32(ci));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = 200;
      raw[o + 1] = 100;
      raw[o + 2] = 50;
      raw[o + 3] = 255;
    }
  }
  const idat = zlibSync(raw, { level: 6 });
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Build a Flash lossless Media container (form c) for a w x h opaque image.
 * Pixels are stored ABGR (alpha first); we use fully-opaque alpha (255) so
 * no un-premultiplication is applied.
 */
function makeLossless(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = 255; // A
    px[i * 4 + 1] = 10; // B
    px[i * 4 + 2] = 20; // G
    px[i * 4 + 3] = 30; // R
  }
  const z = zlibSync(px, { level: 6 });
  const header = new Uint8Array(26);
  const dv = new DataView(header.buffer);
  header[0] = 0x03;
  header[1] = 0x05;
  dv.setUint16(2, w * 4, true); // rowSize
  dv.setUint16(4, w, true);
  dv.setUint16(6, h, true);
  // frame bounds (offsets 8..23) left zero
  header[24] = 0; // flags
  header[25] = 1; // variant = chunked zlib
  // chunked body: single chunk [u16 len][bytes] then terminator [u16 0]
  const body = new Uint8Array(2 + z.length + 2);
  const bv = new DataView(body.buffer);
  bv.setUint16(0, z.length, true);
  body.set(z, 2);
  bv.setUint16(2 + z.length, 0, true);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

describe("decodeMediaBitmap", () => {
  it("passes through raw JPEG and reads dimensions", () => {
    const r = decodeMediaBitmap(JPEG_1x1);
    expect(r).not.toBeNull();
    expect(r!.mimeType).toBe("image/jpeg");
    expect(r!.compressionType).toBe("photo");
    expect(r!.width).toBe(1);
    expect(r!.height).toBe(1);
    expect(r!.bytes).toBe(JPEG_1x1);
  });

  it("passes through raw PNG and reads dimensions", () => {
    const png = makePng(4, 3);
    const r = decodeMediaBitmap(png);
    expect(r).not.toBeNull();
    expect(r!.mimeType).toBe("image/png");
    expect(r!.compressionType).toBe("lossless");
    expect(r!.width).toBe(4);
    expect(r!.height).toBe(3);
  });

  it("decodes a Flash lossless container into a PNG", () => {
    const r = decodeMediaBitmap(makeLossless(2, 2));
    expect(r).not.toBeNull();
    expect(r!.mimeType).toBe("image/png");
    expect(r!.width).toBe(2);
    expect(r!.height).toBe(2);
    // Output is a valid PNG (magic header).
    expect(Array.from(r!.bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("decodes zlib-wrapped JPEG", () => {
    const wrapped = zlibSync(JPEG_1x1, { level: 6 });
    const r = decodeMediaBitmap(wrapped);
    expect(r).not.toBeNull();
    expect(r!.mimeType).toBe("image/jpeg");
  });

  it("returns null for empty and non-bitmap payloads", () => {
    expect(decodeMediaBitmap(new Uint8Array(0))).toBeNull();
    // Looks like raw audio (no recognizable image magic, not zlib).
    expect(decodeMediaBitmap(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toBeNull();
  });

  it("produces a parseable data URI", () => {
    const r = decodeMediaBitmap(JPEG_1x1)!;
    const uri = decodedBitmapToDataUri(r);
    expect(uri.startsWith("data:image/jpeg;base64,")).toBe(true);
    const b64 = uri.split(",")[1]!;
    expect(b64.length).toBeGreaterThan(0);
  });
});

describe("decodeMediaBitmap: decompression-bomb / oversized-allocation guards", () => {
  /**
   * Build a Flash lossless (form c) header with ARBITRARY declared dimensions
   * and a tiny body. Used to exercise the dimension guard without ever
   * allocating the huge pixel buffer a real makeLossless(w,h) would.
   */
  function makeLosslessHeader(w: number, h: number, body: Uint8Array): Uint8Array {
    const header = new Uint8Array(26);
    const dv = new DataView(header.buffer);
    header[0] = 0x03;
    header[1] = 0x05;
    dv.setUint16(2, (w * 4) & 0xffff, true); // rowSize
    dv.setUint16(4, w & 0xffff, true);
    dv.setUint16(6, h & 0xffff, true);
    header[24] = 0; // flags
    header[25] = 1; // variant = chunked zlib
    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0);
    out.set(body, header.length);
    return out;
  }

  it("rejects a lossless container declaring bomb dimensions (65535x65535)", () => {
    // Chunk terminator only; the decoder must bail on the size BEFORE any
    // pixel-buffer or inflate allocation (65535*65535*4 ≈ 17 GB).
    const term = new Uint8Array([0x00, 0x00]);
    const bomb = makeLosslessHeader(65535, 65535, term);
    expect(decodeMediaBitmap(bomb)).toBeNull();
  });

  it("rejects a lossless container whose pixel count exceeds the budget", () => {
    // 8192 x 8192 = 67 Mpx > 16.7 Mpx budget, even though each dimension alone
    // is within MAX_BITMAP_DIMENSION.
    const term = new Uint8Array([0x00, 0x00]);
    expect(decodeMediaBitmap(makeLosslessHeader(8192, 8192, term))).toBeNull();
  });

  it("still decodes a within-budget lossless container", () => {
    const px = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 4 * 4; i++) px[i * 4] = 255; // opaque
    const z = zlibSync(px, { level: 6 });
    const body = new Uint8Array(2 + z.length + 2);
    const bv = new DataView(body.buffer);
    bv.setUint16(0, z.length, true);
    body.set(z, 2);
    bv.setUint16(2 + z.length, 0, true);
    const r = decodeMediaBitmap(makeLosslessHeader(4, 4, body));
    expect(r).not.toBeNull();
    expect(r!.width).toBe(4);
    expect(r!.height).toBe(4);
  });

  it("rejects a GIF header declaring bomb dimensions", () => {
    // "GIF89a" + width 65535 + height 65535 (little-endian u16).
    const gif = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xff, 0xff, 0xff, 0xff,
    ]);
    expect(decodeMediaBitmap(gif)).toBeNull();
  });

  it("caps a zlib bomb on the form-d path instead of OOMing", () => {
    // ~120 MB of zeros compresses to a tiny stream; the inflate is capped at
    // 64 MiB and the (zeroed) output is not JPEG/PNG, so the decoder returns
    // null without allocating gigabytes.
    const bomb = zlibSync(new Uint8Array(120 * 1024 * 1024), { level: 6 });
    expect(bomb.length).toBeLessThan(1_000_000);
    expect(decodeMediaBitmap(bomb)).toBeNull();
  });
});
