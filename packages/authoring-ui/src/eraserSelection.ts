/**
 * "Erase Selected Fills" wiring (task 1428).
 *
 * The planar eraser's `"selected"` mode ({@link planarEraseShape}) erases NOTHING
 * unless the caller supplies a `selectedFaceFilter` predicate over each fill face's
 * interior point. Before this helper existed neither StageArea (interactive erase)
 * nor Shell (agent/oracle bridge) ever built that predicate, so the shipped "Erase
 * Selected Fills" button was a silent no-op.
 *
 * This module is the single, pure, unit-testable place that turns the current
 * selection into that predicate for ONE display object — matching Flash 8:
 *   - a WHOLE-object selection makes every fill in the object erasable;
 *   - a partial planar SUB-selection scoped to the object makes only its selected
 *     FACE regions erasable (selected line segments never select a fill);
 *   - an object with nothing selected is SKIPPED (a true no-op), so with no
 *     selection the mode erases nothing at all.
 *
 * Both callers consume the result identically, so the wiring can't silently
 * regress to the no-op again without this test failing.
 */
import {
  buildSelectedFaceFilter,
  livePlanarShape,
  type Point,
  type Shape,
  type SubSelection,
} from "@flash/core";

/** The current selection state the eraser needs to resolve the predicate. */
export interface EraserSelectionState {
  /** Whole-object selection (ids of selected display objects). */
  readonly selectedShapeIds: readonly string[];
  /** Partial planar sub-selection (face/segment keys scoped to one object), if any. */
  readonly subSelection: SubSelection | null;
}

/**
 * Resolution for one object: either a face predicate to pass to
 * `planarEraseShape({ mode: "selected", selectedFaceFilter })`, or `"skip"` —
 * meaning the object holds nothing selected and must be left untouched.
 */
export type SelectedFaceResolution =
  | { readonly kind: "filter"; readonly filter: (interior: Point) => boolean }
  | { readonly kind: "skip" };

const SKIP: SelectedFaceResolution = { kind: "skip" };

/**
 * Resolve the "Erase Selected Fills" predicate for a single display object from
 * the current selection.
 */
export function resolveSelectedFaceFilter(
  objId: string,
  objShape: Shape,
  selection: EraserSelectionState
): SelectedFaceResolution {
  // Whole-object selection → every fill in the object is erasable.
  if (selection.selectedShapeIds.includes(objId)) {
    return { kind: "filter", filter: () => true };
  }
  // Partial planar sub-selection scoped to this object → only its selected faces.
  if (selection.subSelection && selection.subSelection.shapeId === objId) {
    const filter = buildSelectedFaceFilter(
      livePlanarShape(objShape),
      selection.subSelection.keys
    );
    return filter ? { kind: "filter", filter } : SKIP;
  }
  // Nothing selected on this object → no-op.
  return SKIP;
}
