import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parseFla8Contents } from "../flash8-binary";
import { tryLoadRealFla } from "../ole";

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
      const flaBytes = new Uint8Array(readFileSync("/Users/jhead/dev/flash/fixtures/Magnet.fla").buffer);
      const doc = tryLoadRealFla(flaBytes);
      expect(doc).not.toBeNull();

      // Check that no "frame sound id N not found in library" warnings were emitted
      const soundWarnings = warnings.filter(w => w.includes("frame sound id") && w.includes("not found"));
      console.log("Sound warnings:", soundWarnings);

      expect(soundWarnings).toHaveLength(0);
    } finally {
      console.warn = origWarn;
    }
  });
});
