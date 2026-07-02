/**
 * Tests for OLE2/CFB Flash 8 .fla import (packages/core/src/fla/ole.ts)
 *
 * Since we don't have real Macromedia .fla files in the test suite, we test:
 *   1. Magic-byte detection (isOle2)
 *   2. tryLoadRealFla returning null for non-OLE2 bytes
 *   3. loadFla delegating correctly for OLE2 bytes
 *   4. Crafted minimal OLE2 containers (enough structure to not crash)
 *   5. Result document structure validity
 */

import { describe, it, expect, vi } from "vitest";
import { isOle2, tryLoadRealFla, __readAllStreamsForTest } from "../ole.js";
import { loadFla } from "../zip.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** OLE2 magic bytes */
const OLE2_MAGIC = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

/**
 * Build a minimal but structurally plausible OLE2 header (512 bytes).
 * We craft just enough for the parser to read the header without throwing.
 *
 * Layout (version 3, 512-byte sectors):
 *   offset  0: magic (8 bytes)
 *   offset  8: CLSID (16 bytes, zeroed)
 *   offset 24: minor version = 0x003E
 *   offset 26: major version = 0x0003  (version 3)
 *   offset 28: byte order = 0xFFFE (little-endian)
 *   offset 30: sector size exponent = 9  (2^9 = 512)
 *   offset 32: mini-sector size exponent = 6 (2^6 = 64)
 *   offset 44: FAT sector count = 1
 *   offset 48: first directory sector = 1
 *   offset 56: mini-stream cutoff = 4096
 *   offset 60: first mini-FAT sector = ENDOFCHAIN
 *   offset 64: mini-FAT sector count = 0
 *   offset 68: first DIFAT sector = ENDOFCHAIN
 *   offset 72: DIFAT sector count = 0
 *   offset 76: first 109 DIFAT entries — sector 0 is the FAT sector
 */
function buildMinimalOle2Header(): Uint8Array {
  const header = new Uint8Array(512).fill(0);

  // Magic
  OLE2_MAGIC.forEach((b, i) => { header[i] = b; });

  // Byte order mark (LE)
  header[28] = 0xFE; header[29] = 0xFF;

  // Sector size exponent = 9 -> 512 bytes per sector
  header[30] = 9; header[31] = 0;

  // Mini sector size exponent = 6 -> 64 bytes
  header[32] = 6; header[33] = 0;

  // FAT sector count = 1 (sector 0 is the FAT)
  header[44] = 1;

  // First directory sector = 1
  header[48] = 1;

  // Mini stream cutoff = 4096
  header[56] = 0x00; header[57] = 0x10; header[58] = 0x00; header[59] = 0x00;

  // First mini-FAT sector = ENDOFCHAIN (0xFFFFFFFE)
  header[60] = 0xFE; header[61] = 0xFF; header[62] = 0xFF; header[63] = 0xFF;

  // DIFAT[0] = sector 0 (FAT sector)
  header[76] = 0;

  // Remaining DIFAT entries = FREESECT (0xFFFFFFFF)
  for (let i = 1; i < 109; i++) {
    const off = 76 + i * 4;
    header[off] = 0xFF; header[off+1] = 0xFF; header[off+2] = 0xFF; header[off+3] = 0xFF;
  }

  return header;
}

/**
 * Build a minimal but structurally valid OLE2 binary with a single small
 * stream called "Contents" containing some pseudo-Flash data bytes.
 *
 * Sectors:
 *   Sector 0: FAT  (marks sector 0 as FATSECT, sector 1 as ENDOFCHAIN for dir,
 *                   sector 2 as ENDOFCHAIN for stream)
 *   Sector 1: Directory (one root entry + one stream entry)
 *   Sector 2: Stream data (the "Flash content")
 */
function buildMinimalOle2WithStream(streamData: Uint8Array, declaredSizeOverride?: number): Uint8Array {
  const SECTOR_SIZE = 512;
  const ENDOFCHAIN32 = 0xFFFFFFFE;
  const FREESECT32   = 0xFFFFFFFF;
  const FATSECT32    = 0xFFFFFFFD;

  // Total: 512 (header) + 3 * 512 (sectors) = 2048 bytes
  const total = 512 + 3 * SECTOR_SIZE;
  const buf = new Uint8Array(total).fill(0);

  // --- Header ---
  const header = buildMinimalOle2Header();
  buf.set(header, 0);
  // First directory sector = 1 (already set above)

  // --- Sector 0: FAT ---
  const fatOff = 512;
  function writeU32(arr: Uint8Array, off: number, val: number): void {
    arr[off]   = val & 0xFF;
    arr[off+1] = (val >>> 8) & 0xFF;
    arr[off+2] = (val >>> 16) & 0xFF;
    arr[off+3] = (val >>> 24) & 0xFF;
  }
  writeU32(buf, fatOff + 0 * 4, FATSECT32);    // sector 0 = FAT sector itself
  writeU32(buf, fatOff + 1 * 4, ENDOFCHAIN32); // sector 1 = dir (end of dir chain)
  writeU32(buf, fatOff + 2 * 4, ENDOFCHAIN32); // sector 2 = stream (end of stream chain)
  // Fill rest with FREESECT
  for (let i = 3; i < SECTOR_SIZE / 4; i++) {
    writeU32(buf, fatOff + i * 4, FREESECT32);
  }

  // --- Sector 1: Directory ---
  // Entry 0: Root entry (type=5/DE_ROOT)
  const dirOff = 512 + SECTOR_SIZE;
  // Name "Root Entry" in UTF-16LE
  const rootName = "Root Entry";
  const rootNameBytes = rootName.length * 2 + 2; // +2 for null terminator
  for (let i = 0; i < rootName.length; i++) {
    buf[dirOff + i * 2]     = rootName.charCodeAt(i);
    buf[dirOff + i * 2 + 1] = 0;
  }
  // Name length
  buf[dirOff + 64] = rootNameBytes & 0xFF;
  buf[dirOff + 65] = (rootNameBytes >> 8) & 0xFF;
  // Type = 5 (root)
  buf[dirOff + 66] = 5;
  // Left sibling = NOSTREAM
  writeU32(buf, dirOff + 68, FREESECT32);
  // Right sibling = NOSTREAM
  writeU32(buf, dirOff + 72, FREESECT32);
  // Child = entry 1
  writeU32(buf, dirOff + 76, 1);
  // Start sector = ENDOFCHAIN (root has no mini-stream here)
  writeU32(buf, dirOff + 116, ENDOFCHAIN32);

  // Entry 1: "Contents" stream (type=2/DE_STREAM)
  const entry1Off = dirOff + 128;
  const streamName = "Contents";
  for (let i = 0; i < streamName.length; i++) {
    buf[entry1Off + i * 2]     = streamName.charCodeAt(i);
    buf[entry1Off + i * 2 + 1] = 0;
  }
  const streamNameBytes = streamName.length * 2 + 2;
  buf[entry1Off + 64] = streamNameBytes & 0xFF;
  buf[entry1Off + 65] = (streamNameBytes >> 8) & 0xFF;
  buf[entry1Off + 66] = 2; // DE_STREAM
  writeU32(buf, entry1Off + 68, FREESECT32); // left sibling = NOSTREAM
  writeU32(buf, entry1Off + 72, FREESECT32); // right sibling = NOSTREAM
  writeU32(buf, entry1Off + 76, FREESECT32); // no children
  // Start sector = 2
  writeU32(buf, entry1Off + 116, 2);
  // Size (may be overridden to simulate a crafted/oversized directory entry).
  const dataSize = declaredSizeOverride ?? Math.min(streamData.length, SECTOR_SIZE);
  writeU32(buf, entry1Off + 120, dataSize);
  // Mark as "large" stream (> miniStreamCutoff)
  // miniStreamCutoff = 4096, dataSize < 4096, so mini-stream applies.
  // For simplicity just claim size > 0 and startSector = 2 (direct FAT chain).

  // --- Sector 2: Stream data ---
  const dataOff = 512 + 2 * SECTOR_SIZE;
  buf.set(streamData.subarray(0, SECTOR_SIZE), dataOff);

  return buf;
}

// ---------------------------------------------------------------------------
// 1. isOle2 detection
// ---------------------------------------------------------------------------

describe("isOle2 detection", () => {
  it("returns true for OLE2 magic bytes", () => {
    const bytes = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0x00]);
    expect(isOle2(bytes)).toBe(true);
  });

  it("returns false for ZIP magic bytes (PK header)", () => {
    const bytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    expect(isOle2(bytes)).toBe(false);
  });

  it("returns false for an empty array", () => {
    expect(isOle2(new Uint8Array(0))).toBe(false);
  });

  it("returns false for fewer than 8 bytes", () => {
    expect(isOle2(new Uint8Array([0xD0, 0xCF, 0x11, 0xE0]))).toBe(false);
  });

  it("returns false for bytes that start with OLE2 magic but differ at byte 4", () => {
    const bytes = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0x00, 0x00, 0x00, 0x00]);
    expect(isOle2(bytes)).toBe(false);
  });

  it("returns false for all-zero bytes", () => {
    expect(isOle2(new Uint8Array(16))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. tryLoadRealFla – non-OLE2 returns null
// ---------------------------------------------------------------------------

describe("tryLoadRealFla: non-OLE2 input", () => {
  it("returns null for ZIP magic bytes", () => {
    const bytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]);
    expect(tryLoadRealFla(bytes)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(tryLoadRealFla(new Uint8Array(0))).toBeNull();
  });

  it("returns null for arbitrary non-OLE2 bytes", () => {
    const bytes = new Uint8Array(64).fill(0xAB);
    expect(tryLoadRealFla(bytes)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. loadFla delegates OLE2 bytes to tryLoadRealFla
// ---------------------------------------------------------------------------

describe("loadFla: OLE2 delegation", () => {
  it("loadFla with OLE2 magic bytes does not throw 'could not unzip'", () => {
    // A minimal OLE2 file — may produce a document or throw a specific OLE2 error,
    // but must NOT throw the "could not unzip" error.
    const minimal = buildMinimalOle2WithStream(new Uint8Array(512).fill(0));
    let errorMessage = "";
    try {
      loadFla(minimal);
    } catch (err) {
      errorMessage = String(err);
    }
    expect(errorMessage).not.toMatch(/could not unzip/);
  });

  it("loadFla with non-OLE2 garbage throws 'FLA open error: could not unzip'", () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(() => loadFla(garbage)).toThrow(/could not unzip/);
  });
});

// ---------------------------------------------------------------------------
// 4. tryLoadRealFla with a crafted minimal OLE2 container
// ---------------------------------------------------------------------------

describe("tryLoadRealFla: crafted minimal OLE2", () => {
  it("returns a FlashDocument (not null) for a minimal OLE2 binary", () => {
    const streamPayload = new Uint8Array(512).fill(0);
    const ole2Bytes = buildMinimalOle2WithStream(streamPayload);
    const result = tryLoadRealFla(ole2Bytes);
    // Should return a document (possibly with defaults) rather than null
    expect(result).not.toBeNull();
  });

  it("returned document has required FlashDocument fields", () => {
    const streamPayload = new Uint8Array(512).fill(0);
    const ole2Bytes = buildMinimalOle2WithStream(streamPayload);
    const doc = tryLoadRealFla(ole2Bytes);
    expect(doc).not.toBeNull();
    if (doc) {
      expect(typeof doc.id).toBe("string");
      expect(doc.properties).toBeDefined();
      expect(typeof doc.properties.width).toBe("number");
      expect(typeof doc.properties.height).toBe("number");
      expect(typeof doc.properties.frameRate).toBe("number");
      expect(typeof doc.properties.backgroundColor).toBe("string");
      expect(Array.isArray(doc.scenes)).toBe(true);
      expect(doc.scenes.length).toBeGreaterThan(0);
    }
  });

  it("document properties have plausible values", () => {
    const streamPayload = new Uint8Array(512).fill(0);
    const ole2Bytes = buildMinimalOle2WithStream(streamPayload);
    const doc = tryLoadRealFla(ole2Bytes);
    if (doc) {
      expect(doc.properties.width).toBeGreaterThan(0);
      expect(doc.properties.height).toBeGreaterThan(0);
      expect(doc.properties.frameRate).toBeGreaterThan(0);
      expect(doc.properties.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("document has at least one scene with at least one layer", () => {
    const streamPayload = new Uint8Array(512).fill(0);
    const ole2Bytes = buildMinimalOle2WithStream(streamPayload);
    const doc = tryLoadRealFla(ole2Bytes);
    if (doc) {
      expect(doc.scenes.length).toBeGreaterThan(0);
      expect(doc.scenes[0]!.timeline.layers.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Stage dimension scanning
// ---------------------------------------------------------------------------

describe("tryLoadRealFla: stage dimension extraction", () => {
  it("extracts width=800, height=600, fps=24 from a Contents stream using the real Flash encoding", () => {
    // The genuine Contents layout stores the stage size as u16 width*20,
    // six zero bytes, u16 height*20, four zero bytes, shortly before a
    // background/frame-rate block that ends with 03 B4 00 00 00.
    const streamPayload = new Uint8Array(512).fill(0);
    let p = 0x20;
    // width*20 = 16000 = 0x3E80
    streamPayload[p++] = 0x80; streamPayload[p++] = 0x3e;
    p += 6; // six zero bytes
    // height*20 = 12000 = 0x2EE0
    streamPayload[p++] = 0xe0; streamPayload[p++] = 0x2e;
    p += 4; // four zero bytes
    // background/frame-rate block:
    //   bgR bgG bgB FF gridR gridG gridB FF 00 fpsFrac fpsInt 00 00 00 03 B4 00 00 00
    const block = [
      0x33, 0x66, 0x99, 0xff,       // background color #336699
      0xc0, 0xc0, 0xc0, 0xff,       // grid color
      0x00,
      0x00, 24,                     // frame rate 24.0
      0x00, 0x00, 0x00,
      0x03, 0xb4, 0x00, 0x00, 0x00, // anchor
    ];
    streamPayload.set(block, p);

    const ole2Bytes = buildMinimalOle2WithStream(streamPayload);
    const doc = tryLoadRealFla(ole2Bytes);
    if (doc) {
      expect(doc.properties.width).toBe(800);
      expect(doc.properties.height).toBe(600);
      expect(doc.properties.frameRate).toBe(24);
      expect(doc.properties.backgroundColor).toBe("#336699");
    }
  });

  it("falls back to defaults (550x400 @12fps) when stream is all zeros", () => {
    const streamPayload = new Uint8Array(512).fill(0);
    const ole2Bytes = buildMinimalOle2WithStream(streamPayload);
    const doc = tryLoadRealFla(ole2Bytes);
    if (doc) {
      // All-zeros stream cannot have a valid w/h pair, so defaults are used
      expect(doc.properties.width).toBe(550);
      expect(doc.properties.height).toBe(400);
      expect(doc.properties.frameRate).toBe(12);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. loadFla still works for normal zip/JSON format after the OLE2 check
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 7. Unbounded-allocation guard: a crafted directory-entry size must be
//    clamped to the bytes actually reachable through the sector chain.
// ---------------------------------------------------------------------------

describe("tryLoadRealFla: oversized directory-entry size is clamped", () => {
  it("clamps a ~1.5 GB declared stream size to the reachable sector bytes", () => {
    // The "Contents" stream lives in a single 512-byte sector but declares a
    // ~1.5 GB size. Before the clamp this forced a multi-GB zero-fill; after
    // it, the read is bounded to the one reachable sector (512 bytes).
    const HUGE = 0x60000000; // ~1.5 GB
    const ole2Bytes = buildMinimalOle2WithStream(new Uint8Array(512).fill(0x42), HUGE);
    const streams = __readAllStreamsForTest(ole2Bytes);
    const contents = streams.get("Contents");
    expect(contents).toBeDefined();
    // Clamped to the single reachable 512-byte sector, NOT the declared 1.5 GB.
    expect(contents!.length).toBe(512);
  });

  it("does not OOM or throw when opening a bomb-sized entry via tryLoadRealFla", () => {
    const HUGE = 0x60000000;
    const ole2Bytes = buildMinimalOle2WithStream(new Uint8Array(512).fill(0), HUGE);
    // Must complete quickly and return a document (falls back to skeleton).
    const doc = tryLoadRealFla(ole2Bytes);
    expect(doc).not.toBeNull();
  });
});

describe("loadFla: normal zip format still works", () => {
  it("normal zip FLA round-trips correctly after OLE2 detection was added", async () => {
    // Import saveFla dynamically to avoid circular issues in test setup
    const { saveFla } = await import("../zip.js");
    const { createDocument } = await import("../../model/document.js");
    const doc = createDocument();
    const bytes = saveFla(doc);
    const restored = loadFla(bytes);
    expect(restored.id).toBe(doc.id);
    expect(restored.properties.width).toBe(doc.properties.width);
  });
});
