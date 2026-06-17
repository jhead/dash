/**
 * CFB writer regression tests for the DIFAT-sector path.
 *
 * Root cause of the "unexpected root marker 0x0" bug: when a written FLA needs
 * more than 109 FAT sectors (body > ~7.6 MB — easily reached by a document with
 * embedded media), the FAT-sector pointers overflow the 109 header DIFAT slots.
 * The original writer dropped the overflow, leaving those FAT sectors (and the
 * stream data they index) unreachable, so the importer read zeros and reported
 * "unexpected root marker 0x0". The fix writes a chain of DIFAT sectors for the
 * overflow. These tests pin both the small-file (header-only DIFAT) and the
 * large-file (DIFAT-sector) paths to byte-identical readback.
 */

import { describe, it, expect } from "vitest";
import { writeCfb } from "../write/cfb-write.js";
import { __readAllStreamsForTest } from "../ole.js";

function makeStream(size: number, seed: number): Uint8Array {
  const a = new Uint8Array(size);
  for (let i = 0; i < size; i++) a[i] = (i * 31 + seed * 7 + 1) & 0xff;
  if (size > 0) a[0] = 0x01; // mimic the timeline-stream root marker
  return a;
}

function assertRoundTrip(streams: Map<string, Uint8Array>): void {
  const bytes = writeCfb(streams);
  const got = __readAllStreamsForTest(bytes);
  for (const [name, exp] of streams) {
    const g = got.get(name);
    expect(g, `stream "${name}" missing`).toBeDefined();
    expect(g!.length, `stream "${name}" length`).toBe(exp.length);
    expect(g![0], `stream "${name}" first byte`).toBe(exp[0]);
    expect(Array.from(g!)).toEqual(Array.from(exp));
  }
}

describe("writeCfb DIFAT-sector handling", () => {
  it("round-trips a >109-FAT-sector (≈9 MB) file byte-identically", () => {
    const streams = new Map<string, Uint8Array>();
    for (let i = 0; i < 6; i++) streams.set(`Page ${i + 1}`, makeStream(1_500_000 + i * 100_000, i));
    // Sanity: this is large enough to require DIFAT sectors.
    const total = [...streams.values()].reduce((n, s) => n + s.length, 0);
    expect(total).toBeGreaterThan(7_700_000);
    assertRoundTrip(streams);
  });

  it("still round-trips small mixed-size files (header-only DIFAT)", () => {
    const streams = new Map<string, Uint8Array>();
    const sizes = [1, 63, 64, 65, 511, 512, 513, 4095, 4096, 4097, 8192];
    sizes.forEach((s, i) => streams.set(`Page ${i + 1}`, makeStream(s, i)));
    assertRoundTrip(streams);
  });

  it("round-trips many small streams (multi-sector mini-FAT)", () => {
    const streams = new Map<string, Uint8Array>();
    for (let i = 0; i < 200; i++) streams.set(`Page ${i + 1}`, makeStream(30 + ((i * 37) % 4000), i));
    assertRoundTrip(streams);
  });
});
