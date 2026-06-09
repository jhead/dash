import { describe, it, expect } from "vitest";
import { validateDocumentProperties } from "../validate.js";
import { createDocumentProperties } from "../../model/document.js";

// Helpers
function valid(overrides?: Parameters<typeof createDocumentProperties>[0]) {
  return validateDocumentProperties(createDocumentProperties(overrides));
}

describe("validateDocumentProperties()", () => {
  it("default doc properties (550x400, 12fps, #ffffff) are valid", () => {
    expect(valid().valid).toBe(true);
  });

  it("width=1 is valid", () => {
    expect(valid({ width: 1 }).valid).toBe(true);
  });

  it("width=2880 is valid", () => {
    expect(valid({ width: 2880 }).valid).toBe(true);
  });

  it("width=0 is invalid", () => {
    expect(valid({ width: 0 }).valid).toBe(false);
  });

  it("width=2881 is invalid", () => {
    expect(valid({ width: 2881 }).valid).toBe(false);
  });

  it("height=1 is valid", () => {
    expect(valid({ height: 1 }).valid).toBe(true);
  });

  it("height=2880 is valid", () => {
    expect(valid({ height: 2880 }).valid).toBe(true);
  });

  it("height=0 is invalid", () => {
    expect(valid({ height: 0 }).valid).toBe(false);
  });

  it("frameRate=0.01 is valid", () => {
    expect(valid({ frameRate: 0.01 }).valid).toBe(true);
  });

  it("frameRate=120 is valid", () => {
    expect(valid({ frameRate: 120 }).valid).toBe(true);
  });

  it("frameRate=0 is invalid", () => {
    expect(valid({ frameRate: 0 }).valid).toBe(false);
  });

  it("frameRate=121 is invalid", () => {
    expect(valid({ frameRate: 121 }).valid).toBe(false);
  });

  it('backgroundColor="#000000" is valid', () => {
    expect(valid({ backgroundColor: "#000000" }).valid).toBe(true);
  });

  it('backgroundColor="#ffffff" is valid', () => {
    expect(valid({ backgroundColor: "#ffffff" }).valid).toBe(true);
  });

  it('backgroundColor="red" is invalid', () => {
    expect(valid({ backgroundColor: "red" }).valid).toBe(false);
  });

  it('backgroundColor="#gg0000" is invalid', () => {
    expect(valid({ backgroundColor: "#gg0000" }).valid).toBe(false);
  });

  it("valid doc returns errors=[] (empty array)", () => {
    const result = valid();
    expect(result.errors).toEqual([]);
  });

  it("invalid width returns specific error message mentioning width", () => {
    const result = valid({ width: 0 });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/width/);
  });
});
