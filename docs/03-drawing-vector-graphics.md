# 03 — Drawing & Vector Graphics

> **Note:** The current implementation uses a single-fill-per-contour model (`ShapePath`).
> This is an intentional MVP simplification. The full planar map required for byte-faithful
> merge-drawing and SWF export uses per-edge `fill0`/`fill1` references. See
> `docs/03-planar-fill-decision.md` for the design, migration plan, and deferral decision.

Flash's vector engine and its two drawing models. This is the heart of authoring fidelity.

## Vector vs bitmap

Flash artwork is primarily **vector** (paths described by lines + quadratic Bézier curves,
filled and/or stroked). Bitmaps can be imported and used as fills or images (see `09`).

## Two drawing models

### Merge Drawing (default, classic)
Raw shapes on the **same layer** interact:

- Overlapping fills of the **same color** merge into one shape.
- Overlapping fills of **different colors** — the top shape **cuts away** what's beneath.
- A line drawn across a fill **segments** it.
- Strokes and fills are separate selectable entities.
This is Flash's signature (and famously surprising) behavior. It must be reproduced exactly.

### Object Drawing (new in Flash 8)
Shapes are created as self-contained **drawing objects** that do **not** merge or cut
overlapping geometry. Toggled by the **Object Drawing** option button in the toolbox or the
**J** key while a drawing tool is active. Object-drawing shapes have a bounding box and can
be edited in place; "Break Apart" returns them to merge-style raw shapes.

## Shape anatomy

- **Stroke (line)** — outline with color, width, style, caps, joins, scaling.
- **Fill** — interior: solid, linear gradient, radial gradient, or bitmap.
- **Anchor points & control points** — Bézier path editing (Pen / Subselection).
- **Corner vs curve points** — convertible via Subselection / Pen.

## Enhanced strokes (new/expanded in Flash 8)

Flash 8 added professional stroke controls (Property inspector):

- **Cap**: None, Round, Square.
- **Join**: Miter, Round, Bevel (with **miter limit**).
- **Scale**: Normal, Horizontal, Vertical, None (controls stroke scaling with the object).
- **Hinting** (stroke hinting) for crisp rendering.
- Stroke **styles**: Solid, Dashed, Dotted, Ragged, Stippled, Hatched (+ custom params).
- Stroke **weight** in fine increments; sub-pixel control.

These map to **`DefineShape4`** in SWF (which carries cap/join/miter + scaling-stroke flags).

## Drawing tools (geometry behavior)

(Full tool list, options, and shortcuts: see `04-toolbox.md`.)

- **Line, Oval, Rectangle** — primitive shapes; rectangle supports **corner radius**;
  Alt/Option-click sets exact dimensions/radius via dialog.
- **PolyStar** — polygons and stars; sides count and star point size in Property inspector.
- **Pencil** — freehand lines with modes: **Straighten**, **Smooth**, **Ink**.
- **Pen** — Bézier paths with explicit anchors; add/delete/convert points.
- **Brush** — fills painted as shapes; modes: Paint Normal, Paint Fills, Paint Behind,
  Paint Selection, Paint Inside; brush size/shape; **Pressure**/**Tilt** (tablet) options.
- **Eraser** — modes mirror brush; **Faucet** (delete whole fill/stroke); erase size/shape.

## Reshaping & modifying

- **Selection tool** drag on an edge/corner to bend/reshape segments (with Alt to add corner).
- **Subselection tool** edits anchor points and Bézier handles.
- **Modify > Shape**: Smooth, Straighten, Optimize (curve reduction), Convert Lines to Fills,
  Expand Fill, Soften Fill Edges.
- **Free Transform / envelope/distort** (see `04`) for scale/rotate/skew/distort/envelope.

## Snapping

- **Snap to Objects** (the magnet), **Snap to Pixels**, **Snap to Grid**, **Snap to Guides**,
  **Snap Align** (smart alignment guides with tolerances).
- Snap settings configurable in `View > Snapping > Edit Snapping`.

## Accuracy targets

- Merge-drawing union/cut/segment rules must be byte-faithful to Flash 8 outcomes.
- Object Drawing toggle (J) and its break-apart semantics must match.
- Stroke caps/joins/miter/scaling must render and export (`DefineShape4`) identically.
- Pencil Straighten/Smooth/Ink recognition behavior should approximate Flash's curve fitting.
- Rectangle corner radius (including negative/inverted radius behavior) must match.

## Implementation notes

- Maintain a **planar map / 2D boolean** engine for merge-drawing interactions (union,
  subtraction, edge splitting) computed at edit time.
- Paths stored as line/quadratic-Bézier edge lists (Flash's native curve type) to round-trip
  losslessly to SWF shape records.
- GPU tessellation for fills; analytic/SDF stroking for caps/joins; gradients/bitmaps as
  fill shaders (see `05`).
- Object-drawing shapes are lightweight shape containers in the scene graph.
