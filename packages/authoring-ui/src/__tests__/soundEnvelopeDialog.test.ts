/**
 * Unit tests for SoundEnvelopeEditDialog helpers:
 *   - defaultEnvelope
 *   - envelopeToPoints
 */

import { describe, it, expect } from "vitest";
import {
  defaultEnvelope,
  envelopeToPoints,
} from "../SoundEnvelopeEditDialog.js";

describe("defaultEnvelope", () => {
  it("returns inPoint=0 and outPoint=totalSamples", () => {
    const e = defaultEnvelope(44100);
    expect(e.inPoint).toBe(0);
    expect(e.outPoint).toBe(44100);
  });

  it("returns two nodes at t=0 and t=1 with amplitude 1 for both channels", () => {
    const e = defaultEnvelope(44100);
    expect(e.leftNodes).toEqual([[0, 1], [1, 1]]);
    expect(e.rightNodes).toEqual([[0, 1], [1, 1]]);
  });

  it("handles edge case of totalSamples=0 without throwing", () => {
    expect(() => defaultEnvelope(0)).not.toThrow();
  });
});

describe("envelopeToPoints", () => {
  it("full volume flat envelope produces two points with level 32768", () => {
    const state = defaultEnvelope(44100);
    const points = envelopeToPoints(state, 44100);
    expect(points.length).toBe(2);
    expect(points[0]).toEqual({ pos44: 0, leftLevel: 32768, rightLevel: 32768 });
    expect(points[1]).toEqual({ pos44: 44100, leftLevel: 32768, rightLevel: 32768 });
  });

  it("fade-in left channel: leftLevel increases from 0 to 32768", () => {
    const state = {
      inPoint: 0,
      outPoint: 44100,
      leftNodes: [[0, 0], [1, 1]] as [number, number][],
      rightNodes: [[0, 1], [1, 1]] as [number, number][],
    };
    const points = envelopeToPoints(state, 44100);
    expect(points.length).toBe(2);
    expect(points[0].leftLevel).toBe(0);
    expect(points[1].leftLevel).toBe(32768);
    expect(points[0].rightLevel).toBe(32768);
    expect(points[1].rightLevel).toBe(32768);
  });

  it("merges left and right node times into a common set of positions", () => {
    // Left: 0, 0.5, 1   Right: 0, 1
    // Expected: 3 unique positions
    const state = {
      inPoint: 0,
      outPoint: 44100,
      leftNodes: [[0, 1], [0.5, 0.5], [1, 0]] as [number, number][],
      rightNodes: [[0, 1], [1, 1]] as [number, number][],
    };
    const points = envelopeToPoints(state, 44100);
    expect(points.length).toBe(3);
    // At t=0.5 the right level should be interpolated: 1 → 1 (flat) = 32768
    const mid = points.find((p) => p.pos44 === Math.round(0.5 * 44100))!;
    expect(mid).toBeDefined();
    expect(mid.rightLevel).toBe(32768);
    // Left at t=0.5 = 0.5 amplitude = 16384
    expect(mid.leftLevel).toBe(16384);
  });

  it("points are sorted by pos44 ascending", () => {
    const state = defaultEnvelope(44100);
    const points = envelopeToPoints(state, 44100);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].pos44).toBeGreaterThanOrEqual(points[i - 1].pos44);
    }
  });

  it("pos44 values are clamped to totalSamples range", () => {
    const state = defaultEnvelope(22050);
    const points = envelopeToPoints(state, 22050);
    for (const p of points) {
      expect(p.pos44).toBeGreaterThanOrEqual(0);
      expect(p.pos44).toBeLessThanOrEqual(22050);
    }
  });
});
