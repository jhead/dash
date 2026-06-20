# Vector Merge Model — authentic Flash 8 merge-drawing

**Status:** P0 + P1 + P2 + P3-selection + P4-eraser landed. P0 = curve-aware
planar geometry kernel + oracle harness. **P1 (task 1319) = merge-on-commit**
(same-color UNION / different-color CUT, top-wins, curve-preserving). **P2 (task
1320) = strokes/lines split fills + intersecting lines segment each other** (a line
drawn across a fill splits it into separate selectable faces; two crossing lines
split each other into four segments; curve-preserving). **P3-selection (task 1321)
= partial fill-region + line-segment selection + split-on-move** (click selects ONE
face or segment, double-click the connected set, marquee picks all intersecting;
moving a partial selection EXTRACTS it and leaves a hole/cut behind — all on the
LIVE planar map). **P4-eraser (task 1322) = curve-preserving eraser on the planar
mesh + Flash 8 eraser modes** — the eraser stroke (disk + capsule stamp) is
subtracted from the layer arrangement: faces inside the erased region lose their
fill (a band erased clean through SPLITS a fill into two; an erased interior island
leaves a hole) and stroke half-edges are TRIMMED/SPLIT at the eraser boundary —
all CURVE-PRESERVING via the P0 kernel splits (de Casteljau, never polyline
flattening). Modes: Normal / Erase Fills / Erase Lines / Erase Selected / Erase
Inside, plus the Faucet whole-fill/line click. All behind the `planarMergeOnCommit`
feature flag (default OFF until the P5 cutover); the legacy per-object
curve-FLATTENING eraser (`engine/eraser.ts`) stays for the flag-OFF /
drawing-object path so default behavior is unchanged. The remaining phase is
SWF/FLA interchange (P5).

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
| **P1** | **Merge-mode geometry ops on the kernel:** cut / union implemented as arrangement operations (`engine/planar/merge.ts` + `planarShapeToShape` in `query.ts`), returning per-path `Shape`s for storage/render/SWF. Same-color union + different-color cut are exact, curve-preserving. Wired into `Shell.tsx handleShapeCreated` / `commitMergeShapeDirect` behind the `planarMergeOnCommit` flag (default OFF). Acceptance: `merge-drawing-oracle.spec.ts` cut + union cases (stage↔Ruffle pixelmatch diff=0). | **DONE (task 1319).** |
| **P2** | **Strokes/lines split fills + intersecting lines segment each other** (task 1320): adding a STROKE edge across a fill SPLITS the fill into separate selectable faces along the line; two crossing lines SPLIT each other into segments at the crossing (curve-preserving). Wired through the existing P1 fold path — line/pencil/pen + stroke commits are `type:"shape"` and already route through `planarMergeCommit` under the flag. The read-back (`planarShapeToShape`) now treats a stroked same-fill seam as a real boundary (only **un-stroked** same-fill seams dissolve), so a line-split fill reads back as two distinct fill loops + the segmented line and an X of two lines reads back as four segments. Acceptance: `merge-drawing-oracle.spec.ts` cases 3 (line-splits-fill) + 4 (4 segments) — stage↔Ruffle pixelmatch diff=0. (Full segment/face *selection* — single-click edge/face, double-click connected fill+strokes — and the live-map dissolve remain P3+.) | **DONE (task 1320).** |
| **P3-selection** | **Partial fill-region + line-segment selection + split-on-move** (task 1321). See §3.0b. | **DONE (task 1321).** |
| **P4-eraser** | **Curve-preserving eraser & true subtraction** routed through the kernel (`engine/planar/eraser.ts`): erase-across-shape splits curve-preservingly; removing an overlapping island leaves a hole; strokes are trimmed/split at the eraser boundary keeping quadratics. Flash 8 eraser MODES (Normal / Erase Fills / Erase Lines / Erase Selected / Erase Inside) + faucet whole-fill/line click. The legacy polyline-flatten `engine/eraser.ts` stays for the flag-OFF / drawing-object path. See §3.0c. | **DONE (task 1322).** |
| **P5 (interchange)** | **Interchange:** enable SWF `FillStyle1` export of the planar map (`packages/swf/src/shapes.ts` currently hard-codes `stateFillStyle1=0`); FLA import/export of merge-map geometry; shape-morph (`tween/interpolate.ts`) matched on the planar topology. | Planned. |
| **P5** | **Full selection authenticity + polish:** marquee/lasso over the planar pieces, edit-curve handles on faces, snapping against the arrangement, and turning the P0 oracle placeholders into passing Ruffle+stage specs. | Planned. |

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
  `FaceKey` is the `pointKey` of a deterministic interior point (`faceInteriorPoint`);
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
`eraser.test.ts` (flag-OFF path) still passes unchanged.

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
(task 1321), and the two **eraser** cases PASS as of P4-eraser (task 1322) — all
with `planarMergeOnCommit` ON for the test and stage↔Ruffle pixelmatch
diff=0/220000. Each case is verified with the project's two-oracle stack:
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
