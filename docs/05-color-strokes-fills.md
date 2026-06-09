# 05 — Color, Strokes & Fills

How Flash 8 defines and applies color, gradients, and fills.

## Color models & pickers

- Colors are RGB with an **Alpha (%)** channel.
- Hex entry (`#RRGGBB`), RGB fields, and the system color picker.
- **Stroke color** and **Fill color** controls appear in the Tools panel and the Property
  inspector (see `04`).

## Color Mixer panel

`Window > Color Mixer` (Shift+F9). Fill **type** selector:

- **None**
- **Solid** — single color + alpha.
- **Linear gradient** — color band along an axis.
- **Radial gradient** — color band from a center (with **focal point** offset, new in 8).
- **Bitmap** — tiled/clipped bitmap fill (pick from imported bitmaps).

Gradient editing:

- Gradient **swatch bar** with draggable **color stops**; add stop by clicking the bar,
  remove by dragging off; per-stop color + alpha.
- **Flash 8 increased the max gradient colors to 15 stops** (was 8).
- **Overflow modes (new in 8)**: **Extend**, **Reflect**, **Repeat** — control behavior
  beyond the gradient range. (Exported via `DefineShape4` spread modes.)
- **Linear RGB** interpolation option (new in 8) for smoother gradients.

## Swatches panel

`Window > Color Swatches` (Ctrl/Cmd+F9):

- Default **web-safe (216)** palette + saved solid colors and gradients.
- Add/delete swatches, sort by color, load/save/replace palettes, clear colors.
- Import/export palettes: **.clr** (Flash Color Set), **.act** (Color Table), GIF palettes.

## Applying color

- **Ink Bottle (`S`)** — apply/replace **strokes** (color, weight, style) on existing shapes.
- **Paint Bucket (`K`)** — apply/replace **fills** (solid/gradient/bitmap); **Gap Size**
  closes small outline gaps; **Lock Fill** spans a gradient/bitmap across shapes.
- **Eyedropper (`I`)** — sample an existing stroke or fill (then auto-switches to Ink Bottle
  or Paint Bucket); can sample a bitmap to use as a fill.

## Transforming gradient & bitmap fills

- **Gradient Transform tool (`F`)** — move the fill **center**, adjust **focal point**
  (radial), resize the gradient, rotate, and skew; for bitmaps: scale/rotate/skew/tile.
- **Lock Fill** locks a gradient/bitmap to the stage so multiple shapes share one continuous
  fill.

## Color effects on instances

Symbol **instances** support a **Color** effect (Property inspector) — distinct from shape
fills:

- **Brightness** (−100…100%).
- **Tint** (color + amount %).
- **Alpha** (0…100%).
- **Advanced** — per-channel multiply + offset for R, G, B, A (the full color transform).

These map to the SWF **CXFORM/CXFORMWITHALPHA** color transform on `PlaceObject2`.

## Accuracy targets

- 15-stop gradients, focal point, overflow (extend/reflect/repeat), and linear-RGB
  interpolation must render and export identically (`DefineShape4`).
- Advanced color effect math must match Flash's multiply/offset (8-bit) semantics.
- Palette import/export (.clr/.act/GIF) must be byte-compatible.
- Lock Fill continuity across multiple shapes must match.

## Implementation notes

- Gradients evaluated in fragment shaders, including focal radial and spread modes; optional
  linear-RGB color space path.
- Bitmap fills use a fill matrix (the gradient/bitmap transform) sampled with the bitmap's
  smoothing/repeat settings.
- Instance color transform applied as a per-draw multiply+add uniform in the shader.
