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
  - **Distort** (`Dst`) and **Envelope** (`Env`) are non-affine *mesh warps* that replace
    the object's affine box with a four-sided mesh you drag directly. Distort gives 4 free
    corner handles (the rectangle maps to an arbitrary quadrilateral, bilinearly
    interpolated inside — drag one corner for a perspective-style skew). Envelope adds two
    cubic-Bézier control points per edge (8 total), bending each edge into a curve; the
    interior is a Coons patch (an untouched envelope is geometrically identical to distort).
    Dragging a corner in envelope mode carries its two adjacent edge controls so the
    tangents follow. The warp is stored on the display object as a `ShapeWarp`
    (`mode`, `origBounds`, `corners`, optional `edges`) and **supersedes** the affine
    scale/rotation/skew when present.
  - **Implementation**: the warp math lives in `@flash/core` `engine/warp.ts`
    (`identityWarp`, `pointToUV`, `bilinear`, `coons`, `evalWarp`, `warpPoint`, `warpShape`)
    and is unit-tested in `engine/__tests__/warp.test.ts`. The stage renderer
    (`engine/renderer.ts`) warps a shape's geometry into stage space and draws it directly
    when `obj.warp` is set. The authoring-ui `StageArea` hit-tests the mesh control points,
    drives the drag, draws the warped mesh frame + handles, and persists the result via
    `onShapeWarp` → `updateDisplayObject({ warp })`.
  - **Publishing (SWF)**: a PlaceObject2/3 matrix is affine and cannot carry a non-affine
    distort/envelope, so — exactly like real Flash 8 — the warp is **baked into the
    DefineShape edge coordinates** at publish time. The SWF character pass
    (`packages/swf/src/compiler/characters.ts` `bakeWarpIntoShape`) reuses the SAME
    `engine/warp.ts` `warpShape` mapping the stage uses, then translates the warped
    absolute geometry back by the placement offset so the DefineShape stays origin-relative
    and PlaceObject2 tx/ty carries the offset (the shape-origin-normalization rule). This
    covers both `ShapeDisplayObject` and `DrawingObject`, and shape-tween (morph) start/end
    keyframes. Without this the published movie showed the pristine un-distorted shape (the
    fidelity gap fixed by task 1228). Curves are subdivided to chords by `warpShape`; the
    envelope Coons patch is sampled per vertex. Gate: `packages/swf/src/__tests__/warp-bake.test.ts`
    (compiles a warped shape and decodes the emitted DefineShape4 ShapeBounds to confirm the
    warp is in the geometry).
  - **Warp supersedes affine (no double transform, task 1230)**: the baked warp geometry is
    in ABSOLUTE stage space, so it already encodes the full scale/rotation/skew effect (the
    warp corners are captured from the already scaled/rotated AABB). The frame loop
    (`packages/swf/src/compiler/frames.ts`) therefore emits an **identity** PlaceObject2
    matrix (translate-only) for a warped shape — re-applying `scaleX/scaleY/rotation` on top
    would transform it twice. This matches the editor renderer, which ignores affine entirely
    when `obj.warp` is set (`engine/renderer.ts`). Both the first-placement and the move emit
    branches gate on `obj.warp`. Pure-warp (identity affine) and pure-affine (no warp) shapes
    are unchanged. Gate: `packages/swf/src/__tests__/warp-affine-double-transform.test.ts`
    (decodes the PlaceObject2 MATRIX from our own SWF: warp+scaleX=2 / warp+rotation=30 are
    translate-only with un-doubled bounds; pure-affine still carries the scale/rotation).
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
- **Brush paint modes** (honored on commit, task 1421): Paint Normal, Paint Fills, Paint
  Behind, Paint Selection, Paint Inside. The stroke ribbon is clipped to a region derived
  from the existing layer art before it merges — Fills = only over existing solid fills,
  Behind = only over empty space, Selection = only within the current selection, Inside =
  locked to the fill (or empty region) the stroke STARTED in. Realized on the planar face
  model in `@flash/core` `engine/planar/brushpaint.ts` (`clipBrushStroke`); wired at commit
  by `commitBrushStrokeToTimeline` (`model/timeline.ts`). A mode that masks the whole stroke
  away (e.g. Paint Fills over empty canvas) commits nothing.
- **Brush tablet Pressure / Tilt** (task 1421): when enabled, pointer pressure scales the nib
  width along the stroke (light touch = thin, full press = the set size, floored at 15% so a
  stroke is never invisible) and tilt widens the nib modestly. Captured from the PointerEvent
  in `StageArea` (`pointerPressureTilt` → `brushHalfAt`); a mouse reports full pressure / no
  tilt, so the toggles only affect pen/touch input.
- **Eraser modes**: Erase Normal, Erase Fills, Erase Lines, Erase Selected Fills, Erase Inside.
  **Faucet** deletes an entire fill or stroke in one click. Double-click eraser = clear stage.
- **Erase Selected Fills restricts to the current selection (task 1428).** The mode's engine
  (`planar/eraser.ts`, mode `"selected"`) skips every face unless the caller supplies a
  `selectedFaceFilter` predicate. That predicate is now built from the live selection by the
  shared `resolveSelectedFaceFilter` (`authoring-ui/src/eraserSelection.ts`) and threaded
  into `planarEraseShape` by BOTH the interactive `StageArea` erase path and the
  `Shell.handleEraseOnLayer` agent/oracle bridge: a WHOLE-object selection makes every fill
  in that object erasable; a partial planar sub-selection makes only its selected face
  regions erasable (selected strokes never select a fill); an object with nothing selected
  is a no-op. So with nothing selected the mode erases nothing, matching Flash 8 (previously
  neither caller passed the predicate, so the shipped button was a silent no-op).
- **Erase Inside stays locked to the region the gesture STARTED in (task 1427).** Flash 8's
  Erase Inside erases only the fill under the pointer at pointerdown, stopping at its boundary
  for the whole drag (starting on empty erases nothing). The interactive `StageArea` eraser
  captures that anchor point ONCE at pointerdown (`eraserGestureStartRef`) and passes it as
  `planarEraseShape`'s `insideAt` for EVERY pointermove increment. Previously it passed
  `sweptStage[0]` — the previous cursor sample of the current increment — so the lock drifted
  with the cursor and, once the drag crossed into a neighboring fill, began erasing that fill.
  The engine already confines correctly given the true gesture start (`connectedFillComponent`,
  task 1399); only the UI wiring fed it the wrong point.
- **Paint Bucket Gap Size** lets fills close small gaps in outlines; **Lock Fill** continues a
  gradient/bitmap across multiple shapes.
- **Paint Bucket / Eyedropper hit the actual region under the cursor, not the bbox
  (task 1389).** The `StageArea` Paint Bucket ("fill") handler picks the planar face under
  the click via `bucketFillRegion` (`authoring-ui/src/tools/fillSample.ts`, over the
  `livePlanarShape`/`buildArrangementFromShapes` merge map) and recolors ONLY that
  enclosed region's connected component (stroked seams bound the region; No Color removes
  just that region's fill). Clicking an empty part of a shape's bbox is now a no-op instead
  of repainting the whole object; a different enclosed region of the same object recolors
  independently. Non-mergeable shapes (gradient/bitmap fill, transformed) fall back to a
  real point-in-geometry hit test (`hitTestPoint`) and fill all paths. The Eyedropper
  reports WHICH attribute — fill vs stroke — was under the click (`sampleAttributeAt` via
  planar `pickAt`), and `Shell.handleEyedropperSample` auto-switches to Paint Bucket (fill)
  or Ink Bottle (stroke) on that, not merely on whether the shape has a fill.
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

The contextual Options blocks live in `ToolsPanel.tsx`; each option is a `ToolState` slice
(`tools/types.ts`) seeded in `DEFAULT_TOOL_STATE` (`store/uiStore.ts`) and mutated by a
`useToolHandlers` callback (Shell threads them into `ToolsPanel`). Wiring status (task 1388,
building on the eraser modes + Faucet of task 1387):

- **Selection** — magnet toggles the document's `snapToObjects` property (the same property
  the View › Snap to Objects command flips, honored by `StageArea` object snapping);
  `snapToObjects` now **defaults ON** (`createDocumentProperties`, matching Flash 8). Smooth /
  Straighten reshape the selected raw shape via `smoothPath` / `simplifyPath`
  (`tools/selectionSmooth.ts`).
- **Rectangle** — the numeric **corner radius** is honored on commit
  (`createRoundedRectShape`); 0 = square corners. **Alt-clicking** the stage with the
  Rectangle (or Oval) tool opens an **exact-dimensions dialog** (width / height, plus
  corner radius for the Rectangle) instead of starting a drag; on OK the shape is created
  at the click point at the entered size (task 1422, `StageArea` `exactSizeDialog`).
- **Brush** — nib **shape** (round/square) is honored in the brush commit
  (`brushPointsToShape`). **Paint mode** (Normal/Fills/Behind/Selection/Inside) is honored on
  commit via `clipBrushStroke` + `commitBrushStrokeToTimeline` (task 1421); **Pressure** and
  **Tilt** vary the nib width from the tablet PointerEvent (task 1421). **Lock Fill** (continue
  a gradient/bitmap across strokes) is exposed and persisted; its honoring remains a follow-up.
- **Paint Bucket** — **Gap Size** (Don't/Small/Medium/Large) and **Lock Fill** are now honored
  by the fill path (task 1422, building on task 1389's region fill):
  - **Gap Size** maps to a pixel tolerance (`gapSizeToPx` — small 4 / medium 8 / large 16 px,
    zoom-adjusted). When a click lands in no enclosed region, `bucketFillRegion` bridges the
    outline's nearby open endpoints (invisible fill-only boundary edges, `gapBridges`) and
    retries, so a fill closes small breaks in an outline before flooding. `none` = never bridge.
  - **Lock Fill** stamps a gradient with an explicit `matrix` anchored to a FIXED reference
    rect (the first region filled while locked, held in `StageArea` `lockedFillRectRef`), via
    `lockGradientToRect`, so consecutive locked fills share one gradient frame and read as a
    single continuous fill. When off, each fill auto-fits its own region. Solid fills are
    unaffected; bitmap-fill continuity remains a follow-up.
- **Pen** — the sub-tool selector (Pen / Add Anchor `=` / Delete Anchor `-` / Convert Anchor
  `C`, keys bound while the Pen tool is active) sets `penSubTool`, and the editing behaviors are
  now honored (task 1422, `tools/penEdit.ts` wired in `StageArea`): with a sub-tool active a
  click on an existing shape **adds** an anchor by splitting the nearest segment (de Casteljau
  for curves), **deletes** the nearest anchor and rejoins its neighbors, or **converts** the
  nearest anchor between corner (straight) and smooth (curved) — instead of drawing a new path.

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
