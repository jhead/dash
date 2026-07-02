/**
 * Curve-aware planar geometry kernel (Flash 8 merge-drawing foundation).
 *
 * A half-edge planar subdivision over quadratic-bezier-aware geometry:
 *   - geometry.ts   — twip snapping + curve-preserving split/eval primitives
 *   - intersect.ts  — segment/segment, segment/curve, curve/curve intersection
 *   - arrangement.ts— the DCEL builder (insert edge, split, faces)
 *   - query.ts      — point-in-face, area, Euler, Shape<->arrangement conversion
 *   - build.ts      — high-level builders from Shape paths
 *
 * Kernel only — no user-facing behavior change.  See docs/36-vector-merge-model.md.
 */

export {
  TWIPS_PER_PX,
  SNAP_EPS,
  snapCoord,
  snapPoint,
  pointKey,
  pointsEqual,
  dist2,
  quadAt,
  edgeAt,
  edgeTangent,
  outgoingDirection,
  splitQuad,
  splitEdgeGeometry,
  reverseEdgeGeometry,
  edgeBBox,
} from "./geometry.js";

export {
  intersectSegSeg,
  intersectSegCurve,
  intersectCurveCurve,
  intersectEdges,
} from "./intersect.js";
export type { Intersection } from "./intersect.js";

export { Arrangement } from "./arrangement.js";
export type { InputEdge } from "./arrangement.js";

export {
  faceBoundaryPolygon,
  faceInteriorPoint,
  polygonSignedArea,
  faceArea,
  traceCycle,
  pointInPolygon,
  locateFace,
  pointInFace,
  eulerCharacteristic,
  shapePathToEdgeGeometries,
  shapeToEdgeGeometries,
  traceCycleGeometries,
  edgeGeometriesToShapePath,
  planarShapeToShape,
} from "./query.js";
export type { PlanarEmitFilter } from "./query.js";

export {
  buildArrangementFromShapes,
  buildArrangement,
  pathToInputEdges,
} from "./build.js";

export {
  isMergeableShape,
  foldShapeIntoLayer,
  foldShapeIntoLayerCulled,
  planarMergeCommit,
  toStageSpaceShape,
} from "./merge.js";
export type { FoldResult, CulledFoldResult, MergeableLike } from "./merge.js";

// Brush paint-mode compositing (Flash 8 Paint Fills/Behind/Selection/Inside).
export { clipBrushStroke, buildBrushRibbon } from "./brushpaint.js";
export type {
  BrushPaintMode,
  BrushPaintContext,
  PlacedShape,
  BrushStampSample,
} from "./brushpaint.js";

// P3 — live planar map + partial face/segment selection + split-on-move.
export { livePlanarShape } from "./live.js";
export {
  faceKey,
  segmentKey,
  resolveFace,
  resolveSegment,
  pickAt,
  pickConnected,
  pickInRect,
  subSelectionPolylines,
  buildSelectedFaceFilter,
} from "./subselection.js";
export type { FaceKey, SegmentKey, SubKey, SubSelection } from "./subselection.js";
export { splitOnMove, deleteSubSelection } from "./split.js";
export type { SplitResult } from "./split.js";

// P4 — curve-preserving eraser on the planar arrangement + Flash 8 modes.
export { planarEraseShape, faucetEraseShape, buildEraserStamp } from "./eraser.js";
export type {
  EraserMode,
  PlanarEraseOptions,
  PlanarEraseResult,
} from "./eraser.js";
