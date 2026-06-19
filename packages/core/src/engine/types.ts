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
  /**
   * Full gradient transform matrix (in pixel space), preserved from FLA import.
   * When present, the SWF encoder uses this instead of auto-fitting the gradient
   * to the shape's bounding box. Components a/b/c/d are in pixels per gradient
   * unit (gradient space spans ±1 in FLA / ±16384 twips in SWF); tx/ty are in pixels.
   * Absent for gradients created via the authoring UI (which uses `angle` only).
   */
  readonly matrix?: {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly tx: number;
    readonly ty: number;
  };
  /**
   * Gradient spread mode — controls what happens outside the 0–255 ratio range.
   *   "extend"  (default) — pad: extend the terminal stop colors.
   *   "reflect" — mirror the gradient alternately.
   *   "repeat"  — tile the gradient.
   * Maps to the SWF GRADIENT SpreadMode bits[7:6]: 0=pad, 1=reflect, 2=repeat.
   */
  readonly spreadMode?: "extend" | "reflect" | "repeat";
  /**
   * Color interpolation mode for the gradient.
   *   "rgb"       (default) — interpolate in sRGB space.
   *   "linearRGB" — interpolate in linear RGB space.
   * Maps to the SWF GRADIENT InterpolationMode bits[5:4]: 0=normal, 1=linearRGB.
   */
  readonly interpolation?: "rgb" | "linearRGB";
}

export interface RadialGradientFill {
  readonly type: "radial-gradient";
  readonly stops: readonly GradientColorStop[];
  /** Focal point offset: -1 to 1 along the x-axis of the gradient. */
  readonly focalPoint: number;
  /**
   * Full gradient transform matrix (in pixel space), preserved from FLA import.
   * When present, the SWF encoder uses this instead of auto-fitting the gradient
   * to the shape's bounding box. Components a/b/c/d are in pixels per gradient
   * unit (gradient space spans ±1 in FLA / ±16384 twips in SWF); tx/ty are in pixels.
   * Absent for gradients created via the authoring UI (which uses bounding-box fit).
   */
  readonly matrix?: {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly tx: number;
    readonly ty: number;
  };
  /**
   * Gradient spread mode — controls what happens outside the 0–255 ratio range.
   *   "extend"  (default) — pad: extend the terminal stop colors.
   *   "reflect" — mirror the gradient alternately.
   *   "repeat"  — tile the gradient.
   * Maps to the SWF GRADIENT SpreadMode bits[7:6]: 0=pad, 1=reflect, 2=repeat.
   */
  readonly spreadMode?: "extend" | "reflect" | "repeat";
  /**
   * Color interpolation mode for the gradient.
   *   "rgb"       (default) — interpolate in sRGB space.
   *   "linearRGB" — interpolate in linear RGB space.
   * Maps to the SWF GRADIENT InterpolationMode bits[5:4]: 0=normal, 1=linearRGB.
   */
  readonly interpolation?: "rgb" | "linearRGB";
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
  /**
   * Optional fill transform matrix (in pixel space).
   * Maps bitmap pixel coordinates to shape local pixel space.
   * If absent, an identity transform is assumed (bitmap origin = shape origin,
   * no scale/rotation beyond the standard pixel-to-twip mapping).
   * Components a/b/c/d are dimensionless; tx/ty are in pixels.
   */
  readonly matrix?: {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly tx: number;
    readonly ty: number;
  };
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

/** Width semantics for a stroke. Hairline (width 0) renders as 1px regardless of zoom. */
export type StrokeWidthType = "solid" | "hairline";

export interface SolidStroke {
  readonly type: "solid";
  readonly color: Color;
  readonly width: number;
  /** Defaults to "solid" when omitted. Hairline strokes use width 0. */
  readonly strokeType?: StrokeWidthType;
  readonly caps: StrokeCap;
  readonly joints: StrokeJoin;
  /** Miter limit ratio (only relevant when joints === 'miter'). Default 3. */
  readonly miterLimit: number;
  /** Stroke style (dash/dot/ragged/etc). Defaults to solid if omitted. */
  readonly style?: StrokeStyle;
  /**
   * Whether stroke coordinates snap to whole pixels.
   * Maps to SWF LINESTYLE2 PixelHintingFlag (bit 0 of flags).
   * Defaults to false when omitted.
   */
  readonly pixelHinting?: boolean;
  /**
   * Stroke scaling behavior when the containing object is scaled.
   *   "normal"     — stroke scales on both axes (default, omit to leave unset)
   *   "horizontal" — stroke scales only horizontally (sets NoVScale in SWF)
   *   "vertical"   — stroke scales only vertically (sets NoHScale in SWF)
   *   "none"       — stroke does not scale (sets NoHScale + NoVScale in SWF)
   * Defaults to "normal" (no NoScale flags set) when omitted.
   */
  readonly strokeScaleMode?: "normal" | "horizontal" | "vertical" | "none";
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
// Free Transform mesh warp (Distort / Envelope) — see ./warp.ts for the math.
// ---------------------------------------------------------------------------

/** The four mesh corners of a warp, in stage space. */
export interface WarpCorners {
  readonly nw: Point;
  readonly ne: Point;
  readonly se: Point;
  readonly sw: Point;
}

/**
 * Eight cubic-Bézier edge control points (envelope mode), in stage space.
 * Each edge is the cubic from its start corner through two controls to its end
 * corner. `t0/t1` are top (nw→ne), `r0/r1` right (ne→se), `b0/b1` bottom
 * (sw→se, left→right), `l0/l1` left (nw→sw, top→bottom).
 */
export interface WarpEdges {
  readonly t0: Point; readonly t1: Point;
  readonly r0: Point; readonly r1: Point;
  readonly b0: Point; readonly b1: Point;
  readonly l0: Point; readonly l1: Point;
}

/**
 * A non-affine mesh deformation applied to a display object by the Free
 * Transform Distort / Envelope modes.
 *
 *  - `mode: "distort"`  — only `corners` is used (bilinear interior).
 *  - `mode: "envelope"` — `corners` + `edges` (Coons-patch interior).
 *
 * `origBounds` is the object's transformed AABB at the moment the warp was
 * created; it defines the (u,v) parameterization so re-evaluating the warp is
 * stable across edits. When a `warp` is present on a display object the renderer
 * draws the warped geometry directly and ignores the affine scale/rotation/skew.
 */
export interface ShapeWarp {
  readonly mode: "distort" | "envelope";
  readonly origBounds: Rect;
  readonly corners: WarpCorners;
  readonly edges?: WarpEdges;
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
  /** Flash 8 color effect (CXFormWithAlpha). */
  readonly colorEffect?: ColorEffect;
  /** Cache as bitmap for filter rendering. Default: false. */
  readonly cacheAsBitmap?: boolean;
  /** Flash 8 filters applied to this object. */
  readonly filters?: readonly FlashFilter[];
  /**
   * Free Transform Distort / Envelope mesh warp. When present, the renderer
   * draws the warped geometry directly and the affine scale/rotation/skew are
   * superseded (matching Flash's distort/envelope behaviour).
   */
  readonly warp?: ShapeWarp;
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
  /** Alpha channel multiplier: -100..100. Used when type === "advanced". */
  readonly alphaMult?: number;
  /** Alpha channel offset: -255..255. Used when type === "advanced". */
  readonly alphaOffset?: number;
}

/**
 * A button event handler attached to a button instance placed on the stage.
 * Corresponds to an `on(event) {}` block in AS2.
 * Encoded as a BUTTONCONDACTION record in a per-instance DefineButton2 tag.
 * The same event vocabulary as the symbol-level ButtonAction in model/types.ts.
 *
 * The `event` field is either a plain event name string or `{ keyPress: key }`
 * for `on(keyPress "<key>")` handlers. The key is stored as the character (e.g.
 * `"a"`) or a named key string (e.g. `"<Left>"`, `"<Enter>"`).
 */
export interface ButtonHandler {
  readonly event:
    | "press"
    | "release"
    | "releaseOutside"
    | "rollOut"
    | "rollOver"
    | "dragOut"
    | "dragOver"
    | "idleToOverDown"
    | "overDownToIdle"
    | { readonly keyPress: string };
  /** AS2 source code for the handler body (not wrapped in on(){}). */
  readonly script: string;
}

/**
 * Accessibility properties for a display object (_accProps in AS2/Flash).
 * Exposed in the Flash 8 Window > Accessibility panel.
 */
export interface ObjectAccessibility {
  /** Whether this object is included in the accessibility tree. Default: true. */
  readonly enabled: boolean;
  /** MSAA Name string for screen readers. */
  readonly name?: string;
  /** MSAA Description string for screen readers. */
  readonly description?: string;
  /** Keyboard shortcut hint string. */
  readonly shortcut?: string;
  /** Tab index in the focus order (integer). */
  readonly tabIndex?: number;
  /**
   * When true, instructs Flash to expose this as a simple text object rather
   * than a container, suppressing its children from the accessibility tree.
   */
  readonly forceSimple?: boolean;
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
  /**
   * When true, this button instance behaves as a menu item (Track As Menu Item).
   * Pressing and dragging onto it activates it; releasing elsewhere still counts
   * as a release. Maps to the TrackAsMenu bit in the per-instance DefineButton2
   * tag emitted for this instance.
   * Only meaningful when the referenced symbol is a button.
   */
  readonly trackAsMenu?: boolean;
  /**
   * Accessibility properties for this instance (_accProps).
   * Surfaced in the Flash 8 Window > Accessibility panel.
   */
  readonly accessibility?: ObjectAccessibility;
  /** Cache as bitmap for filter rendering. Default: false. */
  readonly cacheAsBitmap?: boolean;
  /** Whether the instance is visible. Default: true. */
  readonly visible?: boolean;
  /** Registration point in pixels (relative to symbol origin). Absent when (0,0). */
  readonly registrationPoint?: { x: number; y: number };
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
  /** Free Transform Distort / Envelope mesh warp (see {@link ShapeWarp}). */
  readonly warp?: ShapeWarp;
}

export type TextType = "static" | "dynamic" | "input";
export type TextAlign = "left" | "center" | "right" | "justify";
/** Horizontal (default), vertical right-to-left, or vertical left-to-right. */
export type TextOrientation = "horizontal" | "vertical-rtl" | "vertical-ltr";

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
  /** Whether the object is visible. Default: true. */
  readonly visible?: boolean;
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
  /**
   * Layout orientation decoded from CPicText per-run vertical/rtl bytes.
   * Default: "horizontal" (omitted on the object when horizontal).
   */
  readonly orientation?: TextOrientation;
  readonly multiline: boolean;
  readonly wordWrap: boolean;
  /** Letter spacing / tracking in pixels. Default 0. */
  readonly letterSpacing?: number;
  /**
   * Baseline shift in pixels: a continuous vertical glyph offset applied to the
   * whole run. Positive raises the glyphs above the baseline (superscript-style),
   * negative lowers them below it (subscript-style). Default 0.
   *
   * This is independent of the discrete {@link characterPosition} super/subscript
   * (which Flash stores as a charPos byte and emits via HTML <sup>/<sub>):
   * baselineShift is a free numeric nudge of the run's vertical origin.
   *
   * Stage renderer: subtracts baselineShift from each line's y (canvas +y is down,
   * so a positive shift moves text up). SWF DefineText: subtracted from the
   * TEXTRECORD YOffset (twips), shifting the whole glyph run's baseline.
   */
  readonly baselineShift?: number;
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
  /**
   * Legacy AS1/AS2 variable name bound to this text field.
   * Maps to the DefineEditText VariableName field.
   * When non-empty, the text field's value is kept in sync with this ActionScript variable.
   */
  readonly as2VariableName?: string;
  /**
   * Flash 8 color effect applied to this text field's placement.
   * Encodes a CXFormWithAlpha in the PlaceObject2 tag.
   */
  readonly colorEffect?: ColorEffect;
  /** Flash 8 filters applied to this object. */
  readonly filters?: readonly FlashFilter[];
  /**
   * Flash 8 text anti-alias mode. Controls the rendering quality of the text field.
   *  - "device"       — use device fonts (no SWF embedding needed)
   *  - "bitmap"       — bitmap no anti-alias (UseDeviceFont bit, no CSM)
   *  - "animation"    — standard smoothing (default; no CSMTextSettings tag needed)
   *  - "readability"  — FlashType anti-alias for readability (CSMTextSettings tag 74)
   *  - "custom"       — custom sharpness/thickness (CSMTextSettings tag 74 with csm values)
   * Default: "animation" (standard smoothing, no extra tag emitted).
   */
  readonly antiAlias?: "device" | "bitmap" | "animation" | "readability" | "custom";
  /**
   * Custom CSM sharpness/thickness values — only used when antiAlias === "custom".
   * sharpness: -400 to 400; thickness: 0 to 200.
   */
  readonly csm?: { readonly sharpness: number; readonly thickness: number };
  /**
   * Whether characters are masked as password dots (input text only).
   * Maps to the DefineEditText Password bit (bit 4 of flags UI16).
   */
  readonly password?: boolean;
  /**
   * Maximum number of characters the user can enter (input text only).
   * 0 or undefined means no limit.
   * When > 0, sets HasMaxLength (bit 1) and writes a UI16 MaxLength field.
   */
  readonly maxChars?: number;
  /**
   * Whether a border rectangle is drawn around the text field.
   * Maps to the DefineEditText Border bit (bit 11 of flags UI16).
   */
  readonly hasBorder?: boolean;
  /**
   * Whether the text field has a background fill.
   * Maps to the DefineEditText HasBackground bit (bit 12 of flags UI16 — note: same
   * bit as NoSelect for static fields; for dynamic/input this bit enables background fill).
   *
   * NOTE: In the SWF spec, bit 12 is overloaded — for static text it is NoSelect, and
   * for dynamic/input it represents the background fill. In practice, the Flash authoring
   * tool stores a separate background color property. We model this as a boolean here and
   * the encoder applies it only for non-static text fields.
   */
  readonly hasBackground?: boolean;
  /**
   * Whether this text field contains HTML markup (multi-run rich text).
   * When true, the SWF DefineEditText HTML flag (bit 9) is set and
   * `htmlText` is used as the initial text content instead of `text`.
   */
  readonly html?: boolean;
  /**
   * HTML-formatted initial text content for rich text fields (html=true).
   * Uses Flash HTML subset: `<font face="..." size="..." color="...">`,
   * `<b>`, `<i>`, `<u>` tags.
   * Only used when `html` is true; otherwise `text` is the initial content.
   */
  readonly htmlText?: string;
  /**
   * Character restriction pattern for input text fields (input text only).
   * Limits which characters the user can type, e.g. "0-9" (digits only) or
   * "A-Za-z" (letters only). Follows the Flash TextField.restrict syntax.
   * DefineEditText has no built-in restrict field in the SWF spec — this is
   * emitted at runtime as a DoAction AS2 script:
   *   _root.<instanceName>.restrict = "<pattern>";
   * Requires instanceName to be set; ignored without a name.
   */
  readonly restrict?: string;
  /**
   * Whether the text field automatically resizes to fit its content.
   * Maps to DefineEditText AutoSize bit (bit 14 of flags UI16).
   * Default: false.
   */
  readonly autoSize?: boolean;
  /**
   * Character baseline position: 0 = normal, 1 = superscript, 2 = subscript.
   * Decoded from the charPos byte in the binary FLA text run fields.
   * In SWF output, superscript/subscript are represented via HTML <sup>/<sub>
   * tags in HTML text fields. Omitted when normal (0).
   */
  readonly characterPosition?: 0 | 1 | 2;
  /**
   * Whether the user can select the text at runtime (dynamic/input text only).
   * Controls the DefineEditText NoSelect bit (bit 12 of flags UI16) for
   * dynamic/input text: when false, NoSelect is set; when true (or undefined),
   * NoSelect is clear (text is selectable).
   * Default: true (selectable). Static text is always non-selectable.
   */
  readonly selectable?: boolean;
  /**
   * Whether the field applies the embedded font's kerning pairs ("Auto kern"
   * checkbox in the Flash 8 text Properties panel).
   *
   * When true and the field uses an embedded font, the SWF compiler emits the
   * DefineFont2/3 KerningTable and enables kerning on the field so the player
   * tightens/loosens specific glyph pairs (e.g. "AV", "To"). When false/omitted
   * the kerning table is not consulted and glyphs use plain advances.
   * Default: false.
   */
  readonly autoKern?: boolean;
  /**
   * Hyperlink URL for the text field ("Link" field in the Flash 8 text
   * Properties panel, bottom row). When non-empty, the SWF compiler wraps the
   * text content in an HTML anchor (`<a href="URL" target="TARGET">…</a>`) and
   * sets the DefineEditText HTML flag (bit 9) so the player renders a clickable
   * link (getURL/navigateToURL on click). Empty/omitted means no link.
   */
  readonly linkUrl?: string;
  /**
   * Hyperlink target window for the text field ("Target:" dropdown in the
   * Flash 8 text Properties panel). One of "_self", "_blank", "_parent",
   * "_top". Only meaningful when `linkUrl` is non-empty; emitted as the
   * anchor's `target` attribute. Omitted/empty means no explicit target.
   */
  readonly linkTarget?: string;
  /**
   * Embedded character ranges chosen via the "Embed…" (Character Embedding)
   * dialog in the Flash 8 text Properties panel. Each entry is a named glyph
   * range to embed in the published SWF font. When omitted (the default), the
   * compiler embeds the full glyph set (current behavior — byte-identical to
   * before this field existed). When present (even as an empty array), the
   * compiler subsets the DefineFont2/3 glyph table to the union of:
   *   - all named ranges in this array,
   *   - the specific characters in {@link embedChars}, and
   *   - the characters the field's own text strictly requires.
   * "all" is a shorthand range that embeds the entire printable-ASCII set.
   */
  readonly embedRanges?: readonly EmbedRange[];
  /**
   * Specific characters to embed, from the "Include these characters" text box
   * in the Character Embedding dialog. Combined (union) with {@link embedRanges}
   * and the field's own text to form the embedded glyph set. Only consulted when
   * {@link embedRanges} is present (i.e. the user has opted into subsetting).
   */
  readonly embedChars?: string;
}

/**
 * A named glyph range offered by the Character Embedding ("Embed…") dialog.
 * Mirrors the Flash 8 preset list. "all" embeds the whole printable-ASCII set.
 */
export type EmbedRange =
  | "all"
  | "uppercase"
  | "lowercase"
  | "numerals"
  | "punctuation";

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
  /** Skew (shear) in degrees, decomposed from the FLA placement matrix. */
  readonly skewX?: number;
  readonly skewY?: number;
  /** Opacity in range 0–1. Default: 1. */
  readonly alpha?: number;
  /** Whether the object is visible. Default: true. */
  readonly visible?: boolean;
  /** Flash 8 blend mode applied to this object. Default: "normal". */
  readonly blendMode?: 'normal' | 'layer' | 'multiply' | 'screen' | 'lighten' | 'darken' |
                       'difference' | 'add' | 'subtract' | 'invert' | 'alpha' | 'erase' |
                       'overlay' | 'hardlight';
  /** Color effect applied to this bitmap (CXFormWithAlpha). */
  readonly colorEffect?: ColorEffect;
  /** Cache as bitmap for filter rendering. Default: false. */
  readonly cacheAsBitmap?: boolean;
  /** Flash 8 filters applied to this object. */
  readonly filters?: readonly FlashFilter[];
  /** AS2 instance name — makes the bitmap accessible as _root.<name> in scripts. */
  readonly instanceName?: string;
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
