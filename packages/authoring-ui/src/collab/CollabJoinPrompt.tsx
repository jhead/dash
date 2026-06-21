/**
 * Consent-gated join prompt for an incoming `#room=…&k=…` collab link (task 1357).
 *
 * When you NAVIGATE to a shared collaboration link, the app must not silently
 * connect you to a P2P session: joining exposes your IP/presence to the other
 * participants and merges a remote document over your local one. So the navigated
 * link (the capability) raises this CONSENT modal, and only on an explicit Join
 * click does the caller construct the y-webrtc provider and join.
 *
 * The modal reuses the Share dialog's HONEST disclosure (HonestNote) so the
 * joiner's exposure decision is as informed as the host's. Declining does NOT
 * join and clears the fragment so a reload doesn't re-prompt — it never clobbers
 * the user's local document (no join means `joinCollab` / `replaceDoc` never run).
 */
import React from "react";
import { HonestNote } from "./HonestNote.js";

export interface CollabJoinPromptProps {
  /** Confirm: join the session (caller constructs the provider + joins). */
  onConfirm: () => void;
  /** Decline: do not join; caller clears the fragment so a reload won't re-ask. */
  onDecline: () => void;
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10001,
};

const panel: React.CSSProperties = {
  width: 440,
  maxWidth: "90vw",
  background: "#f4f4f4",
  border: "1px solid #888",
  borderRadius: 6,
  boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
  fontFamily: "sans-serif",
  fontSize: 13,
  color: "#222",
  padding: 18,
};

const heading: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 15,
  fontWeight: "bold",
};

const primaryBtn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 4,
  border: "1px solid #2a5db0",
  background: "#3a73d6",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
};

const plainBtn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 4,
  border: "1px solid #999",
  background: "#eee",
  color: "#222",
  cursor: "pointer",
  fontSize: 13,
};

export function CollabJoinPrompt({
  onConfirm,
  onDecline,
}: CollabJoinPromptProps): React.ReactElement {
  return (
    <div
      style={overlay}
      data-testid="collab-join-prompt"
      onMouseDown={(e) => {
        // Click on the backdrop = decline (same as the explicit Dismiss).
        if (e.target === e.currentTarget) onDecline();
      }}
    >
      <div
        style={panel}
        role="dialog"
        aria-label="Join this collaboration session?"
      >
        <h2 style={heading}>Join this collaboration session?</h2>
        <div style={{ marginBottom: 2 }}>
          You'll connect to other participants (your IP becomes visible to them)
          and the shared document will load.
        </div>
        <HonestNote />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            data-testid="collab-join-prompt-decline"
            onClick={onDecline}
            style={plainBtn}
          >
            Dismiss
          </button>
          <button
            type="button"
            data-testid="collab-join-prompt-confirm"
            onClick={onConfirm}
            style={primaryBtn}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
}
