/**
 * AgentCommandRegistry
 *
 * Maps command names → handler functions. Handlers are registered by the
 * Shell once it mounts (via `setAgentCallbacks`). The registry is module-level
 * so the bridge client can dispatch commands without needing direct access to
 * React state.
 *
 * All commands from docs/19-agent-interface.md §Tool surface are implemented
 * here. Every mutating handler goes through the callbacks provided by Shell
 * (`pushDoc`, selection setters, etc.) — never bypasses history.
 *
 * Colors are #RRGGBB(AA) strings at the boundary; frame indices are 0-based.
 */

import type {
  AgentCommandHandler,
  EditorStatusParams,
  EditorStatusResult,
  DocGetParams,
  DocGetResult,
  DocSummaryResult,
  DocGetSummaryParams,
  Rev,
  OkRevResult,
  HistoryDepthResult,
  StageAddShapeResult,
  StagePlaceInstanceResult,
  SelectionGetResult,
  TimelineAddLayerResult,
  ScriptGetResult,
  ScriptSetResult,
  ScriptCheckResult,
  ScriptListResult,
  LibraryListResult,
  LibraryCreateSymbolResult,
  LibraryConvertToSymbolResult,
  JsflRunResult,
  PublishSwfResult,
  FileSaveFlaResult,
} from "@flash/agent-protocol";
import type { FlashDocument, LayerType, SymbolType } from "@flash/core";
import {
  hexToColor,
  createRectShape,
  createOvalShape,
  createLineShape,
  addLayer,
  deleteLayer,
  renameLayer,
  setLayerLocked,
  setLayerVisible,
  setLayerType,
  insertFrame,
  insertKeyframe,
  insertBlankKeyframe,
  removeFrame,
  setFrameLabel,
  setMotionTween,
  setShapeTween,
  clearTween,
  setFrameScript,
  addDisplayObject,
  removeDisplayObject,
  updateDisplayObject,
  createSymbolInLibrary,
  removeLibraryItem,
  saveFla,
  loadFla,
  getGoverningKeyframe,
  compileAS2,
  parse as parseAS2,
} from "@flash/core";
import type {
  DisplayObject,
  ShapeDisplayObject,
  TextDisplayObject,
  SymbolInstance,
  GroupObject,
  Color,
  Fill,
  SolidStroke,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Rev counter
// ---------------------------------------------------------------------------

let _rev: Rev = 0;

/** Called by the Shell after every pushDoc(). Bumps the rev counter. */
export function bumpRev(): void {
  _rev++;
}

/** Returns the current revision number. */
export function getRev(): Rev {
  return _rev;
}

// ---------------------------------------------------------------------------
// Callback wiring
// ---------------------------------------------------------------------------

interface AgentCallbacks {
  // Readers
  getDoc: () => FlashDocument;
  getSelectedIds: () => string[];
  getCurrentFrame: () => number;
  getActiveLayerIndex: () => number;
  getActiveTool: () => string;
  getEditContext: () => {
    mode: "document" | "symbol";
    symbolId?: string;
    symbolName?: string;
  };
  getActiveSceneIndex: () => number;
  getUndoDepth: () => number;
  getRedoDepth: () => number;

  // Mutators that go through history
  pushDoc: (newDoc: FlashDocument) => void;
  undo: () => void;
  redo: () => void;

  // View / selection setters (UI state — do NOT go through history)
  setCurrentFrame: (frame: number) => void;
  setActiveLayerByIndex: (index: number) => void;
  setActiveLayerById: (layerId: string) => void;
  setSelectedIds: (ids: string[]) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  selectTool: (toolId: string) => void;
  startPlayback: () => void;
  stopPlayback: () => void;

  // Escape hatches
  runJSFL: (source: string) => JsflRunResult;
  screenshotStage: (frameIndex?: number) => string; // returns base64 PNG
  publishToBytes: () => Uint8Array;
}

let _callbacks: AgentCallbacks | null = null;

/** Called by the Shell once it mounts to wire up live state accessors. */
export function setAgentCallbacks(callbacks: AgentCallbacks): void {
  _callbacks = callbacks;
}

/** Called by the Shell on unmount. */
export function clearAgentCallbacks(): void {
  _callbacks = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireCallbacks(): AgentCallbacks {
  if (!_callbacks) throw new Error("Editor not ready: agent callbacks not wired");
  return _callbacks;
}

/** Find the active-scene timeline. */
function getActiveTimeline(cb: AgentCallbacks) {
  const doc = cb.getDoc();
  const sceneIndex = Math.min(cb.getActiveSceneIndex(), doc.scenes.length - 1);
  return doc.scenes[sceneIndex].timeline;
}

/** Resolve a layerId or fall back to the active layer. */
function resolveLayerId(cb: AgentCallbacks, layerId?: string): string {
  const timeline = getActiveTimeline(cb);
  if (layerId) {
    if (!timeline.layers.find((l) => l.id === layerId)) {
      const known = timeline.layers.map((l) => l.id).join(", ");
      throw new Error(`Unknown layerId "${layerId}". Known: ${known}`);
    }
    return layerId;
  }
  const activeIdx = Math.min(cb.getActiveLayerIndex(), timeline.layers.length - 1);
  return timeline.layers[activeIdx].id;
}

/** Resolve frameIndex or fall back to current frame. */
function resolveFrameIndex(cb: AgentCallbacks, frameIndex?: number): number {
  return frameIndex !== undefined ? frameIndex : cb.getCurrentFrame();
}

/** Parse a hex color string to Color, returning white on failure. */
function parseHexColor(hex: string): Color {
  return hexToColor(hex);
}

/** Build a Fill from an optional hex string. */
function buildFill(fillHex?: string): Fill | null {
  if (!fillHex) return null;
  return { type: "solid", color: parseHexColor(fillHex) };
}

/** Build a SolidStroke from optional params. */
function buildStroke(strokeHex?: string, strokeWidth?: number): SolidStroke | null {
  if (!strokeHex) return null;
  return {
    type: "solid",
    color: parseHexColor(strokeHex),
    width: strokeWidth ?? 1,
    caps: "round",
    joints: "round",
    miterLimit: 3,
  };
}

/** Produce a new document by updating the active scene's timeline. */
function withSceneTimeline(
  doc: FlashDocument,
  sceneIndex: number,
  updater: (t: import("@flash/core").Timeline) => import("@flash/core").Timeline
): FlashDocument {
  const idx = Math.min(sceneIndex, doc.scenes.length - 1);
  const scene = doc.scenes[idx];
  const newTimeline = updater(scene.timeline);
  const newScenes = doc.scenes.map((s, i) => (i === idx ? { ...s, timeline: newTimeline } : s));
  return { ...doc, scenes: newScenes };
}

/** Generate a simple id for display objects created by agent commands. */
let _agentObjCounter = 0;
function nextAgentObjId(prefix = "agent-obj"): string {
  return `${prefix}-${++_agentObjCounter}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// JSON Pointer traversal (RFC 6901, minimal subset)
// ---------------------------------------------------------------------------

function resolvePointer(doc: unknown, pointer: string): unknown {
  if (!pointer || pointer === "/") return doc;
  const tokens = pointer.replace(/^\//, "").split("/").map(
    (t) => t.replace(/~1/g, "/").replace(/~0/g, "~")
  );
  let current: unknown = doc;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      throw new Error(`JSON Pointer "${pointer}": cannot traverse null/undefined at "${token}"`);
    }
    if (Array.isArray(current)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        throw new Error(
          `JSON Pointer "${pointer}": array index ${token} out of bounds (length=${current.length})`
        );
      }
      current = current[idx];
    } else if (typeof current === "object") {
      const obj = current as Record<string, unknown>;
      if (!(token in obj)) {
        const keys = Object.keys(obj).slice(0, 10).join(", ");
        throw new Error(
          `JSON Pointer "${pointer}": key "${token}" not found. Available keys: ${keys}`
        );
      }
      current = obj[token];
    } else {
      throw new Error(
        `JSON Pointer "${pointer}": cannot traverse ${typeof current} at "${token}"`
      );
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Script compile check helper
// ---------------------------------------------------------------------------

interface DiagnosticItem {
  message: string;
  line?: number;
  severity: "error" | "warning";
}

function compileCheckScript(script: string): DiagnosticItem[] {
  if (!script.trim()) return [];
  try {
    // Try to parse (and compile) — both parse and compile throw on error
    parseAS2(script);
    compileAS2(script);
    return [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Try to extract line number from message like "Parse error at line 3:"
    const lineMatch = /line (\d+)/i.exec(msg);
    const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
    return [{ message: msg, line, severity: "error" }];
  }
}

// ---------------------------------------------------------------------------
// Handlers map
// ---------------------------------------------------------------------------

// We type the entire handlers object loosely so each handler can have its own
// param/result types without complex generic gymnastics.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = AgentCommandHandler<any, any>;

const handlers: Record<string, AnyHandler> = {
  // =========================================================================
  // Session & document
  // =========================================================================

  editor_status(_params: EditorStatusParams): EditorStatusResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const scene = doc.scenes[Math.min(sceneIndex, doc.scenes.length - 1)];
    const timeline = scene?.timeline;
    const frameCount = timeline
      ? timeline.layers.reduce((max, l) => Math.max(max, l.frameCount), 0)
      : 0;
    const layerCount = timeline?.layers.length ?? 0;
    const activeLayerIdx = cb.getActiveLayerIndex();
    const activeLayer = timeline?.layers[activeLayerIdx];

    return {
      alive: true,
      version: "8.0.0",
      docId: doc.id,
      docName: doc.properties.width + "x" + doc.properties.height,
      width: doc.properties.width,
      height: doc.properties.height,
      frameRate: doc.properties.frameRate,
      backgroundColor: doc.properties.backgroundColor,
      frameCount,
      layerCount,
      sceneCount: doc.scenes.length,
      currentFrame: cb.getCurrentFrame(),
      activeLayerId: activeLayer?.id,
      activeTool: cb.getActiveTool(),
      editContext: cb.getEditContext(),
      rev: _rev,
    };
  },

  doc_get({ path }: DocGetParams): DocGetResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const resolvedPath = path ?? "";
    const value = resolvePointer(doc, resolvedPath);
    return { path: resolvedPath, value, rev: _rev };
  },

  doc_summary(_params: DocGetSummaryParams): DocSummaryResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();

    const scenes = doc.scenes.map((scene, sceneIdx) => {
      const layers = scene.timeline.layers.map((layer) => {
        const keyframes = layer.frames
          .filter((f) => f.isKeyframe)
          .map((f) => ({
            index: f.index,
            objectCount: f.displayObjects?.length ?? 0,
            hasScript: !!f.script,
            tween: f.tweenType !== "none" ? f.tweenType : null,
            label: f.label || undefined,
          }));
        return {
          id: layer.id,
          name: layer.name,
          type: layer.type ?? "normal",
          frameCount: layer.frameCount,
          visible: layer.visible !== false,
          locked: layer.locked === true,
          keyframes,
        };
      });

      const frameCount = scene.timeline.layers.reduce(
        (max, l) => Math.max(max, l.frameCount),
        0
      );

      return {
        index: sceneIdx,
        name: scene.name,
        layerCount: scene.timeline.layers.length,
        frameCount,
        layers,
      };
    });

    const library = doc.library.items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.itemType,
      folder: undefined,
    }));

    return {
      docId: doc.id,
      docName: doc.properties.width + "x" + doc.properties.height,
      width: doc.properties.width,
      height: doc.properties.height,
      frameRate: doc.properties.frameRate,
      backgroundColor: doc.properties.backgroundColor,
      sceneCount: doc.scenes.length,
      scenes,
      libraryItemCount: doc.library.items.length,
      library,
      rev: _rev,
    };
  },

  doc_load({ document }: { document: unknown }): OkRevResult {
    const cb = requireCallbacks();
    cb.pushDoc(document as FlashDocument);
    return { ok: true, rev: _rev };
  },

  doc_set_properties(params: {
    width?: number;
    height?: number;
    frameRate?: number;
    backgroundColor?: string;
  }): OkRevResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const newProps = { ...doc.properties };
    if (params.width !== undefined) newProps.width = params.width;
    if (params.height !== undefined) newProps.height = params.height;
    if (params.frameRate !== undefined) newProps.frameRate = params.frameRate;
    if (params.backgroundColor !== undefined) newProps.backgroundColor = params.backgroundColor;
    cb.pushDoc({ ...doc, properties: newProps });
    return { ok: true, rev: _rev };
  },

  history_undo(): OkRevResult {
    const cb = requireCallbacks();
    cb.undo();
    return { ok: true, rev: _rev };
  },

  history_redo(): OkRevResult {
    const cb = requireCallbacks();
    cb.redo();
    return { ok: true, rev: _rev };
  },

  history_depth(): HistoryDepthResult {
    const cb = requireCallbacks();
    return {
      undo: cb.getUndoDepth(),
      redo: cb.getRedoDepth(),
    };
  },

  // =========================================================================
  // Stage & selection
  // =========================================================================

  stage_add_shape(params: {
    kind: "rect" | "oval" | "line";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    layerId?: string;
    frameIndex?: number;
  }): StageAddShapeResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);
    const fill = buildFill(params.fill);
    const stroke = buildStroke(params.stroke, params.strokeWidth);

    let shape;
    if (params.kind === "rect") {
      shape = createRectShape(params.x1, params.y1, params.x2, params.y2, fill, stroke);
    } else if (params.kind === "oval") {
      shape = createOvalShape(params.x1, params.y1, params.x2, params.y2, fill, stroke);
    } else {
      // line — requires stroke
      const lineStroke = stroke ?? {
        type: "solid" as const,
        color: { r: 0, g: 0, b: 0, a: 255 },
        width: params.strokeWidth ?? 1,
        caps: "round" as const,
        joints: "round" as const,
        miterLimit: 3,
      };
      shape = createLineShape(params.x1, params.y1, params.x2, params.y2, lineStroke);
    }

    const obj: ShapeDisplayObject = {
      type: "shape",
      id: nextAgentObjId("shape"),
      shape,
      x: 0,
      y: 0,
    };

    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) =>
      addDisplayObject(t, layerId, frameIndex, obj)
    );
    cb.pushDoc(newDoc);
    return { id: obj.id, rev: _rev };
  },

  stage_add_text(params: {
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    textType?: "static" | "dynamic" | "input";
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    align?: "left" | "center" | "right" | "justify";
    layerId?: string;
    frameIndex?: number;
  }): StageAddShapeResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);

    const colorVal: Color = params.color ? parseHexColor(params.color) : { r: 0, g: 0, b: 0, a: 255 };

    const obj: TextDisplayObject = {
      type: "text",
      id: nextAgentObjId("text"),
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height,
      text: params.text,
      textType: params.textType ?? "static",
      fontFamily: params.fontFamily ?? "Arial",
      fontSize: params.fontSize ?? 12,
      bold: params.bold ?? false,
      italic: params.italic ?? false,
      color: colorVal,
      align: params.align ?? "left",
      multiline: false,
      wordWrap: false,
    };

    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) =>
      addDisplayObject(t, layerId, frameIndex, obj)
    );
    cb.pushDoc(newDoc);
    return { id: obj.id, rev: _rev };
  },

  stage_place_instance(params: {
    symbolId: string;
    x: number;
    y: number;
    name?: string;
    layerId?: string;
    frameIndex?: number;
  }): StagePlaceInstanceResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();

    // Validate symbolId
    const sym = doc.library.items.find((i) => i.id === params.symbolId);
    if (!sym) {
      const known = doc.library.items
        .filter((i) => i.itemType === "symbol")
        .map((i) => i.id)
        .join(", ");
      throw new Error(
        `Unknown symbolId "${params.symbolId}". Known symbols: ${known || "(none)"}`
      );
    }

    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);

    const obj: SymbolInstance = {
      type: "instance",
      id: nextAgentObjId("inst"),
      symbolId: params.symbolId,
      x: params.x,
      y: params.y,
      instanceName: params.name,
    };

    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) =>
      addDisplayObject(t, layerId, frameIndex, obj)
    );
    cb.pushDoc(newDoc);
    return { id: obj.id, rev: _rev };
  },

  stage_update(params: {
    id: string;
    layerId?: string;
    frameIndex?: number;
    updates: Record<string, unknown>;
  }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) =>
      updateDisplayObject(t, layerId, frameIndex, params.id, params.updates as Parameters<typeof updateDisplayObject>[4])
    );
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  stage_remove(params: {
    ids: string[];
    layerId?: string;
    frameIndex?: number;
  }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();

    let currentTimeline = doc.scenes[Math.min(sceneIndex, doc.scenes.length - 1)].timeline;
    for (const id of params.ids) {
      currentTimeline = removeDisplayObject(currentTimeline, layerId, frameIndex, id);
    }
    const newDoc = withSceneTimeline(doc, sceneIndex, () => currentTimeline);
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  stage_arrange(params: {
    ids: string[];
    op: "front" | "back" | "forward" | "backward";
    layerId?: string;
    frameIndex?: number;
  }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();

    // Re-order display objects in-frame
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) => {
      return {
        ...t,
        layers: t.layers.map((layer) => {
          if (layer.id !== layerId) return layer;
          const kf = [...layer.frames]
            .filter((f) => f.isKeyframe && f.index <= frameIndex)
            .sort((a, b) => b.index - a.index)[0];
          if (!kf) return layer;

          const newFrames = layer.frames.map((f) => {
            if (f.index !== kf.index) return f;
            let objs = [...f.displayObjects];
            for (const id of params.ids) {
              const idx = objs.findIndex((o) => o.id === id);
              if (idx < 0) continue;
              const [item] = objs.splice(idx, 1);
              if (params.op === "front") {
                objs.push(item);
              } else if (params.op === "back") {
                objs.unshift(item);
              } else if (params.op === "forward") {
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
        }),
      };
    });
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  stage_group(params: {
    ids: string[];
    layerId?: string;
    frameIndex?: number;
  }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();

    const newDoc = withSceneTimeline(doc, sceneIndex, (t) => {
      return {
        ...t,
        layers: t.layers.map((layer) => {
          if (layer.id !== layerId) return layer;
          const kf = [...layer.frames]
            .filter((f) => f.isKeyframe && f.index <= frameIndex)
            .sort((a, b) => b.index - a.index)[0];
          if (!kf) return layer;

          const newFrames = layer.frames.map((f) => {
            if (f.index !== kf.index) return f;
            const toGroup = f.displayObjects.filter((o) => params.ids.includes(o.id));
            if (toGroup.length < 2) return f; // need at least 2 objects to group
            const remaining = f.displayObjects.filter((o) => !params.ids.includes(o.id));

            // Compute bounding box for group origin
            const xs = toGroup.map((o) => ("x" in o ? (o as { x: number }).x : 0));
            const ys = toGroup.map((o) => ("y" in o ? (o as { y: number }).y : 0));
            const groupX = Math.min(...xs);
            const groupY = Math.min(...ys);

            // Make children relative to group origin
            const children = toGroup.map((o) => {
              if ("x" in o && "y" in o) {
                return { ...o, x: (o as { x: number }).x - groupX, y: (o as { y: number }).y - groupY };
              }
              return o;
            });

            const group: GroupObject = {
              id: nextAgentObjId("group"),
              type: "group",
              x: groupX,
              y: groupY,
              children,
            };
            return { ...f, displayObjects: [...remaining, group] };
          });
          return { ...layer, frames: newFrames };
        }),
      };
    });
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  stage_ungroup(params: {
    id: string;
    layerId?: string;
    frameIndex?: number;
  }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();

    const newDoc = withSceneTimeline(doc, sceneIndex, (t) => {
      return {
        ...t,
        layers: t.layers.map((layer) => {
          if (layer.id !== layerId) return layer;
          const kf = [...layer.frames]
            .filter((f) => f.isKeyframe && f.index <= frameIndex)
            .sort((a, b) => b.index - a.index)[0];
          if (!kf) return layer;

          const newFrames = layer.frames.map((f) => {
            if (f.index !== kf.index) return f;
            const groupObj = f.displayObjects.find(
              (o) => o.id === params.id && o.type === "group"
            ) as GroupObject | undefined;
            if (!groupObj) return f;

            // Lift children, translating back to stage coordinates
            const lifted = groupObj.children.map((c) => {
              if ("x" in c && "y" in c) {
                return {
                  ...c,
                  x: (c as { x: number }).x + groupObj.x,
                  y: (c as { y: number }).y + groupObj.y,
                };
              }
              return c;
            });
            const withoutGroup = f.displayObjects.filter((o) => o.id !== params.id);
            return { ...f, displayObjects: [...withoutGroup, ...lifted] };
          });
          return { ...layer, frames: newFrames };
        }),
      };
    });
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  selection_get(): SelectionGetResult {
    const cb = requireCallbacks();
    const ids = cb.getSelectedIds();
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const frameIndex = cb.getCurrentFrame();
    const scene = doc.scenes[Math.min(sceneIndex, doc.scenes.length - 1)];
    const layerIdx = cb.getActiveLayerIndex();
    const layer = scene?.timeline.layers[layerIdx];
    let objects: DisplayObject[] = [];
    if (layer) {
      const kf = getGoverningKeyframe(layer, frameIndex);
      if (kf) {
        objects = kf.displayObjects.filter((o) => ids.includes(o.id)) as DisplayObject[];
      }
    }
    return { ids, objects };
  },

  selection_set(params: { ids?: string[]; all?: boolean }): { ok: true } {
    const cb = requireCallbacks();
    if (params.all) {
      // Collect all object ids in the current frame/layer
      const doc = cb.getDoc();
      const sceneIndex = cb.getActiveSceneIndex();
      const scene = doc.scenes[Math.min(sceneIndex, doc.scenes.length - 1)];
      const frameIndex = cb.getCurrentFrame();
      const allIds: string[] = [];
      for (const layer of scene.timeline.layers) {
        const kf = getGoverningKeyframe(layer, frameIndex);
        if (kf) {
          for (const obj of kf.displayObjects) allIds.push(obj.id);
        }
      }
      cb.setSelectedIds(allIds);
    } else {
      cb.setSelectedIds(params.ids ?? []);
    }
    return { ok: true };
  },

  view_set(params: {
    zoom?: number;
    panX?: number;
    panY?: number;
    currentFrame?: number;
    activeLayerId?: string;
  }): { ok: true } {
    const cb = requireCallbacks();
    if (params.zoom !== undefined) cb.setZoom(params.zoom);
    if (params.panX !== undefined || params.panY !== undefined) {
      cb.setPan(params.panX ?? 0, params.panY ?? 0);
    }
    if (params.currentFrame !== undefined) cb.setCurrentFrame(params.currentFrame);
    if (params.activeLayerId !== undefined) cb.setActiveLayerById(params.activeLayerId);
    return { ok: true };
  },

  tool_select(params: { toolId: string }): { ok: true } {
    const cb = requireCallbacks();
    const validTools = [
      "selection", "subselection", "freeTranform", "lasso", "pen", "text",
      "line", "rectangle", "oval", "polystar", "pencil", "brush", "inkBucket",
      "paintBucket", "eyedropper", "eraser", "hand", "zoom",
    ];
    if (!validTools.includes(params.toolId)) {
      throw new Error(
        `Unknown toolId "${params.toolId}". Valid tools: ${validTools.join(", ")}`
      );
    }
    cb.selectTool(params.toolId);
    return { ok: true };
  },

  // =========================================================================
  // Timeline
  // =========================================================================

  timeline_add_layer(params: {
    name?: string;
    type?: LayerType;
  }): TimelineAddLayerResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    // Capture the before state to find the new layer id
    const before = doc.scenes[Math.min(sceneIndex, doc.scenes.length - 1)].timeline.layers;

    const newDoc = withSceneTimeline(doc, sceneIndex, (t) => {
      const updated = addLayer(t, params.name);
      if (params.type && params.type !== "normal") {
        // setLayerType on the newly added layer (first, since addLayer prepends)
        const newLayerId = updated.layers[0].id;
        return setLayerType(updated, newLayerId, params.type);
      }
      return updated;
    });
    cb.pushDoc(newDoc);

    const after = newDoc.scenes[Math.min(sceneIndex, newDoc.scenes.length - 1)].timeline.layers;
    // The new layer is the one present in after but not in before (by id)
    const beforeIds = new Set(before.map((l) => l.id));
    const newLayer = after.find((l) => !beforeIds.has(l.id));
    return { layerId: newLayer?.id ?? after[0].id, rev: _rev };
  },

  timeline_remove_layer(params: { layerId: string }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) =>
      deleteLayer(t, layerId)
    );
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  timeline_update_layer(params: {
    layerId: string;
    name?: string;
    locked?: boolean;
    visible?: boolean;
    type?: LayerType;
  }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) => {
      let updated = t;
      if (params.name !== undefined) updated = renameLayer(updated, layerId, params.name);
      if (params.locked !== undefined) updated = setLayerLocked(updated, layerId, params.locked);
      if (params.visible !== undefined) updated = setLayerVisible(updated, layerId, params.visible);
      if (params.type !== undefined) updated = setLayerType(updated, layerId, params.type);
      return updated;
    });
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  timeline_insert_frame(params: { layerId: string; frameIndex: number }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) =>
      insertFrame(t, layerId, params.frameIndex)
    );
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  timeline_insert_keyframe(params: { layerId: string; frameIndex: number }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) =>
      insertKeyframe(t, layerId, params.frameIndex)
    );
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  timeline_insert_blank_keyframe(params: { layerId: string; frameIndex: number }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) =>
      insertBlankKeyframe(t, layerId, params.frameIndex)
    );
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  timeline_remove_frame(params: { layerId: string; frameIndex: number }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) =>
      removeFrame(t, layerId, params.frameIndex)
    );
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  timeline_set_frame_label(params: {
    layerId: string;
    frameIndex: number;
    label: string;
    labelType?: "name" | "comment" | "anchor";
  }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) => {
      const updated = setFrameLabel(t, layerId, params.frameIndex, params.label);
      // If labelType also provided, update it
      if (params.labelType !== undefined) {
        const labelType = params.labelType;
        return {
          ...updated,
          layers: updated.layers.map((layer) => {
            if (layer.id !== layerId) return layer;
            return {
              ...layer,
              frames: layer.frames.map((f) =>
                f.index === params.frameIndex ? { ...f, labelType } : f
              ),
            };
          }),
        };
      }
      return updated;
    });
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  timeline_set_tween(params: {
    layerId: string;
    frameIndex: number;
    kind: "motion" | "shape" | null;
    props?: Record<string, unknown>;
  }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) => {
      if (params.kind === null) {
        return clearTween(t, layerId, params.frameIndex);
      } else if (params.kind === "motion") {
        const ease = typeof params.props?.ease === "number" ? params.props.ease : undefined;
        return setMotionTween(t, layerId, params.frameIndex, ease);
      } else {
        const ease = typeof params.props?.ease === "number" ? params.props.ease : undefined;
        const blend = params.props?.blend === "angular" ? "angular" as const : "distributive" as const;
        return setShapeTween(t, layerId, params.frameIndex, { ease, blend });
      }
    });
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  timeline_goto_frame(params: { frameIndex: number }): { ok: true } {
    const cb = requireCallbacks();
    cb.setCurrentFrame(params.frameIndex);
    return { ok: true };
  },

  playback_play(): { ok: true } {
    const cb = requireCallbacks();
    cb.startPlayback();
    return { ok: true };
  },

  playback_stop(): { ok: true } {
    const cb = requireCallbacks();
    cb.stopPlayback();
    return { ok: true };
  },

  // =========================================================================
  // Code (AS2)
  // =========================================================================

  script_get(params: { layerId: string; frameIndex: number }): ScriptGetResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const scene = doc.scenes[Math.min(sceneIndex, doc.scenes.length - 1)];
    const layer = scene.timeline.layers.find((l) => l.id === params.layerId);
    if (!layer) {
      const known = scene.timeline.layers.map((l) => l.id).join(", ");
      throw new Error(
        `Unknown layerId "${params.layerId}". Known: ${known}`
      );
    }
    const kf = getGoverningKeyframe(layer, params.frameIndex);
    return {
      script: kf?.script ?? "",
      layerId: params.layerId,
      frameIndex: kf?.index ?? params.frameIndex,
      rev: _rev,
    };
  },

  script_set(params: { layerId: string; frameIndex: number; script: string }): ScriptSetResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const newDoc = withSceneTimeline(doc, sceneIndex, (t) =>
      setFrameScript(t, layerId, params.frameIndex, params.script)
    );
    cb.pushDoc(newDoc);

    // Compile check (non-blocking)
    const diagnostics = compileCheckScript(params.script);
    return { ok: true, rev: _rev, diagnostics };
  },

  script_check(params: { script: string }): ScriptCheckResult {
    return { diagnostics: compileCheckScript(params.script) };
  },

  script_list(): ScriptListResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const items: ScriptListResult["scripts"] = [];

    doc.scenes.forEach((scene, sceneIndex) => {
      scene.timeline.layers.forEach((layer) => {
        layer.frames
          .filter((f) => f.isKeyframe && f.script && f.script.trim())
          .forEach((f) => {
            const preview = f.script.split("\n")[0].slice(0, 80);
            items.push({
              sceneIndex,
              layerId: layer.id,
              layerName: layer.name,
              frameIndex: f.index,
              preview,
            });
          });
      });
    });

    return { scripts: items, rev: _rev };
  },

  // =========================================================================
  // Library
  // =========================================================================

  library_list(): LibraryListResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const items = doc.library.items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.itemType,
      folder: undefined,
    }));
    return { items, rev: _rev };
  },

  library_create_symbol(params: { name: string; symbolType: SymbolType }): LibraryCreateSymbolResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const { library, item } = createSymbolInLibrary(doc.library, params.name, params.symbolType);
    cb.pushDoc({ ...doc, library });
    return { symbolId: item.id, rev: _rev };
  },

  library_convert_to_symbol(params: {
    ids: string[];
    name: string;
    symbolType: SymbolType;
    layerId?: string;
    frameIndex?: number;
  }): LibraryConvertToSymbolResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const scene = doc.scenes[Math.min(sceneIndex, doc.scenes.length - 1)];
    const layer = scene.timeline.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Unknown layerId "${layerId}"`);

    const kf = getGoverningKeyframe(layer, frameIndex);
    if (!kf) throw new Error(`No keyframe found at or before frame ${frameIndex}`);

    const toConvert = kf.displayObjects.filter((o) => params.ids.includes(o.id));
    if (toConvert.length === 0) {
      throw new Error(`No objects found with ids: ${params.ids.join(", ")}`);
    }

    // Compute bounding box
    const xs = toConvert.map((o) => ("x" in o ? (o as { x: number }).x : 0));
    const ys = toConvert.map((o) => ("y" in o ? (o as { y: number }).y : 0));
    const originX = Math.min(...xs);
    const originY = Math.min(...ys);

    // Create symbol with the objects in its timeline
    const { library: newLib, item: sym } = createSymbolInLibrary(
      doc.library,
      params.name,
      params.symbolType
    );

    // Replace objects in frame with a single symbol instance
    const instance: SymbolInstance = {
      type: "instance",
      id: nextAgentObjId("inst"),
      symbolId: sym.id,
      x: originX,
      y: originY,
    };

    const newDoc = withSceneTimeline(
      { ...doc, library: newLib },
      sceneIndex,
      (t) => {
        return {
          ...t,
          layers: t.layers.map((l) => {
            if (l.id !== layerId) return l;
            const newFrames = l.frames.map((f) => {
              if (f.index !== kf.index) return f;
              const kept = f.displayObjects.filter((o) => !params.ids.includes(o.id));
              return { ...f, displayObjects: [...kept, instance] };
            });
            return { ...l, frames: newFrames };
          }),
        };
      }
    );
    cb.pushDoc(newDoc);
    return { symbolId: sym.id, instanceId: instance.id, rev: _rev };
  },

  library_rename(params: { itemId: string; name: string }): OkRevResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const item = doc.library.items.find((i) => i.id === params.itemId);
    if (!item) {
      const known = doc.library.items.map((i) => i.id).join(", ");
      throw new Error(
        `Unknown itemId "${params.itemId}". Known: ${known || "(none)"}`
      );
    }
    // Inline the rename rather than calling renameLibraryItem() directly, because
    // the @flash/core dist may have a stale export that overrides the model version.
    const newLibrary = {
      ...doc.library,
      items: doc.library.items.map((i) =>
        i.id === params.itemId ? { ...i, name: params.name } : i
      ),
    };
    cb.pushDoc({ ...doc, library: newLibrary });
    return { ok: true, rev: _rev };
  },

  library_remove(params: { itemId: string }): OkRevResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const item = doc.library.items.find((i) => i.id === params.itemId);
    if (!item) {
      const known = doc.library.items.map((i) => i.id).join(", ");
      throw new Error(
        `Unknown itemId "${params.itemId}". Known: ${known || "(none)"}`
      );
    }
    const newLibrary = removeLibraryItem(doc.library, params.itemId);
    cb.pushDoc({ ...doc, library: newLibrary });
    return { ok: true, rev: _rev };
  },

  // =========================================================================
  // Output & escape hatches
  // =========================================================================

  jsfl_run(params: { source: string }): JsflRunResult {
    const cb = requireCallbacks();
    const result = cb.runJSFL(params.source);
    return { ...result, rev: _rev };
  },

  stage_screenshot(params: { frameIndex?: number }): {
    pngBase64: string;
    width: number;
    height: number;
  } {
    const cb = requireCallbacks();
    const doc = cb.getDoc();

    // If a specific frame is requested, navigate to it
    if (params.frameIndex !== undefined) {
      cb.setCurrentFrame(params.frameIndex);
    }

    const pngBase64 = cb.screenshotStage(params.frameIndex);
    return {
      pngBase64,
      width: doc.properties.width,
      height: doc.properties.height,
    };
  },

  publish_swf(): PublishSwfResult {
    const cb = requireCallbacks();
    const bytes = cb.publishToBytes();
    // Convert to base64
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const swfBase64 = btoa(binary);
    return { swfBase64, byteLength: bytes.length };
  },

  file_save_fla(): FileSaveFlaResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const bytes = saveFla(doc);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const flaBase64 = btoa(binary);
    return { flaBase64, byteLength: bytes.length };
  },

  file_load_fla(params: { flaBase64: string }): OkRevResult {
    const cb = requireCallbacks();
    // Decode base64 to bytes
    const binary = atob(params.flaBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const doc = loadFla(bytes);
    cb.pushDoc(doc);
    return { ok: true, rev: _rev };
  },
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatchAgentCommand(
  command: string,
  params: Record<string, unknown>
): Promise<unknown> {
  if (!(command in handlers)) {
    const known = Object.keys(handlers).join(", ");
    throw new Error(
      `Unknown agent command "${command}". Known commands: ${known}`
    );
  }
  const handler = handlers[command];
  return handler(params);
}
