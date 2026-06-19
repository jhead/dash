# 09 — Bitmaps & Imported Artwork

Importing external graphics and Flash 8's runtime bitmap (BitmapData) capabilities.

## Importing

`File > Import` — **Import to Stage** or **Import to Library**. Supported import formats:

- **Bitmaps**: JPEG, GIF (incl. animated → frames), PNG (incl. alpha) — PNG/GIF support was
  improved in Flash 8.
- **Vector/layered**: Adobe Illustrator (AI/EPS), **Macromedia FreeHand**, **Fireworks PNG**
  (with editable layers, filters, blend modes), Photoshop (via PSD where supported), SWF,
  DXF, EMF/WMF (Windows), PICT (Mac).
- **Import options dialogs** control layer/page/text handling for AI/FreeHand/Fireworks.
- **Paste** from clipboard (vector or bitmap).

## Imported bitmap handling

- Each imported bitmap becomes a **Library asset**; instances placed on stage.
- **Bitmap Properties** dialog: name, compression (**Photo/JPEG** with quality, or
  **Lossless/PNG-GIF**), **Allow smoothing**, update/re-import, test (shows compressed size).
- Use a bitmap as a **fill** (Color Mixer bitmap fill; tile/clip via Gradient Transform).
- **Break Apart** a bitmap to paint/erase/select regions; combine with Magic Wand (Lasso).
- **Trace Bitmap** (`Modify > Bitmap > Trace Bitmap`) — convert raster to editable vectors
  (color threshold, minimum area, curve fit, corner threshold). **Implemented**: the
  contour tracer lives in `packages/core/src/engine/bitmapTrace.ts` (exported from
  `@flash/core` as `traceBitmapToPaths`; the legacy `traceBitmap` façade in
  `model/traceBitmap.ts` delegates to it). The Trace Bitmap dialog
  (`authoring-ui/TraceBitmapDialog.tsx`) + the `Modify > Bitmap` menu command replace the
  selected bitmap display object with one solid-filled vector shape per color region.
- **Swap bitmap** on an instance.

## BitmapData & runtime bitmaps (new in Flash 8)

The `flash.display.BitmapData` API enables programmatic raster work at runtime:

- Create/clone bitmaps; `setPixel/getPixel` (+ `*32` for alpha).
- `draw()` — rasterize any display object (with matrix/colorTransform/blend) into a bitmap.
- `copyPixels`, `fillRect`, `floodFill`, `scroll`, `noise`, `perlinNoise`, `threshold`,
  `colorTransform`, `paletteMap`, `merge`, `pixelDissolve`.
- **`applyFilter`** — apply `flash.filters.*` (blur, glow, displacement, convolution, color
  matrix, etc.) to pixels.
- Attach a BitmapData to the stage via `MovieClip.attachBitmap` / `BitmapData` fills.
- Enables effects, generative art, image processing, and runtime caching tricks.

## Accuracy targets

- JPEG vs lossless (PNG/GIF) compression choices must produce SWF bitmap tags matching Flash
  (`DefineBitsJPEG2/3`, `DefineBitsLossless2`) including alpha.
- `allowSmoothing` affects sampling (bilinear vs nearest) identically.
- Trace Bitmap parameters should yield comparable vectorization.
- Full BitmapData method set with Flash 8 semantics (incl. channel order, alpha
  premultiplication behavior).

## Implementation notes

- Decoders/encoders (JPEG, PNG, GIF) run as wasm; alpha stored alongside JPEG as in Flash's
  `DefineBitsJPEG3` (separate zlib alpha).
- BitmapData backed by GPU textures with a CPU-readable mirror for per-pixel APIs; `draw()`
  uses the render engine; `applyFilter` reuses the filter shader passes from `08`.
- Bitmap fills sample with the asset's smoothing + the fill matrix from `05`.
- **Trace Bitmap pipeline** (`engine/bitmapTrace.ts`, pure/DOM-free): (1) quantize each
  pixel to a color bucket whose size is derived from **Color Threshold** (near-transparent
  pixels drop into one transparent bucket); (2) 4-connectivity flood-fill connected
  same-color regions; (3) discard regions below **Minimum Area**; (4) trace each region's
  outline with **marching squares** on a region-local binary mask (pixel-edge coordinates,
  so axis-aligned edges are exact); (5) simplify the contour with **Douglas-Peucker** whose
  epsilon comes from **Curve Fit** (`pixels`=0 keeps every vertex → smoother modes raise
  epsilon); (6) emit a closed solid-filled `ShapePath` — smoothing curve-fit modes round
  shallow vertices into quadratic Béziers while vertices whose turn angle meets the
  **Corner Threshold** angle stay sharp. Trace is non-destructive: the source bitmap stays
  in the Library (the FLA importer's `convertShape` already reconstructs hundreds–thousands
  of solid fills per Trace-Bitmap shape — see CLAUDE.md). The contour/Douglas-Peucker code
  shares its lineage with the Lasso Magic Wand (`engine/magicWand.ts`).
