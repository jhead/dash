/**
 * AgentCommandRegistry
 *
 * Maps command names → handler functions. Handlers are registered by the
 * Shell once it mounts (via `setAgentCallbacks`). The registry is module-level
 * so the bridge client can dispatch commands without needing direct access to
 * React state.
 *
 * Supported MVP commands: editor_status, doc_get, doc_summary
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
} from "@flash/agent-protocol";
import type { FlashDocument } from "@flash/core";

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
// JSON Pointer traversal (RFC 6901, minimal subset)
// ---------------------------------------------------------------------------

function resolvePointer(doc: unknown, pointer: string): unknown {
  if (!pointer || pointer === "/") return doc;
  // Normalize: remove leading slash, split on /
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
// Handlers
// ---------------------------------------------------------------------------

const handlers: {
  editor_status: AgentCommandHandler<EditorStatusParams, EditorStatusResult>;
  doc_get: AgentCommandHandler<DocGetParams, DocGetResult>;
  doc_summary: AgentCommandHandler<DocGetSummaryParams, DocSummaryResult>;
} = {
  editor_status(_params: EditorStatusParams): EditorStatusResult {
    if (!_callbacks) {
      throw new Error("Editor not ready: agent callbacks not wired");
    }
    const doc = _callbacks.getDoc();
    const sceneIndex = _callbacks.getActiveSceneIndex();
    const scene = doc.scenes[Math.min(sceneIndex, doc.scenes.length - 1)];
    const timeline = scene?.timeline;
    const frameCount = timeline
      ? timeline.layers.reduce((max, l) => Math.max(max, l.frameCount), 0)
      : 0;
    const layerCount = timeline?.layers.length ?? 0;
    const activeLayerIdx = _callbacks.getActiveLayerIndex();
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
      currentFrame: _callbacks.getCurrentFrame(),
      activeLayerId: activeLayer?.id,
      activeTool: _callbacks.getActiveTool(),
      editContext: _callbacks.getEditContext(),
      rev: _rev,
    };
  },

  doc_get({ path }: DocGetParams): DocGetResult {
    if (!_callbacks) {
      throw new Error("Editor not ready: agent callbacks not wired");
    }
    const doc = _callbacks.getDoc();
    const resolvedPath = path ?? "";
    const value = resolvePointer(doc, resolvedPath);
    return {
      path: resolvedPath,
      value,
      rev: _rev,
    };
  },

  doc_summary(_params: DocGetSummaryParams): DocSummaryResult {
    if (!_callbacks) {
      throw new Error("Editor not ready: agent callbacks not wired");
    }
    const doc = _callbacks.getDoc();

    const scenes = doc.scenes.map((scene, sceneIdx) => {
      const layers = scene.timeline.layers.map((layer) => {
        const frameCount = layer.frameCount;
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
          frameCount,
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
  const handler = handlers[command as keyof typeof handlers];
  return handler(params as never);
}
