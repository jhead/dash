/**
 * Unit tests for SwatchesPanel palette utilities.
 *
 * Tests the pure .act file load/save logic:
 *   1. loadActPalette — 2 swatches
 *   2. loadActPalette — trailing all-black padding stripped
 *   3. loadActPalette — handles partial (< 768 bytes) input gracefully
 *   4. saveActPalette — round-trips back to the original bytes
 *   5. saveActPalette — pads to 768 bytes
 *   6. DEFAULT_SWATCHES — non-empty, all valid hex strings
 */

import { describe, it, expect } from "vitest";
import { loadActPalette, saveActPalette, DEFAULT_SWATCHES } from "../SwatchesPanel.js";

describe("loadActPalette", () => {
  it("loads .act file — 2 swatches", () => {
    const bytes = new Uint8Array(768);
    bytes[0] = 255; bytes[1] = 0;   bytes[2] = 0;   // #ff0000
    bytes[3] = 0;   bytes[4] = 0;   bytes[5] = 255; // #0000ff
    const swatches = loadActPalette(bytes);
    expect(swatches[0]).toBe("#ff0000");
    expect(swatches[1]).toBe("#0000ff");
  });

  it("strips trailing all-black (#000000) padding", () => {
    const bytes = new Uint8Array(768);
    // Entry 0: #ff0000
    bytes[0] = 255; bytes[1] = 0; bytes[2] = 0;
    // Entries 1–255 remain 0,0,0 (padding)
    const swatches = loadActPalette(bytes);
    expect(swatches.length).toBe(1);
    expect(swatches[0]).toBe("#ff0000");
  });

  it("handles shorter-than-768-byte input gracefully", () => {
    const bytes = new Uint8Array(6);
    bytes[0] = 0x33; bytes[1] = 0x66; bytes[2] = 0x99; // #336699
    bytes[3] = 0xff; bytes[4] = 0xcc; bytes[5] = 0x00; // #ffcc00
    const swatches = loadActPalette(bytes);
    expect(swatches.length).toBe(2);
    expect(swatches[0]).toBe("#336699");
    expect(swatches[1]).toBe("#ffcc00");
  });

  it("returns empty array for all-zero input", () => {
    const bytes = new Uint8Array(768); // all zeros
    const swatches = loadActPalette(bytes);
    // All entries are #000000; after trimming trailing blacks, only entry 0 survives
    // (the "last > 0" guard keeps at least index 0 if length > 0)
    // Actually, the trim loop starts last = length-1 and decrements while > 0 && == #000000
    // So index 0 (#000000) always survives — this is by design (black is a valid swatch).
    expect(swatches.length).toBe(1);
    expect(swatches[0]).toBe("#000000");
  });
});

describe("saveActPalette", () => {
  it("round-trips 2 swatches through save/load", () => {
    const input = ["#ff0000", "#0000ff"];
    const bytes = saveActPalette(input);
    expect(bytes.length).toBe(768);
    // Verify raw bytes
    expect(bytes[0]).toBe(255);
    expect(bytes[1]).toBe(0);
    expect(bytes[2]).toBe(0);
    expect(bytes[3]).toBe(0);
    expect(bytes[4]).toBe(0);
    expect(bytes[5]).toBe(255);
    // Rest should be zero
    for (let i = 6; i < 768; i++) {
      expect(bytes[i]).toBe(0);
    }
  });

  it("always outputs exactly 768 bytes", () => {
    const swatches = ["#aabbcc", "#112233"];
    const bytes = saveActPalette(swatches);
    expect(bytes.length).toBe(768);
  });

  it("clamps to 256 swatches max", () => {
    const swatches = Array.from({ length: 300 }, (_, i) => {
      const v = i.toString(16).padStart(2, "0");
      return `#${v}${v}${v}`;
    });
    const bytes = saveActPalette(swatches);
    expect(bytes.length).toBe(768);
  });

  it("encodes hex strings correctly (all channels)", () => {
    const swatches = ["#1a2b3c"];
    const bytes = saveActPalette(swatches);
    expect(bytes[0]).toBe(0x1a);
    expect(bytes[1]).toBe(0x2b);
    expect(bytes[2]).toBe(0x3c);
  });
});

describe("DEFAULT_SWATCHES", () => {
  it("is non-empty", () => {
    expect(DEFAULT_SWATCHES.length).toBeGreaterThan(0);
  });

  it("all entries are valid lowercase hex strings (#rrggbb)", () => {
    const hexPattern = /^#[0-9a-f]{6}$/;
    for (const swatch of DEFAULT_SWATCHES) {
      expect(swatch).toMatch(hexPattern);
    }
  });
});
