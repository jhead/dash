# Vector Merge Model — authentic Flash 8 merge-drawing

**Status:** P0 landed (curve-aware planar geometry kernel + oracle harness).
P1–P5 build on the kernel to wire merge mode into the tools, renderer, selection,
eraser, and SWF/FLA interchange.

**Supersedes:** [`docs/03-planar-fill-decision.md`](./03-planar-fill-decision.md)
(the 2026-06-09 decision to DEFER the planar model and ship the AABB
approximation through MVP). MVP is shipped; this document is the approved
re-architecture that decision pointed to.

**Companion docs:** [`docs/03-drawing-vector-graphics.md`](./03-drawing-vector-graphics.md)
(tools/behavior), [`docs/05-color-strokes-fills.md`](./05-color-strokes-fills.md)
(fills/strokes), [`docs/15-file-formats-fla-swf.md`](./15-file-formats-fla-swf.md)
(interchange).

---

## 1. The authentic Flash 8 vector model ("shape soup")

Flash 8's stage has **two** drawing modes, and they use **different geometry
models**:

### 1.1 Merge Drawing mode (the default — "shape soup")

In Merge mode, vector artwork on a single layer is NOT a collection of discrete
objects. It is a single **planar map of edges** — what the community calls "shape
soup." There are no shape "objects"; there are only edges, and each edge records
the fill on **each of its two sides** plus an optional stroke:

* **`fillStyle0` / `fillStyle1`** — the fill on the *left* and *right* of the
  directed edge (Flash's wire term; in the kernel: `fillLeft` / `fillRight`).
  This is the dual-fill-per-edge representation the SWF shape record uses
  natively (`StyleChangeRecord` carries `FillStyle0` + `FillStyle1`).
* **`lineStyle`** — the stroke style of the edge, or none.

From this edge soup, the renderer (and Flash) derive the filled **regions** by
tracing closed loops where one fill is consistent on the interior side. The
consequences are the behaviors that *define* Flash drawing:

| Interaction | Behavior | Why (edge model) |
|---|---|---|
| **Same-color overlap** | The two shapes **UNION** into one with no seam. | Both regions reference the same fill index; the shared internal edge has the same fill on both sides and disappears as a visible boundary. |
| **Different-color overlap** | The top shape **CUTS** the one beneath (last-drawn wins on the overlap). | The overlap region's edges are re-labeled to the new fill; the underlying fill loses that area. |
| **A line drawn across a fill** | **SPLITS** the fill into independently-selectable pieces. | The line inserts edges that subdivide the fill's region; each sub-region is its own traceable loop. |
| **Two crossing lines** | Become **four** segments meeting at the crossing. | The crossing point becomes a vertex; each line is split into two edges. |
| **Selecting** | You select **segments and faces**, not whole objects — double-click selects a connected fill+its strokes; a single click selects one edge or one face. | There are no objects to select, only the planar pieces. |
| **Erasing / overlap removal** | **TRUE subtraction** — erasing a band across a shape splits it; removing an overlapping island leaves a hole. | The boolean difference is expressed by re-labeling/removing edges and re-tracing faces. |

### 1.2 Object Drawing mode (the alternative)

Toggling **Object Drawing** (Flash 8 added the J-key toggle) makes each drawn
shape a discrete **Drawing Object** that does NOT merge with others on the layer
— it is a self-contained shape with its own bounding box, drawn on top, movable
as a unit. This is the `DrawingObject` display object in the dash model. Object
Drawing shapes still hold the same per-path geometry internally; they simply
don't participate in the layer's merge map.

### 1.3 Quadratic curves

Flash's only curve primitive is the **quadratic Bézier** (one control point),
matching the SWF `CurvedEdgeRecord`. The merge model must intersect and split
**curves**, not just lines, and it must do so **curve-preservingly** — a cut
quadratic stays two true quadratics, it is never flattened to a polyline (that
would visibly faceted-ize every curved silhouette and bloat the geometry).

---

## 2. The dash planar architecture

### 2.1 Two representations, one source of truth per mode

dash keeps **both** representations, used for different jobs:

* **`Shape` / `ShapePath`** (`engine/types.ts`) — the **per-path** model. Each
  path is a contour with at most one fill and one stroke. This is the
  `.fla`/SWF **interchange** format (it maps 1:1 to import/export and to SWF
  DefineShape) AND the **Object Drawing** format (a Drawing Object is exactly one
  `Shape`). **Unchanged by this work** — additive only.

* **`PlanarShape`** (a half-edge subdivision, also in `engine/types.ts`, added by
  P0) — the **merge-mode** geometry. This is the in-memory "shape soup": a DCEL
  of vertices + half-edges + faces, where each half-edge carries
  `fillLeft`/`fillRight`/`lineStyle` and each face carries its resolved fill.

The merge kernel converts between them: a layer's mergeable `Shape`s are built
into a `PlanarShape` arrangement to perform a merge/cut/split/erase, and the
result is read back as `Shape`s for the renderer / interchange when needed.

### 2.2 The kernel: `packages/core/src/engine/planar/`

A curve-aware half-edge planar subdivision (arrangement). Modules:

| File | Responsibility |
|---|---|
| `geometry.ts` | Twip snapping (`snapPoint`, `pointKey`), quadratic eval/tangent (`edgeAt`, `outgoingDirection`), and the **curve-preserving split** (`splitEdgeGeometry` / de Casteljau `splitQuad`), curve-aware bbox. |
| `intersect.ts` | The three intersection primitives — `intersectSegSeg` (analytic, incl. collinear-overlap), `intersectSegCurve` (quadratic root solve against the segment's line), `intersectCurveCurve` (recursive subdivision). All return **parameter pairs** `{tA, tB}` + the snapped point, so the arrangement can split each edge at the exact place while keeping the curve. `intersectEdges` dispatches on line vs curve. |
| `arrangement.ts` | `Arrangement` — the mutable DCEL builder. `insertEdge` splits the new edge AND every existing edge it crosses at all intersections (curve-preserving), merges coincident vertices (exact twip-key compare), builds the **rotation system** around each vertex (CCW angular order of outgoing half-edges), links `next`/`prev` into face cycles, and **extracts faces** with proper **hole nesting** (a CW boundary cycle inside a CCW face becomes that face's hole; disconnected islands attach correctly). `build()` returns an immutable `PlanarShape`. |
| `query.ts` | `locateFace` / `pointInFace` (point-in-face, smallest-containing wins), `faceArea` (shoelace, holes subtracted), `faceBoundaryPolygon` / `traceCycle`, `faceInteriorPoint`, `eulerCharacteristic`, and `Shape ↔ arrangement` conversions. |
| `build.ts` | High-level builders: `buildArrangementFromShapes` (intern + dedupe fill/line styles, insert all paths, then **resolve each face's fill by interior-point sampling against the source regions in draw order** — last/topmost wins, which realizes same-color union + different-color cut on the planar map), `buildArrangement` (raw edges), `pathToInputEdges` (orientation-normalize a fill path so the interior is on the LEFT). |

Public surface (re-exported from `@flash/core` `engine/index.ts`): the `planar`
namespace (to avoid the `snapPoint` clash with `engine/snap.ts`), plus the
`Arrangement` class and `buildArrangement*` builders, and the
`PlanarShape`/`HalfEdge`/`PlanarVertex`/`PlanarFace`/`EdgeGeometry` types.

### 2.3 Numerical stability — snap to TWIPS

Flash works in **twips** (1/20 px). The kernel snaps every coordinate
(endpoints, control points, and every computed intersection point) to the twip
grid. This is the single most important robustness decision and it follows the
hard-won lesson from `engine/eraser.ts`: snapping makes "should-be-shared" points
become **exactly** shared, so vertex merging is an exact integer-key compare
(`pointKey`) instead of a fragile epsilon dance. Genuine ties in the angular sort
are broken deterministically. (The eraser's Greiner–Hormann degeneracy-
perturbation technique remains the reference for the boolean ops P1+ will build on
top of the arrangement; the kernel's snap-first approach removes most of the
degeneracies that perturbation was patching.)

### 2.4 Why a half-edge map (not just polygon booleans)

The existing eraser does polygon Greiner–Hormann difference on **flattened**
polylines — fine for an eraser stamp, but it cannot express the merge model's
defining features: per-edge dual fills, segment selection, line-splits-fill, and
curve preservation. A half-edge arrangement makes the **regions and their
adjacency explicit**, which is exactly what every merge interaction queries:
"which face did I click", "what are the four segments at this crossing", "what
faces does this fill now occupy after the cut".

---

## 3. Phased plan (P0–P5)

| Phase | Scope | Status |
|---|---|---|
| **P0** | The curve-aware planar geometry kernel (`engine/planar/`): intersection (seg/seg, seg/curve, curve/curve), arrangement construction (insert edge + split existing + new at all crossings), face extraction with hole nesting, point-in-face, curve-preserving split. Additive `PlanarShape`/half-edge types in `engine/types.ts`. Kernel unit tests (Euler invariant, area conservation, intersection counts, curve round-trip). The interaction-oracle harness (`apps/desktop/e2e/merge-drawing-oracle.spec.ts`) as `.fixme` placeholders for the canonical cases. **No user-facing behavior change.** | **DONE (this task, 1318).** |
| **P1** | **Merge-mode geometry ops on the kernel:** `mergeDraw` / cut / union / line-splits-fill implemented as arrangement operations (replacing the AABB approximation in `engine/merge-drawing.ts`), returning `Shape`s for the renderer. Same-color union + different-color cut become exact. | Planned. |
| **P2** | **Renderer + selection** read the planar map: render faces by traced loops with winding-correct fills; selection model selects **segments and faces** (single-click edge/face, double-click connected fill+strokes), matching Flash. | Planned. |
| **P3** | **Curve-preserving eraser & true subtraction** routed through the kernel: erase-across-shape splits curve-preservingly; removing an overlapping island leaves a hole. Replaces the polyline-flatten path in `engine/eraser.ts` for fills. | Planned. |
| **P4** | **Interchange:** enable SWF `FillStyle1` export of the planar map (`packages/swf/src/shapes.ts` currently hard-codes `stateFillStyle1=0`); FLA import/export of merge-map geometry; shape-morph (`tween/interpolate.ts`) matched on the planar topology. | Planned. |
| **P5** | **Full selection authenticity + polish:** marquee/lasso over the planar pieces, edit-curve handles on faces, snapping against the arrangement, and turning the P0 oracle placeholders into passing Ruffle+stage specs. | Planned. |

### 3.1 Key decisions

1. **Curve-preserving.** Cuts subdivide quadratics with de Casteljau and keep
   true quadratics on both halves. No polyline flattening of the visible
   geometry. (Flattening is used only for cheap containment/area sampling, never
   written back.)
2. **Full selection authenticity.** The selection model targets the planar
   pieces (segments + faces), not whole objects — the genuine Flash behavior — so
   "two crossing lines = four segments" and "click a fill half and move it" work.
3. **Twip-snap-first stability.** Snap everything to the twip grid; exact vertex
   merge; deterministic tie-breaking.
4. **Both representations retained.** `Shape`/`ShapePath` stays as the
   `.fla`/SWF interchange + Object-Drawing form; `PlanarShape` is the merge-mode
   form. The kernel converts between them.
5. **Additive, no behavior change in P0.** P0 only adds types + the kernel + test
   harness; golden-parity and self-determinism are unchanged because nothing in
   the publish/import path is touched yet.

---

## 4. Verification approach

Two layers, matching the project's standard (AGENTS.md: visual-oracle acceptance
is the truth; unit tests are necessary but not sufficient).

### 4.1 Kernel unit tests (P0, landed)

`packages/core/src/engine/__tests__/planar.test.ts`:

* **Intersection counts** — X of two segments = 1 crossing; line through an arc =
  2; opposing arcs = ≥2; collinear overlap reports the overlap endpoints;
  argument-order-independent dispatch.
* **Euler invariant** `V − E + F` — a square = 2; two crossing lines (8
  half-edges) = 2; overlapping shapes (connected) = 2.
* **Shoelace AREA conservation** — same-color union area = `A + B − overlap`;
  different-color cut conserves total covered area and yields both colors; a line
  across a fill produces two faces summing to the whole; a curve cut by a chord
  conserves area; an island carves the outer fill (`outer − island`).
* **Curve preservation** — a quadratic split at t re-fits the original within
  epsilon (round-trip sampling); a curve cut by a line keeps quadratic geometry
  on both pieces (never degenerates to a chord).
* **Point-in-face** — `locateFace` finds the correct (smallest-containing) face;
  returns null outside; an island is located inside the outer fill.

### 4.2 Interaction oracles (the canonical cases)

`apps/desktop/e2e/merge-drawing-oracle.spec.ts` — `.fixme` placeholders in P0,
filled in by P1–P5. Each case is verified with the project's two-oracle stack:
the **stage-canvas** screenshot (`window.__flashTest.screenshotStage()`) for the
authored result, and the **Ruffle pixel** screenshot of the published SWF
(`window.__flashTest.publish()` → bundled Ruffle), pixelmatched against each
other. The six canonical cases:

1. **red-over-blue cut** — the red overlap carves the blue (different-color cut).
2. **blue-over-blue union** — two overlapping blues merge into one shape.
3. **line across fill, then move half** — the line splits the fill; only the
   selected half moves.
4. **two crossing lines = 4 segments** — four independently-selectable arms.
5. **erase across shape splits** — true subtraction splits the fill in two.
6. **partial fill click + move leaves a hole** — moving a carved island leaves
   the hole it had cut in the outer fill.

### 4.3 Regression guards (unchanged in P0)

`golden-parity` + self-determinism must stay byte-identical through P0 (no
doc/SWF change), and the core suite stays green except the ~3 pre-existing
task-1207 fixtures that need `fixtures/flash8-empty.fla`.
