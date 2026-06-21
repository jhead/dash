/**
 * Awareness controller (task 1345 P2) — wires the uiStore to a y-protocols
 * Awareness instance and reads remote peers back out.
 *
 * OUTBOUND: subscribe to the uiStore; on every change project the snapshot to
 *   the awareness shape and push only the FIELDS that changed via
 *   `setLocalStateField`. The cursor (high-frequency, fires on every mousemove)
 *   is THROTTLED — at most one update per `cursorThrottleMs` — while every other
 *   field (scene/frame/selection/tool/editContext) broadcasts immediately.
 *
 * INBOUND: subscribe to `awareness.on('change')`; collect all OTHER clients'
 *   states (excluding our own `clientID`) as `PeerPresence[]` and hand them to a
 *   listener for the React layer to render.
 *
 * TTL: there is NO custom drop logic. y-protocols/awareness has a built-in
 *   30 s outdated-timeout: it stamps every state with a `lastUpdated` and its
 *   internal interval removes any client not refreshed within `outdatedTimeout`,
 *   firing a `change`/`update` with that client in `removed`. A peer that closes
 *   its tab / drops its WebRTC connection therefore disappears from presence on
 *   its own. We re-stamp our own state periodically (keepalive) so a quiet local
 *   peer is not reaped; the keepalive interval is well under the timeout.
 *
 * This module imports the y-protocols Awareness TYPE and a minimal store
 * interface — no React, no provider — so it is unit-testable with a real
 * Awareness over an in-process wire.
 */
import type { Awareness } from "y-protocols/awareness";
import type { UiStoreApi } from "../store/uiStore.js";
import type { CollabUser } from "./localUser.js";
import {
  type AwarenessState,
  type PeerPresence,
  asPeerPresence,
  changedAwarenessFields,
  uiStateToAwareness,
} from "./awarenessState.js";

export interface AttachAwarenessOptions {
  /** Max cursor broadcast rate, ms (default 50 = 20 Hz). */
  cursorThrottleMs?: number;
  /**
   * How often to re-stamp our own state so the built-in TTL never reaps a quiet
   * local peer. Must be < the awareness `outdatedTimeout` (30 s); default 15 s.
   */
  keepaliveMs?: number;
  /** Injectable timers (tests). */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  nowFn?: () => number;
}

export interface AwarenessController {
  /** Force-broadcast the current uiStore snapshot (all fields). */
  flush(): void;
  /** Current remote peers (excludes self). */
  getPeers(): PeerPresence[];
  /** Subscribe to remote-peer changes; returns an unsubscribe. */
  onPeersChange(listener: (peers: PeerPresence[]) => void): () => void;
  /** Detach: clears local state, removes listeners, stops the keepalive. */
  detach(): void;
}

/** Collect all peers EXCEPT our own client id from an Awareness instance. */
export function readPeers(awareness: Awareness): PeerPresence[] {
  const peers: PeerPresence[] = [];
  const self = awareness.clientID;
  for (const [clientId, raw] of awareness.getStates()) {
    if (clientId === self) continue;
    const presence = asPeerPresence(clientId, raw);
    if (presence) peers.push(presence);
  }
  return peers;
}

/**
 * Attach the uiStore to an Awareness instance. Returns a controller exposing the
 * remote peers and a detach. Solo callers never invoke this (no awareness
 * exists); it runs ONLY for a live collaboration session.
 */
export function attachAwareness(
  awareness: Awareness,
  uiStore: UiStoreApi,
  user: CollabUser,
  options: AttachAwarenessOptions = {},
): AwarenessController {
  const cursorThrottleMs = options.cursorThrottleMs ?? 50;
  const keepaliveMs = options.keepaliveMs ?? 15000;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const now = options.nowFn ?? (() => Date.now());

  let lastSent: AwarenessState | null = null;
  // Throttle bookkeeping for the cursor field.
  let lastCursorSentAt = -Infinity;
  let pendingCursorTimer: ReturnType<typeof setTimeout> | null = null;

  const peerListeners = new Set<(peers: PeerPresence[]) => void>();

  function broadcast(state: AwarenessState, fields: (keyof AwarenessState)[]): void {
    for (const f of fields) {
      awareness.setLocalStateField(f, state[f]);
    }
    lastSent = state;
  }

  function sendChanges(force: boolean): void {
    const state = uiStateToAwareness(uiStore.getState(), user);
    const changed = force
      ? (Object.keys(state) as (keyof AwarenessState)[])
      : changedAwarenessFields(lastSent, state);
    if (changed.length === 0) return;

    const t = now();
    const cursorChanged = changed.includes("cursor");
    const nonCursor = changed.filter((f) => f !== "cursor");

    // Non-cursor fields always go out immediately.
    if (nonCursor.length > 0) broadcast(state, nonCursor);

    if (!cursorChanged) {
      // Keep lastSent current for the non-cursor fields we just sent.
      if (nonCursor.length > 0) lastSent = { ...state, cursor: lastSent?.cursor ?? state.cursor };
      return;
    }

    // Cursor: throttle to at most one broadcast per window. Only a real
    // (non-null) cursor starts the throttle clock — the initial seed (cursor
    // null when the pointer has never entered the stage) must not delay the
    // user's first move.
    const elapsed = t - lastCursorSentAt;
    if (force || elapsed >= cursorThrottleMs) {
      broadcast(state, ["cursor"]);
      lastSent = state;
      if (state.cursor) lastCursorSentAt = t;
    } else if (!pendingCursorTimer) {
      // Defer to the end of the throttle window so the LAST position wins.
      const wait = cursorThrottleMs - elapsed;
      pendingCursorTimer = setTimeout(() => {
        pendingCursorTimer = null;
        const latest = uiStateToAwareness(uiStore.getState(), user);
        broadcast(latest, ["cursor"]);
        lastSent = latest;
        lastCursorSentAt = now();
      }, wait);
    }
  }

  // OUTBOUND — seed our full state, then subscribe.
  sendChanges(true);
  const unsubStore = uiStore.subscribe(() => sendChanges(false));

  // INBOUND — fan remote-peer changes out to listeners.
  function notifyPeers(): void {
    if (peerListeners.size === 0) return;
    const peers = readPeers(awareness);
    for (const l of peerListeners) l(peers);
  }
  const onAwarenessChange = (): void => notifyPeers();
  awareness.on("change", onAwarenessChange);

  // KEEPALIVE — re-stamp our own state so the built-in TTL never reaps us while
  // we are idle (no custom drop logic — this only PREVENTS a false self-drop).
  const keepalive = setIntervalFn(() => {
    const local = awareness.getLocalState();
    if (local) awareness.setLocalState({ ...local });
  }, keepaliveMs);

  return {
    flush: () => sendChanges(true),
    getPeers: () => readPeers(awareness),
    onPeersChange(listener) {
      peerListeners.add(listener);
      return () => peerListeners.delete(listener);
    },
    detach() {
      if (pendingCursorTimer) {
        clearTimeout(pendingCursorTimer);
        pendingCursorTimer = null;
      }
      clearIntervalFn(keepalive);
      unsubStore();
      awareness.off("change", onAwarenessChange);
      peerListeners.clear();
      // Mark ourselves offline immediately for the other peers.
      awareness.setLocalState(null);
    },
  };
}
