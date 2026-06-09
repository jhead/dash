/**
 * Editor-side WebSocket bridge client.
 *
 * Connects to ws://localhost:1420/__agent and dispatches incoming commands
 * to the AgentCommandRegistry. Only runs in DEV mode or when
 * VITE_FLASH_TEST=1.
 *
 * Also sends push notifications to the plugin when the document, selection,
 * or playhead changes. The plugin forwards these to subscribed MCP clients.
 *
 * Reconnects with exponential back-off (1s → 2s → 4s → … max 30s).
 */

import { dispatchAgentCommand, setDocChangedCallback, getRev } from "./registry.js";
import type { BridgeRequest, BridgeResponse, BridgeNotification } from "@flash/agent-protocol";

const WS_URL = "ws://localhost:1420/__agent";
const MAX_BACKOFF_MS = 30_000;

let _ws: WebSocket | null = null;
let _backoffMs = 1_000;
let _stopped = false;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Send a push notification to the plugin (fire-and-forget). */
function sendNotification(notification: BridgeNotification): void {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    try {
      _ws.send(JSON.stringify(notification));
    } catch {
      // best-effort
    }
  }
}

function connect(): void {
  if (_stopped) return;

  const ws = new WebSocket(WS_URL);
  _ws = ws;

  ws.onopen = () => {
    console.debug("[agent-bridge] Connected to /__agent");
    _backoffMs = 1_000; // reset back-off on successful connection
    // Wire up the doc-changed callback now that we have a connection
    setDocChangedCallback((rev) => {
      sendNotification({ type: "doc-changed", rev });
    });
  };

  ws.onmessage = async (evt: MessageEvent<string>) => {
    let req: BridgeRequest;
    try {
      req = JSON.parse(evt.data) as BridgeRequest;
    } catch {
      console.warn("[agent-bridge] Received non-JSON message, ignoring");
      return;
    }

    let response: BridgeResponse;
    try {
      const result = await dispatchAgentCommand(
        req.command,
        (req.params ?? {}) as Record<string, unknown>
      );
      response = { ok: true, id: req.id, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      response = { ok: false, id: req.id, error: message };
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  };

  ws.onclose = () => {
    console.debug(
      `[agent-bridge] Disconnected. Reconnecting in ${_backoffMs}ms…`
    );
    _ws = null;
    // Clear the doc-changed callback while disconnected
    setDocChangedCallback(null);
    if (!_stopped) {
      _reconnectTimer = setTimeout(() => {
        _backoffMs = Math.min(_backoffMs * 2, MAX_BACKOFF_MS);
        connect();
      }, _backoffMs);
    }
  };

  ws.onerror = () => {
    // onclose will fire after onerror — nothing extra needed here
  };
}

/** Start the agent bridge. Called by Shell on mount. */
export function startAgentBridge(): void {
  _stopped = false;
  connect();
}

/** Stop and clean up. Called by Shell on unmount. */
export function stopAgentBridge(): void {
  _stopped = true;
  setDocChangedCallback(null);
  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_ws) {
    _ws.onclose = null; // prevent reconnect loop
    _ws.close();
    _ws = null;
  }
}

/** True when a WebSocket is currently open. */
export function isBridgeConnected(): boolean {
  return _ws !== null && _ws.readyState === WebSocket.OPEN;
}

/**
 * Notify the plugin that the selection changed.
 * Called by Shell when selection state changes (optional, best-effort).
 */
export function notifySelectionChanged(ids: string[]): void {
  sendNotification({ type: "selection-changed", ids, rev: getRev() });
}

/**
 * Notify the plugin that the playhead moved.
 * Called by Shell when the current frame changes (optional, best-effort).
 */
export function notifyPlayheadMoved(frameIndex: number): void {
  sendNotification({ type: "playhead-moved", frameIndex, rev: getRev() });
}
