import { describe, it, expect } from "vitest";
import {
  setDocumentWidth,
  setDocumentHeight,
  setFrameRate,
  setBackgroundColor,
  setRulerUnits,
} from "../document-mutations.js";
import { createDocument } from "../document.js";
import type { FlashDocument } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(): FlashDocument {
  return createDocument();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setDocumentWidth", () => {
  it("returns doc with new width", () => {
    const doc = makeDoc();
    const result = setDocumentWidth(doc, 800);
    expect(result.properties.width).toBe(800);
  });

  it("does not mutate original", () => {
    const doc = makeDoc();
    const original = doc.properties.width;
    setDocumentWidth(doc, 800);
    expect(doc.properties.width).toBe(original);
  });

  it("preserves other properties", () => {
    const doc = makeDoc();
    const result = setDocumentWidth(doc, 800);
    expect(result.properties.height).toBe(doc.properties.height);
    expect(result.properties.frameRate).toBe(doc.properties.frameRate);
    expect(result.properties.backgroundColor).toBe(doc.properties.backgroundColor);
    expect(result.properties.rulerUnits).toBe(doc.properties.rulerUnits);
  });
});

describe("setDocumentHeight", () => {
  it("returns doc with new height", () => {
    const doc = makeDoc();
    const result = setDocumentHeight(doc, 600);
    expect(result.properties.height).toBe(600);
  });

  it("does not mutate original", () => {
    const doc = makeDoc();
    const original = doc.properties.height;
    setDocumentHeight(doc, 600);
    expect(doc.properties.height).toBe(original);
  });

  it("preserves other properties", () => {
    const doc = makeDoc();
    const result = setDocumentHeight(doc, 600);
    expect(result.properties.width).toBe(doc.properties.width);
    expect(result.properties.frameRate).toBe(doc.properties.frameRate);
  });
});

describe("setFrameRate", () => {
  it("returns doc with new frameRate", () => {
    const doc = makeDoc();
    const result = setFrameRate(doc, 24);
    expect(result.properties.frameRate).toBe(24);
  });

  it("does not mutate original", () => {
    const doc = makeDoc();
    const original = doc.properties.frameRate;
    setFrameRate(doc, 24);
    expect(doc.properties.frameRate).toBe(original);
  });

  it("preserves other properties", () => {
    const doc = makeDoc();
    const result = setFrameRate(doc, 24);
    expect(result.properties.width).toBe(doc.properties.width);
    expect(result.properties.height).toBe(doc.properties.height);
  });
});

describe("setBackgroundColor", () => {
  it("returns doc with new backgroundColor", () => {
    const doc = makeDoc();
    const result = setBackgroundColor(doc, "#000000");
    expect(result.properties.backgroundColor).toBe("#000000");
  });

  it("does not mutate original", () => {
    const doc = makeDoc();
    const original = doc.properties.backgroundColor;
    setBackgroundColor(doc, "#000000");
    expect(doc.properties.backgroundColor).toBe(original);
  });

  it("preserves other properties", () => {
    const doc = makeDoc();
    const result = setBackgroundColor(doc, "#000000");
    expect(result.properties.width).toBe(doc.properties.width);
    expect(result.properties.height).toBe(doc.properties.height);
    expect(result.properties.frameRate).toBe(doc.properties.frameRate);
  });
});

describe("setRulerUnits", () => {
  it("returns doc with new rulerUnits", () => {
    const doc = makeDoc();
    const result = setRulerUnits(doc, "cm");
    expect(result.properties.rulerUnits).toBe("cm");
  });

  it("does not mutate original", () => {
    const doc = makeDoc();
    const original = doc.properties.rulerUnits;
    setRulerUnits(doc, "cm");
    expect(doc.properties.rulerUnits).toBe(original);
  });

  it("preserves other properties", () => {
    const doc = makeDoc();
    const result = setRulerUnits(doc, "inches");
    expect(result.properties.width).toBe(doc.properties.width);
    expect(result.properties.height).toBe(doc.properties.height);
    expect(result.properties.frameRate).toBe(doc.properties.frameRate);
    expect(result.properties.backgroundColor).toBe(doc.properties.backgroundColor);
  });
});

describe("property setters chaining", () => {
  it("chaining setDocumentWidth → setDocumentHeight → setFrameRate all work", () => {
    const doc = makeDoc();
    const result = setFrameRate(setDocumentHeight(setDocumentWidth(doc, 1920), 1080), 30);
    expect(result.properties.width).toBe(1920);
    expect(result.properties.height).toBe(1080);
    expect(result.properties.frameRate).toBe(30);
  });

  it("chaining preserves unmodified properties", () => {
    const doc = makeDoc();
    const result = setDocumentWidth(setDocumentHeight(doc, 600), 800);
    expect(result.properties.backgroundColor).toBe(doc.properties.backgroundColor);
    expect(result.properties.rulerUnits).toBe(doc.properties.rulerUnits);
    expect(result.properties.frameRate).toBe(doc.properties.frameRate);
  });
});
