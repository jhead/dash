/**
 * Flash 8 (and MX/MX2004/CS-era) binary FLA document payload parser.
 *
 * Real Macromedia Flash .fla files are OLE2 compound documents whose streams
 * ("Contents", "Page N", "Symbol N", "Media N") contain MFC CArchive-style
 * serialized C++ objects (CPicPage, CPicLayer, CPicFrame, CPicShape,
 * CPicSprite, CPicButton, CPicText, ...).
 *
 * The wire protocol implemented here is based on:
 *  - JPEXS "flacomdoc" (XFL -> binary FLA writer, byte-verified against real
 *    Flash output): field order/semantics for frames, layers, fills, strokes.
 *  - The "fla-decoder" reverse-engineering effort (Ghidra decompilation of
 *    flash.exe Serialize methods): schema-conditional field layout, shape
 *    edge encoding, recovery scanning.
 *
 * Anything not understood is skipped explicitly with a console.warn — never
 * silently mis-parsed. Write-back is out of scope.
 *
 * Capability map (what IS imported):
 *  - stage size / frame rate / background color (Contents stream)
 *  - scene list with display names; library symbol names + types
 *  - layers: name, type (normal/guide/guided/folder/mask), visibility,
 *    lock state, outline color
 *  - frames: span durations, labels (+comment flag), AS2 frame scripts as
 *    source text, tween-kind detection (motion / shape) from the key mode,
 *    shape tween start/end shapes extracted from the start and end keyframes
 *  - shapes: solid/gradient fills, solid strokes (width/caps/joins/miter),
 *    full edge geometry (lines + quadratic curves) with per-edge styles
 *  - symbol instances (sprite/button/graphic): placement matrix, library
 *    reference, instance name, color transform (CXFORM), Flash 8 filter list
 *    (drop-shadow/blur/glow/bevel/gradient-glow/gradient-bevel/color-matrix),
 *    and — for movieclip instances — onClipEvent() handler ActionScript
 *  - text fields: static/dynamic/input, content, font, size, color,
 *    bold/italic, alignment, wrap, instance name
 *
 * Explicitly NOT imported (warned at parse time):
 *  - Media N payloads (bitmaps, sounds, video) and bitmap placements
 *  - button instance on() handlers (no instance-level model field; the raw
 *    script is parsed but dropped by the mapper with a warning)
 *  - (blend modes are now decoded from the byte after the filter list)
 *  - bitmap and text-field filters (skipped; only symbol-instance filters are decoded)
 *  - convolution filters (no model type; silently dropped from the filter list)
 *  - sound attachments and envelopes
 *  - components, fonts library items
 *  - (symbol-instance accessibility AccProps are now decoded)
 *  - Flash 4-and-older frame scripts (stored as action records, not source)
 *
 * Units:
 *  - matrix a/b/c/d: 16.16 fixed point; tx/ty: twips (1/20 px)
 *  - shape edge coordinates: 8.8 fixed-point twips (1 px = 5120 units)
 */

import type { TweenEaseType } from "../model/types.js";

// ---------------------------------------------------------------------------
// Parsed-data types (intermediate representation, converted to the document
// model by ole.ts)
// ---------------------------------------------------------------------------

export interface Fla8Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  /** px */
  readonly tx: number;
  /** px */
  readonly ty: number;
}

export interface Fla8Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface Fla8GradientStop {
  /** 0-255 */
  readonly position: number;
  readonly color: Fla8Color;
}

export type Fla8Fill =
  | { kind: "solid"; color: Fla8Color }
  | {
      kind: "linear-gradient" | "radial-gradient";
      matrix: Fla8Matrix;
      stops: Fla8GradientStop[];
      focalRatio: number;
      /** Spread mode decoded from flow byte bits[7:6]: 0=pad, 1=reflect, 2=repeat */
      spreadMode?: number;
      /** True when flow byte bit[4] is set (linear RGB interpolation) */
      linearRGB?: boolean;
    }
  | {
      kind: "bitmap";
      matrix: Fla8Matrix;
      bitmapId: number;
      /** true = tiled (repeating), false = clipped (no-repeat). SWF 0x40/0x42 = tiled, 0x41/0x43 = clipped. */
      repeat: boolean;
      /** true = smoothed (bilinear), false = aliased. SWF 0x42/0x43 = smoothed, 0x40/0x41 = aliased. */
      smooth: boolean;
    }
  | { kind: "unknown" };

export interface Fla8Stroke {
  readonly color: Fla8Color;
  /** px */
  readonly width: number;
  readonly cap: "none" | "round" | "square";
  readonly join: "miter" | "round" | "bevel";
  readonly miterLimit: number;
  /**
   * Whether stroke coords snap to whole pixels (Flash 8+ "pixelHinting" property).
   * Maps to SWF LINESTYLE2 PixelHintingFlag (bit 0 of the flags first byte).
   */
  readonly pixelHinting: boolean;
  /**
   * Stroke scaling behavior when the containing object is scaled.
   * Flash binary encoding: 0=normal, 1=horizontal, 2=vertical, 3=none.
   *   normal     — stroke scales on both axes (default)
   *   horizontal — stroke scales only horizontally (NoVScale in SWF)
   *   vertical   — stroke scales only vertically (NoHScale in SWF)
   *   none       — stroke does not scale (NoHScale + NoVScale in SWF)
   */
  readonly scaleMode: "normal" | "horizontal" | "vertical" | "none";
}

export interface Fla8Edge {
  readonly kind: "line" | "curve";
  /** px, shape-local */
  readonly fromX: number;
  readonly fromY: number;
  readonly ctrlX: number;
  readonly ctrlY: number;
  readonly toX: number;
  readonly toY: number;
  /** 1-based style indices; 0 = none */
  readonly fill0: number;
  readonly fill1: number;
  readonly line: number;
}

export interface Fla8Shape {
  readonly type: "shape";
  readonly matrix: Fla8Matrix;
  readonly fills: Fla8Fill[];
  readonly strokes: Fla8Stroke[];
  readonly edges: Fla8Edge[];
  /**
   * Whether the shape is visible in the authoring tool.
   * Decoded from the CPicObjBase flags byte (bit 0 = visible).
   * Default: true. Only set to false when the object is explicitly hidden.
   */
  readonly visible?: boolean;
}

/**
 * Decoded CXFORM-style color transform from a symbol instance. Multipliers are
 * 8.8 fixed point (256 = 1.0); offsets are signed 0..255-scale additions.
 */
export interface Fla8ColorEffect {
  readonly rMult: number;
  readonly rOff: number;
  readonly gMult: number;
  readonly gOff: number;
  readonly bMult: number;
  readonly bOff: number;
  readonly aMult: number;
  readonly aOff: number;
}

/** Per-instance accessibility metadata (writeAccessibleData in flacomdoc). */
export interface Fla8Accessibility {
  /** false when the "silent" flag is set (object excluded from a11y tree). */
  readonly enabled: boolean;
  readonly name?: string;
  readonly description?: string;
  readonly shortcut?: string;
  readonly tabIndex?: number;
  readonly forceSimple?: boolean;
}

export interface Fla8Instance {
  readonly type: "instance";
  readonly kind: "sprite" | "button" | "graphic" | "unknown";
  readonly matrix: Fla8Matrix;
  /** 1-based "Symbol N" library stream number; 0 = unresolved */
  readonly libraryIndex: number;
  readonly instanceName: string;
  /** color transform applied to the instance, or null when identity/absent */
  readonly colorEffect: Fla8ColorEffect | null;
  /** Flash 8+ filters applied to the instance (empty array when none) */
  readonly filters: Fla8Filter[];
  /**
   * Flash 8 blend mode raw byte value (0–14).
   * 0 and 1 both mean "normal"; see BLEND_MODE_MAP in flash8-import.ts.
   */
  readonly blendMode: number;
  /**
   * Raw instance ActionScript source. For a movieclip (sprite) instance this is
   * the concatenated `onClipEvent(...) { ... }` blocks; for a button instance
   * the `on(...) { ... }` blocks. Empty string when the instance has no handler.
   */
  readonly script: string;
  /**
   * trackAsMenu flag for button instances (kind === "button" only).
   * When true the button behaves like a menu item: pressing and dragging onto it
   * activates it; releasing elsewhere still counts as a release.
   * Maps to the TrackAsMenu bit in the DefineButton2 SWF tag.
   */
  readonly trackAsMenu?: boolean;
  /**
   * Which frame of the symbol to start on (0-based). Only meaningful for
   * graphic symbols (kind === "graphic"). Default: 0.
   */
  readonly firstFrame: number;
  /**
   * How the graphic symbol animates on the parent timeline.
   * 0 = loop, 1 = play-once, 2 = single-frame.
   * Only meaningful for graphic symbols (kind === "graphic").
   */
  readonly loopMode: number;
  /**
   * Whether the instance is visible in the authoring tool.
   * Decoded from the CPicObjBase flags byte (bit 0 = visible).
   * Default: true. Only set to false when the object is explicitly hidden.
   */
  readonly visible?: boolean;
  /** Accessibility properties (_accProps) when the instance carries AccProp data. */
  readonly accessibility?: Fla8Accessibility;
  /** Registration point in FLA twip units (divide by 20 for pixels). 0/0 when absent. */
  readonly registrationX: number;
  readonly registrationY: number;
}

/** Horizontal (default), vertical right-to-left, or vertical left-to-right. */
export type Fla8TextOrientation = "horizontal" | "vertical-rtl" | "vertical-ltr";

export interface Fla8TextRun {
  readonly text: string;
  readonly fontName: string;
  /** pt */
  readonly fontSize: number;
  readonly color: Fla8Color;
  readonly bold: boolean;
  readonly italic: boolean;
  /** Line spacing (leading) in pixels. Default 0. */
  readonly leading?: number;
  /** First-line indent in pixels. Default 0. */
  readonly indent?: number;
  /** Left margin in pixels. Default 0. */
  readonly leftMargin?: number;
  /** Right margin in pixels. Default 0. */
  readonly rightMargin?: number;
  /** Letter spacing in pixels (may be negative). Default 0. */
  readonly letterSpacing?: number;
  /**
   * Character position: 0 = normal, 1 = superscript, 2 = subscript.
   * Decoded from the charPos byte in the CPicText run fields.
   * Omitted when normal (0).
   */
  readonly characterPosition?: 0 | 1 | 2;
  /** Whether this run enables embedded-font kerning ("Auto kern"). Omitted when false. */
  readonly autoKern?: boolean;
}

/** Map CPicText per-run vertical/rtl bytes to editor orientation (flacomdoc layout). */
export function textOrientationFromRunFields(
  vertical: boolean,
  rightToLeft: boolean,
): Fla8TextOrientation {
  if (!vertical) return "horizontal";
  return rightToLeft ? "vertical-rtl" : "vertical-ltr";
}

export interface Fla8Text {
  readonly type: "text";
  readonly matrix: Fla8Matrix;
  /** px */
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly fontName: string;
  /** pt */
  readonly fontSize: number;
  readonly color: Fla8Color;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly align: "left" | "center" | "right" | "justify";
  /** Field orientation from the first text run's vertical/rtl bytes. */
  readonly orientation: Fla8TextOrientation;
  readonly instanceName: string;
  readonly textType: "static" | "dynamic" | "input";
  readonly wordWrap: boolean;
  /** Whether this is a multiline text field (bit 0x10 of CPicText textFlags). */
  readonly multiline: boolean;
  /** Whether characters are masked as password dots (bit 0x04 of CPicText textFlags). */
  readonly password: boolean;
  /** Maximum number of characters the user can enter; 0 means unlimited. */
  readonly maxChars: number;
  /** Whether a border rectangle is drawn around the text field (bit 0x40 of CPicText textFlags). */
  readonly hasBorder: boolean;
  /** Whether a background fill is drawn behind the text field (bit 0x20 of CPicText textFlags). */
  readonly hasBackground: boolean;
  /** AS2 variable name bound to this text field (legacy ActionScript 1/2 binding). */
  readonly as2VariableName: string;
  /** Flash 8+ filters (empty array when none). */
  readonly filters: Fla8Filter[];
  /**
   * Instance-level color transform applied to this text field placement, or
   * null when identity/absent. Populated when a color effect block is present
   * in the CPicText record (Flash 8+ binary FLA schema ts >= 0x0d).
   */
  readonly colorEffect: Fla8ColorEffect | null;
  /**
   * All formatting runs in the text field. When a field has multiple runs
   * with different styling, this array has more than one entry. When empty
   * or containing a single entry, per-run styling is captured in the top-level
   * fontName/fontSize/color/bold/italic fields.
   */
  readonly runs: readonly Fla8TextRun[];
  /**
   * Whether the text field can be scrolled by the user at runtime.
   * Decoded from the scrollable byte in the CPicText tail (ts >= 9).
   * Byte layout (best-effort, no confirmed fixture): 4 bytes reserved,
   * 1 byte scrollable (0=no, 1=yes), 3 bytes reserved.
   * Default: false.
   */
  readonly scrollable: boolean;
  /**
   * Whether the text field auto-expands to fit its content.
   * Maps to DefineEditText AutoSize bit (bit 14 of flags UI16).
   * Default: false.
   */
  readonly autoExpand?: boolean;
  /** Line spacing (leading) from the first text run, in pixels. Default 0. */
  readonly leading?: number;
  /** First-line indent from the first text run, in pixels. Default 0. */
  readonly indent?: number;
  /** Left margin from the first text run, in pixels. Default 0. */
  readonly leftMargin?: number;
  /** Right margin from the first text run, in pixels. Default 0. */
  readonly rightMargin?: number;
  /** Letter spacing from the first text run, in pixels. Default 0. */
  readonly letterSpacing?: number;
  /**
   * Flash 8 text anti-alias mode decoded from the first run's renderMode byte (ts >= 0x0d).
   * 0=device, 1=bitmap, 2=animation, 3=readability, 4=custom.
   * Undefined for pre-Flash 8 format (ts < 0x0d).
   */
  readonly antiAlias?: "device" | "bitmap" | "animation" | "readability" | "custom";
  /**
   * Custom CSM sharpness/thickness from the first run (only set when antiAlias === 'custom').
   */
  readonly csm?: { readonly thickness: number; readonly sharpness: number };
  /**
   * Whether the text field is visible in the authoring tool.
   * Decoded from the CPicObjBase flags byte (bit 0 = visible).
   * Default: true. Only set to false when the object is explicitly hidden.
   */
  readonly visible?: boolean;
  /**
   * Whether the text field is selectable at runtime (dynamic/input text only).
   * Decoded from the first byte of the 2-byte "selectable flags + reserved" block
   * present when ts >= 5. Non-zero = selectable (default), zero = not selectable.
   * Default: true.
   */
  readonly selectable: boolean;
  /**
   * Whether the embedded font's kerning pairs are applied ("Auto kern").
   * Decoded from the first text run's autoKern byte. Default: false.
   */
  readonly autoKern: boolean;
  /**
   * Hyperlink URL from the first text run ("Link" field). Empty/omitted when
   * no link is set.
   */
  readonly linkUrl?: string;
  /**
   * Hyperlink target window from the first text run ("Target:" dropdown:
   * _self/_blank/_parent/_top). Empty/omitted when no link/target is set.
   */
  readonly linkTarget?: string;
}

export interface Fla8BitmapRef {
  readonly type: "bitmap";
  readonly matrix: Fla8Matrix;
  readonly mediaId: number;
  /** Flash 8+ filters (empty array when none). */
  readonly filters: Fla8Filter[];
  /**
   * Whether the bitmap placement is visible in the authoring tool.
   * Decoded from the CPicObjBase flags byte (bit 0 = visible).
   * Default: true. Only set to false when the object is explicitly hidden.
   */
  readonly visible?: boolean;
}

export interface Fla8VideoRef {
  readonly type: "video";
  readonly matrix: Fla8Matrix;
  /** Index into the "Media N" stream that carries the FLV payload. */
  readonly mediaId: number;
}

/**
 * CPicSwf — a placed embedded-SWF element on the timeline.
 *
 * Flash authoring lets users embed external SWF files as library symbols via
 * File > Import.  CPicSwf records the placement on stage.  The full byte layout
 * is variable-length (AS2 clip-event scripts, color transforms, instance names)
 * and not fully decoded; only the placement matrix is extracted.
 */
export interface Fla8SwfRef {
  readonly type: "swf";
  /** Approximate placement matrix extracted from the record header. */
  readonly matrix: Fla8Matrix;
  /**
   * Raw bytes of the whole CPicSwf record body (from the start of the
   * CPicObjBase header through the byte before the re-sync landing point).
   * The record tail is `[X]` (undecoded) per the format spec, so these bytes
   * are captured verbatim for lossless round-trip rather than dropped.
   */
  readonly rawBytes: Uint8Array;
}

export type Fla8Element = Fla8Shape | Fla8Instance | Fla8Text | Fla8BitmapRef | Fla8VideoRef | Fla8SwfRef;

/**
 * Custom cubic-Bézier ease curve decoded from the CPicFrame binary tail
 * (Flash 8+, frameVersionB >= 0x18). Coordinates follow the CSS cubic-bezier
 * convention: x1/x2 ∈ [0,1] (time), y1/y2 unconstrained (value progress).
 */
export interface Fla8EaseCurve {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface Fla8Frame {
  /** span length in frames (>= 1) */
  readonly duration: number;
  readonly label: string;
  readonly labelIsComment: boolean;
  readonly labelIsAnchor: boolean;
  readonly script: string;
  readonly keyMode: number;
  /**
   * Shape-tween blend mode: 0 = distributive (default), 1 = angular.
   * Only meaningful when keyMode indicates a shape tween.
   * Decoded from the shapeTweenBlend byte in the CPicFrame tail (after CPicMorphShape).
   */
  readonly shapeBlend: number;
  /**
   * Signed ease strength from field_190 (s16 acceleration per flacomdoc
   * TimelineConverter.writeUI16). Absolute value is magnitude 0..100; sign
   * encodes direction (XFL: negative = ease-out, positive = ease-in).
   */
  readonly motionEase: number;
  /** Ease direction decoded from field_190 sign (and custom curve when present). */
  readonly easeType: TweenEaseType;
  /**
   * Custom cubic-Bézier ease curve (Flash 8+). null = use `motionEase` instead.
   * Decoded from `useSingleEaseCurve` + `hasCustomEase` + per-property point data
   * in the CPicFrame tail when frameVersionB >= 0x18 (24).
   *
   * When `useSingleEaseCurve` is true this holds the single "all" curve (index 5).
   * When false this holds the "position" curve (index 0), falling back to the "all" curve.
   */
  readonly motionEaseCurve: Fla8EaseCurve | null;
  /**
   * Per-property ease curves decoded when `hasCustomEase !== 0` and
   * `useSingleEaseCurve === 0`.  Each entry is null when the property has no
   * custom curve.  Undefined when the frame predates Flash 8 ease data (fs < 24)
   * or when `useSingleEaseCurve` is true (use `motionEaseCurve` for all properties).
   *
   * Index mapping (same order as the binary):
   *   0 = position   → easeForPosition
   *   1 = rotation   → easeForRotation
   *   2 = scale      → easeForScale
   *   3 = color      → easeForColor
   *   4 = filters    → easeForFilters
   */
  readonly easeForPosition: Fla8EaseCurve | null;
  readonly easeForRotation: Fla8EaseCurve | null;
  readonly easeForScale: Fla8EaseCurve | null;
  readonly easeForColor: Fla8EaseCurve | null;
  readonly easeForFilters: Fla8EaseCurve | null;
  /** rotation mode: "none" | "auto" | "cw" | "ccw" */
  readonly motionRotate: "none" | "auto" | "cw" | "ccw";
  /** extra full rotations beyond the shortest-path interpolation */
  readonly motionRotateCount: number;
  /** orient to path: rotate the object to follow the motion-guide path tangent */
  readonly motionOrientToPath: boolean;
  /**
   * Snap the object's registration point to the motion-guide path.
   * Decoded from bit 0x02 of the orient-to-path/snap u32 in the CPicFrame tail
   * (fs > 13). Bit assignment is best-effort — no confirmed fixture available.
   * bit 0x01 = orientToPath, bit 0x02 = snap (matches XFL attribute ordering).
   */
  readonly motionSnap: boolean;
  /**
   * Sync graphic symbols with the parent timeline (motionTweenSync).
   * Decoded from keyMode bit 0x0800 (flacomdoc classic/motion tween flags).
   */
  readonly motionSync: boolean;
  /**
   * Whether to scale the tweened object during a motion tween.
   * Decoded from keyMode bit 0x0400 (flacomdoc motionTweenScale flag).
   * Default true in Flash 8 (scaling is on unless explicitly disabled).
   */
  readonly motionTweenScale: boolean;
  readonly soundId: number;
  /** raw sync byte: 0=event, 1=start, 2=stop, 3=stream; -1 when not present */
  readonly soundSync: number;
  /** number of times to repeat (0 = loop indefinitely); -1 when not present */
  readonly soundLoop: number;
  /** in-point sample offset (44100 Hz); undefined when not present */
  readonly inPoint?: number;
  /** out-point sample offset (44100 Hz); undefined when not present */
  readonly outPoint?: number;
  /** custom volume envelope points */
  readonly envelopePoints?: Array<{ pos: number; leftLevel: number; rightLevel: number }>;
  readonly elements: Fla8Element[];
}

export interface Fla8Layer {
  readonly name: string;
  /** 0=normal 1=guide 2=guided 3=folder 4=mask (5=masked in some versions) */
  readonly layerType: number;
  readonly hidden: boolean;
  readonly locked: boolean;
  /** Whether the layer is shown as outlines in the authoring tool */
  readonly outlineMode: boolean;
  readonly outlineColor: Fla8Color | null;
  readonly frames: Fla8Frame[];
  /**
   * Non-zero CArchive object-reference index of the parent layer in the binary
   * stream (read from the first 2 bytes of the CPicLayer trailer).
   * A non-zero value indicates this layer is a child of a mask/folder layer.
   * Zero means no parent (top-level layer).
   */
  readonly parentLayerRef: number;
}

export interface Fla8Timeline {
  readonly layers: Fla8Layer[];
}

export interface Fla8SymbolInfo {
  readonly name: string;
  /** 0=graphic 1=button 2=movieclip per observed Contents records */
  readonly typeByte: number | null;
  /**
   * AS2 linkage identifier (for attachMovie / ExportAssets).
   * Stored as a BomString immediately after the typeByte in the Contents stream.
   * Empty string when not set.
   */
  readonly linkageIdentifier: string;
  /**
   * AS2 class name (for `new ClassName()` / `Object.registerClass()`).
   * Decoded from the writeAsLinkage block in the Contents stream.
   * The writeAsLinkage block starts at a fixed offset of 41 bytes after the
   * end of the display-name BomString (s.end + 41) for MX2004+ unicode FLAs:
   *   +0: UI32 zero prefix (00 00 00 00)
   *   +4: asLinkageVersion byte (5 for MX2004, 7 for Flash 8/CS3)
   *   +5: flags byte (exportForAS | importForRS)
   *   +6: 3 zero bytes
   *   +9: BomString(linkageIdentifier) [real, may differ from heuristic one]
   *   after: BomString(linkageURL)
   *   after: BomString(className)   ← this field
   * Empty string when not set.
   */
  readonly className: string;
  /**
   * Whether the symbol is exported for ActionScript (Export for ActionScript checkbox).
   * Stored as a UI8 boolean flag after the linkageIdentifier BomString.
   * The exact byte order in the Contents stream (observed from real Flash 8 binaries):
   *   BomString: linkageIdentifier
   *   UI8: exportInFirstFrame (defaults to 1; only meaningful when exportForActionScript=1)
   *   UI8: exportForActionScript
   *   UI8: exportForRuntimeSharing
   *   UI8: importForRuntimeSharing
   */
  readonly exportForActionScript: boolean;
  readonly exportInFirstFrame: boolean;
  readonly exportForRuntimeSharing: boolean;
  readonly importForRuntimeSharing: boolean;
  /**
   * 9-slice scaling grid decoded from the Contents stream (Flash 8+).
   * Coordinates are in pixels (twips already divided by 20).
   * null when no scale9Grid is set for this symbol.
   */
  readonly scale9Grid: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  } | null;
  /**
   * Full library path of the symbol, including folder hierarchy.
   * Stored as a BomString immediately after the writeAsLinkage block tail:
   *   className BomString end
   *   + 1 byte (version indicator)
   *   + UI32LE (observed value: 2)
   *   + BomString(sourceFlaPath)  ← path of the originating .fla (may be empty)
   *   + BomString(fullPath)       ← this field: "FolderA/FolderB/SymbolName"
   *
   * Folder names in the path may end with "!" (Flash's expanded-folder indicator;
   * strip "!" before using as the folder display name).
   * Empty string when the symbol is at the root of the library (no folder).
   * When fullPath does not contain "/", the symbol is also at the root.
   */
  readonly fullPath: string;
}

export interface Fla8SoundInfo {
  readonly name: string;
  /**
   * AS2 linkage identifier for attachSound / new Sound(id).
   * Decoded from the BomString that follows the display-name BomString in
   * "Sound N" Contents-stream entries (same position as the symbol linkage
   * identifier after the typeByte in symbol entries).
   * Empty string when not set.
   */
  readonly linkageId: string;
  /**
   * Whether the sound is exported for ActionScript (attachSound / class).
   * Decoded from the UI8 flag immediately after the linkageId BomString in
   * "Sound N" Contents-stream entries.
   * false when not set or when the entry has no linkage block.
   */
  readonly exportForActionScript: boolean;
}

export interface Fla8VideoInfo {
  /** Library display name of the video item. */
  readonly name: string;
}

export interface Fla8FontInfo {
  /**
   * Library display name of the font item (usually the font family name,
   * e.g. "_sans", "Arial", "Times New Roman").
   * Decoded from the fixed-offset font-name field in the Contents stream
   * immediately after the "Font N" BomString stream reference.
   */
  readonly name: string;
  /**
   * Font family name as stored in the FLA (the actual typeface identifier).
   * In most cases identical to `name`.
   */
  readonly fontName: string;
}

export interface Fla8ContentsInfo {
  readonly formatVersion: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly frameRate: number | null;
  readonly backgroundColor: Fla8Color | null;
  /** page stream name -> scene display name */
  readonly sceneNames: Map<string, string>;
  /** symbol stream number -> info */
  readonly symbols: Map<number, Fla8SymbolInfo>;
  /** sound stream number -> info */
  readonly sounds: Map<number, Fla8SoundInfo>;
  /** video/media stream number -> info (for "Video N" or "Media N" FLV entries) */
  readonly videos: Map<number, Fla8VideoInfo>;
  /** font stream number -> info (for "Font N" embedded font library entries) */
  readonly fonts: Map<number, Fla8FontInfo>;
}

// ---------------------------------------------------------------------------
// Low-level reader
// ---------------------------------------------------------------------------

class FlaEofError extends Error {}

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new FlaEofError(
        `need ${n} bytes at 0x${this.pos.toString(16)}, only ${this.remaining()} left`,
      );
    }
  }
  u8(): number {
    this.need(1);
    return this.buf[this.pos++]!;
  }
  u16(): number {
    this.need(2);
    const v = this.buf[this.pos]! | (this.buf[this.pos + 1]! << 8);
    this.pos += 2;
    return v;
  }
  s16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  u32(): number {
    this.need(4);
    const v =
      this.buf[this.pos]! |
      (this.buf[this.pos + 1]! << 8) |
      (this.buf[this.pos + 2]! << 16) |
      (this.buf[this.pos + 3]! << 24);
    this.pos += 4;
    return v >>> 0;
  }
  s32(): number {
    const v = this.u32();
    return v >= 0x80000000 ? v - 0x100000000 : v;
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  f64(): number {
    this.need(8);
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8);
    this.pos += 8;
    return view.getFloat64(0, true /* little-endian */);
  }
  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }
  remaining(): number {
    return this.buf.length - this.pos;
  }
  eof(): boolean {
    return this.pos >= this.buf.length;
  }
}

function utf16le(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8));
  }
  return s;
}

function ascii(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

/**
 * Read an MFC/Flash CString. Handles all observed encodings:
 *  - u8 len + ASCII bytes                      (pre-MX2004 non-unicode)
 *  - FF FE FF + u8 len + UTF-16LE chars        (unicode "BomString")
 *  - FF FE FF FF + u16 len + UTF-16LE chars    (long unicode)
 *  - FF + u16 len + ASCII bytes                (long ASCII)
 */
function readCString(r: Reader): string {
  const b = r.u8();
  if (b === 0) return "";
  if (b < 0xff) return ascii(r.bytes(b));
  const ext = r.u16();
  if (ext === 0xfffe) {
    // unicode marker FF FE FF; next is the unicode length prefix
    let len = r.u8();
    if (len === 0xff) {
      len = r.u16();
      if (len === 0xffff) len = r.u32();
    }
    return len > 0 ? utf16le(r.bytes(len * 2)) : "";
  }
  if (ext === 0xffff) {
    const len = r.u32();
    return ascii(r.bytes(len));
  }
  return ascii(r.bytes(ext));
}

// ---------------------------------------------------------------------------
// MFC CArchive class-tag reader
// ---------------------------------------------------------------------------

type ClassTag =
  | { kind: "null" }
  | { kind: "class"; name: string; schema: number }
  | { kind: "object-backref" }
  | { kind: "bad"; tag: number };

/**
 * MFC CArchive class/object reference table.
 *
 * The serialization assigns each *referenceable* item a 1-based index drawn
 * from a SINGLE monotonically-increasing counter that advances on every object
 * header (every class-tag read). This is the exact inverse of flacomdoc's
 * writer (`AbstractConverter.useClass`):
 *
 *   // on first use of a class:
 *   definedClasses.put(className, 1 + definedClasses.size() + totalObjectCount);
 *   // on EVERY useClass call (NEWCLASS or backref):
 *   totalObjectCount++;
 *
 * So a class first declared after N earlier objects and C earlier class
 * declarations gets reference index `1 + C + N`, and that index is reused by
 * every later backref to the class — even though the running object counter
 * keeps climbing. Earlier implementations modelled a fixed "two slots per
 * class" table, which only happens to be correct while no objects have been
 * serialized between class declarations; in real streams (e.g. a CPicShape
 * first declared after several CPicFrame/CPicBitmap objects) the class index
 * is much higher (CPicShape = 16, not 9, in Magnet.fla Symbol 13), so its
 * backref tag `0x8010` was mis-read as an unrecognised tag.
 */
class ArchiveReader {
  /** className -> assigned 1-based reference index (fixed at first declaration) */
  private classIndex = new Map<string, number>();
  /** reference index -> className, for resolving backref tags */
  private nameByIndex = new Map<number, string>();
  /** number of class declarations seen so far */
  private definedCount = 0;
  /** running object counter (advances on every object header) */
  private objectCount = 0;
  readonly classNames: string[] = [];

  constructor(readonly r: Reader) {}

  registerClass(name: string): void {
    // Index assigned at declaration time, mirroring flacomdoc's useClass:
    //   1 + (classes defined before) + (objects written before)
    const index = 1 + this.definedCount + this.objectCount;
    if (!this.classIndex.has(name)) {
      this.classIndex.set(name, index);
      this.nameByIndex.set(index, name);
    }
    this.classNames.push(name);
    this.definedCount += 1;
    this.objectCount += 1;
  }

  /** Backref tag value for an already-declared class, or null. */
  classBackrefTag(name: string): number | null {
    const idx = this.classIndex.get(name);
    return idx === undefined ? null : 0x8000 | idx;
  }

  /** True if `idx` (1-based reference index) refers to a declared class. */
  isClassIndex(idx: number): boolean {
    return this.nameByIndex.has(idx);
  }

  readClassTag(): ClassTag {
    const tag = this.r.u16();
    if (tag === 0x0000) return { kind: "null" };
    if (tag === 0xffff) {
      const schema = this.r.u16();
      const nameLen = this.r.u16();
      if (nameLen === 0 || nameLen > 64) {
        throw new Error(`implausible class name length ${nameLen}`);
      }
      const name = ascii(this.r.bytes(nameLen));
      this.registerClass(name);
      return { kind: "class", name, schema };
    }
    if (tag === 0x7fff) {
      // extended backref: u32 index. Still counts as one object header.
      const idx = this.r.u32();
      this.objectCount += 1;
      const name = this.nameByIndex.get(idx);
      if (name !== undefined) return { kind: "class", name, schema: 0 };
      return { kind: "object-backref" };
    }
    if (tag & 0x8000) {
      const idx = tag & 0x7fff;
      this.objectCount += 1;
      const name = this.nameByIndex.get(idx);
      if (name !== undefined) return { kind: "class", name, schema: 0 };
      return { kind: "object-backref" };
    }
    // Unrecognised tag value — not a known MFC CArchive sentinel. Return a
    // "bad" marker so the caller can attempt recovery rather than throwing.
    return { kind: "bad", tag };
  }
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function fp1616(raw: number): number {
  const s = raw >= 0x80000000 ? raw - 0x100000000 : raw;
  return s / 65536;
}

function readMatrix(r: Reader): Fla8Matrix {
  const a = fp1616(r.u32());
  const b = fp1616(r.u32());
  const c = fp1616(r.u32());
  const d = fp1616(r.u32());
  const tx = r.s32() / 20;
  const ty = r.s32() / 20;
  return { a, b, c, d, tx, ty };
}

function readColorRGBA(r: Reader): Fla8Color {
  // byte order on the wire: R, G, B, A (verified against flacomdoc writeSolidFill)
  const cr = r.u8();
  const cg = r.u8();
  const cb = r.u8();
  const ca = r.u8();
  return { r: cr, g: cg, b: cb, a: ca };
}

/**
 * Edge coordinates are 8.8 fixed-point twips (verified against SWF shape
 * bounds published from the same FLAs): 1 px = 20 twips * 256 = 5120 units.
 */
const UTW = 5120;

// 10-byte object-tail signature: NULL child tag + 2x INT_MIN point sentinel.
const END_MARKER = [0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80] as const;

function findEndMarker(buf: Uint8Array, from: number): number {
  outer: for (let i = Math.max(0, from); i <= buf.length - END_MARKER.length; i++) {
    for (let j = 0; j < END_MARKER.length; j++) {
      if (buf[i + j] !== END_MARKER[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Skip the unparsed tail of an object by scanning forward for the next
 * object-tail signature, so the parent's children loop can resume at the
 * NULL tag. Used for classes whose trailing fields are not fully decoded.
 */
function skipToEndMarker(r: Reader): void {
  const idx = findEndMarker(r.buf, r.pos);
  if (idx >= 0 && idx < r.buf.length - 12) r.pos = idx;
  else r.pos = r.buf.length;
}

/**
 * Reposition after an element whose tail could not be fully consumed. Scans
 * for the nearest of:
 *   - a NEWCLASS tag followed by a plausible class declaration
 *   - a backref tag to a known class followed by a plausible CPicObj header
 *   - the parent's object-tail signature (NULL tag + INT_MIN point)
 * This avoids the failure mode of a bare end-marker scan landing inside a
 * SIBLING object whose registration point happens to be the INT_MIN sentinel.
 */
function skipToNextBoundary(ctx: ParseCtx): void {
  const { r, ar } = ctx;
  for (let i = r.pos; i <= r.buf.length - 2; i++) {
    const v = r.buf[i]! | (r.buf[i + 1]! << 8);
    if (v === 0xffff && i + 7 < r.buf.length) {
      const schema = r.buf[i + 2]! | (r.buf[i + 3]! << 8);
      const nameLen = r.buf[i + 4]! | (r.buf[i + 5]! << 8);
      const first = r.buf[i + 6]!;
      if (schema <= 0xff && nameLen >= 4 && nameLen <= 32 && first >= 0x41 && first <= 0x5a) {
        r.pos = i;
        return;
      }
    } else if ((v & 0x8000) !== 0 && v !== 0xffff && ar.isClassIndex(v & 0x7fff) && i + 4 < r.buf.length) {
      const schema = r.buf[i + 2]!;
      const flags = r.buf[i + 3]!;
      if (schema <= 0x10 && flags <= 0x40) {
        r.pos = i;
        return;
      }
    } else if (v === 0) {
      let match = true;
      for (let j = 2; j < END_MARKER.length; j++) {
        if (r.buf[i + j] !== END_MARKER[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        r.pos = i;
        return;
      }
    }
  }
  r.pos = r.buf.length;
}

/**
 * After an exact tail parse, verify the reader sits on a plausible boundary
 * (a class tag or the parent's NULL terminator); otherwise rescan.
 */
function verifyBoundary(ctx: ParseCtx): void {
  const { r, ar } = ctx;
  if (r.remaining() === 0) return;
  if (r.remaining() >= 2) {
    const v = r.buf[r.pos]! | (r.buf[r.pos + 1]! << 8);
    if (v === 0 || v === 0xffff) return;
    if ((v & 0x8000) !== 0 && ar.isClassIndex(v & 0x7fff)) return;
  }
  skipToNextBoundary(ctx);
}

/**
 * Optional accessibility block (writeAccessibleData / flacomdoc
 * AbstractConverter): absent when the leading version byte is 0; otherwise
 * carries accName, description, shortcut, tabIndex (MX2004+), forceSimple.
 */
function readAccessibilityMaybe(ctx: ParseCtx, mx2004Plus: boolean): Fla8Accessibility | undefined {
  const { r } = ctx;
  if (r.remaining() < 1 || r.buf[r.pos] === 0) return undefined;
  r.u8(); // accessibilityVersion
  r.u8(); // reserved
  r.u8();
  r.u8();
  const silent = r.u8() !== 0;
  r.u8();
  r.u8();
  r.u8();
  const name = readCString(r);
  const description = readCString(r);
  const shortcut = readCString(r);
  let tabIndex: number | undefined;
  if (mx2004Plus) {
    const tabIndexStr = readCString(r);
    readCString(r); // reserved empty BomString
    if (tabIndexStr.length > 0) {
      const parsed = Number.parseInt(tabIndexStr, 10);
      if (!Number.isNaN(parsed)) tabIndex = parsed;
    }
  }
  const forceSimple = r.u8() !== 0;
  r.skip(3); // reserved
  return {
    enabled: !silent,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(shortcut ? { shortcut } : {}),
    ...(tabIndex != null ? { tabIndex } : {}),
    ...(forceSimple ? { forceSimple: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Per-class deserializers
// ---------------------------------------------------------------------------

interface ParseCtx {
  ar: ArchiveReader;
  r: Reader;
  warnings: Set<string>;
  /**
   * End-shape geometry decoded from CPicMorphShape. Set by decodeMorphData()
   * while processing a shape-tween start keyframe, consumed by finishFrame()
   * when the subsequent end keyframe has no elements of its own.
   */
  pendingMorphEndShape?: Fla8Shape | null;
}

function warnOnce(ctx: ParseCtx, msg: string): void {
  if (!ctx.warnings.has(msg)) {
    ctx.warnings.add(msg);
    console.warn(`[FLA import] ${msg}`);
  }
}

interface CPicObjBase {
  schema: number;
  flags: number;
  children: ParsedNode[];
  /** Registration point in FLA twip units (1/20 px), or 0 when absent/sentinel. */
  regX: number;
  regY: number;
}

type ParsedNode =
  | { cls: "CPicPage"; layers: ParsedLayerNode[] }
  | ParsedLayerNode
  | ParsedFrameNode
  | { cls: "element"; element: Fla8Element }
  | { cls: "skipped"; name: string };

interface ParsedLayerNode {
  cls: "CPicLayer";
  layer: Fla8Layer;
}

interface ParsedFrameNode {
  cls: "CPicFrame";
  frame: Fla8Frame;
}

/**
 * CPicObj::Serialize base — schema, flags, children loop, registration point,
 * schema-conditional extras. Children are dispatched by class name.
 */
function readCPicObjBase(ctx: ParseCtx): CPicObjBase {
  const { r } = ctx;
  const schema = r.u8();
  const flags = r.u8();
  const children: ParsedNode[] = [];
  let badTag = false;
  for (;;) {
    let tag: ClassTag;
    try {
      tag = ctx.ar.readClassTag();
    } catch (err) {
      // EOF mid-children: treat as truncated stream (same as a premature null).
      if (err instanceof FlaEofError) {
        badTag = true;
        break;
      }
      throw err;
    }
    if (tag.kind === "null") break;
    if (tag.kind === "object-backref") {
      // Reuse of an existing object — rare; nothing to read for it.
      continue;
    }
    if (tag.kind === "bad") {
      // Unrecognised class tag — stream is misaligned or uses an unknown
      // encoding variant (e.g. 0x204 seen in real Flash 8 FLAs). Re-sync
      // to the next plausible object boundary. The post-loop registration-
      // point skips are skipped so the caller can resume from wherever the
      // re-sync landed.
      warnOnce(
        ctx,
        `unrecognised class tag 0x${tag.tag.toString(16)} @ 0x${(r.pos - 2).toString(16)} — skipping remaining children`,
      );
      skipToNextBoundary(ctx);
      badTag = true;
      break;
    }
    children.push(deserializeClass(tag.name, ctx));
  }
  let regX = 0;
  let regY = 0;
  if (!badTag) {
    if (schema > 0) {
      const rawX = r.s32();
      const rawY = r.s32();
      // INT_MIN sentinel (0x80000000) means no registration point set
      const INT_MIN = -2147483648;
      if (rawX !== INT_MIN && rawY !== INT_MIN) {
        regX = rawX;
        regY = rawY;
      }
    }
    if (schema > 2) r.skip(1);
    if (schema > 3) r.skip(1);
  }
  return { schema, flags, children, regX, regY };
}

/**
 * CPicObjBase visibility.
 *
 * Task 0932 assumed bit 0 (0x01) of the ObjBase flags byte was a per-display-object
 * "visible" flag. Empirically that is wrong: in the golden fixtures 17 of 19 ObjBase
 * records carry flags=0x0 and 2 carry flags=0x3, yet golden.swf (the Flash 8 reference)
 * renders ALL of them visible. So neither bit0=0 nor bit0=1 corresponds to "hidden",
 * and the old logic decoded the flags=0x0 majority (all scene objects) as hidden —
 * compile.ts then emitted zero-alpha CXForms and published a blank movie (task 1190).
 *
 * Flash 8 authoring has no per-display-object hide control (visibility is a LAYER
 * property, handled separately, and a runtime `_visible` set via ActionScript). There
 * is therefore no per-object hidden bit to decode here; display objects are always
 * visible at author time. Returning true unconditionally is both correct and the safe
 * default until a fixture proves a real per-object encoding exists.
 */
function visibleFromObjBaseFlags(_flags: number): boolean {
  return true;
}

function hiddenElementProp(visible: boolean): { visible?: false } {
  return visible ? {} : { visible: false };
}

function deserializeClass(name: string, ctx: ParseCtx): ParsedNode {
  try {
    switch (name) {
      case "CPicPage":
        return readCPicPage(ctx);
      case "CPicLayer":
        return readCPicLayer(ctx);
      case "CPicFrame":
        return readCPicFrameNode(ctx);
      case "CPicShape":
        return { cls: "element", element: readCPicShape(ctx).shape };
      case "CPicSprite":
        return { cls: "element", element: readCPicSprite(ctx) };
      case "CPicButton":
        return { cls: "element", element: readCPicButton(ctx) };
      case "CPicShapeObj":
      case "CPicSymbol":
        return { cls: "element", element: readCPicSymbolInstance(ctx, "graphic") };
      case "CPicText":
        return { cls: "element", element: readCPicText(ctx) };
      case "CPicBitmap":
        return { cls: "element", element: readCPicBitmapRef(ctx) };
      case "CPicVideo":
        return { cls: "element", element: readCPicVideo(ctx) };
      case "CPicSwf":
        return { cls: "element", element: readCPicSwf(ctx) };
      default: {
        // Unknown CPic*/CMorph* class: consume the CPicObj base if plausible,
        // then skip to the next object-tail signature.
        warnOnce(ctx, `class "${name}" is not supported; skipping its data`);
        try {
          readCPicObjBase(ctx);
        } catch (err) {
          if (!(err instanceof FlaEofError)) throw err;
        }
        skipToNextBoundary(ctx);
        return { cls: "skipped", name };
      }
    }
  } catch (err) {
    if (err instanceof FlaEofError) {
      warnOnce(ctx, `stream truncated while reading ${name}: ${String(err)}`);
      return { cls: "skipped", name };
    }
    throw err;
  }
}

// --- CPicPage ---------------------------------------------------------------

function readCPicPage(ctx: ParseCtx): ParsedNode {
  const { r } = ctx;
  const base = readCPicObjBase(ctx);
  try {
    const ps = r.u8();
    if (ps !== 4) r.skip(2);
    if (ps >= 5) r.skip(2);
    if (ps >= 7) r.skip(4);
    if (ps >= 3) {
      const cnt = r.u32();
      if (cnt > 0 && cnt < 10000) r.skip(cnt * 8);
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  const layers: ParsedLayerNode[] = [];
  for (const c of base.children) {
    if (c.cls === "CPicLayer") layers.push(c);
  }
  return { cls: "CPicPage", layers };
}

// --- CPicLayer ---------------------------------------------------------------

function readCPicLayer(ctx: ParseCtx): ParsedLayerNode {
  const { r } = ctx;
  const base = readCPicObjBase(ctx);

  let name = "";
  let layerType = 0;
  let hidden = false;
  let locked = false;
  let outlineMode = false;
  let outlineColor: Fla8Color | null = null;

  try {
    const ls = r.u8();
    name = readCString(r);
    if (ls <= 3) {
      // F1-F3: single state byte (0=hidden, 1=locked, 2=normal, 3=current)
      const state = r.u8();
      hidden = state === 0;
      locked = state === 1;
    } else {
      // F4+ layout (verified against flacomdoc writeLayerContents):
      // isSelected, hidden, locked, u32 sentinel(FFFFFFFF), RGBA outline color,
      // showOutlines, 7 bytes (heightMultiplier at [3]), layerType
      r.skip(1); // isSelected
      hidden = r.u8() !== 0;
      locked = r.u8() !== 0;
      r.skip(4); // 0xFFFFFFFF sentinel
      outlineColor = readColorRGBA(r);
      outlineMode = r.u8() !== 0; // showOutlines flag
      r.skip(7); // 00 00 00 heightMultiplier 00 00 00
      layerType = r.u8();
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }

  // Trailer (parent-layer ref / open / autoNamed encoding) is small and
  // version-dependent; rather than decoding it, scan forward (bounded) for
  // the nearest continuation: another CPicLayer backref tag, a NEWCLASS tag,
  // or the page object-tail signature.
  //
  // The first 2 bytes of the trailer encode a CArchive object-reference index
  // for the parent layer (0 = no parent).  We peek at them without advancing
  // r.pos so that repositionAfterLayerTrailer can still scan from the same
  // position it always did.
  const parentLayerRef =
    r.pos + 1 < r.buf.length
      ? (r.buf[r.pos]! | (r.buf[r.pos + 1]! << 8))
      : 0;
  repositionAfterLayerTrailer(ctx);

  const frames: Fla8Frame[] = [];
  for (const c of base.children) {
    if (c.cls === "CPicFrame") frames.push(c.frame);
  }
  return {
    cls: "CPicLayer",
    layer: { name, layerType, hidden, locked, outlineMode, outlineColor, frames, parentLayerRef },
  };
}

function repositionAfterLayerTrailer(ctx: ParseCtx): void {
  const { r, ar } = ctx;
  const layerTag = ar.classBackrefTag("CPicLayer");
  const limit = Math.min(r.buf.length - 2, r.pos + 96);
  for (let i = r.pos; i <= limit; i++) {
    const lo = r.buf[i]!;
    const hi = r.buf[i + 1]!;
    const v = lo | (hi << 8);
    if (layerTag !== null && v === layerTag) {
      r.pos = i;
      return;
    }
    if (v === 0xffff && i + 6 < r.buf.length) {
      // plausible NEWCLASS: u16 schema (<= 0xff) + u16 short name length + ASCII
      const schema = r.buf[i + 2]! | (r.buf[i + 3]! << 8);
      const nameLen = r.buf[i + 4]! | (r.buf[i + 5]! << 8);
      const first = r.buf[i + 6]!;
      if (schema <= 0xff && nameLen >= 4 && nameLen <= 32 && first >= 0x41 && first <= 0x5a) {
        r.pos = i;
        return;
      }
    }
    // page object-tail: NULL tag + INT_MIN point
    if (lo === 0 && hi === 0 && i + END_MARKER.length <= r.buf.length) {
      let match = true;
      for (let j = 2; j < END_MARKER.length; j++) {
        if (r.buf[i + j] !== END_MARKER[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        r.pos = i;
        return;
      }
    }
  }
  // Fallback: skip to the last plausible end marker (single-layer case).
  skipToEndMarker(r);
}

// --- CPicShape / shape geometry ----------------------------------------------

interface ShapeReadResult {
  shape: Fla8Shape;
  shapeSchema: number;
}

function readCPicShape(ctx: ParseCtx): ShapeReadResult {
  const { r } = ctx;
  const base = readCPicObjBase(ctx);
  const shapeSchema = r.u8();
  const matrix = readMatrix(r);
  const { fills, strokes, edges } = readShapeData(ctx, shapeSchema > 2);
  // Verify the reader is on a valid object boundary after shape data so that
  // any leftover version-specific bytes do not misalign subsequent reads.
  verifyBoundary(ctx);
  const visible = visibleFromObjBaseFlags(base.flags);
  return {
    shape: { type: "shape", matrix, fills, strokes, edges, ...hiddenElementProp(visible) },
    shapeSchema,
  };
}

function readFillStyle(ctx: ParseCtx, caps: boolean): Fla8Fill {
  const { r } = ctx;
  const color = readColorRGBA(r);
  const subtype = r.u8();
  r.skip(1); // more_flags
  if (subtype & 0x10) {
    // gradient; bit 0x02 distinguishes radial (0x12) from linear (0x10)
    const matrix = readMatrix(r);
    const numStops = r.u8();
    let focalRatio = 0;
    let spreadMode: number | undefined;
    let linearRGB: boolean | undefined;
    if (caps) {
      // F8+ gradient extras: focal*255, 0,0,0, flow|linearRGB, 0,0,0
      const focalByte = r.u8();
      focalRatio = focalByte > 127 ? (focalByte - 256) / 255 : focalByte / 255;
      r.skip(3); // three reserved/padding bytes after focal
      const flowByte = r.u8();
      spreadMode = (flowByte >> 6) & 0x3; // bits[7:6]: 0=pad,1=reflect,2=repeat
      linearRGB = ((flowByte >> 4) & 0x1) === 1; // bit[4]: 1=linearRGB
      r.skip(3); // three trailing padding bytes
    }
    const stops: Fla8GradientStop[] = [];
    // Consume EVERY stop's bytes so the reader stays aligned for the following
    // fill/stroke styles and edge records. The model only retains the first 15
    // (the SWF gradient limit), but stopping the read at 15 leaves the bytes for
    // stops 16+ in the stream and desyncs the rest of the shape — which dropped
    // the PlayButton BG layer's 16-stop gradient entirely (task 1192).
    for (let i = 0; i < numStops; i++) {
      const position = r.u8();
      const color = readColorRGBA(r);
      if (stops.length < 15) stops.push({ position, color });
    }
    return {
      kind: subtype & 0x02 ? "radial-gradient" : "linear-gradient",
      matrix,
      stops,
      focalRatio,
      ...(spreadMode !== undefined ? { spreadMode } : {}),
      ...(linearRGB !== undefined ? { linearRGB } : {}),
    };
  }
  if (subtype & 0x40) {
    const matrix = readMatrix(r);
    const bitmapId = r.u32();
    // SWF bitmap fill subtypes: 0x40=tiled/aliased, 0x41=clipped/aliased,
    // 0x42=tiled/smoothed, 0x43=clipped/smoothed.
    // Bit 0 set → clipped (no-repeat); bit 1 set → smoothed.
    const repeat = (subtype & 0x01) === 0;
    const smooth = (subtype & 0x02) !== 0;
    return { kind: "bitmap", matrix, bitmapId, repeat, smooth };
  }
  if (subtype & 0x20) {
    // Subtype 0x20 (bit 5 set, not a gradient (0x10) or bitmap (0x40)) is a
    // Flash-internal fill variant with a fixed-size header:
    //   gradient transform matrix (24 bytes via readMatrix) +
    //   4 bytes (likely an internal object ID or paint parameters) +
    //   8 bytes (likely F8 gradient extras or additional transform flags).
    //
    // Investigation (task 0858): this subtype appears in real Flash 8 FLA files
    // as the paint fill of a stroke (inside readLineStyle), but not as a shape
    // fill.  Analysis of worms.fla shows the 0x20 byte being encountered during
    // misaligned stream reads (parser reads frame-script text bytes as shape
    // data), so no confirmed binary specimen of a legitimately-stored 0x20 fill
    // was found.  Without a reference specimen the exact semantics are unknown.
    //
    // Best-effort mapping: treat as a solid fill using the base color that was
    // already read at the top of this function (the same color the authoring
    // tool would display for an undefined fill type).  The matrix and 12-byte
    // trailer are consumed to maintain stream alignment.
    readMatrix(r);
    r.skip(4 + 8);
    return { kind: "solid", color };
  }
  return { kind: "solid", color };
}

const CAP_STYLES = ["round", "none", "square"] as const;
const JOIN_STYLES = ["round", "bevel", "miter"] as const;

function readLineStyle(ctx: ParseCtx, caps: boolean): Fla8Stroke {
  const { r } = ctx;
  // Layout from flacomdoc writeStrokeBegin + writeSolidFill:
  //   RGBA, u16 width twips, u16 styleParam1, u16 styleParam2,
  //   F8+: pixelHinting, scaleMode, capStyle, joinStyle, miterFrac, miterInt
  //   then a full fill style (solid for plain strokes)
  const color = readColorRGBA(r);
  const widthTwips = r.u16();
  r.skip(4); // styleParam1 + styleParam2 (dash/dot/ragged parameters)
  let cap: Fla8Stroke["cap"] = "round";
  let join: Fla8Stroke["join"] = "round";
  let miterLimit = 3;
  let finalColor = color;
  let pixelHinting = false;
  let scaleMode: Fla8Stroke["scaleMode"] = "normal";
  if (caps) {
    // F8+ extras: pixel hinting, scale mode, caps/joins, miter, then the
    // stroke's paint as a full fill style. Pre-F8 strokes stop at the params.
    pixelHinting = r.u8() !== 0;
    const scaleModeRaw = r.u8();
    // Flash binary scaleMode encoding: 0=normal, 1=horizontal, 2=vertical, 3=none
    const SCALE_MODES = ["normal", "horizontal", "vertical", "none"] as const;
    scaleMode = SCALE_MODES[scaleModeRaw] ?? "normal";
    const capStyle = r.u8();
    const joinStyle = r.u8();
    const miterFrac = r.u8();
    const miterInt = r.u8();
    cap = CAP_STYLES[capStyle] ?? "round";
    join = JOIN_STYLES[joinStyle] ?? "round";
    miterLimit = miterInt + miterFrac / 256;
    const fill = readFillStyle(ctx, caps);
    if (fill.kind === "solid") finalColor = fill.color;
  }
  return { color: finalColor, width: widthTwips / 20, cap, join, miterLimit, pixelHinting, scaleMode };
}

function readCoordDelta(r: Reader, type: number): [number, number] {
  switch (type) {
    case 0:
      return [0, 0];
    case 1:
      return [r.s16(), r.s16()];
    case 2:
      return [r.s32(), r.s32()];
    case 3:
      return [r.s16() << 7, r.s16() << 7];
    default:
      throw new Error(`bad coord delta type ${type}`);
  }
}

function readShapeData(
  ctx: ParseCtx,
  caps: boolean,
): { fills: Fla8Fill[]; strokes: Fla8Stroke[]; edges: Fla8Edge[] } {
  const { r } = ctx;
  const schema = r.u8();
  r.skip(4); // edge count hint
  const fillCount = r.u16();
  const fills: Fla8Fill[] = [];
  for (let i = 0; i < fillCount; i++) {
    if (schema < 3) {
      // legacy: u32 color + u16 flags
      fills.push({ kind: "solid", color: readColorRGBA(r) });
      r.skip(2);
    } else {
      fills.push(readFillStyle(ctx, caps));
    }
  }
  const lineCount = r.u16();
  const strokes: Fla8Stroke[] = [];
  for (let i = 0; i < lineCount; i++) {
    strokes.push(readLineStyle(ctx, caps));
  }

  const edges: Fla8Edge[] = [];
  if (schema >= 2) {
    let curX = 0;
    let curY = 0;
    let fill0 = 0;
    let fill1 = 0;
    let line = 0;
    for (;;) {
      if (r.eof()) {
        warnOnce(ctx, "unexpected EOF inside shape edge stream");
        break;
      }
      const flags = r.u8();
      if (flags === 0) break;
      if (flags & 0x40) {
        // Style-change record. Order is stroke, fill0, fill1 (flacomdoc
        // FlaWriter.writeEdge). Bit 0x80 = "no selection info": bare u8
        // values; otherwise each u8 value is followed by a selection byte.
        if (flags & 0x80) {
          line = r.u8();
          fill0 = r.u8();
          fill1 = r.u8();
        } else {
          line = r.u8();
          r.skip(1);
          fill0 = r.u8();
          r.skip(1);
          fill1 = r.u8();
          r.skip(1);
        }
      }
      const t1 = flags & 3;
      const t2 = (flags >> 2) & 3;
      const t3 = (flags >> 4) & 3;
      const [dx1, dy1] = readCoordDelta(r, t1);
      const [dx2, dy2] = readCoordDelta(r, t2);
      const [dx3, dy3] = readCoordDelta(r, t3);
      const fromX = curX + dx1;
      const fromY = curY + dy1;
      let ctrlX = fromX + dx2;
      let ctrlY = fromY + dy2;
      const toX = fromX + dx3;
      const toY = fromY + dy3;
      let kind: Fla8Edge["kind"] = "curve";
      if (t2 === 0) {
        kind = "line";
        ctrlX = (fromX + toX) / 2;
        ctrlY = (fromY + toY) / 2;
      }
      edges.push({
        kind,
        fromX: fromX / UTW,
        fromY: fromY / UTW,
        ctrlX: ctrlX / UTW,
        ctrlY: ctrlY / UTW,
        toX: toX / UTW,
        toY: toY / UTW,
        fill0,
        fill1,
        line,
      });
      curX = toX;
      curY = toY;
    }
  }
  if (schema > 4 && r.remaining() >= 4) {
    // cubic-bezier post-stream: s32 count + 32 bytes per entry
    const cubicCount = r.s32();
    if (cubicCount > 0 && cubicCount * 32 <= r.remaining()) {
      r.skip(cubicCount * 32);
    } else if (cubicCount !== 0) {
      r.pos -= 4;
    }
  }
  return { fills, strokes, edges };
}

// --- Filter list (Flash 8+) ---------------------------------------------------
//
// Filters in the FLA binary use the same wire encoding as SWF §23:
//   u8 filterType, then filter-specific fields.
// Fixed16 = i32 little-endian (value / 65536.0).
// Fixed8  = i16 little-endian (value / 256.0).
// Angles in the SWF filter format are in radians stored as Fixed16.

export interface Fla8FilterDropShadow {
  readonly kind: "drop-shadow";
  readonly r: number; readonly g: number; readonly b: number; readonly a: number;
  readonly blurX: number; readonly blurY: number;
  /** radians */
  readonly angle: number;
  readonly distance: number;
  readonly strength: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly hideObject: boolean;
  readonly passes: number;
}

export interface Fla8FilterBlur {
  readonly kind: "blur";
  readonly blurX: number; readonly blurY: number;
  readonly passes: number;
}

export interface Fla8FilterGlow {
  readonly kind: "glow";
  readonly r: number; readonly g: number; readonly b: number; readonly a: number;
  readonly blurX: number; readonly blurY: number;
  readonly strength: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly passes: number;
}

export interface Fla8FilterBevel {
  readonly kind: "bevel";
  readonly highlightR: number; readonly highlightG: number;
  readonly highlightB: number; readonly highlightA: number;
  readonly shadowR: number; readonly shadowG: number;
  readonly shadowB: number; readonly shadowA: number;
  readonly blurX: number; readonly blurY: number;
  /** radians */
  readonly angle: number;
  readonly distance: number;
  readonly strength: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly onTop: boolean;
  readonly passes: number;
}

export interface Fla8FilterGradientStop {
  readonly r: number; readonly g: number; readonly b: number; readonly a: number;
  readonly ratio: number;
}

export interface Fla8FilterGradientGlow {
  readonly kind: "gradient-glow";
  readonly stops: Fla8FilterGradientStop[];
  readonly blurX: number; readonly blurY: number;
  /** radians */
  readonly angle: number;
  readonly distance: number;
  readonly strength: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly onTop: boolean;
  readonly compositeSource: boolean;
  readonly passes: number;
}

export interface Fla8FilterGradientBevel {
  readonly kind: "gradient-bevel";
  readonly stops: Fla8FilterGradientStop[];
  readonly blurX: number; readonly blurY: number;
  /** radians */
  readonly angle: number;
  readonly distance: number;
  readonly strength: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly onTop: boolean;
  readonly compositeSource: boolean;
  readonly passes: number;
}

export interface Fla8FilterColorMatrix {
  readonly kind: "color-matrix";
  /** 20-element 4×5 color matrix in row-major order */
  readonly matrix: readonly number[];
}

export interface Fla8FilterAdjustColor {
  readonly kind: "adjust-color";
  /** −100..100 */
  readonly brightness: number;
  /** −100..100 */
  readonly contrast: number;
  /** −100..100 */
  readonly saturation: number;
  /** −180..180 */
  readonly hue: number;
}

export interface Fla8FilterConvolution {
  readonly kind: "convolution";
  readonly matrixX: number;
  readonly matrixY: number;
  readonly matrix: readonly number[];
  readonly divisor: number;
  readonly bias: number;
  readonly defaultR: number;
  readonly defaultG: number;
  readonly defaultB: number;
  readonly defaultA: number;
  readonly clamp: boolean;
  readonly preserveAlpha: boolean;
}

export type Fla8Filter =
  | Fla8FilterDropShadow
  | Fla8FilterBlur
  | Fla8FilterGlow
  | Fla8FilterBevel
  | Fla8FilterGradientGlow
  | Fla8FilterGradientBevel
  | Fla8FilterColorMatrix
  | Fla8FilterAdjustColor
  | Fla8FilterConvolution;

/** SWF/FLA Fixed16: i32 little-endian, value = bits / 65536 */
function readFixed16(r: Reader): number {
  return r.s32() / 65536;
}

/** SWF/FLA Fixed8: i16 little-endian, value = bits / 256 */
function readFixed8(r: Reader): number {
  return r.s16() / 256;
}

function readOneFilter(r: Reader): Fla8Filter | null {
  const type = r.u8();
  switch (type) {
    case 0: { // DropShadow
      const cr = r.u8(); const cg = r.u8(); const cb = r.u8(); const ca = r.u8();
      const blurX = readFixed16(r);
      const blurY = readFixed16(r);
      const angle = readFixed16(r);
      const distance = readFixed16(r);
      const strength = readFixed8(r);
      const flags = r.u8();
      return {
        kind: "drop-shadow",
        r: cr, g: cg, b: cb, a: ca,
        blurX, blurY, angle, distance, strength,
        inner: (flags & 0x80) !== 0,
        knockout: (flags & 0x40) !== 0,
        hideObject: (flags & 0x20) === 0, // compositeSource=0x20 means "show" object; absent = hide
        passes: flags & 0x1f,
      };
    }
    case 1: { // Blur
      const blurX = readFixed16(r);
      const blurY = readFixed16(r);
      const flags = r.u8();
      return {
        kind: "blur",
        blurX, blurY,
        passes: (flags & 0xf8) >> 3,
      };
    }
    case 2: { // Glow
      const cr = r.u8(); const cg = r.u8(); const cb = r.u8(); const ca = r.u8();
      const blurX = readFixed16(r);
      const blurY = readFixed16(r);
      const strength = readFixed8(r);
      const flags = r.u8();
      return {
        kind: "glow",
        r: cr, g: cg, b: cb, a: ca,
        blurX, blurY, strength,
        inner: (flags & 0x80) !== 0,
        knockout: (flags & 0x40) !== 0,
        passes: flags & 0x1f,
      };
    }
    case 3: { // Bevel — SWF wire order is highlight then shadow (spec note)
      const hr = r.u8(); const hg = r.u8(); const hb = r.u8(); const ha = r.u8();
      const sr = r.u8(); const sg = r.u8(); const sb = r.u8(); const sa = r.u8();
      const blurX = readFixed16(r);
      const blurY = readFixed16(r);
      const angle = readFixed16(r);
      const distance = readFixed16(r);
      const strength = readFixed8(r);
      const flags = r.u8();
      return {
        kind: "bevel",
        highlightR: hr, highlightG: hg, highlightB: hb, highlightA: ha,
        shadowR: sr, shadowG: sg, shadowB: sb, shadowA: sa,
        blurX, blurY, angle, distance, strength,
        inner: (flags & 0x80) !== 0,
        knockout: (flags & 0x40) !== 0,
        onTop: (flags & 0x10) !== 0,
        passes: flags & 0x0f,
      };
    }
    case 4: // GradientGlow
    case 7: { // GradientBevel
      const numColors = r.u8();
      const colors: Array<{ r: number; g: number; b: number; a: number }> = [];
      for (let i = 0; i < numColors; i++) {
        colors.push({ r: r.u8(), g: r.u8(), b: r.u8(), a: r.u8() });
      }
      const stops: Fla8FilterGradientStop[] = [];
      for (let i = 0; i < numColors; i++) {
        const ratio = r.u8();
        stops.push({ ...colors[i]!, ratio });
      }
      const blurX = readFixed16(r);
      const blurY = readFixed16(r);
      const angle = readFixed16(r);
      const distance = readFixed16(r);
      const strength = readFixed8(r);
      const flags = r.u8();
      const gf = {
        stops, blurX, blurY, angle, distance, strength,
        inner: (flags & 0x80) !== 0,
        knockout: (flags & 0x40) !== 0,
        compositeSource: (flags & 0x20) !== 0,
        onTop: (flags & 0x10) !== 0,
        passes: flags & 0x0f,
      };
      return type === 4
        ? { kind: "gradient-glow" as const, ...gf }
        : { kind: "gradient-bevel" as const, ...gf };
    }
    case 5: { // ConvolutionFilter
      const matrixX = r.u8();
      const matrixY = r.u8();
      const readF32 = (): number => {
        const b = r.bytes(4);
        return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);
      };
      const divisor = readF32();
      const bias = readF32();
      const matrix: number[] = [];
      for (let i = 0; i < matrixX * matrixY; i++) matrix.push(readF32());
      const defaultR = r.u8();
      const defaultG = r.u8();
      const defaultB = r.u8();
      const defaultA = r.u8();
      const flags = r.u8();
      return {
        kind: "convolution" as const,
        matrixX,
        matrixY,
        matrix,
        divisor,
        bias,
        defaultR,
        defaultG,
        defaultB,
        defaultA,
        clamp: (flags & 0x01) !== 0,
        preserveAlpha: (flags & 0x02) !== 0,
      };
    }
    case 6: { // ColorMatrix
      const matrix: number[] = [];
      for (let i = 0; i < 20; i++) {
        const bytes = r.bytes(4);
        const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
        matrix.push(view.getFloat32(0, true));
      }
      return { kind: "color-matrix", matrix };
    }
    default:
      // Unknown filter type — cannot safely skip unknown-length data.
      return null;
  }
}

/**
 * Read the SWF-format filter list. `filterCount` is passed in (already consumed
 * by the caller). Returns the parsed filters; on a parse error the list is
 * truncated and the reader is positioned at EOF to trigger recovery.
 */
function readFilterList(r: Reader, filterCount: number): Fla8Filter[] {
  const filters: Fla8Filter[] = [];
  for (let i = 0; i < filterCount; i++) {
    if (r.eof()) break;
    try {
      const f = readOneFilter(r);
      if (f !== null) filters.push(f);
    } catch {
      // Parse error inside a filter record — can't safely continue.
      r.pos = r.buf.length;
      break;
    }
  }
  return filters;
}

/** Little-endian float32 reader for FLA filter records. */
function readF32(r: Reader): number {
  const b = r.bytes(4);
  return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);
}

/**
 * Read the FLA (authoring) filter list as stored inside a CPicText / display
 * object — this is NOT the SWF wire format (`readFilterList`/`readOneFilter`);
 * it is the wider authoring representation written by Flash's CArchive
 * serializer (verified against flacomdoc's `filters/*.java` writers and the
 * golden-v2 fixture authored by real Flash 8).
 *
 * Wire layout (caller has already consumed the leading 0x01 "has-filters"
 * marker byte and verified it is non-zero):
 *   UI32  filterCount
 *   for each filter: a fixed-length record keyed by its leading type byte.
 *
 * Each record's exact byte length is consumed even when the filter type is
 * not modelled, so the reader stays aligned for the trailing bytes and the
 * following CArchive children. Returns the decoded filters (unmodelled types
 * are skipped but still byte-consumed).
 */
function readFlaFilterList(ctx: ParseCtx, filterCount: number): Fla8Filter[] {
  const { r } = ctx;
  const filters: Fla8Filter[] = [];
  for (let i = 0; i < filterCount; i++) {
    if (r.remaining() < 3) break;
    const f = readOneFlaFilter(r);
    if (f) filters.push(f);
  }
  return filters;
}

/**
 * Read one FLA-format filter record. Field order / lengths follow flacomdoc's
 * `converter/filters/*.java` writers (byte-verified against real Flash 8).
 * Returns null for modelled-but-empty cases; throws FlaEofError on truncation.
 */
function readOneFlaFilter(r: Reader): Fla8Filter | null {
  const type = r.u8();
  switch (type) {
    case 0x00: { // DropShadow — 47 bytes total
      r.skip(2); // sub-header 04 01
      r.skip(4); // enabled + reserved
      const cr = r.u8(), cg = r.u8(), cb = r.u8(), ca = r.u8();
      const distance = readF32(r);
      const blurX = readF32(r);
      const blurY = readF32(r);
      const angle = readF32(r);
      const inner = r.u32() !== 0;
      const knockout = r.u32() !== 0;
      const quality = r.u32();
      const strength = r.u16() / 100; // percent
      r.skip(2); // strength hi reserved
      const hideObject = r.u8() !== 0;
      r.skip(3); // reserved
      return {
        kind: "drop-shadow",
        r: cr, g: cg, b: cb, a: ca,
        blurX, blurY, angle, distance, strength,
        inner, knockout, hideObject, passes: quality,
      };
    }
    case 0x01: { // Blur — 48 bytes total
      r.skip(3); // sub-header 03 04 01
      r.skip(4); // enabled + reserved
      r.skip(4); // ff ff ff ff reserved
      r.skip(4); // 5.0 constant
      const blurX = readF32(r);
      const blurY = readF32(r);
      r.skip(4); // 45deg constant
      r.skip(8); // reserved
      const quality = r.u32();
      r.skip(2); // 64 00 (strength-ish constant)
      r.skip(4); // reserved
      r.skip(2); // reserved
      return { kind: "blur", blurX, blurY, passes: quality };
    }
    case 0x02: { // Glow — 48 bytes total
      r.skip(3); // sub-header 03 04 01
      r.skip(4); // enabled + reserved
      const cr = r.u8(), cg = r.u8(), cb = r.u8(), ca = r.u8();
      r.skip(4); // 5.0 constant
      const blurX = readF32(r);
      const blurY = readF32(r);
      r.skip(4); // 45deg constant
      const inner = r.u32() !== 0;
      const knockout = r.u32() !== 0;
      const quality = r.u32();
      const strength = r.u16() / 100;
      r.skip(2); // strength hi reserved
      r.skip(4); // reserved
      return {
        kind: "glow",
        r: cr, g: cg, b: cb, a: ca,
        blurX, blurY, strength, inner, knockout, passes: quality,
      };
    }
    case 0x03: { // Bevel — 56 bytes total
      r.skip(3); // sub-header 03 04 01
      r.skip(4); // enabled + reserved
      const sr = r.u8(), sg = r.u8(), sb = r.u8(), sa = r.u8();
      const distance = readF32(r);
      const blurX = readF32(r);
      const blurY = readF32(r);
      const angle = readF32(r);
      const inner = r.u32() !== 0;
      const knockout = r.u32() !== 0;
      const quality = r.u32();
      const strength = r.u16() / 100;
      r.skip(2); // strength hi reserved
      r.skip(4); // reserved
      const hr = r.u8(), hg = r.u8(), hb = r.u8(), ha = r.u8();
      const onTop = r.u32() !== 0; // type == full
      return {
        kind: "bevel",
        highlightR: hr, highlightG: hg, highlightB: hb, highlightA: ha,
        shadowR: sr, shadowG: sg, shadowB: sb, shadowA: sa,
        blurX, blurY, angle, distance, strength,
        inner, knockout, onTop, passes: quality,
      };
    }
    case 0x04: // GradientGlow — 60 + 8*n bytes
    case 0x07: { // GradientBevel — 61 + 8*n bytes
      // GradientBevel has an extra leading byte before the 01 01 sub-header.
      if (type === 0x07) r.skip(1);
      r.skip(3); // sub-header 01 04 01
      r.skip(4); // enabled + reserved
      r.skip(4); // 00 00 00 ff reserved
      const distance = readF32(r);
      const blurX = readF32(r);
      const blurY = readF32(r);
      const angle = readF32(r);
      const inner = r.u32() !== 0;
      const knockout = r.u32() !== 0;
      const quality = r.u32();
      const strength = r.u16() / 100;
      r.skip(2); // strength hi reserved
      r.skip(4); // reserved
      const numEntries = r.u32();
      r.skip(4); // reserved
      const onTop = r.u32() !== 0; // type == full
      const stops: Fla8FilterGradientStop[] = [];
      for (let i = 0; i < numEntries && r.remaining() >= 8; i++) {
        const ratio = r.u8();
        r.skip(3); // reserved
        const cr = r.u8(), cg = r.u8(), cb = r.u8(), ca = r.u8();
        stops.push({ r: cr, g: cg, b: cb, a: ca, ratio });
      }
      const gf = {
        stops, blurX, blurY, angle, distance, strength,
        inner, knockout, compositeSource: false, onTop, passes: quality,
      };
      return type === 0x04
        ? { kind: "gradient-glow" as const, ...gf }
        : { kind: "gradient-bevel" as const, ...gf };
    }
    case 0x06: { // AdjustColor — 23 bytes total
      r.skip(2); // sub-header 01 01
      r.skip(4); // enabled + reserved
      const brightness = readF32(r);
      const contrast = readF32(r);
      const saturation = readF32(r);
      const hue = readF32(r);
      return { kind: "adjust-color" as const, brightness, contrast, saturation, hue };
    }
    default:
      // Unknown filter type — length unknown; signal recovery by jumping to EOF
      // so the caller's boundary scan re-syncs to the next class tag.
      throw new FlaEofError(`unknown FLA filter type 0x${type.toString(16)}`);
  }
}

// --- CPicSymbol / CPicSprite / CPicButton -------------------------------------

interface SymbolBaseFields {
  matrix: Fla8Matrix;
  libraryIndex: number;
  /** symbol schema byte: 8=F5, 0x0A=MX, 0x0E=MX2004, 0x13=F8/CS3, 0x16=CS4 */
  symbolSchema: number;
  /**
   * When true a filter parse error occurred so the remaining instance fields
   * (name, script, etc.) cannot be located reliably — callers should skip them.
   */
  filtersPresent: boolean;
  /** decoded color transform, or null if absent / identity-only */
  colorEffect: Fla8ColorEffect | null;
  /** Flash 8+ filters parsed from the filter list, or empty array */
  filters: Fla8Filter[];
  /** Flash 8 blend mode byte (0–14); 0 and 1 both mean "normal" */
  blendMode: number;
  /** Which frame of the symbol to start on (0-based). Default: 0. */
  firstFrame: number;
  /** How the graphic animates: 0=loop, 1=play-once, 2=single-frame. */
  loopMode: number;
  /**
   * Whether the instance is visible. Decoded from CPicObjBase flags bit 0
   * (0x01 = visible, 0x00 = hidden). Default: true.
   */
  visible: boolean;
  /** Registration point in FLA twip units, or 0/0 when absent. */
  regX: number;
  regY: number;
}

/**
 * CPicSymbol base fields (shared by CPicSprite / CPicButton / CPicShapeObj).
 * Layout verified against flacomdoc's symbol-instance writer:
 *   u8 symbolSchema, matrix, u16 firstFrame, u8 loopMode, u8 0,
 *   (>=F4) u8 1, (>=F2) color-effect block, (>=F3) CString "",
 *   u16 libraryIndex, u16 0, (>=MX2004) 3 bytes,
 *   (>=F8) u8 filterCount (+ filterCount×filterRecord) + u8 blend + 2 bytes,
 *   (>=CS4) 3D matrix block (102 bytes)
 */
function readCPicSymbolFields(ctx: ParseCtx): SymbolBaseFields {
  const { r } = ctx;
  const base = readCPicObjBase(ctx);
  const visible = visibleFromObjBaseFlags(base.flags);
  const symbolSchema = r.u8();
  const matrix = readMatrix(r);
  const firstFrame = r.u16(); // first frame (0-based)
  const loopMode = r.u8(); // loop mode: 0=loop, 1=play-once, 2=single-frame
  r.skip(1);
  if (symbolSchema >= 7) r.skip(1);
  let colorEffect: Fla8ColorEffect | null = null;
  if (symbolSchema >= 4) {
    // Color transform block (flacomdoc CPicSymbol color xform). Per channel a
    // u16 multiplier in 8.8 fixed point (0x0100 = 1.0) and an s16 offset
    // (-255..255). Channel order: (alpha,) red, green, blue. The alpha pair is
    // only present from schema 6 (MX) onward.
    let aMult = 256;
    let aOff = 0;
    if (symbolSchema >= 6) {
      aMult = r.u16();
      aOff = r.s16();
    }
    const rMult = r.u16();
    const rOff = r.s16();
    const gMult = r.u16();
    const gOff = r.s16();
    const bMult = r.u16();
    const bOff = r.s16();
    r.skip(2); // effect type + reserved (UI mode hint, redundant with the xform)
    r.skip(2); // value percent (UI slider value, redundant with the xform)
    r.skip(4); // effect color (UI tint color, redundant with the xform)
    colorEffect = { rMult, rOff, gMult, gOff, bMult, bOff, aMult, aOff };
  }
  if (symbolSchema >= 6) readCString(r); // always-empty string
  const libraryIndex = r.u16();
  r.skip(2);
  if (symbolSchema >= 0x0e) r.skip(3);
  let filtersPresent = false;
  let filters: Fla8Filter[] = [];
  let blendMode = 0;
  if (symbolSchema >= 0x13) {
    // filterCount byte: 0 = no filters; >0 = that many SWF-format filter records.
    const filterCount = r.u8();
    if (filterCount > 0) {
      const savedPos = r.pos;
      try {
        filters = readFilterList(r, filterCount);
        // After filters: blend mode (u8) + 2 reserved bytes.
        blendMode = r.u8();
        r.skip(2); // 2 reserved bytes
        // If filterList parsing left the reader at EOF, recovery is needed.
        if (r.eof() && savedPos < r.buf.length) {
          filtersPresent = true; // signal that the trailer may be misaligned
        }
      } catch {
        filtersPresent = true; // parse error; trailing fields unreliable
      }
    } else {
      blendMode = r.u8(); // blend mode byte
      r.skip(2); // 2 reserved bytes
    }
  }
  if (!filtersPresent && symbolSchema >= 0x16) {
    r.skip(102); // CS4 3D transform block
  }
  return { matrix, libraryIndex, symbolSchema, filtersPresent, colorEffect, filters, blendMode, firstFrame, loopMode, visible, regX: base.regX, regY: base.regY };
}

const DEFAULT_FIELDS: SymbolBaseFields = {
  matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  libraryIndex: 0,
  symbolSchema: 0,
  filtersPresent: false,
  colorEffect: null,
  filters: [],
  blendMode: 0,
  firstFrame: 0,
  loopMode: 0,
  visible: true,
  regX: 0,
  regY: 0,
};

function readCPicSymbolInstance(ctx: ParseCtx, kind: Fla8Instance["kind"]): Fla8Instance {
  let fields = DEFAULT_FIELDS;
  try {
    fields = readCPicSymbolFields(ctx);
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  // Graphic instances end right after the symbol base fields.
  verifyBoundary(ctx);
  return {
    type: "instance",
    kind,
    matrix: fields.matrix,
    libraryIndex: fields.libraryIndex,
    instanceName: "",
    colorEffect: fields.colorEffect,
    filters: fields.filters,
    blendMode: fields.blendMode,
    script: "",
    firstFrame: fields.firstFrame,
    loopMode: fields.loopMode,
    registrationX: fields.regX,
    registrationY: fields.regY,
    ...hiddenElementProp(fields.visible),
  };
}

function plausibleName(name: string): boolean {
  return name.length < 64 && /^[\x20-\x7e]*$/.test(name);
}

function readCPicSprite(ctx: ParseCtx): Fla8Instance {
  const { r } = ctx;
  let fields = DEFAULT_FIELDS;
  let instanceName = "";
  let script = "";
  let accessibility: Fla8Accessibility | undefined;
  try {
    fields = readCPicSymbolFields(ctx);
    if (!fields.filtersPresent) {
      const g = r.u8(); // sprite trailer version (3=F5, 6=MX, 8=MX2004+)
      if (g >= 3) {
        const sub = readTimelineSubObject(r); // instance id block + script
        if (sub.script) script = sub.script;
      }
      const name = readCString(r);
      if (plausibleName(name)) instanceName = name;
      if (g >= 6) {
        r.skip(9); // reserved block
        accessibility = readAccessibilityMaybe(ctx, g >= 8);
        r.skip(8);
        if (g >= 8) {
          r.skip(5);
          readCString(r); // component metadata XML
        }
      } else if (g >= 3) {
        r.skip(5);
      }
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  verifyBoundary(ctx);
  return {
    type: "instance",
    kind: "sprite",
    matrix: fields.matrix,
    libraryIndex: fields.libraryIndex,
    instanceName,
    colorEffect: fields.colorEffect,
    filters: fields.filters,
    blendMode: fields.blendMode,
    script,
    firstFrame: fields.firstFrame,
    loopMode: fields.loopMode,
    registrationX: fields.regX,
    registrationY: fields.regY,
    ...(accessibility ? { accessibility } : {}),
    ...hiddenElementProp(fields.visible),
  };
}

function readCPicButton(ctx: ParseCtx): Fla8Instance {
  const { r } = ctx;
  let fields = DEFAULT_FIELDS;
  let instanceName = "";
  let script = "";
  let trackAsMenu = false;
  let accessibility: Fla8Accessibility | undefined;
  try {
    fields = readCPicSymbolFields(ctx);
    if (!fields.filtersPresent) {
      const b = r.u8(); // button trailer version (5=F5, 8=MX, 0x0B=MX2004+)
      if (b >= 5) {
        const sub = readTimelineSubObject(r);
        if (sub.script) script = sub.script;
        trackAsMenu = r.u8() !== 0;
        const name = readCString(r);
        if (plausibleName(name)) instanceName = name;
        if (b >= 8) accessibility = readAccessibilityMaybe(ctx, b >= 0x0b);
        r.skip(4);
      }
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  verifyBoundary(ctx);
  return {
    type: "instance",
    kind: "button",
    matrix: fields.matrix,
    libraryIndex: fields.libraryIndex,
    instanceName,
    colorEffect: fields.colorEffect,
    filters: fields.filters,
    blendMode: fields.blendMode,
    script,
    firstFrame: fields.firstFrame,
    loopMode: fields.loopMode,
    registrationX: fields.regX,
    registrationY: fields.regY,
    ...(trackAsMenu ? { trackAsMenu } : {}),
    ...(accessibility ? { accessibility } : {}),
    ...hiddenElementProp(fields.visible),
  };
}

// --- CPicBitmap ----------------------------------------------------------------

function readCPicBitmapRef(ctx: ParseCtx): Fla8BitmapRef {
  const { r } = ctx;
  const base = readCPicObjBase(ctx);
  const visible = visibleFromObjBaseFlags(base.flags);
  let matrix: Fla8Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  let mediaId = 0;
  let filters: Fla8Filter[] = [];
  try {
    const schema = r.u8();
    matrix = readMatrix(r);
    mediaId = r.u16();
    if (schema >= 2) {
      // filterCount byte: 0 = no filters; >0 = SWF-format filter records (same
      // layout as symbol-instance filters).
      const filterCount = r.u8();
      if (filterCount > 0) {
        try {
          filters = readFilterList(r, filterCount);
        } catch {
          // Parse error inside filter data — skip to the record boundary.
          skipToNextBoundary(ctx);
        }
      }
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  verifyBoundary(ctx);
  return { type: "bitmap", matrix, mediaId, filters, ...hiddenElementProp(visible) };
}

// --- CPicVideo ----------------------------------------------------------------
//
// CPicVideo is a video object placed on the timeline, analogous to CPicBitmap
// for bitmap instances. The binary layout (inferred from flacomdoc and the
// fla-decoder reference; no fixture FLA with video was available to verify):
//
//   CPicObjBase  (schema byte + flags byte + null child tag)
//   UI8          schema  (version byte, same pattern as CPicBitmap)
//   4×4 matrix   (16.16 fixed-point + tx/ty in twips)
//   UI16         mediaId — matches the "Media N" OLE stream with the FLV payload
//
// No filter fields are documented for CPicVideo in Flash 8; if future evidence
// shows otherwise, add filter parsing here (same as readCPicBitmapRef).

function readCPicVideo(ctx: ParseCtx): Fla8VideoRef {
  const { r } = ctx;
  readCPicObjBase(ctx);
  let matrix: Fla8Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  let mediaId = 0;
  try {
    r.skip(1); // schema version byte
    matrix = readMatrix(r);
    mediaId = r.u16();
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  verifyBoundary(ctx);
  return { type: "video", matrix, mediaId };
}

// --- CPicSwf ------------------------------------------------------------------
//
// CPicSwf is a placed embedded-SWF element.  Flash authoring lets users embed
// external SWF files as library symbols via File > Import; CPicSwf records the
// placement on the timeline.
//
// Binary layout (CS2 FLA, verified against Magnet.fla which has four instances):
//   CPicObjBase     (schema byte + flags byte + null child tag + registration point)
//   UI8             symbolSchema (observed: 6 or 7 in CS2 FLAs)
//   4×4 matrix      (16.16 fixed-point + tx/ty in twips, 24 bytes via readMatrix)
//   <variable tail> AS2 clip-event scripts (BomStrings), color transforms,
//                   instance name, loop/frame options — NOT fully decoded.
//
// The variable tail is 950-5500 bytes per instance (depending on embedded AS2
// scripts).  skipToNextBoundary() re-syncs the reader after the fixed header.

function readCPicSwf(ctx: ParseCtx): Fla8SwfRef {
  const { r } = ctx;
  // Record-body start: the byte after the CArchive class tag (the CPicObjBase
  // schema byte). We capture from here through the re-sync landing point so the
  // undecoded variable tail is preserved verbatim for lossless round-trip
  // (§16 / §18: the CPicSwf tail is [X] — only the placement matrix is decoded).
  const bodyStart = r.pos;
  let matrix: Fla8Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  try {
    readCPicObjBase(ctx);
    r.skip(1); // symbolSchema version byte (observed: 6 or 7 in CS2 FLAs)
    matrix = readMatrix(r);
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  // Skip the variable-length tail to re-sync at the next sibling element.
  skipToNextBoundary(ctx);
  // Copy the consumed range (the parse buffer subarray is a view into a stream
  // buffer that may be reused; slice to own the bytes).
  const rawBytes = r.buf.slice(bodyStart, r.pos);
  return { type: "swf", matrix, rawBytes };
}

// --- CPicText ------------------------------------------------------------------

interface TextRun {
  fontName: string;
  sizePt: number;
  color: Fla8Color;
  bold: boolean;
  italic: boolean;
  align: number;
  /** 0=normal, 1=superscript, 2=subscript */
  characterPosition: 0 | 1 | 2;
  vertical: boolean;
  rightToLeft: boolean;
  rotation: boolean;
  /** Line spacing (leading) in FLA units (divide by 20 for pixels). */
  leading: number;
  /** First-line indent in FLA units. */
  indent: number;
  /** Left margin in FLA units. */
  leftMargin: number;
  /** Right margin in FLA units. */
  rightMargin: number;
  /** Letter spacing in FLA units (s16). */
  letterSpacing: number;
  /**
   * Whether the run enables the embedded font's kerning pairs ("Auto kern").
   * Decoded from the autoKern byte in the CPicText run formatting block
   * (write order: bold, italic, 0x00, autoKern, charPos, alignment — verified
   * against flacomdoc TimelineConverter handleText). Non-zero = on.
   */
  autoKern: boolean;
  /**
   * Hyperlink URL for the run ("Link" field in the Flash 8 text Properties
   * panel). Decoded from the `url` String that follows the letterSpacing s16 in
   * the CPicText run block (flacomdoc handleText). Empty when no link.
   */
  linkUrl?: string;
  /**
   * Hyperlink target window ("Target:" dropdown). Decoded from the `target`
   * String that follows the vertical/rtl/rotation bytes (ts >= 9). Empty when
   * no link/target.
   */
  linkTarget?: string;
  /**
   * Font rendering mode byte (F8+, ts >= 0x0d).
   * 0=device, 1=bitmap, 2=animation, 3=readability, 4=custom.
   * Undefined when ts < 0x0d (pre-Flash 8 format).
   */
  renderMode?: number;
  /** CSM antialias thickness (F32, F8+). Only meaningful when renderMode === 4. */
  aaThickness?: number;
  /** CSM antialias sharpness (F32, F8+). Only meaningful when renderMode === 4. */
  aaSharpness?: number;
}

/** writeString: u8 length (with 0xFF/0xFFFF extensions) + chars, no BOM. */
function readPlainString(r: Reader, unicode: boolean): string {
  let len = r.u8();
  if (len === 0xff) {
    len = r.u16();
    if (len === 0xffff) len = r.u32();
  }
  if (len === 0) return "";
  return unicode ? utf16le(r.bytes(len * 2)) : ascii(r.bytes(len));
}

/**
 * One text run's formatting block. Layout from flacomdoc handleText:
 *   u8 runVersion, u16 size*20, String fontFamily, RGBA color,
 *   u16 fontCategory, u8 bold, u8 italic, u8 0, u8 autoKern, u8 charPos,
 *   u8 alignment, 4 x u16 spacing/indent/margins, u16 letterSpacing (F5+),
 *   String url, (MX+) vertical/rtl/rotation bytes + (MX2004+) bitmapRender +
 *   String target, (F8+) 0x02 + renderMode + 2 floats + String url
 * `ts` is the CPicText schema (5=F5, 9=MX, 0x0C=MX2004, 0x0D=F8/CS3, 0x0E=CS4).
 */
function readTextRunFields(r: Reader, ts: number): TextRun {
  const unicode = ts >= 0x0c;
  const cs4 = ts >= 0x0e;
  r.skip(1); // run version
  const sizePt = r.u16() / 20;
  const fontName = cs4 ? readCString(r) : readPlainString(r, unicode);
  if (cs4) {
    readCString(r); // CS4 face name
    r.skip(4);
  }
  const color = readColorRGBA(r);
  r.skip(2); // font category
  const bold = r.u8() !== 0;
  const italic = r.u8() !== 0;
  r.skip(1); // 0x00 reserved
  const autoKern = r.u8() !== 0; // autoKern flag (flacomdoc handleText byte order)
  const characterPosition = r.u8() as 0 | 1 | 2; // 0=normal, 1=superscript, 2=subscript
  const align = r.u8();
  const leading = r.u16();      // line spacing (leading)
  const indent = r.u16();       // first-line indent
  const leftMargin = r.u16();   // left margin
  const rightMargin = r.u16();  // right margin
  const letterSpacing = ts >= 5 ? r.s16() : 0;
  if (ts < 5) r.skip(1);        // pre-F5: 1 reserved byte in place of the s16
  // Hyperlink URL: the String here is the run's link target URL ("Link" field).
  const linkUrl = cs4 ? readCString(r) : readPlainString(r, unicode); // url
  let vertical = false;
  let rightToLeft = false;
  let rotation = false;
  let linkTarget = "";
  if (ts >= 9) {
    vertical = r.u8() !== 0;
    rightToLeft = r.u8() !== 0;
    rotation = r.u8() !== 0;
    if (ts >= 0x0c) r.skip(1); // bitmap-render flag
    // Hyperlink target window ("Target:" dropdown): _self/_blank/_parent/_top.
    linkTarget = cs4 ? readCString(r) : readPlainString(r, unicode); // link target
  }
  let renderMode: number | undefined;
  let aaThickness: number | undefined;
  let aaSharpness: number | undefined;
  if (ts >= 0x0d) {
    r.skip(1); // 0x02 marker (constant)
    renderMode = r.u8(); // font rendering mode: 0=device,1=bitmap,2=animation,3=readability,4=custom
    // Read two IEEE 754 32-bit LE floats: thickness then sharpness
    const readF32 = (): number => {
      const b = r.bytes(4);
      return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);
    };
    aaThickness = readF32();
    aaSharpness = readF32();
    if (cs4) readCString(r);
    else readPlainString(r, unicode); // url (repeated)
  }
  return { fontName, sizePt, color, bold, italic, align, characterPosition, autoKern, linkUrl, linkTarget, vertical, rightToLeft, rotation, leading, indent, leftMargin, rightMargin, letterSpacing, renderMode, aaThickness, aaSharpness };
}

/** Map the CPicText run renderMode byte to the editor's antiAlias string (F8+). */
const ANTI_ALIAS_NAMES = ["device", "bitmap", "animation", "readability", "custom"] as const;

/**
 * Produce the antiAlias (and optional csm) props for Fla8Text from the first text run.
 * Returns an empty object when the run has no renderMode (pre-F8 format).
 */
function antiAliasFromRun(
  run: TextRun | null,
): { antiAlias?: Fla8Text["antiAlias"]; csm?: Fla8Text["csm"] } {
  if (run?.renderMode == null) return {};
  const antiAlias = ANTI_ALIAS_NAMES[run.renderMode] ?? "animation";
  if (antiAlias === "custom" && run.aaThickness != null && run.aaSharpness != null) {
    return { antiAlias, csm: { thickness: run.aaThickness, sharpness: run.aaSharpness } };
  }
  return { antiAlias };
}

function readCPicText(ctx: ParseCtx): Fla8Text {
  const { r } = ctx;
  const base = readCPicObjBase(ctx);
  const visible = visibleFromObjBaseFlags(base.flags);
  const ts = r.u8(); // CPicText schema ("textVersion": 5=F5, 9=MX, 0xC=MX2004, 0xD=F8)
  const unicode = ts >= 0x0c;
  const matrix = readMatrix(r);
  const left = r.s32();
  const right = r.s32();
  const top = r.s32();
  const bottom = r.s32();
  const autoExpand = r.u8() !== 0; // autoExpand: whether the field auto-sizes
  if (ts >= 4) r.skip(1); // reserved (F3+)
  let textFlags = 0;
  let embedFlag = 0;
  if (ts >= 4) {
    // bit 0x01 = editable (dynamic or input), 0x02 = dynamic, 0x04 = password,
    // 0x08 = wrap, 0x10 = multiline, 0x20 = background fill, 0x40 = border
    textFlags = r.u8();
    embedFlag = r.u8();
  }
  let selectable = true;
  if (ts >= 5) {
    // First byte: selectable flag (non-zero = selectable; 0 = not selectable).
    // Second byte: reserved.
    selectable = r.u8() !== 0;
    r.skip(1); // reserved
  }
  let maxChars = 0;
  let as2VariableName = "";
  if (ts >= 4) {
    maxChars = r.u16(); // maxCharacters
    as2VariableName = readCString(r); // AS1/2 variable name
  }
  if (embedFlag & 0x20) readCString(r); // embedded characters
  if (ts >= 0x0e) r.skip(1); // CS4 reserved

  let run: TextRun | null = null;
  let text = "";
  const runs: Fla8TextRun[] = [];
  try {
    if (embedFlag & 0x40) {
      // empty text: a single formatting run with no character-count prefix
      run = readTextRunFields(r, ts);
    } else {
      for (;;) {
        const charCount = r.u16();
        if (charCount === 0) break;
        if (charCount > 65000) throw new FlaEofError(`implausible run length ${charCount}`);
        const thisRun = readTextRunFields(r, ts);
        if (!run) run = thisRun;
        const runText = unicode ? utf16le(r.bytes(charCount * 2)) : ascii(r.bytes(charCount));
        text += runText;
        runs.push({
          text: runText,
          fontName: thisRun.fontName,
          fontSize: thisRun.sizePt,
          color: thisRun.color,
          bold: thisRun.bold,
          italic: thisRun.italic,
          ...(thisRun.leading !== 0 ? { leading: thisRun.leading / 20 } : {}),
          ...(thisRun.indent !== 0 ? { indent: thisRun.indent / 20 } : {}),
          ...(thisRun.leftMargin !== 0 ? { leftMargin: thisRun.leftMargin / 20 } : {}),
          ...(thisRun.rightMargin !== 0 ? { rightMargin: thisRun.rightMargin / 20 } : {}),
          ...(thisRun.letterSpacing !== 0 ? { letterSpacing: thisRun.letterSpacing / 20 } : {}),
          ...(thisRun.characterPosition !== 0 ? { characterPosition: thisRun.characterPosition } : {}),
          ...(thisRun.autoKern ? { autoKern: true } : {}),
        });
      }
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
    warnOnce(ctx, "text record truncated; text content may be incomplete");
  }
  let instanceName = "";
  let scrollable = false;
  let filters: Fla8Filter[] = [];
  let colorEffect: Fla8ColorEffect | null = null;
  try {
    if (ts >= 9) {
      const name = readCString(r);
      if (plausibleName(name)) instanceName = name;
      readAccessibilityMaybe(ctx, ts >= 0x0c);
      // 8-byte block: 4 reserved bytes, 1 scrollable flag (0=no, 1=yes), 3 reserved bytes.
      // Layout is best-effort (no confirmed fixture); verified consistent with
      // flacomdoc field ordering for the "no scrollable" case where byte reads 0.
      r.skip(4); // reserved
      scrollable = r.u8() !== 0; // scrollable flag
      r.skip(3); // reserved
      if (ts >= 0x0c) {
        readCString(r); // reserved
        readCString(r); // font embed ranges
      }
      if (ts >= 0x0d) {
        // FLA filter list (F8+). Wire format (verified against flacomdoc's
        // TimelineConverter text path + the golden-v2 fixture):
        //   u8 hasFilters marker (0 = none, 1 = present)
        //   if present: UI32 count, then `count` FLA-format filter records
        //   u16 trailing bytes (always present)
        // NOTE: these are FLA authoring filter records (`readFlaFilterList`),
        // NOT the SWF wire format used by symbol-instance filters.
        const hasFilters = r.u8();
        if (hasFilters !== 0) {
          try {
            const filterCount = r.u32();
            if (filterCount > 0 && filterCount < 256) {
              filters = readFlaFilterList(ctx, filterCount);
            }
            r.skip(2); // 2 trailing bytes
          } catch (e) {
            if (!(e instanceof FlaEofError)) throw e;
            // Filter record length mismatch — re-sync to the next boundary so
            // the remaining CArchive children (sibling layers/frames) survive.
            skipToNextBoundary(ctx);
          }
        } else {
          r.skip(2); // 2 trailing bytes present even when no filters
        }
      }
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }
  verifyBoundary(ctx);
  const alignNames = ["left", "right", "center", "justify"] as const;
  return {
    type: "text",
    // fold the local bounds origin into the placement translation
    matrix: { ...matrix, tx: matrix.tx + left / 20, ty: matrix.ty + top / 20 },
    width: (right - left) / 20,
    height: (bottom - top) / 20,
    text,
    fontName: run?.fontName ?? "",
    fontSize: run?.sizePt ?? 12,
    color: run?.color ?? { r: 0, g: 0, b: 0, a: 255 },
    bold: run?.bold ?? false,
    italic: run?.italic ?? false,
    align: alignNames[run?.align ?? 0] ?? "left",
    orientation: run
      ? textOrientationFromRunFields(run.vertical, run.rightToLeft)
      : "horizontal",
    instanceName,
    textType: (textFlags & 0x01) === 0 ? "static" : textFlags & 0x02 ? "dynamic" : "input",
    wordWrap: (textFlags & 0x08) !== 0,
    multiline: (textFlags & 0x10) !== 0,
    password: (textFlags & 0x04) !== 0,
    maxChars,
    hasBorder: (textFlags & 0x40) !== 0,
    hasBackground: (textFlags & 0x20) !== 0,
    as2VariableName,
    scrollable,
    selectable,
    autoKern: run?.autoKern ?? false,
    ...(run?.linkUrl ? { linkUrl: run.linkUrl } : {}),
    ...(run?.linkTarget ? { linkTarget: run.linkTarget } : {}),
    ...(autoExpand ? { autoExpand } : {}),
    ...(run?.leading ? { leading: run.leading / 20 } : {}),
    ...(run?.indent ? { indent: run.indent / 20 } : {}),
    ...(run?.leftMargin ? { leftMargin: run.leftMargin / 20 } : {}),
    ...(run?.rightMargin ? { rightMargin: run.rightMargin / 20 } : {}),
    ...(run?.letterSpacing ? { letterSpacing: run.letterSpacing / 20 } : {}),
    ...antiAliasFromRun(run),
    filters,
    // colorEffect is ALWAYS null for text — and that is correct, not a gap (tasks
    // 1050/1189 resolved). Flash 8 text fields cannot carry an instance color effect
    // (Tint/Brightness/Alpha): that is an instance/bitmap-only property (the Properties
    // panel exposes no color-effect control for static/dynamic/input text). Confirmed
    // against the flacomdoc writer (byte-verified vs real Flash output): its handleText
    // emits NO color-effect block, while handleSymbolInstance/handleBitmapInstance do;
    // and the no-effect fixture flash8-nested-textfields.fla (ts=0x0D) has no colorEffect
    // pad in its CPicText body. Text colour lives per-character in the run fillColor, not
    // a color transform. A "text field with a color effect" therefore cannot be authored,
    // so there is no byte block to decode here.
    colorEffect,
    runs,
    ...hiddenElementProp(visible),
  };
}

// --- CPicFrame -----------------------------------------------------------------

/**
 * Timeline sub-object (FUN_8facd0). For frames this carries the frame's
 * ActionScript source; for sprites it carries loop/firstFrame metadata.
 */
function readTimelineSubObject(r: Reader): { script: string } {
  // typeId is the per-version "frameVersionC": 0=Flash5, 1=MX, 4=MX2004/F8,
  // 5=CS3/CS4. formatType is 1 for frames written by the authoring tool.
  const typeId = r.u32();
  const formatType = r.u32();
  let script = "";
  if (formatType === 1) {
    if (typeId >= 1) {
      // MX+: random frame id (u16) + zeros, then an id-list count
      r.skip(4);
      const count = r.u32();
      if (count > 0 && count < 10000) r.skip(count * 4);
    }
    if (typeId >= 5) r.skip(4); // CS3+: four extra reserved bytes
    const raw = readCString(r);
    // Normalize Windows (CRLF) and old Mac (bare CR) line endings to Unix LF
    // so AS2 scripts imported from Windows-authored FLAs display correctly.
    script = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  } else if (formatType === 0) {
    r.skip(4);
    const pfCount = r.u32();
    if (pfCount > 0 && pfCount < 10000) r.skip(pfCount * 4);
  }
  return { script };
}

/**
 * CPicFrame : CPicShape : CPicObj. Children of the frame's CPicObj base are
 * the display objects placed on this keyframe. The frame's inherited
 * CPicShape body is read inline (rather than via readCPicShape) because the
 * children must be kept.
 */
/**
 * Decode tween ease direction from CPicFrame field_190 (s16 acceleration).
 * flacomdoc writes this via TimelineConverter `writeUI16(acceleration)` from
 * the XFL `acceleration` attribute: sign is direction, |value| is strength.
 */
function decodeEaseTypeFromAcceleration(
  acceleration: number,
  hasCustomEaseCurve: boolean,
): TweenEaseType {
  if (hasCustomEaseCurve && acceleration === 0) return "inOut";
  if (acceleration === 0) return "none";
  if (acceleration < 0) return "out";
  return "in";
}

function readCPicFrameNode(ctx: ParseCtx): ParsedFrameNode {
  const { r } = ctx;
  const base = readCPicObjBase(ctx);
  // inherited CPicShape body
  const shapeSchema = r.u8();
  const matrix = readMatrix(r);
  const ownShape = readShapeData(ctx, shapeSchema > 2);

  let duration = 1;
  let keyMode = 0;
  let shapeBlend = 0;
  let label = "";
  let labelIsComment = false;
  let labelIsAnchor = false;
  let script = "";
  let motionEase = 0;
  let motionEaseCurve: Fla8EaseCurve | null = null;
  let easeForPosition: Fla8EaseCurve | null = null;
  let easeForRotation: Fla8EaseCurve | null = null;
  let easeForScale: Fla8EaseCurve | null = null;
  let easeForColor: Fla8EaseCurve | null = null;
  let easeForFilters: Fla8EaseCurve | null = null;
  let motionRotate: "none" | "auto" | "cw" | "ccw" = "none";
  let motionRotateCount = 0;
  let motionOrientToPath = false;
  let motionSnap = false;
  let motionSync = false;
  let motionTweenScale = true; // default: scaling enabled (bit 0x0400 unset = scale on)
  let soundId = 0;
  let soundSync = -1;
  let soundLoop = -1;
  let inPoint: number | undefined;
  let outPoint: number | undefined;
  let envelopePoints: Array<{ pos: number; leftLevel: number; rightLevel: number }> | undefined;

  try {
    const fs = r.u8();
    duration = Math.max(1, r.u16());
    if (fs > 2) {
      keyMode = r.u16();
      // flacomdoc keyMode flags (classic tween 0x4001 base):
      //   0x0800 = motionTweenSync (sync graphic symbols to parent timeline)
      //   0x0400 = motionTweenScale DISABLED (bit set = no scaling; absent = scale on)
      motionSync = (keyMode & 0x0800) !== 0;
      motionTweenScale = (keyMode & 0x0400) === 0; // scale ON when bit is NOT set
    } else r.skip(1);
    if (fs > 1) motionEase = r.s16(); // field_190: signed acceleration (-100..100)
    if (fs > 4) soundId = r.u16();
    if (fs > 5) {
      const cnt = r.u16();
      if (cnt > 0 && cnt < 10000) {
        envelopePoints = [];
        for (let i = 0; i < cnt; i++) {
          const pos = r.u32();
          const leftLevel = r.u16();
          const rightLevel = r.u16();
          envelopePoints.push({ pos, leftLevel, rightLevel });
        }
      }
    }
    if (fs > 6) {
      soundLoop = r.u16();
      soundSync = r.u8();
      inPoint = r.u32();   // inPoint44: sample offset at 44100 Hz
      outPoint = r.u32();  // outPoint44: sample offset at 44100 Hz
    }
    if (fs > 7) r.skip(2); // soundZoomLevel
    if (fs > 8) {
      label = readCString(r); // frame label ("name" in XFL)
      if (fs >= 19) {
        // MX+ frame tail: frameVersionC block + frameId + BomString script
        script = readTimelineSubObject(r).script;
        // post-script fields (flacomdoc order): motionTweenRotate u32,
        // rotateTimes u32, comment flag u32, morph tag, ...
        if (fs > 10) {
          const rotateFlaValue = r.u32(); // 1=none, 2=auto, 3=CW, 4=CCW
          const rotateMap: Record<number, "none" | "auto" | "cw" | "ccw"> = {
            1: "none",
            2: "auto",
            3: "cw",
            4: "ccw",
          };
          motionRotate = rotateMap[rotateFlaValue] ?? "none";
          motionRotateCount = r.u32(); // extra full rotations beyond normal interpolation
          if (fs > 11) {
            const labelTypeValue = r.u32();
            labelIsComment = labelTypeValue === 1;
            labelIsAnchor = labelTypeValue === 2;
          }
          if (fs > 12) {
            const morphTag = r.u16();
            if (morphTag !== 0) {
              // Back up so decodeMorphData can re-read the class tag, then
              // decode the CPicMorphShape object (CMorphSegment / CMorphCurve
              // children) into end-shape geometry stored in
              // ctx.pendingMorphEndShape.  The reader is repositioned at the
              // next sibling CPicFrame's class tag (end keyframe) or at the
              // null terminator of the parent CPicLayer's children list.
              // We return immediately rather than reading the remaining frame-
              // tail fields, which would otherwise advance the reader past the
              // correctly-positioned next CPicFrame class tag.
              r.pos -= 2;
              shapeBlend = decodeMorphData(ctx, ownShape.fills, ownShape.strokes);
              return finishFrame();
            }
          }
          if (fs > 13) {
            // Orient-to-path / snap combined field (best-effort bit layout):
            //   bit 0x01 = motionOrientToPath (rotate object to follow path tangent)
            //   bit 0x02 = motionSnap (snap registration point to guide path)
            // Bit assignment matches XFL attribute ordering; no confirmed fixture.
            const orientSnapFlags = r.u32();
            motionOrientToPath = (orientSnapFlags & 0x01) !== 0;
            motionSnap = (orientSnapFlags & 0x02) !== 0;
          }
          if (fs > 14) {
            const oblistTag = r.u16();
            if (oblistTag !== 0) {
              r.pos -= 2;
              frameTailEndScan(r);
              return finishFrame();
            }
          }
          if (fs > 15) readCString(r); // field_298 (tween instance name)
          if (fs > 19) r.skip(4);
          if (fs > 20) r.skip(4);
          if (fs >= 22) r.skip(4);
          if (fs >= 24) {
            // Flash 8+ ease curve data: useSingleEaseCurve (u32) + hasCustomEase (u32)
            // followed by 6 per-property point arrays when hasCustomEase != 0.
            // Properties in order: position(0), rotation(1), scale(2), color(3),
            // filters(4), all(5).
            // Each point array: u32 numPoints, then for each point:
            //   - if first or last: f64 x, f64 y, f64 x, f64 y  (32 bytes — written twice)
            //   - otherwise:        f64 x, f64 y                 (16 bytes)
            const useSingleEaseCurve = r.u32();
            const hasCustomEase = r.u32();
            if (hasCustomEase !== 0) {
              const PROP_COUNT = 6;
              const curves: Array<Fla8EaseCurve | null> = [];
              for (let p = 0; p < PROP_COUNT; p++) {
                const numPoints = r.u32();
                if (numPoints === 0) {
                  curves.push(null);
                  continue;
                }
                const pts: Array<{ x: number; y: number }> = [];
                for (let i = 0; i < numPoints; i++) {
                  const x = r.f64();
                  const y = r.f64();
                  if (i === 0 || i === numPoints - 1) {
                    // anchor endpoints are written twice; consume the duplicate
                    r.f64();
                    r.f64();
                  }
                  pts.push({ x, y });
                }
                // A 4-point bezier: pts[0]=(0,0), pts[1]=c1, pts[2]=c2, pts[3]=(1,1)
                if (pts.length >= 4) {
                  curves.push({
                    x1: Math.max(0, Math.min(1, pts[1]!.x)),
                    y1: pts[1]!.y,
                    x2: Math.max(0, Math.min(1, pts[2]!.x)),
                    y2: pts[2]!.y,
                  });
                } else {
                  curves.push(null);
                }
              }
              // When useSingleEaseCurve is set, the "all" property (index 5) applies
              // to every property; otherwise use "position" (index 0) falling back to "all".
              if (useSingleEaseCurve !== 0) {
                motionEaseCurve = curves[5] ?? null;
                // Per-property curves are irrelevant — single curve governs all
              } else {
                motionEaseCurve = curves[0] ?? curves[5] ?? null;
                // Store per-property curves for the interpolation engine
                easeForPosition = curves[0] ?? null;
                easeForRotation = curves[1] ?? null;
                easeForScale    = curves[2] ?? null;
                easeForColor    = curves[3] ?? null;
                easeForFilters  = curves[4] ?? null;
              }
            }
          }
        }
      } else {
        // Flash 5/MX-era frame tail (schemas 9..18) is only partially
        // understood; skip to the next frame/layer boundary.
        warnOnce(
          ctx,
          `frame schema ${fs}: frame scripts beyond the label are not extracted for this FLA version`,
        );
        frameTailEndScan(r);
      }
    } else if (fs > 2 && fs <= 8) {
      // F1-F4: script stored as serialized action records, not source text.
      warnOnce(ctx, `frame schema ${fs} (Flash 4 or older): scripts not extracted`);
      frameTailEndScan(r);
    }
  } catch (err) {
    if (!(err instanceof FlaEofError)) throw err;
  }

  return finishFrame();

  function finishFrame(): ParsedFrameNode {
    const elements: Fla8Element[] = [];
    // The frame's own shape body (merge-drawing strokes/fills drawn directly
    // on the stage live on the inherited CPicShape, not a child object).
    const frameVisible = visibleFromObjBaseFlags(base.flags);
    if (ownShape.edges.length > 0) {
      elements.push({
        type: "shape",
        matrix,
        fills: ownShape.fills,
        strokes: ownShape.strokes,
        edges: ownShape.edges,
        ...hiddenElementProp(frameVisible),
      });
    }
    for (const c of base.children) {
      if (c.cls === "element") elements.push(c.element);
    }
    // If this frame has no elements of its own AND the preceding start keyframe
    // decoded CPicMorphShape end-geometry, inject it here.  This handles real
    // FLA files where the end CPicFrame's own shape data is empty and the
    // end-shape geometry lives exclusively in the CPicMorphShape object.
    if (elements.length === 0 && ctx.pendingMorphEndShape != null) {
      elements.push(ctx.pendingMorphEndShape);
      ctx.pendingMorphEndShape = null; // consume once
    }
    return {
      cls: "CPicFrame",
      frame: {
        duration, label, labelIsComment, labelIsAnchor, script, keyMode, shapeBlend,
        motionEase,
        easeType: decodeEaseTypeFromAcceleration(motionEase, motionEaseCurve != null),
        motionEaseCurve,
        easeForPosition, easeForRotation, easeForScale, easeForColor, easeForFilters,
        motionRotate, motionRotateCount, motionOrientToPath, motionSnap,
        motionSync, motionTweenScale,
        soundId, soundSync, soundLoop, inPoint, outPoint, envelopePoints, elements,
      },
    };
  }
}

/**
 * Reposition after an undecodable frame tail: find the next object-tail
 * signature whose following byte looks like the start of another record.
 */
function frameTailEndScan(r: Reader): void {
  let search = r.pos;
  while (search < r.buf.length - 14) {
    const idx = findEndMarker(r.buf, search);
    if (idx < 0 || idx >= r.buf.length - 14) break;
    const after = idx + 10;
    const schemaByte = r.buf[after]!;
    if (schemaByte <= 30) {
      r.pos = idx;
      return;
    }
    search = idx + 1;
  }
  r.pos = r.buf.length;
}

/**
 * Decode the CPicMorphShape (and its CMorphSegment/CMorphCurve children) that
 * follows the morph-tag field in a shape-tweened CPicFrame, producing the
 * end-keyframe shape geometry.
 *
 * The morph object is serialised inline in the CPicFrame tail — it is NOT a
 * child of the CPicFrame in the CArchive children list. After decoding, the
 * reader is positioned at the next sibling CPicFrame's class tag (the end
 * keyframe) or at the null terminator of the parent CPicLayer's children list.
 *
 * CPicMorphShape binary layout (observed in MX/F8 fixtures):
 *   - CArchive class tag (NEWCLASS or backref for CPicMorphShape)
 *   - CPicObjBase header: schema(u8), flags(u8), then children loop which
 *     immediately encounters a "bad" tag (0x0001) triggering skipToNextBoundary;
 *     the scanner re-positions at the first CMorphSegment or CMorphCurve NEWCLASS.
 *   - CArchive loop of CMorphSegment / CMorphCurve objects terminated by null(u16=0):
 *       CMorphSegment: CPicObjBase(schema=0,null) + 7×s32 + 1×u16
 *         s32 fields: styleFlags, fill0Style, fill1Style, fromX, fromY, toX, toY
 *         All coordinates in SWF twips (1 px = 20 twips).
 *       CMorphCurve: CPicObjBase(variable schema, null) + reg-point + extra bytes
 *         + 6×s32 per-class fields:
 *         s32 fields: ctrlX, ctrlY, anchorX, anchorY, ???, ???
 *         Coordinates in SWF twips.
 *   - After null: CPicMorphShape reg point (8 bytes if CPicMorphShape schema > 0)
 *
 * The decoded edges are stored in ctx.pendingMorphEndShape with the same fills
 * and strokes as the start keyframe shape, to be consumed by finishFrame() of
 * the subsequent end CPicFrame if that frame has no elements of its own.
 *
 * Falls back to the old forward-scan if decoding fails for any reason.
 */
/**
 * Skip one morph fill style entry (writeMorphFillStylePart format).
 * Layout by subtype (stored as u16 at offset +4):
 *   Solid/null (subtype=0):  4 (RGBA) + 2 (u16=0) = 6 bytes total
 *   Gradient (0x10/0x12):   4 (RGBA) + 2 (type) + 24 (matrix) + 1 (count) + count×5
 *   Bitmap (0x40+):         4 (RGBA) + 2 (type) + 24 (matrix) + 2 (bitmapId) = 32 bytes
 */
function skipMorphFillStyle(r: Reader): void {
  r.skip(4); // RGBA
  const subtype = r.u16();
  if (subtype & 0x10) {
    // Gradient (linear 0x10 or radial 0x12)
    r.skip(24); // matrix (6×u32)
    const count = r.u8();
    r.skip(count * 5); // each entry: 1 ratio + 4 RGBA
  } else if (subtype & 0x40) {
    // Bitmap fill
    r.skip(24); // matrix
    r.skip(2);  // bitmapId (u16)
  }
  // subtype == 0: solid/null — already consumed the 2 bytes above, done
}

/**
 * Decode the CPicMorphShape (and its CMorphSegment/CMorphCurve children) that
 * follows the morph-tag field in a shape-tweened CPicFrame, producing the
 * end-keyframe shape geometry.
 *
 * Returns the shapeTweenBlend byte (0=distributive, 1=angular) read from the
 * frame tail immediately after the morph fill/stroke style tables.  Returns 0
 * on any parse error (safe default: distributive).
 */
function decodeMorphData(
  ctx: ParseCtx,
  startFills: Fla8Fill[],
  startStrokes: Fla8Stroke[],
): number {
  const { r, ar } = ctx;
  const savedPos = r.pos;

  try {
    // 1. Consume the CPicMorphShape class tag so the CArchive table stays
    //    consistent for subsequent backref resolution in this stream.
    const morphClassTag = ar.readClassTag();
    if (morphClassTag.kind !== "class") {
      // Not a recognised class tag — fall back to position scan.
      r.pos = savedPos;
      skipMorphDataFallback(ctx);
      return 0;
    }

    // 2. Read CPicMorphShape's CPicObjBase. It always hits a "bad" internal
    //    tag (0x0001) which causes skipToNextBoundary to reposition the reader
    //    at the next CMorphSegment or CMorphCurve NEWCLASS tag.
    const morphSchema = r.u8(); // CPicObjBase schema byte (typically 2)
    r.skip(1); // flags byte

    // Children loop: consume until null or handle bad tag via recovery scan.
    for (;;) {
      const childTag = ar.readClassTag();
      if (childTag.kind === "null") {
        // Normal terminator: skip reg point if schema > 0.
        if (morphSchema > 0) r.skip(8);
        if (morphSchema > 2) r.skip(1);
        if (morphSchema > 3) r.skip(1);
        break;
      }
      if (childTag.kind === "bad") {
        // Advance past the two bytes of the bad tag and scan for the next
        // plausible boundary (CMorphSegment/CMorphCurve NEWCLASS or CPicFrame
        // backref). The CPicMorphShape reg point is NOT read in this path
        // because badTag=true mirrors readCPicObjBase's own behaviour.
        skipToNextBoundary(ctx);
        break;
      }
      if (childTag.kind === "object-backref") continue;
      // Known child class — deserialise normally (this path is rare in MX/F8).
      deserializeClass(childTag.name, ctx);
    }

    // 3. Read the sequence of CMorphSegment / CMorphCurve objects, terminated
    //    by a null class tag (0x0000).
    const SWF_TWIPS_PER_PX = 20;
    const edges: Fla8Edge[] = [];
    let fill0 = 0;
    let fill1 = 0;
    let line = 0;

    for (;;) {
      const childTag = ar.readClassTag();
      if (childTag.kind === "null") break;
      if (childTag.kind !== "class") {
        // bad or object-backref: scan to next boundary and stop.
        if (childTag.kind === "bad") skipToNextBoundary(ctx);
        break;
      }

      // Each CMorphSegment / CMorphCurve uses CPicObjBase (schema, flags,
      // null-terminated children list, optional reg point).
      const cSchema = r.u8();
      r.skip(1); // flags
      // Children loop for this segment/curve (always empty in practice).
      for (;;) {
        const cChild = ar.readClassTag();
        if (cChild.kind === "null") break;
        if (cChild.kind === "bad") { skipToNextBoundary(ctx); break; }
        if (cChild.kind === "object-backref") continue;
        deserializeClass(cChild.name, ctx);
      }
      // Consume optional reg-point / schema-extra bytes.
      if (cSchema > 0) r.skip(8);
      if (cSchema > 2) r.skip(1);
      if (cSchema > 3) r.skip(1);

      // Per-class fields (coordinates in SWF twips).
      if (childTag.name === "CMorphSegment") {
        // Layout: styleFlags(s32) fill0Style(s32) fill1Style(s32)
        //         fromX(s32) fromY(s32) toX(s32) toY(s32) trailing(u16)
        const styleFlags = r.s32();
        const fill0Style = r.s32();
        const fill1Style = r.s32();
        const fromX = r.s32() / SWF_TWIPS_PER_PX;
        const fromY = r.s32() / SWF_TWIPS_PER_PX;
        const toX = r.s32() / SWF_TWIPS_PER_PX;
        const toY = r.s32() / SWF_TWIPS_PER_PX;
        r.u16(); // trailing field (observed as 0x0004 in MX fixture; purpose unknown)
        // Derive 1-based fill/line indices: use style indices from the segment,
        // mapping -1 (none) to 0 and positive values as-is.
        fill0 = fill0Style > 0 ? fill0Style : 0;
        fill1 = styleFlags > 0 ? styleFlags : 0;
        line = 0;
        // Suppress the unused-variable warning for fill0Style / fill1Style;
        // they are captured above and may be useful for future refinement.
        void fill0Style; void fill1Style;
        edges.push({
          kind: "line",
          fromX, fromY,
          ctrlX: (fromX + toX) / 2,
          ctrlY: (fromY + toY) / 2,
          toX, toY,
          fill0,
          fill1,
          line,
        });
      } else if (childTag.name === "CMorphCurve") {
        // Layout (after CPicObjBase with its reg-point skip): 6×s32
        //   ctrlX, ctrlY, anchorX, anchorY, unknown1, unknown2
        // ctrlX/ctrlY are absolute SWF twips (the quadratic control point).
        // anchorX/anchorY are absolute SWF twips (the curve end point).
        const ctrlX = r.s32() / SWF_TWIPS_PER_PX;
        const ctrlY = r.s32() / SWF_TWIPS_PER_PX;
        const anchorX = r.s32() / SWF_TWIPS_PER_PX;
        const anchorY = r.s32() / SWF_TWIPS_PER_PX;
        r.s32(); // unknown1
        r.s32(); // unknown2 (observed to be a style index; ignored for now)
        // Reuse last edge's fill/line styles — curves in CPicMorphShape do not
        // carry independent style indices; they inherit from the preceding segment.
        edges.push({
          kind: "curve",
          fromX: edges.length > 0 ? edges[edges.length - 1]!.toX : ctrlX,
          fromY: edges.length > 0 ? edges[edges.length - 1]!.toY : ctrlY,
          ctrlX,
          ctrlY,
          toX: anchorX,
          toY: anchorY,
          fill0: fill0 ?? 0,
          fill1: fill1 ?? 0,
          line: line ?? 0,
        });
      } else {
        // Unknown morph child — skip its data as best we can.
        warnOnce(ctx, `unknown morph child class "${childTag.name}" skipped`);
        skipToNextBoundary(ctx);
      }
    }

    // CPicMorphShape reg point after the null terminator (schema=2 > 0).
    // Already consumed in the children-loop null branch above if schema > 0.

    // 4. Store decoded end-shape for use by the subsequent end keyframe.
    if (edges.length > 0) {
      const identityMatrix: Fla8Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
      ctx.pendingMorphEndShape = {
        type: "shape",
        matrix: identityMatrix,
        fills: startFills,
        strokes: startStrokes,
        edges,
      };
    } else {
      ctx.pendingMorphEndShape = null;
    }

    // 4.5. Attempt to read the morph fill/stroke style tables that follow the
    //      segment list, then read the shapeTweenBlend byte (0=distributive,
    //      1=angular).
    //
    //      Binary layout (flacomdoc TimelineConverter.java ~line 2983):
    //        u16 fillCount; fillCount × morphFillStyle (variable size)
    //        u16 strokeCount; strokeCount × morphStrokeStyle (10 bytes each)
    //        u8 shapeTweenBlend
    //
    //      We save the position before attempting this parse.  On any error
    //      the position is RESTORED so that the subsequent skipToNextCPicFrame
    //      scan still starts from after the morph segment data, not mid-table.
    let shapeTweenBlend = 0;
    const posAfterSegments = r.pos;
    try {
      const fillCount = r.u16();
      // Sanity cap: morph shapes rarely have more than 64 fill styles
      if (fillCount <= 64) {
        for (let i = 0; i < fillCount; i++) skipMorphFillStyle(r);
        const strokeCount = r.u16();
        // Sanity cap and size check before skipping
        if (strokeCount <= 64 && r.pos + strokeCount * 10 < r.buf.length) {
          r.skip(strokeCount * 10); // each morph stroke style is exactly 10 bytes
          shapeTweenBlend = r.u8();
        }
      }
    } catch {
      // Parse error — restore position so skipToNextCPicFrame starts correctly.
      r.pos = posAfterSegments;
      shapeTweenBlend = 0;
    }

    // 5. Re-position at the next CPicFrame backref or layer null terminator,
    //    matching the old skipMorphData behaviour so the caller's frame loop
    //    can continue normally.
    skipToNextCPicFrame(ctx);
    return shapeTweenBlend;
  } catch {
    // Any parse error: revert to the fallback position scan.
    r.pos = savedPos;
    ctx.pendingMorphEndShape = null;
    skipMorphDataFallback(ctx);
    return 0;
  }
}

/**
 * Reposition the reader at the next sibling CPicFrame class tag or the null
 * terminator of the parent CPicLayer's children list.  Used by decodeMorphData
 * after the morph data has been consumed.
 */
function skipToNextCPicFrame(ctx: ParseCtx): void {
  const { r, ar } = ctx;
  const cpicFrameTag = ar.classBackrefTag("CPicFrame");
  const limit = Math.min(r.buf.length - 4, r.pos + 8192);
  for (let i = r.pos; i < limit; i++) {
    const v = r.buf[i]! | (r.buf[i + 1]! << 8);
    if (cpicFrameTag !== null && v === cpicFrameTag) {
      const schemaByte = r.buf[i + 2]!;
      if (schemaByte <= 10) { r.pos = i; return; }
    }
    if (v === 0x0000 && i + END_MARKER.length <= r.buf.length) {
      let match = true;
      for (let j = 2; j < END_MARKER.length; j++) {
        if (r.buf[i + j] !== END_MARKER[j]) { match = false; break; }
      }
      if (match) { r.pos = i; return; }
    }
  }
  frameTailEndScan(r);
}

/**
 * Fallback for decodeMorphData when the decode attempt fails: consume the
 * CPicMorphShape class tag (for CArchive table consistency) then scan forward
 * to the next sibling CPicFrame or layer end marker.
 */
function skipMorphDataFallback(ctx: ParseCtx): void {
  const { r, ar } = ctx;
  try {
    const morphClassTag = ar.readClassTag();
    if (morphClassTag.kind === "class") {
      warnOnce(ctx, `shape tween morph data (${morphClassTag.name}) skipped — end keyframe will supply end shape`);
    }
  } catch {
    // readClassTag can throw for malformed data; proceed with position scan.
  }
  const cpicFrameTag = ar.classBackrefTag("CPicFrame");
  const limit = Math.min(r.buf.length - 4, r.pos + 8192);
  for (let i = r.pos; i < limit; i++) {
    const lo = r.buf[i]!;
    const hi = r.buf[i + 1]!;
    const v = lo | (hi << 8);
    if (cpicFrameTag !== null && v === cpicFrameTag) {
      const schemaByte = r.buf[i + 2]!;
      if (schemaByte <= 10) { r.pos = i; return; }
    }
    if (v === 0x0000 && i + END_MARKER.length <= r.buf.length) {
      let matchEndMarker = true;
      for (let j = 2; j < END_MARKER.length; j++) {
        if (r.buf[i + j] !== END_MARKER[j]) { matchEndMarker = false; break; }
      }
      if (matchEndMarker) { r.pos = i; return; }
    }
  }
  frameTailEndScan(r);
}

// ---------------------------------------------------------------------------
// Timeline stream entry point
// ---------------------------------------------------------------------------

/**
 * Parse a "Page N" / "Symbol N" timeline stream into layers/frames/elements.
 * Throws on structurally-unreadable input.
 */
export function parseFla8Timeline(bytes: Uint8Array): Fla8Timeline {
  const r = new Reader(bytes);
  const ar = new ArchiveReader(r);
  const ctx: ParseCtx = { r, ar, warnings: new Set() };

  const rootMarker = r.u8();
  if (rootMarker !== 0x01) {
    throw new Error(`unexpected root marker 0x${rootMarker.toString(16)} (expected 0x01)`);
  }
  const tag = ar.readClassTag();
  if (tag.kind !== "class") {
    throw new Error("expected a class tag at the root of the timeline stream");
  }
  if (tag.name !== "CPicPage") {
    throw new Error(`unexpected root class "${tag.name}" (expected CPicPage)`);
  }
  const page = readCPicPage(ctx);
  if (page.cls !== "CPicPage") throw new Error("internal: root did not parse as a page");
  return { layers: page.layers.map((l) => l.layer) };
}

// ---------------------------------------------------------------------------
// Contents stream parsing (document-level info)
// ---------------------------------------------------------------------------

function findBytes(buf: Uint8Array, pattern: number[], from: number): number {
  outer: for (let i = Math.max(0, from); i <= buf.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (buf[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function utf16Pattern(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    out.push(s.charCodeAt(i) & 0xff, s.charCodeAt(i) >> 8);
  }
  return out;
}

/** Read an FF FE FF BomString at `pos`; returns null if not present. */
function tryReadBomStringAt(buf: Uint8Array, pos: number): { value: string; end: number } | null {
  if (pos + 4 > buf.length) return null;
  if (buf[pos] !== 0xff || buf[pos + 1] !== 0xfe || buf[pos + 2] !== 0xff) return null;
  let len = buf[pos + 3]!;
  let p = pos + 4;
  if (len === 0xff) {
    if (p + 2 > buf.length) return null;
    len = buf[p]! | (buf[p + 1]! << 8);
    p += 2;
  }
  if (p + len * 2 > buf.length) return null;
  return { value: utf16le(buf.subarray(p, p + len * 2)), end: p + len * 2 };
}

/**
 * Extract document-level info from the "Contents" stream. All extraction is
 * best-effort: missing pieces come back as null/empty and are logged.
 */
/**
 * Attempt to read a CMediaSound object body at `bodyStart` in the Contents
 * stream and register the sound in `out` if the body looks valid.
 * Body layout: [schema u8][nameLen u8]["Media N" UTF-16 LE][BomString displayName]...
 */
function registerCMediaSoundObject(
  bytes: Uint8Array,
  bodyStart: number,
  out: Map<number, Fla8SoundInfo>,
): void {
  if (bodyStart + 2 > bytes.length) return;
  const nameLen = bytes[bodyStart + 1]!;
  if (nameLen < 7 || nameLen > 14) return;
  const nameEnd = bodyStart + 2 + nameLen * 2;
  if (nameEnd > bytes.length) return;
  const streamName = utf16le(bytes.subarray(bodyStart + 2, nameEnd));
  const m = /^Media (\d+)$/.exec(streamName);
  if (!m) return;
  const num = parseInt(m[1]!, 10);
  const s = tryReadBomStringAt(bytes, nameEnd);
  if (!s) return;
  const name = s.value;
  if (name.length > 0 && !name.includes("/") && !name.startsWith(".\\")) {
    if (!out.has(num)) out.set(num, { name, linkageId: "", exportForActionScript: false });
  }
}

export function parseFla8Contents(bytes: Uint8Array): Fla8ContentsInfo {
  const formatVersion = bytes.length > 0 ? bytes[0]! : 0;
  const unicode = formatVersion >= 0x38; // MX2004 and later store UTF-16 strings

  const info: {
    width: number | null;
    height: number | null;
    frameRate: number | null;
    backgroundColor: Fla8Color | null;
  } = { width: null, height: null, frameRate: null, backgroundColor: null };

  // -- background color + frame rate -----------------------------------------
  // flacomdoc writes a fixed run ending in:
  //   bgR bgG bgB FF gridR gridG gridB FF 00 fpsFrac fpsInt 00 00 00 03 B4 00 00 00
  // Anchor on "03 B4 00 00 00" and read backwards.
  let anchor = -1;
  {
    anchor = findBytes(bytes, [0x03, 0xb4, 0x00, 0x00, 0x00], 0);
    if (anchor >= 14) {
      const fpsInt = bytes[anchor - 4]!;
      const fpsFrac = bytes[anchor - 5]!;
      const fps = fpsInt + fpsFrac / 256;
      if (fps >= 1 && fps <= 120) {
        info.frameRate = fps;
        info.backgroundColor = {
          r: bytes[anchor - 14]!,
          g: bytes[anchor - 13]!,
          b: bytes[anchor - 12]!,
          a: 255,
        };
      }
    }
  }

  // -- stage dimensions --------------------------------------------------------
  // Written as u16 width*20, six zero bytes, u16 height*20, four zero bytes,
  // shortly before the background/frame-rate block. Search the window before
  // the anchor and prefer the match closest to it.
  {
    const searchEnd = anchor > 0 ? anchor : Math.min(bytes.length - 14, 8192);
    const searchStart = anchor > 0 ? Math.max(0, anchor - 256) : 0;
    for (let i = searchEnd - 14; i >= searchStart; i--) {
      const w20 = bytes[i]! | (bytes[i + 1]! << 8);
      if (w20 < 20 || w20 > 8192 * 20 || w20 % 20 !== 0) continue;
      let zeros = true;
      for (let j = 2; j < 8; j++) {
        if (bytes[i + j] !== 0) {
          zeros = false;
          break;
        }
      }
      if (!zeros) continue;
      const h20 = bytes[i + 8]! | (bytes[i + 9]! << 8);
      if (h20 < 20 || h20 > 8192 * 20 || h20 % 20 !== 0) continue;
      if (bytes[i + 10] !== 0 || bytes[i + 11] !== 0 || bytes[i + 12] !== 0 || bytes[i + 13] !== 0)
        continue;
      info.width = w20 / 20;
      info.height = h20 / 20;
      break;
    }
    if (info.width === null) {
      console.warn("[FLA import] could not locate stage dimensions in Contents stream");
    }
  }

  // -- scene names ---------------------------------------------------------------
  // Each CDocumentPage record carries the page stream name ("Page 1") as a
  // plain length-prefixed string followed by the scene display name as a
  // BomString.
  const sceneNames = new Map<string, string>();
  if (unicode) {
    for (const prefix of ["Page ", "P "]) {
      const pat = utf16Pattern(prefix);
      let pos = 0;
      for (;;) {
        const idx = findBytes(bytes, pat, pos);
        if (idx < 0) break;
        pos = idx + 1;
        const lenByte = idx >= 1 ? bytes[idx - 1]! : 0;
        if (lenByte < prefix.length || lenByte > 64) continue;
        const end = idx + lenByte * 2;
        if (end > bytes.length) continue;
        const streamName = utf16le(bytes.subarray(idx, end));
        if (!/^(Page \d+|P \d+ \d+)$/.test(streamName)) continue;
        const scene = tryReadBomStringAt(bytes, end);
        if (scene && scene.value.length > 0 && scene.value.length < 128) {
          sceneNames.set(streamName, scene.value);
        }
      }
    }
  } else {
    // Pre-MX2004: ASCII CString format (u8 len + chars). Scan for "Page N" or
    // "P N N" stream names followed immediately by the scene display name as
    // another ASCII CString. This matches the MFC CArchive CDocumentPage
    // serialisation used by Flash 5 and MX.
    for (const prefix of ["Page ", "P "]) {
      const prefixBytes = Array.from(prefix).map((c) => c.charCodeAt(0));
      let pos = 0;
      for (;;) {
        const idx = findBytes(bytes, prefixBytes, pos);
        if (idx < 0) break;
        pos = idx + 1;
        // The length byte immediately precedes the string data
        if (idx < 1) continue;
        const lenByte = bytes[idx - 1]!;
        if (lenByte < prefix.length || lenByte > 64) continue;
        const end = idx + lenByte;
        if (end > bytes.length) continue;
        const streamName = ascii(bytes.subarray(idx, end));
        if (!/^(Page \d+|P \d+ \d+)$/.test(streamName)) continue;
        // Scene display name follows as the next ASCII CString
        if (end >= bytes.length) continue;
        const nameLen = bytes[end]!;
        if (nameLen === 0 || nameLen >= 0xff) continue; // empty or long-form
        const nameEnd = end + 1 + nameLen;
        if (nameEnd > bytes.length) continue;
        const sceneName = ascii(bytes.subarray(end + 1, nameEnd));
        if (sceneName.length > 0 && sceneName.length < 128) {
          // Normalise to "Page N" key (pre-MX uses full form in practice)
          if (!sceneNames.has(streamName)) {
            sceneNames.set(streamName, sceneName);
          }
        }
      }
    }
  }

  // -- symbol library table ---------------------------------------------------
  // Contents stream layout for each symbol entry (unicode/MX2004+ format):
  //   length-prefixed UTF-16 stream name ("Symbol N")
  //   BomString: library display name
  //   UI32LE: stream number (redundant cross-check)
  //   UI8: symbol type (0=graphic, 1=button, 2=movieclip)
  //   BomString: linkageIdentifier (empty when not set)
  //   UI8: exportInFirstFrame (1 = export in first frame, Flash default)
  //   UI8: exportForActionScript (1 = exported for AS2 attachMovie/new ClassName)
  //   UI8: exportForRuntimeSharing
  //   UI8: importForRuntimeSharing
  // Then, at a fixed offset of 41 bytes after s.end (the end of the display-name
  // BomString), the writeAsLinkage block begins:
  //   s.end+41: UI32 zero prefix (00 00 00 00)
  //   s.end+45: asLinkageVersion (1 byte: 5=MX2004, 7=Flash8/CS3)
  //   s.end+46: flags byte (exportForAS | importForRS)
  //   s.end+47: 3 zero bytes
  //   s.end+50: BomString(linkageIdentifier) [real, authoritative copy]
  //   after:    BomString(linkageURL)
  //   after:    BomString(className)          ← AS2 class name
  // (verified against flacomdoc FlaConverter.writeAsLinkage() and real fixtures)
  const symbols = new Map<number, Fla8SymbolInfo>();
  if (unicode) {
    for (const prefix of ["Symbol ", "S "]) {
      const pat = utf16Pattern(prefix);
      let pos = 0;
      for (;;) {
        const idx = findBytes(bytes, pat, pos);
        if (idx < 0) break;
        pos = idx + 1;
        const lenByte = idx >= 1 ? bytes[idx - 1]! : 0;
        if (lenByte < prefix.length || lenByte > 64) continue;
        const end = idx + lenByte * 2;
        if (end > bytes.length) continue;
        const streamName = utf16le(bytes.subarray(idx, end));
        const m = /^(?:Symbol (\d+)|S (\d+) \d+)$/.exec(streamName);
        if (!m) continue;
        const num = parseInt(m[1] ?? m[2]!, 10);
        // The library display name follows as the next BomString within a
        // short window; the symbol-type byte sits 4 bytes after the name.
        let search = end;
        const windowEnd = Math.min(bytes.length - 4, end + 120);
        while (search < windowEnd) {
          const s = tryReadBomStringAt(bytes, search);
          if (s) {
            const name = s.value;
            if (name.length > 0 && !name.includes("/") && !name.startsWith(".\\")) {
              // s.end+0..3 = UI32LE stream number (skip — we already know num)
              // s.end+4    = typeByte
              let typeByte: number | null = null;
              if (s.end + 5 <= bytes.length) typeByte = bytes[s.end + 4]!;

              // s.end+5: BomString linkageIdentifier (if present)
              let linkageIdentifier = "";
              let exportInFirstFrame = false;
              let exportForActionScript = false;
              let exportForRuntimeSharing = false;
              let importForRuntimeSharing = false;
              // linkageFlagsEnd: byte offset right after the 4 linkage flag bytes.
              // Used below as the scan-start for the scale9Grid block.
              let linkageFlagsEnd = s.end + 5;
              if (s.end + 5 < bytes.length) {
                const lnk = tryReadBomStringAt(bytes, s.end + 5);
                if (lnk !== null) {
                  linkageIdentifier = lnk.value;
                  // After linkageIdentifier: 4 boolean bytes
                  // Observed layout from real Flash 8 binaries (no-linkage case):
                  //   [0]=exportInFirstFrame(1=default), [1]=exportForActionScript(0),
                  //   [2]=exportForRuntimeSharing(0),    [3]=importForRuntimeSharing(0)
                  const flagBase = lnk.end;
                  if (flagBase + 4 <= bytes.length) {
                    exportInFirstFrame     = bytes[flagBase]!     !== 0;
                    exportForActionScript  = bytes[flagBase + 1]! !== 0;
                    exportForRuntimeSharing = bytes[flagBase + 2]! !== 0;
                    importForRuntimeSharing = bytes[flagBase + 3]! !== 0;
                    linkageFlagsEnd = flagBase + 4;
                  }
                }
              }

              // Read className from the writeAsLinkage block at s.end + 41.
              // Layout (flacomdoc FlaConverter.writeAsLinkage, MX2004+ unicode):
              //   [s.end+41..44]: 00 00 00 00 (zero prefix — validates the offset)
              //   [s.end+45]:     asLinkageVersion (5 or 7)
              //   [s.end+46]:     flags
              //   [s.end+47..49]: 00 00 00
              //   [s.end+50]:     BomString(linkageIdentifier)
              //                   BomString(linkageURL)
              //                   BomString(className)  ← target
              let className = "";
              let fullPath = "";
              const laStart = s.end + 41;
              if (
                laStart + 9 < bytes.length &&
                bytes[laStart]!     === 0 &&
                bytes[laStart + 1]! === 0 &&
                bytes[laStart + 2]! === 0 &&
                bytes[laStart + 3]! === 0
              ) {
                // Read exportForAS / importForRS from the writeAsLinkage flags byte.
                // Layout: UI32(0) + UI8(version) + UI8(flags) + 3×UI8(0) + BomStrings
                //   flags bit 0 = exportForActionScript
                //   flags bit 1 = importForRuntimeSharing
                const laFlags = bytes[laStart + 5]!;
                if (laFlags & 0x01) exportForActionScript = true;
                if (laFlags & 0x02) importForRuntimeSharing = true;

                // skip 9-byte header: UI32 zero + version + flags + 3×zero
                const laIdent = tryReadBomStringAt(bytes, laStart + 9);
                if (laIdent !== null) {
                  // Use the authoritative linkageIdentifier from the writeAsLinkage block.
                  if (laIdent.value.length > 0) linkageIdentifier = laIdent.value;
                  const laUrl = tryReadBomStringAt(bytes, laIdent.end);
                  if (laUrl !== null) {
                    const laCn = tryReadBomStringAt(bytes, laUrl.end);
                    if (laCn !== null) {
                      className = laCn.value;
                      // After className: 1 byte (version indicator) + UI32LE (4 bytes)
                      // + BomString(sourceFlaPath) + BomString(fullLibraryPath).
                      // The fullLibraryPath uses "/" as the folder separator and
                      // folder names may end with "!" indicating expanded in the UI.
                      // Observed layout from real MX2004/Flash 8 binaries:
                      //   laCn.end+0: UI8 version indicator (0x00 or 0x05)
                      //   laCn.end+1..4: UI32LE (observed value: 2)
                      //   laCn.end+5: BomString(sourceFlaPath)
                      //   after: BomString(fullLibraryPath)
                      const afterCn = laCn.end + 5; // skip 1+4 bytes
                      const srcPath = tryReadBomStringAt(bytes, afterCn);
                      if (srcPath !== null) {
                        const fp = tryReadBomStringAt(bytes, srcPath.end);
                        if (fp !== null && fp.value.length > 0) {
                          fullPath = fp.value;
                        }
                      }
                    }
                  }
                }
              }

              // Decode the scale9Grid block (Flash 8+ only, formatVersion >= 0x3F).
              //
              // The block lives in the CDocumentPage symbol entry in the Contents
              // stream, immediately after the F5 pre-scale9Grid anchor pattern:
              //   [FF FE FF 00][FF FE FF 00][00 00 00 00][FF FE FF 00]  (16 bytes)
              //     empty BomString  empty BomString  4 zeros  empty BomString
              // Followed by 20 bytes (flacomdoc FlaConverter.writeSymbols, F8):
              //   UI32 toggle  (1=enabled, 0=disabled)
              //   UI32 right   (twips = px * 20)
              //   UI32 left    (twips = px * 20)
              //   UI32 bottom  (twips = px * 20)
              //   UI32 top     (twips = px * 20)
              // Disabled: toggle=0, all values=0x80000000 (INT_MIN sentinel).
              let scale9Grid: Fla8SymbolInfo["scale9Grid"] = null;
              if (formatVersion >= 0x3f) {
                const prePattern = [
                  0xff, 0xfe, 0xff, 0x00, // empty BomString
                  0xff, 0xfe, 0xff, 0x00, // empty BomString
                  0x00, 0x00, 0x00, 0x00, // 4 zero bytes (F5 padding)
                  0xff, 0xfe, 0xff, 0x00, // empty BomString
                ];
                // Scan within a bounded window from after the linkage flag bytes.
                // The scale9Grid block is typically 300-600 bytes past the flags.
                const scanLimit = Math.min(bytes.length - 36, linkageFlagsEnd + 2000);
                const gridPrePos = findBytes(bytes, prePattern, linkageFlagsEnd);
                if (gridPrePos >= linkageFlagsEnd && gridPrePos < scanLimit) {
                  const gridPos = gridPrePos + prePattern.length; // skip 16-byte anchor
                  if (gridPos + 20 <= bytes.length) {
                    const dv = new DataView(bytes.buffer, bytes.byteOffset + gridPos, 20);
                    const toggle = dv.getUint32(0, true);
                    const right  = dv.getUint32(4, true);
                    const left   = dv.getUint32(8, true);
                    const bottom = dv.getUint32(12, true);
                    const top    = dv.getUint32(16, true);
                    if (toggle === 1) {
                      scale9Grid = {
                        left:   left   / 20,
                        top:    top    / 20,
                        right:  right  / 20,
                        bottom: bottom / 20,
                      };
                    }
                  }
                }
              }

              if (!symbols.has(num)) {
                symbols.set(num, {
                  name,
                  typeByte,
                  linkageIdentifier,
                  className,
                  exportForActionScript,
                  exportInFirstFrame,
                  exportForRuntimeSharing,
                  importForRuntimeSharing,
                  scale9Grid,
                  fullPath,
                });
              }
            }
            break;
          }
          search++;
        }
      }
    }
  }

  // -- sound library table ----------------------------------------------------
  // Sounds in the Contents stream appear as stream names like "Sound N" or
  // short-form "So N N", followed by the display name as a BomString.
  const sounds = new Map<number, Fla8SoundInfo>();
  if (unicode) {
    for (const prefix of ["Sound ", "So "]) {
      const pat = utf16Pattern(prefix);
      let pos = 0;
      for (;;) {
        const idx = findBytes(bytes, pat, pos);
        if (idx < 0) break;
        pos = idx + 1;
        const lenByte = idx >= 1 ? bytes[idx - 1]! : 0;
        if (lenByte < prefix.length || lenByte > 64) continue;
        const end = idx + lenByte * 2;
        if (end > bytes.length) continue;
        const streamName = utf16le(bytes.subarray(idx, end));
        const m = /^(?:Sound (\d+)|So (\d+) \d+)$/.exec(streamName);
        if (!m) continue;
        const num = parseInt(m[1] ?? m[2]!, 10);
        // The library display name follows as the next BomString within a short window.
        // After the display name, sound entries optionally carry:
        //   UI32LE stream number (redundant cross-check, 4 bytes)
        //   BomString linkageId  (AS2 attachSound identifier; empty when not set)
        //   UI8 exportForActionScript (1 = exported)
        //   UI8 exportInFirstFrame
        //   UI8 exportForRuntimeSharing
        //   UI8 importForRuntimeSharing
        // (Same layout as symbol entries but without a typeByte field.)
        let search = end;
        const windowEnd = Math.min(bytes.length - 2, end + 120);
        while (search < windowEnd) {
          const s = tryReadBomStringAt(bytes, search);
          if (s) {
            const name = s.value;
            if (name.length > 0 && !name.includes("/") && !name.startsWith(".\\")) {
              // Attempt to decode optional linkage block after the display name.
              // Skip UI32LE stream number (4 bytes) then read BomString linkageId.
              let linkageId = "";
              let exportForActionScript = false;
              const afterName = s.end + 4; // skip UI32LE stream number
              if (afterName < bytes.length) {
                const lnk = tryReadBomStringAt(bytes, afterName);
                if (lnk !== null) {
                  linkageId = lnk.value;
                  // UI8 flags: exportForAS at lnk.end, exportInFirstFrame at +1, etc.
                  if (lnk.end < bytes.length) {
                    exportForActionScript = bytes[lnk.end]! !== 0;
                  }
                }
              }
              if (!sounds.has(num)) sounds.set(num, { name, linkageId, exportForActionScript });
            }
            break;
          }
          search++;
        }
      }
    }
  }

    // --- (b) CMediaSound objects referencing "Media N" stream names ---
    // Flash 8/CS-era FLAs (like Magnet.fla) use CMediaSound class objects in the
    // Contents stream instead of "Sound N" OLE stream names. Each CMedia body:
    //   [schema u8][nameLen u8]["Media N" UTF-16 LE][BomString displayName]...
    //
    // We discover the CMediaSound CArchive class backref tag empirically:
    //   1. Find the "CMediaSound" FFFF class declaration.
    //   2. Register the first (inline) body that immediately follows.
    //   3. Discover the CMediaBits backref: first backref-tagged "Media N" body
    //      after the "CMediaBits" FFFF declaration.
    //   4. Discover the CMediaSound backref: first backref-tagged "Media N" body
    //      after the inline sound body whose tag != CMediaBits backref.
    //   5. Scan all [cmsSoundBackref][schema=6][nameLen]["Media N"][BomString].
    if (unicode) {
      // Find a FFFF class declaration for the given ASCII class name.
      const findCMediaClassDecl = (name: string): number => {
        const nb = Array.from(name, (c) => c.charCodeAt(0));
        const ffff = [0xff, 0xff];
        let sp = 0;
        for (;;) {
          const idx = findBytes(bytes, ffff, sp);
          if (idx < 0) break;
          sp = idx + 1;
          if (idx + 6 + nb.length > bytes.length) continue;
          const nl = bytes[idx + 4]! | (bytes[idx + 5]! << 8);
          if (nl !== nb.length) continue;
          let ok = true;
          for (let j = 0; j < nb.length; j++) {
            if (bytes[idx + 6 + j] !== nb[j]) { ok = false; break; }
          }
          if (ok) return idx;
        }
        return -1;
      };

      // Find the first backref-tagged "Media N" body starting at `from`,
      // skipping any entry whose tag == `exclude`.
      const findFirstCMediaBackref = (from: number, exclude: number): number => {
        const mediaPfx = utf16Pattern("Media ");
        let sp = from;
        for (;;) {
          const idx = findBytes(bytes, mediaPfx, sp);
          if (idx < 0) break;
          sp = idx + 1;
          if (idx < 4) continue;
          const tag = bytes[idx - 4]! | (bytes[idx - 3]! << 8);
          if ((tag & 0x8000) === 0 || tag === 0xffff) continue;
          if (tag === exclude) continue;
          const schema = bytes[idx - 2]!;
          if (schema !== 6) continue;
          const nameLen = bytes[idx - 1]!;
          if (nameLen < 7 || nameLen > 14) continue;
          const end = idx + nameLen * 2;
          if (end > bytes.length) continue;
          if (!/^Media \d+$/.test(utf16le(bytes.subarray(idx, end)))) continue;
          return tag;
        }
        return -1;
      };

      const cmsDeclPos = findCMediaClassDecl("CMediaSound");
      if (cmsDeclPos >= 0) {
        // First object body is inlined right after: FFFF(2)+schema(2)+nameLen(2)+name(11)
        const cmsBodyStart = cmsDeclPos + 6 + 11;
        registerCMediaSoundObject(bytes, cmsBodyStart, sounds);

        // Discover the CMediaBits (bitmap) backref to exclude it.
        const cmBitsDeclPos = findCMediaClassDecl("CMediaBits");
        const cmBitsBackref =
          cmBitsDeclPos >= 0 ? findFirstCMediaBackref(cmBitsDeclPos + 6 + 10, -1) : -1;

        // CMediaSound backref = first backref-tagged CMedia body after inline body
        // that differs from the CMediaBits backref.
        const cmsSoundBackref = findFirstCMediaBackref(cmsBodyStart, cmBitsBackref);

        if (cmsSoundBackref >= 0) {
          const cmsTag: number[] = [cmsSoundBackref & 0xff, (cmsSoundBackref >> 8) & 0xff];
          let pos = cmsBodyStart;
          for (;;) {
            const idx = findBytes(bytes, cmsTag, pos);
            if (idx < 0) break;
            pos = idx + 1;
            registerCMediaSoundObject(bytes, idx + 2, sounds);
          }
        }
      }
    }


  // -- video library table ----------------------------------------------------
  // Video items in the Contents stream appear as stream names "Video N" or
  // short-form "Vi N N", followed by the library display name as a BomString.
  // The media stream number in "Video N" matches the mediaId stored in each
  // CPicVideo stage element and the corresponding "Media N" OLE stream that
  // carries the FLV payload.
  const videos = new Map<number, Fla8VideoInfo>();
  if (unicode) {
    for (const prefix of ["Video ", "Vi "]) {
      const pat = utf16Pattern(prefix);
      let pos = 0;
      for (;;) {
        const idx = findBytes(bytes, pat, pos);
        if (idx < 0) break;
        pos = idx + 1;
        const lenByte = idx >= 1 ? bytes[idx - 1]! : 0;
        if (lenByte < prefix.length || lenByte > 64) continue;
        const end = idx + lenByte * 2;
        if (end > bytes.length) continue;
        const streamName = utf16le(bytes.subarray(idx, end));
        const m = /^(?:Video (\d+)|Vi (\d+) \d+)$/.exec(streamName);
        if (!m) continue;
        const num = parseInt(m[1] ?? m[2]!, 10);
        // The library display name follows as the next BomString within a short window.
        let search = end;
        const windowEnd = Math.min(bytes.length - 2, end + 120);
        while (search < windowEnd) {
          const s = tryReadBomStringAt(bytes, search);
          if (s) {
            const name = s.value;
            if (name.length > 0 && !name.includes("/") && !name.startsWith(".\\")) {
              if (!videos.has(num)) videos.set(num, { name });
            }
            break;
          }
          search++;
        }
      }
    }
  }

  // -- font library table -----------------------------------------------------
  // Font items in the Contents stream appear as stream references "Font N"
  // encoded as a BomString (FF FE FF [len] [UTF-16LE chars]).
  // Unlike Symbol/Sound/Video entries, the font family name is NOT encoded
  // as a subsequent BomString. Instead, the data immediately following the
  // "Font N" BomString has this fixed layout (observed from real Magnet.fla
  // CS2 binary):
  //   +0 UI16LE: stream number (redundant cross-check)
  //   +2 UI32:   hash/timestamp (skip 4 bytes)
  //   +6 UI16:   schema/flags (skip 2 bytes)
  //   +8 UI8:    flag byte (skip 1 byte)
  //   +9 UI8:    fontNameLen (number of UTF-16 chars in the font family name)
  //   +10 [fontNameLen*2 bytes]: font family name in UTF-16LE
  // The font family name (e.g. "_sans", "Arial") is used as the library
  // display name and as the fontName field of the FontItem.
  const fonts = new Map<number, Fla8FontInfo>();
  if (unicode) {
    const fontPat = utf16Pattern("Font ");
    let pos = 0;
    for (;;) {
      const idx = findBytes(bytes, fontPat, pos);
      if (idx < 0) break;
      pos = idx + 1;
      const lenByte = idx >= 1 ? bytes[idx - 1]! : 0;
      if (lenByte < 6 || lenByte > 16) continue;
      const end = idx + lenByte * 2;
      if (end > bytes.length) continue;
      const streamName = utf16le(bytes.subarray(idx, end));
      const m = /^Font (\d+)$/.exec(streamName);
      if (!m) continue;
      const num = parseInt(m[1]!, 10);
      if (fonts.has(num)) continue; // deduplicate
      // Read the font family name at fixed offset +9 (length byte) and +10 (chars).
      if (end + 10 > bytes.length) continue;
      const fontNameLen = bytes[end + 9]!;
      if (fontNameLen === 0 || fontNameLen > 64) continue;
      if (end + 10 + fontNameLen * 2 > bytes.length) continue;
      const fontChars: string[] = [];
      for (let j = 0; j < fontNameLen; j++) {
        fontChars.push(
          String.fromCharCode(bytes[end + 10 + j * 2]! | (bytes[end + 10 + j * 2 + 1]! << 8)),
        );
      }
      const fontName = fontChars.join("");
      if (fontName.length > 0) {
        fonts.set(num, { name: fontName, fontName });
      }
    }
  }

  return {
    formatVersion,
    width: info.width,
    height: info.height,
    frameRate: info.frameRate,
    backgroundColor: info.backgroundColor,
    sceneNames,
    symbols,
    sounds,
    videos,
    fonts,
  };
}
