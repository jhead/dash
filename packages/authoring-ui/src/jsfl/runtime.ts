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
} from "@flash/core";
import {
  createRectShape,
  createOvalShape,
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
  readonly layers: JsflLayer[];
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
    get layers(): JsflLayer[] {
      const scene = getScene();
      if (!scene) return [];
      return scene.timeline.layers.map((_, i) => makeLayerProxy(state, i));
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
}

function jsflSymbolType(jsflType: string): SymbolType {
  const t = jsflType.toLowerCase().replace(/\s+/g, "");
  if (t === "movieclip" || t === "movie clip") return "movieclip";
  if (t === "button") return "button";
  return "graphic";
}

function makeLibraryProxy(state: RuntimeState): JsflLibrary {
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
    get library(): JsflLibrary {
      return makeLibraryProxy(state);
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
  };
}

// ---------------------------------------------------------------------------
// JsflFl (top-level fl object)
// ---------------------------------------------------------------------------

export interface JsflFl {
  readonly version: string;
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
   * Open a file-picker dialog and return a file:// URL for the chosen file.
   * Always returns null in a browser context (no native picker available).
   */
  browseForFileURL(description: string, fileType?: string): string | null;
  /**
   * Open a folder-picker dialog and return a file:// URL for the chosen folder.
   * Always returns null in a browser context (no native picker available).
   */
  browseForFolderURL(description: string): string | null;
  /** Output panel — use trace() to append lines; clear() to wipe them. */
  outputPanel: { trace(msg: string): void; clear(): void };
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
