# 06 — Text & Typography

Flash 8 text, including the new **FlashType** rendering engine.

## Text field types

Set via the Text tool's Property inspector:

- **Static text** — author-time text; outlines/glyphs embedded as needed; not scriptable.
- **Dynamic text** — runtime-updatable via ActionScript (`TextField.text`); supports HTML
  subset, variables, scrolling.
- **Input text** — user-editable fields (forms); supports max chars, password masking.

## FlashType (anti-aliasing) — new in Flash 8

Saffron-based engine rendering crisp text, especially at small sizes, in both authoring and
Flash Player 8. Anti-alias options (Property inspector):

- **Use device fonts** — render with the viewer's system fonts (no embedding).
- **Bitmap text (no anti-alias)** — aliased; good for pixel fonts at exact sizes.
- **Anti-alias for animation** — ignores alignment/kerning for smoother moving text.
- **Anti-alias for readability** — FlashType; sharpest static text (Player 8+).
- **Custom anti-alias (Pro)** — manual **Sharpness** and **Thickness** controls.

## Font handling

- **Embedded fonts** — embed glyph outlines so text renders consistently anywhere;
  selectable character ranges (uppercase, lowercase, numerals, punctuation, custom).
- **Device fonts** — `_sans`, `_serif`, `_typewriter` placeholders mapped to system fonts
  (no embedding, smaller files).
- **Font symbols** — add a font to the Library as a shared/exportable asset.
- **Missing font substitution** — choose replacements when a document's fonts are absent.

## Text attributes (Property inspector)

- Font family, size, color, **bold/italic**.
- **Letter spacing (tracking)**, **kerning** (auto kern), baseline shift (superscript/
  subscript).
- Alignment (left/center/right/justify), margins, indent, line spacing (leading).
- **Orientation** — horizontal, vertical (left-to-right), vertical (right-to-left).
- **Selectable** toggle (allow text selection at runtime).

> **Tracking, baseline shift & orientation (implementation).** These three controls live
> on `TextDisplayObject` and round-trip through save/load.
> - **Tracking (`letterSpacing`, px)** — Properties "Spacing". On stage it is a per-glyph
>   horizontal advance delta (the renderer lays out glyph-by-glyph when spacing ≠ 0); in
>   `DefineText` it is baked into each non-final glyph's advance (twips = px × 20). Named
>   dynamic/input fields also get a runtime `TextFormat.letterSpacing` DoAction.
> - **Baseline shift (`baselineShift`, px)** — Properties "Baseline". A *continuous*
>   vertical run offset, independent of the discrete super/subscript `characterPosition`.
>   Positive raises the glyphs: on stage it subtracts from each line's y, and in
>   `DefineText` it subtracts from the TEXTRECORD YOffset (twips = px × 20).
> - **Orientation (`orientation`)** — Properties "Orientation": `horizontal` (default),
>   `vertical-ltr`, `vertical-rtl`. Vertical modes stack each glyph in its own row
>   (top-to-bottom) with columns advancing L→R or R→L. The stage renderer draws stacked
>   columns; `DefineText` emits one one-glyph TEXTRECORD per glyph with descending
>   YOffsets and zero advance — SWF text has no orientation flag, so vertical text is
>   realised purely via per-glyph layout. `orientation`/`letterSpacing` also persist in
>   the binary FLA CPicText vertical/rtl/letterSpacing fields.
- **Render as HTML** (dynamic/input) — supports `<a> <b> <i> <u> <font> <p> <br> <img> <li>`
  and `<textformat>`; CSS via `TextField.styleSheet`.
- **Border/background** for dynamic/input fields.
- Link (URL) + target for static horizontal text.

## Layout & behavior

- Fixed-width vs auto-sizing text blocks (drag handle = fixed width).
- **Scrolling text** — `maxscroll`/`scroll`, mouse-wheel, and the ScrollBar component.
- **Break Apart** — convert text to individual letters, then to shapes.
- Text supports **filters** (Pro) and **Timeline Effects**.

## Multilanguage / Unicode

- **Unicode (UTF-8/UTF-16)** text encoding throughout.
- **Strings panel** — manage multilingual string sets and language replacement, export/import
  XML language files for localized publishing.
- External text/XML loading with encoding selection.

## Accuracy targets

- All five anti-alias modes; FlashType readability + custom sharpness/thickness must visually
  match Player 8 output.
- Device font mapping (`_sans`/`_serif`/`_typewriter`) and embed character-range selection.
- HTML subset + `<textformat>` + StyleSheet behavior must match AVM1.
- Vertical text orientations and selectable/static link behaviors.

## Implementation notes

- Glyph shaping via HarfBuzz (wasm); outlines embedded into SWF as `DefineFont2/3` with
  `DefineFontAlignZones` + `CSMTextSettings` for FlashType.
- Custom GPU text rasterizer implementing FlashType-style hinting (sharpness/thickness) to
  match the reference; bitmap/aliased path for "no anti-alias" mode.
- Dynamic/input fields are live, scriptable scene objects backed by the AVM1 `TextField`.
