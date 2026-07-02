/**
 * Non-solid stroke-style codec for the Flash 8 binary FLA line style
 * (docs/21 §12.2 `u16 styleParam1; u16 styleParam2`).
 *
 * A line style carries two 16-bit parameter words after the color+width. For a
 * plain solid stroke both are 0. For dashed/dotted/ragged/stippled/hatched
 * strokes they encode the style selector and its per-style parameters.
 *
 * The bit LAYOUT (selector bits + multipliers) is taken verbatim from JPEXS
 * flacomdoc's byte-verified writer (`TimelineConverter.java` /
 * `FlaWriter.writeStrokeBegin`):
 *
 *   Dashed  : styleParam1 = dashLen*20, styleParam2 = gapLen*20   (no selector bit;
 *             dashed is the ONLY style that uses styleParam1, so a non-zero
 *             styleParam1 unambiguously marks a dashed stroke).
 *   Dotted  : styleParam2 = 0x10 * round(dotSpace*10) + 0x02
 *   Ragged  : styleParam2 = 0x08*pattern + 0x40*waveHeight + 0x100*waveLength + 0x03
 *   Stipple : styleParam2 = 0x08*dotSize + 0x20*variation  + 0x80*density     + 0x04
 *   Hatched : styleParam2 = 0x08*thickness + 0x20*space + 0x200*jiggle
 *                         + 0x80*rotate   + 0x800*curve + 0x2000*length + 0x05
 *   All styles: + 0x8000 in styleParam2 selects "sharp corners" (MX+); the model
 *             has no sharp-corner field, so that bit is masked off on read and
 *             never set on write.
 *
 * The low three bits of styleParam2 are the style selector
 * (2=dotted, 3=ragged, 4=stipple, 5=hatched); dashed is detected by
 * styleParam1 != 0; solid is both words 0.
 *
 * PARAMETER-VALUE MAPPING CAVEAT (best-effort, marked per the task note): the
 * editor model's enum option lists (engine/types.ts StrokeStyle*) do NOT line up
 * one-for-one with Flash 8's real XFL option lists (e.g. the model's ragged
 * `pattern` has 3 options where flacomdoc's has 7, and the model uses `roughness`
 * where Flash uses "wave length"). We therefore pack each model enum by its
 * *ordinal position* into flacomdoc's exact bit field. This is a faithful
 * INVERSE pair (write is the exact inverse of read, so the round-trip is exact)
 * and preserves flacomdoc's selector bits and bit positions; only the
 * enum-value <-> ordinal correspondence for the multi-choice sub-fields is
 * unverified against a real Flash 8 fixture. Numeric sub-fields (dash/dot spacing)
 * ARE faithful to flacomdoc's twip encoding. Out-of-range indices decoded from a
 * real file are clamped to the model's first option so an authored ragged/stipple/
 * hatched stroke still imports as the right STYLE TYPE (never silently solid).
 */

import type { StrokeStyle } from "../engine/types.js";

// Model enum option lists, in engine/types.ts declaration order. Each value's
// index is packed into flacomdoc's bit field for that sub-field.
const RAGGED_PATTERN = ["solid", "simple", "random"] as const;
const RAGGED_WAVE_HEIGHT = ["flat", "wavy", "wild"] as const;
const RAGGED_ROUGHNESS = ["coarse", "normal", "fine"] as const;

const STIPPLE_DOT_SIZE = ["tiny", "small", "medium", "large"] as const;
const STIPPLE_VARIATION = ["oneSize", "random", "inTransition", "randomTransition"] as const;
const STIPPLE_DENSITY = ["veryDense", "dense", "sparse", "verySparse"] as const;

const HATCH_THICKNESS = ["thin", "medium", "thick", "varied"] as const;
const HATCH_SPACE = ["veryClose", "close", "distant", "veryDistant"] as const;
const HATCH_JIGGLE = ["none", "slight", "medium", "wild"] as const;
const HATCH_ROTATE = ["none", "slight", "medium", "free"] as const;
const HATCH_CURVE = ["straight", "lightCurve", "mediumCurve", "veryCurved"] as const;
const HATCH_LENGTH = ["equal", "slightVariation", "mediumVariation", "random"] as const;

/** Style-selector values (low 3 bits of styleParam2). */
const SEL_DOTTED = 0x02;
const SEL_RAGGED = 0x03;
const SEL_STIPPLE = 0x04;
const SEL_HATCHED = 0x05;

/** Clamp `idx` into `[0, list.length)` and return the option at that index. */
function pick<T>(list: readonly T[], idx: number): T {
  return list[idx] ?? list[0]!;
}

/** Index of `value` in `list`, or 0 if absent (defensive). */
function idxOf<T>(list: readonly T[], value: T): number {
  const i = list.indexOf(value);
  return i < 0 ? 0 : i;
}

export interface StrokeStyleParams {
  /** styleParam1 (u16) */
  readonly param1: number;
  /** styleParam2 (u16) */
  readonly param2: number;
}

/**
 * Decode a binary line style's (styleParam1, styleParam2) into a model
 * StrokeStyle. Returns `undefined` for a solid stroke (both words 0 / no
 * recognized selector) so callers can leave `Stroke.style` unset.
 */
export function decodeStrokeStyle(param1: number, param2: number): StrokeStyle | undefined {
  const p1 = param1 & 0xffff;
  // Mask off the 0x8000 "sharp corners" flag (no model field for it).
  const p2 = param2 & 0x7fff;

  // Dashed is the only style using styleParam1 (dash length in twips).
  if (p1 !== 0) {
    return { type: "dashed", dashLength: p1 / 20, gapLength: p2 / 20 };
  }

  switch (p2 & 0x07) {
    case SEL_DOTTED:
      // styleParam2 = 0x10 * round(dotSpace*10) + 0x02
      return { type: "dotted", dotSpacing: (p2 >> 4) / 10 };
    case SEL_RAGGED:
      return {
        type: "ragged",
        pattern: pick(RAGGED_PATTERN, (p2 >> 3) & 0x07),
        waveHeight: pick(RAGGED_WAVE_HEIGHT, (p2 >> 6) & 0x03),
        roughness: pick(RAGGED_ROUGHNESS, (p2 >> 8) & 0x03),
      };
    case SEL_STIPPLE:
      return {
        type: "stippled",
        dotSize: pick(STIPPLE_DOT_SIZE, (p2 >> 3) & 0x03),
        dotVariation: pick(STIPPLE_VARIATION, (p2 >> 5) & 0x03),
        density: pick(STIPPLE_DENSITY, (p2 >> 7) & 0x03),
      };
    case SEL_HATCHED:
      return {
        type: "hatched",
        hatchThickness: pick(HATCH_THICKNESS, (p2 >> 3) & 0x03),
        space: pick(HATCH_SPACE, (p2 >> 5) & 0x03),
        rotate: pick(HATCH_ROTATE, (p2 >> 7) & 0x03),
        jiggle: pick(HATCH_JIGGLE, (p2 >> 9) & 0x03),
        curve: pick(HATCH_CURVE, (p2 >> 11) & 0x03),
        length: pick(HATCH_LENGTH, (p2 >> 13) & 0x03),
      };
    default:
      // selector 0 (solid) or an unrecognized value → no style.
      return undefined;
  }
}

/**
 * Encode a model StrokeStyle into (styleParam1, styleParam2). The exact inverse
 * of decodeStrokeStyle. A solid/undefined style encodes to {0, 0}, keeping the
 * bytes identical to the pre-existing solid-only writer (empty-doc byte gates).
 */
export function encodeStrokeStyle(style: StrokeStyle | undefined): StrokeStyleParams {
  if (!style || style.type === "solid") return { param1: 0, param2: 0 };

  switch (style.type) {
    case "dashed":
      return {
        param1: Math.round(style.dashLength * 20) & 0xffff,
        param2: Math.round(style.gapLength * 20) & 0xffff,
      };
    case "dotted":
      return { param1: 0, param2: (0x10 * Math.round(style.dotSpacing * 10) + SEL_DOTTED) & 0xffff };
    case "ragged":
      return {
        param1: 0,
        param2:
          (0x08 * idxOf(RAGGED_PATTERN, style.pattern) +
            0x40 * idxOf(RAGGED_WAVE_HEIGHT, style.waveHeight) +
            0x100 * idxOf(RAGGED_ROUGHNESS, style.roughness) +
            SEL_RAGGED) &
          0xffff,
      };
    case "stippled":
      return {
        param1: 0,
        param2:
          (0x08 * idxOf(STIPPLE_DOT_SIZE, style.dotSize) +
            0x20 * idxOf(STIPPLE_VARIATION, style.dotVariation) +
            0x80 * idxOf(STIPPLE_DENSITY, style.density) +
            SEL_STIPPLE) &
          0xffff,
      };
    case "hatched":
      return {
        param1: 0,
        param2:
          (0x08 * idxOf(HATCH_THICKNESS, style.hatchThickness) +
            0x20 * idxOf(HATCH_SPACE, style.space) +
            0x80 * idxOf(HATCH_ROTATE, style.rotate) +
            0x200 * idxOf(HATCH_JIGGLE, style.jiggle) +
            0x800 * idxOf(HATCH_CURVE, style.curve) +
            0x2000 * idxOf(HATCH_LENGTH, style.length) +
            SEL_HATCHED) &
          0xffff,
      };
    default: {
      // Exhaustiveness guard.
      const _never: never = style;
      void _never;
      return { param1: 0, param2: 0 };
    }
  }
}
