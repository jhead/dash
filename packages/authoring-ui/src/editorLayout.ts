import type { UiData, RightTab, BottomTab } from "./store/uiStore.js";
import type { ViewMode } from "./StageArea";
import type { ToolId } from "./tools/types";

// ---------------------------------------------------------------------------
// Persisted editor layout + view preferences (task 1297).
//
// The editor's chrome (pane sizes, dock/panel visibility, active tabs, and view
// toggles) lived purely in-memory: the zustand uiStore (visibility/tab/view-pref
// fields) and three Shell-local `useResize` hooks (right-pane width, timeline
// height, bottom-dock height). All of it reset on refresh/restart.
//
// This module persists the DURABLE subset to localStorage and restores it on
// mount. It mirrors the persistence hygiene in preferences.ts / threadStore.ts:
//   - a single VERSIONED key + a schema-version int for future migrations,
//   - try/catch around every read AND write (malformed JSON, privacy-mode, and
//     quota failures all fall back to defaults / no-op — never throw),
//   - normalize() validates+clamps every field on read so a corrupt/old payload
//     can never produce an out-of-range size or an unknown enum.
//
// DURABLE (persisted here):
//   - pane sizes: rightPaneWidth, timelineHeight, bottomDockHeight (clamped to
//     each pane's [min,max] on restore),
//   - rightPaneCollapsed + timelineCollapsed (collapse state),
//   - rightTab (Library/Properties/Agent), bottomTab (Actions/Sound/Output|null),
//   - view-preference toggles: snapToPixels, showRulers, viewMode,
//   - floating-panel / dock visibility toggles,
//   - last-used tool (activeTool) — simple + reasonable to restore.
//
// TRANSIENT (never persisted — owned elsewhere, per-document, or in-flight):
//   selection, modal/dialog open state, playback/agent-run state, hover/cursor,
//   instances, document content, swfBytes, drag state, clipboards.
//
// The `rightPaneCollapsed` value is the one piece that interacts with the
// responsive layout (task 1280): on a NARROW viewport the right pane must start
// collapsed (so it doesn't squeeze the stage), regardless of what was persisted
// from a desktop session. Callers pass `isNarrowViewport` to
// {@link loadEditorLayout} so a restored desktop layout can't break narrow mode.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "flash8.editorLayout";

/** Bump when the persisted shape changes incompatibly; old payloads are dropped. */
export const EDITOR_LAYOUT_SCHEMA_VERSION = 1;

/** Min/max bounds for each resizable pane — MUST match the `useResize` calls in Shell.tsx. */
export const PANE_BOUNDS = {
  rightPaneWidth: { min: 160, max: 600, default: 240 },
  timelineHeight: { min: 100, max: 760, default: 210 },
  bottomDockHeight: { min: 80, max: 600, default: 180 },
} as const;

/** The durable layout/view-preference snapshot persisted to localStorage. */
export interface EditorLayout {
  /** Right-pane (Library/Properties/Agent) inline-column width, px. */
  rightPaneWidth: number;
  /** Timeline (top dock) height, px. */
  timelineHeight: number;
  /** Bottom dock (Actions/Sound/Output) height, px. */
  bottomDockHeight: number;
  /** Whether the right pane is collapsed (clamped to viewport on restore). */
  rightPaneCollapsed: boolean;
  /** Whether the timeline dock is collapsed. */
  timelineCollapsed: boolean;
  /** Active right-pane tab. */
  rightTab: RightTab;
  /** Active bottom-dock tab (null = dock collapsed). */
  bottomTab: BottomTab | null;
  /** View preference: snap-to-pixels. */
  snapToPixels: boolean;
  /** View preference: show rulers. */
  showRulers: boolean;
  /** View preference: stage view mode (normal/outlines/…). */
  viewMode: ViewMode;
  /** Last-used tool (restored so the editor reopens on the prior tool). */
  activeTool: ToolId;
  // Floating-panel / dock visibility toggles.
  colorMixerVisible: boolean;
  alignPanelVisible: boolean;
  scenePanelVisible: boolean;
  swatchesPanelVisible: boolean;
  componentsPanelVisible: boolean;
  behaviorsPanelVisible: boolean;
  movieExplorerVisible: boolean;
  historyPanelVisible: boolean;
  accessibilityPanelVisible: boolean;
  showScenes: boolean;
  simpleButtonsEnabled: boolean;
}

export const DEFAULT_EDITOR_LAYOUT: EditorLayout = {
  rightPaneWidth: PANE_BOUNDS.rightPaneWidth.default,
  timelineHeight: PANE_BOUNDS.timelineHeight.default,
  bottomDockHeight: PANE_BOUNDS.bottomDockHeight.default,
  rightPaneCollapsed: false,
  timelineCollapsed: false,
  rightTab: "library",
  bottomTab: "actions",
  snapToPixels: false,
  showRulers: false,
  viewMode: "normal",
  activeTool: "selection",
  colorMixerVisible: false,
  alignPanelVisible: false,
  scenePanelVisible: false,
  swatchesPanelVisible: false,
  componentsPanelVisible: false,
  behaviorsPanelVisible: false,
  movieExplorerVisible: false,
  historyPanelVisible: false,
  accessibilityPanelVisible: false,
  showScenes: false,
  simpleButtonsEnabled: false,
};

const RIGHT_TABS: readonly RightTab[] = ["library", "properties", "agent"];
const BOTTOM_TABS: readonly BottomTab[] = ["actions", "sound", "output", "classes"];
const VIEW_MODES: readonly ViewMode[] = ["normal", "outlines", "antialias"];

/** Clamp a numeric pane size into its [min,max], falling back to default if not finite. */
function clampPane(n: unknown, bounds: { min: number; max: number; default: number }): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return bounds.default;
  return Math.min(bounds.max, Math.max(bounds.min, n));
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function enumOr<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Normalize an arbitrary parsed object into a complete, in-range EditorLayout.
 * Every field is validated/clamped so a corrupt or outdated payload degrades to
 * the field default rather than producing invalid state.
 */
function normalize(raw: unknown): EditorLayout {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_EDITOR_LAYOUT;
  // bottomTab is `BottomTab | null`: a stored null means "dock collapsed".
  const bottomTab: BottomTab | null =
    o.bottomTab === null
      ? null
      : enumOr(o.bottomTab, BOTTOM_TABS, d.bottomTab ?? "actions");
  return {
    rightPaneWidth: clampPane(o.rightPaneWidth, PANE_BOUNDS.rightPaneWidth),
    timelineHeight: clampPane(o.timelineHeight, PANE_BOUNDS.timelineHeight),
    bottomDockHeight: clampPane(o.bottomDockHeight, PANE_BOUNDS.bottomDockHeight),
    rightPaneCollapsed: boolOr(o.rightPaneCollapsed, d.rightPaneCollapsed),
    timelineCollapsed: boolOr(o.timelineCollapsed, d.timelineCollapsed),
    rightTab: enumOr(o.rightTab, RIGHT_TABS, d.rightTab),
    bottomTab,
    snapToPixels: boolOr(o.snapToPixels, d.snapToPixels),
    showRulers: boolOr(o.showRulers, d.showRulers),
    viewMode: enumOr(o.viewMode, VIEW_MODES, d.viewMode),
    activeTool: typeof o.activeTool === "string" ? (o.activeTool as ToolId) : d.activeTool,
    colorMixerVisible: boolOr(o.colorMixerVisible, d.colorMixerVisible),
    alignPanelVisible: boolOr(o.alignPanelVisible, d.alignPanelVisible),
    scenePanelVisible: boolOr(o.scenePanelVisible, d.scenePanelVisible),
    swatchesPanelVisible: boolOr(o.swatchesPanelVisible, d.swatchesPanelVisible),
    componentsPanelVisible: boolOr(o.componentsPanelVisible, d.componentsPanelVisible),
    behaviorsPanelVisible: boolOr(o.behaviorsPanelVisible, d.behaviorsPanelVisible),
    movieExplorerVisible: boolOr(o.movieExplorerVisible, d.movieExplorerVisible),
    historyPanelVisible: boolOr(o.historyPanelVisible, d.historyPanelVisible),
    accessibilityPanelVisible: boolOr(o.accessibilityPanelVisible, d.accessibilityPanelVisible),
    showScenes: boolOr(o.showScenes, d.showScenes),
    simpleButtonsEnabled: boolOr(o.simpleButtonsEnabled, d.simpleButtonsEnabled),
  };
}

/**
 * Read the persisted editor layout from localStorage, falling back to defaults
 * on any failure (missing, malformed, wrong schema version, privacy-mode read
 * error). When `isNarrowViewport` is true the restored `rightPaneCollapsed` is
 * forced to true so a layout persisted from a desktop session can't leave the
 * right pane expanded (and squeezing the stage) in narrow mode (task 1280).
 */
export function loadEditorLayout(isNarrowViewport = false): EditorLayout {
  const layout = readRaw();
  if (isNarrowViewport) {
    return { ...layout, rightPaneCollapsed: true };
  }
  return layout;
}

function readRaw(): EditorLayout {
  if (typeof localStorage === "undefined") return { ...DEFAULT_EDITOR_LAYOUT };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_EDITOR_LAYOUT };
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_EDITOR_LAYOUT };
    const p = parsed as Record<string, unknown>;
    // Drop a payload from an incompatible schema rather than mis-reading it.
    if (p.version !== EDITOR_LAYOUT_SCHEMA_VERSION) return { ...DEFAULT_EDITOR_LAYOUT };
    return normalize(p.layout);
  } catch {
    return { ...DEFAULT_EDITOR_LAYOUT };
  }
}

/**
 * Persist the editor layout to localStorage (no-op when storage is unavailable).
 * Normalizes first, and swallows quota / privacy-mode write failures so a write
 * is never fatal to the UI (mirrors preferences.ts).
 */
export function saveEditorLayout(layout: EditorLayout): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload = JSON.stringify({
      version: EDITOR_LAYOUT_SCHEMA_VERSION,
      layout: normalize(layout),
    });
    localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // Ignore quota / privacy-mode write failures: persistence is best-effort.
  }
}

/**
 * The subset of {@link EditorLayout} that the uiStore owns (everything except
 * the three resize sizes, which live in Shell's `useResize` hooks). Used to seed
 * the store on mount.
 */
export type PersistedUiSlice = Omit<
  EditorLayout,
  "rightPaneWidth" | "timelineHeight" | "bottomDockHeight" | "activeTool"
>;

/** Project an EditorLayout into the partial UiData used to seed createUiStore. */
export function layoutToUiInit(
  layout: EditorLayout,
  baseToolState: UiData["toolState"]
): Partial<UiData> {
  return {
    rightPaneCollapsed: layout.rightPaneCollapsed,
    timelineCollapsed: layout.timelineCollapsed,
    rightTab: layout.rightTab,
    bottomTab: layout.bottomTab,
    snapToPixels: layout.snapToPixels,
    showRulers: layout.showRulers,
    viewMode: layout.viewMode,
    colorMixerVisible: layout.colorMixerVisible,
    alignPanelVisible: layout.alignPanelVisible,
    scenePanelVisible: layout.scenePanelVisible,
    swatchesPanelVisible: layout.swatchesPanelVisible,
    componentsPanelVisible: layout.componentsPanelVisible,
    behaviorsPanelVisible: layout.behaviorsPanelVisible,
    movieExplorerVisible: layout.movieExplorerVisible,
    historyPanelVisible: layout.historyPanelVisible,
    accessibilityPanelVisible: layout.accessibilityPanelVisible,
    showScenes: layout.showScenes,
    simpleButtonsEnabled: layout.simpleButtonsEnabled,
    toolState: { ...baseToolState, activeTool: layout.activeTool },
  };
}

/** Extract the durable layout snapshot from current uiStore data + the three pane sizes. */
export function uiStateToLayout(
  ui: UiData,
  sizes: { rightPaneWidth: number; timelineHeight: number; bottomDockHeight: number }
): EditorLayout {
  return {
    rightPaneWidth: sizes.rightPaneWidth,
    timelineHeight: sizes.timelineHeight,
    bottomDockHeight: sizes.bottomDockHeight,
    rightPaneCollapsed: ui.rightPaneCollapsed,
    timelineCollapsed: ui.timelineCollapsed,
    rightTab: ui.rightTab,
    bottomTab: ui.bottomTab,
    snapToPixels: ui.snapToPixels,
    showRulers: ui.showRulers,
    viewMode: ui.viewMode,
    activeTool: ui.toolState.activeTool,
    colorMixerVisible: ui.colorMixerVisible,
    alignPanelVisible: ui.alignPanelVisible,
    scenePanelVisible: ui.scenePanelVisible,
    swatchesPanelVisible: ui.swatchesPanelVisible,
    componentsPanelVisible: ui.componentsPanelVisible,
    behaviorsPanelVisible: ui.behaviorsPanelVisible,
    movieExplorerVisible: ui.movieExplorerVisible,
    historyPanelVisible: ui.historyPanelVisible,
    accessibilityPanelVisible: ui.accessibilityPanelVisible,
    showScenes: ui.showScenes,
    simpleButtonsEnabled: ui.simpleButtonsEnabled,
  };
}
