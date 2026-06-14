/**
 * Build-time generator: parse bundled open-licensed Noto Sans TTFs (SIL OFL)
 * with opentype.js and emit `src/glyphdata.ts` containing real vector glyph
 * outlines for printable ASCII (codes 32–126) for FOUR style variants:
 *   regular, bold, italic, bold-italic.
 *
 * These tables are the weight/style-aware FALLBACK used when the browser Local
 * Font Access API (`window.queryLocalFonts()`) is unavailable or denied. They
 * replace the previous regular-only stopgap so that bold/italic text at least
 * renders with the correct weight/slant.
 *
 * Coordinate space — every variant is emitted on a 1024-unit EM square:
 *  - The regular face (assets/NotoSans.ttf) is natively unitsPerEm = 1024, which
 *    is exactly the EM square the SWF font encoder (`fonts.ts`) treats as its
 *    internal coordinate space (the 20× DefineFont3 scale is applied later).
 *  - The bold/italic statics from the canonical Noto repo are unitsPerEm = 1000;
 *    `glyph.getPath(0, 0, 1024)` scales them into the SAME 1024 EM box, so all
 *    four variants share one coordinate space and one ascent/descent. Advance
 *    widths are scaled by 1024/unitsPerEm to match.
 *
 *  - opentype's `getPath` returns coordinates in the SWF font convention:
 *    +x right, **−y up** (above the baseline), +y below the baseline — so
 *    contours map 1:1 with no Y flip.
 *  - Noto Sans uses Move / Line / Quadratic ('M','L','Q') commands for ASCII;
 *    any stray cubic ('C') is split into two quadratics (de Casteljau, t=0.5).
 *
 * Run: `node scripts/gen-glyphdata.mjs` from packages/swf.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(__dirname, '..');

const OUT_PATH = path.join(PKG, 'src', 'glyphdata.ts');

const FIRST = 32;
const LAST = 126;

/** Target EM square shared by all variants (the regular's native EM). */
const TARGET_EM = 1024;

/**
 * Variant descriptors. `key` is the in-file identifier; `file` the asset TTF.
 * The regular face is loaded first and supplies the canonical ascent/descent.
 */
const VARIANTS = [
  { key: 'regular', file: 'NotoSans.ttf' },
  { key: 'bold', file: 'NotoSans-Bold.ttf' },
  { key: 'italic', file: 'NotoSans-Italic.ttf' },
  { key: 'boldItalic', file: 'NotoSans-BoldItalic.ttf' },
];

/**
 * Encode one glyph's outline as a flat command list, scaling the glyph into the
 * TARGET_EM box. Each command is:
 *   ['M', x, y]           absolute move (start a new contour)
 *   ['L', x, y]           absolute line to
 *   ['Q', cx, cy, x, y]   quadratic curve (control, anchor)
 */
function glyphCommands(font, code) {
  const glyph = font.charToGlyph(String.fromCharCode(code));
  if (!glyph) return [];
  // getPath's third arg is the font size; passing TARGET_EM scales the glyph by
  // TARGET_EM / unitsPerEm into the shared 1024-unit EM box.
  const p = glyph.getPath(0, 0, TARGET_EM);
  const out = [];
  for (const c of p.commands) {
    switch (c.type) {
      case 'M':
        out.push(['M', Math.round(c.x), Math.round(c.y)]);
        break;
      case 'L':
        out.push(['L', Math.round(c.x), Math.round(c.y)]);
        break;
      case 'Q':
        out.push(['Q', Math.round(c.x1), Math.round(c.y1), Math.round(c.x), Math.round(c.y)]);
        break;
      case 'C': {
        // Cubic → split into two quadratics via de Casteljau at t=0.5.
        const prev = out.length ? lastAnchor(out) : [0, 0];
        const x0 = prev[0], y0 = prev[1];
        const x1 = c.x1, y1 = c.y1, x2 = c.x2, y2 = c.y2, x3 = c.x, y3 = c.y;
        const mid = (a, b) => (a + b) / 2;
        const ax = mid(x0, x1), ay = mid(y0, y1);
        const bx = mid(x1, x2), by = mid(y1, y2);
        const cx = mid(x2, x3), cy = mid(y2, y3);
        const dx = mid(ax, bx), dy = mid(ay, by);
        const ex = mid(bx, cx), ey = mid(by, cy);
        const fx = mid(dx, ex), fy = mid(dy, ey);
        out.push(['Q', Math.round(ax), Math.round(ay), Math.round(fx), Math.round(fy)]);
        out.push(['Q', Math.round(ex), Math.round(ey), Math.round(x3), Math.round(y3)]);
        break;
      }
      case 'Z':
        break; // contour closed implicitly by the SWF encoder
      default:
        break;
    }
  }
  return out;
}

function lastAnchor(out) {
  for (let i = out.length - 1; i >= 0; i--) {
    const cmd = out[i];
    if (cmd[0] === 'M' || cmd[0] === 'L') return [cmd[1], cmd[2]];
    if (cmd[0] === 'Q') return [cmd[3], cmd[4]];
  }
  return [0, 0];
}

/** Pack a command list to a flat int array (0=M,1=L,2=Q) for compact output. */
function serializeCmds(cmds) {
  const flat = [];
  for (const c of cmds) {
    if (c[0] === 'M') flat.push(0, c[1], c[2]);
    else if (c[0] === 'L') flat.push(1, c[1], c[2]);
    else flat.push(2, c[1], c[2], c[3], c[4]);
  }
  return flat;
}

/** Build packed paths + advances for one variant font, scaled to TARGET_EM. */
function buildVariant(font) {
  const scale = TARGET_EM / font.unitsPerEm; // 1 for regular, 1.024 for em-1000
  const paths = {};
  const advances = {};
  for (let code = FIRST; code <= LAST; code++) {
    const glyph = font.charToGlyph(String.fromCharCode(code));
    const adv = glyph ? glyph.advanceWidth : font.unitsPerEm * 0.5;
    advances[code] = Math.round(adv * scale);
    const cmds = glyphCommands(font, code);
    if (cmds.length) paths[code] = serializeCmds(cmds);
  }
  return { paths, advances };
}

// Load all variants; regular supplies canonical ascent/descent (already in 1024).
const fonts = VARIANTS.map((v) => ({
  ...v,
  font: opentype.parse(fs.readFileSync(path.join(PKG, 'assets', v.file))),
}));
const regular = fonts[0].font;
const ASCENT = Math.round(regular.ascender * (TARGET_EM / regular.unitsPerEm)); // 784
const DESCENT = Math.round(Math.abs(regular.descender) * (TARGET_EM / regular.unitsPerEm)); // 247

const built = fonts.map((v) => ({ key: v.key, ...buildVariant(v.font) }));

// ---- serialize -------------------------------------------------------------

function pathsBody(paths) {
  let body = '';
  for (let code = FIRST; code <= LAST; code++) {
    if (!paths[code]) continue;
    body += `  ${code}: [${paths[code].join(',')}],\n`;
  }
  return body;
}

function advBody(advances) {
  let s = '';
  for (let code = FIRST; code <= LAST; code++) {
    s += `  ${code}: ${advances[code]},`;
    if ((code - FIRST + 1) % 8 === 0) s += '\n';
  }
  return s;
}

let variantTables = '';
for (const v of built) {
  variantTables += `const GLYPH_PATHS_${v.key.toUpperCase()}: Record<number, number[]> = {\n${pathsBody(v.paths)}};\n\n`;
  variantTables += `const GLYPH_ADVANCES_${v.key.toUpperCase()}: Record<number, number> = {\n${advBody(v.advances)}\n};\n\n`;
}

const fileHeader = `/**
 * Real TTF-derived glyph outlines for printable ASCII (codes 32–126), for four
 * style variants: regular, bold, italic, bold-italic.
 *
 * AUTO-GENERATED by \`scripts/gen-glyphdata.mjs\` from bundled Noto Sans TTFs
 * (SIL Open Font License 1.1 — see assets/OFL.txt). Do NOT edit by hand;
 * re-run the generator to regenerate.
 *
 * These are the weight/style-aware FALLBACK glyph tables used when the browser
 * Local Font Access API (queryLocalFonts) cannot supply the author's real system
 * font outlines (Firefox/Safari, permission denied, or glyph not found). The
 * live path (\`font-extract.ts\`) builds a GlyphSource from the real installed
 * font instead.
 *
 * Coordinate space: every variant is emitted on a ${TARGET_EM}-unit EM square,
 * which is exactly the internal EM the SWF font encoder uses (the 20×
 * DefineFont3 scale is applied downstream in fonts.ts). Coordinates follow the
 * SWF glyph convention:  +x = right,  −y = up (above the baseline),  +y = below.
 *
 * Each glyph is a flat int array of drawing commands:
 *   0, x, y            → MoveTo  (start a new contour)
 *   1, x, y            → LineTo
 *   2, cx, cy, x, y    → Quadratic curve (control point, then anchor)
 *
 * A legacy 5×7 bitmap font (\`glyphCells\`) is retained as a runtime fallback for
 * any code point not present in the outline tables.
 */

export const GLYPH_EM = ${TARGET_EM};
export const GLYPH_ASCENT = ${ASCENT};
export const GLYPH_DESCENT = ${DESCENT};

/** Drawing-command opcodes used in the packed glyph path arrays. */
export const enum GlyphOp {
  MoveTo = 0,
  LineTo = 1,
  QuadTo = 2,
}

/** A weight/style variant selector. */
export type GlyphVariant = "regular" | "bold" | "italic" | "boldItalic";

`;

const selectors = `/** Pick the variant key from bold/italic flags. */
export function glyphVariantFor(bold: boolean, italic: boolean): GlyphVariant {
  if (bold && italic) return "boldItalic";
  if (bold) return "bold";
  if (italic) return "italic";
  return "regular";
}

const PATHS_BY_VARIANT: Record<GlyphVariant, Record<number, number[]>> = {
  regular: GLYPH_PATHS_REGULAR,
  bold: GLYPH_PATHS_BOLD,
  italic: GLYPH_PATHS_ITALIC,
  boldItalic: GLYPH_PATHS_BOLDITALIC,
};

const ADVANCES_BY_VARIANT: Record<GlyphVariant, Record<number, number>> = {
  regular: GLYPH_ADVANCES_REGULAR,
  bold: GLYPH_ADVANCES_BOLD,
  italic: GLYPH_ADVANCES_ITALIC,
  boldItalic: GLYPH_ADVANCES_BOLDITALIC,
};

/** Default advance for code points without an explicit entry. */
export const GLYPH_ADVANCE_FALLBACK = ${Math.round(TARGET_EM * 0.5)};

/**
 * Return the packed drawing-command array for an ASCII code point in the given
 * variant (defaulting to regular), or \`undefined\` if no real outline exists
 * (caller falls back to the 5×7 bitmap glyph). Space (0x20) has an empty outline.
 */
export function glyphPath(code: number, variant: GlyphVariant = "regular"): number[] | undefined {
  return PATHS_BY_VARIANT[variant][code];
}

/** Return the advance width (EM units) for a code point in the given variant. */
export function glyphAdvance(code: number, variant: GlyphVariant = "regular"): number {
  return ADVANCES_BY_VARIANT[variant][code] ?? GLYPH_ADVANCE_FALLBACK;
}

`;

// Preserve the existing 5×7 bitmap font verbatim as a runtime fallback.
const FALLBACK_SECTION = `// ---------------------------------------------------------------------------
// Legacy 5×7 bitmap font (fallback)
// ---------------------------------------------------------------------------
// Retained so any code point missing a real TTF outline still renders as a
// legible (if blocky) glyph. fonts.ts only consults this when glyphPath()
// returns undefined.

export const FONT_COLS = 5;
export const FONT_ROWS = 7;

const FONT: Record<number, number[]> = {
  0x20: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], // space
  0x21: [0x04, 0x04, 0x04, 0x04, 0x00, 0x00, 0x04], // !
  0x22: [0x0a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00], // "
  0x23: [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a], // #
  0x24: [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04], // $
  0x25: [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03], // %
  0x26: [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d], // &
  0x27: [0x04, 0x04, 0x08, 0x00, 0x00, 0x00, 0x00], // '
  0x28: [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02], // (
  0x29: [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08], // )
  0x2a: [0x00, 0x04, 0x15, 0x0e, 0x15, 0x04, 0x00], // *
  0x2b: [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00], // +
  0x2c: [0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x08], // ,
  0x2d: [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00], // -
  0x2e: [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c], // .
  0x2f: [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10], // /
  0x30: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e], // 0
  0x31: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e], // 1
  0x32: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f], // 2
  0x33: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e], // 3
  0x34: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02], // 4
  0x35: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e], // 5
  0x36: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e], // 6
  0x37: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08], // 7
  0x38: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e], // 8
  0x39: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c], // 9
  0x3a: [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00], // :
  0x3b: [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x04, 0x08], // ;
  0x3c: [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02], // <
  0x3d: [0x00, 0x00, 0x1f, 0x00, 0x1f, 0x00, 0x00], // =
  0x3e: [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08], // >
  0x3f: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04], // ?
  0x40: [0x0e, 0x11, 0x17, 0x15, 0x17, 0x10, 0x0e], // @
  0x41: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], // A
  0x42: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e], // B
  0x43: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e], // C
  0x44: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c], // D
  0x45: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], // E
  0x46: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10], // F
  0x47: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], // G
  0x48: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], // H
  0x49: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e], // I
  0x4a: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c], // J
  0x4b: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], // K
  0x4c: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f], // L
  0x4d: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], // M
  0x4e: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11], // N
  0x4f: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], // O
  0x50: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10], // P
  0x51: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], // Q
  0x52: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11], // R
  0x53: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], // S
  0x54: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04], // T
  0x55: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], // U
  0x56: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04], // V
  0x57: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11], // W
  0x58: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11], // X
  0x59: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04], // Y
  0x5a: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f], // Z
  0x5b: [0x0e, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0e], // [
  0x5c: [0x10, 0x10, 0x08, 0x04, 0x02, 0x01, 0x01], // backslash
  0x5d: [0x0e, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0e], // ]
  0x5e: [0x04, 0x0a, 0x11, 0x00, 0x00, 0x00, 0x00], // ^
  0x5f: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f], // _
  0x60: [0x08, 0x04, 0x02, 0x00, 0x00, 0x00, 0x00], // \`
  0x61: [0x00, 0x00, 0x0e, 0x01, 0x0f, 0x11, 0x0f], // a
  0x62: [0x10, 0x10, 0x1e, 0x11, 0x11, 0x11, 0x1e], // b
  0x63: [0x00, 0x00, 0x0e, 0x11, 0x10, 0x11, 0x0e], // c
  0x64: [0x01, 0x01, 0x0f, 0x11, 0x11, 0x11, 0x0f], // d
  0x65: [0x00, 0x00, 0x0e, 0x11, 0x1f, 0x10, 0x0e], // e
  0x66: [0x06, 0x09, 0x08, 0x1e, 0x08, 0x08, 0x08], // f
  0x67: [0x00, 0x00, 0x0f, 0x11, 0x0f, 0x01, 0x0e], // g
  0x68: [0x10, 0x10, 0x1e, 0x11, 0x11, 0x11, 0x11], // h
  0x69: [0x04, 0x00, 0x0c, 0x04, 0x04, 0x04, 0x0e], // i
  0x6a: [0x02, 0x00, 0x06, 0x02, 0x02, 0x12, 0x0c], // j
  0x6b: [0x10, 0x10, 0x12, 0x14, 0x18, 0x14, 0x12], // k
  0x6c: [0x0c, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e], // l
  0x6d: [0x00, 0x00, 0x1a, 0x15, 0x15, 0x11, 0x11], // m
  0x6e: [0x00, 0x00, 0x1e, 0x11, 0x11, 0x11, 0x11], // n
  0x6f: [0x00, 0x00, 0x0e, 0x11, 0x11, 0x11, 0x0e], // o
  0x70: [0x00, 0x00, 0x1e, 0x11, 0x1e, 0x10, 0x10], // p
  0x71: [0x00, 0x00, 0x0f, 0x11, 0x0f, 0x01, 0x01], // q
  0x72: [0x00, 0x00, 0x16, 0x19, 0x10, 0x10, 0x10], // r
  0x73: [0x00, 0x00, 0x0f, 0x10, 0x0e, 0x01, 0x1e], // s
  0x74: [0x08, 0x08, 0x1e, 0x08, 0x08, 0x09, 0x06], // t
  0x75: [0x00, 0x00, 0x11, 0x11, 0x11, 0x13, 0x0d], // u
  0x76: [0x00, 0x00, 0x11, 0x11, 0x11, 0x0a, 0x04], // v
  0x77: [0x00, 0x00, 0x11, 0x11, 0x15, 0x15, 0x0a], // w
  0x78: [0x00, 0x00, 0x11, 0x0a, 0x04, 0x0a, 0x11], // x
  0x79: [0x00, 0x00, 0x11, 0x11, 0x0f, 0x01, 0x0e], // y
  0x7a: [0x00, 0x00, 0x1f, 0x02, 0x04, 0x08, 0x1f], // z
  0x7b: [0x02, 0x04, 0x04, 0x08, 0x04, 0x04, 0x02], // {
  0x7c: [0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04], // |
  0x7d: [0x08, 0x04, 0x04, 0x02, 0x04, 0x04, 0x08], // }
  0x7e: [0x00, 0x08, 0x15, 0x02, 0x00, 0x00, 0x00], // ~
};

const FALLBACK = [0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0x1f]; // solid block

/**
 * Return the 5×7 cell grid for an ASCII code point as boolean[row][col].
 * Unknown codes return a solid block so the text stays visible. Only used as a
 * fallback when glyphPath() has no real outline for the code point.
 */
export function glyphCells(code: number): boolean[][] {
  const rows = FONT[code] ?? FALLBACK;
  const grid: boolean[][] = [];
  for (let r = 0; r < FONT_ROWS; r++) {
    const bits = rows[r] ?? 0;
    const row: boolean[] = [];
    for (let c = 0; c < FONT_COLS; c++) {
      // bit (FONT_COLS - 1 - c) is column c (MSB = leftmost).
      row.push(((bits >> (FONT_COLS - 1 - c)) & 1) === 1);
    }
    grid.push(row);
  }
  return grid;
}
`;

fs.writeFileSync(OUT_PATH, fileHeader + variantTables + selectors + FALLBACK_SECTION);
console.error(
  `Wrote ${OUT_PATH}: variants=[${built.map((v) => `${v.key}:${Object.keys(v.paths).length}`).join(', ')}], EM=${TARGET_EM}, ascent=${ASCENT}, descent=${DESCENT}`
);
