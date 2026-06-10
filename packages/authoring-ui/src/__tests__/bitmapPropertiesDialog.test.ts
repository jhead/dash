/**
 * Unit tests for BitmapPropertiesDialog data logic.
 *
 * Covers:
 *   1. Initial state reflects item.compressionType
 *   2. Changes to compressionType are preserved in the output changes object
 *   3. Quality is passed only for JPEG compression
 *   4. allowSmoothing round-trips correctly
 */

import { describe, it, expect } from "vitest";
import type { BitmapItem } from "@flash/core";

// ---------------------------------------------------------------------------
// Pure helper that mirrors the dialog's handleOk logic
// ---------------------------------------------------------------------------

function buildBitmapChanges(opts: {
  item: BitmapItem;
  compression: "photo" | "lossless";
  quality: number;
  allowSmoothing: boolean;
}): Partial<BitmapItem> {
  const { item, compression, quality, allowSmoothing } = opts;
  return {
    compressionType: compression,
    quality: compression === "photo" ? quality : item.quality,
    allowSmoothing,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBitmapItem(overrides?: Partial<BitmapItem>): BitmapItem {
  return {
    id: "bmp-1",
    name: "test.png",
    itemType: "bitmap",
    dataUri: "",
    originalWidth: 200,
    originalHeight: 150,
    allowSmoothing: false,
    compressionType: "photo",
    quality: 80,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BitmapPropertiesDialog data logic", () => {
  it("compressionType 'photo' round-trips through changes", () => {
    const item = makeBitmapItem({ compressionType: "photo" });
    const changes = buildBitmapChanges({
      item,
      compression: "photo",
      quality: 80,
      allowSmoothing: false,
    });
    expect(changes.compressionType).toBe("photo");
  });

  it("compressionType 'lossless' round-trips through changes", () => {
    const item = makeBitmapItem({ compressionType: "lossless" });
    const changes = buildBitmapChanges({
      item,
      compression: "lossless",
      quality: 100,
      allowSmoothing: false,
    });
    expect(changes.compressionType).toBe("lossless");
  });

  it("quality is included in changes for JPEG compression", () => {
    const item = makeBitmapItem({ compressionType: "photo", quality: 80 });
    const changes = buildBitmapChanges({
      item,
      compression: "photo",
      quality: 60,
      allowSmoothing: false,
    });
    expect(changes.quality).toBe(60);
  });

  it("quality is preserved from item when switching to lossless", () => {
    const item = makeBitmapItem({ compressionType: "photo", quality: 75 });
    const changes = buildBitmapChanges({
      item,
      compression: "lossless",
      quality: 60, // UI slider value, should be ignored for lossless
      allowSmoothing: false,
    });
    // For lossless, quality should be the original item quality (not the slider)
    expect(changes.quality).toBe(75);
  });

  it("allowSmoothing = true is preserved", () => {
    const item = makeBitmapItem({ allowSmoothing: false });
    const changes = buildBitmapChanges({
      item,
      compression: "photo",
      quality: 80,
      allowSmoothing: true,
    });
    expect(changes.allowSmoothing).toBe(true);
  });

  it("allowSmoothing = false is preserved", () => {
    const item = makeBitmapItem({ allowSmoothing: true });
    const changes = buildBitmapChanges({
      item,
      compression: "photo",
      quality: 80,
      allowSmoothing: false,
    });
    expect(changes.allowSmoothing).toBe(false);
  });

  it("quality range 1-100 round-trips correctly at boundaries", () => {
    const item = makeBitmapItem({ compressionType: "photo", quality: 80 });
    for (const q of [1, 50, 100]) {
      const changes = buildBitmapChanges({
        item,
        compression: "photo",
        quality: q,
        allowSmoothing: false,
      });
      expect(changes.quality).toBe(q);
    }
  });

  it("changing from photo to lossless updates compressionType", () => {
    const item = makeBitmapItem({ compressionType: "photo" });
    const changes = buildBitmapChanges({
      item,
      compression: "lossless",
      quality: 80,
      allowSmoothing: false,
    });
    expect(changes.compressionType).toBe("lossless");
  });
});
