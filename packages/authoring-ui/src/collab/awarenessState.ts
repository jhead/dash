/**
 * Awareness state shape + the uiStore → awareness projection (task 1345 P2).
 *
 * The awareness channel (y-protocols/awareness, owned by the y-webrtc provider)
 * carries NON-persistent presence: who is here, where their cursor is, what
 * they have selected, which scene/frame/symbol they are editing, and which tool
 * is active. None of this touches the document (the Y.Doc) — it rides the same
 * encrypted y-webrtc mesh but is ephemeral and auto-expires (see TTL below).
 *
 * This module is PURE: it maps a uiStore snapshot to the broadcast shape and
 * back. It imports no Yjs/React so it is trivially unit-testable.
 */
import type { CollabUser } from "./localUser.js";
import type { EditContext, UiState } from "../store/uiStore.js";

/** A point in stage coordinates (same space as `uiStore.cursorPos`). */
export interface CursorPoint {
  x: number;
  y: number;
}

/** What a peer currently has selected (shapes + a placed instance). */
export interface PeerSelection {
  /** Selected shape ids on the active layer/frame. */
  shapeIds: string[];
  /** Selected placed instance id, or null. */
  instanceId: string | null;
}

/** A peer's edit location — document root vs. inside a symbol's timeline. */
export interface PeerEditContext {
  mode: "document" | "symbol";
  symbolId?: string;
  symbolName?: string;
}

/**
 * The full awareness state one peer broadcasts. Each field is set independently
 * via `setLocalStateField`, but they always travel together in `getStates()`.
 */
export interface AwarenessState {
  user: CollabUser;
  /** Stage-space cursor, or null when the pointer left the stage. */
  cursor: CursorPoint | null;
  /** Active scene index. */
  scene: number;
  /** Current (playhead) frame, 0-based. */
  frame: number;
  /** Where this peer is editing (doc root or a symbol). */
  editContext: PeerEditContext;
  /** This peer's selection. */
  selection: PeerSelection;
  /** Active tool id (e.g. "selection", "pencil", …). */
  tool: string;
}

/**
 * A remote peer's resolved presence, as consumed by the rendering layer. It is
 * `AwarenessState` plus the y-protocols numeric `clientId` (the awareness key).
 */
export interface PeerPresence extends AwarenessState {
  /** The y-protocols awareness client id for this peer. */
  clientId: number;
}

/** Project a uiStore snapshot into the broadcast awareness shape. */
export function uiStateToAwareness(ui: UiState, user: CollabUser): AwarenessState {
  return {
    user,
    cursor: ui.cursorPos ? { x: ui.cursorPos.x, y: ui.cursorPos.y } : null,
    scene: ui.activeSceneIndex,
    frame: ui.currentFrame,
    editContext: toPeerEditContext(ui.editContext),
    selection: {
      shapeIds: [...ui.selectedShapeIds],
      instanceId: ui.selectedInstanceId,
    },
    tool: ui.toolState.activeTool,
  };
}

function toPeerEditContext(ec: EditContext): PeerEditContext {
  if (ec.mode === "symbol") {
    return { mode: "symbol", symbolId: ec.symbolId, symbolName: ec.symbolName };
  }
  return { mode: "document" };
}

/** Narrow an unknown awareness payload to a `PeerPresence` (defensive parse). */
export function asPeerPresence(clientId: number, raw: unknown): PeerPresence | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<AwarenessState>;
  if (!s.user || typeof s.user !== "object") return null;
  const u = s.user as Partial<CollabUser>;
  if (typeof u.id !== "string" || typeof u.name !== "string" || typeof u.color !== "string") {
    return null;
  }
  const cursor =
    s.cursor && typeof s.cursor === "object" &&
    typeof (s.cursor as CursorPoint).x === "number" &&
    typeof (s.cursor as CursorPoint).y === "number"
      ? { x: (s.cursor as CursorPoint).x, y: (s.cursor as CursorPoint).y }
      : null;
  const ec = (s.editContext && typeof s.editContext === "object"
    ? s.editContext
    : { mode: "document" }) as PeerEditContext;
  const sel = (s.selection && typeof s.selection === "object"
    ? s.selection
    : { shapeIds: [], instanceId: null }) as PeerSelection;
  return {
    clientId,
    user: { id: u.id, name: u.name, color: u.color },
    cursor,
    scene: typeof s.scene === "number" ? s.scene : 0,
    frame: typeof s.frame === "number" ? s.frame : 0,
    editContext: ec.mode === "symbol"
      ? { mode: "symbol", symbolId: ec.symbolId, symbolName: ec.symbolName }
      : { mode: "document" },
    selection: {
      shapeIds: Array.isArray(sel.shapeIds) ? sel.shapeIds.filter((x) => typeof x === "string") : [],
      instanceId: typeof sel.instanceId === "string" ? sel.instanceId : null,
    },
    tool: typeof s.tool === "string" ? s.tool : "selection",
  };
}

/**
 * Which awareness fields changed between two snapshots (so the cursor — the
 * high-frequency field — can be throttled while everything else broadcasts
 * immediately). Returns the list of field names whose value differs.
 */
export function changedAwarenessFields(
  prev: AwarenessState | null,
  next: AwarenessState,
): (keyof AwarenessState)[] {
  if (!prev) return ["user", "cursor", "scene", "frame", "editContext", "selection", "tool"];
  const out: (keyof AwarenessState)[] = [];
  if (!shallowEqUser(prev.user, next.user)) out.push("user");
  if (!eqCursor(prev.cursor, next.cursor)) out.push("cursor");
  if (prev.scene !== next.scene) out.push("scene");
  if (prev.frame !== next.frame) out.push("frame");
  if (!eqEditContext(prev.editContext, next.editContext)) out.push("editContext");
  if (!eqSelection(prev.selection, next.selection)) out.push("selection");
  if (prev.tool !== next.tool) out.push("tool");
  return out;
}

/**
 * Build a `symbolId → editors` map from the peer list: which remote peers are
 * currently inside each symbol's timeline (edit-context mode === "symbol"). Used
 * for the Library "editing this symbol" indicator.
 */
export function symbolEditorsFromPeers(
  peers: PeerPresence[],
): Map<string, { color: string; name: string }[]> {
  const map = new Map<string, { color: string; name: string }[]>();
  for (const p of peers) {
    if (p.editContext.mode !== "symbol" || !p.editContext.symbolId) continue;
    const list = map.get(p.editContext.symbolId) ?? [];
    list.push({ color: p.user.color, name: p.user.name });
    map.set(p.editContext.symbolId, list);
  }
  return map;
}

function shallowEqUser(a: CollabUser, b: CollabUser): boolean {
  return a.id === b.id && a.name === b.name && a.color === b.color;
}
function eqCursor(a: CursorPoint | null, b: CursorPoint | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}
function eqEditContext(a: PeerEditContext, b: PeerEditContext): boolean {
  return a.mode === b.mode && a.symbolId === b.symbolId && a.symbolName === b.symbolName;
}
function eqSelection(a: PeerSelection, b: PeerSelection): boolean {
  if (a.instanceId !== b.instanceId) return false;
  if (a.shapeIds.length !== b.shapeIds.length) return false;
  for (let i = 0; i < a.shapeIds.length; i++) {
    if (a.shapeIds[i] !== b.shapeIds[i]) return false;
  }
  return true;
}
