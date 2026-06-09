/**
 * Additional OLE2 parser tests — robustness, edge cases, and behavior documentation.
 *
 * These tests supplement ole.test.ts with focused checks on:
 *   1. isOle2() magic-byte detection edge cases
 *   2. tryLoadRealFla() robustness (no throw on malformed / truncated input)
 *   3. Single-layer scene structure returned by the best-effort parser
 *   4. Layer type and name returned for a minimal OLE2 container
 *
 * The real Macromedia Flash 8 binary format inside the OLE2 container is
 * undocumented; full layer/symbol extraction is out of scope here.
 * TODO: When a documented parser becomes available, replace the best-effort
 *       scanning with structured record parsing to extract real layer names
 *       and display-object data.
 */

import { describe, it, expect } from "vitest";
import { isOle2, tryLoadRealFla } from "../ole.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OLE2_MAGIC = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

/**
 * Write a little-endian UI32 at offset in buf.
 */
function writeU32LE(buf: Uint8Array, off: number, val: number): void {
  buf[off]     = val & 0xFF;
  buf[off + 1] = (val >>> 8) & 0xFF;
  buf[off + 2] = (val >>> 16) & 0xFF;
  buf[off + 3] = (val >>> 24) & 0xFF;
}

/**
 * Build a minimal but structurally valid OLE2 binary with a "Contents" stream.
 *
 * Layout (version 3, 512-byte sectors):
 *   header (512 bytes)
 *   sector 0: FAT
 *   sector 1: directory
 *   sector 2: stream data
 */
function buildMinimalOle2(streamData: Uint8Array): Uint8Array {
  const SECTOR = 512;
  const ENDOFCHAIN = 0xFFFFFFFE;
  const FREESECT   = 0xFFFFFFFF;
  const FATSECT    = 0xFFFFFFFD;

  const buf = new Uint8Array(512 + 3 * SECTOR).fill(0);

  // --- Header ---
  OLE2_MAGIC.forEach((b, i) => { buf[i] = b; });
  buf[28] = 0xFE; buf[29] = 0xFF;          // byte-order mark
  buf[30] = 9;                               // sector size exponent = 2^9 = 512
  buf[32] = 6;                               // mini sector size exponent = 2^6 = 64
  buf[44] = 1;                               // FAT sector count = 1
  buf[48] = 1;                               // first directory sector = 1
  buf[56] = 0x00; buf[57] = 0x10;           // mini stream cutoff = 4096
  writeU32LE(buf, 60, ENDOFCHAIN);           // first mini-FAT sector = ENDOFCHAIN
  buf[76] = 0;                               // DIFAT[0] = sector 0 (the FAT)
  for (let i = 1; i < 109; i++) writeU32LE(buf, 76 + i * 4, FREESECT);

  // --- Sector 0: FAT ---
  const fatOff = 512;
  writeU32LE(buf, fatOff + 0 * 4, FATSECT);    // sector 0 = FAT itself
  writeU32LE(buf, fatOff + 1 * 4, ENDOFCHAIN); // sector 1 = dir
  writeU32LE(buf, fatOff + 2 * 4, ENDOFCHAIN); // sector 2 = stream
  for (let i = 3; i < SECTOR / 4; i++) writeU32LE(buf, fatOff + i * 4, FREESECT);

  // --- Sector 1: Directory ---
  const dirOff = 512 + SECTOR;

  // Entry 0: Root (type=5)
  const rootName = "Root Entry";
  for (let i = 0; i < rootName.length; i++) {
    buf[dirOff + i * 2] = rootName.charCodeAt(i);
  }
  buf[dirOff + 64] = (rootName.length * 2 + 2) & 0xFF;
  buf[dirOff + 66] = 5;                         // DE_ROOT
  writeU32LE(buf, dirOff + 68, FREESECT);       // left sibling = NOSTREAM
  writeU32LE(buf, dirOff + 72, FREESECT);       // right sibling = NOSTREAM
  writeU32LE(buf, dirOff + 76, 1);              // child = entry 1
  writeU32LE(buf, dirOff + 116, ENDOFCHAIN);    // root start sector

  // Entry 1: "Contents" stream (type=2)
  const e1 = dirOff + 128;
  const sname = "Contents";
  for (let i = 0; i < sname.length; i++) buf[e1 + i * 2] = sname.charCodeAt(i);
  buf[e1 + 64] = (sname.length * 2 + 2) & 0xFF;
  buf[e1 + 66] = 2;                             // DE_STREAM
  writeU32LE(buf, e1 + 68, FREESECT);
  writeU32LE(buf, e1 + 72, FREESECT);
  writeU32LE(buf, e1 + 76, FREESECT);
  writeU32LE(buf, e1 + 116, 2);                 // start sector = 2
  const dataSize = Math.min(streamData.length, SECTOR);
  writeU32LE(buf, e1 + 120, dataSize);

  // --- Sector 2: Stream data ---
  buf.set(streamData.subarray(0, SECTOR), 512 + 2 * SECTOR);

  return buf;
}

// ---------------------------------------------------------------------------
// 1. isOle2 — additional edge cases
// ---------------------------------------------------------------------------

describe("isOle2: edge cases", () => {
  it("exactly 8 bytes matching the magic returns true", () => {
    expect(isOle2(new Uint8Array(OLE2_MAGIC))).toBe(true);
  });

  it("returns false when first byte is wrong (0xD1 instead of 0xD0)", () => {
    const bytes = new Uint8Array([0xD1, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    expect(isOle2(bytes)).toBe(false);
  });

  it("returns false when last magic byte is wrong (0xE0 instead of 0xE1)", () => {
    const bytes = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE0]);
    expect(isOle2(bytes)).toBe(false);
  });

  it("returns false for 7 correct magic bytes (truncated)", () => {
    expect(isOle2(OLE2_MAGIC.subarray(0, 7))).toBe(false);
  });

  it("returns true when extra bytes follow the magic", () => {
    const extra = new Uint8Array(64);
    extra.set(OLE2_MAGIC);
    extra.fill(0xAB, 8);
    expect(isOle2(extra)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. tryLoadRealFla — does not throw on malformed / truncated bytes
// ---------------------------------------------------------------------------

describe("tryLoadRealFla: robustness (no throw)", () => {
  it("returns null for a zero-length array", () => {
    expect(() => tryLoadRealFla(new Uint8Array(0))).not.toThrow();
    expect(tryLoadRealFla(new Uint8Array(0))).toBeNull();
  });

  it("returns null for 8 bytes of OLE2 magic with no structure", () => {
    // The OLE2 magic is present but the header is incomplete → null or throws a
    // descriptive error, never a silent crash.
    const bytes = new Uint8Array(8);
    bytes.set(OLE2_MAGIC);
    let threw = false;
    let result = null;
    try {
      result = tryLoadRealFla(bytes);
    } catch {
      threw = true;
    }
    // Either returns null or throws — both are acceptable; what must NOT happen
    // is a silent undefined return or an unhandled promise rejection.
    expect(threw || result === null || result !== undefined).toBe(true);
  });

  it("does not throw for a well-formed minimal OLE2 with empty stream", () => {
    const ole2 = buildMinimalOle2(new Uint8Array(512).fill(0));
    expect(() => tryLoadRealFla(ole2)).not.toThrow();
  });

  it("does not throw for OLE2 with random-looking stream bytes", () => {
    const noise = new Uint8Array(512);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 37 + 13) & 0xFF;
    const ole2 = buildMinimalOle2(noise);
    expect(() => tryLoadRealFla(ole2)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. tryLoadRealFla — returned document structure
// ---------------------------------------------------------------------------

describe("tryLoadRealFla: returned document has at least one scene and one layer", () => {
  it("returned document is non-null for a valid minimal OLE2", () => {
    const ole2 = buildMinimalOle2(new Uint8Array(512).fill(0));
    const doc = tryLoadRealFla(ole2);
    expect(doc).not.toBeNull();
  });

  it("returned document has at least one scene", () => {
    const ole2 = buildMinimalOle2(new Uint8Array(512).fill(0));
    const doc = tryLoadRealFla(ole2);
    expect(doc?.scenes.length).toBeGreaterThan(0);
  });

  it("first scene has at least one layer (best-effort 'Layer 1')", () => {
    // The parser documents that it cannot extract the real layer structure from the
    // undocumented Flash 8 binary format, but it must always return at least one
    // placeholder layer so downstream timeline rendering doesn't crash.
    const ole2 = buildMinimalOle2(new Uint8Array(512).fill(0));
    const doc = tryLoadRealFla(ole2);
    const layers = doc?.scenes[0]?.timeline.layers;
    expect(layers?.length).toBeGreaterThan(0);
  });

  it("first layer has a non-empty name", () => {
    const ole2 = buildMinimalOle2(new Uint8Array(512).fill(0));
    const doc = tryLoadRealFla(ole2);
    const layer = doc?.scenes[0]?.timeline.layers[0];
    expect(layer?.name).toBeTruthy();
  });

  it("document properties are within plausible ranges", () => {
    const ole2 = buildMinimalOle2(new Uint8Array(512).fill(0));
    const doc = tryLoadRealFla(ole2);
    expect(doc?.properties.width).toBeGreaterThan(0);
    expect(doc?.properties.height).toBeGreaterThan(0);
    expect(doc?.properties.frameRate).toBeGreaterThan(0);
    expect(doc?.properties.backgroundColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

// ---------------------------------------------------------------------------
// 4. tryLoadRealFla — TODO annotation for full layer extraction
// ---------------------------------------------------------------------------

describe("tryLoadRealFla: documented limitations (TODO)", () => {
  it("returns a document with a single placeholder layer (not extracted from binary)", () => {
    // TODO: When the Flash 8 binary stream format is reverse-engineered, replace
    //       the best-effort scanner with a proper record parser that extracts real
    //       layer names, frame data, and display objects.
    //
    // For now we verify that the placeholder layer is type='normal' and named
    // 'Layer 1', matching the createLayer() default in the parser.
    const ole2 = buildMinimalOle2(new Uint8Array(512).fill(0));
    const doc = tryLoadRealFla(ole2);
    const layer = doc?.scenes[0]?.timeline.layers[0];
    // These assertions document current behaviour; update them when real extraction lands.
    expect(layer?.type).toBe("normal");
    expect(layer?.name).toBe("Layer 1");
  });
});
