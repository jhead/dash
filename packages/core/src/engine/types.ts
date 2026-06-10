/**
 * Core geometry and rendering types for the Flash 8 vector engine.
 *
 * Flash uses quadratic Bézier curves (not cubic) internally, matching SWF
 * shape records. All coordinates are in pixels (convert at SWF boundary if needed).
 * Colors use 0–255 channels.
 */

import type { FlashFilter } from "./filters.js";

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

/** RGBA color with channels in the range 0–255. */
export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

// ---------------------------------------------------------------------------
// Fills
// ---------------------------------------------------------------------------

export interface SolidFill {
  readonly type: "solid";
  readonly color: Color;
}

export interface GradientColorStop {
  readonly ratio: number; // 0–255 (Flash SWF ratio)
  readonly color: Color;
}

export interface LinearGradientFill {
  readonly type: "linear-gradient";
  readonly stops: readonly GradientColorStop[];
  /** Gradient angle in degrees (0 = left-to-right). */
  readonly angle: number;
}

export interface RadialGradientFill {
  readonly type: "radial-gradient";
  readonly stops: readonly GradientColorStop[];
  /** Focal point offset: -1 to 1 along the x-axis of the gradient. */
  readonly focalPoint: number;
}

export interface BitmapFill {
  readonly type: "bitmap";
  /** Library item id of the BitmapItem to use. */
  readonly bitmapId: string;
  /**
   * Whether the bitmap tiles (repeat) or is clipped (no-repeat).
   * Corresponds to SWF fill types 0x40/0x42 (tiled) vs 0x41/0x43 (clipped).
   */
  readonly repeat: boolean;
  /**
   * Whether to use smoothed (bilinear) sampling.
   * Corresponds to SWF fill types 0x42/0x43 (smoothed) vs 0x40/0x41 (aliased).
   */
  readonly smooth: boolean;
}

// Union for fill types
export type Fill = SolidFill | LinearGradientFill | RadialGradientFill | BitmapFill;

// ---------------------------------------------------------------------------
// Strokes
// ---------------------------------------------------------------------------

export type StrokeCap = "none" | "round" | "square";
export type StrokeJoin = "miter" | "round" | "bevel";

// ---------------------------------------------------------------------------
// Stroke styles (Flash 8 Property Inspector style options)
// ---------------------------------------------------------------------------

export type StrokeStyleType =
  | "solid"
  | "dashed"
  | "dotted"
  | "ragged"
  | "stippled"
  | "hatched";

export interface StrokeStyleSolid {
  readonly type: "solid";
}

export interface StrokeStyleDashed {
  readonly type: "dashed";
  /** Length of each dash segment. Default 8. */
  readonly dashLength: number;
  /** Length of each gap between dashes. Default 4. */
  readonly gapLength: number;
}

export interface StrokeStyleDotted {
  readonly type: "dotted";
  /** Space between dots. Default 6. */
  readonly dotSpacing: number;
}

export interface StrokeStyleRagged {
  readonly type: "ragged";
  readonly roughness: "coarse" | "normal" | "fine";
  readonly pattern: "solid" | "simple" | "random";
  readonly waveHeight: "flat" | "wavy" | "wild";
}

export interface StrokeStyleStippled {
  readonly type: "stippled";
  readonly dotSize: "tiny" | "small" | "medium" | "large";
  readonly dotVariation: "oneSize" | "random" | "inTransition" | "randomTransition";
  readonly density: "veryDense" | "dense" | "sparse" | "verySparse";
}

export interface StrokeStyleHatched {
  readonly type: "hatched";
  readonly hatchThickness: "thin" | "medium" | "thick" | "varied";
  readonly space: "veryClose" | "close" | "distant" | "veryDistant";
  readonly jiggle: "none" | "slight" | "medium" | "wild";
  readonly rotate: "none" | "slight" | "medium" | "free";
  readonly curve: "straight" | "lightCurve" | "mediumCurve" | "veryCurved";
  readonly length: "equal" | "slightVariation" | "mediumVariation" | "random";
}

export type StrokeStyle =
  | StrokeStyleSolid
  | StrokeStyleDashed
  | StrokeStyleDotted
  | StrokeStyleRagged
  | StrokeStyleStippled
  | StrokeStyleHatched;

export interface SolidStroke {
  readonly type: "solid";
  readonly color: Color;
  readonly width: number;
  readonly caps: StrokeCap;
  readonly joints: StrokeJoin;
  /** Miter limit ratio (only relevant when joints === 'miter'). Default 3. */
  readonly miterLimit: number;
  /** Stroke style (dash/dot/ragged/etc). Defaults to solid if omitted. */
  readonly style?: StrokeStyle;
}

export type Stroke = SolidStroke;

// ---------------------------------------------------------------------------
// Path segments — quadratic Bézier (Flash's native curve format)
// ---------------------------------------------------------------------------

export interface LineSegment {
  readonly type: "line";
  readonly to: Point;
}

export interface CurveSegment {
  /** Quadratic Bézier: single control point + endpoint. */
  readonly type: "curve";
  readonly control: Point;
  readonly to: Point;
}

export type PathSegment = LineSegment | CurveSegment;

// ---------------------------------------------------------------------------
// Shape path
// ---------------------------------------------------------------------------

/**
 * A single contour within a shape. Each path has an optional fill and/or
 * stroke, a starting point, a list of segments, and a closed flag.
 */
export interface ShapePath {
  readonly start: Point;
  readonly segments: readonly PathSegment[];
  readonly fill?: Fill;
  readonly stroke?: Stroke;
  readonly closed: boolean;
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * A Flash vector shape — a collection of paths.
 * In merge-drawing mode shapes on the same layer interact (cut/merge).
 */
export interface Shape {
  readonly id: string;
  readonly paths: readonly ShapePath[];
}

// ---------------------------------------------------------------------------
// Display objects
// ---------------------------------------------------------------------------

/**
 * A raw vector shape placed on a layer in merge-drawing mode.
 */
export interface ShapeDisplayObject {
  readonly type: "shape";
  readonly id: string;
  readonly shape: Shape;
  /** X offset in pixels relative to the stage origin. */
  readonly x: number;
  readonly y: number;
  /** Horizontal scale factor (1 = no scale). Default: 1. */
  readonly scaleX?: number;
  /** Vertical scale factor (1 = no scale). Default: 1. */
  readonly scaleY?: number;
  /** Rotation in degrees (clockwise). Default: 0. */
  readonly rotation?: number;
  /** Horizontal skew in degrees. Default: 0. */
  readonly skewX?: number;
  /** Vertical skew in degrees. Default: 0. */
  readonly skewY?: number;
  /** Opacity in range 0–1. Default: 1. */
  readonly alpha?: number;
  /** Whether the object is visible. Default: true. */
  readonly visible?: boolean;
  /** Flash 8 blend mode. Default: "normal". */
  readonly blendMode?: 'normal' | 'layer' | 'multiply' | 'screen' | 'lighten' | 'darken' |
                       'difference' | 'add' | 'subtract' | 'invert' | 'alpha' | 'erase' |
                       'overlay' | 'hardlight';
  /** Cache as bitmap for filter rendering. Default: false. */
  readonly cacheAsBitmap?: boolean;
  /** Flash 8 filters applied to this object. */
  readonly filters?: readonly FlashFilter[];
}

/**
 * Color effect applied to a symbol instance (Flash 8 CXFORM-style).
 */
export interface ColorEffect {
  readonly type: "none" | "brightness" | "tint" | "alpha" | "advanced";
  /** Brightness adjustment: -100..100. Used when type === "brightness". */
  readonly brightness?: number;
  /** Tint color as CSS hex (e.g. "#ff0000"). Used when type === "tint". */
  readonly tintColor?: string;
  /** Tint amount: 0..100. Used when type === "tint". */
  readonly tintAmount?: number;
  /** Alpha: 0..100. Used when type === "alpha". */
  readonly alpha?: number;
  /** Red channel multiplier: -100..100. Used when type === "advanced". */
  readonly redMult?: number;
  /** Green channel multiplier: -100..100. Used when type === "advanced". */
  readonly greenMult?: number;
  /** Blue channel multiplier: -100..100. Used when type === "advanced". */
  readonly blueMult?: number;
  /** Red channel offset: -255..255. Used when type === "advanced". */
  readonly redOffset?: number;
  /** Green channel offset: -255..255. Used when type === "advanced". */
  readonly greenOffset?: number;
  /** Blue channel offset: -255..255. Used when type === "advanced". */
  readonly blueOffset?: number;
}

/**
 * A button event handler attached to a button instance placed on the stage.
 * Corresponds to an `on(event) {}` block in AS2.
 * Encoded as a BUTTONCONDACTION record in a per-instance DefineButton2 tag.
 * The same event vocabulary as the symbol-level ButtonAction in model/types.ts.
 */
export interface ButtonHandler {
  readonly event: "press" | "release" | "releaseOutside" | "rollOut" | "rollOver" | "dragOut" | "dragOver";
  /** AS2 source code for the handler body (not wrapped in on(){}). */
  readonly script: string;
}

/**
 * A clip event handler attached to a MovieClip instance.
 * Corresponds to an `onClipEvent(event) {}` block in AS2.
 * Encoded as a CLIPACTIONRECORD in the PlaceObject2/PlaceObject3 SWF tag.
 */
export interface ClipAction {
  /** The event that triggers this handler. */
  readonly event:
    | 'load'
    | 'enterFrame'
    | 'unload'
    | 'mouseMove'
    | 'mouseDown'
    | 'mouseUp'
    | 'keyDown'
    | 'keyUp'
    | 'data';
  /** AS2 source code for the handler body (not wrapped in onClipEvent{}). */
  readonly script: string;
}

/**
 * An instance of a library symbol placed on a layer.
 */
export interface SymbolInstance {
  readonly type: "instance";
  readonly id: string;
  readonly symbolId: string;
  readonly x: number;
  readonly y: number;
  /**
   * Natural (unscaled) width of the symbol in pixels, computed from the
   * union bounds of the symbol's first frame at placement time.
   * Used by the Align panel, Transform panel, and bounds helpers.
   */
  readonly naturalWidth?: number;
  /**
   * Natural (unscaled) height of the symbol in pixels, computed from the
   * union bounds of the symbol's first frame at placement time.
   * Used by the Align panel, Transform panel, and bounds helpers.
   */
  readonly naturalHeight?: number;
  /** Horizontal scale factor (1 = no scale). Default: 1. */
  readonly scaleX?: number;
  /** Vertical scale factor (1 = no scale). Default: 1. */
  readonly scaleY?: number;
  /** Rotation in degrees (clockwise). Default: 0. */
  readonly rotation?: number;
  /** Horizontal skew in degrees. Default: 0. */
  readonly skewX?: number;
  /** Vertical skew in degrees. Default: 0. */
  readonly skewY?: number;
  /** Opacity in range 0–1. Default: 1. */
  readonly alpha?: number;
  /** AS2 instance name (for getURL, attachMovie, onClipEvent, etc.). */
  readonly instanceName?: string;
  /** Color effect applied to this instance. */
  readonly colorEffect?: ColorEffect;
  /** Flash 8 filters applied to this instance. */
  readonly filters?: readonly FlashFilter[];
  /** Graphic symbol loop mode. Default: "loop". */
  readonly loopMode?: "loop" | "play-once" | "single-frame";
  /** Starting frame index for single-frame or play-once mode (0-based). Default: 0. */
  readonly firstFrame?: number;
  /** Flash 8 blend mode applied to this instance. Default: "normal". */
  readonly blendMode?: 'normal' | 'layer' | 'multiply' | 'screen' | 'lighten' | 'darken' |
                       'difference' | 'add' | 'subtract' | 'invert' | 'alpha' | 'erase' |
                       'overlay' | 'hardlight';
  /**
   * onClipEvent handlers attached to this MovieClip instance.
   * Encoded as CLIPACTIONRECORD entries in the PlaceObject2 HasClipActions block.
   * Only meaningful when the referenced symbol is a movieclip.
   */
  readonly clipActions?: readonly ClipAction[];
  /**
   * on() handlers attached to this button instance placed on the stage.
   * Encoded as BUTTONCONDACTION records in a per-instance DefineButton2 tag
   * that is emitted inline just before the PlaceObject2 for this instance.
   * Only meaningful when the referenced symbol is a button.
   */
  readonly buttonHandlers?: readonly ButtonHandler[];
}

/**
 * A drawing object (Flash Object Drawing mode) — a self-contained shape
 * that does not interact with other shapes via merge-drawing.
 */
export interface DrawingObject {
  readonly type: "drawing-object";
  readonly id: string;
  readonly shape: Shape;
  readonly x: number;
  readonly y: number;
  /** Flash 8 filters applied to this object. */
  readonly filters?: readonly FlashFilter[];
}

export type TextType = "static" | "dynamic" | "input";
export type TextAlign = "left" | "center" | "right" | "justify";

/**
 * A text display object placed on a layer.
 * Supports static, dynamic, and input text types with rich formatting.
 */
export interface TextDisplayObject {
  readonly type: "text";
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;   // bounding box width (auto-grow for static text)
  readonly height: number;  // bounding box height
  readonly text: string;
  readonly textType: TextType;
  readonly fontFamily: string;   // e.g. "Arial"
  readonly fontSize: number;     // pt
  readonly bold: boolean;
  readonly italic: boolean;
  /** Underline style decoration. Default false. */
  readonly underline?: boolean;
  readonly color: Color;
  readonly align: TextAlign;
  readonly multiline: boolean;
  readonly wordWrap: boolean;
  /** Letter spacing / tracking in pixels. Default 0. */
  readonly letterSpacing?: number;
  /**
   * Extra line spacing in pixels (added between lines). Default 0.
   * Maps to the DefineEditText HasLayout Leading field (SI16, in twips = px * 20).
   */
  readonly leading?: number;
  /**
   * Left paragraph margin in pixels. Default 0.
   * Maps to the DefineEditText HasLayout LeftMargin field (UI16, in twips = px * 20).
   */
  readonly leftMargin?: number;
  /**
   * Right paragraph margin in pixels. Default 0.
   * Maps to the DefineEditText HasLayout RightMargin field (UI16, in twips = px * 20).
   */
  readonly rightMargin?: number;
  /**
   * First-line indent in pixels. Default 0.
   * Maps to the DefineEditText HasLayout Indent field (UI16, in twips = px * 20).
   */
  readonly indent?: number;
  /** Whether this text field is scrollable (dynamic/input text only). Default false. */
  readonly scrollable?: boolean;
  /** AS2 instance name — makes the field accessible as _root.<name> in scripts. */
  readonly instanceName?: string;
  /** Flash 8 filters applied to this object. */
  readonly filters?: readonly FlashFilter[];
}

/**
 * A bitmap image placed on a layer, referencing a BitmapItem in the library.
 */
export interface BitmapDisplayObject {
  readonly type: "bitmap";
  readonly id: string;
  /** References the BitmapItem id in the library. */
  readonly libraryItemId: string;
  readonly x: number;
  readonly y: number;
  /** Display width in pixels (may differ from original image width). */
  readonly width: number;
  /** Display height in pixels (may differ from original image height). */
  readonly height: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly rotation?: number;
  /** Opacity in range 0–1. Default: 1. */
  readonly alpha?: number;
}

/**
 * An embedded video placed on a layer, referencing a VideoItem in the library.
 * Renders as a placeholder in the authoring canvas and as a placed
 * DefineVideoStream character in the published SWF.
 */
export interface VideoDisplayObject {
  readonly type: "video";
  readonly id: string;
  /** References the VideoItem id in the library. */
  readonly videoItemId: string;
  readonly x: number;
  readonly y: number;
  /** Display width in pixels (may differ from the video's native width). */
  readonly width: number;
  /** Display height in pixels (may differ from the video's native height). */
  readonly height: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly rotation?: number;
  /** Opacity in range 0–1. Default: 1. */
  readonly alpha?: number;
}

/**
 * A group of display objects treated as a single unit.
 * The group's (x, y) is the top-left of the bounding box of the grouped objects.
 * Children positions are relative to the group origin.
 */
export interface GroupObject {
  readonly id: string;
  readonly type: 'group';
  readonly x: number;
  readonly y: number;
  readonly children: readonly DisplayObject[];
}

export type DisplayObject = ShapeDisplayObject | SymbolInstance | DrawingObject | TextDisplayObject | BitmapDisplayObject | VideoDisplayObject | GroupObject;

// ---------------------------------------------------------------------------
// Scene graph
// ---------------------------------------------------------------------------

export interface SceneLayer {
  readonly id: string;
  readonly name: string;
  /** Layer type — mirrors model LayerType. Default 'normal'. */
  readonly type?: "normal" | "guide" | "guided" | "mask" | "masked" | "folder";
  readonly visible: boolean;
  readonly locked: boolean;
  readonly objects: readonly DisplayObject[];
  /** When true, objects in this layer are rendered as outlines only. */
  readonly outlineMode?: boolean;
  /** CSS hex color for the outline when outlineMode is true. */
  readonly outlineColor?: string;
}

export interface SceneGraph {
  readonly layers: readonly SceneLayer[];
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export interface Viewport {
  /** Stage X coordinate at the top-left of the canvas (pan offset). */
  readonly x: number;
  /** Stage Y coordinate at the top-left of the canvas (pan offset). */
  readonly y: number;
  /** Zoom factor: 1.0 = 100%, 2.0 = 200%, etc. */
  readonly zoom: number;
}
