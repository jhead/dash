# Decision: Per-Edge Planar Fill Representation (fill0/fill1)

**Status:** Deferred — post-MVP story
**Date:** 2026-06-09
**Author:** agent-planar (task 0065-planar-fill-model)

---

## 1. Current State: Single-Fill Contour Model

`ShapePath` (defined in `packages/core/src/engine/types.ts`, lines 179–185) holds a single optional `fill` per closed contour:

```typescript
export interface ShapePath {
  readonly start: Point;
  readonly segments: readonly PathSegment[];
  readonly fill?: Fill;       // at most ONE fill per contour
  readonly stroke?: Stroke;
  readonly closed: boolean;
}
```

**What it can express:**
- Any shape made of one or more non-overlapping closed contours, each with a distinct fill.
- Strokes independent of fills.
- Any shape the Canvas 2D renderer can draw via the `nonzero` winding rule for same-color unions.

**What it cannot express:**
- Two fills sharing an edge. When shape A (blue) and shape B (red) are drawn so that they touch, the edge between them belongs to both fill regions. In the SWF wire format this edge carries `fill0=blue` on its left side and `fill1=red` on its right side. The single-fill contour model requires that edge to be duplicated — once in each closed contour — which creates implicit adjacency information but loses the explicit per-edge dual-fill link.
- The result of any real merge-drawing cut. After a cut, the boundary edges of the surviving fragment are shared between the cut area and the remaining fill. Those shared edges must carry two fill references (the remaining fill and `null`/background on the other side) to allow the planar-map boolean engine to reconstruct correct winding.
- Winding-correct SWF export for multi-contour shapes. `packages/swf/src/shapes.ts` writes only `fillStyle0` per path and hard-codes `stateFillStyle1 = 0` (line 99). `FillStyle1` (winding +1 side) is silently discarded on export.

**Concrete failure mode:** After `mergeDraw` cuts a blue rectangle out of a red rectangle, the surviving L-shaped red region is represented as a single closed contour. If that contour later gets cut again by a third shape, `mergeDraw` has no way to express the new boundary edge as being shared between the two surviving fragments. The AABB approximation in `mergeShapes` will produce wrong results and SWF export will omit the correct winding metadata.

---

## 2. Proposed Per-Edge Representation

The SWF wire format and Flash's internal planar map use a directed edge list where every edge knows its fill on both sides. The natural representation is:

```typescript
// Future per-edge fill representation
interface PlaneEdge {
  // The edge as a quadratic bezier: from point P0 to P2 via control P1
  p0: { x: number; y: number };
  p1: { x: number; y: number }; // control point (null = straight line)
  p2: { x: number; y: number };
  fill0: number | null; // fill style index on left side (winding +1)
  fill1: number | null; // fill style index on right side (winding -1)
  lineStyle: number | null; // stroke style index, or null
}

interface PlanarShape {
  fillStyles: FillStyle[]; // indexed by fill0/fill1
  lineStyles: StrokeStyle[]; // indexed by lineStyle
  edges: PlaneEdge[];
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number };
}
```

This maps 1:1 to the SWF `StyleChangeRecord` / `StraightEdgeRecord` / `CurvedEdgeRecord` encoding in `packages/swf/src/shapes.ts`. The planar-map boolean engine (required by `docs/03-drawing-vector-graphics.md`) works by:

1. Inserting split points wherever two edges intersect.
2. Re-labelling `fill0`/`fill1` on every edge according to the boolean operation (union, subtract, intersect).
3. Tracing the resulting edge-adjacency graph to produce closed fill regions for rendering.

Step 2 is impossible with the single-fill contour model because edges do not carry both-side fill references.

---

## 3. Migration Cost Estimate

The following modules would require changes. Scope is rated S/M/L by estimated effort.

| Module | File | Change required | Scope |
|---|---|---|---|
| Core type definitions | `packages/core/src/engine/types.ts` | Add `PlaneEdge`, `PlanarShape`; keep `ShapePath`/`Shape` for transitional compatibility or replace them | M |
| Renderer | `packages/core/src/engine/renderer.ts` | Replace per-path fill rendering with per-edge winding-correct fill passes; trace closed regions from `PlanarShape.edges` | L |
| Merge-drawing engine | `packages/core/src/engine/merge-drawing.ts` | Replace the AABB-approximation boolean engine with a real planar subdivision algorithm (e.g. Sutherland–Hodgman or martinez); update `mergeShapes`/`mergeDraw`/`applyMergeDrawing` | L |
| Tween/interpolate | `packages/core/src/tween/interpolate.ts` | Shape morph currently operates on `ShapePath[]`; must be updated to match `PlaneEdge[]` vertex counts for correct interpolation | M |
| FLA serializer | `packages/core/src/fla/serialize.ts` | Serialize `PlanarShape` edges and style tables; bump `FORMAT_VERSION` | S |
| FLA deserializer | `packages/core/src/fla/deserialize.ts` | Read new format; provide migration path from old single-fill format | S |
| SWF encoder | `packages/swf/src/shapes.ts` | Enable `stateFillStyle1` in `writeStyleChangeRecord`; emit fill1 references; remove the hardcoded `stateFillStyle1 = 0` at line 99 | S |
| Tests | `packages/core/src/engine/__tests__/merge-drawing.test.ts`, tween tests, FLA round-trip tests | Update all fixtures and assertions to use new types | M |
| Authoring UI / tools | `packages/authoring-ui/src/` | Drawing tools (pencil, brush, shapes) currently build `ShapePath` objects; must build `PlaneEdge` lists instead | M |

**Total estimated scope:** approximately 4–6 weeks of focused engineering if done in one pass after the system has stabilized. If done piecemeal (e.g. renderer before merge engine), the interim state will require a compatibility shim layer which adds roughly 20–30% overhead.

**Cost-grows-with-time analysis:** Every new feature built on `ShapePath` deepens the commitment:
- Shape morphing (tween interpolation) must match vertex counts; adding edges later requires a re-matching step.
- Any SWF import/export that relies on path ordering rather than edge topology will produce incorrect output when shapes are merged.
- The more test fixtures are written in the single-fill format, the more migration work is needed.

---

## 4. Decision

**Ship the planar model as a separate story after MVP; until then, accept single-fill limitations and document them.**

Rationale:

1. **MVP scope is large enough.** The merge-drawing engine, renderer, tween system, FLA serializer, SWF encoder, and authoring UI are all unfinished. Inserting a foundational type change now would block every one of those parallel workstreams until the migration is complete.

2. **The AABB approximation in `mergeDraw` is acceptable for MVP.** Flash authors creating simple shapes (rectangles, ovals, polygons) will see correct merge/cut behavior. The known failure mode — partially-overlapping cuts — is documented and will not produce silent data loss, only visual approximation.

3. **SWF export omitting FillStyle1 is a known, bounded defect.** Multi-contour shapes with shared edges are uncommon in simple animations. The defect is tracked in task 0047 and referenced here.

4. **The migration surface is well-defined.** Because the type boundary is narrow (`ShapePath` → `PlaneEdge`), the migration can be executed as a single focused story once MVP is shipped and the surface area has stabilized.

**Against landing now:** The cost-grows argument is real but manageable. The modules listed above are not yet complete, so their "sunk cost" in the single-fill model is still low. The migration cost estimate above would be roughly the same if executed immediately or after MVP, with the exception of test fixtures (which grow linearly with feature work). This factor alone does not justify blocking MVP.

---

## 5. Tracking

A follow-up task should be created at the start of the post-MVP backlog prioritization:

**Suggested task title:** `IMPL: migrate Shape/ShapePath to PlanarShape/PlaneEdge (fill0/fill1)`

**Blocking:** Full merge-drawing correctness, byte-faithful SWF export of multi-contour shapes, shape morph round-trip fidelity.

**Unblocking:** This task (0065) must be resolved first; the migration plan is in this document.

**Pre-conditions before landing the planar model:**
- MVP milestone is shipped and tagged.
- All existing `ShapePath`-based tests pass (they become the migration regression baseline).
- A compatibility deserializer for old FLA format is written and tested before the new serializer is merged.

---

## Appendix: Known Limitations Until Migration

The following behaviors are deliberately approximated in the MVP and will remain so until the planar model lands:

- `mergeShapes` and `mergeDraw` use AABB + polygon bounding-box containment tests. Partially-overlapping cuts of different-color fills are not subtracted precisely; the existing path is preserved unchanged.
- `encodeDefineShape4` (`packages/swf/src/shapes.ts` line 99) hard-codes `stateFillStyle1 = 0`. SWF shape records for multi-contour shapes with shared edges will be missing the correct winding fill reference.
- Shape morph interpolation in `packages/core/src/tween/interpolate.ts` matches paths by array index. After a merge-drawing operation, path counts may differ between keyframes, causing morph artifacts.
- Strokes drawn across fills (segmentation) are recorded but not geometrically split; both the stroke path and the fill path survive intact in the output.
