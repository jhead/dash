import type { Color } from "./types.js";

// ---- Internal helpers ----

/** Clamp a number to [0, 255] and round. */
function clamp255(n: number): number {
  return Math.round(Math.max(0, Math.min(255, n)));
}

// ---- Named colors ----

const NAMED_COLORS: Record<string, Color> = {
  black:       { r: 0,   g: 0,   b: 0,   a: 255 },
  white:       { r: 255, g: 255, b: 255, a: 255 },
  red:         { r: 255, g: 0,   b: 0,   a: 255 },
  green:       { r: 0,   g: 128, b: 0,   a: 255 },
  blue:        { r: 0,   g: 0,   b: 255, a: 255 },
  yellow:      { r: 255, g: 255, b: 0,   a: 255 },
  cyan:        { r: 0,   g: 255, b: 255, a: 255 },
  magenta:     { r: 255, g: 0,   b: 255, a: 255 },
  transparent: { r: 0,   g: 0,   b: 0,   a: 0   },
  orange:      { r: 255, g: 165, b: 0,   a: 255 },
  purple:      { r: 128, g: 0,   b: 128, a: 255 },
  gray:        { r: 128, g: 128, b: 128, a: 255 },
  grey:        { r: 128, g: 128, b: 128, a: 255 },
  pink:        { r: 255, g: 192, b: 203, a: 255 },
};

// ---- CSS parsing ----

/**
 * Parse a CSS color string to Color (0–255 RGBA).
 * Supports: #rrggbb, #rgb, #rrggbbaa, #rgba, rgb(r,g,b), rgba(r,g,b,a),
 *           named colors (the ~16 basic ones), "transparent"
 */
export function cssToColor(css: string): Color {
  const s = css.trim().toLowerCase();

  // #rrggbbaa
  if (/^#[0-9a-f]{8}$/i.test(s)) {
    return {
      r: parseInt(s.slice(1, 3), 16),
      g: parseInt(s.slice(3, 5), 16),
      b: parseInt(s.slice(5, 7), 16),
      a: parseInt(s.slice(7, 9), 16),
    };
  }

  // #rrggbb
  if (/^#[0-9a-f]{6}$/i.test(s)) {
    return {
      r: parseInt(s.slice(1, 3), 16),
      g: parseInt(s.slice(3, 5), 16),
      b: parseInt(s.slice(5, 7), 16),
      a: 255,
    };
  }

  // #rgba (4-digit)
  if (/^#[0-9a-f]{4}$/i.test(s)) {
    const r = parseInt(s[1] + s[1], 16);
    const g = parseInt(s[2] + s[2], 16);
    const b = parseInt(s[3] + s[3], 16);
    const a = parseInt(s[4] + s[4], 16);
    return { r, g, b, a };
  }

  // #rgb
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    const r = parseInt(s[1] + s[1], 16);
    const g = parseInt(s[2] + s[2], 16);
    const b = parseInt(s[3] + s[3], 16);
    return { r, g, b, a: 255 };
  }

  // rgb(r,g,b) or rgba(r,g,b,a)
  const rgbMatch = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (rgbMatch) {
    const a = rgbMatch[4] !== undefined ? Math.round(parseFloat(rgbMatch[4]) * 255) : 255;
    return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3], a: clamp255(a) };
  }

  // Named colors
  if (s in NAMED_COLORS) {
    return NAMED_COLORS[s];
  }

  throw new Error(`cssToColor: unsupported CSS color: "${css}"`);
}

/**
 * Convert a Color to a CSS hex string: #rrggbb (when alpha is 255) or #rrggbbaa.
 */
export function colorToCss(color: Color): string {
  const hex2 = (n: number) => clamp255(n).toString(16).padStart(2, "0");
  if (color.a === 255) {
    return `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
  }
  return `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}${hex2(color.a)}`;
}

/**
 * Convert Color to CSS rgba() string: rgba(r,g,b,a/255).
 */
export function colorToRgba(color: Color): string {
  const a = clamp255(color.a) / 255;
  // Use up to 4 decimal places, trim trailing zeros
  const aStr = parseFloat(a.toFixed(4)).toString();
  return `rgba(${clamp255(color.r)},${clamp255(color.g)},${clamp255(color.b)},${aStr})`;
}

// ---- Blending ----

/** Linear blend: t=0 → a, t=1 → b. All channels interpolated. */
export function mixColors(a: Color, b: Color, t: number): Color {
  return {
    r: clamp255(a.r + (b.r - a.r) * t),
    g: clamp255(a.g + (b.g - a.g) * t),
    b: clamp255(a.b + (b.b - a.b) * t),
    a: clamp255(a.a + (b.a - a.a) * t),
  };
}

/** Premultiplied alpha composite: src over dst. */
export function compositeOver(src: Color, dst: Color): Color {
  const srcA = src.a / 255;
  const dstA = dst.a / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: clamp255((src.r * srcA + dst.r * dstA * (1 - srcA)) / outA),
    g: clamp255((src.g * srcA + dst.g * dstA * (1 - srcA)) / outA),
    b: clamp255((src.b * srcA + dst.b * dstA * (1 - srcA)) / outA),
    a: clamp255(outA * 255),
  };
}

// ---- HSL helpers (used internally) ----

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = clamp255(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = h / 360;
  return {
    r: clamp255(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: clamp255(hue2rgb(p, q, hn) * 255),
    b: clamp255(hue2rgb(p, q, hn - 1 / 3) * 255),
  };
}

// ---- Adjustments ----

/** Increase lightness by amount (0–1 as fraction of remaining headroom). */
export function lighten(color: Color, amount: number): Color {
  const hsl = rgbToHsl(color.r, color.g, color.b);
  const newL = hsl.l + (1 - hsl.l) * amount;
  const rgb = hslToRgb(hsl.h, hsl.s, Math.min(1, newL));
  return { ...rgb, a: color.a };
}

/** Decrease lightness by amount (0–1). */
export function darken(color: Color, amount: number): Color {
  const hsl = rgbToHsl(color.r, color.g, color.b);
  const newL = hsl.l * (1 - amount);
  const rgb = hslToRgb(hsl.h, hsl.s, Math.max(0, newL));
  return { ...rgb, a: color.a };
}

/** Increase saturation by amount (0–1). */
export function saturate(color: Color, amount: number): Color {
  const hsl = rgbToHsl(color.r, color.g, color.b);
  const newS = hsl.s + (1 - hsl.s) * amount;
  const rgb = hslToRgb(hsl.h, Math.min(1, newS), hsl.l);
  return { ...rgb, a: color.a };
}

/** Decrease saturation by amount (0–1). */
export function desaturate(color: Color, amount: number): Color {
  const hsl = rgbToHsl(color.r, color.g, color.b);
  const newS = hsl.s * (1 - amount);
  const rgb = hslToRgb(hsl.h, Math.max(0, newS), hsl.l);
  return { ...rgb, a: color.a };
}

/** Invert RGB channels (alpha unchanged). */
export function invertColor(color: Color): Color {
  return {
    r: 255 - clamp255(color.r),
    g: 255 - clamp255(color.g),
    b: 255 - clamp255(color.b),
    a: color.a,
  };
}

/** Set the alpha channel (0–255). */
export function withAlpha(color: Color, alpha: number): Color {
  return { r: color.r, g: color.g, b: color.b, a: clamp255(alpha) };
}

// ---- HSV conversion ----

export interface HSV {
  readonly h: number; // 0–360
  readonly s: number; // 0–1
  readonly v: number; // 0–1
  readonly a: number; // 0–255
}

export function colorToHSV(color: Color): HSV {
  const r = color.r / 255, g = color.g / 255, b = color.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max;
  const s = max === 0 ? 0 : (max - min) / max;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, v, a: color.a };
}

export function hsvToColor(hsv: HSV): Color {
  const { h, s, v, a } = hsv;
  if (s === 0) {
    const c = clamp255(v * 255);
    return { r: c, g: c, b: c, a };
  }
  const hn = (h % 360) / 60;
  const i = Math.floor(hn);
  const f = hn - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r: number, g: number, b: number;
  switch (i) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return { r: clamp255(r * 255), g: clamp255(g * 255), b: clamp255(b * 255), a };
}

// ---- HSL conversion ----

export interface HSL {
  readonly h: number; // 0–360
  readonly s: number; // 0–1
  readonly l: number; // 0–1
  readonly a: number; // 0–255
}

export function colorToHSL(color: Color): HSL {
  const { h, s, l } = rgbToHsl(color.r, color.g, color.b);
  return { h, s, l, a: color.a };
}

export function hslToColor(hsl: HSL): Color {
  const { h, s, l, a } = hsl;
  const rgb = hslToRgb(h, s, l);
  return { ...rgb, a };
}

// ---- Utilities ----

/** Euclidean color distance in RGB space (ignores alpha). */
export function colorDistance(a: Color, b: Color): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Returns true if colors are identical (all channels equal). */
export function colorsEqual(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
