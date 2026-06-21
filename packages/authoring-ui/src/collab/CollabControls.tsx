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
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCollab } from "./CollabContext.js";
import { ShareDialog } from "./ShareDialog.js";
import { CollabJoinPrompt } from "./CollabJoinPrompt.js";
import { detectIncomingCollabLink } from "./collabAutoJoin.js";
import { clearCollabFragment } from "./collabUrl.js";
import type { CollabLink } from "./collabLink.js";
import { peerCountAdvice } from "./peerCount.js";

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
 *
 * Participant count comes from the AWARENESS controller (the CURRENT set of
 * present peers — `awareness.getStates()` minus self), NOT y-webrtc's
 * connection-level `peers` event (task 1365). The connection event has NO TTL:
 * an unclean leave (tab close, network drop, crash) lingers in
 * `room.webrtcConns/bcConns` forever and never emits a shrunk array, so the old
 * `Math.max(webrtcPeers, bcPeers)` count only ever GREW — it stuck at the
 * high-water-mark and never decremented. Awareness, by contrast, prunes on a
 * clean leave instantly (`setLocalState(null)`) and on an unclean drop within
 * ~30 s (the built-in `outdatedTimeout`), so deriving the count from it makes
 * the pill DECREMENT on leave/disconnect/timeout and agree with the presence
 * avatars (which already read awareness via `usePeers` — a single source of
 * truth). The connection `peers` event stays the authority for signaling/
 * reconnect health (reconnect.ts); it is just not the participant-count source.
 */
export function useCollabStatus(): CollabStatus {
  const { session } = useCollab();
  const controller = session?.awarenessController;
  const [peers, setPeers] = useState(() => controller?.getPeers().length ?? 0);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!session) {
      setPeers(0);
      setSynced(false);
      return;
    }
    setSynced(session.synced);

    const onSynced = () => setSynced(true);
    session.provider.on("synced", onSynced);

    // Recompute the count from the CURRENT awareness state map on every change
    // (awareness fires for added, updated, AND removed/timed-out clients), so a
    // leave/disconnect/TTL-drop SHRINKS the count — it is never an append-only
    // tally. `getPeers()` reads `awareness.getStates()` minus self each time.
    let unsubPeers: (() => void) | undefined;
    if (controller) {
      setPeers(controller.getPeers().length);
      unsubPeers = controller.onPeersChange((p) => setPeers(p.length));
    } else {
      // A session with no awareness controller (headless / pre-presence) has no
      // present peers to count.
      setPeers(0);
    }

    return () => {
      session.provider.off("synced", onSynced);
      unsubPeers?.();
    };
  }, [session, controller]);

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
  const { session, join, leave } = useCollab();
  const status = useCollabStatus();
  const [shareOpen, setShareOpen] = useState(false);

  // Consent-gated auto-join (task 1357). On mount, if the address bar carries an
  // incoming `#room=…&k=…` invitation AND there is no live session yet, raise a
  // CONSENT prompt — we never silently connect (joining exposes the joiner's IP/
  // presence and merges a remote doc over the local one). The detection runs ONCE
  // before any session exists, so the fragment we ourselves write on Start/Join
  // (task 1354, via replaceState AFTER `session` is set) never re-triggers it.
  const [incomingLink, setIncomingLink] = useState<CollabLink | null>(null);
  const detectedRef = useRef(false);
  useEffect(() => {
    if (detectedRef.current) return;
    detectedRef.current = true;
    // A navigated link is itself an explicit opt-in, so allow the prompt even
    // though the solo-app collab default is off.
    const link = detectIncomingCollabLink({
      sessionLive: session !== null,
      collabEnabled: true,
    });
    if (link) setIncomingLink(link);
    // Run exactly once at mount (the deps are intentionally empty).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onConfirmJoin = useCallback(() => {
    const link = incomingLink;
    setIncomingLink(null);
    if (!link) return;
    // join() also re-writes the canonical fragment (task 1354), so the address bar
    // stays the room link. Errors surface in the Share dialog if the user re-opens.
    void join(link).catch(() => {
      /* swallow — the session simply isn't established; local doc is intact. */
    });
  }, [incomingLink, join]);

  const onDeclineJoin = useCallback(() => {
    setIncomingLink(null);
    // Clear the fragment so a reload doesn't re-prompt. We DID NOT join, so the
    // local document is untouched (joinCollab / replaceDoc never ran).
    clearCollabFragment();
  }, []);

  const onLeave = useCallback(() => {
    leave();
  }, [leave]);

  const joinPrompt = incomingLink ? (
    <CollabJoinPrompt onConfirm={onConfirmJoin} onDecline={onDeclineJoin} />
  ) : null;

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
        {joinPrompt}
      </>
    );
  }

  const connected = status.state === "connected";
  const advice = peerCountAdvice(status.peers);
  const label =
    status.peers > 0
      ? `${status.peers} ${status.peers === 1 ? "user" : "users"}`
      : "waiting for others";
  // A high peer count overrides the green "connected" tint with an amber warning
  // tint, so the N^2-mesh degradation is visible at a glance.
  const pillBg = advice.warn ? "#fdeede" : connected ? "#e7f6e9" : "#fff7e0";
  const dotColor = advice.warn ? "#d06000" : connected ? "#2faf4a" : "#e0a000";

  return (
    <>
      <button
        type="button"
        data-testid="collab-status-pill"
        data-peer-warn={advice.warn ? "true" : "false"}
        title={
          advice.warn
            ? advice.message
            : "Show the invite link / connection details"
        }
        onClick={() => setShareOpen(true)}
        style={{
          ...pillBase,
          cursor: "pointer",
          background: pillBg,
        }}
      >
        <StatusDot color={dotColor} />
        <span data-testid="collab-status-label">{label}</span>
        {advice.warn && (
          <span data-testid="collab-peer-warn" title={advice.message}>
            ⚠
          </span>
        )}
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
      {joinPrompt}
    </>
  );
}
