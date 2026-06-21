/**
 * Presence avatars (task 1345 P2) — who's here, with colors + names.
 *
 * A compact row of circular initial-chips, one per remote peer (plus the local
 * user), each in that peer's color. Clicking a remote peer's chip "follows" them
 * — jumps the local view to their scene/frame/edit-context (handled by the
 * caller via `onFollow`). Hovering shows the name + where they are.
 *
 * Solo / no peers: renders nothing.
 */
import React from "react";
import type { CollabUser } from "./localUser.js";
import type { PeerPresence } from "./awarenessState.js";

export interface PresenceAvatarsProps {
  localUser: CollabUser;
  peers: PeerPresence[];
  /** Follow a peer: jump to their scene/frame/edit-context. */
  onFollow?: (peer: PeerPresence) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function locationLabel(peer: PeerPresence): string {
  if (peer.editContext.mode === "symbol") {
    return `editing ${peer.editContext.symbolName ?? "a symbol"} · frame ${peer.frame + 1}`;
  }
  return `scene ${peer.scene + 1} · frame ${peer.frame + 1}`;
}

const chipBase: React.CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 9,
  fontWeight: "bold",
  color: "#fff",
  fontFamily: "sans-serif",
  border: "1.5px solid #fff",
  boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
  flexShrink: 0,
  userSelect: "none",
};

export function PresenceAvatars({
  localUser,
  peers,
  onFollow,
}: PresenceAvatarsProps): React.ReactElement | null {
  if (peers.length === 0) return null;

  return (
    <div
      data-testid="collab-presence-avatars"
      style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}
    >
      {/* Local user (you) — non-clickable. */}
      <div
        data-testid="collab-presence-self"
        title={`${localUser.name} (you)`}
        style={{ ...chipBase, background: localUser.color }}
      >
        {initials(localUser.name)}
      </div>
      {peers.map((peer) => (
        <button
          key={peer.clientId}
          data-testid="collab-presence-peer"
          title={`${peer.user.name} — ${locationLabel(peer)} (click to follow)`}
          onClick={() => onFollow?.(peer)}
          style={{
            ...chipBase,
            background: peer.user.color,
            cursor: onFollow ? "pointer" : "default",
            padding: 0,
          }}
        >
          {initials(peer.user.name)}
        </button>
      ))}
    </div>
  );
}
