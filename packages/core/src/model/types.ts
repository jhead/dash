/**
 * Core document model types for the Flash 8 clone.
 * All interfaces are pure data — no classes, no runtime logic.
 */

import type { DisplayObject } from "../engine/types.js";

// ---------------------------------------------------------------------------
// Primitives & enumerations
// ---------------------------------------------------------------------------

export type RulerUnits = "px" | "inches" | "points" | "cm" | "mm";

export type TweenType = "none" | "motion" | "shape";

export type LabelType = "name" | "comment" | "anchor";

/**
 * Layer types as understood by Flash 8.
 * "Guided" is a normal layer that follows a Guide layer above it.
 */
export type LayerType = "normal" | "guide" | "guided" | "mask" | "masked" | "folder";

export type SymbolType = "movieclip" | "button" | "graphic";

export type LibraryItemType =
  | "symbol"
  | "bitmap"
  | "sound"
  | "video"
  | "font"
  | "component";

// ---------------------------------------------------------------------------
// Document properties
// ---------------------------------------------------------------------------

export interface GridSettings {
  readonly showGrid: boolean;
  readonly snapToGrid: boolean;
  readonly gridColor: string;       // CSS hex e.g. "#999999"
  readonly gridWidth: number;       // px
  readonly gridHeight: number;      // px
}

export interface Guide {
  readonly id: string;
  readonly orientation: "horizontal" | "vertical";
  readonly position: number;        // px from origin
}

export interface DocumentProperties {
  readonly width: number;           // px, default 550
  readonly height: number;          // px, default 400
  readonly frameRate: number;       // fps, default 12
  readonly backgroundColor: string; // CSS hex e.g. "#ffffff"
  readonly rulerUnits: RulerUnits;
  readonly grid: GridSettings;
  readonly guides: readonly Guide[];
  readonly snapToObjects: boolean;
  readonly snapToPixels: boolean;
  readonly snapToGuides: boolean;
  /** Render quality. "high" is the Flash Player default; omitting the field also means "high". */
  readonly quality?: "low" | "medium" | "high" | "best";
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

/** Preset envelope effects for StartSound playback. */
export type SoundEffect =
  | "none"
  | "left"            // Left Channel only
  | "right"           // Right Channel only
  | "fadeLeftToRight" // Pan left→right over full sound
  | "fadeRightToLeft" // Pan right→left over full sound
  | "fadeIn"          // Fade in from silence to full volume
  | "fadeOut";        // Fade out from full volume to silence

/** One point on a custom sound volume envelope. Mirrors SWF SoundEnvelope. */
export interface SoundEnvelopePoint {
  /** Sample position at 44100 Hz. */
  pos44: number;
  /** Left channel level 0-32768. */
  leftLevel: number;
  /** Right channel level 0-32768. */
  rightLevel: number;
}

export interface SoundLinkage {
  readonly libraryItemId: string;   // ID of a Sound library item
  readonly syncMode: "event" | "start" | "stop" | "stream";
  readonly repeatCount: number;     // 0 = loop indefinitely
  readonly effect?: SoundEffect;    // Envelope effect preset (default: "none")
  /** In-point sample offset (sample index, 44100 Hz). 0 = start of sound. */
  readonly inPoint?: number;
  /** Out-point sample offset (sample index, 44100 Hz). undefined = end of sound. */
  readonly outPoint?: number;
  /**
   * Custom volume envelope. When set, overrides `effect` for SWF encoding.
   * Each point has a sample position and left/right levels (0-32768).
   */
  readonly customEnvelope?: SoundEnvelopePoint[];
}

/**
 * Flash 8 custom ease curve — a cubic Bézier defined by two control points in
 * normalised [0,1] space.  P0=(0,0) and P3=(1,1) are implicit.
 *
 *   x1,y1 — first handle (near the start)
 *   x2,y2 — second handle (near the end)
 *
 * Maps to the CSS `cubic-bezier(x1,y1,x2,y2)` convention.
 * When null the legacy integer ease (-100..100) is used instead.
 */
export interface EaseCurve {
  readonly x1: number;  // 0-1
  readonly y1: number;  // unconstrained (allows overshoot)
  readonly x2: number;  // 0-1
  readonly y2: number;  // unconstrained
}

/**
 * A shape hint — a labeled point (letter 'a'–'z') placed on a shape-tween
 * keyframe to guide morphing interpolation.
 *
 * Shape hints come in pairs: the same hint id ('a', 'b', …) exists on both
 * the START keyframe and the END keyframe of a shape tween span.
 * On the start keyframe the hint is rendered yellow; on the end keyframe green.
 * They are authoring-time guidance only — not encoded in the SWF output.
 */
export interface ShapeHint {
  /** Letter 'a'–'z' identifying the pair. */
  readonly id: string;
  /** X position in stage coordinates. */
  readonly x: number;
  /** Y position in stage coordinates. */
  readonly y: number;
}

export interface Frame {
  readonly index: number;           // 0-based frame index within the layer
  readonly isKeyframe: boolean;
  readonly isEmpty: boolean;        // blank keyframe (no display objects)
  readonly tweenType: TweenType;
  readonly label: string;
  readonly labelType: LabelType;
  readonly script: string;          // AS2 script attached to this keyframe
  readonly sound: SoundLinkage | null;
  // Motion tween properties
  readonly motionEase: number;      // -100..100 (ignored when motionEaseCurve is set)
  readonly motionEaseCurve?: EaseCurve | null; // custom Bézier ease; null = use motionEase
  readonly motionRotate: "none" | "auto" | "cw" | "ccw";
  readonly motionRotateCount: number;
  readonly motionOrientToPath: boolean;
  readonly motionSync: boolean;
  readonly motionScale: boolean;
  // Shape tween
  readonly shapeEase: number;       // -100..100
  readonly shapeBlend: "distributive" | "angular";
  /**
   * Shape hints for this keyframe (shape tween start/end only).
   * Each hint id ('a'–'z') should appear on both the start and end keyframe
   * of the same shape tween span to form a pair.
   */
  readonly shapeHints?: readonly ShapeHint[];
  // Display objects placed on this keyframe
  readonly displayObjects: readonly DisplayObject[];
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export interface Layer {
  readonly id: string;
  readonly name: string;
  readonly type: LayerType;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly outlineMode: boolean;
  readonly outlineColor: string;    // CSS hex
  readonly height: number;          // row height in px (default 20)
  /** ID of the parent Folder layer, or null for top-level */
  readonly parentFolderId: string | null;
  readonly frames: readonly Frame[];
  /**
   * Explicit frame span length for this layer (>= 1).
   * This is the authoritative duration — not derived from keyframe indices.
   * Maintained by insertFrame / removeFrame / insertKeyframe / insertBlankKeyframe.
   */
  readonly frameCount: number;
  /**
   * Whether this folder layer is collapsed in the timeline UI.
   * Only meaningful for layers with type === "folder".
   * Undefined / false means expanded (default).
   */
  readonly collapsed?: boolean;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface Timeline {
  readonly layers: readonly Layer[];
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface Scene {
  readonly id: string;
  readonly name: string;
  readonly timeline: Timeline;
}

// ---------------------------------------------------------------------------
// Library items
// ---------------------------------------------------------------------------

export interface SymbolLinkage {
  readonly exportForActionScript: boolean;
  readonly exportInFirstFrame: boolean;
  readonly linkageIdentifier: string;  // attachMovie / new ClassName identifier
  readonly className: string;          // AS2 class name
  readonly exportForRuntimeSharing: boolean;
  readonly importForRuntimeSharing: boolean;
  readonly sharedUrl: string;          // URL for runtime-shared assets
}

/**
 * A single button event handler for an AS1-style `on(event){}` block.
 *
 * The `event` field matches the Flash button event names used in the
 * SWF ButtonCondition bitfield:
 *   "press"          → idleToOverDown   (bit 1)
 *   "release"        → overDownToIdle   (bit 0)
 *   "releaseOutside" → outDownToIdle    (bit 4)
 *   "rollOut"        → overUpToIdle     (bit 5)
 *   "rollOver"       → overUpToOverDown (bit 6)
 *   "dragOut"        → overDownToOutDown (bit 2)
 *   "dragOver"       → outDownToOverDown (bit 3)
 *
 * The `script` field contains the raw AS2 source code for the handler body
 * (not wrapped in `on(event){}`). It is compiled to AVM1 bytecode and
 * embedded as a BUTTONCONDACTION record in the DefineButton2 SWF tag.
 */
export interface ButtonAction {
  readonly event:
    | "press"
    | "release"
    | "releaseOutside"
    | "rollOut"
    | "rollOver"
    | "dragOut"
    | "dragOver"
    | { readonly keyPress: string };
  readonly script: string;
}

/**
 * A sound effect attached to a button state transition.
 * Maps to a BUTTONSOUNDINFO record inside DefineButtonSound (tag 17).
 */
export interface ButtonStateSound {
  /** Library item ID of the SoundItem to play. */
  readonly soundId: string;
  /** Optional loop count (0 = loop forever, undefined = play once). */
  readonly loops?: number;
}

/**
 * Per-state sound assignments for a button symbol.
 * Encoded as a DefineButtonSound (tag 17) immediately after the DefineButton2 tag.
 *
 * SWF spec state order: overToUp, upToOver, overToDown, downToOver.
 */
export interface ButtonSounds {
  /** Sound to play when the button transitions from Over to Up. */
  readonly overToUp?: ButtonStateSound;
  /** Sound to play when the button transitions from Up to Over. */
  readonly upToOver?: ButtonStateSound;
  /** Sound to play when the button transitions from Over to Down. */
  readonly overToDown?: ButtonStateSound;
  /** Sound to play when the button transitions from Down to Over. */
  readonly downToOver?: ButtonStateSound;
}

export interface Symbol {
  readonly id: string;
  readonly name: string;
  readonly itemType: "symbol";
  readonly symbolType: SymbolType;
  readonly timeline: Timeline;
  readonly linkage: SymbolLinkage;
  /** 9-slice grid in symbol-local coordinates, or null if not set */
  readonly scale9Grid: Scale9Grid | null;
  /**
   * Button event scripts (for symbolType === "button" only).
   * Each entry is an AS1-style `on(event){}` handler attached directly
   * to the button definition. Stored as compiled BUTTONCONDACTION records
   * in the DefineButton2 SWF tag.
   */
  readonly buttonActions?: readonly ButtonAction[];
  /**
   * Per-state sound assignments (for symbolType === "button" only).
   * When present, a DefineButtonSound (tag 17) tag is emitted immediately
   * after the DefineButton2 tag in the SWF.
   */
  readonly buttonSounds?: ButtonSounds;
  /**
   * When true, the button behaves like a menu item (Track As Menu Item).
   * Pressing and dragging onto it activates it; releasing elsewhere still
   * counts as a release. Maps to the TrackAsMenu bit in DefineButton2 (tag 34).
   * Only meaningful when symbolType === "button". Default: false.
   */
  readonly trackAsMenu?: boolean;
}

export interface Scale9Grid {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BitmapItem {
  readonly id: string;
  readonly name: string;
  readonly itemType: "bitmap";
  /** Data URL or asset reference; empty string until asset is loaded */
  readonly dataUri: string;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly allowSmoothing: boolean;
  readonly compressionType: "photo" | "lossless";
  readonly quality: number;         // JPEG quality 1-100
}

export interface SoundItem {
  readonly id: string;
  readonly name: string;
  readonly itemType: "sound";
  readonly dataUri: string;
  readonly sampleRate: number;      // Hz
  readonly sampleSize: 8 | 16;
  readonly isStereo: boolean;
  readonly durationSeconds: number;
  readonly compressionType: "adpcm" | "mp3" | "raw" | "speech";
  /** AS2 linkage class name for attachSound / new Sound() by class name. */
  readonly linkageIdentifier?: string;
  /** Whether this sound is exported for ActionScript (attachSound/class). */
  readonly exportForActionScript?: boolean;
}

export interface VideoItem {
  readonly id: string;
  readonly name: string;
  readonly itemType: "video";
  readonly dataUri: string;
  readonly frameCount: number;
  readonly frameRate: number;
  readonly width: number;
  readonly height: number;
}

export interface FontItem {
  readonly id: string;
  readonly name: string;
  readonly itemType: "font";
  readonly fontName: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly linkageIdentifier: string;
}

export interface ComponentItem {
  readonly id: string;
  readonly name: string;
  readonly itemType: "component";
  readonly componentName: string;
  readonly packageName: string;
}

export type LibraryItem =
  | Symbol
  | BitmapItem
  | SoundItem
  | VideoItem
  | FontItem
  | ComponentItem;

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export interface LibraryFolder {
  readonly id: string;
  readonly name: string;
  readonly parentFolderId: string | null;
}

export interface Library {
  readonly items: readonly LibraryItem[];
  readonly folders: readonly LibraryFolder[];
}

// ---------------------------------------------------------------------------
// Publish profiles
// ---------------------------------------------------------------------------

/** HTML wrapper publish settings — kept in sync with PublishSettingsDialog. */
export interface PublishHtmlOptions {
  readonly publishHtml: boolean;
  readonly quality: "low" | "medium" | "high" | "best";
  readonly wmode: "window" | "opaque" | "transparent";
  readonly scale: "showall" | "noborder" | "exactfit" | "noscale";
  readonly loop: boolean;
  readonly menu: boolean;
}

/** SWF + HTML output settings for a single named publish profile. */
export interface PublishProfileSettings {
  readonly filename: string;
  readonly jpegQuality: number;
  readonly audioStreamFormat: "mp3" | "adpcm";
  readonly audioEventFormat: "mp3" | "adpcm";
  readonly compress: boolean;
  readonly protect: boolean;
  readonly debuggingPermitted: boolean;
  readonly debugPassword: string;
  readonly html: PublishHtmlOptions;
}

/** A named publish configuration stored in the document. */
export interface PublishProfile {
  readonly id: string;
  readonly name: string;
  readonly settings: PublishProfileSettings;
}

// ---------------------------------------------------------------------------
// Top-level document
// ---------------------------------------------------------------------------

/**
 * Document-level accessibility settings (Window > Accessibility panel, doc section).
 * When enabled, the published SWF will include accessibility metadata.
 */
export interface DocumentAccessibility {
  /** Whether this movie is accessible (Flash 8 "Make movie accessible" checkbox). Default: false. */
  readonly enabled: boolean;
  /** Whether child objects are also made accessible. Default: true. */
  readonly makeChildrenAccessible: boolean;
  /** Whether a custom tab order is used (enables tab-index fields on objects). Default: false. */
  readonly useCustomTabOrder: boolean;
}

export interface FlashDocument {
  readonly id: string;
  readonly properties: DocumentProperties;
  readonly scenes: readonly Scene[];
  readonly library: Library;
  /** Named publish configurations. The active profile id is stored separately in the editor state. */
  readonly publishProfiles?: readonly PublishProfile[];
  /** Id of the currently selected publish profile. Falls back to the first profile. */
  readonly activePublishProfileId?: string;
  /**
   * Document-level accessibility settings (Window > Accessibility panel).
   * When enabled the SWF includes EnableAccessibility flag metadata.
   */
  readonly accessibility?: DocumentAccessibility;
}
