import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parseFla8Contents } from "../flash8-binary";

// Access internal OLE2 parsing via flash8-import which uses ole.ts
// We need the raw Contents stream bytes. Use a debug path through the OLE2 reader.
// Read flash8-import.ts which imports { tryLoadRealFla } from "./ole"

describe("Magnet.fla Contents stream debug", () => {
  it("extracts Contents stream and parses sounds", async () => {
    // Use vitest's ability to import arbitrary modules
    // Access the internal readEntry function indirectly via the module
    const oleModule = await import("../ole");
    
    // tryLoadRealFla is the main entry point - we can't call parseFla8Contents directly
    // without the Contents stream bytes. Let's extract what we can.
    
    // Use a monkey-patch approach: temporarily wrap parseFla8Contents to capture its input
    const binary = await import("../flash8-binary");
    const origParse = binary.parseFla8Contents;
    let capturedBytes: Uint8Array | null = null;
    let capturedContents: ReturnType<typeof binary.parseFla8Contents> | null = null;
    
    // Can't monkey-patch exported functions easily in ESM
    // Instead, let's just use tryLoadRealFla and check the library
    const flaBytes = new Uint8Array(readFileSync("/Users/jhead/dev/flash/fixtures/Magnet.fla").buffer);
    
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
      origWarn(...args);
    };
    
    try {
      const doc = oleModule.tryLoadRealFla(flaBytes);
      const soundWarnings = warnings.filter(w => w.includes("frame sound id") && w.includes("not found"));
      
      console.log("All warnings:", warnings.slice(0, 20));
      console.log("Sound lib items:", doc?.library.items.filter(i => i.type === "sound").map(i => i.name));
      console.log("Sound warnings:", soundWarnings);
    } finally {
      console.warn = origWarn;
    }
  });
});
