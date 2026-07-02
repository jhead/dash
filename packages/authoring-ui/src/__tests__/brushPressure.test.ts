/**
 * Unit tests for the brush nib-width variation from tablet pressure/tilt
 * (task 1421) — the pure `brushHalfAt` helper exported by StageArea.
 */

import { describe, it, expect } from "vitest";
import { brushHalfAt } from "../StageArea.js";

const BASE = 10; // base half-width (brushSize 20 / 2)

describe("brushHalfAt — pressure", () => {
  it("is constant when pressure is disabled", () => {
    expect(brushHalfAt({ pressure: 0.2 }, BASE, false, false)).toBe(BASE);
    expect(brushHalfAt({ pressure: 1.0 }, BASE, false, false)).toBe(BASE);
  });

  it("scales the nib down for a lighter press when enabled", () => {
    const full = brushHalfAt({ pressure: 1.0 }, BASE, true, false);
    const light = brushHalfAt({ pressure: 0.4 }, BASE, true, false);
    expect(full).toBeGreaterThan(light);
    expect(full).toBe(BASE); // full pressure = full width
  });

  it("floors the nib so a stroke is never invisible", () => {
    const zero = brushHalfAt({ pressure: 0 }, BASE, true, false);
    expect(zero).toBeGreaterThan(0);
    expect(zero).toBeCloseTo(BASE * 0.15, 5);
  });

  it("defaults missing pressure to full width", () => {
    expect(brushHalfAt({}, BASE, true, false)).toBe(BASE);
  });
});

describe("brushHalfAt — tilt", () => {
  it("is ignored when tilt is disabled", () => {
    expect(brushHalfAt({ tilt: 1 }, BASE, false, false)).toBe(BASE);
  });

  it("widens the nib with tilt when enabled", () => {
    const flat = brushHalfAt({ tilt: 0 }, BASE, false, true);
    const tilted = brushHalfAt({ tilt: 1 }, BASE, false, true);
    expect(tilted).toBeGreaterThan(flat);
    expect(flat).toBe(BASE);
  });
});
