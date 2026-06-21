import { afterAll, beforeEach, describe, expect, it } from "vitest";

const STORAGE_KEY = "flash8.editorLayout";

// The authoring-ui vitest environment is "node" (no DOM), so install a minimal
// in-memory localStorage before importing the module under test. A `throwOnSet`
// switch lets us simulate a quota / privacy-mode write failure.
class MemoryStorage {
  private store = new Map<string, string>();
  throwOnSet = false;
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) {
    if (this.throwOnSet) throw new DOMException("QuotaExceededError");
    this.store.set(k, String(v));
  }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); this.throwOnSet = false; }
}
const hadLocalStorage = "localStorage" in globalThis;
const mem = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = mem;

const {
  DEFAULT_EDITOR_LAYOUT,
  EDITOR_LAYOUT_SCHEMA_VERSION,
  PANE_BOUNDS,
  loadEditorLayout,
  saveEditorLayout,
  layoutToUiInit,
  uiStateToLayout,
} = await import("../editorLayout");
const { DEFAULT_TOOL_STATE } = await import("../store/uiStore");

afterAll(() => {
  if (!hadLocalStorage) {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  }
});

describe("editorLayout persistence", () => {
  beforeEach(() => {
    mem.clear();
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadEditorLayout()).toEqual(DEFAULT_EDITOR_LAYOUT);
  });

  it("round-trips every durable field through localStorage", () => {
    const layout = {
      ...DEFAULT_EDITOR_LAYOUT,
      rightPaneWidth: 320,
      timelineHeight: 300,
      bottomDockHeight: 250,
      layerColumnWidth: 180,
      rightPaneCollapsed: true,
      timelineCollapsed: true,
      rightTab: "properties" as const,
      bottomTab: "output" as const,
      snapToPixels: true,
      showRulers: true,
      viewMode: "outlines" as const,
      activeTool: "pencil" as const,
      colorMixerVisible: true,
      alignPanelVisible: true,
      historyPanelVisible: true,
      showScenes: true,
      simpleButtonsEnabled: true,
    };
    saveEditorLayout(layout);
    // Loaded back identically (rightPaneCollapsed preserved on desktop load).
    expect(loadEditorLayout(false)).toEqual(layout);
  });

  it("persists a versioned payload (schema version + nested layout)", () => {
    saveEditorLayout({ ...DEFAULT_EDITOR_LAYOUT, rightPaneWidth: 333 });
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.version).toBe(EDITOR_LAYOUT_SCHEMA_VERSION);
    expect(raw.layout.rightPaneWidth).toBe(333);
  });

  it("never writes transient fields (only the durable schema keys)", () => {
    saveEditorLayout(DEFAULT_EDITOR_LAYOUT);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    const persistedKeys = Object.keys(raw.layout).sort();
    expect(persistedKeys).toEqual(Object.keys(DEFAULT_EDITOR_LAYOUT).sort());
    // Spot-check that known transient fields never leak into the payload.
    for (const transient of [
      "selectedInstanceId", "selectedShapeIds", "instances", "isPlaying",
      "preferencesOpen", "docPropsOpen", "swfBytes", "cursorPos", "isDragOver",
      "currentFrame", "playerOpen",
    ]) {
      expect(raw.layout).not.toHaveProperty(transient);
    }
  });

  it("clamps restored pane sizes into [min,max]", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: EDITOR_LAYOUT_SCHEMA_VERSION,
        layout: {
          rightPaneWidth: 99999,
          timelineHeight: 1,
          bottomDockHeight: -50,
          layerColumnWidth: 99999,
        },
      })
    );
    const loaded = loadEditorLayout();
    expect(loaded.rightPaneWidth).toBe(PANE_BOUNDS.rightPaneWidth.max);
    expect(loaded.timelineHeight).toBe(PANE_BOUNDS.timelineHeight.min);
    expect(loaded.bottomDockHeight).toBe(PANE_BOUNDS.bottomDockHeight.min);
    expect(loaded.layerColumnWidth).toBe(PANE_BOUNDS.layerColumnWidth.max);
  });

  // Task 1366 — the Timeline layers-column width persists set -> stored ->
  // restored, exactly like the other resizable dividers.
  it("round-trips the timeline layers-column width (set -> persisted -> restored)", () => {
    saveEditorLayout({ ...DEFAULT_EDITOR_LAYOUT, layerColumnWidth: 210 });
    // Persisted in the versioned payload under the durable key.
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.layout.layerColumnWidth).toBe(210);
    // And restored on the next load.
    expect(loadEditorLayout().layerColumnWidth).toBe(210);
  });

  it("clamps a too-small persisted layers-column width up to the min", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: EDITOR_LAYOUT_SCHEMA_VERSION,
        layout: { layerColumnWidth: 10 },
      })
    );
    expect(loadEditorLayout().layerColumnWidth).toBe(PANE_BOUNDS.layerColumnWidth.min);
  });

  it("defaults a non-finite / missing layers-column width", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: EDITOR_LAYOUT_SCHEMA_VERSION,
        layout: { layerColumnWidth: "wide" },
      })
    );
    expect(loadEditorLayout().layerColumnWidth).toBe(PANE_BOUNDS.layerColumnWidth.default);
  });

  it("falls back to defaults on malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(loadEditorLayout()).toEqual(DEFAULT_EDITOR_LAYOUT);
  });

  it("drops a payload from an incompatible schema version", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 999, layout: { rightPaneWidth: 500 } })
    );
    expect(loadEditorLayout()).toEqual(DEFAULT_EDITOR_LAYOUT);
  });

  it("coerces unknown enum values back to defaults", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: EDITOR_LAYOUT_SCHEMA_VERSION,
        layout: { rightTab: "bogus", viewMode: "nope", bottomTab: "weird" },
      })
    );
    const loaded = loadEditorLayout();
    expect(loaded.rightTab).toBe(DEFAULT_EDITOR_LAYOUT.rightTab);
    expect(loaded.viewMode).toBe(DEFAULT_EDITOR_LAYOUT.viewMode);
    expect(loaded.bottomTab).toBe(DEFAULT_EDITOR_LAYOUT.bottomTab);
  });

  it("preserves a null bottomTab (dock-collapsed) round-trip", () => {
    saveEditorLayout({ ...DEFAULT_EDITOR_LAYOUT, bottomTab: null });
    expect(loadEditorLayout().bottomTab).toBeNull();
  });

  it("recognizes the 'classes' bottom-dock tab (task 1302 P4)", () => {
    saveEditorLayout({ ...DEFAULT_EDITOR_LAYOUT, bottomTab: "classes" });
    expect(loadEditorLayout().bottomTab).toBe("classes");
  });

  it("does not throw on a quota / privacy-mode write failure", () => {
    mem.throwOnSet = true;
    expect(() => saveEditorLayout(DEFAULT_EDITOR_LAYOUT)).not.toThrow();
    mem.throwOnSet = false;
  });

  describe("narrow-viewport clamp (task 1280)", () => {
    it("forces rightPaneCollapsed=true on narrow even if persisted expanded", () => {
      saveEditorLayout({ ...DEFAULT_EDITOR_LAYOUT, rightPaneCollapsed: false });
      expect(loadEditorLayout(true).rightPaneCollapsed).toBe(true);
      // Other restored fields are untouched by the clamp.
      expect(loadEditorLayout(true).rightTab).toBe(DEFAULT_EDITOR_LAYOUT.rightTab);
    });

    it("leaves rightPaneCollapsed as persisted on desktop (wide) load", () => {
      saveEditorLayout({ ...DEFAULT_EDITOR_LAYOUT, rightPaneCollapsed: false });
      expect(loadEditorLayout(false).rightPaneCollapsed).toBe(false);
    });
  });
});

describe("layoutToUiInit / uiStateToLayout (store seeding + extraction)", () => {
  it("projects the durable layout into a UiData seed (excluding pane sizes)", () => {
    const layout = {
      ...DEFAULT_EDITOR_LAYOUT,
      rightTab: "agent" as const,
      bottomTab: "sound" as const,
      snapToPixels: true,
      showRulers: true,
      viewMode: "antialias" as const,
      activeTool: "brush" as const,
      alignPanelVisible: true,
      rightPaneCollapsed: true,
      timelineCollapsed: true,
    };
    const init = layoutToUiInit(layout, DEFAULT_TOOL_STATE);
    expect(init.rightTab).toBe("agent");
    expect(init.bottomTab).toBe("sound");
    expect(init.snapToPixels).toBe(true);
    expect(init.showRulers).toBe(true);
    expect(init.viewMode).toBe("antialias");
    expect(init.alignPanelVisible).toBe(true);
    expect(init.rightPaneCollapsed).toBe(true);
    expect(init.timelineCollapsed).toBe(true);
    // Last-used tool is folded into toolState (rest of toolState preserved).
    expect(init.toolState?.activeTool).toBe("brush");
    expect(init.toolState?.strokeColor).toBe(DEFAULT_TOOL_STATE.strokeColor);
    // Pane SIZES are NOT part of the uiStore seed.
    expect(init).not.toHaveProperty("rightPaneWidth");
    expect(init).not.toHaveProperty("timelineHeight");
    expect(init).not.toHaveProperty("bottomDockHeight");
    expect(init).not.toHaveProperty("layerColumnWidth");
  });

  it("round-trips uiState -> layout -> uiInit for durable fields", () => {
    // Minimal UiData stand-in carrying just the durable fields uiStateToLayout reads.
    const ui = {
      ...buildMinimalUiData(),
      rightTab: "properties" as const,
      bottomTab: null,
      snapToPixels: true,
      historyPanelVisible: true,
      toolState: { ...DEFAULT_TOOL_STATE, activeTool: "oval" as const },
    };
    const layout = uiStateToLayout(ui as never, {
      rightPaneWidth: 280,
      timelineHeight: 220,
      bottomDockHeight: 190,
      layerColumnWidth: 170,
    });
    expect(layout.rightPaneWidth).toBe(280);
    expect(layout.layerColumnWidth).toBe(170);
    expect(layout.rightTab).toBe("properties");
    expect(layout.bottomTab).toBeNull();
    expect(layout.snapToPixels).toBe(true);
    expect(layout.historyPanelVisible).toBe(true);
    expect(layout.activeTool).toBe("oval");
    // Re-seeding produces a consistent uiInit.
    const init = layoutToUiInit(layout, DEFAULT_TOOL_STATE);
    expect(init.toolState?.activeTool).toBe("oval");
  });
});

// Adversarial-persistence guard (the 1316/1317 bug classes applied to the layout
// surface). Layout persist is synchronous (resize-end callback + uiStore
// subscription in Shell, no debounce), so it has no lost-on-close window; these
// pin that there is no stale-write clobber and no enum-key normalization
// asymmetry on restore.
describe("adversarial persistence (1316/1317 classes)", () => {
  beforeEach(() => mem.clear());

  // CLASS 1 — a saved change is immediately readable (no flush/debounce window).
  it("a saved layout change is immediately readable with no flush", () => {
    saveEditorLayout({
      ...DEFAULT_EDITOR_LAYOUT,
      rightPaneWidth: 333,
      timelineCollapsed: true,
    });
    const r = loadEditorLayout();
    expect(r.rightPaneWidth).toBe(333);
    expect(r.timelineCollapsed).toBe(true);
  });

  // CLASS 2 — N rapid sequential writes: the latest wins, no stale clobber.
  it("the latest of N rapid sequential saves is what persists", () => {
    for (let i = 0; i < 20; i++) {
      saveEditorLayout({ ...DEFAULT_EDITOR_LAYOUT, rightPaneWidth: 200 + i });
    }
    expect(loadEditorLayout().rightPaneWidth).toBe(219);
  });

  // CLASS 3 — enum keys are matched EXACTLY by normalize(); a near-miss
  // (casing/whitespace) falls back to the default rather than restoring a wrong
  // slot. Read and write both pass through normalize, so the match is symmetric.
  it("near-miss tab/enum values fall back to defaults (exact match, symmetric)", () => {
    mem.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: EDITOR_LAYOUT_SCHEMA_VERSION,
        layout: {
          ...DEFAULT_EDITOR_LAYOUT,
          rightTab: "Library",
          bottomTab: " actions",
          topTab: "TIMELINE",
        },
      })
    );
    const r = loadEditorLayout();
    expect(r.rightTab).toBe("library");
    expect(r.bottomTab).toBe("actions");
    expect(r.topTab).toBe("timeline");
  });

  it("bottomTab null (dock collapsed) round-trips and is not coerced to a tab", () => {
    saveEditorLayout({ ...DEFAULT_EDITOR_LAYOUT, bottomTab: null });
    expect(loadEditorLayout().bottomTab).toBeNull();
  });
});

/** Build a minimal UiData-shaped object with all durable fields at defaults. */
function buildMinimalUiData() {
  return {
    rightPaneCollapsed: false,
    timelineCollapsed: false,
    rightTab: "library" as const,
    bottomTab: "actions" as const,
    snapToPixels: false,
    showRulers: false,
    viewMode: "normal" as const,
    toolState: DEFAULT_TOOL_STATE,
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
}
