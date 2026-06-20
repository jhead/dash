// Types
export type {
  BitmapDisplayObject,
  BitmapFill,
  ButtonHandler,
  ClipAction,
  Color,
  ColorEffect,
  CurveSegment,
  DisplayObject,
  DrawingObject,
  EdgeGeometry,
  Fill,
  HalfEdge,
  PlanarFace,
  PlanarShape,
  PlanarVertex,
  GradientColorStop,
  GroupObject,
  LinearGradientFill,
  LineSegment,
  PathSegment,
  Point,
  RadialGradientFill,
  Rect,
  SceneGraph,
  SceneLayer,
  Shape,
  ShapeDisplayObject,
  ShapePath,
  SolidFill,
  SolidStroke,
  Stroke,
  StrokeCap,
  StrokeJoin,
  StrokeStyle,
  StrokeStyleDashed,
  StrokeStyleDotted,
  StrokeStyleHatched,
  StrokeStyleRagged,
  StrokeStyleSolid,
  StrokeStyleStippled,
  StrokeStyleType,
  ObjectAccessibility,
  SymbolInstance,
  TextAlign,
  TextDisplayObject,
  TextOrientation,
  TextType,
  EmbedRange,
  VideoDisplayObject,
  Viewport,
} from "./types.js";

// Filters
export type {
  AdjustColorFilter,
  BlurFilter,
  BevelFilter,
  ConvolutionFilter,
  DisplacementMapFilter,
  DropShadowFilter,
  FlashFilter,
  GlowFilter,
  GradientBevelFilter,
  GradientGlowFilter,
} from "./filters.js";
export {
  defaultAdjustColor,
  defaultBlur,
  defaultBevel,
  defaultConvolution,
  defaultDisplacementMap,
  defaultDropShadow,
  defaultGlow,
  defaultGradientBevel,
  defaultGradientGlow,
} from "./filters.js";

// Merge-drawing
export { applyMergeDrawing, fillsEqual, mergeDraw, mergeShapes } from "./merge-drawing.js";
export type { MergeResult } from "./merge-drawing.js";

// Vector eraser (boolean subtract along the eraser path)
export { buildEraserPolygon, subtractPolygon, eraseShape, pathToPolygon as eraserPathToPolygon } from "./eraser.js";
export type { EraseOptions } from "./eraser.js";

// Curve-aware planar geometry kernel (Flash 8 merge-drawing foundation).
// Exported as a namespace to avoid name clashes (e.g. snapPoint with ./snap.js);
// see docs/36-vector-merge-model.md.
export * as planar from "./planar/index.js";
export {
  Arrangement,
  buildArrangement,
  buildArrangementFromShapes,
  planarShapeToShape,
  isMergeableShape,
  foldShapeIntoLayer,
  planarMergeCommit,
  // P3 — live planar map + partial face/segment selection + split-on-move.
  livePlanarShape,
  faceKey,
  segmentKey,
  resolveFace,
  resolveSegment,
  pickAt,
  pickConnected,
  pickInRect,
  subSelectionPolylines,
  splitOnMove,
  // P4 — curve-preserving eraser on the planar arrangement + Flash 8 modes.
  planarEraseShape,
  faucetEraseShape,
  buildEraserStamp,
} from "./planar/index.js";
export type {
  InputEdge,
  Intersection,
  FoldResult,
  MergeableLike,
  PlanarEmitFilter,
  FaceKey,
  SegmentKey,
  SubKey,
  SubSelection,
  SplitResult,
  EraserMode,
  PlanarEraseOptions,
  PlanarEraseResult,
} from "./planar/index.js";

// Engine feature flags (gates in-progress re-architectures; see featureFlags.ts).
export type { EngineFeatureFlags } from "./featureFlags.js";
export { getFeatureFlag, setFeatureFlag, getFeatureFlags } from "./featureFlags.js";

// Renderer
export { CanvasRenderer, initCanvas } from "./renderer.js";

// Frame snapshot
export { snapshotFrame } from "./snapshot.js";

// Shape helpers
export { hexToColor, createRectShape, createOvalShape, createLineShape, createPolygonShape, createStarShape, createRoundedRectShape, shapeBounds, transformedShapeBounds, addRectangle, addOval } from "./shapes.js";

// Path simplification and smoothing
export { simplifyPath, smoothPath, createSimplifiedPencilShape } from "./simplify.js";

// Snap utilities
export type { SnapResult, SnapType, ObjectBounds, SnapConfig } from "./snap.js";
export { snapPoint, snapToGrid, snapToPixels, snapToGuides, snapToObjects as snapPointToObjects, snapDistance } from "./snap.js";
export { snapScalarToGrid, snapScalarToPixel, snapScalarToGuide, snapScalarX, snapScalarY } from "./snap.js";

// Document-aware snap-to-objects helper
export type { ObjectSnapResult } from "./snapObjects.js";
export { snapToObjects } from "./snapObjects.js";

// Color utilities
export type { HSV, HSL } from "./color-utils.js";
export {
  cssToColor, colorToCss, colorToRgba,
  mixColors, compositeOver,
  lighten, darken, saturate, desaturate, invertColor, withAlpha,
  colorToHSV, hsvToColor, colorToHSL, hslToColor,
  colorDistance, colorsEqual,
} from "./color-utils.js";

// Matrix utilities
export type { Matrix2D, MatrixDecomposition } from "./matrix.js";
export {
  identity, translation, scaling, rotation as rotationMatrix, skewing,
  multiply, inverse, compose as composeMatrix, applyToPoint, applyToRect,
  decompose, toSWFMatrix,
  makeIdentityMatrix, createInstanceMatrix, decomposeMatrix, multiplyMatrix,
} from "./matrix.js";

export type { ShapeWarp, WarpCorners, WarpEdges } from "./warp.js";
export {
  identityWarp, pointToUV, bilinear, coons, evalWarp, warpPoint, warpShape,
} from "./warp.js";

// Guide path utilities
export type { PathPoint } from "./guidepath.js";
export { samplePath, getGuideLayerPath } from "./guidepath.js";

// Frame clipboard operations
export type { FrameClipboard } from "./frameClipboard.js";
// All three are renamed to *Doc variants to avoid conflicting with the
// layer-level copyFrames/pasteFrames in model/frame-utils.  Both reach the
// public @flash/core barrel via "export *" and Vite rejects the ambiguity.
export {
  copyFrames as copyFramesDoc,
  pasteFrames as pasteFramesDoc,
  cutFrames as cutFramesDoc,
} from "./frameClipboard.js";

// Object clipboard operations
export type { ObjectClipboard } from "./objectClipboard.js";
export { copyObjects, pasteObjects, pasteObjectsInPlace } from "./objectClipboard.js";

// Frame-level display object clipboard operations
export { copyDisplayObjects, pasteDisplayObjects, cutDisplayObjects, deleteDisplayObjects } from "./clipboard.js";

// Shape document operations
export { mergeShapes as mergeShapesInDoc, breakApart, groupObjects, ungroupObjects } from "./shapeOps.js";

// Bounding box utilities
export { getTransformedBounds, getUnionBounds, getBoundingBox, getSelectionBounds, objectsOverlap, objectContainsPoint, type Bounds } from "./bounds.js";

// Layer management operations (document-level, operate on FlashDocument)
export {
  addLayer as addLayerToDoc,
  deleteLayer as deleteLayerFromDoc,
  reorderLayer,
  renameLayer as renameLayerInDoc,
  duplicateLayer as duplicateLayerInDoc,
  setLayerCollapsed,
} from "./layers.js";

// Align and distribute operations
export type { AlignEdge, DistributeAxis } from "./align.js";
export { alignObjects, distributeObjects } from "./align.js";

// Scene management operations (document-level, operate on FlashDocument)
export {
  addScene as addSceneToDoc,
  deleteScene,
  reorderScene,
  renameScene as renameSceneInDoc,
  duplicateScene as duplicateSceneInDoc,
} from "./scenes.js";

// Library item management operations (document-level, operate on FlashDocument)
export {
  addLibraryItem as addLibraryItemToDoc,
  removeLibraryItem as removeLibraryItemFromDoc,
  updateLibraryItem as updateLibraryItemInDoc,
  duplicateLibraryItem,
  renameLibraryItemInDoc,
  deleteLibraryItem,
} from "./library.js";

// Onion skinning frame range computation
export type { OnionSkinFrame, OnionSkinOptions } from "./onionskin.js";
export { getOnionSkinFrames, getOnionSkinRange } from "./onionskin.js";

// Hit testing
export { hitTestPoint } from "./hittest.js";

// Pen tool path builder
export type { PenAnchorPoint, PenToolState } from "./pentool.js";
export {
  createPenState,
  addAnchorPoint,
  addSmoothPoint,
  closePenPath,
  penStateToShapePath,
  updateLastPoint,
} from "./pentool.js";

// Library item placement
export { placeLibraryItem } from "./libraryplace.js";

// Z-order operations
export { bringToFront, sendToBack, bringForward, sendBackward } from "./zorder.js";

// Brush tool stroke builder
export type { BrushPoint } from "./brushtool.js";
export { addBrushStroke } from "./brushtool.js";

// Display object factory helpers
export {
  createSymbolInstance,
  createTextInstance,
  createShapeInstance,
  isDisplayObject,
} from "./factory.js";

// Ink Bottle tool
export { applyInkBottle } from "./inkbottle.js";

// Paint Bucket tool
export { applyPaintBucket } from "./paintbucket.js";

// Document property helpers
export { withProperties } from "./document.js";

// Tween easing utilities
export { applyEase, lerp, tweenValue } from "./tween.js";

// Measurement unit conversion utilities
export { toPx, fromPx, convertUnits, formatMeasurement } from "./units.js";

// Gradient fill creation utilities
export {
  createLinearGradient,
  createRadialGradient,
  normalizeGradientRatios,
} from "./gradient.js";

// Validation utilities
export type { ValidationResult, PropertyValidationResult } from "./validate.js";
export { validateFrameScript, validateDocumentProperties } from "./validate.js";

// Lasso tool — Magic Wand flood-fill selection + Polygon close logic
export type {
  MagicWandSmoothing,
  BitmapRegion,
  PolygonLastClick,
} from "./magicWand.js";
export {
  DEFAULT_MAGIC_WAND_THRESHOLD,
  POLYGON_DOUBLE_CLICK_MS,
  POLYGON_CLOSE_DISTANCE,
  rgbDistance,
  floodFillPixels,
  buildMask,
  traceBoundary,
  douglasPeucker,
  chaikin,
  aabbPolygon,
  selectedPixelsToBoundingPolygon,
  magicWandSelectPixels,
  shouldClosePolygon,
  pointInPolygon,
} from "./magicWand.js";

// Bitmap tracing — Modify > Bitmap > Trace Bitmap (marching squares + Douglas-Peucker)
export type {
  BitmapTraceOptions,
  BitmapTraceImageData,
  TraceCurveFit,
  TraceCornerThreshold,
} from "./bitmapTrace.js";
export {
  DEFAULT_BITMAP_TRACE_OPTIONS,
  traceBitmapToPaths,
  tracedPathsToShape,
  marchingSquaresContour,
  simplifyPolyline,
  simplifyClosedPolygon,
  polygonToShapePath,
  curveFitEpsilon,
  curveFitSmooths,
  cornerThresholdAngle,
  nextTraceShapeId,
} from "./bitmapTrace.js";
