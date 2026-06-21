/**
 * Share dialog (collab P4 / docs 37) — the opt-in collaboration entry point.
 *
 * Three jobs, all behind an explicit user action (default OFF: nothing here
 * constructs a provider or opens a connection until the user clicks Start/Join):
 *
 *   1. START hosting — mint a fresh room + E2E key, seed the current document
 *      into the session, and show the invite link with a Copy button.
 *   2. JOIN — paste an invite link to connect to an existing session.
 *   3. SHOW the link of a live session (re-open to grab the link again).
 *
 * The HONEST note is non-negotiable (docs 37): collaborators connect peer-to-
 * peer over WebRTC, so their IP addresses are visible to one another; the link
 * grants FULL edit access to anyone who has it; but the document data itself is
 * end-to-end encrypted and flows directly between peers — there is no server of
 * ours in the middle.
 */
import React, { useCallback, useMemo, useState } from "react";
import { useCollab } from "./CollabContext.js";
import { parseCollabLink } from "./collabLink.js";

export interface ShareDialogProps {
  onClose: () => void;
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10000,
};

const panel: React.CSSProperties = {
  width: 460,
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
  margin: "0 0 12px",
  fontSize: 15,
  fontWeight: "bold",
};

const noteBox: React.CSSProperties = {
  background: "#fff6da",
  border: "1px solid #e3c969",
  borderRadius: 4,
  padding: "8px 10px",
  fontSize: 11.5,
  lineHeight: 1.45,
  margin: "12px 0",
  color: "#5b4a10",
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

function HonestNote(): React.ReactElement {
  return (
    <div style={noteBox} data-testid="collab-honest-note">
      <strong>Before you share:</strong>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        <li>
          Anyone with this link gets <strong>full edit access</strong> to the
          document — treat it like a password.
        </li>
        <li>
          Collaborators connect <strong>peer-to-peer over WebRTC</strong>, so
          their IP addresses are visible to one another.
        </li>
        <li>
          Your document is <strong>end-to-end encrypted</strong> and travels
          directly between peers — there is <strong>no server of ours</strong> in
          the middle (a public signaling server only brokers the initial
          handshake; it never sees your data or the key).
        </li>
      </ul>
    </div>
  );
}

export function ShareDialog({ onClose }: ShareDialogProps): React.ReactElement {
  const { session, start, join, joining } = useCollab();
  const [joinInput, setJoinInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareUrl = useMemo(() => {
    if (!session) return "";
    const base =
      typeof window !== "undefined"
        ? window.location.origin + window.location.pathname
        : "";
    return session.shareUrl(base);
  }, [session]);

  const onStart = useCallback(() => {
    setError(null);
    try {
      start();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [start]);

  const onJoin = useCallback(async () => {
    setError(null);
    const link = parseCollabLink(joinInput.trim());
    if (!link) {
      setError("That doesn't look like a collaboration link (need #room=…&k=…).");
      return;
    }
    try {
      await join(link);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [join, joinInput]);

  const onCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the field is selectable as a fallback.
      setError("Couldn't copy automatically — select the link and copy it.");
    }
  }, [shareUrl]);

  return (
    <div
      style={overlay}
      data-testid="collab-share-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={panel} role="dialog" aria-label="Share collaboration session">
        <h2 style={heading}>
          {session ? "Collaboration session" : "Collaborate"}
        </h2>

        {session ? (
          <>
            <div style={{ marginBottom: 6 }}>
              Share this link to invite collaborators:
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                data-testid="collab-share-link"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  fontFamily: "monospace",
                  fontSize: 11,
                  border: "1px solid #999",
                  borderRadius: 4,
                }}
              />
              <button
                type="button"
                data-testid="collab-copy-link"
                onClick={onCopy}
                style={primaryBtn}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <HonestNote />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={onClose} style={plainBtn}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 4 }}>
              Start a live session others can join, or paste an invite link to
              join one.
            </div>
            <HonestNote />

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                data-testid="collab-start-btn"
                onClick={onStart}
                style={primaryBtn}
              >
                Start collaborating
              </button>
            </div>

            <div
              style={{
                margin: "14px 0 6px",
                fontSize: 11,
                color: "#666",
                textAlign: "center",
              }}
            >
              — or join an existing session —
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                data-testid="collab-join-input"
                placeholder="Paste invite link (#room=…&k=…)"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  fontSize: 12,
                  border: "1px solid #999",
                  borderRadius: 4,
                }}
              />
              <button
                type="button"
                data-testid="collab-join-btn"
                onClick={onJoin}
                disabled={joining}
                style={{ ...primaryBtn, opacity: joining ? 0.6 : 1 }}
              >
                {joining ? "Joining…" : "Join"}
              </button>
            </div>

            {error && (
              <div
                data-testid="collab-share-error"
                style={{ color: "#b00020", fontSize: 11.5, marginTop: 8 }}
              >
                {error}
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 14,
              }}
            >
              <button type="button" onClick={onClose} style={plainBtn}>
                Cancel
              </button>
            </div>
          </>
        )}

        {session && error && (
          <div
            data-testid="collab-share-error"
            style={{ color: "#b00020", fontSize: 11.5, marginTop: 8 }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
