/**
 * FLA round-trip tests for binary assets (BitmapItem, SoundItem).
 *
 * Verifies that saveFla/loadFla correctly extract dataUri payloads into
 * separate zip entries and restore them on load, producing identical data URIs.
 */

import { describe, it, expect } from "vitest";
import { saveFla, loadFla } from "../zip.js";
import { createDocument } from "../../model/document.js";
import type { BitmapItem, SoundItem } from "../../model/types.js";
import { unzipSync, strFromU8 } from "fflate";

// ---------------------------------------------------------------------------
// Test assets
// ---------------------------------------------------------------------------

// Build a tiny 1x1 PNG as base64 data URI
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==";

// A minimal "MP3" (just some bytes — the round-trip doesn't decode it)
const FAKE_MP3 =
  "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjQwLjEwMQDe";

// ---------------------------------------------------------------------------
// Helper: build a doc with a single BitmapItem
// ---------------------------------------------------------------------------
function makeDocWithBitmap(dataUri: string) {
  const base = createDocument();
  const bitmapItem: BitmapItem = {
    itemType: "bitmap",
    id: "bmp1",
    name: "photo.jpg",
    dataUri,
    originalWidth: 1,
    originalHeight: 1,
    allowSmoothing: false,
    compressionType: "lossless",
    quality: 80,
  };
  return {
    ...base,
    library: {
      ...base.library,
      items: [...base.library.items, bitmapItem],
      folders: base.library.folders,
    },
    scenes: base.scenes,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a doc with a single SoundItem
// ---------------------------------------------------------------------------
function makeDocWithSound(dataUri: string) {
  const base = createDocument();
  const soundItem: SoundItem = {
    itemType: "sound",
    id: "snd1",
    name: "track.mp3",
    dataUri,
    sampleRate: 44100,
    sampleSize: 16,
    isStereo: false,
    durationSeconds: 0.1,
    compressionType: "mp3",
  };
  return {
    ...base,
    library: {
      ...base.library,
      items: [...base.library.items, soundItem],
      folders: base.library.folders,
    },
    scenes: base.scenes,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FLA round-trip with binary assets", () => {
  // -------------------------------------------------------------------------
  // 1. saveFla with a BitmapItem produces zip bytes (not the raw data URI in JSON)
  // -------------------------------------------------------------------------
  it("saveFla with BitmapItem stores asset as separate entry, not raw dataUri in JSON", () => {
    const doc = makeDocWithBitmap(TINY_PNG);
    const bytes = saveFla(doc);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);

    // ZIP starts with PK signature
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    // Unzip and inspect document.json directly to verify the dataUri was stripped.
    // The raw data URI should NOT appear in document.json; an asset: reference should.
    const entries = unzipSync(bytes);
    expect(entries["document.json"]).toBeDefined();
    const jsonStr = strFromU8(entries["document.json"]!);
    expect(jsonStr).not.toContain(TINY_PNG);
    expect(jsonStr).toContain("asset:");

    // The binary asset entry should exist
    const assetKeys = Object.keys(entries).filter((k) => k.startsWith("assets/"));
    expect(assetKeys.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 2. loadFla round-trip restores BitmapItem dataUri to the original TINY_PNG value
  // -------------------------------------------------------------------------
  it("loadFla round-trip restores BitmapItem dataUri to original value", () => {
    const doc = makeDocWithBitmap(TINY_PNG);
    const restored = loadFla(saveFla(doc));

    const restoredItem = restored.library.items.find((i) => i.id === "bmp1");
    expect(restoredItem).toBeDefined();
    expect(restoredItem?.dataUri).toMatch(/^data:image\/png;base64,/);
    // The base64 payload should match the original
    const origBase64 = TINY_PNG.split(",")[1];
    const restoredBase64 = restoredItem?.dataUri?.split(",")[1];
    expect(restoredBase64).toBe(origBase64);
  });

  // -------------------------------------------------------------------------
  // 3. saveFla with a SoundItem round-trips correctly
  // -------------------------------------------------------------------------
  it("loadFla round-trip restores SoundItem dataUri to original value", () => {
    const doc = makeDocWithSound(FAKE_MP3);
    const restored = loadFla(saveFla(doc));

    const restoredItem = restored.library.items.find((i) => i.id === "snd1");
    expect(restoredItem).toBeDefined();
    expect(restoredItem?.dataUri).toMatch(/^data:audio\/mpeg;base64,/);
    // The base64 payload should match the original
    const origBase64 = FAKE_MP3.split(",")[1];
    const restoredBase64 = restoredItem?.dataUri?.split(",")[1];
    expect(restoredBase64).toBe(origBase64);
  });

  // -------------------------------------------------------------------------
  // 4. A doc with no assets round-trips without error
  // -------------------------------------------------------------------------
  it("doc with no assets round-trips without error", () => {
    const doc = createDocument();
    expect(() => loadFla(saveFla(doc))).not.toThrow();
    const restored = loadFla(saveFla(doc));
    expect(restored.library.items).toHaveLength(doc.library.items.length);
  });

  // -------------------------------------------------------------------------
  // 5. The returned doc has the same scene count and layer count as the original
  // -------------------------------------------------------------------------
  it("round-tripped doc has same scene count and layer count as original", () => {
    const doc = makeDocWithBitmap(TINY_PNG);
    const restored = loadFla(saveFla(doc));

    expect(restored.scenes).toHaveLength(doc.scenes.length);
    for (let i = 0; i < doc.scenes.length; i++) {
      const origScene = doc.scenes[i];
      const restoredScene = restored.scenes[i];
      expect(restoredScene?.timeline.layers).toHaveLength(
        origScene?.timeline.layers.length ?? 0
      );
    }
  });
});
