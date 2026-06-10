import { describe, it, expect } from "vitest";
import { strokeFromFla8 } from "../flash8-import.js";
import type { Fla8Stroke } from "../flash8-binary.js";

describe("strokeFromFla8", () => {
  const base: Fla8Stroke = {
    color: { r: 0, g: 0, b: 0, a: 255 },
    width: 1,
    cap: "round",
    join: "round",
    miterLimit: 3,
  };

  it("preserves width=0 as hairline instead of clamping to 0.05", () => {
    const stroke = strokeFromFla8({ ...base, width: 0 });
    expect(stroke).toMatchObject({
      strokeType: "hairline",
      width: 0,
      color: { r: 0, g: 0, b: 0, a: 255 },
    });
  });

  it("marks non-zero widths as solid and keeps minimum clamp for tiny values", () => {
    expect(strokeFromFla8({ ...base, width: 2 })).toMatchObject({
      strokeType: "solid",
      width: 2,
    });
    expect(strokeFromFla8({ ...base, width: 0.01 })).toMatchObject({
      strokeType: "solid",
      width: 0.05,
    });
  });
});
