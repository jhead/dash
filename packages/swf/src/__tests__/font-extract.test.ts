/**
 * Tests for runtime system-font outline extraction (font-extract.ts) and the
 * weight/style-aware bundled fallback.
 *
 * The live Local Font Access API path is exercised by MOCKING
 * `window.queryLocalFonts()` to return a FontData whose `blob()` yields a known
 * TTF (we use the bundled NotoSans.ttf as the stand-in "system font"). We assert
 * that the resulting GlyphSource — and the DefineFont2/3 tag built from it —
 * carry real glyph outlines extracted from the injected font, including a
 * cubic→quadratic conversion case (synthesized so the split path is covered even
 * though Noto's ASCII uses only quadratics).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  glyphSourceFromFontBytes,
  bundledGlyphSource,
  pickLocalFace,
  resolveFontGlyphSources,
  hasLocalFontAccess,
  pathToPacked,
} from "../font-extract.js";
import { glyphVariantFor, glyphPath, GlyphOp } from "../glyphdata.js";
import { encodeDefineFont2 } from "../fonts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOTO = readFileSync(join(__dirname, "..", "..", "assets", "NotoSans.ttf"));

const ASCII = (s: string) => [...s].map((c) => c.charCodeAt(0));

// ---------------------------------------------------------------------------
// Fake Local Font Access API
// ---------------------------------------------------------------------------

interface FakeFace {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  bytes: Uint8Array;
}

function installFakeQueryLocalFonts(faces: FakeFace[]): void {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.queryLocalFonts = async () =>
    faces.map((f) => ({
      family: f.family,
      fullName: f.fullName,
      postscriptName: f.postscriptName,
      style: f.style,
      blob: async () => ({
        arrayBuffer: async () =>
          f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength),
      }),
    }));
}

function clearFakeApi(): void {
  if ((globalThis as any).window) delete (globalThis as any).window.queryLocalFonts;
}

afterEach(() => {
  clearFakeApi();
});

// ---------------------------------------------------------------------------
// glyphSourceFromFontBytes
// ---------------------------------------------------------------------------

describe("glyphSourceFromFontBytes", () => {
  it("extracts real outlines for requested code points from injected font bytes", () => {
    const src = glyphSourceFromFontBytes(NOTO, ASCII("AB "));
    expect(src.isFallback).toBe(false);
    expect(src.em).toBe(1024); // scaled into encoder EM
    // 'A' has a real outline beginning with a MoveTo command.
    const a = src.path(0x41);
    expect(a).toBeDefined();
    expect(a!.length).toBeGreaterThan(0);
    expect(a![0]).toBe(GlyphOp.MoveTo);
    // advance is positive and in EM units.
    expect(src.advance(0x41)).toBeGreaterThan(0);
    // Space has an (empty) outline entry, not undefined.
    expect(src.path(0x20)).toBeDefined();
  });

  it("only embeds the requested code points", () => {
    const src = glyphSourceFromFontBytes(NOTO, ASCII("A"));
    expect(src.path(0x41)).toBeDefined();
    expect(src.path(0x42)).toBeUndefined(); // 'B' not requested → no outline
  });

  it("matches the bundled regular outline for the same source font", () => {
    // NotoSans.ttf is the same font glyphdata.ts was generated from, so the live
    // extractor must produce the SAME packed outline for 'A' as the bundled table.
    const src = glyphSourceFromFontBytes(NOTO, ASCII("A"));
    expect(src.path(0x41)).toEqual(glyphPath(0x41, "regular"));
  });

  it("produces only M/L/Q opcodes (no cubic survives extraction)", () => {
    const src = glyphSourceFromFontBytes(NOTO, ASCII("S"));
    const s = src.path(0x53);
    expect(s).toBeDefined();
    // Every opcode must be one of MoveTo/LineTo/QuadTo (no cubic survives).
    let i = 0;
    const seen = new Set<number>();
    while (i < s!.length) {
      const op = s![i];
      seen.add(op);
      if (op === GlyphOp.MoveTo || op === GlyphOp.LineTo) i += 3;
      else if (op === GlyphOp.QuadTo) i += 5;
      else throw new Error(`unexpected opcode ${op}`);
    }
    expect([...seen].every((op) => op <= GlyphOp.QuadTo)).toBe(true);
  });
});

// Direct cubic→quad coverage via the exported converter (synthetic path).
describe("cubic→quadratic conversion (pathToPacked)", () => {
  it("turns one cubic into exactly two QuadTo commands at the de Casteljau midpoint", () => {
    // A real cubic, as opentype would emit for Arial. The converter must split it
    // into two quadratics (t=0.5) and emit no cubic opcode.
    const packed = pathToPacked({
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "C", x1: 30, y1: 0, x2: 60, y2: 30, x: 60, y: 60 },
      ] as any,
    });
    // MoveTo (3 ints) + two QuadTo (5 ints each) = 13 ints, no cubic.
    expect(packed[0]).toBe(GlyphOp.MoveTo);
    expect(packed.slice(0, 3)).toEqual([GlyphOp.MoveTo, 0, 0]);
    // First quad: control (15,0), anchor rounded (41,19).
    expect(packed.slice(3, 8)).toEqual([GlyphOp.QuadTo, 15, 0, 41, 19]);
    // Second quad: control (53,30) [rounded from 52.5], anchor (60,60).
    expect(packed.slice(8, 13)).toEqual([GlyphOp.QuadTo, 53, 30, 60, 60]);
    expect(packed.length).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// Bundled weight/style fallback selection
// ---------------------------------------------------------------------------

describe("bundledGlyphSource weight/style selection", () => {
  it("selects distinct variant outlines for regular/bold/italic/boldItalic", () => {
    const reg = bundledGlyphSource(false, false);
    const bold = bundledGlyphSource(true, false);
    const ital = bundledGlyphSource(false, true);
    const bi = bundledGlyphSource(true, true);
    expect(reg.isFallback).toBe(true);
    // The four variants must produce different outlines for a representative glyph.
    const a = (s: ReturnType<typeof bundledGlyphSource>) => JSON.stringify(s.path(0x41));
    expect(a(bold)).not.toEqual(a(reg));
    expect(a(ital)).not.toEqual(a(reg));
    expect(a(bi)).not.toEqual(a(reg));
    expect(a(bi)).not.toEqual(a(bold));
  });

  it("bold 'A' is wider than regular 'A' (advance honors weight)", () => {
    expect(bundledGlyphSource(true, false).advance(0x41)).toBeGreaterThan(
      bundledGlyphSource(false, false).advance(0x41)
    );
  });

  it("glyphVariantFor maps flags correctly", () => {
    expect(glyphVariantFor(false, false)).toBe("regular");
    expect(glyphVariantFor(true, false)).toBe("bold");
    expect(glyphVariantFor(false, true)).toBe("italic");
    expect(glyphVariantFor(true, true)).toBe("boldItalic");
  });
});

// ---------------------------------------------------------------------------
// pickLocalFace matcher
// ---------------------------------------------------------------------------

describe("pickLocalFace", () => {
  const faces = [
    { family: "Arial", fullName: "Arial", postscriptName: "ArialMT", style: "Regular", blob: async () => null as any },
    { family: "Arial", fullName: "Arial Bold", postscriptName: "Arial-BoldMT", style: "Bold", blob: async () => null as any },
    { family: "Arial", fullName: "Arial Italic", postscriptName: "Arial-ItalicMT", style: "Italic", blob: async () => null as any },
    { family: "Arial", fullName: "Arial Bold Italic", postscriptName: "Arial-BoldItalicMT", style: "Bold Italic", blob: async () => null as any },
  ];

  it("picks the bold face for a bold request", () => {
    expect(pickLocalFace(faces, "Arial", true, false)?.fullName).toBe("Arial Bold");
  });
  it("picks the italic face for an italic request", () => {
    expect(pickLocalFace(faces, "Arial", false, true)?.fullName).toBe("Arial Italic");
  });
  it("picks the regular face for a plain request", () => {
    expect(pickLocalFace(faces, "Arial", false, false)?.fullName).toBe("Arial");
  });
  it("returns null for an uninstalled family", () => {
    expect(pickLocalFace(faces, "Comic Sans", false, false)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveFontGlyphSources (live path via mocked queryLocalFonts)
// ---------------------------------------------------------------------------

describe("resolveFontGlyphSources", () => {
  it("uses the injected system font outlines when the API resolves", async () => {
    installFakeQueryLocalFonts([
      { family: "Arial", fullName: "Arial", postscriptName: "ArialMT", style: "Regular", bytes: NOTO },
      { family: "Arial", fullName: "Arial Bold", postscriptName: "Arial-BoldMT", style: "Bold", bytes: NOTO },
    ]);
    expect(hasLocalFontAccess()).toBe(true);

    const sources = await resolveFontGlyphSources([
      { family: "Arial", bold: false, italic: false, codePoints: ASCII("A") },
      { family: "Arial", bold: true, italic: false, codePoints: ASCII("A") },
    ]);

    const reg = sources.get("Arial::");
    const bold = sources.get("Arial:bold:");
    expect(reg?.isFallback).toBe(false);
    expect(bold?.isFallback).toBe(false);
    // Built from the injected NotoSans bytes → matches the bundled regular table.
    expect(reg!.path(0x41)).toEqual(glyphPath(0x41, "regular"));
  });

  it("falls back to bundled weight/style tables when the API is absent", async () => {
    clearFakeApi();
    const sources = await resolveFontGlyphSources([
      { family: "Arial", bold: true, italic: false, codePoints: ASCII("A") },
    ]);
    const bold = sources.get("Arial:bold:");
    expect(bold?.isFallback).toBe(true);
    expect(bold!.path(0x41)).toEqual(glyphPath(0x41, "bold"));
  });

  it("falls back when queryLocalFonts rejects (permission denied)", async () => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.queryLocalFonts = async () => {
      throw new Error("denied");
    };
    const sources = await resolveFontGlyphSources([
      { family: "Arial", bold: false, italic: true, codePoints: ASCII("A") },
    ]);
    const ital = sources.get("Arial::italic");
    expect(ital?.isFallback).toBe(true);
    expect(ital!.path(0x41)).toEqual(glyphPath(0x41, "italic"));
  });
});

// ---------------------------------------------------------------------------
// DefineFont2 built from an injected GlyphSource (structural)
// ---------------------------------------------------------------------------

describe("encodeDefineFont2 with injected glyph source", () => {
  function parseGlyphCount(body: Uint8Array): number {
    // FontID(2) + flags(1) + lang(1) + nameLen(1) + name + glyphCount(2)
    let i = 2 + 1 + 1;
    const nameLen = body[i];
    i += 1 + nameLen;
    return body[i] | (body[i + 1] << 8);
  }

  it("emits a glyph per requested code point from the live source", () => {
    const cps = ASCII("ABC");
    const src = glyphSourceFromFontBytes(NOTO, cps);
    const body = encodeDefineFont2(1, "Arial", false, false, 20, false, cps, src);
    expect(parseGlyphCount(body)).toBe(3);
  });

  it("bold source yields a different (wider) font body than regular", () => {
    const cps = ASCII("AAAA");
    const reg = encodeDefineFont2(1, "Arial", false, false, 20, false, cps, bundledGlyphSource(false, false));
    const bold = encodeDefineFont2(1, "Arial", true, false, 20, false, cps, bundledGlyphSource(true, false));
    expect(Buffer.from(bold).equals(Buffer.from(reg))).toBe(false);
  });
});
