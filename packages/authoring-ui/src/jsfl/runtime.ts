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
  insertFrame,
  insertKeyframe as coreInsertKeyframe,
  insertBlankKeyframe as coreInsertBlankKeyframe,
  removeFrame,
  setFrameScript,
  setFrameLabel,
  setMotionTween,
  setShapeTween,
  clearTween,
  createSymbolInLibrary,
  removeLibraryItem,
} from "@flash/core";
import type {
  ShapeDisplayObject,
  TextDisplayObject,
  DisplayObject,
  SymbolInstance,
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
      const kf = getKeyframe();
      return kf ? [...kf.displayObjects] : [];
    },
  };
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
    addNewLayer(name: string, _type?: string, _addAbove?: boolean) {
      const scene = getScene();
      if (!scene) return;
      const newTimeline: TimelineModel = addLayer(scene.timeline, name);
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
      } else if (property === "actionScript" || property === "script") {
        mutateTimeline((tl) =>
          setFrameScript(tl, layerId, fi, String(value))
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// JsflLibrary facade
// ---------------------------------------------------------------------------

export interface JsflLibraryItem {
  readonly name: string;
  readonly itemType: string;
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
      return state.doc.library.items.map((item) => ({
        name: item.name,
        itemType: item.itemType,
      }));
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
  readonly selection: DisplayObject[];
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
  /** Compile and return the SWF as a Uint8Array (browser-safe, no file I/O). */
  publish(): Uint8Array;
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
    getTimeline() {
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
    publish(): Uint8Array {
      // Lazy import to avoid pulling @flash/swf into unit test bundles that
      // don't need it.  In a browser/desktop context this is always available.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { compileDocument } = require("@flash/swf") as {
        compileDocument(doc: FlashDocument): Uint8Array;
      };
      return compileDocument(state.doc);
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
  trace(msg: unknown): void;
}

function makeFlProxy(state: RuntimeState, docProxy: JsflDocument): JsflFl {
  return {
    get version() {
      return "8,0,0,0";
    },
    get documents() {
      return [docProxy];
    },
    getDocumentDOM() {
      return docProxy;
    },
    trace(msg: unknown) {
      state.traces.push(String(msg));
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
  };
  const ids = makeIdCounters();
  const docProxy = makeDocumentProxy(state, ids);
  const flProxy = makeFlProxy(state, docProxy);
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
