/**
 * Collaboration controls + connection status (collab P4 / docs 37).
 *
 * A single, clearly opt-in control surface that lives in the EditBar's right
 * slot next to the presence avatars:
 *
 *   - SOLO: a "Collaborate" button that opens the Share dialog (which can start
 *     hosting and surfaces the invite link).
 *   - IN A SESSION: a live connection-status pill (connecting / connected +
 *     peer count) plus a "Leave" button.
 *
 * Nothing here runs or subscribes when solo beyond reading the (null) session.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useCollab } from "./CollabContext.js";
import { ShareDialog } from "./ShareDialog.js";

/** Coarse connection state surfaced to the user. */
export type CollabConnState = "solo" | "connecting" | "connected";

export interface CollabStatus {
  state: CollabConnState;
  /** Number of OTHER peers currently connected (0 while alone in a room). */
  peers: number;
  /** True once the provider has synced with the room at least once. */
  synced: boolean;
}

/**
 * Subscribe to the live collaboration connection status. Re-renders on peer
 * join/leave and on sync. Returns `{ state: "solo" }` when there is no session.
 */
export function useCollabStatus(): CollabStatus {
  const { session } = useCollab();
  const [peers, setPeers] = useState(0);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!session) {
      setPeers(0);
      setSynced(false);
      return;
    }
    setSynced(session.synced);

    const onPeers = (e: { webrtcPeers?: unknown[]; bcPeers?: unknown[] }) => {
      const w = e.webrtcPeers?.length ?? 0;
      const b = e.bcPeers?.length ?? 0;
      setPeers(Math.max(w, b));
    };
    const onSynced = () => setSynced(true);

    session.provider.on("peers", onPeers);
    session.provider.on("synced", onSynced);
    return () => {
      session.provider.off("peers", onPeers);
      session.provider.off("synced", onSynced);
    };
  }, [session]);

  if (!session) return { state: "solo", peers: 0, synced: false };
  // A live session is "connected": the provider is up and on the mesh. A host
  // alone in a room (no peers, never syncs) is genuinely hosting, not stuck
  // "connecting" — the peer count, not this flag, conveys whether anyone else is
  // present. ("connecting" is reserved for the brief join-in-flight window,
  // surfaced separately via the context's `joining`.)
  return { state: "connected", peers, synced };
}

const pillBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: 20,
  padding: "0 8px",
  borderRadius: 10,
  fontSize: 11,
  fontFamily: "sans-serif",
  border: "1px solid rgba(0,0,0,0.2)",
  cursor: "default",
  userSelect: "none",
  whiteSpace: "nowrap",
};

const btnBase: React.CSSProperties = {
  height: 20,
  padding: "0 9px",
  borderRadius: 10,
  fontSize: 11,
  fontFamily: "sans-serif",
  border: "1px solid rgba(0,0,0,0.25)",
  background: "#f0f0f0",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function StatusDot({ color }: { color: string }): React.ReactElement {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

/**
 * The opt-in collaboration control. Lives in the EditBar right slot.
 */
export function CollabControls(): React.ReactElement {
  const { session, leave } = useCollab();
  const status = useCollabStatus();
  const [shareOpen, setShareOpen] = useState(false);

  const onLeave = useCallback(() => {
    leave();
  }, [leave]);

  if (!session) {
    return (
      <>
        <button
          type="button"
          data-testid="collab-collaborate-btn"
          title="Collaborate — share a live editing session with others"
          onClick={() => setShareOpen(true)}
          style={btnBase}
        >
          Collaborate…
        </button>
        {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
      </>
    );
  }

  const connected = status.state === "connected";
  const label =
    status.peers > 0
      ? `${status.peers} ${status.peers === 1 ? "peer" : "peers"}`
      : "waiting for peers";

  return (
    <>
      <button
        type="button"
        data-testid="collab-status-pill"
        title="Show the invite link / connection details"
        onClick={() => setShareOpen(true)}
        style={{
          ...pillBase,
          cursor: "pointer",
          background: connected ? "#e7f6e9" : "#fff7e0",
        }}
      >
        <StatusDot color={connected ? "#2faf4a" : "#e0a000"} />
        <span data-testid="collab-status-label">{label}</span>
      </button>
      <button
        type="button"
        data-testid="collab-leave-btn"
        title="Leave the collaboration session"
        onClick={onLeave}
        style={btnBase}
      >
        Leave
      </button>
      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
    </>
  );
}
