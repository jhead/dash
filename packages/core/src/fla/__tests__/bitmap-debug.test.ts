import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { tryLoadRealFla } from "../ole.js";

function fixture(name: string): Uint8Array {
  const path = fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
  return new Uint8Array(readFileSync(path));
}

/**
 * Task 0894 regression tests.
 *
 * Magnet.fla has bitmaps at media IDs 12–15 (Flash lossless bitmaps). Before
 * the fixes in tasks 0887 (CMediaSound detection) and 0889 (MFC CArchive class-
 * reference indexing), these media entries were either misidentified as sounds or
 * not decoded, causing:
 *
 *   [FLA import] bitmap placement references unknown media #12; skipping
 *   [FLA import] bitmap placement references unknown media #13; skipping
 *   [FLA import] bitmap placement references unknown media #14; skipping
 *   [FLA import] bitmap placement references unknown media #15; skipping
 *
 * After the fix:
 *  - No "bitmap placement references unknown media" warnings are emitted.
 *  - Bitmap library items for media IDs 12–15 are present in the document.
 *
 * Task 1412: these bitmaps now keep their AUTHORED CMediaBits display names
 * (Media 12 = "Tangerine Fusion", 13 = "Sage Foam", 14 = "Quantum Foam",
 * 15 = "Metallic Foam") instead of a generic "Bitmap N".
 */
describe("bitmap media IDs 12-15 resolved (task 0894)", () => {
  it("no 'bitmap placement references unknown media' warnings for Magnet.fla", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
      origWarn(...args);
    };

    try {
      const doc = tryLoadRealFla(fixture("Magnet.fla"));
      expect(doc).not.toBeNull();

      // No unresolved bitmap media placements.
      const bitmapWarnings = warnings.filter(w =>
        w.includes("bitmap placement references unknown media"),
      );
      expect(
        bitmapWarnings,
        "should have no unresolved bitmap media placements",
      ).toHaveLength(0);

      // Bitmap library items for media IDs 12–15 must be present, carrying
      // their authored CMediaBits display names (task 1412).
      const bitmapNames =
        doc?.library.items
          .filter((i) => (i as Record<string, unknown>).itemType === "bitmap")
          .map((i) => (i as Record<string, unknown>).name as string) ?? [];

      for (const authored of [
        "Tangerine Fusion",
        "Sage Foam",
        "Quantum Foam",
        "Metallic Foam",
      ]) {
        expect(bitmapNames, `should contain "${authored}"`).toContain(authored);
      }
    } finally {
      console.warn = origWarn;
    }
  });
});
