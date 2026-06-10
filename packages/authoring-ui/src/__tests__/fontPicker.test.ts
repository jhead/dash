import { describe, it, expect } from "vitest";
import { DEFAULT_FONTS } from "../PropertiesPanel.js";

describe("DEFAULT_FONTS", () => {
  it("contains common Flash 8 / web-safe fonts", () => {
    expect(DEFAULT_FONTS).toContain("Arial");
    expect(DEFAULT_FONTS).toContain("Times New Roman");
    expect(DEFAULT_FONTS).toContain("Courier New");
    expect(DEFAULT_FONTS).toContain("_sans");
    expect(DEFAULT_FONTS).toContain("_serif");
    expect(DEFAULT_FONTS).toContain("_typewriter");
  });

  it("has at least 9 entries", () => {
    expect(DEFAULT_FONTS.length).toBeGreaterThanOrEqual(9);
  });

  it("includes Flash built-in device font aliases", () => {
    expect(DEFAULT_FONTS).toContain("_sans");
    expect(DEFAULT_FONTS).toContain("_serif");
    expect(DEFAULT_FONTS).toContain("_typewriter");
  });

  it("all entries are non-empty strings", () => {
    for (const f of DEFAULT_FONTS) {
      expect(typeof f).toBe("string");
      expect(f.length).toBeGreaterThan(0);
    }
  });
});
