/**
 * JSFL (JavaScript Flash Language) runtime — a minimal Flash 8 automation API.
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
} from "@flash/core";
import {
  createRectShape,
  createOvalShape,
  addDisplayObject,
  addLayer,
} from "@flash/core";
import type {
  ShapeDisplayObject,
  TextDisplayObject,
  DisplayObject,
} from "@flash/core";

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
  selectedIds: string[];
}

// ---------------------------------------------------------------------------
// JsflTimeline facade
// ---------------------------------------------------------------------------

export interface JsflTimeline {
  readonly currentLayer: number;
  readonly currentFrame: number;
  readonly frameCount: number;
  addNewLayer(name: string, type?: string): void;
}

function makeTimelineProxy(state: RuntimeState): JsflTimeline {
  return {
    get currentLayer() {
      return 0;
    },
    get currentFrame() {
      return state.frameIndex;
    },
    get frameCount() {
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return 1;
      const layers = scene.timeline.layers;
      if (layers.length === 0) return 1;
      let max = 1;
      for (const layer of layers) {
        if (layer.frameCount > max) max = layer.frameCount;
      }
      return max;
    },
    addNewLayer(name: string, _type?: string) {
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const newTimeline: TimelineModel = addLayer(scene.timeline, name);
      const newScenes = state.doc.scenes.map((s, i) =>
        i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
      );
      state.doc = { ...state.doc, scenes: newScenes };
    },
  };
}

// ---------------------------------------------------------------------------
// JsflDocument facade
// ---------------------------------------------------------------------------

export interface JsflDocument {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly backgroundColor: string;
  readonly selection: DisplayObject[];
  getTimeline(): JsflTimeline;
  addNewRectangle(bounds: { left: number; top: number; right: number; bottom: number }, cornerRadius: number): void;
  addNewOval(bounds: { left: number; top: number; right: number; bottom: number }): void;
  addNewText(bounds: { left: number; top: number; right: number; bottom: number }, text: string): void;
  selectAll(): void;
}

let _shapeIdCounter = 0;
function nextShapeId(): string {
  return `jsfl-shape-${++_shapeIdCounter}-${Date.now().toString(36)}`;
}

let _textIdCounter = 0;
function nextTextId(): string {
  return `jsfl-text-${++_textIdCounter}-${Date.now().toString(36)}`;
}

function getActiveLayerId(state: RuntimeState): string | null {
  const scene = state.doc.scenes[state.sceneIndex];
  if (!scene) return null;
  const layer = scene.timeline.layers[0];
  return layer?.id ?? null;
}

function makeDocumentProxy(state: RuntimeState): JsflDocument {
  return {
    get width() {
      return state.doc.properties.width;
    },
    get height() {
      return state.doc.properties.height;
    },
    get frameRate() {
      return state.doc.properties.frameRate;
    },
    get backgroundColor() {
      return state.doc.properties.backgroundColor;
    },
    get selection(): DisplayObject[] {
      if (state.selectedIds.length === 0) return [];
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return [];
      const result: DisplayObject[] = [];
      for (const layer of scene.timeline.layers) {
        // governing keyframe at or before frameIndex
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
    addNewRectangle(bounds, _cornerRadius) {
      const layerId = getActiveLayerId(state);
      if (!layerId) return;
      const shape = createRectShape(bounds.left, bounds.top, bounds.right, bounds.bottom, null, null);
      const obj: ShapeDisplayObject = {
        type: "shape",
        id: nextShapeId(),
        shape,
        x: 0,
        y: 0,
      };
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const newTimeline = addDisplayObject(scene.timeline, layerId, state.frameIndex, obj);
      const newScenes = state.doc.scenes.map((s, i) =>
        i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
      );
      state.doc = { ...state.doc, scenes: newScenes };
    },
    addNewOval(bounds) {
      const layerId = getActiveLayerId(state);
      if (!layerId) return;
      const shape = createOvalShape(bounds.left, bounds.top, bounds.right, bounds.bottom, null, null);
      const obj: ShapeDisplayObject = {
        type: "shape",
        id: nextShapeId(),
        shape,
        x: 0,
        y: 0,
      };
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const newTimeline = addDisplayObject(scene.timeline, layerId, state.frameIndex, obj);
      const newScenes = state.doc.scenes.map((s, i) =>
        i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
      );
      state.doc = { ...state.doc, scenes: newScenes };
    },
    addNewText(bounds, text) {
      const layerId = getActiveLayerId(state);
      if (!layerId) return;
      const obj: TextDisplayObject = {
        type: "text",
        id: nextTextId(),
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
      const newTimeline = addDisplayObject(scene.timeline, layerId, state.frameIndex, obj);
      const newScenes = state.doc.scenes.map((s, i) =>
        i === state.sceneIndex ? { ...s, timeline: newTimeline } : s
      );
      state.doc = { ...state.doc, scenes: newScenes };
    },
    selectAll() {
      const scene = state.doc.scenes[state.sceneIndex];
      if (!scene) return;
      const ids: string[] = [];
      for (const layer of scene.timeline.layers) {
        const kfs = layer.frames
          .filter((f) => f.isKeyframe && f.index <= state.frameIndex)
          .sort((a, b) => b.index - a.index);
        const kf = kfs[0];
        if (kf) {
          for (const obj of kf.displayObjects) {
            ids.push(obj.id);
          }
        }
      }
      state.selectedIds = ids;
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
    selectedIds: [],
  };
  const docProxy = makeDocumentProxy(state);
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
