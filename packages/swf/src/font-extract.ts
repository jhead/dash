/**
 * Runtime system-font outline extraction (browser, no Rust/Tauri).
 *
 * Flash embedded the AUTHOR'S ACTUAL system-font glyph outlines (real Arial,
 * bold/italic, …) into the published SWF's DefineFont2. We reproduce that with
 * the browser **Local Font Access API** (`window.queryLocalFonts()`):
 *
 *   1. `queryLocalFonts()` → list of installed FontData faces.
 *   2. Pick the FontData whose family + weight/style matches (family, bold, italic).
 *   3. `await (await fd.blob()).arrayBuffer()` → the raw TTF/OTF bytes.
 *   4. `parseFont(buf)` → glyph outlines for the used code points.
 *   5. Emit a {@link GlyphSource} the SWF font encoder turns into DefineFont2 records.
 *
 * The outline → packed-command conversion mirrors `scripts/gen-glyphdata.mjs`
 * (M / L / Q, cubic→quadratic split, SWF font Y convention) so the encoder in
 * `fonts.ts` treats live and bundled glyphs identically. Coordinates are emitted
 * on the encoder's internal EM square (see {@link GLYPH_EM}); the DefineFont3
 * 20× scale is applied downstream in `fonts.ts`.
 *
 * Everything here is browser-safe and gracefully degrades: if the API is
 * missing, permission is denied, or a family/glyph isn't found, the caller falls
 * back to the bundled weight/style tables (`bundledGlyphSource`).
 */
// opentype.js is a CommonJS module and its ESM interop shape differs by
// environment: Vite's optimized browser dep exposes `parse` directly on the
// namespace and has NO `default` export (a default import crashes app load),
// while raw Node ESM (golden-parity, vitest) wraps the module under `default`
// and does NOT surface the named `parse`. Import the namespace and resolve
// `parse` from whichever shape is present so all three work.
import * as opentypeModule from "opentype.js";
import type { PathCommand } from "opentype.js";
const parseFont =
  (opentypeModule as { default?: { parse: typeof opentypeModule.parse } }).default?.parse ??
  opentypeModule.parse;
import {
  GLYPH_EM,
  GLYPH_ASCENT,
  GLYPH_DESCENT,
  glyphPath as bundledPath,
  glyphAdvance as bundledAdvance,
  glyphVariantFor,
  type GlyphVariant,
} from "./glyphdata.js";

/**
 * A source of glyph outlines for one font face (family + weight + style).
 *
 * Coordinates are in EM units on the {@link em}-unit EM square, in the SWF glyph
 * convention (+x right, −y up above baseline). Each packed path is the same
 * flat command array glyphdata.ts uses: `0,x,y`=MoveTo, `1,x,y`=LineTo,
 * `2,cx,cy,x,y`=QuadTo. `path()` returns `undefined` when the face has no
 * outline for the code point (caller falls back to the 5×7 bitmap glyph).
 */
export interface GlyphSource {
  /** EM square size in font units (encoder treats this as its coordinate space). */
  readonly em: number;
  /** Ascent in EM units (positive, above baseline). */
  readonly ascent: number;
  /** Descent in EM units (positive magnitude, below baseline). */
  readonly descent: number;
  /** Packed M/L/Q command array for a code point, or undefined. */
  path(code: number): number[] | undefined;
  /** Advance width in EM units for a code point. */
  advance(code: number): number;
  /** True for the bundled fallback; live system-font sources are false. */
  readonly isFallback: boolean;
}

// ---------------------------------------------------------------------------
// Bundled fallback source (weight/style aware)
// ---------------------------------------------------------------------------

/**
 * The bundled Noto-derived fallback source for a (bold, italic) combination.
 * Used when the Local Font Access API can't supply the real system font.
 */
export function bundledGlyphSource(bold: boolean, italic: boolean): GlyphSource {
  const variant: GlyphVariant = glyphVariantFor(bold, italic);
  return {
    em: GLYPH_EM,
    ascent: GLYPH_ASCENT,
    descent: GLYPH_DESCENT,
    path: (code) => bundledPath(code, variant),
    advance: (code) => bundledAdvance(code, variant),
    isFallback: true,
  };
}

// ---------------------------------------------------------------------------
// opentype outline → packed command conversion (mirrors gen-glyphdata.mjs)
// ---------------------------------------------------------------------------

/** Packed-command opcodes (must match glyphdata.ts GlyphOp). */
const OP_MOVE = 0;
const OP_LINE = 1;
const OP_QUAD = 2;

/**
 * Convert one opentype path (already scaled to the target EM via getPath's size
 * argument) into a flat packed command array. Cubic ('C') segments are split
 * into two quadratics by de Casteljau subdivision at t=0.5 (real Arial uses
 * cubic Béziers, unlike Noto). 'Z' is ignored (SWF closes contours implicitly).
 */
export function pathToPacked(path: { commands: PathCommand[] }): number[] {
  const out: number[] = [];
  let penX = 0;
  let penY = 0;
  for (const c of path.commands) {
    switch (c.type) {
      case "M":
        out.push(OP_MOVE, Math.round(c.x!), Math.round(c.y!));
        penX = c.x!;
        penY = c.y!;
        break;
      case "L":
        out.push(OP_LINE, Math.round(c.x!), Math.round(c.y!));
        penX = c.x!;
        penY = c.y!;
        break;
      case "Q":
        out.push(OP_QUAD, Math.round(c.x1!), Math.round(c.y1!), Math.round(c.x!), Math.round(c.y!));
        penX = c.x!;
        penY = c.y!;
        break;
      case "C": {
        const x0 = penX, y0 = penY;
        const x1 = c.x1!, y1 = c.y1!, x2 = c.x2!, y2 = c.y2!, x = c.x!, y = c.y!;
        const mid = (a: number, b: number) => (a + b) / 2;
        const ax = mid(x0, x1), ay = mid(y0, y1);
        const bx = mid(x1, x2), by = mid(y1, y2);
        const cx = mid(x2, x), cy = mid(y2, y);
        const dx = mid(ax, bx), dy = mid(ay, by);
        const ex = mid(bx, cx), ey = mid(by, cy);
        const fx = mid(dx, ex), fy = mid(dy, ey);
        out.push(OP_QUAD, Math.round(ax), Math.round(ay), Math.round(fx), Math.round(fy));
        out.push(OP_QUAD, Math.round(ex), Math.round(ey), Math.round(x), Math.round(y));
        penX = x;
        penY = y;
        break;
      }
      case "Z":
      default:
        break;
    }
  }
  return out;
}

/**
 * Build a {@link GlyphSource} from parsed opentype font bytes, extracting only
 * the requested code points. Outlines are scaled into the encoder's EM square
 * ({@link GLYPH_EM}); advances are scaled the same way. Code points without a
 * glyph in the font are omitted (the encoder falls back to the bundled/5×7
 * glyph for those).
 *
 * Exported for unit tests (inject a known TTF's bytes as the "system font").
 */
export function glyphSourceFromFontBytes(
  bytes: ArrayBuffer | Uint8Array,
  codePoints: readonly number[]
): GlyphSource {
  const buf = bytes instanceof Uint8Array ? toArrayBuffer(bytes) : bytes;
  const font = parseFont(buf);
  const targetEm = GLYPH_EM;
  const scale = targetEm / font.unitsPerEm;

  const paths = new Map<number, number[]>();
  const advances = new Map<number, number>();
  for (const code of codePoints) {
    const glyph = font.charToGlyph(String.fromCharCode(code));
    // charToGlyph returns the .notdef glyph for unmapped chars; skip those so we
    // fall back rather than embedding a tofu box. .notdef has index 0.
    const mapped = font.charToGlyphIndex(String.fromCharCode(code)) !== 0;
    if (glyph) {
      advances.set(code, Math.round((glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scale));
      if (mapped || code === 0x20) {
        // getPath's size arg scales the glyph into the target EM box.
        const p = glyph.getPath(0, 0, targetEm);
        const packed = pathToPacked(p);
        if (packed.length > 0 || code === 0x20) paths.set(code, packed);
      }
    }
  }

  return {
    em: targetEm,
    ascent: Math.round(Math.abs(font.ascender) * scale),
    descent: Math.round(Math.abs(font.descender) * scale),
    path: (code) => paths.get(code),
    advance: (code) =>
      advances.get(code) ?? Math.round(targetEm * 0.5),
    isFallback: false,
  };
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  // opentype.parse needs an ArrayBuffer; slice to the exact view range.
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Local Font Access API integration
// ---------------------------------------------------------------------------

/** Minimal shape of a FontData from the Local Font Access API. */
interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

type QueryLocalFonts = () => Promise<LocalFontData[]>;

/** True when the Local Font Access API is present in this environment. */
export function hasLocalFontAccess(): boolean {
  return typeof window !== "undefined" && typeof (window as any).queryLocalFonts === "function";
}

function getQueryLocalFonts(): QueryLocalFonts | undefined {
  if (typeof window === "undefined") return undefined;
  const q = (window as any).queryLocalFonts;
  return typeof q === "function" ? (q.bind(window) as QueryLocalFonts) : undefined;
}

/**
 * Score how well a FontData matches the requested (family, bold, italic). Higher
 * is better; negative means the family doesn't match at all. The matcher is
 * intentionally lenient on naming (e.g. "Arial" vs "Arial Bold"): it requires
 * the family to start with the requested family (case-insensitive) and then
 * prefers faces whose style/name reflect the requested weight & slant.
 */
function scoreFace(fd: LocalFontData, family: string, bold: boolean, italic: boolean): number {
  const fam = fd.family.toLowerCase().trim();
  const want = family.toLowerCase().trim();
  if (fam !== want && !fam.startsWith(want)) return -1;

  const desc = `${fd.style} ${fd.fullName} ${fd.postscriptName}`.toLowerCase();
  const faceBold = /\b(bold|black|heavy|semibold|demibold)\b/.test(desc) || /bold/.test(desc);
  const faceItalic = /\b(italic|oblique)\b/.test(desc) || /italic|oblique/.test(desc);

  let score = 0;
  // Exact family name match is strongly preferred over a prefix match.
  if (fam === want) score += 100;
  // Reward matching weight/slant; penalize mismatches so the regular face isn't
  // chosen for a bold request when a bold face exists.
  score += faceBold === bold ? 10 : -10;
  score += faceItalic === italic ? 10 : -10;
  return score;
}

/**
 * Pick the best-matching FontData for (family, bold, italic), or null if no face
 * for the family is installed.
 */
export function pickLocalFace(
  fonts: LocalFontData[],
  family: string,
  bold: boolean,
  italic: boolean
): LocalFontData | null {
  let best: LocalFontData | null = null;
  let bestScore = -1;
  for (const fd of fonts) {
    const s = scoreFace(fd, family, bold, italic);
    if (s > bestScore) {
      bestScore = s;
      best = fd;
    }
  }
  return bestScore >= 0 ? best : null;
}

/**
 * Resolve a {@link GlyphSource} for a single font face using the Local Font
 * Access API. Returns null (so the caller uses the bundled fallback) when:
 *  - the API is unavailable,
 *  - permission is denied / the query throws,
 *  - no installed face matches the family, or
 *  - parsing the face's bytes fails.
 *
 * Must be invoked from a user gesture (e.g. the Publish action) the first time,
 * since `queryLocalFonts()` is permission-gated.
 */
export async function resolveSystemGlyphSource(
  family: string,
  bold: boolean,
  italic: boolean,
  codePoints: readonly number[]
): Promise<GlyphSource | null> {
  const query = getQueryLocalFonts();
  if (!query) return null;
  let fonts: LocalFontData[];
  try {
    fonts = await query();
  } catch {
    return null; // permission denied or user dismissed the prompt
  }
  const face = pickLocalFace(fonts, family, bold, italic);
  if (!face) return null;
  try {
    const blob = await face.blob();
    const buf = await blob.arrayBuffer();
    return glyphSourceFromFontBytes(buf, codePoints);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Publish-time font resolver
// ---------------------------------------------------------------------------

/** A resolved face request: the inputs that key one DefineFont2 emission. */
export interface FontFaceRequest {
  family: string;
  bold: boolean;
  italic: boolean;
  /** Code points the published SWF will embed for this face. */
  codePoints: readonly number[];
}

/**
 * Resolve a {@link GlyphSource} for every requested face, trying the live
 * Local-Font-Access path first and falling back to the bundled weight/style
 * tables. Returns a map keyed by `family:bold:italic` (the encoder's fontKey
 * format) for direct lookup in compile.ts.
 *
 * This is the async pre-pass the publish flow runs before the (synchronous)
 * `compileDocument`, mirroring how bitmap pixels are pre-decoded. Pass the
 * resulting map as `CompileOptions.fontGlyphSources`.
 *
 * `queryLocalFonts()` is queried at most once and the result reused across all
 * faces, so the permission prompt appears a single time per publish.
 */
export async function resolveFontGlyphSources(
  requests: readonly FontFaceRequest[]
): Promise<Map<string, GlyphSource>> {
  const out = new Map<string, GlyphSource>();
  if (requests.length === 0) return out;

  // Query the local font list once; reuse for every face.
  const query = getQueryLocalFonts();
  let localFonts: LocalFontData[] | null = null;
  if (query) {
    try {
      localFonts = await query();
    } catch {
      localFonts = null; // denied → bundled fallback for everything
    }
  }

  for (const req of requests) {
    const key = `${req.family}:${req.bold ? "bold" : ""}:${req.italic ? "italic" : ""}`;
    if (out.has(key)) continue;
    let source: GlyphSource | null = null;
    if (localFonts) {
      const face = pickLocalFace(localFonts, req.family, req.bold, req.italic);
      if (face) {
        try {
          const buf = await (await face.blob()).arrayBuffer();
          source = glyphSourceFromFontBytes(buf, req.codePoints);
        } catch {
          source = null;
        }
      }
    }
    out.set(key, source ?? bundledGlyphSource(req.bold, req.italic));
  }
  return out;
}
