import { createStore, type StoreApi } from "zustand/vanilla";
import type { SymbolType, TextAlign, BitmapItem, SubSelection } from "@flash/core";
import type { FrameSizeReport, VideoProbe } from "@flash/swf";
import type { PlacedInstance } from "../PropertiesPanel";
import type { ViewMode } from "../StageArea";
import type { TextFormat } from "../EditBar";
import type { PublishSettings } from "../PublishSettingsDialog";
import type { TimelineEffectType } from "../TimelineEffectDialog";
import type { SavedCommand } from "../savedCommands.js";
import type { ToolState } from "../tools/types";

// ---------------------------------------------------------------------------
// Shared UI types (were Shell-local). Kept here so the store and the Shell
// sections that consume these slices share one definition.
// ---------------------------------------------------------------------------

export interface EditContext {
  mode: "document" | "symbol";
  symbolId?: string;
  symbolName?: string;
  symbolType?: SymbolType;
}

export type EditPathEntry = { symbolId: string; instanceId: string };

export type BottomTab = "actions" | "sound" | "output" | "classes";

/** The top dock (alongside the stage) hosts the Timeline and the Live Preview. */
export type TopTab = "timeline" | "preview";

export type RightTab = "library" | "properties" | "agent";

export interface EnvelopeTarget {
  frameIdx: number;
  layerIdx: number;
}

export interface SelectedFrameRange {
  layerId: string;
  start: number;
  end: number;
}

/**
 * A video file the user selected via File > Import > Import Video, held while
 * the VideoImportDialog wizard surfaces its metadata and collects the embed
 * target. `probe` is null when the container could not be demuxed (the wizard
 * falls back to user-editable defaults).
 */
export interface PendingVideoImport {
  /** Base64 data URI of the source file bytes. */
  dataUri: string;
  /** Probed codec/dimensions/frame metadata, or null if undecodable. */
  probe: VideoProbe | null;
  /** Suggested library item name (source file name, no extension). */
  suggestedName: string;
  /** Source file basename (for display). */
  fileName: string;
}

/** Default tool state (moved out of Shell so the store owns the tool slice). */
export const DEFAULT_TOOL_STATE: ToolState = {
  activeTool: "selection",
  objectDrawing: false,
  strokeColor: "#000000",
  fill: { type: "solid", color: { r: 255, g: 255, b: 255, a: 255 } },
  fillColor: "#ffffff",
  strokeWidth: 1,
  strokeAlpha: 100,
  pencilMode: "ink",
  brushSize: 8,
  brushShape: "round",
  brushMode: "normal",
  brushLockFill: false,
  brushPressure: false,
  brushTilt: false,
  eraserSize: 16,
  eraserMode: "normal",
  eraserFaucet: false,
  bucketGapSize: "none",
  bucketLockFill: false,
  rectCornerRadius: 0,
  penSubTool: "pen",
  freeTransformMode: "rotate-scale",
  lassoPolygonMode: false,
  lassoMagicWand: false,
  magicWandThreshold: 20,
  magicWandSmoothing: "pixels",
  polyStarOptions: { shapeType: "polygon", sides: 5, pointSize: 0.5 },
};

export const DEFAULT_TEXT_FORMAT: TextFormat = {
  fontFamily: "Arial",
  fontSize: 12,
  bold: false,
  italic: false,
  align: "left" as TextAlign,
  color: "#000000",
};

// ---------------------------------------------------------------------------
// State shape: data fields + React-style setters (value | updater).
// ---------------------------------------------------------------------------

/** A drop-in replacement for React's `useState` setter (value or updater fn). */
export type ReactSetter<T> = (value: T | ((prev: T) => T)) => void;

/** Plain data fields (no setters) — the slices migrated out of Shell. */
export interface UiData {
  // edit context / scene / layer / file
  editContext: EditContext;
  editPath: EditPathEntry[];
  filePath: string | undefined;
  activeSceneIndex: number;
  activeLayerIndex: number;

  // frame / playback
  currentFrame: number;
  isPlaying: boolean;
  onionSkinEnabled: boolean;
  onionSkinOutlines: boolean;
  onionBefore: number;
  onionAfter: number;
  editMultipleFrames: boolean;
  hasMotionClipboard: boolean;

  // panel tabs / collapse
  selectedLibraryItemId: string | null;
  rightTab: RightTab;
  bottomTab: BottomTab | null;
  /** Active top-dock tab (Timeline | Live Preview), shown alongside the stage. */
  topTab: TopTab;
  timelineCollapsed: boolean;
  /**
   * Whether the right pane (Library / Properties / future Agent dock) is
   * collapsed. On a narrow/touch viewport it defaults collapsed and renders as
   * a toggleable overlay drawer so it does not obscure or squeeze the stage; on
   * a desktop-width viewport it is an inline column and this is false.
   */
  rightPaneCollapsed: boolean;
  preferencesOpen: boolean;

  // selection / instances
  instances: PlacedInstance[];
  selectedInstanceId: string | null;
  selectedShapeIds: string[];
  /**
   * Partial (face/segment) selection within a merged planar shape (the default
   * merge model — docs/36-vector-merge-model.md). Lives ALONGSIDE
   * `selectedShapeIds` (which stays the whole-object selection); ephemeral UI
   * state, not persisted.
   */
  subSelection: SubSelection | null;

  // view
  zoom: number;
  panX: number;
  panY: number;
  cursorPos: { x: number; y: number } | null;
  snapToPixels: boolean;
  viewMode: ViewMode;
  showRulers: boolean;

  // tool / text
  toolState: ToolState;
  textFormat: TextFormat;
  editingTextId: string | null;

  // color / mixer
  colorPanelVisible: boolean;
  colorMixerVisible: boolean;
  mixerFillAlpha: number;
  mixerStrokeAlpha: number;

  // floating panels
  filtersPanelVisible: boolean;
  alignPanelVisible: boolean;
  scenePanelVisible: boolean;
  swatchesPanelVisible: boolean;
  componentsPanelVisible: boolean;
  swatches: string[];
  behaviorsPanelVisible: boolean;
  movieExplorerVisible: boolean;
  historyPanelVisible: boolean;
  savedCommands: SavedCommand[];
  manageCommandsOpen: boolean;
  accessibilityPanelVisible: boolean;
  showScenes: boolean;

  // player / output
  playerOpen: boolean;
  swfBytes: Uint8Array | null;
  playerError: string | null;
  outputMessages: string[];

  // dialogs
  docPropsOpen: boolean;
  findReplaceVisible: boolean;
  editGridOpen: boolean;
  convertToSymbolOpen: boolean;
  swapSymbolOpen: boolean;
  timelineEffectOpen: boolean;
  timelineEffectInitial: TimelineEffectType;
  envelopeDialogOpen: boolean;
  envelopeDialogTarget: EnvelopeTarget | null;
  publishSettingsOpen: boolean;
  publishSettings: PublishSettings;
  bitmapPropsItem: BitmapItem | null;
  swapBitmapDialogOpen: boolean;
  swapBitmapTargetId: string | null;
  traceBitmapOpen: boolean;
  videoImportPending: PendingVideoImport | null;
  exportGifOpen: boolean;
  bandwidthProfilerVisible: boolean;
  bandwidthProfilerReport: FrameSizeReport | null;
  simpleButtonsEnabled: boolean;

  // frame clipboard / drag
  selectedFrameRange: SelectedFrameRange | null;
  hasFrameClipboard: boolean;
  isDragOver: boolean;
}

/** Setters, one per data field, named `set<Field>` to match Shell's call sites. */
export interface UiActions {
  setEditContext: ReactSetter<EditContext>;
  setEditPath: ReactSetter<EditPathEntry[]>;
  setFilePath: ReactSetter<string | undefined>;
  setActiveSceneIndex: ReactSetter<number>;
  setActiveLayerIndex: ReactSetter<number>;
  setCurrentFrame: ReactSetter<number>;
  setIsPlaying: ReactSetter<boolean>;
  setOnionSkinEnabled: ReactSetter<boolean>;
  setOnionSkinOutlines: ReactSetter<boolean>;
  setOnionBefore: ReactSetter<number>;
  setOnionAfter: ReactSetter<number>;
  setEditMultipleFrames: ReactSetter<boolean>;
  setHasMotionClipboard: ReactSetter<boolean>;
  setSelectedLibraryItemId: ReactSetter<string | null>;
  setRightTab: ReactSetter<RightTab>;
  setBottomTab: ReactSetter<BottomTab | null>;
  setTopTab: ReactSetter<TopTab>;
  setTimelineCollapsed: ReactSetter<boolean>;
  setRightPaneCollapsed: ReactSetter<boolean>;
  setPreferencesOpen: ReactSetter<boolean>;
  setInstances: ReactSetter<PlacedInstance[]>;
  setSelectedInstanceId: ReactSetter<string | null>;
  setSelectedShapeIds: ReactSetter<string[]>;
  setSubSelection: ReactSetter<SubSelection | null>;
  setZoom: ReactSetter<number>;
  setPanX: ReactSetter<number>;
  setPanY: ReactSetter<number>;
  setCursorPos: ReactSetter<{ x: number; y: number } | null>;
  setSnapToPixels: ReactSetter<boolean>;
  setViewMode: ReactSetter<ViewMode>;
  setShowRulers: ReactSetter<boolean>;
  setToolState: ReactSetter<ToolState>;
  setTextFormat: ReactSetter<TextFormat>;
  setEditingTextId: ReactSetter<string | null>;
  setColorPanelVisible: ReactSetter<boolean>;
  setColorMixerVisible: ReactSetter<boolean>;
  setMixerFillAlpha: ReactSetter<number>;
  setMixerStrokeAlpha: ReactSetter<number>;
  setFiltersPanelVisible: ReactSetter<boolean>;
  setAlignPanelVisible: ReactSetter<boolean>;
  setScenePanelVisible: ReactSetter<boolean>;
  setSwatchesPanelVisible: ReactSetter<boolean>;
  setComponentsPanelVisible: ReactSetter<boolean>;
  setSwatches: ReactSetter<string[]>;
  setBehaviorsPanelVisible: ReactSetter<boolean>;
  setMovieExplorerVisible: ReactSetter<boolean>;
  setHistoryPanelVisible: ReactSetter<boolean>;
  setSavedCommands: ReactSetter<SavedCommand[]>;
  setManageCommandsOpen: ReactSetter<boolean>;
  setAccessibilityPanelVisible: ReactSetter<boolean>;
  setShowScenes: ReactSetter<boolean>;
  setPlayerOpen: ReactSetter<boolean>;
  setSwfBytes: ReactSetter<Uint8Array | null>;
  setPlayerError: ReactSetter<string | null>;
  setOutputMessages: ReactSetter<string[]>;
  setDocPropsOpen: ReactSetter<boolean>;
  setFindReplaceVisible: ReactSetter<boolean>;
  setEditGridOpen: ReactSetter<boolean>;
  setConvertToSymbolOpen: ReactSetter<boolean>;
  setSwapSymbolOpen: ReactSetter<boolean>;
  setTimelineEffectOpen: ReactSetter<boolean>;
  setTimelineEffectInitial: ReactSetter<TimelineEffectType>;
  setEnvelopeDialogOpen: ReactSetter<boolean>;
  setEnvelopeDialogTarget: ReactSetter<EnvelopeTarget | null>;
  setPublishSettingsOpen: ReactSetter<boolean>;
  setPublishSettings: ReactSetter<PublishSettings>;
  setBitmapPropsItem: ReactSetter<BitmapItem | null>;
  setSwapBitmapDialogOpen: ReactSetter<boolean>;
  setSwapBitmapTargetId: ReactSetter<string | null>;
  setTraceBitmapOpen: ReactSetter<boolean>;
  setVideoImportPending: ReactSetter<PendingVideoImport | null>;
  setExportGifOpen: ReactSetter<boolean>;
  setBandwidthProfilerVisible: ReactSetter<boolean>;
  setBandwidthProfilerReport: ReactSetter<FrameSizeReport | null>;
  setSimpleButtonsEnabled: ReactSetter<boolean>;
  setSelectedFrameRange: ReactSetter<SelectedFrameRange | null>;
  setHasFrameClipboard: ReactSetter<boolean>;
  setIsDragOver: ReactSetter<boolean>;
}

export type UiState = UiData & UiActions;
export type UiStoreApi = StoreApi<UiState>;

type SetFn = UiStoreApi["setState"];
type GetFn = UiStoreApi["getState"];

/** Build a setState-compatible setter (value | updater) for one data field. */
function rs<K extends keyof UiData>(set: SetFn, get: GetFn, key: K): ReactSetter<UiData[K]> {
  return (value) =>
    set({
      [key]:
        typeof value === "function"
          ? (value as (prev: UiData[K]) => UiData[K])(get()[key])
          : value,
    } as Partial<UiState>);
}

const DEFAULTS: UiData = {
  editContext: { mode: "document" },
  editPath: [],
  filePath: undefined,
  activeSceneIndex: 0,
  activeLayerIndex: 0,
  currentFrame: 0,
  isPlaying: false,
  onionSkinEnabled: false,
  onionSkinOutlines: false,
  onionBefore: 2,
  onionAfter: 2,
  editMultipleFrames: false,
  hasMotionClipboard: false,
  selectedLibraryItemId: null,
  rightTab: "library",
  bottomTab: "actions",
  topTab: "timeline",
  timelineCollapsed: false,
  rightPaneCollapsed: false,
  preferencesOpen: false,
  instances: [],
  selectedInstanceId: null,
  selectedShapeIds: [],
  subSelection: null,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  cursorPos: null,
  snapToPixels: false,
  viewMode: "normal",
  showRulers: false,
  toolState: DEFAULT_TOOL_STATE,
  textFormat: DEFAULT_TEXT_FORMAT,
  editingTextId: null,
  colorPanelVisible: false,
  colorMixerVisible: false,
  mixerFillAlpha: 100,
  mixerStrokeAlpha: 100,
  filtersPanelVisible: false,
  alignPanelVisible: false,
  scenePanelVisible: false,
  swatchesPanelVisible: false,
  componentsPanelVisible: false,
  swatches: [],
  behaviorsPanelVisible: false,
  movieExplorerVisible: false,
  historyPanelVisible: false,
  savedCommands: [],
  manageCommandsOpen: false,
  accessibilityPanelVisible: false,
  showScenes: false,
  playerOpen: false,
  swfBytes: null,
  playerError: null,
  outputMessages: [],
  docPropsOpen: false,
  findReplaceVisible: false,
  editGridOpen: false,
  convertToSymbolOpen: false,
  swapSymbolOpen: false,
  timelineEffectOpen: false,
  timelineEffectInitial: "transform",
  envelopeDialogOpen: false,
  envelopeDialogTarget: null,
  publishSettingsOpen: false,
  // Neutral placeholder; Shell injects the real default (needs DEFAULT_HTML_OPTIONS).
  publishSettings: {
    filename: "movie.swf",
    jpegQuality: 80,
    audioStreamFormat: "mp3",
    audioEventFormat: "mp3",
    compress: true,
    protect: false,
    debuggingPermitted: false,
    debugPassword: "",
    html: {} as PublishSettings["html"],
  },
  bitmapPropsItem: null,
  swapBitmapDialogOpen: false,
  swapBitmapTargetId: null,
  traceBitmapOpen: false,
  videoImportPending: null,
  exportGifOpen: false,
  bandwidthProfilerVisible: false,
  bandwidthProfilerReport: null,
  simpleButtonsEnabled: false,
  selectedFrameRange: null,
  hasFrameClipboard: false,
  isDragOver: false,
};

/**
 * Build a per-instance UI store. `init` lets Shell inject defaults that depend
 * on view-module *values* (swatches palette, loaded saved-commands, publish
 * settings) so this module keeps only type-level imports from view components.
 */
export function createUiStore(init?: Partial<UiData>): UiStoreApi {
  return createStore<UiState>((set, get) => ({
    ...DEFAULTS,
    ...init,
    setEditContext: rs(set, get, "editContext"),
    setEditPath: rs(set, get, "editPath"),
    setFilePath: rs(set, get, "filePath"),
    setActiveSceneIndex: rs(set, get, "activeSceneIndex"),
    setActiveLayerIndex: rs(set, get, "activeLayerIndex"),
    setCurrentFrame: rs(set, get, "currentFrame"),
    setIsPlaying: rs(set, get, "isPlaying"),
    setOnionSkinEnabled: rs(set, get, "onionSkinEnabled"),
    setOnionSkinOutlines: rs(set, get, "onionSkinOutlines"),
    setOnionBefore: rs(set, get, "onionBefore"),
    setOnionAfter: rs(set, get, "onionAfter"),
    setEditMultipleFrames: rs(set, get, "editMultipleFrames"),
    setHasMotionClipboard: rs(set, get, "hasMotionClipboard"),
    setSelectedLibraryItemId: rs(set, get, "selectedLibraryItemId"),
    setRightTab: rs(set, get, "rightTab"),
    setBottomTab: rs(set, get, "bottomTab"),
    setTopTab: rs(set, get, "topTab"),
    setTimelineCollapsed: rs(set, get, "timelineCollapsed"),
    setRightPaneCollapsed: rs(set, get, "rightPaneCollapsed"),
    setPreferencesOpen: rs(set, get, "preferencesOpen"),
    setInstances: rs(set, get, "instances"),
    setSelectedInstanceId: rs(set, get, "selectedInstanceId"),
    setSelectedShapeIds: rs(set, get, "selectedShapeIds"),
    setSubSelection: rs(set, get, "subSelection"),
    setZoom: rs(set, get, "zoom"),
    setPanX: rs(set, get, "panX"),
    setPanY: rs(set, get, "panY"),
    setCursorPos: rs(set, get, "cursorPos"),
    setSnapToPixels: rs(set, get, "snapToPixels"),
    setViewMode: rs(set, get, "viewMode"),
    setShowRulers: rs(set, get, "showRulers"),
    setToolState: rs(set, get, "toolState"),
    setTextFormat: rs(set, get, "textFormat"),
    setEditingTextId: rs(set, get, "editingTextId"),
    setColorPanelVisible: rs(set, get, "colorPanelVisible"),
    setColorMixerVisible: rs(set, get, "colorMixerVisible"),
    setMixerFillAlpha: rs(set, get, "mixerFillAlpha"),
    setMixerStrokeAlpha: rs(set, get, "mixerStrokeAlpha"),
    setFiltersPanelVisible: rs(set, get, "filtersPanelVisible"),
    setAlignPanelVisible: rs(set, get, "alignPanelVisible"),
    setScenePanelVisible: rs(set, get, "scenePanelVisible"),
    setSwatchesPanelVisible: rs(set, get, "swatchesPanelVisible"),
    setComponentsPanelVisible: rs(set, get, "componentsPanelVisible"),
    setSwatches: rs(set, get, "swatches"),
    setBehaviorsPanelVisible: rs(set, get, "behaviorsPanelVisible"),
    setMovieExplorerVisible: rs(set, get, "movieExplorerVisible"),
    setHistoryPanelVisible: rs(set, get, "historyPanelVisible"),
    setSavedCommands: rs(set, get, "savedCommands"),
    setManageCommandsOpen: rs(set, get, "manageCommandsOpen"),
    setAccessibilityPanelVisible: rs(set, get, "accessibilityPanelVisible"),
    setShowScenes: rs(set, get, "showScenes"),
    setPlayerOpen: rs(set, get, "playerOpen"),
    setSwfBytes: rs(set, get, "swfBytes"),
    setPlayerError: rs(set, get, "playerError"),
    setOutputMessages: rs(set, get, "outputMessages"),
    setDocPropsOpen: rs(set, get, "docPropsOpen"),
    setFindReplaceVisible: rs(set, get, "findReplaceVisible"),
    setEditGridOpen: rs(set, get, "editGridOpen"),
    setConvertToSymbolOpen: rs(set, get, "convertToSymbolOpen"),
    setSwapSymbolOpen: rs(set, get, "swapSymbolOpen"),
    setTimelineEffectOpen: rs(set, get, "timelineEffectOpen"),
    setTimelineEffectInitial: rs(set, get, "timelineEffectInitial"),
    setEnvelopeDialogOpen: rs(set, get, "envelopeDialogOpen"),
    setEnvelopeDialogTarget: rs(set, get, "envelopeDialogTarget"),
    setPublishSettingsOpen: rs(set, get, "publishSettingsOpen"),
    setPublishSettings: rs(set, get, "publishSettings"),
    setBitmapPropsItem: rs(set, get, "bitmapPropsItem"),
    setSwapBitmapDialogOpen: rs(set, get, "swapBitmapDialogOpen"),
    setSwapBitmapTargetId: rs(set, get, "swapBitmapTargetId"),
    setTraceBitmapOpen: rs(set, get, "traceBitmapOpen"),
    setVideoImportPending: rs(set, get, "videoImportPending"),
    setExportGifOpen: rs(set, get, "exportGifOpen"),
    setBandwidthProfilerVisible: rs(set, get, "bandwidthProfilerVisible"),
    setBandwidthProfilerReport: rs(set, get, "bandwidthProfilerReport"),
    setSimpleButtonsEnabled: rs(set, get, "simpleButtonsEnabled"),
    setSelectedFrameRange: rs(set, get, "selectedFrameRange"),
    setHasFrameClipboard: rs(set, get, "hasFrameClipboard"),
    setIsDragOver: rs(set, get, "isDragOver"),
  }));
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectSelectedShapeIds = (s: UiState): string[] => s.selectedShapeIds;

export const selectSubSelection = (s: UiState): SubSelection | null => s.subSelection;
/** Backward-compat single selection: the id when exactly one shape is selected. */
export const selectSelectedShapeId = (s: UiState): string | null =>
  s.selectedShapeIds.length === 1 ? s.selectedShapeIds[0] : null;
export const selectSelectedInstanceId = (s: UiState): string | null => s.selectedInstanceId;
