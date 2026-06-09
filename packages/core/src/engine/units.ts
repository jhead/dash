import type { RulerUnits } from "../model/types.js";

// Flash 8 uses 72 DPI
const DPI = 72;

const PX_PER_INCH = DPI;
const PX_PER_CM = DPI / 2.54;
const PX_PER_MM = DPI / 25.4;
const PX_PER_POINT = DPI / 72; // 1 point = 1/72 inch

/** Convert a value from one unit to pixels */
export function toPx(value: number, unit: RulerUnits): number {
  switch (unit) {
    case "px": return value;
    case "inches": return value * PX_PER_INCH;
    case "cm": return value * PX_PER_CM;
    case "mm": return value * PX_PER_MM;
    case "points": return value * PX_PER_POINT;
    default: return value;
  }
}

/** Convert a value from pixels to the given unit */
export function fromPx(value: number, unit: RulerUnits): number {
  switch (unit) {
    case "px": return value;
    case "inches": return value / PX_PER_INCH;
    case "cm": return value / PX_PER_CM;
    case "mm": return value / PX_PER_MM;
    case "points": return value / PX_PER_POINT;
    default: return value;
  }
}

/** Convert a value from one unit to another */
export function convertUnits(value: number, from: RulerUnits, to: RulerUnits): number {
  if (from === to) return value;
  return fromPx(toPx(value, from), to);
}

/** Format a measurement for display */
export function formatMeasurement(value: number, unit: RulerUnits, decimals = 2): string {
  const rounded = Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
  const suffix: Record<RulerUnits, string> = { px: "px", inches: "in", cm: "cm", mm: "mm", points: "pt" };
  return `${rounded}${suffix[unit]}`;
}
