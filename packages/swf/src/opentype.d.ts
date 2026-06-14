/**
 * Minimal type declarations for the `opentype.js` package (no official
 * @types/opentype.js exists). Covers only the surface this package uses:
 * `parse()` → Font, glyph lookup, and `getPath()` drawing commands.
 */
declare module "opentype.js" {
  export interface PathCommand {
    type: "M" | "L" | "Q" | "C" | "Z";
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  export interface Path {
    commands: PathCommand[];
  }

  export interface Glyph {
    index: number;
    advanceWidth?: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }

  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    charToGlyph(ch: string): Glyph;
    charToGlyphIndex(ch: string): number;
  }

  export function parse(buffer: ArrayBuffer): Font;

  const opentype: {
    parse(buffer: ArrayBuffer): Font;
  };
  export default opentype;
}
