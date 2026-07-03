# Vector Merge Model — authentic Flash 8 merge-drawing

**Status: SHIPPED as the DEFAULT vector model (P5 cutover, task 1323).** Merge
drawing is now the default behavior of every shape tool — there is NO feature flag.
Two overlapping same-color shapes union; different colors cut top-wins; a line
across a fill splits it; an eraser truly subtracts; clicking with the selection tool
picks a fill face / line segment and dragging it splits it off. Object Drawing mode
(`type:"drawing-object"`) remains the discrete-object alternative and is unchanged.

P0 + P1 + P2 + P3-selection + P4-eraser are all landed and on by default. P0 =
curve-aware planar geometry kernel + oracle harness. **P1 (task 1319) =
merge-on-commit** (same-color UNION / different-color CUT, top-wins,
curve-preserving). **P2 (task 1320) = strokes/lines split fills + intersecting
lines segment each other** (a line drawn across a fill splits it into separate
selectable faces; two crossing lines split each other into four segments;
curve-preserving). **P3-selection (task 1321) = partial fill-region + line-segment
selection + split-on-move** (click selects ONE face or segment, double-click the
connected set, marquee picks all intersecting; moving a partial selection EXTRACTS
it and leaves a hole/cut behind — all on the LIVE planar map). **P4-eraser (task
1322) = curve-preserving eraser on the planar mesh + Flash 8 eraser modes** — the
eraser stroke (disk + capsule stamp) is subtracted from the layer arrangement:
faces inside the erased region lose their fill (a band erased clean through SPLITS a
fill into two; an erased interior island leaves a hole) and stroke half-edges are
TRIMMED/SPLIT at the eraser boundary — all CURVE-PRESERVING via the P0 kernel splits
(de Casteljau, never polyline flattening). Modes: Normal / Erase Fills / Erase Lines
/ Erase Selected / Erase Inside, plus the Faucet whole-fill/line click.

**P5 cutover (task 1323).** The `planarMergeOnCommit` feature flag was removed and
merge made unconditional for `type:"shape"` commits (`Shell.tsx handleShapeCreated`
/ `commitMergeShapeDirect`); partial face/segment selection is active whenever the
selection tool is active; the planar eraser is selected purely by geometry (a merged
mergeable shape at identity transform / origin), with the legacy per-object
curve-FLATTENING eraser (`engine/eraser.ts`) kept ONLY for Object Drawing shapes,
non-identity transforms, and gradient/bitmap fills (which never enter the merge map).
The dead MVP modules `engine/merge-drawing.ts` (AABB merge approximation) and the
no-op `engine/shape-boolean.ts` stub were deleted, along with the `featureFlags.ts`
module (it held only this one flag). See §3.0d for the cutover notes, the
planar↔per-path interchange confirmation, and the known limitations / follow-ups.

> **Note on phase numbering.** The §3 phased plan below listed the curve-preserving
> **eraser** as "P3"; the task backlog filed the **selection** milestone (task 1321)
> as "Vector P3" and the **eraser** milestone (task 1322) as "Vector P4". This doc
> uses *P3-selection* (task 1321) and *P4-eraser* (task 1322, §3.0c) — both build
> directly on the kernel. The eraser is now LANDED.

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
| **A fill drawn OVER a line** | **CONSUMES** the covered run of the line (the line disappears where the fill covers it; uncovered ends remain). | The fill drawn later replaces what is beneath it, strokes included — this is why the Brush's Paint Fills / Behind / Inside modes exist, to leave lines alone. See §3.0l. |
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
| `build.ts` | High-level builders: `buildArrangementFromShapes` (intern + dedupe fill/line styles, insert all paths, then **resolve each face's fill by interior-point sampling against the source regions, GROUPED by (source shape, Fill object identity) with EVEN-ODD parity WITHIN a group and last/topmost group wins ACROSS groups** — realizes same-color union + different-color cut, AND keeps interior holes empty across rebuilds; see the winding-aware note below), `buildArrangement` (raw edges), `pathToInputEdges` (orientation-normalize a fill path so the interior is on the LEFT). |

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

**Snapping is not sufficient on its own — the crossing point must be SHARED, not
recomputed per edge (task 1332).** When two edges cross, `insertEdge` splits BOTH
of them at the crossing. The intersector returns one snapped `point`, but the old
code threw that point away and split each edge independently by re-evaluating its
*own* geometry at its *own* parameter (`edgeAt(geom, t)`) and re-snapping. Two
re-evaluations of the same crossing — once along edge A's parameterization, once
along edge B's — can land in **adjacent** twip cells (e.g. an angled eraser-capsule
edge crossing a band's top edge produced `(102.65, 95)` on one side and
`(102.70, 95)` on the other, 1 twip apart). The two "should-be-shared" vertices
then did **not** merge, the half-edge rotation ring at the crossing was malformed,
and the far region failed to close into a bounded face — it leaked into the
unbounded face, so one whole side of an angled cut **vanished** (the QA-filed
"erase across a brush line deletes the right half" bug). Fix: thread the
authoritative snapped intersection `point` through the split (`Split = { t, point }`)
and **pin** each interior split vertex to that exact point in `chopEdge`/`splitLocal`
(control points are still de Casteljau, only the shared endpoint is forced). Now the
same crossing produces the *identical* vertex coordinate on every edge through it, so
it merges by exact integer key regardless of which parameterization computed it.
Gate: `planar-eraser.test.ts` "angled cut splits a band into two surviving sides".

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
| **P1** | **Merge-mode geometry ops on the kernel:** cut / union implemented as arrangement operations (`engine/planar/merge.ts` + `planarShapeToShape` in `query.ts`), returning per-path `Shape`s for storage/render/SWF. Same-color union + different-color cut are exact, curve-preserving. Wired into `Shell.tsx handleShapeCreated` / `commitMergeShapeDirect` behind the `planarMergeOnCommit` flag (default OFF). Acceptance: `merge-drawing-oracle.spec.ts` cut + union cases (stage↔Ruffle pixelmatch diff=0). | **DONE (task 1319).** |
| **P2** | **Strokes/lines split fills + intersecting lines segment each other** (task 1320): adding a STROKE edge across a fill SPLITS the fill into separate selectable faces along the line; two crossing lines SPLIT each other into segments at the crossing (curve-preserving). Wired through the existing P1 fold path — line/pencil/pen + stroke commits are `type:"shape"` and already route through `planarMergeCommit` under the flag. The read-back (`planarShapeToShape`) now treats a stroked same-fill seam as a real boundary (only **un-stroked** same-fill seams dissolve), so a line-split fill reads back as two distinct fill loops + the segmented line and an X of two lines reads back as four segments. Acceptance: `merge-drawing-oracle.spec.ts` cases 3 (line-splits-fill) + 4 (4 segments) — stage↔Ruffle pixelmatch diff=0. (Full segment/face *selection* — single-click edge/face, double-click connected fill+strokes — and the live-map dissolve remain P3+.) | **DONE (task 1320).** |
| **P3-selection** | **Partial fill-region + line-segment selection + split-on-move**, with a **live drag preview** during the move (tasks 1321, 1331). See §3.0b. | **DONE (tasks 1321, 1331).** |
| **P4-eraser** | **Curve-preserving eraser & true subtraction** routed through the kernel (`engine/planar/eraser.ts`): erase-across-shape splits curve-preservingly; removing an overlapping island leaves a hole; strokes are trimmed/split at the eraser boundary keeping quadratics. Flash 8 eraser MODES (Normal / Erase Fills / Erase Lines / Erase Selected / Erase Inside) + faucet whole-fill/line click. The legacy polyline-flatten `engine/eraser.ts` stays for the flag-OFF / drawing-object path. See §3.0c. | **DONE (task 1322).** |
| **P5 (cutover)** | **Cutover to merge-by-default + cleanup + final authenticity sweep** (task 1323). Remove the `planarMergeOnCommit` flag; merge unconditional for `type:"shape"` commits; delete the dead MVP `merge-drawing.ts` + the no-op `shape-boolean.ts` stub + the now-empty `featureFlags.ts`. Adapt the tests that assumed the old per-object behavior to the authentic merge outcome. Confirm all 8 oracles diff=0, Object Drawing still discrete, FLA/SWF round-trip + golden-parity + self-determinism unaffected, and the planar↔per-path interchange is sufficient. See §3.0d. | **DONE (task 1323).** |
| **P5+ (interchange optimization, NOT a blocker)** | SWF `FillStyle1` export of the planar map (`packages/swf/src/shapes.ts` hard-codes `stateFillStyle1=0`) — an edge-record-count *optimization* (closer byte-match to Flash), NOT a correctness need: the per-path read-back already round-trips to SWF at diff=0 (see §3.0d). FLA merge-map persistence and planar-topology shape-morph likewise remain future enhancements, not regressions. | Optional follow-up. |
| **P5+ (selection polish)** | **Full selection authenticity + polish:** lasso over the planar pieces, edit-curve handles on faces, snapping against the arrangement. | Optional follow-up. |
| **Perf follow-up (task 1327)** | Incremental fold — avoid rebuilding the entire layer arrangement per stroke on dense art (traced bitmaps with 1000+ fills). Measured ~35/61/176 ms per stroke for 100/400/800 mergeable fills. Resolved via **spatial bbox-culling**: only the **transitive overlap closure** of the new stroke is folded through the kernel; shapes disjoint from the whole interacting cluster stay untouched. Per-stroke fold on a 1000-fill layer dropped ~239 ms → ~2 ms. See §3.0e. | **DONE (task 1327; correctness fixed by task 1329).** |
| **Stroked-curve centre-pick (task 1334)** | A STROKED ellipse/oval (and any uniformly-stroked **curved** fill) could not be picked/dragged at its interior: re-building the live planar map from the committed shape shattered the interior into tiny faces (or none) so `pickAt` at the centre returned null, while a stroke-free oval picked fine. Root cause was a **coincident-curve** explosion: read-back emitted the stroked fill boundary as ~12 separate single-segment stroke fragments (+ sub-twip stubs); on rebuild the fill loop and those fragments are the SAME geometry split at different points, and `intersectCurveCurve` had NO coincidence handling — it flooded the arrangement with spurious crossings (~14.6k half-edges) so face tracing collapsed. Fixed at three layers (all curve-preserving). See §3.0h. | **DONE (task 1334).** |
| **Stroke-under-fill consumption (task 1430)** | The fold never consumed strokes under a new fill: brushing Paint Normal (or committing any plain fill) over a pencil line left 100% of the covered line rendering on top. Real Flash 8 replaces the portion of a line a later fill covers. Fixed by threading a **draw-order index** onto stroke half-edges and clearing the `lineStyle` of any stroke whose midpoint is covered by a fill drawn STRICTLY LATER (the arrangement has already split the stroke at the fill boundary, so uncovered spans keep their stroke). Draw-order strictness keeps P2 line-splits-fill intact (a line drawn over a fill has the higher order and survives). See §3.0l. | **DONE (task 1430).** |

### 3.0 P1 implementation notes (task 1319)

**Merge-on-commit flow.** When `planarMergeOnCommit` is ON, committing a
`type:"shape"` display object (`Shell.tsx handleShapeCreated`; the
`__flashTest.commitMergeShape` bridge uses the same fold via
`commitMergeShapeDirect`) folds the new shape into the active layer's existing
merge-mode shapes:

1. `engine/planar/merge.ts planarMergeCommit` partitions the layer's display
   objects into **mergeable** (`type:"shape"` with only solid fills/strokes) and
   **pass-through** (drawing-objects, gradient/bitmap fills — untouched).
2. `foldShapeIntoLayer` bakes each contributor's `(x,y)` offset into stage-space
   geometry, draw-order oldest→newest with the **incoming shape last** (topmost),
   and calls the P0 `buildArrangementFromShapes` → one `PlanarShape`.
3. `planarShapeToShape` (in `query.ts`) reads the planar map back to a single
   per-path `Shape` placed at `(0,0)` — the interchange/Object-Drawing/SWF form.
4. The keyframe's display-object list is replaced atomically via the new
   `setKeyframeDisplayObjects` model mutation (pass-through objects first, the
   merged artwork on top).

Reads use the **live store present** (`withTimelineLive`), so back-to-back commits
accumulate (the stale React-closure timeline would fold the 2nd shape against an
empty layer — CLAUDE.md "MCP agent stale-closure bug").

**Planar ↔ per-path read-back (`planarShapeToShape`).** Same-color UNION is
realized at read-back by tracing the **boundary** of each same-fill region — a
half-edge whose left face has fill F and whose twin's face does NOT — chaining
those boundary half-edges into loops while hopping across interior same-fill seams.
Two overlapping same-color rects therefore emit ONE closed loop (the union
silhouette), not per-face loops. Different-color CUT and ISLANDS fall out for free:
the topmost fill wins each face (P0's interior-point sampling), and a face's holes
are emitted as additional loops sharing the **same `Fill` object reference** so the
renderer's non-zero-winding batching (engine/renderer.ts) cuts the hole. Curves are
preserved (quadratic controls survive the trace).

**Fill sampling is WINDING/PARITY aware — interior holes survive rebuild (task
1425).** The read-back above emits an interior hole as a SEPARATE closed loop that
CARRIES the outer fill and SHARES its `Fill` OBJECT reference. `assignFaceFillsBySampling`
used to be plain last-covering-wins per loop: on ANY rebuild (`buildArrangementFromShapes`
/ `livePlanarShape` / the interactive eraser, which chains a rebuild per pointermove)
the outer silhouette re-covered the hole centroid and the hole self-reverted to the
fill — an erased interior hole would refill, only the last eraser stamp staying erased.
The fix groups a shape's loops by **(source shape, `Fill` object identity)** and tests
membership by **even-odd parity across the group**: a point enclosed by an outer loop
AND its hole loop toggles OUT (even enclosure count = no fill), exactly mirroring the
renderer's non-zero-winding hole cut. The **last covering GROUP** (topmost in draw
order) still wins, so same-color union / different-color cut / islands are unchanged.
Authored shapes carry a **distinct `Fill` object per path**, so each is its own
single-loop group (parity == plain containment) — the grouping is the very distinction
that separates a genuine hole (shared-reference loops) from two overlapping same-color
authored fills (distinct references, which must UNION, not parity-cancel). Gates:
`planar.test.ts` "interior holes survive rebuild" (winding-count proof + read-back
idempotence + no-regression union/island) and `planar-eraser.test.ts` "interior holes
persist across rebuilds" (chained interactive erase, erase-then-overlapping-commit,
picking).

**Fill classification is EXACT against the true curves — no more inscribed-chord
sagitta band (task 1435).** Region membership used to flatten every fill loop to an
INSCRIBED 6-chord polygon (`chordPolygon`) and test `pointInPolygon` against it, and
`faceInteriorPoint` accepted candidates against a 16-sample flattened face boundary.
For CURVED boundaries both leave a sagitta band (up to ~0.12px per nib-size
quarter-arc) between the true arc and its chords that reads as the WRONG side; since
classification samples ONE representative point per face, a point landing in that
band flipped the fill of the ENTIRE face — a 2-sample round-brush dab classified its
124px² crescent `fill=null` (~98px² visibly unpainted), and dense round-brush strokes
cracked. Straight-edge inputs were immune (a chord IS the segment), which is why the
square nib was flawless on identical strokes. Now: `fillRegions` carry their true
`EdgeGeometry` loops and `assignFaceFillsBySampling` / `consumeStrokesUnderFills`
test membership with **`pointInEdgeLoop`** (query.ts) — exact even-odd via closed-form
ray/quadratic intersection (each quadratic split at its y-extremum into y-monotone
pieces; same strict half-open endpoint convention as `pointInPolygon`), and
`faceInteriorPoint` accepts candidates against the TRUE traced face boundary
(`traceCycleGeometries` + `pointInEdgeLoop`), so the returned point is provably
interior to the actual curved face. When the arrangement is valid every face lies
wholly inside or outside each source region, so the exact test makes the
single-point-per-face design sound. **Straight-edge inputs classify byte-identically**:
the line branch of `pointInEdgeLoop` is arithmetic-identical to `pointInPolygon`,
and candidate generation (centroid/grid/diagonals over the flattened poly) is
untouched. (`locateFace`/`pointInFace` keep their 16-sample flattening: their band
is ~0.015px, they test the CALLER's own point rather than amplifying one sample to
a whole face, and picking is cursor-driven — not worth the churn.) Gates:
`planar-curved-fill-1435.test.ts` (dab-crescent raster repro → zero unpainted;
parity of every face against an independent fine-sampled true-curve oracle;
straight-edge invariance vs a verbatim replica of the old chord classifier).

**Kernel robustness for dense curved stamp chains (task 1435, three co-fixes).**
The dense-loop round-brush repro exposed three stacked kernel defects beyond
classification, each with a minimal-disk repro pinned in
`planar-curved-fill-1435.test.ts` ("kernel topology micro-repros"):
(1) **Shallow-transversal / lens cluster resolution (`intersect.ts`).** A shallow
(but non-tangent) curve/curve crossing — e.g. two stamped disks 2.33px apart whose
boundaries cross at 23° — smeared into 6–7 twip-distinct subdivision points that
`dedupe` (SNAP_EPS) kept, shattering the arrangement (two plain overlapping disks →
Euler −1); conversely at near-tangent spacing (d ≈ 2r) the task-1336 parallel-tangent
pin collapsed a genuine two-crossing LENS into ONE point, dropping a real crossing.
`collapseTangentClusters` now resolves every spatially-spread cluster by a signed
side-of-B scan along A (sign flips exactly at true crossings; each flip bisected to
machine precision and validated to lie ON both curves, so clamped-endpoint
tangent-line artifacts are rejected): one flip → one refined crossing, two flips →
both lens crossings, no flip → pin the closest approach ONLY if the curves genuinely
meet within SNAP_EPS (a phantom graze that never comes within a twip now reports NO
intersection, where it used to split an edge one twip off a real crossing).
(2) **Split-point canonicalization (`arrangement.ts insertEdge`, hot-pixel style).**
Crossings reported by DIFFERENT edge pairs can snap into ADJACENT twip cells (one
new arc crossing two nearly-parallel earlier arcs), minting vertices 1 twip apart
joined by degenerate curve stubs whose near-identical tangents corrupt the
rotation-ring order (three stacked disks → Euler −2, whole regions un-locatable).
Before registering, a split point is now pulled onto an existing vertex or an
earlier split point of the same insert lying within one twip (Chebyshev), bounding
the displacement by √2 twips while keeping the task-1332 shared-point pin. Genuine
distinct crossings are ≥ 2 twips apart and never coalesce.
(3) **Twin-sharing hole guard (`arrangement.ts build` Phase B).** Floating-point
shoelace asymmetry (forward vs reverse summation on non-integer twip coords) can
make |CW area| < |CCW area| by ~1e-13, defeating the strictly-larger containment
test — a face could then swallow the REVERSE traversal of its own outer boundary as
a "hole", collapsing `faceArea` to 0 and silently dropping the fill (observed on a
plain 5-vertex eraser-split remainder). A CW cycle sharing an undirected edge with
a CCW cycle can never be its hole (the shared edge would be an interior antenna,
which lives in a single cycle), so such candidates are excluded outright.
With all four fixes (classification + 1–3), the dense self-overlap loop repro
rasters crack-free for the capsule ribbon at half 8 and for disk-only stamp chains
at half 8 and 4. **Known residual (task 1434's charter, brushpaint.ts):** the
capsule ribbon at half 4 still cracks (~81 grid points) because the capsule corner
vertices are not vertices of the (squircle) disk stamp boundary — the tangent-seam
geometry defect; 1434's tangent-vertex stamp construction owns that gate.

**Kernel gap fixed for P1 (coincident edges).** P0's `Arrangement.addTwinPair`
created a NEW half-edge pair even when a geometrically coincident undirected edge
already existed — so two axis-aligned overlapping rects (whose top/bottom edges are
**collinear and overlapping**) produced duplicate edges that broke face tracing
(the union measured 10000 instead of 15000). P1 added
`findCoincidentHalfEdge` + a merge in `addTwinPair`: a coincident a→b edge folds
its fill/line labels into the existing edge instead of duplicating. This is the one
P0 robustness gap merge needs; the P0 planar.test.ts suite still passes unchanged.

**Gaps left for P2–P5.** (a) ~~The dissolve is done at read-back, not in the live
`PlanarShape` — segment/face *selection* (P3) needs the dissolved single face in
the map itself.~~ **RESOLVED in P3-selection (task 1321)** — selection picks
against the **live** `PlanarShape` (rebuilt on demand from the merged shape, memoized
by identity), so the read-back dissolve is no longer in the selection path; see §3.0b.
(b) ~~Strokes that cross a fill don't yet split the fill into
selectable sub-faces (line-splits-fill is P2).~~ **DONE in P2 (task 1320)** — see
§3.0a below. (c) ~~The merge is per-commit; … there is no
incremental re-derivation if a folded shape is later moved (it's now one shape —
P3 selection/segment work).~~ **Addressed for partial moves in P3-selection** —
moving a face/segment SPLITS the shape via `splitOnMove` (§3.0b); a whole-object
move is still a single-shape translate. (d) Curve/curve and seg/curve
collinear-overlap (two identical arcs) is still the P0 behavior; not exercised by
P1's rect cases.

### 3.0a P2 implementation notes (task 1320)

**Line-splits-fill + intersecting-line segmentation — where the work landed.**
The *kernel* already did the hard part: `Arrangement.insertEdge` splits the new
edge AND every existing edge it crosses at all intersections (curve-preserving),
so a stroke drawn across a filled rect already produced TWO planar faces (areas
conserved) and two crossing lines already produced FOUR half-edge segments meeting
at a shared crossing vertex. The gap was entirely in the **read-back**
(`planarShapeToShape`): P1's same-color UNION tracing dissolved *every* interior
seam between two same-fill faces, so a fill split by a line collapsed back into ONE
silhouette loop (the two halves lost their dividing boundary). 

**The one rule that distinguishes union from split:** a same-fill interior seam
dissolves ONLY when it carries **no stroke**. In authentic Flash 8 a line drawn
across a fill is a real, selectable boundary — the faces on its two sides stay
separate even though they share the fill color, and the stroke renders on top. So
`planarShapeToShape` now (1) partitions same-fill faces into **connected
components** via union-find, merging two faces only across a seam that is
same-fill AND `lineStyle === null`; (2) traces each component's boundary as the
union silhouette (so genuine same-color overlap with no dividing line still emits
ONE loop — P1 union preserved). A fill cut by a line therefore reads back as TWO
fill loops (two selectable faces) + the segmented line; an X of two strokes reads
back as the existing four open stroke segments. Curve-preserving throughout (a
quadratic dividing stroke keeps true quadratics on both split halves).

**Wiring.** No `Shell.tsx`/`StageArea.tsx` change was needed: line/pencil/pen and
any stroke-only shape commit as `type:"shape"` with stroke-only paths (no fill),
which `isMergeableShape` already accepts, so they flow through the same P1
`planarMergeCommit` fold under the `planarMergeOnCommit` flag. The behavior change
is confined to the read-back. Drawing-object append is unchanged.

**Acceptance.** `merge-drawing-oracle.spec.ts` case 3 (line across a filled rect →
2 fill regions + the dividing line; stage↔Ruffle diff=0) and case 4 (two crossing
lines → 4 segments; stage↔Ruffle diff=0), both with `planarMergeOnCommit` ON for
the test. Plus core unit tests in `planar.test.ts` ("planar/P2 — …"): a chord
through a face yields 2 faces; the read-back emits 2 fill loops + the segmented
stroke; same-color overlap with no divider still unions to 1 loop; an X of two
lines yields 4 segments (each touching the crossing) and obeys Euler; a curved
dividing stroke splits the fill and keeps quadratic geometry. Areas conserved.

**Remaining for P3+.** ~~Actual *selection* of a single split half / single segment
(single-click face/edge, double-click connected fill+strokes) and moving one half
independently still need the live planar map in the selection model (gap (a)).~~
**DONE in P3-selection (task 1321)** — see §3.0b.

### 3.0b P3-selection implementation notes (task 1321)

**Partial fill-region + line-segment selection + split-on-move, on the LIVE planar
map.** The §3.0 gap (a) was that the dissolve happened at read-back, so the
selection model had no addressable faces/segments. P3-selection closes it by
deriving the **live** `PlanarShape` for the merged shape on demand and picking
against it. Five new pure core modules / surfaces (all in `engine/planar/`,
unit-tested without React):

* **`live.ts livePlanarShape(shape)`** — rebuilds the arrangement from the merged
  `Shape` (`buildArrangementFromShapes([shape])`), **memoized by `Shape` object
  identity** in a `WeakMap`. Every immutable timeline mutation makes a new `Shape`,
  so identity is a correct cache key and old entries GC automatically (no eviction,
  no leaks). The merged display object is at `(0,0)`, so its paths are already in
  kernel space — stage == local == kernel, removing offset bugs.
* **`subselection.ts` — stable, serializable keys.** Half-edge / face ids are
  array indices that change on rebuild, so a selection references **geometry**: a
  `FaceKey` is the `pointKey` of a deterministic interior point (`faceInteriorPoint`
  — which probes centroid → bbox grid → interior diagonals, and returns `null`
  rather than a point proven OUTSIDE the face, so a thin/acute sliver never yields
  a mis-classified fill or an unstable key; every caller handles `null`);
  a `SegmentKey` is the two snapped endpoints (sorted, undirected) + the snapped
  midpoint (disambiguates curves sharing endpoints). `resolveFace`/`resolveSegment`
  map a key back to a live id (exact interior-point / endpoint+mid match, with a
  `locateFace` containment fallback for centroid drift). A `SubSelection` is
  `{ shapeId, keys[] }` — ephemeral UI state (uiStore `subSelection`), not persisted
  in the doc/history (matching `selectedShapeIds`); an undo restores the doc, the
  next pick re-derives keys.
* **`subselection.ts` — pure picking.** `pickAt` (click: stroke-on-ink wins within
  half-its-width, else the face under the point, else nearest stroke within tol),
  `pickConnected` (double-click: BFS the same-fill component across dissolvable
  no-stroke seams + its bounding strokes; a lone stroke flood-selects its connected
  run), `pickInRect` (marquee: every face whose interior is in the rect + every edge
  intersecting it). `subSelectionPolylines` resolves a selection to drawable
  boundary/edge polylines for the halo.
* **`split.ts splitOnMove(ps, keys, dx, dy, …)`** — the defining behavior. Resolves
  keys to selected face/edge ids, then re-emits via the **same proven read-back**
  (`planarShapeToShape`) with a new optional `PlanarEmitFilter`: the EXTRACTED shape
  keeps only the selected faces/edges (translated by the drag delta); the REMAINDER
  keeps the complement. A face filtered out reads as "background", so the read-back's
  component tracer emits the surrounding ring with the removed region as a CW hole
  loop (opposite winding) — **the hole appears for free, no DCEL surgery**. The
  refactor is behavior-preserving: `planarShapeToShape` with no filter is
  byte-identical to P1/P2 (guarded by tests + the unchanged oracle cases 1–4).

**Wiring (flag-gated, whole-object path untouched when OFF).** `uiStore` gains a
`subSelection` field alongside `selectedShapeIds`. `StageArea.tsx` adds three
flag-gated insertions only: the selection-tool mousedown picks a face/segment (via
`livePlanarShape` + `pickAt`/`pickConnected`) and arms a split drag; mouse-up
commits `onSubSplitMove`; the marquee picks `pickInRect`; the overlay draws the
selection halo. All guarded by `partialSelectEnabled` (= flag ON + selection tool),
so flag-OFF and drawing-objects are byte-identical. `Shell.tsx handleSubSplitMove`
extracts + remainders the shape via `splitOnMove` on the LIVE store present (one
`pushDoc` = one undo step; mirrors `commitMergeShapeDirect`'s stale-closure-safe
pattern). The agent registry extends `selection_get` with the optional
`subSelection` and adds `selection_pick_at({x,y,mode?,move?})` (pick a face/segment,
optionally split-on-move); see docs/19. The compile/publish path is **untouched** —
golden-parity / self-determinism are unchanged.

**Acceptance.** `merge-drawing-oracle.spec.ts` case 5 (click resolves a face vs a
segment) and case 6 (**partial-fill island click + move leaves a hole** — the outer
fill reads back with a CW hole loop, the island moves off; stage↔Ruffle pixelmatch
**diff=0/220000**). Plus core unit tests (`planar-subselection.test.ts`): key
round-trip across a rebuild, `pickAt` face/segment/split-halves, marquee,
double-click connected, split-on-move (extract a half, island-leaves-hole, segment
extract, extract-all→null remainder), and the no-filter read-back equivalence.

**Live drag preview during a partial move (task 1331) — DONE.** P3-selection
originally committed `splitOnMove` only on **mouse-up**: there was no per-move
render, so the dragged face/segment stayed pinned at its origin and only "jumped"
to the final position on release (no live preview — the deferred gap noted here).
The whole-object legacy path (`selectionDragRef`) had always rendered live via
`onShapeMove` every pointermove; once `partialSelectEnabled` became always-on for
the Selection tool (P5 cutover, task 1323) that live path was no longer reached
for plain vector shapes, so EVERY brush/tool shape (`DrawingObject` brush strokes
AND `ShapeDisplayObject` rect/oval — all in `shapeDisplayObjects`) dragged
invisibly. `StageArea.tsx` now renders a **transient** live preview while the
split-on-move drag is in flight, WITHOUT mutating the doc: on the first move past
the 3px click-vs-drag threshold it runs `splitOnMove(ps, keys, 0, 0, …)` **once**
to extract the `{remainder, extracted}` geometry, then each subsequent pointermove
merely **translates** the already-extracted geometry by the live cursor offset
(the scene graph swaps the original shape for remainder@base + extracted@offset,
and the selection halo follows). This is a pure render translate — no per-move
planar recompute — relying on the invariant *split-at-0-then-translate(dx,dy) ==
split-with-delta(dx,dy)* (the extracted shape is `translateShape(extracted, dx,
dy)`; the remainder is delta-independent). The **authoritative** split still
commits exactly once on mouse-up via `Shell.handleSubSplitMove` (one `pushDoc` =
one undo step, geometry identical to before). A sub-threshold click still only
selects (no preview, no move). Acceptance: `drag-live-preview-1331.spec.ts` (rect
+ curve oval: screenshots the LIVE canvas MID-DRAG and asserts the artwork is at
the dragged offset, not just after release; + a click-only-no-move case) and the
`planar-subselection.test.ts` "extract-at-0-then-translate == split-with-delta"
unit case (rect + curve). The 8 merge oracles still diff=0/220000 (commit
geometry unchanged). Test bridge gained `__flashTest.setFillColor` /
`setStrokeNone` for pointer-drawing e2e.

### 3.0c P4-eraser implementation notes (task 1322)

**Curve-preserving eraser on the planar mesh.** The legacy `engine/eraser.ts`
does a polygon Greiner–Hormann difference on **flattened** polylines, so every cut
curve is faceted to chords. P4 re-targets the eraser to the planar kernel
(`engine/planar/eraser.ts`):

* **`planarEraseShape(shape, eraserLoops, opts)`** — builds the arrangement from
  the merged shape's paths **plus the eraser stamp polygons inserted as style-less
  subdivision edges** (`buildArrangementFromShapes([shape, eraserShape])`). The
  kernel SPLITS the existing fill/stroke edges at the eraser boundary
  CURVE-PRESERVINGLY (de Casteljau). Then the faces whose interior point lies
  inside the eraser region (even-odd over the stamps) and the stroke half-edges
  whose midpoint lies inside it are dropped at read-back via the P3
  `PlanarEmitFilter` (`faceFilter`/`edgeFilter`). A band erased clean through a
  fill becomes two faces → two loops; an erased interior island leaves a hole
  (the surrounding ring reads back with a CW hole loop, exactly like P3 split).
  Curves not touched by the eraser survive as **true quadratics**.
* **Eraser modes.** `mode: "normal"` erases fills + strokes; `"fills"` only fills;
  `"lines"` only strokes; `"selected"` erases only faces whose interior passes a
  `selectedFaceFilter` (the caller restricts to the current selection);
  `"inside"` erases only the fill the gesture STARTED in (`insideAt` → the
  `locateFace` fill index), so it does not spill onto other fills or background.
* **`faucetEraseShape(shape, pt)`** — a single click deletes a WHOLE connected
  fill component (same-fill faces across dissolvable seams) or a WHOLE connected
  line (stroked-edge run via shared vertices), picked on the LIVE planar map
  (`livePlanarShape`), stroke-on-ink winning over a face.

**Kernel bug fixed for P4 (retired-edge intersection — task 1322).** P0's
`Arrangement.insertEdge` scanned ALL even-indexed half-edges for intersections
against the new edge — including edges that an earlier `splitExistingEdge` had
RETIRED (marked `origin = -1` but left in the array to keep the even/odd twin
pairing). A retired edge's geometry is stale, so intersecting the new edge against
it produced SPURIOUS split params that corrupted the topology whenever a later edge
crossed the same region — e.g. **two parallel chords / an eraser band's two sides
both crossing a fill's boundary edge** (the band failed to become its own face;
Euler went to −1). The fix is one guard: `if (e.origin < 0) continue;` in the
intersection scan. This is the one P0 robustness gap the eraser's multi-chord case
needs; the entire P0–P3 suite (planar/merge/subselection/adversarial) and the
oracle cases 1–6 still pass byte-for-byte (diff=0/220000).

**Wiring (flag-gated, default behavior unchanged).** `StageArea.tsx`'s eraser
handler adds a flag-gated branch: when `planarMergeOnCommit` is ON and the touched
object is a merged mergeable shape at `(0,0)` with identity transform, it routes
through `planarEraseShape` (with the active `eraserMode`); otherwise it falls back
to the legacy per-object curve-flattening `eraseShape` (flag-OFF / drawing-objects
— byte-identical default). Faucet is handled on mousedown. `Shell.tsx` adds
`handleEraseOnLayer` (one `pushDoc` = one undo step, stale-closure-safe via
`withTimelineLive`, mirroring `handleSubSplitMove`) and the `__flashTest` bridge
gains `eraseOnLayer(points, radius, mode)` + `faucetEraseOnLayer(x, y)` for the
oracle. `ToolState` gains `eraserMode` + `eraserFaucet`. The compile/publish path
is **untouched** — golden-parity / self-determinism unchanged.

**Acceptance.** `merge-drawing-oracle.spec.ts` case 7 (**erase across a fill cuts
it** into two regions — structural 2-fill assert + stage↔Ruffle diff=0/220000) and
case 8 (**erase a band through a filled DISK splits it, curve silhouette
preserved** — structural 2-fill + `hasCurve` assert + stage↔Ruffle diff=0/220000),
both with `planarMergeOnCommit` ON for the test. Plus core unit tests
(`planar-eraser.test.ts`): erase splits a face; area reduced correctly; full cover
→ null; island leaves a hole; **stroke trim keeps quadratics** (curve round-trip
within epsilon); all five modes behave; faucet whole-fill / whole-line. The legacy
`eraser.test.ts` (Object-Drawing / legacy path) still passes unchanged.

### 3.0d P5 cutover — merge by default + cleanup + authenticity sweep (task 1323)

**The cutover.** The `planarMergeOnCommit` feature flag is GONE. The merge fold is
now unconditional for `type:"shape"` commits:

* `Shell.tsx handleShapeCreated` folds every committed merge-mode shape via
  `planarMergeCommit` (was gated on the flag; now gated only on
  `obj.type === "shape"`, so Object Drawing's `type:"drawing-object"` still appends
  discretely). `commitMergeShapeDirect` (the `__flashTest.commitMergeShape` bridge)
  likewise always folds.
* `partialSelectEnabled` (the face/segment subselection + split-on-move path in
  `StageArea.tsx`) is now active whenever the selection tool is active.
* The planar eraser is chosen **purely by geometry** — a merged mergeable shape at
  identity transform and origin (0,0). The legacy per-object curve-FLATTENING GH
  eraser (`engine/eraser.ts`) is kept ONLY for the cases that never enter the merge
  map: **Object Drawing shapes, non-identity-transform shapes, and gradient/bitmap
  fills** (`isMergeableShape` rejects non-solid fills). The faucet click is likewise
  unconditional. So `engine/eraser.ts` is NOT dead — it is the Object-Drawing /
  non-mergeable path.

**Dead code removed.** `engine/merge-drawing.ts` (the MVP AABB merge approximation,
superseded by the planar kernel in P1 — no remaining callers after the cutover) and
the no-op `engine/shape-boolean.ts` stub (bbox-only union/subtract, only ever called
by its own test) were deleted, with their unit tests and the `engine/index.ts`
re-exports. `engine/featureFlags.ts` (which held only `planarMergeOnCommit`) was
deleted along with its index re-exports and the `setFeatureFlag`/`getFeatureFlag`
`__flashTest` bridge methods.

**Tests adapted to the authentic outcome (not deleted).** The whole-object
selection-drag e2e (`pointer-stage-1275.spec.ts` "selection drag-move persists,
1264") used to assert the display-object `(x,y)` moved. Under merge-by-default a
drawn rect commits as ONE merged shape at (0,0) with the geometry in stage space;
dragging the whole filled region runs **split-on-move**, which extracts + translates
the GEOMETRY (the artwork moves) rather than the object offset. The test now tracks
the stage-space centroid of the artwork and asserts IT moved — the Flash-correct
result. The `merge-drawing-oracle.spec.ts` `beforeEach`/`afterEach` no longer flip
any flag; all 8 canonical cases run by default.

**Planar ↔ per-path interchange is SUFFICIENT (the key cutover assessment).** The
"remaining P5 interchange gaps" noted in P4 — SWF `FillStyle1` hard-coded to 0, FLA
merge-map persistence, planar-topology shape-morph — are **NOT cutover blockers**:

* **SWF.** The merged artwork is read back by `planarShapeToShape` into per-path
  **closed loops** (one solid fill per loop; holes share the same `Fill` reference
  and are cut by the renderer/Ruffle non-zero winding). The SWF encoder emits exactly
  this single-fill-per-loop form (`FillStyle0` set, `stateFillStyle1=0`) and Ruffle
  renders it identically. **Empirical proof:** all 8 oracle cases publish SWF that
  pixelmatches the stage at **diff=0/220000** — cut, union, line-split, four
  segments, partial selection, island-leaves-hole, erase-cut, and curved disk split.
  Populating `FillStyle1` would only reduce the edge-record count (a closer byte-match
  to Flash's own dual-fill loops), an optimization tracked as an optional follow-up.
* **FLA.** A merged shape is a normal per-path `Shape` display object; it
  saves/loads through the standard interchange with no special merge-map record. The
  LIVE planar map for selection/erase is re-derived on demand from that `Shape`
  (`livePlanarShape`, memoized by identity), so nothing planar needs persisting.
  `fla-roundtrip.spec.ts` + `convert-symbol-identity.spec.ts` stay green.
* **Morph.** Shape-tween interpolation is untouched; a merged shape morphs via the
  existing path model. Topology-aware morph matching is a future enhancement, not a
  regression.

**Authenticity sweep results (task 1323).**

* **All 8 merge interaction oracles** pass with merge as the default (no flag),
  stage↔Ruffle pixelmatch **diff=0/220000** each.
* **Object Drawing** stays discrete — structurally guaranteed (`type:"drawing-object"`
  bypasses the merge fold; DrawingObjects aren't in the mergeable shape list and route
  to the legacy eraser).
* **FLA + SWF round-trip, golden-parity, self-determinism, visual-oracle** unaffected
  for unchanged docs — the cutover diff touches ONLY the editor authoring path
  (`Shell.tsx` / `StageArea.tsx` / `uiStore.ts`) and removes dead engine modules; it
  does NOT touch any SWF compile/publish, FLA import/export, or tween/morph file, so a
  given document compiles byte-identically. `fla-roundtrip`, `convert-symbol-identity`,
  `visual-oracle` (18), `shape-morph`, `solid-swf-dump` all pass.
* **Performance on dense art** — the one real follow-up at cutover time. `planarMergeCommit`
  rebuilt the WHOLE layer arrangement (`buildArrangementFromShapes` over every mergeable
  shape) on each commit. Measured one-stroke fold cost on a dense solid-fill shape: 100 fills
  → ~35 ms, 400 → ~61 ms, 800 → ~176 ms (super-linear). A traced-bitmap layer (1000+
  solid fills — all `isMergeableShape`) therefore saw a ~250–400 ms hitch per stroke.
  Not a correctness blocker; normal authored art is responsive. **RESOLVED in task 1327**
  via spatial bbox-culling — see §3.0e.

### 3.0e Incremental (spatial-cull) fold — bounded per-stroke cost on dense art (task 1327; correctness corrected by task 1329)

**The cost.** The planar kernel's `Arrangement.insertEdge` scans every existing half-edge
for intersections, so folding N shapes with E total edges is ~`O(E²)`, and the per-face
fill resolve (`assignFaceFillsBySampling` in `build.ts`) is `O(F · R)` over R source
regions. `planarMergeCommit` ran `buildArrangementFromShapes` over the ENTIRE layer on
every commit, so a single new stroke "rebuilt the world" — a dense traced-bitmap layer
(1000+ disjoint solid fills) hitched ~239 ms per stroke even though the stroke touched only
a handful of fills.

**The fix — transitive-overlap-closure bbox culling (`engine/planar/merge.ts`).** The merge
is **top-wins / draw-order dependent**: when two shapes overlap, the later-drawn one wins the
overlap. The full whole-layer rebuild folds EVERY mergeable shape into ONE kernel arrangement
in draw order, so every pairwise overlap — existing↔existing AND existing↔incoming — resolves
in-kernel with correct top-wins. A culled fold may therefore only leave a shape **untouched**
if leaving it out cannot change ANY face of the merged result. That holds **iff** the shape is
bbox-disjoint from the incoming stroke AND from every shape that gets folded. So the commit
now:

1. Computes the incoming stroke's curve-aware stage bbox (`shapeStageBBox`, built on the
   existing `edgeBBox`).
2. Grows the folded set to a **fixpoint (transitive overlap closure)**: seed it with every
   mergeable shape whose bbox OVERLAPS (or touches within a 1 px tolerance) the stroke, then
   repeatedly pull in any shape whose bbox overlaps a shape ALREADY in the closure
   (`foldShapeIntoLayerCulled`). The remaining shapes are bbox-disjoint from the entire
   interacting cluster.
3. Folds the closure + the stroke through the kernel **in original draw order** (oldest
   first, stroke last/topmost), so every overlap inside the cluster resolves exactly as the
   full rebuild would. The disjoint rest is returned **untouched** as its own display objects,
   in original relative order.

`planarMergeCommit` therefore returns `[...passthrough, ...untouched, mergedObj]` — the
layer may now hold several merged shapes instead of always collapsing to one. This is the
authentic state (two non-overlapping merge-mode regions are independent), and every
downstream consumer (render, selection via `livePlanarShape`, eraser, SWF/FLA interchange)
already handles multiple shapes per layer.

**Why the closure is required — and why the cull is exact (corrected by task 1329).** The
original cull (task 1327) folded only the shapes overlapping the *incoming stroke* and
re-emitted everything else below the merged object. That **reorders top-wins z** between an
untouched shape and a folded shape: if existing shape A overlaps the stroke (so A is folded)
and existing shape B overlaps A but NOT the stroke, then A and B genuinely interact. Folding
only A and re-emitting B separately below the merged object lets A win the A↔B overlap even
though B was drawn on top — flipping the color of the overlap and **dropping an existing↔
existing cut** (the task-1329 HIGH regression). The transitive closure fixes this: B (and
anything B transitively overlaps) is pulled into the same kernel arrangement, so the overlap
resolves in draw order. For the shapes that stay **untouched**, correctness is exact: each is
bbox-disjoint from every folded shape and from the stroke, so it shares no edges with the
merged object — no union/cut/split crosses that boundary, and its z-order relative to the
merged object is geometrically irrelevant (disjoint shapes never contend for a face).
Untouched shapes keep their original relative order, so untouched↔untouched overlaps also
resolve as before. The merged artwork is therefore **identical to the full rebuild for ALL
inputs** — just bounded to the cluster that actually interacts. A shape that merely TOUCHES
the cluster along a shared edge (a coincident-edge union) is kept IN by the tolerance.

**Measured before/after** (per-stroke fold, new stroke overlapping a few fills on a dense
disjoint-fill layer, median of 5):

| Layer fills | Before (full rebuild) | After (bbox-cull) |
|---|---|---|
| 100 | ~28 ms | ~0.4 ms |
| 400 | ~79 ms | ~1 ms |
| 800 | ~214 ms | ~0.8 ms |
| 1000 | ~239 ms | ~2 ms |

Well under the ~50 ms acceptance target. A stroke that genuinely spans the WHOLE layer
(overlapping every fill) still does the full fold (~216 ms for 1000) — that is correct, the
merge work is genuinely required when the stroke truly overlaps everything; the
optimization only removes the wasted work, not the necessary work.

**Verification.** All 8 merge-drawing oracles still pass stage↔Ruffle pixelmatch
**diff=0/220000** (correctness unchanged); the core/authoring-ui unit suites are green
(only the 3 pre-existing task-1207 `flash8-empty.fla`-fixture files fail, as documented).
Unit tests in `planar-merge.test.ts` assert: disjoint shapes stay untouched; the culled fold
== the full rebuild for the overlapping subset (identical merged area); touching-edge shapes
still fold; and the per-stroke fold on a 500-fill layer is bounded (keeps ~n−overlap shapes
untouched, not O(all fills), under a 50 ms ceiling). The **task-1329 regression suite** adds:
the minimal two-overlapping-existing-shapes + off-stroke case (culled == full rebuild,
z-order-respecting per-color face area identical), a 60-trial randomized fuzz proving
culled == full rebuild for arbitrary overlapping layouts, and a transitive-closure case (a
shape overlapping a folded shape but not the stroke is still folded). All three FAIL on the
pre-1329 direct-overlap cull and PASS after.

### 3.0f Intra-arrangement broad-phase — spatial rejection in `insertEdge` and `coincidentOverlap` (task 1396)

The task-1327 shape-set cull bounds **which shapes** enter a fold, but once a shape's edges
are handed to `Arrangement.insertEdge` the kernel itself was still `O(E²)` **within** the
arrangement it builds — the residual cost the cull could not touch (a single stroke that
genuinely spans a dense cluster, or any large authored region, still paid it). Two hot paths
were fixed, both **behavior-preserving** (the set of intersections found — and therefore the
arrangement — is byte-identical; only provably non-intersecting pairs are skipped):

1. **`intersect.ts intersectCurveCurve` → `coincidentOverlap`.** The coincidence fast-path ran
   FIRST, before any bbox test, sampling curve B at 25 points and running a 32-step coarse
   scan + 24-iter ternary refine (~1400 `edgeAt` evals) for EVERY curve/curve pair regardless
   of distance. `coincidentOverlap` now early-returns `null` when `edgeBBox(a)`/`edgeBBox(b)`
   are disjoint by more than its on-curve tolerance `ON_TOL`: no B sample can then lie within
   `ON_TOL` of A, so it would have returned `null` anyway (and the transversal `recurse` bails
   on the same disjoint boxes). Strictly a short-circuit of a null result.

2. **`arrangement.ts insertEdge` — coarse uniform grid.** `insertEdge` scanned ALL even-indexed
   (forward) half-edges to find crossings, so building an N-edge arrangement was `O(E²)`. A
   coarse uniform grid (`gridCell` = 16 px) now buckets each forward half-edge by the cells its
   bbox covers (grown by a 2-twip safety margin that exceeds twip snapping); `insertEdge` only
   intersection-tests the candidates whose bbox shares a cell with the new edge, plus a small
   `largeEdges` overflow list for edges spanning too many cells. An intersection point is a
   twip-snapped point ON both curves, so it lies inside each curve's exact bbox — a genuine
   crossing therefore ALWAYS shares a grid cell and is never culled. Candidates are re-sorted
   into ascending forward-id order (the exhaustive scan's order) so the split-map tie-breaks
   are unchanged. New forward edges register in the grid as they are created (`addTwinPair`);
   retired (split-away) edges stay in the grid but are skipped by the existing `origin < 0`
   guard.

**Verification.** `planar.test.ts` "spatial broad-phase (task 1396)": builds a non-trivial
multi-cluster input into two `Arrangement`s — one with the index, one with `{spatialIndex:
false}` (an exhaustive-scan fallback kept for exactly this comparison) — and asserts the
`build()` outputs are structurally identical (`toEqual`), plus a perf sanity assertion that the
indexed build does < ⅓ the pairwise edge tests of the exhaustive scan (exposed via
`Arrangement.edgeTestCount`). All existing planar oracle/property tests stay green unchanged.

### 3.0g The merge-correctness oracle is RASTER ground-truth, not abstract face-area (task 1330)

**The unsound oracle.** The `planar-merge.test.ts` merge-correctness checks (the 1329
`culled == full rebuild` equivalence and the randomized fuzz) measured per-color
**face area** by re-running `buildArrangementFromShapes` on the merged/baked path-soup and
summing `faceArea` over `locateFace`/interior-point-resolved bounded faces. That abstract
oracle is **NOT render-faithful**: re-arranging the read-back path-soup and resolving a
point into an abstract face can land in a different face than the renderer actually paints,
so it can both **miss real regressions** and report **FALSE divergences**.

**The artifact (the task-1330 finding).** On a `>=7`-shape mutually-overlapping solid-fill
cluster with a same-color island, the face-area oracle reported the whole-layer fold's
GREEN as 691 (ground truth) vs 547 (folded) — a **Δ144 "leak"** into other colors. But this
divergence is confined to the abstract oracle. The QA E2E verification rendered the exact
cluster through the **real CanvasRenderer** two ways — via the merge fold and as plain
top-wins layered drawing-objects — and `screenshotStage()` PNGs matched **pixel-for-pixel
(diff=0/220000, flipPixels=0)**. The fold IS render-faithful (the renderer paints the
emitted ShapePaths correctly via two-pass fills + non-zero winding); the Δ144 was an oracle
artifact, not visible product output. (Accordingly the task's product-impact claim was
**downgraded** — no product/geometry fix was made; the renderer is correct.)

**The sound oracle.** The merge-correctness checks now compare **rasterized PIXELS**, not
abstract face areas. A small pixel rasterizer (`engine/__tests__/raster-oracle.ts`) paints
solid-fill `ShapePath`s using the SAME rules the product renderer uses
(`renderShape` Pass-1: fills in path order, later over earlier; **consecutive same-`Fill`-
reference paths batched into one non-zero-winding fill** so holes cut their outer loop;
quadratics flattened to chords). The oracle rasterizes **both** (A) the merged/folded result
and (B) the **ground-truth top-wins layered render** of the same input shapes (bottom→top),
and asserts `pixelDiff == 0` / identical per-color pixel counts. Used for: the 1329
`culled == full rebuild` equivalence (now a full-layer raster compare), the 60-trial
randomized fuzz (per-color pixel counts EQUAL, not merely close), and the task-1330
regression cases — the exact `e0..e6 + s GREEN` cluster and the minimal green-cluster +
yellow + disjoint-green-island variant **now PASS** under the raster oracle, demonstrating
the fold is render-faithful and that the old face-area oracle was the artifact (the same
inputs reported Δ144 under face-area, diff=0 under pixels).

**Scope.** This was a TEST-ORACLE-ONLY change — no product/src code was touched (only the
`__tests__/raster-oracle.ts` helper + `planar-merge.test.ts`). The 8 merge-drawing e2e
oracles (stage↔Ruffle pixelmatch) are unaffected.

### 3.0f ALL shape-creation paths share ONE merge-commit helper (task 1328)

**The gap.** The P5 cutover (§3.0d) wired merge-on-commit into ONLY the interactive UI
draw path (`Shell.tsx handleShapeCreated` / `commitMergeShapeDirect`). Every OTHER
shape-creation entry point still called `addDisplayObject` directly and therefore did NOT
merge — so programmatic / pasted / scripted drawing DIVERGED from interactive drawing (no
same-color union, no different-color cut, no line-split). Found by an integration audit of
the P5 cutover.

**The fix — a single shared helper.** `commitShapeToTimeline(timeline, layerId, frameIndex,
incoming)` (`packages/core/src/model/timeline.ts`) is now the SINGLE source of truth every
shape-creation path routes through. It is the `Timeline -> Timeline` core of
`handleShapeCreated`, factored out verbatim:

* **Object Drawing** (`type:"drawing-object"`) and every non-shape display object — plain
  discrete `addDisplayObject` append (Object Drawing must NOT merge).
* **Gradient / bitmap (non-solid) fills** — passed through untouched (the incoming
  non-mergeable shape is appended as-is; existing non-mergeable objects are preserved by
  `planarMergeCommit`'s pass-through partition).
* **Solid-fill / stroke merge-mode shapes** (`type:"shape"`) — folded into the layer's
  GOVERNING keyframe at `frameIndex` via `planarMergeCommit` (same-color UNION /
  different-color CUT / line-splits-fill, curve-preserving, bbox-culled), read back to
  per-path closed loops as a single merged shape at (0,0).

The helper is a pure transform; each caller supplies the correct `Timeline` (scene vs.
symbol edit-context) and is responsible for stale-closure-safety (read the LIVE store
present). Targeting the GOVERNING keyframe means a draw on a tween's middle frame folds
into the keyframe that governs that frame — exactly as the interactive path does.

**Paths now wired through it (identical semantics, single source of truth):**

* `Shell.tsx handleShapeCreated` + `commitMergeShapeDirect` — REFACTORED to call the helper
  (was the inlined logic the helper was factored from; byte-identical result, so the 8
  oracles are unaffected).
* **Agent** `stage_add_shape` (`agent/registry.ts`) — via `withActiveTimeline` (symbol
  edit-context aware). The display-object id is set equal to the shape id so the id
  `stage_add_shape` returns resolves to the merged object (a single shape on an empty layer
  still folds, taking the merged shape's id) — `stage_update` / `stage_remove` /
  `library_convert_to_symbol` by that id keep working post-fold.
* **Copy/paste** `hooks/useClipboardHandlers.ts handlePaste` — pasted `type:"shape"` items
  fold (the +10/+10 offset is baked into stage-space geometry by the fold); pasted
  non-shapes (symbol instances, drawing-objects, text, bitmaps) append as-is.
* **JSFL** `jsfl/runtime.ts` `addNewRectangle` / `addNewOval` / `addNewLine` — merge as the
  interactive tools do (a JSFL line splits a JSFL fill). `addNewText` still plain-appends.

**Draw-on-tween — verified NOT corrupting.** A new unit test
(`model/__tests__/commit-shape-to-timeline.test.ts`) builds a shape tween (frame 0 → frame
10), draws a second shape on a middle frame, and asserts: the draw lands on the GOVERNING
(start) keyframe, the END keyframe geometry is untouched, the tween still interpolates after
the draw, and the tween type is preserved. No corruption was observed, so **no fix was
needed** beyond routing through the shared helper.

**Verification.** `pnpm --filter './packages/**' build` green; core (only the 3 pre-existing
`flash8-empty.fla`-fixture files fail, as documented), authoring-ui (1022/1022), and swf
(1466/1466) unit suites green. New tests: the shared-helper test (union / cut / Object-Drawing
no-merge / gradient passthrough / empty-keyframe / draw-on-tween), agent two-shape union+cut +
id-resolves-post-fold (`registry.test.ts`), JSFL union+cut+line-split (`runtime.test.ts`), and
paste union+cut+non-shape-append (`clipboardMerge.test.ts`). The 8 merge-drawing oracles are
unaffected — `commitMergeShapeDirect` produces byte-identical output (same `planarMergeCommit`
call) and Object-Drawing / gradient / symbol / undo paths are unchanged.

### 3.0h Stroked curved fills pick/drag at their centre — coincident-curve handling (task 1334)

**Symptom.** A STROKED ellipse/oval could not be click-selected or dragged by its interior:
`pickAt` at the oval's centre returned `null`, so the whole-fill drag never started. A
stroke-NONE oval picked/dragged fine. (Surfaced — documented, not fixed — by task 1331.)

**Root cause — a coincident-curve explosion on rebuild.** A stroked oval folds cleanly on
first commit (one bounded fill face). But the read-back (`planarShapeToShape`) emitted the
stroked fill boundary as ~12 SEPARATE single-segment open stroke paths (one per undirected
edge), plus a couple of sub-twip stubs at the curve seams. `pickAt` operates on the LIVE
planar map, which is **re-built** (`livePlanarShape` → `buildArrangementFromShapes`) from that
committed shape. On rebuild the fill loop (one 11-segment curve) and the dozen stroke
fragments are the SAME geometry split at DIFFERENT points — i.e. *coincident curves*. And
`intersectCurveCurve` (recursive bbox subdivision) had NO coincidence case: two curves tracing
the same arc overlap at every subdivision level, so it emitted a FLOOD of spurious "crossings"
all along the shared arc (deduped only at SNAP_EPS). Result: ~14.6k half-edges, the interior
shattered into tiny/zero-area faces, and the centre resolved to no fill face. (This is the
curve analogue of the seg/seg collinear-overlap that was already handled.)

**Fix — three curve-preserving layers** (no flag; merge/eraser/selection unchanged):

1. **`intersect.ts` — coincidence fast-path.** `intersectCurveCurve` first runs
   `coincidentOverlap`: sample B, project each sample to its nearest parameter on A; if a
   contiguous, monotonic run of B's samples lies ON A over a *substantial* span (rejecting the
   corner-graze where two adjacent arcs merely share a tangent at a join), report ONLY the
   overlap-interval endpoints — never a flood. Distinct-endpoint + min-span guards keep a true
   transversal crossing on the normal subdivision path.
2. **`arrangement.ts` — drop zero-span pieces.** A split piece whose endpoints snap to the
   SAME vertex is degenerate (a zero-length line OR a zero-span quadratic stub produced when a
   curve is split a sub-twip from its own endpoint). The guard now skips lines AND curves
   (`if (aId === bId) continue`), so no self-loop half-edge pollutes the rotation system.
3. **`query.ts` — combine a uniformly-stroked fill loop + drop sub-twip stubs.** When EVERY
   edge of a traced fill loop carries the SAME line style, emit ONE **combined fill+stroke**
   path instead of a fill loop plus a dozen orphan stroke fragments — so a re-built map sees
   the stroke segmented IDENTICALLY to the fill boundary and the coincident-edge merge
   (`addTwinPair`) folds them into shared edges. The residual sub-twip stroke stub at a curve
   seam is dropped (invisible, and re-built it re-fragments the interior). This combined form
   also matches the SWF encoder's `coalesceFillStrokePairs` expectation and how an authored
   stroked shape is naturally shaped.

**Net effect.** A stroked oval now read-backs as one combined fill+stroke loop; the rebuilt
map is one bounded fill face; `locateFace`/`pickAt` at the centre resolve that face and
`splitOnMove` extracts it — byte-for-byte the stroke-free oval's behaviour. (Independent
pre-existing note: any oval — stroked OR stroke-free — still degrades after **3+** successive
commit→rebuild cycles from quadratic read-back accumulation; out of scope here, and the
stroked oval now matches the stroke-free oval at every cycle count.) Gate:
`planar-subselection.test.ts` "task 1334 — stroked oval picks & drags at its centre" (combined
read-back / centre→fill-face parity with stroke-free / drag extracts the fill / wide+tall
ellipses survive a round-trip). All 8 merge oracles still diff=0/220000.

### 3.0i Multi-cycle read-back is a FIXED POINT — shared-vertex tangent-touch guard (task 1335)

**Symptom (the latent issue flagged by 3.0h).** Any oval / curved fill — stroked or
stroke-free — DEGRADED after 3+ successive commit→`livePlanarShape`-rebuild cycles. Heavy
iterative editing runs a merged shape through many `fold → read-back → fold` round-trips (every
selection edit re-derives the live map via `livePlanarShape` and commits the read-back back to
the timeline). Measured on a stroke-free oval: the read-back gained ~8 stub segments PER cycle
(8 → 13 → 19 …), the 45° boundary vertices marched ~1 twip per cycle, and after ~3 cycles the
topology degenerated so badly that the fill was **LOST ENTIRELY** (`paths → 0`, zero pixels).
Single commits and the stroked-vs-stroke-free parity (3.0h) were already fine; this was purely
multi-cycle accumulation.

**Root cause — a near-shared-vertex "crossing" that is really a tangent touch.** A closed
curved path's consecutive quadratic arcs SHARE an endpoint vertex `V` and merely TOUCH there
(tangent continuity) — they do not truly cross. But after twip-snapping the arcs' endpoints and
controls, `intersectCurveCurve` reports a near-`V` "hit" whose parameter is *interior*
(`tA ≈ 0.9993`, `tB ≈ 0.0002`) yet whose snapped point lands **one-to-two twips OFF** the true
shared vertex (e.g. `V = (176.55,162.45)` but the hit snaps to `(176.60,162.40)`). The old
`insertEdge` registered any interior split (`1e-7 < t < 1−1e-7`), so this spurious hit (a)
split an arc a sub-twip from its own endpoint, leaving a ~1-twip stub edge, and (b) routed the
boundary chain through a vertex a twip away from the real one. Each rebuild re-introduced and
re-displaced these, so the geometry never settled — it drifted and fragmented to collapse.

**Fix — `arrangement.ts insertEdge` shared-vertex guard (single change, curve-preserving).**
An interior split is REJECTED when its snapped crossing point lies within
`ENDPOINT_INCIDENCE_R2` (~1.5 twips²) of an endpoint of **BOTH** edges at once — the signature
of a shared-vertex tangent touch (both arcs' nearby endpoints are the vertex `V` they share). A
GENUINE crossing — even one near a vertex, e.g. an eraser-capsule edge cutting a band edge
close to where the capsule edge ends — is near an endpoint of AT MOST ONE edge (the other edge
passes through with the crossing solidly in its interior), so the "both edges" condition leaves
every real crossing intact. (An earlier "near an endpoint of *either* edge" form was too broad
— it suppressed a legitimate angled-eraser cut; the "both" form is the precise discriminator.)

**Net effect — a true fixed point.** Cycle 1 applies the unavoidable one-time twip-snap of the
authored (off-grid) control points (sub-pixel; renders pixel-identical, so the single-commit
oracles are unaffected). From cycle 2 onward the read-back is **byte-exact identical** to the
previous cycle: segment count, path count, area, and rasterized pixels are all stable forever
(`dPixels = 0` across 10+ cycles for circles and wide/tall/off-grid ovals, stroked and
stroke-free). Curve fidelity is preserved — no polyline flattening, still one closed quadratic
fill loop. Gate: `planar-merge.test.ts` "planar read-back: multi-cycle stability is a fixed
point (task 1335)" — 10 commit→rebuild cycles on five oval cases assert path-count + segment-
count + area + raster pixels stay within epsilon AND that cycle N == cycle N−1 byte-for-byte
(all five FAIL on the pre-fix build, where the fill collapses to `paths=0`). All 8 merge
oracles still diff=0/220000; planar-adversarial / planar-subselection / planar-eraser unchanged.

### 3.0j Curve/curve EXACT-TANGENT contact survives the merge (task 1336)

**Symptom (the real, product-reachable data loss task 1334 was filed for).** Two distinct
curved fills (e.g. two equal circles) touching at a SINGLE apex — externally tangent at
`dx == 2r` — dropped a region on merge: at exactly `dx == 2r` BOTH disks vanished in the
PRODUCT render (stage + Ruffle ~99% data loss), confirmed via the real merge-on-commit path
(`commitMergeShape → planarMergeCommit → foldShapeIntoLayer → buildArrangementFromShapes →
planarShapeToShape`). The window is measure-zero — `dx = 2r ± 0.5` both render a correct full
union/two disks — but a user CAN hit it (snapping two equal circles edge-to-edge). The 1334
"coincident-curve" fast-path (§3.0h, `coincidentOverlap`) did NOT cover this: it only engages
when two quadratics trace the SAME arc over a substantial span; two distinct tangent circles
trace DIFFERENT arcs touching at one point, so they fell through to the transversal solver.

**Root cause — TWO coupled degeneracies at the exact tangency.** (1) `intersectCurveCurve`'s
recursive subdivision (`recurse`) FLOODS: the two grazing arcs' sub-boxes overlap over a
contiguous band and never separate, so it emits ~26 near-duplicate "crossings" spread over a
~2.5 px arc around the true contact. `dedupe` only merges within `SNAP_EPS` (0.025 px), so
dozens survive as distinct vertices → the arrangement shatters (undirected edges 8 → ~98) and
both interiors leak to the unbounded face. This is the curve analogue of the 1332 seg/seg
crossing-flood. (2) Even once the flood is collapsed to the single shared pinch vertex, FACE
TRACING fails: at an external tangency the four arcs meeting at the contact point have
IDENTICAL first-order tangents (both disks' boundaries leave the apex in the same — vertical —
direction), so the rotation-system's pure tangent-angle sort orders the two disks' coincident-
tangent edges ARBITRARILY, interleaves the loops, and both interiors still leak away.

**Fix — two narrowly-scoped, curve-preserving changes.**
1. **Tangent-cluster collapse** (`intersect.ts collapseTangentClusters`, after `recurse`).
   Single-linkage-cluster the raw crossings by spatial proximity (`CLUSTER_RADIUS = 4 px` —
   well above the ~2.5 px tangent band, far below the tens-of-px gap between two GENUINE
   transversal crossings of two overlapping circles). A multi-point cluster collapses to ONE
   pinned representative — the point of CLOSEST APPROACH between the two curves over the
   cluster's parameter span (coarse grid scan + coordinate-descent) — but ONLY when it is a
   genuinely GRAZING contact: the curve tangents at the contact are near-parallel
   (`|sinθ| ≤ TANGENT_PARALLEL_SIN ≈ 20°`) AND the cluster has real spatial spread
   (`> SNAP_EPS`). A transversal crossing meets at a clear angle and forms its own tight
   single-point cluster, so it is returned UNCHANGED — genuine curve/curve crossings keep
   their exact split points. The 1334 `coincidentOverlap` same-arc fast-path is untouched.
2. **Tangent-coincident rotation tie-break** (`arrangement.ts compareOutgoing`/`bendSignature`,
   used by the rotation-system sort). When two outgoing half-edges at a shared vertex have
   tangent angles within `TANGENT_ANGLE_TIE` (~0.6°), break the tie by CURVATURE SIDE — the
   signed bend of the edge just past the vertex (cross product of the t=0 tangent with the
   tangent at t=0.05; 0 for a straight edge). The two tangent disks' boundaries bend OPPOSITE
   ways at the contact, so this separates them into distinct CCW cycles and each disk closes as
   its own bounded face. Ordinary vertices (edges meeting at a clear angle) keep the exact
   first-order angular order — the tie-break never fires there.

**Net effect.** At `dx == 2r` the arrangement is now two intact 4-arc loops sharing ONE pinch
vertex (undirected edges = 8, euler = 2, two bounded filled faces — one per disk), and the
read-back rasterizes pixel-identical to the z-order ground truth. Holds across radii, centre
positions (incl. non-integer), and both horizontal and vertical tangency. The seg/curve apex-
tangency corner (a straight edge exactly tangent to a curve's apex) benefits from the same
rotation tie-break. Gate: `planar-adversarial.test.ts` "curve/curve EXACT-TANGENT contact
(1336, raster oracle)" — a `dx` sweep (gap / near-tangent ±ε / exact tangent / clean overlap /
deep overlap) for both same-color (union) and different-color (cut) disks, asserting merged
read-back raster == ground truth (`pixelDiff ≤ 8`), plus euler/edge-count/face-count assertions
at the exact tangency and an across-radii/orientation sweep. All FAIL on the pre-fix build
(diff 6160, both disks dropped). The remaining WIDE-OVERLAP kernel-raster rows the original
report flagged (`dx = 2r − 2 … r`) are RASTER-ORACLE artifacts (task 1330): they render a
correct full union/cut in the actual `CanvasRenderer` + Ruffle and are NOT asserted here. All 8
merge oracles still diff=0/220000; planar-adversarial / planar-subselection / planar-eraser /
planar-merge unchanged; core suite green except the 3 pre-existing `flash8-empty.fla` fixtures.

### 3.0k Latent edge-case hardening — total rotation order + Erase-Inside keying (task 1399)

Two low-frequency latent defects, both fixed behavior-preservingly (all §3.0j oracles and the
whole planar suite stay green):

1. **Non-transitive rotation comparator → `compareOutgoing` now derives a TOTAL order.** The
   1336 tie-break returned the RAW tangent angle when `|Δangle| > TANGENT_ANGLE_TIE` and the
   `bendSignature` otherwise. That hybrid is not transitive: three near-tangent outgoing edges
   whose angles chain across the threshold (A~B and B~C within the tie, A~C beyond) can give
   `cmp(A,B)>0`, `cmp(B,C)>0` yet `cmp(A,C)<0`. `Array.sort` on a non-transitive comparator is
   platform-dependent and can yield a garbage rotation-ring order → corrupted `next`/`prev`
   linking and face tracing. Needs ≥3 tangent-coincident edges at one vertex, so it is rare, but
   when it fires the arrangement is silently wrong. Fix: both sort keys are now derived from
   scalars compared lexicographically — **`(round(angle / TANGENT_ANGLE_TIE), bendSignature)`** —
   which is a total order by construction. Exact tangency yields identical angles hence the same
   quantized bucket, so the 1336 bend tie-break still fires there; only the rare
   near-tangent-but-not-identical pair straddling a bucket edge changes (it now orders by angle,
   previously undefined). Gate: `planar.test.ts` "rotation comparator total order (task 1399)"
   (a three-edge transitivity check that FAILS on the pre-fix hybrid, plus a 1336-preservation
   case).
2. **Erase-Inside keyed on a fill INDEX that de-dupes across disjoint regions.** `eraser.ts`
   resolved `insideFillIdx = locateFace(insideAt).fill` (a style INDEX/color) and erased any
   under-eraser face with `f.fill === insideFillIdx`. Because `buildArrangementFromShapes`
   de-dupes fills by color, two spatially-disjoint same-color regions share ONE index, so
   Erase-Inside also bit a SEPARATE same-colored region the eraser merely passed over (authentic
   Flash confines it to the connected fill you started in). Fix: restrict to
   `connectedFillComponent(startFace)` (the same silhouette walk the faucet uses), which cannot
   reach a disjoint region. Gate: `planar-eraser.test.ts` "Erase Inside spares a DISJOINT
   same-color region (task 1399)".

### 3.0l Stroke-under-fill consumption — a top fill replaces the line beneath it (task 1430)

**The defect.** The merge fold only applied top-wins draw order to FACE fills
(`assignFaceFillsBySampling`). Stroke half-edges were emitted regardless of what
covered them, so brushing Paint Normal — or committing any plain fill — over a
pencil line left 100% of the covered line rendering ON TOP of the new fill (the
renderer draws fills then strokes). In real Flash 8 a top-drawn fill REPLACES the
portion of a line it covers; this is exactly why the Brush's Paint Fills / Behind
/ Inside modes exist (they are the modes that leave lines alone).

**The fix — draw-order-scoped, in the fold only.** A `drawOrder` index (0 =
oldest, incoming last) is threaded from the source shape onto each stroke edge and
survives every arrangement split (`InputEdge.drawOrder → MutHalfEdge.drawOrder →
HalfEdge.drawOrder`, carried through `splitExistingEdge` and the coincident-edge
merge). After `buildArrangementFromShapes` builds the arrangement and resolves
face fills, `consumeStrokesUnderFills` clears the `lineStyle` (and its twin's) of
any stroke half-edge whose midpoint is covered by a `fillRegions` entry drawn
**strictly later** (`region.order > he.drawOrder`). The arrangement has already
split the stroke at the boundary of every fill it crosses, so each stroke
half-edge is wholly inside or wholly outside a given fill — the covered span is
dropped, the uncovered ends survive.

* **Strict draw-order is what keeps P2 (line-splits-fill) intact.** A line drawn
  OVER an existing fill has the HIGHER order, so that earlier fill never consumes
  it — the line still splits the fill and renders on top. Only a fill drawn AFTER
  a line replaces it. A stroke and a fill from the SAME shape share an order, so a
  stroked-and-filled shape never eats its own boundary stroke.
* **Clearing `lineStyle` (not filtering at emit) also dissolves the covered
  seam.** With the phantom line gone, `planarShapeToShape`'s `seamDissolvable`
  test lets the covering fill read back as one clean region instead of being split
  by an invisible line.
* **Opt-in, fold-only.** `buildArrangementFromShapes` takes
  `{ consumeStrokesUnderFills }` (default **false**), so every other caller (live
  re-derive, sub-selection, brush region masks, eraser, direct tests) is
  byte-identical to before. `foldShapeIntoLayer` / `foldShapeIntoLayerCulled` /
  `planarMergeCommit` take `{ preserveLines }` and enable consumption unless it is
  set. `commitShapeToTimeline` (Paint Normal + plain fills) consumes;
  `commitBrushStrokeToTimeline` passes `preserveLines: true` for the Fills /
  Behind / Selection / Inside modes so their clipped ribbons leave lines alone.
* **Gate:** `planar-merge.test.ts` "stroke-under-fill consumption (task 1430)" —
  the 100px-line-with-fill-over-the-middle repro (covered span gone, both ends
  survive), the reversed line-over-fill case (line splits fill, survives),
  `preserveLines` keeps the whole line, and a stroked-and-filled shape keeps its
  own outline.

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

`apps/desktop/e2e/merge-drawing-oracle.spec.ts` — cases 1–2 (cut, union) PASS as
of P1, cases 3–4 (line-splits-fill, two crossing lines = 4 segments) PASS as of
P2 (task 1320), the partial-selection + island-move cases PASS as of P3-selection
(task 1321), and the two **eraser** cases PASS as of P4-eraser (task 1322). As of
the P5 cutover (task 1323) all eight run with merge as the DEFAULT model (no flag)
— stage↔Ruffle pixelmatch diff=0/220000 each. Each case is verified with the
project's two-oracle stack:
the **stage-canvas** screenshot (`window.__flashTest.screenshotStage()`) for the
authored result, and the **Ruffle pixel** screenshot of the published SWF
(`window.__flashTest.publish()` → bundled Ruffle), pixelmatched against each
other. The eight canonical cases:

1. **red-over-blue cut** — the red overlap carves the blue (different-color cut).
2. **blue-over-blue union** — two overlapping blues merge into one shape.
3. **line across fill** — the line splits the fill into two independent regions
   (P2 task 1320; structural 2-region assert + stage↔Ruffle).
4. **two crossing lines = 4 segments** — four independently-selectable arms (P2
   task 1320; structural 4-segment assert + stage↔Ruffle).
5. **partial selection** — clicking a fill half resolves a FACE key, clicking the
   dividing line resolves a SEGMENT key (P3-selection task 1321).
6. **partial fill click + move leaves a hole** — selecting a carved island and
   moving it extracts it and leaves the hole it had cut in the outer fill
   (P3-selection task 1321; structural hole-loop assert + stage↔Ruffle diff=0).
7. **erase across a fill cuts it** — the eraser band cut through a filled rect
   splits it into two independent regions (P4-eraser task 1322; structural
   2-fill assert + stage↔Ruffle diff=0/220000).
8. **erase a band through a disk, curve silhouette preserved** — erasing through a
   filled DISK (quadratic arcs) splits it into two pieces that keep their curved
   silhouette (P4-eraser task 1322; structural 2-fill + `hasCurve` assert +
   stage↔Ruffle diff=0/220000).

### 4.3 Regression guards (unchanged in P0)

`golden-parity` + self-determinism must stay byte-identical through P0 (no
doc/SWF change), and the core suite stays green except the ~3 pre-existing
task-1207 fixtures that need `fixtures/flash8-empty.fla`.
