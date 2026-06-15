/**
 * Compile options shared across the compiler passes.
 *
 * Lifted verbatim from compile.ts so pass modules (e.g. characters.ts) can
 * reference {@link CompileOptions} without importing the orchestrator and
 * creating an import cycle. Re-exported by compile.ts for the public API.
 */
import type { GlyphSource } from "../font-extract.js";
import type { MetadataOptions } from "../metadata.js";

export interface CompileOptions {
  /**
   * Optional pre-decoded pixel data for lossless bitmaps.
   * Key: BitmapItem.id → { width, height, pixels: ARGB Uint8Array }
   * When present for a bitmap with compressionType "lossless", a
   * DefineBitsLossless2 tag (36) is emitted instead of DefineBitsJPEG2 (21).
   */
  bitmapPixels?: Map<string, { width: number; height: number; pixels: Uint8Array }>;
  /**
   * When true, emit a Protect tag (24) to mark the SWF as password-protected.
   * The tag body is empty.
   */
  protect?: boolean;
  /**
   * When set, emit an EnableDebugger2 tag (64) with this password string
   * (stored as a null-terminated string after a reserved uint16 = 0).
   */
  debugPassword?: string;
  /**
   * When set, emit a Metadata tag (77) with XMP XML metadata.
   * Also sets the HasMetadata bit (bit 4) in the FileAttributes flags.
   */
  metadata?: MetadataOptions;
  /**
   * When true (the default for SWF v8), emit font definitions as DefineFont3
   * (tag 75, UTF-16 encoding) instead of DefineFont2 (tag 48, UCS-2 encoding).
   * The tag body format is identical — only the tag code differs.
   * Defaults to true.
   */
  useFont3?: boolean;
  /**
   * When true, compress the SWF body using zlib deflate and emit a CWS header
   * (compressed SWF) instead of the standard FWS header.
   * Requires Flash Player 6 or later. Defaults to false.
   */
  compress?: boolean;
  /**
   * Per-face glyph outline sources for embedded fonts, keyed by
   * `fontKey(family, bold, italic)`. Built by the publish flow's async pre-pass
   * ({@link resolveFontGlyphSources} in font-extract.ts), which extracts the
   * author's REAL system-font outlines via the browser Local Font Access API and
   * falls back to the bundled weight/style tables. When a key is absent (or the
   * whole map is undefined), the font encoder uses the bundled fallback selected
   * by the face's bold/italic flags — so output is well-formed without the
   * pre-pass (e.g. golden-parity, unit tests, headless e2e).
   */
  fontGlyphSources?: Map<string, GlyphSource>;
  /**
   * MaxRecursionDepth for ScriptLimits tag (65). Defaults to 256 (Flash Player default).
   */
  maxRecursionDepth?: number;
  /**
   * ScriptTimeoutSeconds for ScriptLimits tag (65). Defaults to 15 seconds.
   */
  scriptTimeoutSeconds?: number;
}
