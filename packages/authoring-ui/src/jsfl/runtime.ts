/**
 * JSFL (JavaScript Flash Language) runtime — Flash 8 automation API.
 *
 * Exposes `fl` and `doc` globals within a sandboxed script execution so that
 * Playwright e2e tests and agent scripts can programmatically drive the authoring tool.
 *
 * All Flash 8 JSFL references:
 *   fl  — top-level Flash application object
 *   doc — shorthand for fl.getDocumentDOM()
 */

import type {
  FlashDocument,
  Timeline as TimelineModel,
  LayerType,
  Library,
  SymbolType,
  LibraryItem,
  FlashFilter,
} from "@flash/core";
import {
  createRectShape,
  createOvalShape,
  createLineShape,
  breakApart as coreBreakApart,
  addDisplayObject,
  addLayer,
  deleteLayer,
  renameLayer,
  setLayerLocked,
  setLayerVisible,
  setLayerType,
  moveLayer as coreMoveLayer,
  duplicateLayer as coreDuplicateLayer,
  insertFrame,
  insertKeyframe as coreInsertKeyframe,
  insertBlankKeyframe as coreInsertBlankKeyframe,
  removeFrame,
  setFrameScript,
  setFrameLabel,
  setMotionTween,
  setShapeTween,
  clearTween,
  reverseFrames as coreReverseFrames,
  createSymbolInLibrary,
  removeLibraryItem,
  groupObjects,
  ungroupObjects,
  createDocument as coreCreateDocument,
  copyFramesDoc,
  pasteFramesDoc,
  cutFramesDoc,
  updateDisplayObject,
  setSymbolLinkage,
  addScene as coreAddScene,
  removeScene as coreRemoveScene,
  renameScene as coreRenameScene,
  duplicateScene as coreDuplicateScene,
  defaultDropShadow,
  defaultBlur,
  defaultGlow,
  defaultBevel,
} from "@flash/core";
import type {
  ShapeDisplayObject,
  TextDisplayObject,
  DisplayObject,
  SymbolInstance,
  FrameClipboard,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Document property mutation helpers
// (Inlined to avoid Vite SSR ambiguous export* issues from @flash/core barrel)
// ---------------------------------------------------------------------------

function _setDocumentWidth(doc: FlashDocument, width: number): FlashDocument {
  return { ...doc, properties: { ...doc.properties, width } };
}

function _setDocumentHeight(doc: FlashDocument, height: number): FlashDocument {
  return { ...doc, properties: { ...doc.properties, height } };
}

function _setFrameRate(doc: FlashDocument, frameRate: number): FlashDocument {
  return { ...doc, properties: { ...doc.properties, frameRate } };
}

function _setBackgroundColor(
  doc: FlashDocument,
  backgroundColor: string
): FlashDocument {
  return { ...doc, properties: { ...doc.properties, backgroundColor } };
}

function _renameLibraryItem(
  library: Library,
  id: string,
  name: string
): Library {
  if (!library.items.some((item) => item.id === id)) return library;
  return {
    ...library,
    items: library.items.map((item) =>
      item.id === id ? { ...item, name } : item
    ),
  };
}

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface JsflResult {
  traces: string[];
  returnValue: unknown;
  error?: string;
  /** Final mutated document after the script runs — push into history. */
  finalDocument?: FlashDocument;
}

// ---------------------------------------------------------------------------
// Internal mutable state
// ---------------------------------------------------------------------------

interface RuntimeState {
  doc: FlashDocument;
  traces: string[];
  sceneIndex: number;
  frameIndex: number;
  currentLayerIndex: number;
  selectedIds: string[];
  /** Clipboard for copyFrames / cutFrames / pasteFrames operations. */
  frameClipboard: FrameClipboard | null;
}

// ---------------------------------------------------------------------------
// ID counters — reset per-run to avoid cross-test pollution
// ---------------------------------------------------------------------------

function makeIdCounters() {
  let shapeCount = 0;
  let textCount = 0;
  let instCount = 0;
  return {
    nextShapeId() {
      return `jsfl-shape-${++shapeCount}-${Date.now().toString(36)}`;
    },
    nextTextId() {
      return `jsfl-text-${++textCount}-${Date.now().toString(36)}`;
    },
    nextInstId() {
      return `jsfl-inst-${++instCount}-${Date.now().toString(36)}`;
    },
  };
}

// ---------------------------------------------------------------------------
// JsflFrame facade
// ---------------------------------------------------------------------------

export interface JsflFrame {
  readonly index: number;
  readonly isKeyframe: boolean;
  /** AS2 script attached to this keyframe (get/set). */
  actionScript: string;
  /** Frame label (get/set). */
  labelName: string;
  /** Tween type: "none" | "motion" | "shape" (read). */
  readonly tweenType: string;
  /** Display objects on this frame (read). */
  readonly elements: DisplayObject[];
}

function makeFrameProxy(
  state: RuntimeState,
  layerIndex: number,
  frameIndex: number
): JsflFrame {
  function getLayer() {
    return state.doc.scenes[state.sceneIndex]?.timeline.layers[layerIndex];
  }

  function getKeyframe() {
    const layer = getLayer();
    if (!layer) return undefined;
    // Governing keyframe at or before frameIndex
    return [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= frameIndex)
      .sort((a, b) => b.index - a.index)[0];
  }

  function mutateTimeline(fn: (tl: TimelineModel) => TimelineModel) {
    const scene = state.doc.scenes[state.sceneIndex];
    if (!scene) return;
    const newTimeline = fn(scene.timeline);
    const newScenes = state.doc.scenes.map((s, i) =>
      i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
    );
    state.doc = { ...state.doc, scenes: newScenes };
  }

  return {
    get index() {
      return getKeyframe()?.index ?? frameIndex;
    },
    get isKeyframe() {
      return getKeyframe()?.index === frameIndex;
    },
    get actionScript() {
      return getKeyframe()?.script ?? "";
    },
    set actionScript(value: string) {
      const layer = getLayer();
      if (!layer) return;
      const kf = getKeyframe();
      if (!kf) return;
      mutateTimeline((tl) => setFrameScript(tl, layer.id, kf.index, value));
    },
    get labelName() {
      return getKeyframe()?.label ?? "";
    },
    set labelName(value: string) {
      const layer = getLayer();
      if (!layer) return;
      const kf = getKeyframe();
      if (!kf) return;
      mutateTimeline((tl) => setFrameLabel(tl, layer.id, kf.index, value));
    },
    get tweenType() {
      return getKeyframe()?.tweenType ?? "none";
    },
    get elements(): DisplayObject[] {
      const layer = getLayer();
      const kf = getKeyframe();
      if (!kf || !layer) return [];
      return kf.displayObjects.map((obj) =>
        makeElementProxy(state, layer.id, kf.index, obj)
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Writable element Proxy
// ---------------------------------------------------------------------------

/**
 * Property name mapping from JSFL names to DisplayObject model field names.
 * JSFL uses `name` for instance name and direct field names for others.
 */
const JSFL_PROP_MAP: Record<string, string> = {
  name: "instanceName",
};

/**
 * Create a writable Proxy around a DisplayObject so that JSFL property
 * assignments (e.g. `frame.elements[0].x = 100`) mutate the document model.
 *
 * Supported writable JSFL properties:
 *   x, y          — position
 *   width, height — bounding-box size (text objects; shape bounds updated directly)
 *   rotation      — rotation in degrees
 *   alpha         — opacity 0–1
 *   name          — instance name (maps to `instanceName` on SymbolInstance)
 *   visible       — visibility
 *
 * All other accesses fall through to the underlying object.
 *
 * The `get` trap re-reads from the live document so that reads after writes
 * reflect the mutated state rather than the initial snapshot.
 */
function makeElementProxy(
  state: RuntimeState,
  layerId: string,
  keyframeIndex: number,
  obj: DisplayObject
): DisplayObject {
  /** Return the current (live) version of this object from the document state. */
  function liveObj(): DisplayObject {
    const scene = state.doc.scenes[state.sceneIndex];
    if (!scene) return obj;
    const layer = scene.timeline.layers.find((l) => l.id === layerId);
    if (!layer) return obj;
    // Find the keyframe at the stored keyframe index
    const kf = layer.frames.find((f) => f.isKeyframe && f.index === keyframeIndex);
    if (!kf) return obj;
    return kf.displayObjects.find((o) => o.id === obj.id) ?? obj;
  }

  return new Proxy(obj, {
    get(_target, prop, receiver) {
      const current = liveObj();
      // For JSFL `name` property, return `instanceName` from SymbolInstance
      if (prop === "name") {
        const t = current as { instanceName?: string };
        return t.instanceName ?? "";
      }
      return Reflect.get(current, prop, receiver);
    },
    set(_target, prop, value) {
      if (typeof prop !== "string") return true;
      // Map JSFL property name to model field name
      const modelProp = JSFL_PROP_MAP[prop] ?? prop;
      // Build the update object
      const updates: Record<string, unknown> = { [modelProp]: value };
      // Apply mutation to the document via updateDisplayObject
      const scene = state.doc.scenes[state.sceneIndex];
      if (scene) {
        const newTimeline = updateDisplayObject(
          scene.timeline,
          layerId,
          keyframeIndex,
          obj.id,
          updates as Parameters<typeof updateDisplayObject>[4]
        );
        const newScenes = state.doc.scenes.map((s, i) =>
          i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
        );
        state.doc = { ...state.doc, scenes: newScenes };
      }
      return true;
    },
  });
}

// ---------------------------------------------------------------------------
// JsflLayer facade
// ---------------------------------------------------------------------------

export interface JsflLayer {
  /** Layer name (get/set). */
  name: string;
  /** Whether layer is visible (get/set). */
  visible: boolean;
  /** Whether layer is locked (get/set). */
  locked: boolean;
  /** Layer type: "normal" | "guide" | "guided" | "mask" | "masked" | "folder" (get/set). */
  layerType: string;
  /** Total frame count for this layer (read). */
  readonly frameCount: number;
  /** Indexed access to frame proxies. */
  readonly frames: JsflFrame[];
}

function makeLayerProxy(state: RuntimeState, layerIndex: number): JsflLayer {
  function getLayer() {
    return state.doc.scenes[state.sceneIndex]?.timeline.layers[layerIndex];
  }

  function mutateTimeline(fn: (tl: TimelineModel) => TimelineModel) {
    const scene = state.doc.scenes[state.sceneIndex];
    if (!scene) return;
    const newTimeline = fn(scene.timeline);
    const newScenes = state.doc.scenes.map((s, i) =>
      i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
    );
    state.doc = { ...state.doc, scenes: newScenes };
  }

  return {
    get name() {
      return getLayer()?.name ?? "";
    },
    set name(value: string) {
      const layer = getLayer();
      if (!layer) return;
      mutateTimeline((tl) => renameLayer(tl, layer.id, value));
    },
    get visible() {
      return getLayer()?.visible ?? true;
    },
    set visible(value: boolean) {
      const layer = getLayer();
      if (!layer) return;
      mutateTimeline((tl) => setLayerVisible(tl, layer.id, value));
    },
    get locked() {
      return getLayer()?.locked ?? false;
    },
    set locked(value: boolean) {
      const layer = getLayer();
      if (!layer) return;
      mutateTimeline((tl) => setLayerLocked(tl, layer.id, value));
    },
    get layerType() {
      return getLayer()?.type ?? "normal";
    },
    set layerType(value: string) {
      const layer = getLayer();
      if (!layer) return;
      mutateTimeline((tl) =>
        setLayerType(tl, layer.id, value as LayerType)
      );
    },
    get frameCount() {
      return getLayer()?.frameCount ?? 1;
    },
    get frames(): JsflFrame[] {
      const layer = getLayer();
      if (!layer) return [];
      // Expose one proxy per frame slot
      return Array.from({ length: layer.frameCount }, (_, i) =>
        makeFrameProxy(state, layerIndex, i)
      );
    },
  };
}

// ---------------------------------------------------------------------------
// JsflTimeline facade
// ---------------------------------------------------------------------------

export interface JsflTimeline {
  /** Current layer index (get/set). */
  currentLayer: number;
  readonly currentFrame: number;
  readonly frameCount: number;
  readonly layerCount: number;
  readonly layers: JsflLayer[];
  /** Whether the grid is visible (get/set). Backed by doc.properties.grid.showGrid. */
  showGrid: boolean;
  /** Whether guides are visible (get/set). Backed by doc.properties.snapToGuides. */
  showGuides: boolean;
  addNewLayer(name: string, type?: string, addAbove?: boolean): void;
  deleteLayer(layerIndex: number): void;
  setSelectedLayers(layerIndex: number): void;
  insertFrames(numFrames: number, startFrameIndex?: number): void;
  removeFrames(numFrames: number, startFrameIndex?: number): void;
  insertKeyframe(frameIndex?: number): void;
  insertBlankKeyframe(frameIndex?: number): void;
  convertToKeyframes(frameIndex?: number): void;
  convertToBlankKeyframes(frameIndex?: number): void;
  createMotionTween(startFrameIndex?: number): void;
  setFrameProperty(property: string, value: unknown, frameIndex?: number): void;
  /** Clear frame content (scripts, labels, sounds, display objects) in [startFrame, endFrame]. */
  clearFrames(startFrame: number, endFrame?: number): void;
  /** Reverse the order of frames (including their content) in [startFrame, endFrame]. */
  reverseFrames(startFrame: number, endFrame?: number): void;
  /** Copy frames [startFrame, endFrame] to the internal clipboard. */
  copyFrames(startFrame: number, endFrame?: number): void;
  /** Cut frames [startFrame, endFrame] to the internal clipboard, replacing with blank keyframes. */
  cutFrames(startFrame: number, endFrame?: number): void;
  /** Paste the clipboard contents at startFrame, overwriting existing frames. */
  pasteFrames(startFrame: number): void;
  /**
   * Add a motion guide layer directly above the current layer.
   * The current layer is set to type "guided" to follow the new guide layer.
   */
  addMotionGuide(): void;
  /**
   * Move a layer from fromIndex to toIndex.
   * numLayers is accepted for API compatibility but only 1 layer is moved.
   */
  moveLayer(fromIndex: number, toIndex: number, numLayers?: number): void;
  /**
   * Duplicate the layer at layerIndex (defaults to currentLayer).
   * The copy is inserted immediately after the source layer.
   */
  duplicateLayer(layerIndex?: number): void;
  /**
   * Set the active (current) layer to layerIndex.
   * Equivalent to assigning `currentLayer`.
   */
  setActiveLayer(layerIndex: number): void;
  /**
   * Return the JsflFrame proxy for the given layer and frame index.
   */
  getFrame(layerIndex: number, frameIndex: number): JsflFrame;
  /**
   * Returns the currently selected frame indices as an array.
   * Stub: returns a single-element array with the current frame index.
   */
  getSelectedFrames(): number[];
  /**
   * Set the selected frames in the timeline.
   * Stub: not fully supported; logs a warning and is a no-op.
   */
  setSelectedFrames(startFrame: number, endFrame: number, replaceCurrentSelection?: boolean): void;
  /** The name of the scene this timeline belongs to. */
  readonly name: string;
}

function makeTimelineProxy(state: RuntimeState): JsflTimeline {
  function getScene() {
    return state.doc.scenes[state.sceneIndex];
  }

  function mutateTimeline(fn: (tl: TimelineModel) => TimelineModel) {
    const scene = getScene();
    if (!scene) return;
    const newTimeline = fn(scene.timeline);
    const newScenes = state.doc.scenes.map((s, i) =>
      i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
    );
    state.doc = { ...state.doc, scenes: newScenes };
  }

  function getActiveLayerId(): string | null {
    const scene = getScene();
    if (!scene) return null;
    const layer = scene.timeline.layers[state.currentLayerIndex];
    return layer?.id ?? null;
  }

  return {
    get currentLayer() {
      return state.currentLayerIndex;
    },
    set currentLayer(idx: number) {
      state.currentLayerIndex = idx;
    },
    get currentFrame() {
      return state.frameIndex;
    },
    get frameCount() {
      const scene = getScene();
      if (!scene) return 1;
      const layers = scene.timeline.layers;
      if (layers.length === 0) return 1;
      let max = 1;
      for (const layer of layers) {
        if (layer.frameCount > max) max = layer.frameCount;
      }
      return max;
    },
    get layerCount() {
      const scene = getScene();
      if (!scene) return 0;
      return scene.timeline.layers.length;
    },
    get layers(): JsflLayer[] {
      const scene = getScene();
      if (!scene) return [];
      return scene.timeline.layers.map((_, i) => makeLayerProxy(state, i));
    },
    get showGrid() {
      return state.doc.properties.grid?.showGrid ?? false;
    },
    set showGrid(v: boolean) {
      state.doc = {
        ...state.doc,
        properties: {
          ...state.doc.properties,
          grid: { ...state.doc.properties.grid, showGrid: v },
        },
      };
    },
    get showGuides() {
      return state.doc.properties.snapToGuides ?? false;
    },
    set showGuides(v: boolean) {
      state.doc = {
        ...state.doc,
        properties: { ...state.doc.properties, snapToGuides: v },
      };
    },
    addNewLayer(name: string, type?: string, addAbove?: boolean) {
      const scene = getScene();
      if (!scene) return;

      // addLayer always prepends the new layer at index 0 (topmost).
      let newTimeline: TimelineModel = addLayer(scene.timeline, name);

      // Determine where the new layer should end up relative to the selected layer.
      // Flash convention: addAbove defaults to true (insert above selected layer).
      const shouldAddAbove = addAbove !== false;
      const ci = state.currentLayerIndex;
      // After prepending, the previously selected layer has shifted to ci+1.
      // Target index: ci (above) or ci+1 (below).
      const targetIndex = shouldAddAbove ? ci : ci + 1;
      if (targetIndex > 0) {
        // New layer is currently at index 0; move it to targetIndex.
        const newLayerId = newTimeline.layers[0]!.id;
        newTimeline = coreMoveLayer(newTimeline, newLayerId, targetIndex);
      }

      // Apply the requested layer type (default is "normal", which needs no change).
      if (type && type !== "normal") {
        const layerId = newTimeline.layers.find((l) => l.name === name)?.id;
        if (layerId) {
          newTimeline = setLayerType(newTimeline, layerId, type as LayerType);
        }
      }

      const newScenes = state.doc.scenes.map((s, i) =>
        i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
      );
      state.doc = { ...state.doc, scenes: newScenes };
    },
    deleteLayer(layerIndex: number) {
      const scene = getScene();
      if (!scene) return;
      const layer = scene.timeline.layers[layerIndex];
      if (!layer) return;
      mutateTimeline((tl) => deleteLayer(tl, layer.id));
    },
    setSelectedLayers(layerIndex: number) {
      state.currentLayerIndex = layerIndex;
    },
    insertFrames(numFrames: number, startFrameIndex?: number) {
      const layerId = getActiveLayerId();
      if (!layerId) return;
      const fi = startFrameIndex ?? state.frameIndex;
      for (let i = 0; i < numFrames; i++) {
        mutateTimeline((tl) => insertFrame(tl, layerId, fi));
      }
    },
    removeFrames(numFrames: number, startFrameIndex?: number) {
      const layerId = getActiveLayerId();
      if (!layerId) return;
      const fi = startFrameIndex ?? state.frameIndex;
      for (let i = 0; i < numFrames; i++) {
        mutateTimeline((tl) => removeFrame(tl, layerId, fi));
      }
    },
    insertKeyframe(frameIndex?: number) {
      const layerId = getActiveLayerId();
      if (!layerId) return;
      const fi = frameIndex ?? state.frameIndex;
      mutateTimeline((tl) => coreInsertKeyframe(tl, layerId, fi));
    },
    insertBlankKeyframe(frameIndex?: number) {
      const layerId = getActiveLayerId();
      if (!layerId) return;
      const fi = frameIndex ?? state.frameIndex;
      mutateTimeline((tl) => coreInsertBlankKeyframe(tl, layerId, fi));
    },
    convertToKeyframes(frameIndex?: number) {
      const layerId = getActiveLayerId();
      if (!layerId) return;
      const fi = frameIndex ?? state.frameIndex;
      mutateTimeline((tl) => coreInsertKeyframe(tl, layerId, fi));
    },
    convertToBlankKeyframes(frameIndex?: number) {
      const layerId = getActiveLayerId();
      if (!layerId) return;
      const fi = frameIndex ?? state.frameIndex;
      mutateTimeline((tl) => coreInsertBlankKeyframe(tl, layerId, fi));
    },
    createMotionTween(startFrameIndex?: number) {
      const layerId = getActiveLayerId();
      if (!layerId) return;
      const fi = startFrameIndex ?? state.frameIndex;
      mutateTimeline((tl) => setMotionTween(tl, layerId, fi));
    },
    setFrameProperty(
      property: string,
      value: unknown,
      frameIndex?: number
    ) {
      const layerId = getActiveLayerId();
      if (!layerId) return;
      const fi = frameIndex ?? state.frameIndex;
      if (property === "tweenType") {
        if (value === "motion") {
          mutateTimeline((tl) => setMotionTween(tl, layerId, fi));
        } else if (value === "shape") {
          mutateTimeline((tl) => setShapeTween(tl, layerId, fi));
        } else {
          mutateTimeline((tl) => clearTween(tl, layerId, fi));
        }
      } else if (property === "label" || property === "labelName") {
        mutateTimeline((tl) =>
          setFrameLabel(tl, layerId, fi, String(value))
        );
      } else if (property === "labelType") {
        const lt = String(value);
        if (lt === "name" || lt === "comment" || lt === "anchor") {
          mutateTimeline((tl) => {
            const layer = tl.layers.find((l) => l.id === layerId);
            const frame = layer?.frames.find((f) => f.index === fi);
            return setFrameLabel(tl, layerId, fi, frame?.label ?? "", lt);
          });
        }
      } else if (property === "actionScript" || property === "script") {
        mutateTimeline((tl) =>
          setFrameScript(tl, layerId, fi, String(value))
        );
      } else if (property === "soundName") {
        const soundItem = state.doc.library.items.find(
          (i) => i.name === String(value) && i.itemType === "sound"
        );
        if (!soundItem) {
          console.warn("[JSFL] setFrameProperty soundName: sound not found:", value);
          return;
        }
        mutateTimeline((tl) => ({
          ...tl,
          layers: tl.layers.map((l) => {
            if (l.id !== layerId) return l;
            return {
              ...l,
              frames: l.frames.map((f) => {
                if (!f.isKeyframe || f.index !== fi) return f;
                const existing = f.sound;
                return {
                  ...f,
                  sound: {
                    libraryItemId: soundItem.id,
                    syncMode: existing?.syncMode ?? "event",
                    repeatCount: existing?.repeatCount ?? 1,
                    effect: existing?.effect,
                  },
                };
              }),
            };
          }),
        }));
      } else if (property === "soundSync") {
        const syncMode = String(value) as "event" | "start" | "stop" | "stream";
        mutateTimeline((tl) => ({
          ...tl,
          layers: tl.layers.map((l) => {
            if (l.id !== layerId) return l;
            return {
              ...l,
              frames: l.frames.map((f) => {
                if (!f.isKeyframe || f.index !== fi) return f;
                if (!f.sound) return f;
                return {
                  ...f,
                  sound: { ...f.sound, syncMode },
                };
              }),
            };
          }),
        }));
      } else if (property === "soundEffect") {
        mutateTimeline((tl) => ({
          ...tl,
          layers: tl.layers.map((l) => {
            if (l.id !== layerId) return l;
            return {
              ...l,
              frames: l.frames.map((f) => {
                if (!f.isKeyframe || f.index !== fi) return f;
                if (!f.sound) return f;
                return {
                  ...f,
                  sound: {
                    ...f.sound,
                    effect: String(value) as import("@flash/core").SoundEffect,
                  },
                };
              }),
            };
          }),
        }));
      }
    },
    clearFrames(startFrame: number, endFrame?: number) {
      const layerId = getActiveLayerId();
      if (!layerId) return;
      const end = endFrame ?? startFrame;
      // Replace every keyframe in the range with a blank keyframe (preserve index).
      // Non-keyframe span slots are cleared implicitly since their governing keyframe
      // is replaced. We do not insert new keyframes at non-keyframe positions —
      // that would grow the frame count unexpectedly.
      mutateTimeline((tl) => ({
        ...tl,
        layers: tl.layers.map((l) => {
          if (l.id !== layerId) return l;
          const newFrames = l.frames.map((f) => {
            if (!f.isKeyframe) return f;
            if (f.index < startFrame || f.index > end) return f;
            return {
              ...f,
              isEmpty: true,
              label: "",
              script: "",
              sound: null,
              displayObjects: [],
              tweenType: "none" as const,
            };
          });
          return { ...l, frames: newFrames };
        }),
      }));
    },
    reverseFrames(startFrame: number, endFrame?: number) {
      const layerId = getActiveLayerId();
      if (!layerId) return;
      const end = endFrame ?? startFrame;
      mutateTimeline((tl) => coreReverseFrames(tl, layerId, startFrame, end));
    },
    copyFrames(startFrame: number, endFrame?: number) {
      const end = endFrame ?? startFrame;
      state.frameClipboard = copyFramesDoc(
        state.doc,
        state.sceneIndex,
        [],
        startFrame,
        end
      );
    },
    cutFrames(startFrame: number, endFrame?: number) {
      const end = endFrame ?? startFrame;
      const { newDoc, clipboard } = cutFramesDoc(
        state.doc,
        state.sceneIndex,
        [],
        startFrame,
        end
      );
      state.doc = newDoc;
      state.frameClipboard = clipboard;
    },
    pasteFrames(startFrame: number) {
      if (!state.frameClipboard) return;
      state.doc = pasteFramesDoc(
        state.doc,
        state.sceneIndex,
        [],
        startFrame,
        state.frameClipboard
      );
    },
    addMotionGuide() {
      const scene = getScene();
      if (!scene) return;
      const currentLayer = scene.timeline.layers[state.currentLayerIndex];
      if (!currentLayer) return;
      const guideName = `Guide: ${currentLayer.name}`;
      // Insert a guide layer at the current layer index (above it in Flash
      // convention). The current layer becomes "guided".
      mutateTimeline((tl) => {
        const guideLayer = {
          id: `layer-guide-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: guideName,
          type: "guide" as const,
          visible: true,
          locked: false,
          outlineMode: false,
          outlineColor: "#0000ff",
          height: 20,
          parentFolderId: null as string | null,
          frames: [
            {
              index: 0,
              isKeyframe: true,
              isEmpty: true,
              tweenType: "none" as const,
              label: "",
              labelType: "name" as const,
              script: "",
              sound: null,
              motionEase: 0,
              motionEaseType: "none" as const,
              motionEaseCurve: null,
              motionRotate: "none" as const,
              motionRotateCount: 0,
              motionOrientToPath: false,
              motionSnap: false,
              motionSync: false,
              motionScale: false,
              shapeEase: 0,
              shapeEaseType: "none" as const,
              shapeBlend: "distributive" as const,
              displayObjects: [],
            },
          ],
          frameCount: 1,
        };
        // Set the current layer to "guided"
        const updatedLayers = tl.layers.map((l, i) =>
          i === state.currentLayerIndex ? { ...l, type: "guided" as const } : l
        );
        // Insert guide above the current layer (same index in the array,
        // shifting the current layer down by one)
        const newLayers = [
          ...updatedLayers.slice(0, state.currentLayerIndex),
          guideLayer,
          ...updatedLayers.slice(state.currentLayerIndex),
        ];
        return { ...tl, layers: newLayers };
      });
      // After insertion, currentLayerIndex now points at the guide layer.
      // Shift by 1 so the user's context stays on the guided layer.
      state.currentLayerIndex += 1;
    },
    moveLayer(fromIndex: number, toIndex: number, _numLayers?: number) {
      const scene = getScene();
      if (!scene) return;
      const layer = scene.timeline.layers[fromIndex];
      if (!layer) return;
      mutateTimeline((tl) => coreMoveLayer(tl, layer.id, toIndex));
    },
    duplicateLayer(layerIndex?: number) {
      const scene = getScene();
      if (!scene) return;
      const idx = layerIndex ?? state.currentLayerIndex;
      const layer = scene.timeline.layers[idx];
      if (!layer) return;
      mutateTimeline((tl) => coreDuplicateLayer(tl, layer.id));
    },
    setActiveLayer(layerIndex: number) {
      state.currentLayerIndex = layerIndex;
    },
    getFrame(layerIndex: number, frameIndex: number): JsflFrame {
      return makeFrameProxy(state, layerIndex, frameIndex);
    },
    getSelectedFrames(): number[] {
      return [state.frameIndex];
    },
    setSelectedFrames(_startFrame: number, _endFrame: number, _replaceCurrentSelection?: boolean): void {
      console.warn('timeline.setSelectedFrames: not fully supported');
    },
    get name(): string {
      return state.doc.scenes[state.sceneIndex]?.name ?? 'Scene 1';
    },
  };
}

// ---------------------------------------------------------------------------
// JsflLibrary facade
// ---------------------------------------------------------------------------

export interface JsflLibraryItem {
  readonly name: string;
  readonly itemType: string;
  readonly symbolType?: string;
}

export interface JsflLibrary {
  /** All library items (read). */
  readonly items: JsflLibraryItem[];
  /** Add a new symbol to the library. type: "movie clip" | "button" | "graphic". */
  addNewItem(type: string, name: string): void;
  /** Delete a library item by name. */
  deleteItem(name: string): void;
  /** Rename a library item. */
  renameItem(oldName: string, newName: string): boolean;
  /** Select an item by name (Flash 8 compat — no-op in this runtime). */
  selectItem(name: string, bReplaceCurrentSelection?: boolean): boolean;
  /**
   * Place a library item on the stage at (x, y) on the current frame/layer.
   * Only symbol items are supported; other item types are silently ignored.
   */
  addItemToDocument(itemName: string, x: number, y: number): void;
  /**
   * Get a property of a library item by name.
   * Supported props: 'name', 'symbolType', 'linkageIdentifier',
   * 'exportForActionScript', 'exportInFirstFrame', 'className'.
   */
  getItemProperty(name: string, prop: string): unknown;
  /**
   * Set a property of a library item by name.
   * Supported props: 'linkageIdentifier', 'exportForActionScript', 'exportInFirstFrame'.
   */
  setItemProperty(name: string, prop: string, value: unknown): void;
  /**
   * Returns true if a library item with the given name exists.
   */
  itemExists(name: string): boolean;
}

function jsflSymbolType(jsflType: string): SymbolType {
  const t = jsflType.toLowerCase().replace(/\s+/g, "");
  if (t === "movieclip" || t === "movie clip") return "movieclip";
  if (t === "button") return "button";
  return "graphic";
}

function makeLibraryProxy(state: RuntimeState, ids: ReturnType<typeof makeIdCounters>): JsflLibrary {
  return {
    get items(): JsflLibraryItem[] {
      return state.doc.library.items.map((item) => {
        const base: JsflLibraryItem = { name: item.name, itemType: item.itemType };
        if (item.itemType === "symbol") {
          const symTypeMap: Record<string, string> = {
            movieclip: "movie clip",
            button: "button",
            graphic: "graphic",
          };
          return {
            ...base,
            symbolType: symTypeMap[(item as { symbolType: string }).symbolType] ?? item.itemType,
          };
        }
        return base;
      });
    },
    addNewItem(type: string, name: string) {
      const symType = jsflSymbolType(type);
      const { library: updatedLib } = createSymbolInLibrary(
        state.doc.library,
        name,
        symType
      );
      state.doc = { ...state.doc, library: updatedLib };
    },
    deleteItem(name: string) {
      const item = state.doc.library.items.find((i) => i.name === name);
      if (!item) return;
      state.doc = {
        ...state.doc,
        library: removeLibraryItem(state.doc.library, item.id),
      };
    },
    renameItem(oldName: string, newName: string): boolean {
      const item = state.doc.library.items.find((i) => i.name === oldName);
      if (!item) return false;
      state.doc = {
        ...state.doc,
        library: _renameLibraryItem(state.doc.library, item.id, newName),
      };
      return true;
    },
    selectItem(_name: string, _bReplaceCurrentSelection?: boolean): boolean {
      // No-op in non-UI context; return true for compat
      return true;
    },
    addItemToDocument(itemName: string, x: number, y: number) {
      const item = state.doc.library.items.find((i) => i.name === itemName);
      if (!item) {
        console.warn("[JSFL] addItemToDocument: item not found:", itemName);
        return;
      }
      if (item.itemType !== "symbol") {
        console.warn("[JSFL] addItemToDocument: only symbol items can be placed on stage; got:", item.itemType);
        return;
      }
      const layerId = getActiveLayerId(state);
      if (!layerId) return;
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const instance: SymbolInstance = {
        type: "instance",
        id: ids.nextInstId(),
        symbolId: item.id,
        x,
        y,
      };
      const newTimeline = addDisplayObject(scene.timeline, layerId, state.frameIndex, instance);
      const newScenes = state.doc.scenes.map((s, i) =>
        i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
      );
      state.doc = { ...state.doc, scenes: newScenes };
    },
    getItemProperty(name: string, prop: string): unknown {
      const item = state.doc.library.items.find((i) => i.name === name);
      if (!item) {
        console.warn("[JSFL] library.getItemProperty: item not found:", name);
        return undefined;
      }
      switch (prop) {
        case "name":
          return item.name;
        case "symbolType": {
          if (item.itemType !== "symbol") return undefined;
          const symTypeMap: Record<string, string> = {
            movieclip: "movie clip",
            button: "button",
            graphic: "graphic",
          };
          return symTypeMap[(item as { symbolType: string }).symbolType] ?? undefined;
        }
        case "linkageIdentifier": {
          if (item.itemType !== "symbol") return undefined;
          return (item as { linkage?: { linkageIdentifier?: string } }).linkage?.linkageIdentifier ?? undefined;
        }
        case "exportForActionScript": {
          if (item.itemType !== "symbol") return undefined;
          return (item as { linkage?: { exportForActionScript?: boolean } }).linkage?.exportForActionScript ?? undefined;
        }
        case "exportInFirstFrame": {
          if (item.itemType !== "symbol") return undefined;
          return (item as { linkage?: { exportInFirstFrame?: boolean } }).linkage?.exportInFirstFrame ?? undefined;
        }
        case "className":
          // className is not modifiable through this runtime; return undefined
          return undefined;
        default:
          return undefined;
      }
    },
    setItemProperty(name: string, prop: string, value: unknown): void {
      const item = state.doc.library.items.find((i) => i.name === name);
      if (!item) {
        console.warn("[JSFL] library.setItemProperty: item not found:", name);
        return;
      }
      switch (prop) {
        case "linkageIdentifier":
          state.doc = {
            ...state.doc,
            library: setSymbolLinkage(state.doc.library, item.id, {
              linkageId: String(value),
            }),
          };
          break;
        case "exportForActionScript":
          state.doc = {
            ...state.doc,
            library: setSymbolLinkage(state.doc.library, item.id, {
              exportForActionScript: Boolean(value),
            }),
          };
          break;
        case "exportInFirstFrame":
          state.doc = {
            ...state.doc,
            library: setSymbolLinkage(state.doc.library, item.id, {
              exportInFirstFrame: Boolean(value),
            }),
          };
          break;
        default:
          console.warn("[JSFL] library.setItemProperty: unsupported property:", prop);
          break;
      }
    },
    itemExists(name: string): boolean {
      return state.doc.library.items.some((i) => i.name === name);
    },
  };
}

// ---------------------------------------------------------------------------
// JsflDocument facade
// ---------------------------------------------------------------------------

export interface JsflDocument {
  /** Document width in pixels (get/set). */
  width: number;
  /** Document height in pixels (get/set). */
  height: number;
  /** Frame rate in fps (get/set). */
  frameRate: number;
  /** Background color as CSS hex string (get/set). */
  backgroundColor: string;
  selection: DisplayObject[];
  readonly timeline: JsflTimeline;
  /** Shortcut for `doc.timeline.layers` — the layers of the current timeline. */
  readonly layers: JsflLayer[];
  /** All scene timelines in this document (one per scene, read-only). */
  readonly timelines: readonly JsflTimeline[];
  /**
   * Index of the currently-active timeline.
   * 0 = main timeline; 1+ = symbol edit. Always 0 in this runtime.
   */
  readonly currentTimeline: number;
  getTimeline(): JsflTimeline;
  get library(): JsflLibrary;
  addNewRectangle(bounds: { left: number; top: number; right: number; bottom: number }, cornerRadius: number): void;
  addNewOval(bounds: { left: number; top: number; right: number; bottom: number }): void;
  addNewText(bounds: { left: number; top: number; right: number; bottom: number }, text: string): void;
  selectAll(): void;
  /** Set the selection to a specific array of display objects. */
  setSelectionRect(rect: { left: number; top: number; right: number; bottom: number }): void;
  /** Delete currently selected display objects. */
  deleteSelection(): void;
  /**
   * Convert selected display objects to a library symbol.
   * type: "movie clip" | "button" | "graphic"
   * registration: "topLeft" | "center" | etc. (ignored — always uses center)
   */
  convertToSymbol(type: string, name: string, registration?: string): void;
  /** Group currently selected display objects into a GroupObject. */
  group(): void;
  /** Ungroup the selected GroupObject, restoring its children to the stage. */
  ungroup(): void;
  /**
   * Place a library item on the stage at pos.  Delegates to library.addItemToDocument.
   * item.name is the library item name to place.
   */
  addItem(pos: { x: number; y: number }, item: { name?: string }): void;
  /**
   * Whether to scale the content when the document dimensions change.
   * Stub: getter always returns false; setter is a no-op.
   */
  scaleContent: boolean;
  /** Compile and return the SWF as a Uint8Array (browser-safe, no file I/O). */
  publish(): Uint8Array;
  /**
   * Compile the document and trigger a browser download of the SWF to the
   * given fileURL path.  In the browser environment the path is used only as
   * the suggested filename for the download; actual file-system writes are not
   * possible.  Returns void so JSFL scripts can call it without handling a
   * return value.
   */
  exportSWF(fileURL: string): void;
  /**
   * Import a file into the document.  Not supported in browser context; stub.
   */
  importFile(fileURL: string, importToLibrary?: boolean): void;
  /**
   * Retrieve persistent data stored on the document by name.
   * Not supported in this runtime; always returns undefined.
   */
  getDataFromDocument(name: string): any;
  /**
   * Store persistent data on the document.
   * Not supported in this runtime; no-op stub.
   */
  addDataToDocument(name: string, type: string, data: any): void;
  /**
   * Enter symbol-editing mode.  Not supported in this runtime; no-op stub.
   */
  enterEditMode(editMode?: string): void;
  /**
   * Exit symbol-editing mode.  Not supported in this runtime; no-op stub.
   */
  exitEditMode(): void;
  /**
   * Set the transformation point for the current selection.  Not supported; no-op stub.
   */
  setTransformationPoint(point: { x: number; y: number }): void;
  /**
   * Align selected objects.  Not implemented; no-op stub.
   */
  align(alignMode: string, bUseDocumentBounds?: boolean): void;
  /**
   * Space selected objects evenly.  Not implemented; no-op stub.
   */
  space(direction: string): void;
  /**
   * Match the width and/or height of selected objects.  Not implemented; no-op stub.
   */
  match(bWidth: boolean, bHeight: boolean): void;
  /**
   * Apply a 2×2 transform matrix to the current selection.  Not implemented; no-op stub.
   */
  transformSelection(a: number, b: number, c: number, d: number): void;
  /**
   * Move all selected display objects by (delta.x, delta.y) pixels.
   * Mutates x/y on each selected object in the current frame.
   */
  moveSelectionBy(delta: { x: number; y: number }): void;
  /**
   * Scale all selected display objects.
   * Multiplies scaleX by xScale and scaleY by yScale for each selected object.
   * whichCorner is accepted for API compatibility but ignored.
   */
  scaleSelection(xScale: number, yScale: number, whichCorner?: string): void;
  /** Clear the current selection (sets selectedIds to []). */
  selectNone(): void;
  /**
   * Save the document.  Delegates to exportSWF for SWF output.
   * fileURL is optional; omitting it uses the default export path.
   */
  save(fileURL?: string): boolean;
  /** Undo the last action.  History is managed at the UI layer; this is a no-op stub. */
  undo(): void;
  /** Redo the last undone action.  History is managed at the UI layer; this is a no-op stub. */
  redo(): void;
  /** Revert the document to its last saved state.  Not supported; no-op stub. */
  revert(): void;
  /**
   * Duplicate selected display objects, placing copies offset by (+10, +10).
   * Updates the selection to point to the new copies.
   */
  duplicateSelection(): void;
  /** Add a new scene with the given name. */
  addNewScene(name: string): void;
  /** Delete the current scene. */
  deleteScene(): void;
  /** Rename the current scene. */
  renameScene(name: string): void;
  /** Duplicate the current scene, inserting the copy after it. */
  duplicateScene(): void;
  /**
   * Arrange selected objects in z-order.
   * type: 'front' | 'back' | 'forward' | 'backward'
   */
  arrange(type: string): void;
  /**
   * Get a property from the first selected element.
   * Returns undefined if there is no selection.
   */
  getElementProperty(propertyName: string): any;
  /**
   * Set a property on ALL selected elements.
   */
  setElementProperty(propertyName: string, value: any): void;
  /**
   * Get the text string from the first selected text object.
   * Returns '' if the selection contains no text object.
   */
  getTextString(): string;
  /**
   * Set the text string on all selected text objects.
   */
  setTextString(text: string): void;
  /**
   * Swap the symbol of the first selected SymbolInstance to the library item
   * with the given name.  If no SymbolInstance is selected, or the named item
   * is not found, this is a no-op (warns to the console).
   */
  swap(libraryItemName: string): void;
  /**
   * Set a brightness color effect on all selected display objects.
   * brightness: -100 to 100.
   */
  setInstanceBrightness(brightness: number): void;
  /**
   * Set a tint color effect on all selected display objects.
   * r, g, b: 0–255 each; strength: 0–100.
   */
  setInstanceTint(r: number, g: number, b: number, strength: number): void;
  /**
   * Set a text attribute on all selected text display objects.
   * Common attributes: fontFamily, fontSize, bold, italic, underline, color,
   * align, leading, letterSpacing, wordWrap, multiline.
   */
  setElementTextAttr(attrName: string, value: any): void;
  /**
   * Alias for setElementTextAttr — Flash JSFL exposes both at document level.
   */
  setTextAttr(attrName: string, value: any): void;
  /**
   * Returns the filters array of the first selected display object.
   * Returns [] if nothing is selected or the object has no filters.
   */
  getFilters(): FlashFilter[];
  /**
   * Add a filter to all selected display objects.
   * filter.name (case-insensitive) determines the filter type:
   *   'dropshadow' | 'blur' | 'glow' | 'bevel'
   * Extra keys in filter are merged as overrides onto the defaults.
   * Warns and returns if the name is unrecognised.
   */
  addFilter(filter: { name: string; [key: string]: any }): void;
  /**
   * Remove the filter at filterIndex from all selected display objects.
   */
  removeFilter(filterIndex: number): void;
  /**
   * Enable the filter at filterIndex on all selected display objects.
   */
  enableFilter(filterIndex: number): void;
  /**
   * Disable the filter at filterIndex on all selected display objects.
   */
  disableFilter(filterIndex: number): void;
  /**
   * Draw a line from startPoint to endPoint on the current layer/frame.
   */
  addNewLine(startPoint: { x: number; y: number }, endPoint: { x: number; y: number }): void;
  /**
   * Break apart the first selected object into its constituent display objects.
   */
  breakApart(): void;
  /** Flatten selected objects. Not supported; stub. */
  flatten(): void;
  /** Smooth selected shape curves. Not supported; stub. */
  smooth(): void;
  /** Straighten selected shape segments. Not supported; stub. */
  straighten(): void;
  /** Crop operation on selected objects. Not supported; stub. */
  crop(): void;
  /** Intersect operation on selected objects. Not supported; stub. */
  intersect(): void;
  /** Punch operation on selected objects. Not supported; stub. */
  punch(): void;
  /** Union operation on selected objects. Not supported; stub. */
  union(): void;
  /** Copy selection to system clipboard. Not supported; use fl.clipCopyFrames. */
  clipCopy(): void;
  /** Cut selection to system clipboard. Not supported; stub. */
  clipCut(): void;
  /** Paste from system clipboard. Not supported; stub. */
  clipPaste(bInPlace?: boolean): void;
  /** Paste in place (same as clipPaste). Not supported; stub. */
  paste(bInPlace?: boolean): void;
  /** The name of the current publish profile. Always 'Default'. */
  readonly currentPublishProfile: string;
  /** The list of publish profile names. Always ['Default']. */
  readonly publishProfiles: string[];
  /**
   * Return the topmost display object whose bounding box contains the point (x, y),
   * searching layers from index 0 (front/top) to n-1 (back).
   * Returns the element proxy for the first match, or null if nothing found.
   */
  getInstanceAtPoint(x: number, y: number): any;
  /**
   * Return the display object at [layerIndex][elementIndex] in the governing keyframe
   * at or before frameIndex.
   * Returns the element proxy, or null if out of bounds.
   */
  getElementByIndex(layerIndex: number, frameIndex: number, elementIndex: number): any;
}

function getActiveLayerId(state: RuntimeState): string | null {
  const scene = state.doc.scenes[state.sceneIndex];
  if (!scene) return null;
  const layer = scene.timeline.layers[state.currentLayerIndex];
  return layer?.id ?? null;
}

function makeDocumentProxy(
  state: RuntimeState,
  ids: ReturnType<typeof makeIdCounters>
): JsflDocument {
  function mutateTimeline(fn: (tl: TimelineModel) => TimelineModel) {
    const scene = state.doc.scenes[state.sceneIndex];
    if (!scene) return;
    const newTimeline = fn(scene.timeline);
    const newScenes = state.doc.scenes.map((s, i) =>
      i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
    );
    state.doc = { ...state.doc, scenes: newScenes };
  }

  return {
    get width() {
      return state.doc.properties.width;
    },
    set width(value: number) {
      state.doc = _setDocumentWidth(state.doc, value);
    },
    get height() {
      return state.doc.properties.height;
    },
    set height(value: number) {
      state.doc = _setDocumentHeight(state.doc, value);
    },
    get frameRate() {
      return state.doc.properties.frameRate;
    },
    set frameRate(value: number) {
      state.doc = _setFrameRate(state.doc, value);
    },
    get backgroundColor() {
      return state.doc.properties.backgroundColor;
    },
    set backgroundColor(value: string) {
      state.doc = _setBackgroundColor(state.doc, value);
    },
    get selection(): DisplayObject[] {
      if (state.selectedIds.length === 0) return [];
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return [];
      const result: DisplayObject[] = [];
      for (const layer of scene.timeline.layers) {
        const kfs = layer.frames
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index);
        const kf = kfs[0];
        if (kf) {
          for (const obj of kf.displayObjects) {
            if (state.selectedIds.includes(obj.id)) {
              result.push(obj);
            }
          }
        }
      }
      return result;
    },
    set selection(value: DisplayObject[]) {
      if (!value || value.length === 0) {
        state.selectedIds = [];
      } else {
        state.selectedIds = value.map((obj) => obj.id);
      }
    },
    getTimeline() {
      return makeTimelineProxy(state);
    },
    get timeline(): JsflTimeline {
      return makeTimelineProxy(state);
    },
    get layers(): JsflLayer[] {
      return makeTimelineProxy(state).layers;
    },
    get timelines(): readonly JsflTimeline[] {
      return state.doc.scenes.map((_, sceneIdx) => {
        // Build a temporary state snapshot pointing at the given scene so
        // that the returned proxy reads/writes the correct scene timeline.
        const sceneState: RuntimeState = new Proxy(state, {
          get(target, prop) {
            if (prop === "sceneIndex") return sceneIdx;
            return Reflect.get(target, prop);
          },
          set(target, prop, value) {
            return Reflect.set(target, prop, value);
          },
        });
        return makeTimelineProxy(sceneState);
      });
    },
    get currentTimeline(): number {
      // Always 0 — this runtime operates on the main timeline only.
      return 0;
    },
    get library(): JsflLibrary {
      return makeLibraryProxy(state, ids);
    },
    addNewRectangle(bounds, _cornerRadius) {
      const layerId = getActiveLayerId(state);
      if (!layerId) return;
      const shape = createRectShape(
        bounds.left,
        bounds.top,
        bounds.right,
        bounds.bottom,
        null,
        null
      );
      const obj: ShapeDisplayObject = {
        type: "shape",
        id: ids.nextShapeId(),
        shape,
        x: 0,
        y: 0,
      };
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      mutateTimeline((tl) => addDisplayObject(tl, layerId, state.frameIndex, obj));
    },
    addNewOval(bounds) {
      const layerId = getActiveLayerId(state);
      if (!layerId) return;
      const shape = createOvalShape(
        bounds.left,
        bounds.top,
        bounds.right,
        bounds.bottom,
        null,
        null
      );
      const obj: ShapeDisplayObject = {
        type: "shape",
        id: ids.nextShapeId(),
        shape,
        x: 0,
        y: 0,
      };
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      mutateTimeline((tl) => addDisplayObject(tl, layerId, state.frameIndex, obj));
    },
    addNewText(bounds, text) {
      const layerId = getActiveLayerId(state);
      if (!layerId) return;
      const obj: TextDisplayObject = {
        type: "text",
        id: ids.nextTextId(),
        x: bounds.left,
        y: bounds.top,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
        text,
        textType: "static",
        fontFamily: "Arial",
        fontSize: 12,
        bold: false,
        italic: false,
        color: { r: 0, g: 0, b: 0, a: 255 },
        align: "left",
        multiline: false,
        wordWrap: false,
      };
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      mutateTimeline((tl) => addDisplayObject(tl, layerId, state.frameIndex, obj));
    },
    selectAll() {
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const ids2: string[] = [];
      for (const layer of scene.timeline.layers) {
        const kfs = layer.frames
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index);
        const kf = kfs[0];
        if (kf) {
          for (const obj of kf.displayObjects) {
            ids2.push(obj.id);
          }
        }
      }
      state.selectedIds = ids2;
    },
    setSelectionRect(rect: { left: number; top: number; right: number; bottom: number }) {
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const selectedIds2: string[] = [];
      for (const layer of scene.timeline.layers) {
        const kfs = layer.frames
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index);
        const kf = kfs[0];
        if (kf) {
          for (const obj of kf.displayObjects) {
            const o = obj as { x?: number; y?: number; width?: number; height?: number };
            const ox = o.x ?? 0;
            const oy = o.y ?? 0;
            if (
              ox >= rect.left &&
              oy >= rect.top &&
              ox <= rect.right &&
              oy <= rect.bottom
            ) {
              selectedIds2.push(obj.id);
            }
          }
        }
      }
      state.selectedIds = selectedIds2;
    },
    deleteSelection() {
      if (state.selectedIds.length === 0) return;
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const toDelete = new Set(state.selectedIds);
      const newTimeline: TimelineModel = {
        ...scene.timeline,
        layers: scene.timeline.layers.map((layer) => {
          const kfs = layer.frames
            .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
            .sort((a, b) => b.index - a.index);
          const kf = kfs[0];
          if (!kf) return layer;
          const newFrames = layer.frames.map((f) => {
            if (f.index !== kf.index) return f;
            const remaining = f.displayObjects.filter(
              (o) => !toDelete.has(o.id)
            );
            return {
              ...f,
              displayObjects: remaining,
              isEmpty: remaining.length === 0,
            };
          });
          return { ...layer, frames: newFrames };
        }),
      };
      const newScenes = state.doc.scenes.map((s, i) =>
        i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
      );
      state.doc = { ...state.doc, scenes: newScenes };
      state.selectedIds = [];
    },
    convertToSymbol(type: string, name: string, _registration?: string) {
      if (state.selectedIds.length === 0) return;
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const layerId = getActiveLayerId(state);
      if (!layerId) return;

      const toConvert = new Set(state.selectedIds);
      const layer = scene.timeline.layers.find((l) => l.id === layerId);
      if (!layer) return;

      const kf = [...layer.frames]
        .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
        .sort((a, b) => b.index - a.index)[0];
      if (!kf) return;

      const objectsToConvert = kf.displayObjects.filter((o) =>
        toConvert.has(o.id)
      );
      if (objectsToConvert.length === 0) return;

      const avgX =
        objectsToConvert.reduce(
          (sum, o) => sum + ((o as { x?: number }).x ?? 0),
          0
        ) / objectsToConvert.length;
      const avgY =
        objectsToConvert.reduce(
          (sum, o) => sum + ((o as { y?: number }).y ?? 0),
          0
        ) / objectsToConvert.length;

      const symbolObjects = objectsToConvert.map((o) => ({
        ...o,
        x: ((o as { x?: number }).x ?? 0) - avgX,
        y: ((o as { y?: number }).y ?? 0) - avgY,
      }));

      const symType = jsflSymbolType(type);
      const { library: updatedLib, item: newSymbol } = createSymbolInLibrary(
        state.doc.library,
        name,
        symType
      );

      const symbolWithObjects = {
        ...newSymbol,
        timeline: {
          layers: [
            {
              ...newSymbol.timeline.layers[0],
              frames: [
                {
                  ...newSymbol.timeline.layers[0].frames[0],
                  displayObjects: symbolObjects,
                  isEmpty: false,
                },
              ],
            },
          ],
        },
      };

      const finalLib = {
        ...updatedLib,
        items: updatedLib.items.map((i: LibraryItem) =>
          i.id === newSymbol.id ? symbolWithObjects : i
        ),
      };

      const instId = ids.nextInstId();
      const instance: SymbolInstance = {
        type: "instance",
        id: instId,
        symbolId: newSymbol.id,
        x: avgX,
        y: avgY,
      };

      const newTimeline: TimelineModel = {
        ...scene.timeline,
        layers: scene.timeline.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            frames: l.frames.map((f) => {
              if (!f.isKeyframe || f.index !== kf.index) return f;
              const remaining = f.displayObjects.filter(
                (o) => !toConvert.has(o.id)
              );
              return {
                ...f,
                displayObjects: [...remaining, instance],
                isEmpty: false,
              };
            }),
          };
        }),
      };

      const newScenes = state.doc.scenes.map((s, i) =>
        i === state.sceneIndex
          ? { ...s, timeline: newTimeline }
          : s
      );
      state.doc = {
        ...state.doc,
        library: finalLib,
        scenes: newScenes,
      };
      state.selectedIds = [instId];
    },
    group() {
      if (state.selectedIds.length === 0) return;
      const layerIndex = state.currentLayerIndex;
      state.doc = groupObjects(
        state.doc,
        state.sceneIndex,
        layerIndex,
        state.frameIndex,
        [...state.selectedIds]
      );
      // The newly created group is the single display object at the insertion point;
      // find it by comparing before/after and update selection to the new group id.
      const scene = state.doc.scenes[state.sceneIndex];
      if (scene) {
        const layer = scene.timeline.layers[layerIndex];
        if (layer) {
          const kf = [...layer.frames]
            .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
            .sort((a, b) => b.index - a.index)[0];
          if (kf) {
            const newGroup = kf.displayObjects.find((o) => o.type === "group");
            state.selectedIds = newGroup ? [newGroup.id] : [];
          }
        }
      }
    },
    ungroup() {
      if (state.selectedIds.length === 0) return;
      // Ungroup each selected group (usually one at a time)
      for (const groupId of [...state.selectedIds]) {
        state.doc = ungroupObjects(
          state.doc,
          state.sceneIndex,
          state.currentLayerIndex,
          state.frameIndex,
          groupId
        );
      }
      state.selectedIds = [];
    },
    addItem(pos: { x: number; y: number }, item: { name?: string }): void {
      const lib = makeLibraryProxy(state, ids);
      lib.addItemToDocument(item.name ?? "", pos.x, pos.y);
    },
    get scaleContent(): boolean {
      return false;
    },
    set scaleContent(_value: boolean) {
      console.warn("doc.scaleContent: not supported");
    },
    publish(): Uint8Array {
      // Lazy import to avoid pulling @flash/swf into unit test bundles that
      // don't need it.  In a browser/desktop context this is always available.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { compileDocument } = require("@flash/swf") as {
        compileDocument(doc: FlashDocument): Uint8Array;
      };
      return compileDocument(state.doc);
    },
    exportSWF(fileURL: string): void {
      // Compile the document using the same pipeline as publish().
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { compileDocument } = require("@flash/swf") as {
        compileDocument(doc: FlashDocument): Uint8Array;
      };
      const bytes = compileDocument(state.doc);

      // In the browser we cannot write to the filesystem path given by fileURL.
      // Extract just the filename portion to use as the download suggestion,
      // then trigger a programmatic <a download> click.
      const filename = fileURL.split(/[\\/]/).pop() || "movie.swf";
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/x-shockwave-flash" });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        // Revoke asynchronously so the download can start before the object
        // URL is cleaned up.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    },
    importFile(_fileURL: string, _importToLibrary?: boolean): void {
      console.warn('doc.importFile: not supported in browser context');
    },
    getDataFromDocument(_name: string): any {
      console.warn('doc.getDataFromDocument: not supported');
      return undefined;
    },
    addDataToDocument(_name: string, _type: string, _data: any): void {
      console.warn('doc.addDataToDocument: not supported');
    },
    enterEditMode(_editMode?: string): void {
      console.warn('doc.enterEditMode: symbol editing not supported');
    },
    exitEditMode(): void {
      console.warn('doc.exitEditMode: not supported');
    },
    setTransformationPoint(_point: { x: number; y: number }): void {
      console.warn('doc.setTransformationPoint: not supported');
    },
    align(_alignMode: string, _bUseDocumentBounds?: boolean): void {
      console.warn('doc.align: not implemented');
    },
    space(_direction: string): void {
      console.warn('doc.space: not implemented');
    },
    match(_bWidth: boolean, _bHeight: boolean): void {
      console.warn('doc.match: not implemented');
    },
    transformSelection(_a: number, _b: number, _c: number, _d: number): void {
      console.warn('doc.transformSelection: not implemented');
    },
    moveSelectionBy(delta: { x: number; y: number }): void {
      if (state.selectedIds.length === 0) return;
      const toMove = new Set(state.selectedIds);
      // Collect all (layerId, keyframeIndex, objectId, currentX, currentY) tuples
      // from a snapshot of the document before any mutations.
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      type MoveEntry = { layerId: string; kfIndex: number; objId: string; newX: number; newY: number };
      const entries: MoveEntry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toMove.has(obj.id)) continue;
          const current = obj as { x?: number; y?: number };
          entries.push({
            layerId: layer.id,
            kfIndex: kf.index,
            objId: obj.id,
            newX: (current.x ?? 0) + delta.x,
            newY: (current.y ?? 0) + delta.y,
          });
        }
      }
      // Apply all mutations sequentially; each reads the latest state.doc
      for (const entry of entries) {
        const currentScene = state.doc.scenes[state.sceneIndex];
        if (!currentScene) continue;
        const newTimeline = updateDisplayObject(
          currentScene.timeline,
          entry.layerId,
          entry.kfIndex,
          entry.objId,
          { x: entry.newX, y: entry.newY }
        );
        state.doc = {
          ...state.doc,
          scenes: state.doc.scenes.map((s, i) =>
            i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
          ),
        };
      }
    },
    scaleSelection(xScale: number, yScale: number, _whichCorner?: string): void {
      if (state.selectedIds.length === 0) return;
      const toScale = new Set(state.selectedIds);
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      type ScaleEntry = { layerId: string; kfIndex: number; objId: string; newScaleX: number; newScaleY: number };
      const entries: ScaleEntry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toScale.has(obj.id)) continue;
          const current = obj as { scaleX?: number; scaleY?: number };
          entries.push({
            layerId: layer.id,
            kfIndex: kf.index,
            objId: obj.id,
            newScaleX: (current.scaleX ?? 1) * xScale,
            newScaleY: (current.scaleY ?? 1) * yScale,
          });
        }
      }
      for (const entry of entries) {
        const currentScene = state.doc.scenes[state.sceneIndex];
        if (!currentScene) continue;
        const newTimeline = updateDisplayObject(
          currentScene.timeline,
          entry.layerId,
          entry.kfIndex,
          entry.objId,
          { scaleX: entry.newScaleX, scaleY: entry.newScaleY }
        );
        state.doc = {
          ...state.doc,
          scenes: state.doc.scenes.map((s, i) =>
            i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
          ),
        };
      }
    },
    selectNone(): void {
      state.selectedIds = [];
    },
    save(_fileURL?: string): boolean {
      console.warn('doc.save: use fl.saveDocument instead');
      return true;
    },
    undo(): void {
      console.warn('doc.undo: history managed at UI layer');
    },
    redo(): void {
      console.warn('doc.redo: history managed at UI layer');
    },
    revert(): void {
      console.warn('doc.revert: not supported');
    },
    duplicateSelection(): void {
      if (state.selectedIds.length === 0) return;
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const toDup = new Set(state.selectedIds);

      // Collect all objects to duplicate with their location info
      type DupEntry = { layerId: string; kfIndex: number; obj: DisplayObject };
      const entries: DupEntry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toDup.has(obj.id)) continue;
          entries.push({ layerId: layer.id, kfIndex: kf.index, obj });
        }
      }

      const newIds: string[] = [];
      // Add clones one at a time, re-reading the latest scene after each mutation
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const clone: DisplayObject = JSON.parse(JSON.stringify(entry.obj));
        const newId = `dup-${Date.now()}-${i}`;
        (clone as { id: string }).id = newId;
        const cloneWithOffset = clone as { id: string; x?: number; y?: number };
        cloneWithOffset.x = (cloneWithOffset.x ?? 0) + 10;
        cloneWithOffset.y = (cloneWithOffset.y ?? 0) + 10;
        newIds.push(newId);

        const currentScene = state.doc.scenes[state.sceneIndex];
        if (!currentScene) continue;
        const newTimeline = addDisplayObject(
          currentScene.timeline,
          entry.layerId,
          entry.kfIndex,
          clone
        );
        state.doc = {
          ...state.doc,
          scenes: state.doc.scenes.map((s, idx) =>
            idx === state.sceneIndex ? { ...s, timeline: newTimeline } : s
          ),
        };
      }

      state.selectedIds = newIds;
    },
    addNewScene(name: string): void {
      state.doc = coreAddScene(state.doc, name);
    },
    deleteScene(): void {
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      if (state.doc.scenes.length <= 1) return;
      state.doc = coreRemoveScene(state.doc, scene.id);
      // Clamp the scene index so it stays in bounds after deletion
      state.sceneIndex = Math.min(state.sceneIndex, state.doc.scenes.length - 1);
    },
    renameScene(name: string): void {
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      state.doc = coreRenameScene(state.doc, scene.id, name);
    },
    duplicateScene(): void {
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      state.doc = coreDuplicateScene(state.doc, scene.id);
    },
    arrange(type: string): void {
      if (state.selectedIds.length === 0) return;
      const op = type as "front" | "back" | "forward" | "backward";
      const layerId = getActiveLayerId(state);
      if (!layerId) return;
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const newScenes = state.doc.scenes.map((s, si) => {
        if (si !== state.sceneIndex) return s;
        const newLayers = s.timeline.layers.map((layer) => {
          if (layer.id !== layerId) return layer;
          const kf = [...layer.frames]
            .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
            .sort((a, b) => b.index - a.index)[0];
          if (!kf) return layer;
          const newFrames = layer.frames.map((f) => {
            if (f.index !== kf.index) return f;
            let objs = [...f.displayObjects];
            for (const id of state.selectedIds) {
              const idx = objs.findIndex((o) => o.id === id);
              if (idx < 0) continue;
              const [item] = objs.splice(idx, 1);
              if (op === "front") {
                objs.push(item);
              } else if (op === "back") {
                objs.unshift(item);
              } else if (op === "forward") {
                const newIdx = Math.min(idx + 1, objs.length);
                objs.splice(newIdx, 0, item);
              } else {
                // backward
                const newIdx = Math.max(0, idx - 1);
                objs.splice(newIdx, 0, item);
              }
            }
            return { ...f, displayObjects: objs };
          });
          return { ...layer, frames: newFrames };
        });
        return { ...s, timeline: { ...s.timeline, layers: newLayers } };
      });
      state.doc = { ...state.doc, scenes: newScenes };
    },
    getElementProperty(propertyName: string): any {
      if (state.selectedIds.length === 0) return undefined;
      const firstId = state.selectedIds[0];
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return undefined;
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        const obj = kf.displayObjects.find((o) => o.id === firstId);
        if (obj) {
          const proxy = makeElementProxy(state, layer.id, kf.index, obj);
          return (proxy as unknown as Record<string, unknown>)[propertyName];
        }
      }
      return undefined;
    },
    setElementProperty(propertyName: string, value: any): void {
      if (state.selectedIds.length === 0) return;
      const toSet = new Set(state.selectedIds);
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      type SetEntry = { layerId: string; kfIndex: number; obj: DisplayObject };
      const entries: SetEntry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toSet.has(obj.id)) continue;
          entries.push({ layerId: layer.id, kfIndex: kf.index, obj });
        }
      }
      for (const entry of entries) {
        const proxy = makeElementProxy(state, entry.layerId, entry.kfIndex, entry.obj);
        (proxy as unknown as Record<string, unknown>)[propertyName] = value;
      }
    },
    getTextString(): string {
      if (state.selectedIds.length === 0) return "";
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return "";
      for (const id of state.selectedIds) {
        for (const layer of scene.timeline.layers) {
          const kf = [...layer.frames]
            .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
            .sort((a, b) => b.index - a.index)[0];
          if (!kf) continue;
          const obj = kf.displayObjects.find((o) => o.id === id);
          if (obj && obj.type === "text") {
            return (obj as { text?: string }).text ?? "";
          }
        }
      }
      return "";
    },
    setTextString(text: string): void {
      if (state.selectedIds.length === 0) return;
      const toSet = new Set(state.selectedIds);
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      type TextEntry = { layerId: string; kfIndex: number; objId: string };
      const entries: TextEntry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toSet.has(obj.id) || obj.type !== "text") continue;
          entries.push({ layerId: layer.id, kfIndex: kf.index, objId: obj.id });
        }
      }
      for (const entry of entries) {
        const currentScene = state.doc.scenes[state.sceneIndex];
        if (!currentScene) continue;
        const newTimeline = updateDisplayObject(
          currentScene.timeline,
          entry.layerId,
          entry.kfIndex,
          entry.objId,
          { text }
        );
        state.doc = {
          ...state.doc,
          scenes: state.doc.scenes.map((s, i) =>
            i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
          ),
        };
      }
    },
    swap(libraryItemName: string): void {
      if (state.selectedIds.length === 0) return;
      // Find the new library item by name
      const newItem = state.doc.library.items.find((i) => i.name === libraryItemName);
      if (!newItem) {
        console.warn("[JSFL] doc.swap: library item not found:", libraryItemName);
        return;
      }
      if (newItem.itemType !== "symbol") {
        console.warn("[JSFL] doc.swap: only symbol items can be swapped; got:", newItem.itemType);
        return;
      }
      // Find the first selected SymbolInstance in the current keyframe
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!state.selectedIds.includes(obj.id) || obj.type !== "instance") continue;
          // Found the first selected SymbolInstance — update its symbolId
          const currentScene = state.doc.scenes[state.sceneIndex];
          if (!currentScene) return;
          const newTimeline = updateDisplayObject(
            currentScene.timeline,
            layer.id,
            kf.index,
            obj.id,
            { symbolId: newItem.id } as Parameters<typeof updateDisplayObject>[4]
          );
          state.doc = {
            ...state.doc,
            scenes: state.doc.scenes.map((s, i) =>
              i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
            ),
          };
          return; // Only swap the first selected instance
        }
      }
      console.warn("[JSFL] doc.swap: no SymbolInstance found in selection");
    },
    setInstanceBrightness(brightness: number): void {
      if (state.selectedIds.length === 0) return;
      const toSet = new Set(state.selectedIds);
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      type Entry = { layerId: string; kfIndex: number; objId: string };
      const entries: Entry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toSet.has(obj.id)) continue;
          entries.push({ layerId: layer.id, kfIndex: kf.index, objId: obj.id });
        }
      }
      for (const entry of entries) {
        const currentScene = state.doc.scenes[state.sceneIndex];
        if (!currentScene) continue;
        const newTimeline = updateDisplayObject(
          currentScene.timeline,
          entry.layerId,
          entry.kfIndex,
          entry.objId,
          { colorEffect: { type: "brightness", brightness } } as Parameters<typeof updateDisplayObject>[4]
        );
        state.doc = {
          ...state.doc,
          scenes: state.doc.scenes.map((s, i) =>
            i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
          ),
        };
      }
    },
    setInstanceTint(r: number, g: number, b: number, strength: number): void {
      if (state.selectedIds.length === 0) return;
      const toSet = new Set(state.selectedIds);
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const tintColor =
        "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
      type Entry = { layerId: string; kfIndex: number; objId: string };
      const entries: Entry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toSet.has(obj.id)) continue;
          entries.push({ layerId: layer.id, kfIndex: kf.index, objId: obj.id });
        }
      }
      for (const entry of entries) {
        const currentScene = state.doc.scenes[state.sceneIndex];
        if (!currentScene) continue;
        const newTimeline = updateDisplayObject(
          currentScene.timeline,
          entry.layerId,
          entry.kfIndex,
          entry.objId,
          { colorEffect: { type: "tint", tintColor, tintAmount: strength } } as Parameters<typeof updateDisplayObject>[4]
        );
        state.doc = {
          ...state.doc,
          scenes: state.doc.scenes.map((s, i) =>
            i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
          ),
        };
      }
    },
    setElementTextAttr(attrName: string, value: any): void {
      if (state.selectedIds.length === 0) return;
      const toSet = new Set(state.selectedIds);
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      type TextEntry = { layerId: string; kfIndex: number; objId: string };
      const entries: TextEntry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toSet.has(obj.id) || obj.type !== "text") continue;
          entries.push({ layerId: layer.id, kfIndex: kf.index, objId: obj.id });
        }
      }
      for (const entry of entries) {
        const currentScene = state.doc.scenes[state.sceneIndex];
        if (!currentScene) continue;
        const newTimeline = updateDisplayObject(
          currentScene.timeline,
          entry.layerId,
          entry.kfIndex,
          entry.objId,
          { [attrName]: value } as Parameters<typeof updateDisplayObject>[4]
        );
        state.doc = {
          ...state.doc,
          scenes: state.doc.scenes.map((s, i) =>
            i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
          ),
        };
      }
    },
    setTextAttr(attrName: string, value: any): void {
      this.setElementTextAttr(attrName, value);
    },
    getFilters(): FlashFilter[] {
      if (state.selectedIds.length === 0) return [];
      const firstId = state.selectedIds[0];
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        const obj = kf.displayObjects.find((o) => o.id === firstId);
        if (obj) {
          const withFilters = obj as { filters?: FlashFilter[] };
          return withFilters.filters ? [...withFilters.filters] : [];
        }
      }
      return [];
    },
    addFilter(filter: { name: string; [key: string]: any }): void {
      if (state.selectedIds.length === 0) return;
      const nameLower = filter.name.toLowerCase().replace(/\s+/g, "");
      let baseFilter: FlashFilter;
      if (nameLower === "dropshadow") {
        baseFilter = defaultDropShadow();
      } else if (nameLower === "blur") {
        baseFilter = defaultBlur();
      } else if (nameLower === "glow") {
        baseFilter = defaultGlow();
      } else if (nameLower === "bevel") {
        baseFilter = defaultBevel();
      } else {
        console.warn("[JSFL] doc.addFilter: unrecognised filter name:", filter.name);
        return;
      }
      // Merge caller overrides (excluding the 'name' key) onto the defaults.
      const { name: _name, ...overrides } = filter;
      const newFilter = { ...baseFilter, ...overrides } as FlashFilter;
      const toUpdate = new Set(state.selectedIds);
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      type Entry = { layerId: string; kfIndex: number; objId: string; existingFilters: FlashFilter[] };
      const entries: Entry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toUpdate.has(obj.id)) continue;
          const withFilters = obj as { filters?: FlashFilter[] };
          entries.push({
            layerId: layer.id,
            kfIndex: kf.index,
            objId: obj.id,
            existingFilters: withFilters.filters ? [...withFilters.filters] : [],
          });
        }
      }
      for (const entry of entries) {
        const currentScene = state.doc.scenes[state.sceneIndex];
        if (!currentScene) continue;
        const newTimeline = updateDisplayObject(
          currentScene.timeline,
          entry.layerId,
          entry.kfIndex,
          entry.objId,
          { filters: [...entry.existingFilters, newFilter] } as Parameters<typeof updateDisplayObject>[4]
        );
        state.doc = {
          ...state.doc,
          scenes: state.doc.scenes.map((s, i) =>
            i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
          ),
        };
      }
    },
    removeFilter(filterIndex: number): void {
      if (state.selectedIds.length === 0) return;
      const toUpdate = new Set(state.selectedIds);
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      type Entry = { layerId: string; kfIndex: number; objId: string; existingFilters: FlashFilter[] };
      const entries: Entry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toUpdate.has(obj.id)) continue;
          const withFilters = obj as { filters?: FlashFilter[] };
          entries.push({
            layerId: layer.id,
            kfIndex: kf.index,
            objId: obj.id,
            existingFilters: withFilters.filters ? [...withFilters.filters] : [],
          });
        }
      }
      for (const entry of entries) {
        const currentScene = state.doc.scenes[state.sceneIndex];
        if (!currentScene) continue;
        const newTimeline = updateDisplayObject(
          currentScene.timeline,
          entry.layerId,
          entry.kfIndex,
          entry.objId,
          { filters: entry.existingFilters.filter((_, i) => i !== filterIndex) } as Parameters<typeof updateDisplayObject>[4]
        );
        state.doc = {
          ...state.doc,
          scenes: state.doc.scenes.map((s, i) =>
            i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
          ),
        };
      }
    },
    enableFilter(filterIndex: number): void {
      if (state.selectedIds.length === 0) return;
      const toUpdate = new Set(state.selectedIds);
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      type Entry = { layerId: string; kfIndex: number; objId: string; existingFilters: FlashFilter[] };
      const entries: Entry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toUpdate.has(obj.id)) continue;
          const withFilters = obj as { filters?: FlashFilter[] };
          entries.push({
            layerId: layer.id,
            kfIndex: kf.index,
            objId: obj.id,
            existingFilters: withFilters.filters ? [...withFilters.filters] : [],
          });
        }
      }
      for (const entry of entries) {
        const currentScene = state.doc.scenes[state.sceneIndex];
        if (!currentScene) continue;
        const newFilters = entry.existingFilters.map((f, i) =>
          i === filterIndex ? { ...f, enabled: true } : f
        ) as FlashFilter[];
        const newTimeline = updateDisplayObject(
          currentScene.timeline,
          entry.layerId,
          entry.kfIndex,
          entry.objId,
          { filters: newFilters } as Parameters<typeof updateDisplayObject>[4]
        );
        state.doc = {
          ...state.doc,
          scenes: state.doc.scenes.map((s, i) =>
            i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
          ),
        };
      }
    },
    disableFilter(filterIndex: number): void {
      if (state.selectedIds.length === 0) return;
      const toUpdate = new Set(state.selectedIds);
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      type Entry = { layerId: string; kfIndex: number; objId: string; existingFilters: FlashFilter[] };
      const entries: Entry[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        for (const obj of kf.displayObjects) {
          if (!toUpdate.has(obj.id)) continue;
          const withFilters = obj as { filters?: FlashFilter[] };
          entries.push({
            layerId: layer.id,
            kfIndex: kf.index,
            objId: obj.id,
            existingFilters: withFilters.filters ? [...withFilters.filters] : [],
          });
        }
      }
      for (const entry of entries) {
        const currentScene = state.doc.scenes[state.sceneIndex];
        if (!currentScene) continue;
        const newFilters = entry.existingFilters.map((f, i) =>
          i === filterIndex ? { ...f, enabled: false } : f
        ) as FlashFilter[];
        const newTimeline = updateDisplayObject(
          currentScene.timeline,
          entry.layerId,
          entry.kfIndex,
          entry.objId,
          { filters: newFilters } as Parameters<typeof updateDisplayObject>[4]
        );
        state.doc = {
          ...state.doc,
          scenes: state.doc.scenes.map((s, i) =>
            i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
          ),
        };
      }
    },
    addNewLine(startPoint: { x: number; y: number }, endPoint: { x: number; y: number }): void {
      const layerId = getActiveLayerId(state);
      if (!layerId) return;
      const defaultStroke = {
        type: "solid" as const,
        color: { r: 0, g: 0, b: 0, a: 255 },
        width: 1,
        caps: "round" as const,
        joints: "round" as const,
        miterLimit: 3,
      };
      const shape = createLineShape(
        startPoint.x,
        startPoint.y,
        endPoint.x,
        endPoint.y,
        defaultStroke
      );
      const obj: ShapeDisplayObject = {
        type: "shape",
        id: ids.nextShapeId(),
        shape,
        x: 0,
        y: 0,
      };
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      mutateTimeline((tl) => addDisplayObject(tl, layerId, state.frameIndex, obj));
    },
    breakApart(): void {
      if (state.selectedIds.length === 0) return;
      const objectId = state.selectedIds[0];
      state.doc = coreBreakApart(
        state.doc,
        state.sceneIndex,
        state.currentLayerIndex,
        state.frameIndex,
        objectId
      );
    },
    flatten(): void {
      console.warn('doc.flatten: not supported');
    },
    smooth(): void {
      console.warn('doc.smooth: not supported');
    },
    straighten(): void {
      console.warn('doc.straighten: not supported');
    },
    crop(): void {
      console.warn('doc.crop: not supported');
    },
    intersect(): void {
      console.warn('doc.intersect: not supported');
    },
    punch(): void {
      console.warn('doc.punch: not supported');
    },
    union(): void {
      console.warn('doc.union: not supported');
    },
    clipCopy(): void {
      console.warn('doc.clipCopy: use fl.clipCopyFrames');
    },
    clipCut(): void {
      console.warn('doc.clipCut: not supported');
    },
    clipPaste(_bInPlace?: boolean): void {
      console.warn('doc.clipPaste: not supported');
    },
    paste(_bInPlace?: boolean): void {
      console.warn('doc.paste: not supported');
    },
    get currentPublishProfile(): string {
      return 'Default';
    },
    get publishProfiles(): string[] {
      return ['Default'];
    },
    getInstanceAtPoint(x: number, y: number): any {
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return null;
      // Iterate layers from front (index 0) to back (index n-1)
      for (const layer of scene.timeline.layers) {
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) continue;
        // Last object in the layer wins if multiple objects overlap the point
        let match: DisplayObject | null = null;
        for (const obj of kf.displayObjects) {
          const o = obj as { x?: number; y?: number; width?: number; height?: number };
          const ox = o.x ?? 0;
          const oy = o.y ?? 0;
          const ow = o.width ?? 100;
          const oh = o.height ?? 100;
          if (x >= ox && x <= ox + ow && y >= oy && y <= oy + oh) {
            match = obj;
          }
        }
        if (match !== null) {
          return makeElementProxy(state, layer.id, kf.index, match);
        }
      }
      return null;
    },
    getElementByIndex(layerIndex: number, frameIndex: number, elementIndex: number): any {
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return null;
      const layer = scene.timeline.layers[layerIndex];
      if (!layer) return null;
      const kf = [...layer.frames]
        .filter((f) => f.isKeyframe && f.index <= frameIndex)
        .sort((a, b) => b.index - a.index)[0];
      if (!kf) return null;
      const obj = kf.displayObjects[elementIndex];
      if (!obj) return null;
      return makeElementProxy(state, layer.id, kf.index, obj);
    },
  };
}

// ---------------------------------------------------------------------------
// JsflFl (top-level fl object)
// ---------------------------------------------------------------------------

export interface JsflFl {
  readonly version: string;
  /** Flash build number — always '0' in this runtime. */
  readonly buildNumber: string;
  readonly documents: JsflDocument[];
  getDocumentDOM(): JsflDocument;
  /**
   * Create a new default document (550×400, 12fps, white background, empty library,
   * one scene with one layer and one blank keyframe).  Resets the runtime state to
   * the new document and returns its proxy.
   * type is accepted for API compatibility but ignored (always "timeline").
   */
  createDocument(type?: string): JsflDocument;
  trace(msg: unknown): void;
  /**
   * Save the document.  In a browser context this triggers a download of the FLA.
   * fileURL is accepted for API compatibility but ignored in-browser.
   */
  saveDocument(doc: JsflDocument, fileURL?: string): void;
  /**
   * Returns whether the file at fileURL exists.  Always returns false in a browser
   * context (no filesystem access).
   */
  fileExists(fileURL: string): boolean;
  /** Copy selected frames from doc to the application-level frame clipboard. */
  clipCopyFrames(doc: JsflDocument): void;
  /** Paste the application-level frame clipboard into doc at the current position. */
  clipPasteFrames(doc: JsflDocument): void;
  /**
   * Open the FLA document at fileURL.  In a browser context this is not
   * supported; warns and returns the current document as a fallback.
   */
  openDocument(fileURL: string): JsflDocument;
  /**
   * Close the given document.  Not supported in browser context; no-op stub.
   */
  closeDocument(doc: JsflDocument, bPromptToSaveChanges?: boolean): void;
  /**
   * Open a file-picker dialog and return a file:// URL for the chosen file.
   * Always returns null in a browser context (no native picker available).
   */
  browseForFileURL(description: string, fileType?: string): string | null;
  /**
   * Open a folder-picker dialog and return a file:// URL for the chosen folder.
   * Always returns null in a browser context (no native picker available).
   */
  browseForFolderURL(description: string): string | null;
  /**
   * Run a JSFL script file by URI.  Not supported in browser context; no-op stub.
   */
  runScript(fileURI: string): void;
  /**
   * Run a named Flash command.  Not supported; no-op stub.
   */
  runCommand(name: string): void;
  /** Undo the last action.  History is managed at the UI layer; this is a no-op stub. */
  undo(): void;
  /** Redo the last undone action.  History is managed at the UI layer; this is a no-op stub. */
  redo(): void;
  /** Output panel — use trace() to append lines; clear() to wipe them. */
  outputPanel: { trace(msg: string): void; clear(): void };
  /** Math utility functions matching the Flash 8 fl.Math API. */
  readonly Math: {
    pointDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number;
    transformPoint(
      matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number },
      point: { x: number; y: number }
    ): { x: number; y: number };
  };
  /** The current clipboard contents. Always null in this runtime. */
  readonly clipboardContents: any;
}

function makeFlProxy(
  state: RuntimeState,
  ids: ReturnType<typeof makeIdCounters>,
  docProxy: JsflDocument
): JsflFl {
  // Keep a mutable reference so createDocument() can swap it out.
  let _docProxy = docProxy;

  return {
    get version() {
      return "8,0,0,0";
    },
    get buildNumber() {
      return "0";
    },
    get documents() {
      return [_docProxy];
    },
    getDocumentDOM() {
      return _docProxy;
    },
    createDocument(_type?: string): JsflDocument {
      // Reset state to a fresh default document
      state.doc = coreCreateDocument();
      state.traces = [];
      state.sceneIndex = 0;
      state.frameIndex = 0;
      state.currentLayerIndex = 0;
      state.selectedIds = [];
      state.frameClipboard = null;
      _docProxy = makeDocumentProxy(state, ids);
      return _docProxy;
    },
    trace(msg: unknown) {
      state.traces.push(String(msg));
    },
    saveDocument(_doc: JsflDocument, fileURL?: string): void {
      // In a browser context we have no direct filesystem access.  Trigger a
      // download of the current document serialised as FLA bytes when the
      // @flash/core saveFla helper is available; otherwise log a notice.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { saveFla } = require("@flash/core") as {
          saveFla(doc: FlashDocument): Uint8Array;
        };
        const bytes = saveFla(state.doc);
        const filename = fileURL
          ? (fileURL.split(/[\\/]/).pop() || "untitled.fla")
          : "untitled.fla";
        const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        try {
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.style.display = "none";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        }
      } catch {
        // Running in a test environment or @flash/core is unavailable — log
        // gracefully rather than throwing.
        console.log("[JSFL fl.saveDocument] save requested (no-op in this context)", fileURL);
      }
    },
    fileExists(fileURL: string): boolean {
      // Browser context has no filesystem access; always return false.
      console.warn("[JSFL fl.fileExists] always returns false in browser context:", fileURL);
      return false;
    },
    openDocument(fileURL: string): JsflDocument {
      console.warn("[JSFL fl.openDocument] opening files from URL is not supported in browser context; returning current document:", fileURL);
      return _docProxy;
    },
    closeDocument(_doc: JsflDocument, _bPromptToSaveChanges?: boolean): void {
      console.warn("fl.closeDocument: not supported in browser context");
    },
    clipCopyFrames(_doc: JsflDocument): void {
      console.warn("[JSFL] fl.clipCopyFrames not fully implemented");
      return undefined;
    },
    clipPasteFrames(_doc: JsflDocument): void {
      console.warn("[JSFL] fl.clipPasteFrames not fully implemented");
      return undefined;
    },
    browseForFileURL(_description: string, _fileType?: string): string | null {
      console.warn("[JSFL] fl.browseForFileURL: browser file picker not available; returning null");
      return null;
    },
    browseForFolderURL(_description: string): string | null {
      console.warn("[JSFL] fl.browseForFolderURL: not available in browser; returning null");
      return null;
    },
    runScript(_fileURI: string): void {
      console.warn('fl.runScript: not supported in browser context');
    },
    runCommand(_name: string): void {
      console.warn('fl.runCommand: not supported');
    },
    undo(): void {
      console.warn('fl.undo: history managed at UI layer');
    },
    redo(): void {
      console.warn('fl.redo: history managed at UI layer');
    },
    outputPanel: {
      trace(msg: string): void {
        state.traces.push(String(msg));
        console.log("[JSFL output]", msg);
      },
      clear(): void {
        // No-op: the output panel state is managed outside the runtime.
        // Callers wishing to clear the panel must do so via the UI.
      },
    },
    Math: Object.freeze({
      pointDistance(
        p1: { x: number; y: number },
        p2: { x: number; y: number }
      ): number {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return globalThis.Math.sqrt(dx * dx + dy * dy);
      },
      transformPoint(
        m: { a: number; b: number; c: number; d: number; tx: number; ty: number },
        p: { x: number; y: number }
      ): { x: number; y: number } {
        return { x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty };
      },
    }),
    get clipboardContents(): any {
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// JsflContext — public surface exposed by buildJsflContext
// ---------------------------------------------------------------------------

export interface JsflContext {
  doc: JsflDocument;
  fl: JsflFl;
}

// Internal shape with access to raw state (not exported as public API)
interface InternalContext extends JsflContext {
  __state: RuntimeState;
}

/**
 * Build a JsflContext wrapping the given FlashDocument.
 *
 * @param flashDoc   The current immutable FlashDocument.
 * @param sceneIndex Active scene index (defaults to 0).
 * @param frameIndex Active frame index (defaults to 0).
 */
export function buildJsflContext(
  flashDoc: FlashDocument,
  sceneIndex = 0,
  frameIndex = 0
): JsflContext {
  const state: RuntimeState = {
    doc: flashDoc,
    traces: [],
    sceneIndex,
    frameIndex,
    currentLayerIndex: 0,
    selectedIds: [],
    frameClipboard: null,
  };
  const ids = makeIdCounters();
  const docProxy = makeDocumentProxy(state, ids);
  const flProxy = makeFlProxy(state, ids, docProxy);
  const ctx: InternalContext = {
    doc: docProxy,
    fl: flProxy,
    __state: state,
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// runJsfl — execute a JSFL source string within the given context
// ---------------------------------------------------------------------------

/**
 * Execute a JSFL script string.
 *
 * The script has access to `fl` and `doc` globals matching the Flash 8 API.
 * All `fl.trace()` calls accumulate in `result.traces`.
 * Any thrown error is caught and returned in `result.error`.
 *
 * @param source   The JSFL script source string.
 * @param context  A JsflContext created by `buildJsflContext()`.
 */
export function runJsfl(source: string, context: JsflContext): JsflResult {
  // Access the internal state through the typed InternalContext
  const internal = context as InternalContext;
  const state = internal.__state;

  const { fl, doc } = context;

  let returnValue: unknown = undefined;
  let error: string | undefined;

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function("fl", "doc", source);
    returnValue = fn(fl, doc);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return {
    traces: [...state.traces],
    returnValue,
    error,
    finalDocument: state.doc,
  };
}
