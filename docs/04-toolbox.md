# 04 — Toolbox (Tools Panel)

The complete Flash 8 Tools panel. **Every tool, modifier, default, and shortcut below must
be reproduced exactly.** The panel has four sections: **Tools**, **View**, **Colors**,
**Options**. The Options section changes contextually with the active tool.

## Tools section (17 tools)

| Tool | Key | Purpose | Key options (Options area / Property inspector) |
|------|-----|---------|--------------------------------------------------|
| **Selection** (Arrow) | `V` | Select/move objects; reshape raw edges | Snap to Objects (magnet), Smooth, Straighten |
| **Subselection** | `A` | Edit anchor points & Bézier handles | (uses Property inspector) |
| **Free Transform** | `Q` | Scale, rotate, skew, distort, envelope | Rotate & Skew, Scale, **Distort**, **Envelope** |
| **Gradient Transform** | `F` | Move/scale/rotate/skew gradient & bitmap fills | center, focal point, size, rotation handles |
| **Line** | `N` | Draw straight strokes | stroke color/weight/style; Object Drawing; Snap |
| **Lasso** | `L` | Freeform / polygon selection | **Magic Wand**, Magic Wand Properties, **Polygon Mode** |
| **Pen** | `P` | Bézier paths with explicit anchors | add/delete/convert anchor (sub-tools) |
| **Text** | `T` | Static / Dynamic / Input text | type, font, anti-alias, orientation (see `06`) |
| **Oval** | `O` | Draw ellipses/circles | stroke + fill; Object Drawing; Alt-click = exact size |
| **Rectangle** | `R` | Draw rectangles | **corner radius**; Object Drawing; Alt-click dialog |
| **PolyStar** | — | Polygons & stars (shares Rectangle slot) | Polygon/Star, number of sides, star point size |
| **Pencil** | `Y` | Freehand strokes | mode: **Straighten / Smooth / Ink** |
| **Brush** | `B` | Paint fills (as shapes) | brush size, brush shape, **paint mode**, lock fill, **Pressure**, **Tilt** |
| **Ink Bottle** | `S` | Apply/change strokes on shapes | stroke color/weight/style |
| **Paint Bucket** | `K` | Fill enclosed areas; apply gradients/bitmaps | **Gap Size** (Don't/Small/Medium/Large), Lock Fill |
| **Eyedropper** | `I` | Sample stroke/fill/bitmap attributes | (auto-switches to Ink Bottle/Paint Bucket) |
| **Eraser** | `E` | Erase fills/strokes | eraser size/shape, **erase mode**, **Faucet** |

### Tool option details

- **Free Transform modes**: Rotate and Skew, Scale, Distort, Envelope. Holding modifiers:
  Shift = constrain; Alt/Option = transform from center; corner vs edge handles differ.
- **Lasso**: freeform drag; **Polygon Mode** for straight-edged selections (click successive
  vertices; close by double-clicking, clicking the start vertex, or pressing **Enter** —
  **Esc** cancels the in-progress polygon); **Magic Wand** selects contiguous bitmap regions
  by color (Threshold, default 20, + Smoothing — pixels/rough/normal/smooth — in Magic Wand
  Properties). The pure selection algorithms (flood fill, contour trace, polygon-close logic)
  live in `@flash/core` `engine/magicWand` (`floodFillPixels`, `magicWandSelectPixels`,
  `selectedPixelsToBoundingPolygon`, `shouldClosePolygon`); the authoring-ui `StageArea` only
  rasterizes the bitmap and feeds the result into the existing selection pipeline.
- **Pen sub-tools**: Pen (add point on path), Add Anchor (`=`), Delete Anchor (`-`),
  Convert Anchor (`C`). Cursor feedback for closing paths / continuing.
- **Brush paint modes**: Paint Normal, Paint Fills, Paint Behind, Paint Selection, Paint Inside.
- **Eraser modes**: Erase Normal, Erase Fills, Erase Lines, Erase Selected Fills, Erase Inside.
  **Faucet** deletes an entire fill or stroke in one click. Double-click eraser = clear stage.
- **Paint Bucket Gap Size** lets fills close small gaps in outlines; **Lock Fill** continues a
  gradient/bitmap across multiple shapes.
- **Rectangle/Oval** with Alt/Option-click open an exact-dimensions dialog; Rectangle radius
  can be set numerically (incl. inverted corners).

### Object Drawing toggle
- **Object Drawing** option (J) appears for shape/draw tools (Pencil, Brush, Line, Oval,
  Rectangle, PolyStar, Pen). Toggles merge vs object drawing (see `03`).

## View section

| Tool | Key | Purpose |
|------|-----|---------|
| **Hand** | `H` (hold **Space**) | Pan the stage |
| **Zoom** | `Z` / `M` | Zoom in (Alt = out); marquee-zoom; sub-options Enlarge/Reduce |

## Colors section

- **Stroke color** swatch + picker.
- **Fill color** swatch + picker.
- **Black and White** — reset to black stroke / white fill.
- **No Color** — disable stroke or fill (for shape tools).
- **Swap Colors** — exchange stroke and fill.

## Options section

Contextual modifiers for the active tool (e.g. magnet/smooth/straighten for Selection;
brush size/shape/mode for Brush). Documented per-tool above.

## Customize Tools Panel

`Edit > Customize Tools Panel` (Flash menu on Mac) lets users add/remove/rearrange tools and
group multiple tools into one slot (introduced MX 2004; PolyStar is grouped with Rectangle).
Supports adding custom (extension) tools.

## Accuracy targets

- Exact shortcut keys (table above) including grouped-slot behavior (Rectangle/PolyStar).
- Every option/modifier present, with Flash 8 defaults (e.g. magnet on by default,
  Paint Bucket gap = "Don't Close Gaps", Pencil = Straighten).
- Cursor graphics/feedback states (e.g. Pen path-close cursor, Paint Bucket gap warning).
- Eyedropper auto-switching to Ink Bottle (on stroke sample) / Paint Bucket (on fill sample).
- Free Transform handle hit-zones and modifier behaviors.

## Implementation notes

- Each tool is a state machine handling pointer events against the scene/geometry engine.
- Tool option state persists per tool, restored on reselect (matches Flash).
- Customize Tools Panel maps to a configurable tool registry, enabling future custom tools.
