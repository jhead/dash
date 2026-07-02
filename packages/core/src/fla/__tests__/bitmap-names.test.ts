/**
 * Task 1412 — FLA import: bitmap library display names decoded from CMediaBits.
 *
 * Before this fix `parseFla8Contents` scanned the CMedia* catalog for sounds
 * only (the CMediaBits backref was computed just to be EXCLUDED), so
 * `buildFla8Document` renamed every imported bitmap to a generic "Bitmap N".
 * The genuine CMediaBits record carries the authored library display name as a
 * BomString right after the "Media N" stream name (same body shape as
 * CMediaSound — see docs/21 §8.10 and `write/contents-write.ts`).
 *
 * (a) round-trip: a bitmap library name survives saveRealFla -> tryLoadRealFla.
 * (b) fixture:    importing evaporatingdrip.fla yields the authored display name
 *                 for its CMediaBits "Media 4" ("metal") instead of "Bitmap 4".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { tryLoadRealFla } from "../ole.js";
import { saveRealFla } from "../write/fla-write.js";
import { createDocument } from "../../model/document.js";
import type { BitmapItem, FlashDocument } from "../../model/types.js";

function fixture(name: string): Uint8Array {
  const path = fileURLToPath(new URL(`../../../../../fixtures/${name}`, import.meta.url));
  return new Uint8Array(readFileSync(path));
}

// A tiny 1x1 PNG, decodable by decodeMediaBitmap on re-import so the importer
// actually reconstructs the bitmap library item (and thus reads its name).
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==";

function docWithNamedBitmap(name: string): FlashDocument {
  const base = createDocument();
  const bitmapItem: BitmapItem = {
    itemType: "bitmap",
    id: "bmpHero",
    name,
    dataUri: TINY_PNG,
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
    },
  };
}

describe("FLA bitmap library display names (task 1412)", () => {
  it("(a) a bitmap library name survives saveRealFla -> tryLoadRealFla", () => {
    const out = tryLoadRealFla(saveRealFla(docWithNamedBitmap("Hero")));
    expect(out).not.toBeNull();
    const bitmaps = (out!.library.items.filter(
      (i) => i.itemType === "bitmap",
    ) as BitmapItem[]);
    expect(bitmaps.map((b) => b.name)).toContain("Hero");
    // Regression guard: it must NOT come back renamed to a generic "Bitmap N".
    expect(bitmaps.map((b) => b.name)).not.toContain("Bitmap 1");
  });

  it("(b) evaporatingdrip.fla imports its CMediaBits 'Media 4' as 'metal'", () => {
    const doc = tryLoadRealFla(fixture("evaporatingdrip.fla"));
    expect(doc).not.toBeNull();
    const bitmapNames = doc!.library.items
      .filter((i) => i.itemType === "bitmap")
      .map((i) => (i as BitmapItem).name);
    expect(bitmapNames, `library bitmap names: ${bitmapNames.join(", ")}`).toContain(
      "metal",
    );
    expect(bitmapNames).not.toContain("Bitmap 4");
  });
});
