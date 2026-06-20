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
  ClassListResult,
  ClassGetResult,
  ClassSetResult,
  ClassRemoveResult,
  ClassCheckResult,
  LibraryListResult,
  LibraryCreateSymbolResult,
  LibraryConvertToSymbolResult,
  LibraryImportBitmapResult,
  LibraryImportSoundResult,
  LibrarySetLinkageResult,
  JsflRunResult,
  PublishSwfResult,
  FileSaveFlaResult,
  SceneAddResult,
  SceneDuplicateResult,
  TimelineCopyFramesResult,
  TimelinePasteFramesResult,
  FilterAddResult,
  FilterRemoveResult,
  FilterListResult,
  StageMoveSelectionResult,
  SceneReorderResult,
  StageFindInstancesResult,
  LibraryUseCountResult,
  StageGetBoundsResult,
  StageDuplicateResult,
  StageSetInstanceNameResult,
} from "@flash/agent-protocol";
import type { FlashDocument, LayerType, SymbolType, FlashFilter, Symbol as SymbolItem } from "@flash/core";
import type { FrameClipboard } from "@flash/core";
import {
  hexToColor,
  createRectShape,
  createOvalShape,
  createLineShape,
  transformedShapeBounds,
  getUnionBounds,
  getTransformedBounds,
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
  setSoundOnFrame,
  setMotionTween,
  updateMotionTweenProps,
  setShapeTween,
  clearTween,
  setFrameScript,
  addDisplayObject,
  removeDisplayObject,
  updateDisplayObject,
  validateInstanceName,
  createSymbolInLibrary,
  createBitmap,
  createSound,
  addLibraryItem,
  removeLibraryItem,
  setSymbolLinkage,
  saveFla,
  loadFla,
  getGoverningKeyframe,
  compileAS2,
  parse as parseAS2,
  addAsClass,
  updateAsClass,
  removeAsClass,
  addScene,
  removeScene,
  renameScene,
  reorderScenes,
  duplicateScene,
  copyFramesDoc,
  pasteFramesDoc,
  defaultDropShadow,
  defaultBlur,
  defaultGlow,
  defaultBevel,
  defaultGradientGlow,
  defaultGradientBevel,
  defaultAdjustColor,
} from "@flash/core";
import type {
  DisplayObject,
  ShapeDisplayObject,
  TextDisplayObject,
  SymbolInstance,
  VideoDisplayObject,
  BitmapDisplayObject,
  GroupObject,
  Color,
  ColorEffect,
  Fill,
  SolidStroke,
  SoundLinkage,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Rev counter + change notification hook
// ---------------------------------------------------------------------------

let _rev: Rev = 0;

/** Callback invoked after every bumpRev(). Wired by bridge.ts to send
 *  notifications to the Vite plugin over the /__agent WebSocket. */
let _onDocChanged: ((rev: Rev) => void) | null = null;

/** Register a callback to be called whenever the document changes.
 *  Called by bridge.ts after the WebSocket is established. */
export function setDocChangedCallback(fn: ((rev: Rev) => void) | null): void {
  _onDocChanged = fn;
}

/** Called by the Shell after every pushDoc(). Bumps the rev counter
 *  and fires the doc-changed notification callback. */
export function bumpRev(): void {
  _rev++;
  try {
    _onDocChanged?.(_rev);
  } catch {
    // notification errors must not propagate into the caller
  }
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
  setActiveSceneIndex: (index: number) => void;

  // Escape hatches
  runJSFL: (source: string) => JsflRunResult;
  screenshotStage: (frameIndex?: number) => string; // returns base64 PNG
  publishToBytes: () => Promise<Uint8Array>;
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

/**
 * Return the symbol currently being edited in-place, or null when in document
 * (scene) mode. Centralises the edit-context check so callers don't need to
 * reach into `getEditContext()` directly.
 */
function getEditingSymbol(cb: AgentCallbacks): SymbolItem | null {
  const ctx = cb.getEditContext();
  if (ctx.mode !== "symbol" || !ctx.symbolId) return null;
  const doc = cb.getDoc();
  const item = doc.library.items.find((i) => i.id === ctx.symbolId && i.itemType === "symbol");
  return (item as SymbolItem | undefined) ?? null;
}

/**
 * Return the currently active timeline.
 * When the editor is in symbol-edit mode this is the symbol's own timeline,
 * not the scene timeline — matching the JSFL `fl.getDocumentDOM().getTimeline()`
 * behaviour that the structured tools are meant to mirror.
 */
function getActiveTimeline(cb: AgentCallbacks) {
  const sym = getEditingSymbol(cb);
  if (sym) return sym.timeline;
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

/** Gradient stop descriptor as supplied by the MCP/agent boundary. */
interface GradientFillParam {
  type: "linear" | "radial";
  stops: Array<{
    color: string;
    alpha?: number;
    ratio: number; // 0.0–1.0 at boundary; converted to 0–255 internally
  }>;
  angle?: number;
  focalPoint?: number;
  spreadMode?: "extend" | "reflect" | "repeat";
}

/** Bitmap fill descriptor as supplied by the MCP/agent boundary. */
interface BitmapFillParam {
  type: "bitmap";
  /** Library item id of the BitmapItem to use. */
  bitmapId: string;
  /** Whether the bitmap tiles. Default true. */
  repeat?: boolean;
  /** Whether to use smoothed (bilinear) sampling. Default false. */
  smooth?: boolean;
  /** Optional fill transform matrix in pixel space. */
  matrix?: {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
  };
}

/** Build a Fill from an optional hex string, gradient descriptor, or bitmap descriptor. */
function buildFill(fill?: string | GradientFillParam | BitmapFillParam): Fill | null {
  if (!fill) return null;
  if (typeof fill === "string") {
    return { type: "solid", color: parseHexColor(fill) };
  }
  if (fill.type === "bitmap") {
    return {
      type: "bitmap",
      bitmapId: fill.bitmapId,
      repeat: fill.repeat ?? true,
      smooth: fill.smooth ?? false,
      ...(fill.matrix !== undefined && { matrix: fill.matrix }),
    };
  }
  // Gradient fill — convert 0–1 ratios to 0–255 SWF ratios
  const stops = fill.stops.map((s) => ({
    ratio: Math.round(s.ratio * 255),
    color: { ...parseHexColor(s.color), a: Math.round((s.alpha ?? 1) * 255) },
  }));
  if (fill.type === "linear") {
    return {
      type: "linear-gradient" as const,
      stops,
      angle: fill.angle ?? 0,
      ...(fill.spreadMode !== undefined && { spreadMode: fill.spreadMode }),
    };
  } else {
    return {
      type: "radial-gradient" as const,
      stops,
      focalPoint: fill.focalPoint ?? 0,
      ...(fill.spreadMode !== undefined && { spreadMode: fill.spreadMode }),
    };
  }
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

/**
 * Produce a new document by updating whichever timeline is currently active.
 *
 * When the editor is in symbol-edit mode the symbol's own timeline is updated;
 * otherwise the active scene's timeline is updated. This is the mutation
 * counterpart of `getActiveTimeline`.
 */
function withActiveTimeline(
  cb: AgentCallbacks,
  doc: FlashDocument,
  updater: (t: import("@flash/core").Timeline) => import("@flash/core").Timeline
): FlashDocument {
  const sym = getEditingSymbol(cb);
  if (sym) {
    const newTimeline = updater(sym.timeline);
    const newItems = doc.library.items.map((item) =>
      item.id === sym.id ? { ...item, timeline: newTimeline } : item
    );
    return { ...doc, library: { ...doc.library, items: newItems } };
  }
  const sceneIndex = Math.min(cb.getActiveSceneIndex(), doc.scenes.length - 1);
  return withSceneTimeline(doc, sceneIndex, updater);
}

/** Frame clipboard for timeline_copy_frames / timeline_paste_frames. */
let _frameClipboard: FrameClipboard | null = null;

/** Generate a simple id for display objects created by agent commands. */
let _agentObjCounter = 0;
function nextAgentObjId(prefix = "agent-obj"): string {
  return `${prefix}-${++_agentObjCounter}-${Date.now().toString(36)}`;
}

/**
 * Compute the natural (unscaled) width and height of a library symbol from
 * the union bounds of all display objects in its first keyframe.
 * Returns { naturalWidth: 0, naturalHeight: 0 } when the symbol has no geometry.
 */
function computeSymbolNaturalSize(
  sym: { timeline: { layers: readonly { frames: readonly { displayObjects: readonly DisplayObject[] }[] }[] } }
): { naturalWidth: number; naturalHeight: number } {
  const objects: DisplayObject[] = [];
  for (const layer of sym.timeline.layers) {
    if (layer.frames.length > 0) {
      for (const obj of layer.frames[0].displayObjects) {
        objects.push(obj);
      }
    }
  }
  const bounds = getUnionBounds(objects);
  if (!bounds) return { naturalWidth: 0, naturalHeight: 0 };
  return { naturalWidth: bounds.width, naturalHeight: bounds.height };
}

/**
 * Compute the true visual top-left (minimum x/y in stage space) of a display
 * object. For shapes/drawing-objects the geometry can be offset from the
 * object's (x,y) — `stage_add_shape` bakes absolute coordinates into the path
 * and leaves (x,y) at (0,0) — so we must account for the shape's own bounds,
 * not just the (x,y) translation. For everything else the visual origin is the
 * object's (x,y).
 *
 * Used by library_convert_to_symbol to derive the symbol's registration point
 * (top-left of the selection bounding box) so converted content can be
 * normalized into symbol-local coordinates.
 */
function visualTopLeft(o: DisplayObject): { x: number; y: number } {
  if (o.type === "shape" || o.type === "drawing-object") {
    const b = transformedShapeBounds(o as ShapeDisplayObject);
    return { x: b.x, y: b.y };
  }
  const x = "x" in o ? (o as { x: number }).x : 0;
  const y = "y" in o ? (o as { y: number }).y : 0;
  return { x, y };
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

/**
 * Parse-only diagnostics for AS2 class source. Unlike `compileCheckScript`,
 * this does NOT run the AVM1 bytecode compiler — external class files declare
 * `class`/`interface` constructs that the frame-script compiler does not emit,
 * so we surface only the parser's syntax diagnostics (the AS2 parser handles
 * full class declarations). An empty source is valid (no diagnostics).
 */
function parseCheckClass(source: string): DiagnosticItem[] {
  if (!source.trim()) return [];
  try {
    parseAS2(source);
    return [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lineMatch = /line (\d+)/i.exec(msg);
    const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
    return [{ message: msg, line, severity: "error" }];
  }
}

/**
 * Derive a fully-qualified AS2 class name for a `.as` file. Prefers the
 * declared `class`/`interface` name (with `dynamic`/`intrinsic` modifiers and
 * any leading package path handled by the parser's declared name), falling back
 * to the dotted path with the `.as` extension stripped (e.g.
 * `com/example/Foo.as` -> `com.example.Foo`).
 */
function deriveClassName(path: string, source: string): string {
  const declMatch =
    /\b(?:class|interface)\s+([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)/.exec(
      source
    );
  if (declMatch) return declMatch[1].replace(/\s+/g, "");
  return path.replace(/\.as$/i, "").replace(/\//g, ".");
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
    // Use the active timeline (symbol or scene) for layer/frame counts so the
    // reported state matches what the other structured tools actually operate on.
    const timeline = getActiveTimeline(cb);
    const frameCount = timeline.layers.reduce((max, l) => Math.max(max, l.frameCount), 0);
    const layerCount = timeline.layers.length;
    const activeLayerIdx = cb.getActiveLayerIndex();
    const activeLayer = timeline.layers[activeLayerIdx];

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
    fill?: string | GradientFillParam | BitmapFillParam;
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
    const newDoc = withActiveTimeline(cb, doc, (t) =>
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
    multiline?: boolean;
    wordWrap?: boolean;
    instanceName?: string;
    password?: boolean;
    maxChars?: number;
    hasBorder?: boolean;
    html?: boolean;
    autoSize?: boolean;
    letterSpacing?: number;
    autoKern?: boolean;
    linkUrl?: string;
    linkTarget?: string;
    leading?: number;
    restrict?: string;
    /** Named glyph ranges to embed (font subsetting). Omit for embed-all (default). */
    embedRanges?: ("all" | "uppercase" | "lowercase" | "numerals" | "punctuation")[];
    /** Specific characters to embed; combined with embedRanges + the field text. */
    embedChars?: string;
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
      multiline: params.multiline ?? false,
      wordWrap: params.wordWrap ?? false,
      ...(params.instanceName !== undefined && { instanceName: params.instanceName }),
      ...(params.password !== undefined && { password: params.password }),
      ...(params.maxChars !== undefined && { maxChars: params.maxChars }),
      ...(params.hasBorder !== undefined && { hasBorder: params.hasBorder }),
      ...(params.html !== undefined && { html: params.html }),
      ...(params.autoSize !== undefined && { autoSize: params.autoSize }),
      ...(params.letterSpacing !== undefined && { letterSpacing: params.letterSpacing }),
      ...(params.autoKern !== undefined && { autoKern: params.autoKern }),
      ...(params.linkUrl !== undefined && { linkUrl: params.linkUrl }),
      ...(params.linkTarget !== undefined && { linkTarget: params.linkTarget }),
      ...(params.leading !== undefined && { leading: params.leading }),
      ...(params.restrict !== undefined && { restrict: params.restrict }),
      ...(params.embedRanges !== undefined && { embedRanges: params.embedRanges }),
      ...(params.embedChars !== undefined && { embedChars: params.embedChars }),
    };

    const doc = cb.getDoc();
    const newDoc = withActiveTimeline(cb, doc, (t) =>
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
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    blendMode?: string;
    colorEffect?: ColorEffect;
    loopMode?: string;
    firstFrame?: number;
  }): StagePlaceInstanceResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();

    // Validate symbolId
    const sym = doc.library.items.find((i) => i.id === params.symbolId);
    if (!sym || sym.itemType !== "symbol") {
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

    // Compute natural size from the symbol's first-frame union bounds
    const { naturalWidth, naturalHeight } = sym.itemType === "symbol"
      ? computeSymbolNaturalSize(sym as { timeline: { layers: readonly { frames: readonly { displayObjects: readonly DisplayObject[] }[] }[] } })
      : { naturalWidth: 0, naturalHeight: 0 };

    // Validate blendMode if provided
    const validBlendModes = [
      "normal", "layer", "multiply", "screen", "lighten", "darken",
      "difference", "add", "subtract", "invert", "alpha", "erase",
      "overlay", "hardlight",
    ] as const;
    type BlendModeName = typeof validBlendModes[number];
    let blendMode: BlendModeName | undefined;
    if (params.blendMode !== undefined) {
      if (!validBlendModes.includes(params.blendMode as BlendModeName)) {
        throw new Error(
          `Invalid blendMode "${params.blendMode}". Valid values: ${validBlendModes.join(", ")}`
        );
      }
      blendMode = params.blendMode as BlendModeName;
    }

    // Validate loopMode if provided
    const validLoopModes = ["loop", "play-once", "single-frame"] as const;
    type LoopModeName = typeof validLoopModes[number];
    let loopMode: LoopModeName | undefined;
    if (params.loopMode !== undefined) {
      // Accept both "playOnce"/"singleFrame" (legacy) and "play-once"/"single-frame"
      const normalized = params.loopMode === "playOnce" ? "play-once"
        : params.loopMode === "singleFrame" ? "single-frame"
        : params.loopMode;
      if (!validLoopModes.includes(normalized as LoopModeName)) {
        throw new Error(
          `Invalid loopMode "${params.loopMode}". Valid values: loop, play-once, single-frame`
        );
      }
      loopMode = normalized as LoopModeName;
    }

    const obj: SymbolInstance = {
      type: "instance",
      id: nextAgentObjId("inst"),
      symbolId: params.symbolId,
      x: params.x,
      y: params.y,
      instanceName: params.name,
      ...(naturalWidth > 0 ? { naturalWidth } : {}),
      ...(naturalHeight > 0 ? { naturalHeight } : {}),
      ...(params.scaleX !== undefined ? { scaleX: params.scaleX } : {}),
      ...(params.scaleY !== undefined ? { scaleY: params.scaleY } : {}),
      ...(params.rotation !== undefined ? { rotation: params.rotation } : {}),
      ...(blendMode !== undefined ? { blendMode } : {}),
      ...(params.colorEffect !== undefined ? { colorEffect: params.colorEffect } : {}),
      ...(loopMode !== undefined ? { loopMode } : {}),
      ...(params.firstFrame !== undefined ? { firstFrame: params.firstFrame } : {}),
    };

    const newDoc = withActiveTimeline(cb, doc, (t) =>
      addDisplayObject(t, layerId, frameIndex, obj)
    );
    cb.pushDoc(newDoc);
    return { id: obj.id, rev: _rev };
  },

  stage_add_video(params: {
    videoItemId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    layerId?: string;
    frameIndex?: number;
  }): StagePlaceInstanceResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();

    // Validate videoItemId references a VideoItem in the library.
    const item = doc.library.items.find((i) => i.id === params.videoItemId);
    if (!item || item.itemType !== "video") {
      const known = doc.library.items
        .filter((i) => i.itemType === "video")
        .map((i) => i.id)
        .join(", ");
      throw new Error(
        `Unknown videoItemId "${params.videoItemId}". Known videos: ${known || "(none)"}`
      );
    }

    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);

    const width = params.width ?? (item.width > 0 ? item.width : 320);
    const height = params.height ?? (item.height > 0 ? item.height : 240);

    const obj: VideoDisplayObject = {
      type: "video",
      id: nextAgentObjId("video"),
      videoItemId: params.videoItemId,
      x: params.x,
      y: params.y,
      width,
      height,
    };

    const newDoc = withActiveTimeline(cb, doc, (t) =>
      addDisplayObject(t, layerId, frameIndex, obj)
    );
    cb.pushDoc(newDoc);
    return { id: obj.id, rev: _rev };
  },

  stage_add_bitmap(params: {
    bitmapItemId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    layerId?: string;
    frameIndex?: number;
  }): StagePlaceInstanceResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();

    // Validate bitmapItemId references a BitmapItem in the library.
    const item = doc.library.items.find((i) => i.id === params.bitmapItemId);
    if (!item || item.itemType !== "bitmap") {
      const known = doc.library.items
        .filter((i) => i.itemType === "bitmap")
        .map((i) => i.id)
        .join(", ");
      throw new Error(
        `Unknown bitmapItemId "${params.bitmapItemId}". Known bitmaps: ${known || "(none)"}`
      );
    }

    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);

    const width = params.width ?? (item.originalWidth > 0 ? item.originalWidth : 100);
    const height = params.height ?? (item.originalHeight > 0 ? item.originalHeight : 100);

    const obj: BitmapDisplayObject = {
      type: "bitmap",
      id: nextAgentObjId("bmp"),
      libraryItemId: params.bitmapItemId,
      x: params.x,
      y: params.y,
      width,
      height,
    };

    const newDoc = withActiveTimeline(cb, doc, (t) =>
      addDisplayObject(t, layerId, frameIndex, obj)
    );
    cb.pushDoc(newDoc);
    return { id: obj.id, rev: _rev };
  },

  stage_update(params: {
    id: string;
    layerId?: string;
    frameIndex?: number;
    updates?: Record<string, unknown>;
    colorEffect?: ColorEffect;
    blendMode?: string;
    loopMode?: string;
    firstFrame?: number;
    cacheAsBitmap?: boolean;
    instanceName?: string;
  }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);
    const doc = cb.getDoc();
    // Merge top-level shorthand params into the updates object so callers can
    // pass colorEffect/blendMode/loopMode/firstFrame/cacheAsBitmap/instanceName
    // directly without nesting them under an `updates` key.
    const merged: Record<string, unknown> = { ...(params.updates ?? {}) };
    if (params.colorEffect !== undefined) merged.colorEffect = params.colorEffect;
    if (params.blendMode !== undefined) merged.blendMode = params.blendMode;
    if (params.loopMode !== undefined) merged.loopMode = params.loopMode;
    if (params.firstFrame !== undefined) merged.firstFrame = params.firstFrame;
    if (params.cacheAsBitmap !== undefined) merged.cacheAsBitmap = params.cacheAsBitmap;
    if (params.instanceName !== undefined) merged.instanceName = params.instanceName;
    // Validate an instance name from either the top-level param or the generic
    // updates bag, and normalize "" -> undefined (clears the name).
    if (typeof merged.instanceName === "string") {
      const validation = validateInstanceName(merged.instanceName);
      if (!validation.ok) throw new Error(validation.error);
      if (merged.instanceName === "") merged.instanceName = undefined;
    }
    const newDoc = withActiveTimeline(cb, doc, (t) =>
      updateDisplayObject(t, layerId, frameIndex, params.id, merged as Parameters<typeof updateDisplayObject>[4])
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

    let currentTimeline = getActiveTimeline(cb);
    for (const id of params.ids) {
      currentTimeline = removeDisplayObject(currentTimeline, layerId, frameIndex, id);
    }
    const newDoc = withActiveTimeline(cb, doc, () => currentTimeline);
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

    // Re-order display objects in-frame
    const newDoc = withActiveTimeline(cb, doc, (t) => {
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

    const newDoc = withActiveTimeline(cb, doc, (t) => {
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

    const newDoc = withActiveTimeline(cb, doc, (t) => {
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
    const frameIndex = cb.getCurrentFrame();
    const timeline = getActiveTimeline(cb);
    const layerIdx = cb.getActiveLayerIndex();
    const layer = timeline.layers[layerIdx];
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
      // Collect all object ids in the current frame across all layers of the active timeline
      const timeline = getActiveTimeline(cb);
      const frameIndex = cb.getCurrentFrame();
      const allIds: string[] = [];
      for (const layer of timeline.layers) {
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
      "selection", "subselection", "free-transform", "lasso", "pen", "text",
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
    // Capture the before state to find the new layer id
    const before = getActiveTimeline(cb).layers;

    const newDoc = withActiveTimeline(cb, doc, (t) => {
      const updated = addLayer(t, params.name);
      if (params.type && params.type !== "normal") {
        // setLayerType on the newly added layer (first, since addLayer prepends)
        const newLayerId = updated.layers[0].id;
        return setLayerType(updated, newLayerId, params.type);
      }
      return updated;
    });
    cb.pushDoc(newDoc);

    const after = getActiveTimeline(cb).layers;
    // The new layer is the one present in after but not in before (by id)
    const beforeIds = new Set(before.map((l) => l.id));
    const newLayer = after.find((l) => !beforeIds.has(l.id));
    return { layerId: newLayer?.id ?? after[0].id, rev: _rev };
  },

  timeline_remove_layer(params: { layerId: string }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const newDoc = withActiveTimeline(cb, doc, (t) =>
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
    const newDoc = withActiveTimeline(cb, doc, (t) => {
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
    const newDoc = withActiveTimeline(cb, doc, (t) =>
      insertFrame(t, layerId, params.frameIndex)
    );
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  timeline_insert_keyframe(params: { layerId: string; frameIndex: number }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const newDoc = withActiveTimeline(cb, doc, (t) =>
      insertKeyframe(t, layerId, params.frameIndex)
    );
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  timeline_insert_blank_keyframe(params: { layerId: string; frameIndex: number }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const newDoc = withActiveTimeline(cb, doc, (t) =>
      insertBlankKeyframe(t, layerId, params.frameIndex)
    );
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  timeline_remove_frame(params: { layerId: string; frameIndex: number }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const newDoc = withActiveTimeline(cb, doc, (t) =>
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
    const newDoc = withActiveTimeline(cb, doc, (t) => {
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

  timeline_set_sound(params: {
    layerId: string;
    frameIndex: number;
    libraryItemId: string | null;
    syncMode?: "event" | "start" | "stop" | "stream";
    repeatCount?: number;
  }): OkRevResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const newDoc = withActiveTimeline(cb, doc, (t) => {
      const layerIndex = t.layers.findIndex((l) => l.id === layerId);
      if (layerIndex === -1) throw new Error(`Layer "${layerId}" not found`);
      const sound: SoundLinkage | null =
        params.libraryItemId === null
          ? null
          : {
              libraryItemId: params.libraryItemId,
              syncMode: params.syncMode ?? "event",
              repeatCount: params.repeatCount ?? 1,
            };
      return setSoundOnFrame(t, layerIndex, params.frameIndex, sound);
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
    const newDoc = withActiveTimeline(cb, doc, (t) => {
      if (params.kind === null) {
        return clearTween(t, layerId, params.frameIndex);
      } else if (params.kind === "motion") {
        const ease = typeof params.props?.ease === "number" ? params.props.ease : undefined;
        let updated = setMotionTween(t, layerId, params.frameIndex, ease);
        // Map rotate/rotateCount/scale/orientToPath/sync props
        const rotate = params.props?.rotate;
        const rotateValues = ["none", "auto", "cw", "ccw"] as const;
        const motionRotate = rotateValues.includes(rotate as typeof rotateValues[number])
          ? (rotate as "none" | "auto" | "cw" | "ccw")
          : undefined;
        const motionRotateCount =
          typeof params.props?.rotateCount === "number" ? params.props.rotateCount : undefined;
        const motionScale =
          typeof params.props?.scale === "boolean" ? params.props.scale : undefined;
        const motionOrientToPath =
          typeof params.props?.orientToPath === "boolean" ? params.props.orientToPath : undefined;
        const motionSync =
          typeof params.props?.sync === "boolean" ? params.props.sync : undefined;
        if (
          motionRotate !== undefined ||
          motionRotateCount !== undefined ||
          motionScale !== undefined ||
          motionOrientToPath !== undefined ||
          motionSync !== undefined
        ) {
          updated = updateMotionTweenProps(updated, layerId, params.frameIndex, {
            motionRotate,
            motionRotateCount,
            motionScale,
            motionOrientToPath,
            motionSync,
          });
        }
        return updated;
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

  timeline_copy_frames(params: {
    startFrame?: number;
    endFrame?: number;
    layerIndex?: number;
  }): TimelineCopyFramesResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const start = params.startFrame !== undefined ? params.startFrame : cb.getCurrentFrame();
    const end = params.endFrame !== undefined ? params.endFrame : start;

    // Resolve layer ids: if layerIndex is specified, copy only that layer; otherwise all
    let layerIds: string[] = [];
    if (params.layerIndex !== undefined) {
      const timeline = getActiveTimeline(cb);
      const layer = timeline.layers[params.layerIndex];
      if (!layer) {
        throw new Error(
          `timeline_copy_frames: layerIndex ${params.layerIndex} out of bounds (layerCount=${timeline.layers.length})`
        );
      }
      layerIds = [layer.id];
    }

    _frameClipboard = copyFramesDoc(doc, sceneIndex, layerIds, start, end);
    return { success: true };
  },

  timeline_paste_frames(params: {
    frameIndex?: number;
    replaceFrames?: boolean;
  }): TimelinePasteFramesResult {
    const cb = requireCallbacks();
    if (!_frameClipboard) {
      throw new Error("timeline_paste_frames: no frames in clipboard — call timeline_copy_frames first");
    }
    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const atFrame = params.frameIndex !== undefined ? params.frameIndex : cb.getCurrentFrame();
    const newDoc = pasteFramesDoc(doc, sceneIndex, [], atFrame, _frameClipboard);
    cb.pushDoc(newDoc);
    return { success: true };
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
    const timeline = getActiveTimeline(cb);
    const layer = timeline.layers.find((l) => l.id === params.layerId);
    if (!layer) {
      const known = timeline.layers.map((l) => l.id).join(", ");
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
    const diagnostics = compileCheckScript(params.script);
    // Always save the script regardless of compile errors (Flash 8 parity: broken
    // scripts are written to disk; callers must inspect `diagnostics` for errors).
    const layerId = resolveLayerId(cb, params.layerId);
    const doc = cb.getDoc();
    const newDoc = withActiveTimeline(cb, doc, (t) =>
      setFrameScript(t, layerId, params.frameIndex, params.script)
    );
    cb.pushDoc(newDoc);
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
  // AS2 external classes (doc.asClasses VFS)
  // =========================================================================

  class_list(): ClassListResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const classes = (doc.asClasses ?? []).map((c) => ({
      path: c.path,
      className: deriveClassName(c.path, c.source),
    }));
    return { classes, rev: _rev };
  },

  class_get(params: { path: string }): ClassGetResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const file = (doc.asClasses ?? []).find((c) => c.path === params.path);
    if (!file) {
      const known = (doc.asClasses ?? []).map((c) => c.path).join(", ");
      throw new Error(
        `No AS2 class at path "${params.path}". Known: ${known || "(none)"}`
      );
    }
    return { path: file.path, source: file.source, rev: _rev };
  },

  class_set(params: { path: string; source: string }): ClassSetResult {
    const cb = requireCallbacks();
    // Parse-only validation (Flash 8 parity: the class is saved regardless of
    // parse errors; callers must inspect `diagnostics`).
    const diagnostics = parseCheckClass(params.source);
    const doc = cb.getDoc();
    const exists = (doc.asClasses ?? []).some((c) => c.path === params.path);
    // `addAsClass` is a safe upsert (replaces on matching path); use
    // `updateAsClass` when the path already exists so the intent is explicit.
    const newDoc = exists
      ? updateAsClass(doc, params.path, params.source)
      : addAsClass(doc, { path: params.path, source: params.source });
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev, diagnostics };
  },

  class_remove(params: { path: string }): ClassRemoveResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const exists = (doc.asClasses ?? []).some((c) => c.path === params.path);
    if (!exists) {
      const known = (doc.asClasses ?? []).map((c) => c.path).join(", ");
      throw new Error(
        `No AS2 class at path "${params.path}". Known: ${known || "(none)"}`
      );
    }
    cb.pushDoc(removeAsClass(doc, params.path));
    return { ok: true, rev: _rev };
  },

  class_check(params: { source: string }): ClassCheckResult {
    return { diagnostics: parseCheckClass(params.source) };
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
    const activeTimeline = getActiveTimeline(cb);
    const layer = activeTimeline.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Unknown layerId "${layerId}"`);

    const kf = getGoverningKeyframe(layer, frameIndex);
    if (!kf) throw new Error(`No keyframe found at or before frame ${frameIndex}`);

    const toConvert = kf.displayObjects.filter((o) => params.ids.includes(o.id));
    if (toConvert.length === 0) {
      throw new Error(`No objects found with ids: ${params.ids.join(", ")}`);
    }

    // Compute the selection's true visual bounding box. The symbol's
    // registration point is the top-left of this box. We must use the real
    // visual bounds (which account for shape geometry baked into the path, not
    // just the object's (x,y) translation) so the symbol-local normalization is
    // correct regardless of how each object stores its position.
    const tls = toConvert.map(visualTopLeft);
    const originX = Math.min(...tls.map((t) => t.x));
    const originY = Math.min(...tls.map((t) => t.y));

    // Create symbol and populate its first frame with the converted objects,
    // normalized to the symbol's local coordinate space (origin = top-left of selection).
    const { library: newLib, item: sym } = createSymbolInLibrary(
      doc.library,
      params.name,
      params.symbolType
    );

    // Normalize converted objects to symbol-local coordinates by shifting each
    // object's translation by the negative origin. Shape path geometry is left
    // untouched (it is already absolute relative to the object's x/y); the net
    // rendered position is preserved because the placed instance re-applies
    // (originX, originY). For shapes whose geometry is baked absolute with
    // (x,y)=(0,0), this drives x/y negative so the content's visual top-left
    // lands at symbol-local (0,0).
    const localObjects = toConvert.map((o) => {
      const ox = "x" in o ? (o as { x: number }).x : 0;
      const oy = "y" in o ? (o as { y: number }).y : 0;
      return { ...o, x: ox - originX, y: oy - originY };
    });

    // Inject the objects into the symbol's first frame
    const updatedSym = {
      ...sym,
      timeline: {
        layers: [{
          ...sym.timeline.layers[0],
          frames: [{
            ...sym.timeline.layers[0].frames[0],
            isEmpty: false,
            displayObjects: localObjects,
          }],
        }],
      },
    };
    const populatedLib = {
      ...newLib,
      items: newLib.items.map((item) => (item.id === sym.id ? updatedSym : item)),
    };

    // Compute the natural size from the normalized local objects
    const { naturalWidth, naturalHeight } = computeSymbolNaturalSize(updatedSym);

    // Replace objects in frame with a single symbol instance
    const instance: SymbolInstance = {
      type: "instance",
      id: nextAgentObjId("inst"),
      symbolId: sym.id,
      x: originX,
      y: originY,
      ...(naturalWidth > 0 ? { naturalWidth } : {}),
      ...(naturalHeight > 0 ? { naturalHeight } : {}),
    };

    const newDoc = withActiveTimeline(
      cb,
      { ...doc, library: populatedLib },
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

  library_set_linkage(params: {
    symbolId: string;
    linkageId?: string;
    className?: string;
    exportForActionScript?: boolean;
    exportInFirstFrame?: boolean;
  }): LibrarySetLinkageResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const item = doc.library.items.find((i) => i.id === params.symbolId);
    if (!item) {
      const known = doc.library.items.map((i) => i.id).join(", ");
      throw new Error(
        `Unknown symbolId "${params.symbolId}". Known: ${known || "(none)"}`
      );
    }
    if (item.itemType !== "symbol") {
      throw new Error(
        `Item "${params.symbolId}" is a ${item.itemType}, not a symbol. Only symbols have AS2 linkage.`
      );
    }
    const newLibrary = setSymbolLinkage(doc.library, params.symbolId, {
      linkageId: params.linkageId,
      className: params.className,
      exportForActionScript: params.exportForActionScript,
      exportInFirstFrame: params.exportInFirstFrame,
    });
    cb.pushDoc({ ...doc, library: newLibrary });
    return { ok: true, rev: _rev };
  },

  library_import_bitmap(params: {
    data: string;
    name?: string;
    mimeType?: string;
  }): LibraryImportBitmapResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    // Derive a default name from the mimeType or fall back to "Bitmap"
    const ext = params.mimeType
      ? params.mimeType.split("/")[1] ?? "png"
      : "png";
    const name = params.name ?? `Bitmap.${ext}`;
    // Build the data URI from base64 + mimeType
    const mimeType = params.mimeType ?? "image/png";
    const dataUri = `data:${mimeType};base64,${params.data}`;
    const item = createBitmap(name, { dataUri });
    const newLibrary = addLibraryItem(doc.library, item);
    cb.pushDoc({ ...doc, library: newLibrary });
    return { itemId: item.id, rev: _rev };
  },

  library_import_sound(params: {
    data: string;
    name: string;
    mimeType?: string;
  }): LibraryImportSoundResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    // Derive compressionType from mimeType: audio/mp3 or audio/mpeg → mp3, else raw
    const mimeType = params.mimeType ?? "audio/mp3";
    const compressionType: "mp3" | "adpcm" | "raw" | "speech" =
      mimeType.includes("mp3") || mimeType.includes("mpeg") ? "mp3" : "raw";
    const dataUri = `data:${mimeType};base64,${params.data}`;
    const item = createSound(params.name, { dataUri, compressionType });
    const newLibrary = addLibraryItem(doc.library, item);
    cb.pushDoc({ ...doc, library: newLibrary });
    return { itemId: item.id, rev: _rev };
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

    // Pass frameIndex directly to the renderer so it builds a scene graph for
    // that frame without changing the editor's current-frame UI state.
    // (setCurrentFrame is a React state update and would be async; calling it
    // before screenshotStage would not take effect in time.)
    const pngBase64 = cb.screenshotStage(params.frameIndex);
    return {
      pngBase64,
      width: doc.properties.width,
      height: doc.properties.height,
    };
  },

  async publish_swf(): Promise<PublishSwfResult> {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const bytes = await cb.publishToBytes();
    // Convert to base64. `swfBase64` is for the app/UI side (download / preview);
    // the agent-chat tool's `toModelOutput` (tools.ts) strips it so the model
    // only ever sees the { ok, byteLength, width, height } summary (task 1306).
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const swfBase64 = btoa(binary);
    return {
      ok: true,
      width: doc.properties.width,
      height: doc.properties.height,
      byteLength: bytes.length,
      swfBase64,
    };
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

  // =========================================================================
  // Scene management
  // =========================================================================

  scene_add(params: { name?: string }): SceneAddResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const newDoc = addScene(doc, params.name);
    cb.pushDoc(newDoc);
    // The new scene is appended at the end
    const newIndex = newDoc.scenes.length - 1;
    return { sceneIndex: newIndex, sceneName: newDoc.scenes[newIndex].name, rev: _rev };
  },

  scene_remove(params: { index: number }): OkRevResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    if (params.index < 0 || params.index >= doc.scenes.length) {
      throw new Error(
        `scene_remove: index ${params.index} out of bounds (sceneCount=${doc.scenes.length})`
      );
    }
    if (doc.scenes.length <= 1) {
      throw new Error("scene_remove: cannot remove the only scene");
    }
    const scene = doc.scenes[params.index];
    const newDoc = removeScene(doc, scene.id);
    cb.pushDoc(newDoc);
    // Clamp the active scene index so it stays within the new scene list
    const newActiveIndex = Math.min(cb.getActiveSceneIndex(), newDoc.scenes.length - 1);
    cb.setActiveSceneIndex(newActiveIndex);
    return { ok: true, rev: _rev };
  },

  scene_rename(params: { index: number; name: string }): OkRevResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    if (params.index < 0 || params.index >= doc.scenes.length) {
      throw new Error(
        `scene_rename: index ${params.index} out of bounds (sceneCount=${doc.scenes.length})`
      );
    }
    const scene = doc.scenes[params.index];
    const newDoc = renameScene(doc, scene.id, params.name);
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  scene_select(params: { index: number }): OkRevResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    if (params.index < 0 || params.index >= doc.scenes.length) {
      throw new Error(
        `scene_select: index ${params.index} out of bounds (sceneCount=${doc.scenes.length})`
      );
    }
    cb.setActiveSceneIndex(params.index);
    return { ok: true, rev: _rev };
  },

  // =========================================================================
  // Filters
  // =========================================================================

  filter_add(params: {
    type: 'dropShadow' | 'blur' | 'glow' | 'bevel' | 'gradientGlow' | 'gradientBevel' | 'colorMatrix';
    enabled?: boolean;
    ids?: string[];
    layerId?: string;
    frameIndex?: number;
    blurX?: number;
    blurY?: number;
    strength?: number;
    angle?: number;
    distance?: number;
    quality?: number;
    color?: string;
    alpha?: number;
    inner?: boolean;
    knockout?: boolean;
    hideObject?: boolean;
  }): FilterAddResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);
    const targetIds = params.ids && params.ids.length > 0 ? params.ids : cb.getSelectedIds();
    if (targetIds.length === 0) {
      throw new Error("filter_add: no objects selected and no ids provided");
    }

    // Build base filter from type
    const typeLower = params.type.toLowerCase();
    let baseFilter: FlashFilter;
    if (typeLower === 'dropshadow') {
      baseFilter = defaultDropShadow();
    } else if (typeLower === 'blur') {
      baseFilter = defaultBlur();
    } else if (typeLower === 'glow') {
      baseFilter = defaultGlow();
    } else if (typeLower === 'bevel') {
      baseFilter = defaultBevel();
    } else if (typeLower === 'gradientglow') {
      baseFilter = defaultGradientGlow();
    } else if (typeLower === 'gradientbevel') {
      baseFilter = defaultGradientBevel();
    } else if (typeLower === 'colormatrix') {
      baseFilter = defaultAdjustColor();
    } else {
      throw new Error(`filter_add: unsupported filter type "${params.type}". Supported: dropShadow, blur, glow, bevel, gradientGlow, gradientBevel, colorMatrix`);
    }

    // Apply overrides from params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const overrides: Record<string, any> = {};
    if (params.enabled !== undefined) overrides.enabled = params.enabled;
    if (params.blurX !== undefined) overrides.blurX = params.blurX;
    if (params.blurY !== undefined) overrides.blurY = params.blurY;
    if (params.strength !== undefined) overrides.strength = params.strength;
    if (params.angle !== undefined) overrides.angle = params.angle;
    if (params.distance !== undefined) overrides.distance = params.distance;
    if (params.quality !== undefined) overrides.quality = params.quality;
    if (params.color !== undefined) overrides.color = parseHexColor(params.color);
    if (params.alpha !== undefined) overrides.alpha = params.alpha;
    if (params.inner !== undefined) overrides.inner = params.inner;
    if (params.knockout !== undefined) overrides.knockout = params.knockout;
    if (params.hideObject !== undefined) overrides.hideObject = params.hideObject;

    const newFilter = { ...baseFilter, ...overrides } as FlashFilter;

    const doc = cb.getDoc();
    const toUpdate = new Set(targetIds);

    const newDoc = withActiveTimeline(cb, doc, (t) => {
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
            const newObjects = f.displayObjects.map((obj) => {
              if (!toUpdate.has(obj.id)) return obj;
              const withFilters = obj as { filters?: FlashFilter[] };
              const existing = withFilters.filters ? [...withFilters.filters] : [];
              return { ...obj, filters: [...existing, newFilter] };
            });
            return { ...f, displayObjects: newObjects };
          });
          return { ...layer, frames: newFrames };
        }),
      };
    });
    cb.pushDoc(newDoc);
    return { success: true, rev: _rev };
  },

  filter_remove(params: {
    index: number;
    ids?: string[];
    layerId?: string;
    frameIndex?: number;
  }): FilterRemoveResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);
    const targetIds = params.ids && params.ids.length > 0 ? params.ids : cb.getSelectedIds();
    if (targetIds.length === 0) {
      throw new Error("filter_remove: no objects selected and no ids provided");
    }

    const doc = cb.getDoc();
    const toUpdate = new Set(targetIds);

    const newDoc = withActiveTimeline(cb, doc, (t) => {
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
            const newObjects = f.displayObjects.map((obj) => {
              if (!toUpdate.has(obj.id)) return obj;
              const withFilters = obj as { filters?: FlashFilter[] };
              const existing = withFilters.filters ? [...withFilters.filters] : [];
              return { ...obj, filters: existing.filter((_, i) => i !== params.index) };
            });
            return { ...f, displayObjects: newObjects };
          });
          return { ...layer, frames: newFrames };
        }),
      };
    });
    cb.pushDoc(newDoc);
    return { success: true, rev: _rev };
  },

  filter_list(params: {
    id?: string;
    layerId?: string;
    frameIndex?: number;
  }): FilterListResult {
    const cb = requireCallbacks();
    const layerId = resolveLayerId(cb, params.layerId);
    const frameIndex = resolveFrameIndex(cb, params.frameIndex);
    const targetId = params.id ?? cb.getSelectedIds()[0];
    if (!targetId) {
      return { filters: [], rev: _rev };
    }

    const doc = cb.getDoc();
    const sceneIndex = cb.getActiveSceneIndex();
    const scene = doc.scenes[Math.min(sceneIndex, doc.scenes.length - 1)];
    if (!scene) return { filters: [], rev: _rev };

    const layer = scene.timeline.layers.find((l) => l.id === layerId);
    if (!layer) return { filters: [], rev: _rev };

    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= frameIndex)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return { filters: [], rev: _rev };

    const obj = kf.displayObjects.find((o) => o.id === targetId);
    if (!obj) return { filters: [], rev: _rev };

    const withFilters = obj as { filters?: FlashFilter[] };
    return { filters: withFilters.filters ? [...withFilters.filters] : [], rev: _rev };
  },

  scene_duplicate(_params: Record<string, unknown>): SceneDuplicateResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const currentIndex = cb.getActiveSceneIndex();
    const scene = doc.scenes[currentIndex];
    if (!scene) {
      throw new Error(`scene_duplicate: no scene at index ${currentIndex}`);
    }
    const newDoc = duplicateScene(doc, scene.id);
    cb.pushDoc(newDoc);
    // The duplicate is inserted immediately after the source scene
    const newIndex = currentIndex + 1;
    cb.setActiveSceneIndex(newIndex);
    return { sceneIndex: newIndex, sceneName: newDoc.scenes[newIndex]!.name, rev: _rev };
  },

  scene_reorder(params: { sceneIndex: number; insertBefore: number }): SceneReorderResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    if (params.sceneIndex < 0 || params.sceneIndex >= doc.scenes.length) {
      throw new Error(
        `scene_reorder: sceneIndex ${params.sceneIndex} out of bounds (sceneCount=${doc.scenes.length})`
      );
    }
    // insertBefore is a position to insert before; convert to toIndex for reorderScenes.
    // reorderScenes(doc, fromIndex, toIndex) moves the item from fromIndex to toIndex.
    // insertBefore=N means we want the item at position N after the removal, which is
    // equivalent to toIndex = min(insertBefore, scenes.length - 1).
    const toIndex = Math.max(0, Math.min(params.insertBefore, doc.scenes.length - 1));
    const newDoc = reorderScenes(doc, params.sceneIndex, toIndex);
    cb.pushDoc(newDoc);
    return { ok: true };
  },

  // =========================================================================
  // Stage utilities
  // =========================================================================

  stage_move_selection(params: { dx: number; dy: number }): StageMoveSelectionResult {
    const cb = requireCallbacks();
    const selectedIds = cb.getSelectedIds();
    if (selectedIds.length === 0) {
      return { movedCount: 0 };
    }

    const doc = cb.getDoc();
    const selectedSet = new Set(selectedIds);
    let movedCount = 0;

    // Iterate all scenes/layers/keyframes to find selected objects and move them
    const newScenes = doc.scenes.map((scene) => {
      const newLayers = scene.timeline.layers.map((layer) => {
        const newFrames = layer.frames.map((frame) => {
          if (!frame.isKeyframe) return frame;
          const newObjects = frame.displayObjects.map((obj) => {
            if (!selectedSet.has(obj.id)) return obj;
            const ox = "x" in obj ? (obj as { x: number }).x : 0;
            const oy = "y" in obj ? (obj as { y: number }).y : 0;
            movedCount++;
            return { ...obj, x: ox + params.dx, y: oy + params.dy };
          });
          return { ...frame, displayObjects: newObjects };
        });
        return { ...layer, frames: newFrames };
      });
      return { ...scene, timeline: { ...scene.timeline, layers: newLayers } };
    });

    const newDoc = { ...doc, scenes: newScenes };
    cb.pushDoc(newDoc);
    // movedCount can overcount if the same id appears in multiple keyframes; normalise
    const uniqueMoved = Math.min(movedCount, selectedIds.length);
    return { movedCount: uniqueMoved };
  },

  stage_find_instances(params: { symbolName: string }): StageFindInstancesResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();

    // Find the library symbol by name
    const sym = doc.library.items.find(
      (i) => i.name === params.symbolName && i.itemType === "symbol"
    );
    if (!sym) {
      return { instances: [] };
    }
    const symbolId = sym.id;

    const instances: StageFindInstancesResult["instances"] = [];

    doc.scenes.forEach((scene, sceneIndex) => {
      scene.timeline.layers.forEach((layer, layerIndex) => {
        layer.frames.forEach((frame) => {
          if (!frame.isKeyframe) return;
          frame.displayObjects.forEach((obj) => {
            if (obj.type === "instance" && (obj as SymbolInstance).symbolId === symbolId) {
              const inst = obj as SymbolInstance;
              instances.push({
                id: inst.id,
                x: inst.x,
                y: inst.y,
                layerIndex,
                frameIndex: frame.index,
                sceneIndex,
              });
            }
          });
        });
      });
    });

    return { instances };
  },

  // =========================================================================
  // Stage utilities (continued)
  // =========================================================================

  stage_get_bounds(params: { id: string }): StageGetBoundsResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();

    for (const scene of doc.scenes) {
      for (const layer of scene.timeline.layers) {
        for (const frame of layer.frames) {
          if (!frame.isKeyframe) continue;
          const obj = frame.displayObjects.find((o) => o.id === params.id);
          if (!obj) continue;
          const bounds = getTransformedBounds(obj);
          return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
        }
      }
    }

    // Not found
    return { x: 0, y: 0, width: 0, height: 0 };
  },

  stage_duplicate(params: {
    ids: string[];
    offsetX?: number;
    offsetY?: number;
  }): StageDuplicateResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();
    const offsetX = params.offsetX ?? 10;
    const offsetY = params.offsetY ?? 10;
    const duplicatedIds: string[] = [];

    // Build a map from id → { sceneIndex, layerId, frameIndex, obj } for all requested ids
    type FoundObj = {
      sceneIndex: number;
      layerId: string;
      frameIndex: number;
      obj: DisplayObject;
    };
    const found = new Map<string, FoundObj>();

    for (let si = 0; si < doc.scenes.length; si++) {
      const scene = doc.scenes[si];
      for (const layer of scene.timeline.layers) {
        for (const frame of layer.frames) {
          if (!frame.isKeyframe) continue;
          for (const obj of frame.displayObjects) {
            if (params.ids.includes(obj.id) && !found.has(obj.id)) {
              found.set(obj.id, {
                sceneIndex: si,
                layerId: layer.id,
                frameIndex: frame.index,
                obj,
              });
            }
          }
        }
      }
    }

    if (found.size === 0) {
      return { duplicatedIds: [] };
    }

    // Apply all clones in a single doc mutation
    let newDoc = doc;
    for (const [, { sceneIndex, layerId, frameIndex, obj }] of found) {
      const clone = structuredClone(obj) as DisplayObject;
      const newId = nextAgentObjId("dup");
      // Override the id on the clone (structuredClone gives a deep copy but same id)
      (clone as { id: string }).id = newId;
      // Offset position
      const ox = "x" in clone ? (clone as { x: number }).x : 0;
      const oy = "y" in clone ? (clone as { y: number }).y : 0;
      (clone as { x: number }).x = ox + offsetX;
      (clone as { y: number }).y = oy + offsetY;

      newDoc = withSceneTimeline(newDoc, sceneIndex, (t) =>
        addDisplayObject(t, layerId, frameIndex, clone)
      );
      duplicatedIds.push(newId);
    }

    cb.pushDoc(newDoc);
    return { duplicatedIds };
  },

  /**
   * Set / rename the AS2 instance name of a placed symbol or text instance.
   * The name is the identifier AS2 references at runtime as `_root.<name>`
   * (used to script position, playback and interactivity). Validates the name
   * as an AS2 identifier; an empty string clears it. History-safe via
   * getDoc()/pushDoc().
   */
  stage_set_instance_name(params: {
    id: string;
    name: string;
    layerId?: string;
    frameIndex?: number;
  }): StageSetInstanceNameResult {
    const cb = requireCallbacks();

    // Validate the AS2 instance name up front with a clear error.
    const validation = validateInstanceName(params.name);
    if (!validation.ok) throw new Error(validation.error);

    const doc = cb.getDoc();
    const timeline = getActiveTimeline(cb);

    // Locate the target object in the active timeline. If layerId/frameIndex
    // are supplied, honor them; otherwise search every keyframe so the caller
    // need not know exactly where the instance lives.
    let foundLayerId: string | undefined;
    let foundFrameIndex: number | undefined;
    let foundObj: DisplayObject | undefined;
    for (const layer of timeline.layers) {
      if (params.layerId !== undefined && layer.id !== params.layerId) continue;
      for (const frame of layer.frames) {
        if (!frame.isKeyframe) continue;
        if (params.frameIndex !== undefined && frame.index !== params.frameIndex) continue;
        const obj = frame.displayObjects.find((o) => o.id === params.id);
        if (obj) {
          foundLayerId = layer.id;
          foundFrameIndex = frame.index;
          foundObj = obj;
          break;
        }
      }
      if (foundObj) break;
    }

    if (!foundObj || foundLayerId === undefined || foundFrameIndex === undefined) {
      throw new Error(
        `No display object with id "${params.id}" found in the active timeline.`
      );
    }
    if (foundObj.type !== "instance" && foundObj.type !== "text") {
      throw new Error(
        `Object "${params.id}" is a ${foundObj.type}; instance names apply only to ` +
        `symbol instances and text fields.`
      );
    }

    // Empty string clears the name (stored as undefined).
    const instanceName = params.name === "" ? undefined : params.name;
    const newDoc = withActiveTimeline(cb, doc, (t) =>
      updateDisplayObject(t, foundLayerId!, foundFrameIndex!, params.id, { instanceName })
    );
    cb.pushDoc(newDoc);
    return { ok: true, rev: _rev };
  },

  // =========================================================================
  // Library utilities
  // =========================================================================

  library_use_count(params: { name: string }): LibraryUseCountResult {
    const cb = requireCallbacks();
    const doc = cb.getDoc();

    // Find the library symbol by name
    const sym = doc.library.items.find((i) => i.name === params.name && i.itemType === "symbol");
    if (!sym) {
      return { count: 0 };
    }
    const symbolId = sym.id;

    let count = 0;
    doc.scenes.forEach((scene) => {
      scene.timeline.layers.forEach((layer) => {
        layer.frames.forEach((frame) => {
          if (!frame.isKeyframe) return;
          frame.displayObjects.forEach((obj) => {
            if (obj.type === "instance" && (obj as SymbolInstance).symbolId === symbolId) {
              count++;
            }
          });
        });
      });
    });

    return { count };
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
