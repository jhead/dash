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
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export interface SoundLinkage {
  readonly libraryItemId: string;   // ID of a Sound library item
  readonly syncMode: "event" | "start" | "stop" | "stream";
  readonly repeatCount: number;     // 0 = loop indefinitely
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
  readonly motionEase: number;      // -100..100
  readonly motionRotate: "none" | "auto" | "cw" | "ccw";
  readonly motionRotateCount: number;
  readonly motionOrientToPath: boolean;
  readonly motionSync: boolean;
  readonly motionScale: boolean;
  // Shape tween
  readonly shapeEase: number;       // -100..100
  readonly shapeBlend: "distributive" | "angular";
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

export interface Symbol {
  readonly id: string;
  readonly name: string;
  readonly itemType: "symbol";
  readonly symbolType: SymbolType;
  readonly timeline: Timeline;
  readonly linkage: SymbolLinkage;
  /** 9-slice grid in symbol-local coordinates, or null if not set */
  readonly scale9Grid: Scale9Grid | null;
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
// Top-level document
// ---------------------------------------------------------------------------

export interface FlashDocument {
  readonly id: string;
  readonly properties: DocumentProperties;
  readonly scenes: readonly Scene[];
  readonly library: Library;
}
