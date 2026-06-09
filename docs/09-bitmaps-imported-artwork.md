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
  (color threshold, minimum area, curve fit, corner threshold).
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
