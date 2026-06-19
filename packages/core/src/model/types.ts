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

/**
 * Tween ease direction decoded from binary FLA CPicFrame field_190 (acceleration).
 * Distinct from the numeric ease strength stored in `motionEase` / `shapeEase`.
 * XFL/binary sign (flacomdoc): negative = ease-out, positive = ease-in, zero = none;
 * custom Bézier curves without a simple acceleration value use `inOut`.
 */
export type TweenEaseType = "none" | "in" | "out" | "inOut";

export type LabelType = "name" | "comment" | "anchor";

/**
 * Layer types as understood by Flash 8.
 * "Guided" is a normal layer that follows a Guide layer above it.
 */
export type LayerType = "normal" | "guide" | "guided" | "mask" | "masked" | "folder";

export type SymbolType = "movieclip" | "button" | "graphic";

/**
 * Round-trip identity metadata recovered from a binary FLA's ItemID record
 * (Flash's per-item library/scene identity, used to preserve item identity
 * across a re-export). Attached to imported scenes and library items so a
 * future writer can reproduce the original item ordering/identity.
 *
 * - `order` is the item's storage/creation index, derived from the OLE2 stream
 *   number (`Page N` / `Symbol N` / `Media N` / `Sound N`). This is reliably
 *   recoverable. NOTE: it is the *creation* order, NOT the authored play/library
 *   display order (see the scene-ordering note in flash8-import.ts).
 * - `timeCreated` is the original FLA creation timestamp when it could be
 *   recovered from the binary; undefined when the byte layout could not be
 *   confirmed (the binary FLA format spec does not document the ItemID timestamp
 *   layout with verified confidence, so this is populated only opportunistically).
 */
export interface FlaItemId {
  /** Storage/creation order index (OLE2 stream number). */
  readonly order: number;
  /** Original FLA creation timestamp (epoch ms), when recoverable. */
  readonly timeCreated?: number;
}

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

/**
 * A single behavior row attached to a keyframe, as authored in the
 * BehaviorsPanel. Stored on the Frame so that rows survive navigation
 * (selecting a different frame and returning restores the list).
 */
export interface AttachedBehavior {
  /** Unique row identifier (timestamp-based string). */
  readonly id: string;
  /** References a BEHAVIORS[*].id from the behaviors registry. */
  readonly behaviorId: string;
  /** Parameter values entered in the param form. */
  readonly params: Readonly<Record<string, string>>;
  /** Display label for the triggering event (e.g. "On Release"). */
  readonly event: string;
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
  readonly motionEaseType: TweenEaseType; // ease direction; strength is |motionEase|
  readonly motionEaseCurve?: EaseCurve | null; // custom Bézier ease; null = use motionEase
  /**
   * Per-property ease curves (Flash 8+ only, when useSingleEaseCurve is false).
   * When set, each property group uses its own Bézier curve instead of motionEaseCurve.
   * null = fall back to motionEaseCurve / motionEase for that property.
   */
  readonly easeForPosition?: EaseCurve | null;
  readonly easeForRotation?: EaseCurve | null;
  readonly easeForScale?: EaseCurve | null;
  readonly easeForColor?: EaseCurve | null;
  readonly easeForFilters?: EaseCurve | null;
  readonly motionRotate: "none" | "auto" | "cw" | "ccw";
  readonly motionRotateCount: number;
  readonly motionOrientToPath: boolean;
  /** Snap the object's registration point to the motion guide path. */
  readonly motionSnap: boolean;
  readonly motionSync: boolean;
  readonly motionScale: boolean;
  // Shape tween
  readonly shapeEase: number;       // -100..100
  readonly shapeEaseType: TweenEaseType; // ease direction; strength is |shapeEase|
  readonly shapeBlend: "distributive" | "angular";
  /**
   * Shape hints for this keyframe (shape tween start/end only).
   * Each hint id ('a'–'z') should appear on both the start and end keyframe
   * of the same shape tween span to form a pair.
   */
  readonly shapeHints?: readonly ShapeHint[];
  // Display objects placed on this keyframe
  readonly displayObjects: readonly DisplayObject[];
  /**
   * Behavior rows attached to this keyframe via the BehaviorsPanel.
   * Absent (undefined) on frames that have never had behaviors added.
   */
  readonly behaviors?: ReadonlyArray<AttachedBehavior>;
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
  /** Round-trip identity recovered from a binary FLA import; undefined otherwise. */
  readonly flaItemId?: FlaItemId;
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
 *   "press"          → overUpToOverDown  (bit 2)
 *   "release"        → overDownToOverUp  (bit 3)
 *   "releaseOutside" → outDownToIdle     (bit 6)
 *   "rollOut"        → overUpToIdle      (bit 1)
 *   "rollOver"       → idleToOverUp      (bit 0)
 *   "dragOut"        → overDownToOutDown (bit 4)
 *   "dragOver"       → outDownToOverDown (bit 5)
 *   "overDownToIdle" → overDownToIdle    (bit 8)
 *   "idleToOverDown" → idleToOverDown    (bit 7)
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
    | "overDownToIdle"
    | "idleToOverDown"
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
  /** Round-trip identity recovered from a binary FLA import; undefined otherwise. */
  readonly flaItemId?: FlaItemId;
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
  /** Round-trip identity recovered from a binary FLA import; undefined otherwise. */
  readonly flaItemId?: FlaItemId;
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
  /** Round-trip identity recovered from a binary FLA import; undefined otherwise. */
  readonly flaItemId?: FlaItemId;
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
  /** Round-trip identity recovered from a binary FLA import; undefined otherwise. */
  readonly flaItemId?: FlaItemId;
}

export interface FontItem {
  readonly id: string;
  readonly name: string;
  readonly itemType: "font";
  readonly fontName: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly linkageIdentifier: string;
  /** Round-trip identity recovered from a binary FLA import; undefined otherwise. */
  readonly flaItemId?: FlaItemId;
}

export interface ComponentItem {
  readonly id: string;
  readonly name: string;
  readonly itemType: "component";
  readonly componentName: string;
  readonly packageName: string;
  /**
   * AS2 linkage for runtime registration (task 1229). A placed v2 component is
   * published as a synthetic DefineSprite that exports under its fully-qualified
   * AS2 class name (e.g. `mx.controls.Button`) and is bound to that class via a
   * DoInitAction → `Object.registerClass`. When omitted, the compiler derives
   * the class name from `packageName + "." + componentName`. See
   * docs/13-components.md "Publishing placed components".
   */
  readonly linkage?: ComponentLinkage;
  /** Round-trip identity recovered from a binary FLA import; undefined otherwise. */
  readonly flaItemId?: FlaItemId;
}

/** AS2 linkage metadata for a published v2 component (task 1229). */
export interface ComponentLinkage {
  /** Fully-qualified AS2 class name registered at runtime (e.g. `mx.controls.Button`). */
  readonly className: string;
  /**
   * ExportAssets linkage identifier. Defaults to `className` — Flash uses the
   * symbol's linkage id as the `attachMovie`/`registerClass` key.
   */
  readonly linkageIdentifier?: string;
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
  readonly collapsed?: boolean;
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

/**
 * Opaque passthrough capture of a legacy imported-SWF (`CPicSwf`) display
 * record from a binary FLA. Flash 8's `CPicSwf` carries a placement matrix plus
 * a large variable-length tail (AS2 clip scripts, color transform, source SWF
 * filename, instance name) that the format spec marks `[X]` (undecoded). Rather
 * than silently dropping the record, the importer captures its raw bytes here so
 * a future re-export can reproduce them verbatim. The element is not rendered on
 * the editor stage (it has no decoded display representation).
 */
export interface FlaSwfBlob {
  /** Raw record bytes (from the CArchive class tag through the record tail). */
  readonly bytes: Uint8Array;
  /** Decoded placement matrix scalars (best-effort; only the header is parsed). */
  readonly matrix: {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly tx: number;
    readonly ty: number;
  };
  /** Scene index this record was placed on (when known). */
  readonly sceneIndex?: number;
}

/**
 * A single ActionScript 2.0 source file attached to the document.
 *
 * `path` is classpath-RELATIVE and uses forward slashes, mirroring the AS2
 * package convention (e.g. `com/example/Foo.as` for class `com.example.Foo`).
 * It is the key under which the file is stored in the dash `.fla` zip
 * (`classes/<path>`) and is used to resolve `import`/class-name references at
 * compile time (a later phase).
 */
export interface AsClassFile {
  /** Classpath-relative path with forward slashes, e.g. `com/example/Foo.as`. */
  readonly path: string;
  /** Full UTF-8 source text of the `.as` file. */
  readonly source: string;
}

export interface FlashDocument {
  readonly id: string;
  readonly properties: DocumentProperties;
  readonly scenes: readonly Scene[];
  readonly library: Library;
  /**
   * Opaque CPicSwf records captured from a binary FLA import (legacy embedded
   * SWF placements). Preserved so a future re-export can reproduce them; not
   * part of the rendered document model. Present only on imported documents
   * that contained CPicSwf records.
   */
  readonly flaSwfBlobs?: readonly FlaSwfBlob[];
  /** Named publish configurations. The active profile id is stored separately in the editor state. */
  readonly publishProfiles?: readonly PublishProfile[];
  /** Id of the currently selected publish profile. Falls back to the first profile. */
  readonly activePublishProfileId?: string;
  /**
   * Document-level accessibility settings (Window > Accessibility panel).
   * When enabled the SWF includes EnableAccessibility flag metadata.
   */
  readonly accessibility?: DocumentAccessibility;
  /**
   * AS2 class source files attached to the document. Each `path` is
   * classpath-relative (e.g. `com/example/Foo.as`). Optional — absent on
   * documents that have no external AS2 classes (the common case), so existing
   * fixtures, the binary FLA writer, and round-trip tests are unaffected.
   * Persisted in the dash `.fla` zip both as `classes/<path>` entries
   * (authoritative on load) and inline in `document.json`.
   */
  readonly asClasses?: readonly AsClassFile[];
  /**
   * AS2 classpaths (search roots for resolving class files), in priority order.
   * Mirrors Flash 8's "ActionScript Settings > Classpath". Defaults to `['.']`
   * (the document-relative root) when absent. Optional for the same
   * backward-compatibility reasons as `asClasses`.
   */
  readonly classpaths?: readonly string[];
}
