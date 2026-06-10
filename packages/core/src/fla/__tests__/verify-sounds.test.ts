import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { tryLoadRealFla } from "../ole";

function fixture(name: string): Uint8Array {
  const path = fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
  return new Uint8Array(readFileSync(path));
}

describe("Magnet.fla CMediaSound scanner", () => {
  it("parseFla8Contents finds CMediaSound objects from Media N streams", () => {
    // Capture console.warn to check for "not found in library" warnings.
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
      origWarn(...args);
    };

    try {
      const doc = tryLoadRealFla(fixture("Magnet.fla"));
      expect(doc).not.toBeNull();

      // Check that no "frame sound id N not found in library" warnings were emitted.
      // With CMediaSound detection, all Magnet.fla sounds (IDs 16-21, 32 etc.) are
      // registered before frame timelines are processed.
      const soundWarnings = warnings.filter(w => w.includes("frame sound id") && w.includes("not found"));

      expect(soundWarnings).toHaveLength(0);
    } finally {
      console.warn = origWarn;
    }
  });
});
