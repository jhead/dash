import { describe, it, expect } from "vitest";
import { decodeStrokeStyle, encodeStrokeStyle } from "../stroke-style.js";
import type { StrokeStyle } from "../../engine/types.js";

/**
 * Unit coverage for the non-solid stroke-style codec (docs/21 §12.2
 * styleParam1/styleParam2). The selector-bit assertions are pinned against
 * JPEXS flacomdoc's byte-verified writer (TimelineConverter.java):
 *   dotted=0x02, ragged=0x03, stipple=0x04, hatched=0x05; dashed uses styleParam1.
 */
describe("stroke-style codec — selector bits (flacomdoc encoding)", () => {
  it("solid / undefined encodes to {0, 0} and decodes to undefined", () => {
    expect(encodeStrokeStyle(undefined)).toEqual({ param1: 0, param2: 0 });
    expect(encodeStrokeStyle({ type: "solid" })).toEqual({ param1: 0, param2: 0 });
    expect(decodeStrokeStyle(0, 0)).toBeUndefined();
  });

  it("dashed uses styleParam1 (dash len) + styleParam2 (gap len) in twips", () => {
    const { param1, param2 } = encodeStrokeStyle({ type: "dashed", dashLength: 8, gapLength: 4 });
    expect(param1).toBe(160); // 8 px * 20
    expect(param2).toBe(80); // 4 px * 20
    // styleParam1 != 0 is the dashed marker.
    expect(param1).not.toBe(0);
  });

  it("dotted selector is 0x02 in the low bits of styleParam2", () => {
    const { param1, param2 } = encodeStrokeStyle({ type: "dotted", dotSpacing: 3 });
    expect(param1).toBe(0);
    expect(param2 & 0x07).toBe(0x02);
    // flacomdoc: 0x10 * round(dotSpace*10) + 0x02 → 0x10*30 + 2 = 482
    expect(param2).toBe(0x10 * 30 + 0x02);
  });

  it("ragged selector is 0x03", () => {
    const { param2 } = encodeStrokeStyle({
      type: "ragged",
      pattern: "solid",
      waveHeight: "flat",
      roughness: "coarse",
    });
    expect(param2 & 0x07).toBe(0x03);
  });

  it("stipple selector is 0x04", () => {
    const { param2 } = encodeStrokeStyle({
      type: "stippled",
      dotSize: "tiny",
      dotVariation: "oneSize",
      density: "veryDense",
    });
    expect(param2 & 0x07).toBe(0x04);
  });

  it("hatched selector is 0x05", () => {
    const { param2 } = encodeStrokeStyle({
      type: "hatched",
      hatchThickness: "thin",
      space: "veryClose",
      jiggle: "none",
      rotate: "none",
      curve: "straight",
      length: "equal",
    });
    expect(param2 & 0x07).toBe(0x05);
  });

  it("decodes the flacomdoc selector bits back to the right style TYPE", () => {
    expect(decodeStrokeStyle(0, 0x02)?.type).toBe("dotted");
    expect(decodeStrokeStyle(0, 0x03)?.type).toBe("ragged");
    expect(decodeStrokeStyle(0, 0x04)?.type).toBe("stippled");
    expect(decodeStrokeStyle(0, 0x05)?.type).toBe("hatched");
    expect(decodeStrokeStyle(160, 80)?.type).toBe("dashed");
  });

  it("masks the 0x8000 sharp-corners flag on read (no model field)", () => {
    // A hatched stroke authored with sharp corners still imports as hatched.
    const { param2 } = encodeStrokeStyle({
      type: "hatched",
      hatchThickness: "thin",
      space: "veryClose",
      jiggle: "none",
      rotate: "none",
      curve: "straight",
      length: "equal",
    });
    expect(decodeStrokeStyle(0, param2 + 0x8000)?.type).toBe("hatched");
  });

  it("clamps an out-of-model-range sub-field to the first option (never solid)", () => {
    // A ragged pattern index beyond the model's 3 options still imports as ragged.
    const raw = 0x08 * 6 + 0x03; // pattern idx 6 (flacomdoc "random tripple dotted")
    expect(decodeStrokeStyle(0, raw)?.type).toBe("ragged");
  });
});

describe("stroke-style codec — write→read round-trip per style", () => {
  const cases: StrokeStyle[] = [
    { type: "dashed", dashLength: 10, gapLength: 5 },
    { type: "dotted", dotSpacing: 4.5 },
    { type: "ragged", pattern: "random", waveHeight: "wild", roughness: "fine" },
    { type: "stippled", dotSize: "large", dotVariation: "randomTransition", density: "verySparse" },
    {
      type: "hatched",
      hatchThickness: "varied",
      space: "veryDistant",
      jiggle: "wild",
      rotate: "free",
      curve: "veryCurved",
      length: "random",
    },
  ];

  for (const style of cases) {
    it(`round-trips ${style.type} with non-default parameters`, () => {
      const { param1, param2 } = encodeStrokeStyle(style);
      expect(decodeStrokeStyle(param1, param2)).toEqual(style);
    });
  }
});
