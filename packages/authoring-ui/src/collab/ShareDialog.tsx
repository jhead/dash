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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useCollab } from "./CollabContext.js";
import { parseCollabLink } from "./collabLink.js";
import {
  DEFAULT_SIGNALING_SERVERS,
  getSignalingServers,
  parseSignalingServers,
  setSignalingServers,
} from "./signaling.js";
import { peerCountAdvice } from "./peerCount.js";
import { useCollabStatus } from "./CollabControls.js";
import { HonestNote, honestNoteBox } from "./HonestNote.js";

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

/**
 * The editable signaling-server field (P5 fallback / ops). The signaling server
 * only brokers the WebRTC handshake — but if every configured server is down a
 * NEW peer can never find an existing one, so we let the user point at their own
 * (the y-webrtc repo ships a one-file Node signaling server) or list several for
 * redundancy. Persisted in localStorage; takes effect on the NEXT start/join.
 */
function SignalingSettings(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => getSignalingServers().join("\n"));
  const [saved, setSaved] = useState(false);

  const onSave = useCallback(() => {
    setSignalingServers(value);
    // Re-read so the field shows the normalized (validated/deduped) list and
    // falls back to the default if the user cleared it or typed only garbage.
    setValue(getSignalingServers().join("\n"));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [value]);

  const onReset = useCallback(() => {
    setSignalingServers("");
    setValue(getSignalingServers().join("\n"));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, []);

  const parsed = parseSignalingServers(value);
  const usingDefault =
    parsed.length === DEFAULT_SIGNALING_SERVERS.length &&
    parsed.every((u, i) => u === DEFAULT_SIGNALING_SERVERS[i]);

  return (
    <div style={{ marginTop: 14, fontSize: 11.5 }}>
      <button
        type="button"
        data-testid="collab-signaling-toggle"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "none",
          border: "none",
          color: "#36c",
          cursor: "pointer",
          padding: 0,
          fontSize: 11.5,
          textDecoration: "underline",
        }}
      >
        {open ? "▾" : "▸"} Signaling server
        {usingDefault ? " (using public default)" : " (custom)"}
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: "#666", marginBottom: 4 }}>
            One URL per line (<code>wss://…</code>). The signaling server only
            brokers the connection — it never sees your data or key. If you can't
            connect, the public server may be down; run your own or list several.
          </div>
          <textarea
            data-testid="collab-signaling-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            spellCheck={false}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontFamily: "monospace",
              fontSize: 11,
              border: "1px solid #999",
              borderRadius: 4,
              padding: "4px 6px",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button
              type="button"
              data-testid="collab-signaling-save"
              onClick={onSave}
              style={{ ...plainBtn, padding: "3px 10px", fontSize: 11.5 }}
            >
              {saved ? "Saved" : "Save"}
            </button>
            <button
              type="button"
              data-testid="collab-signaling-reset"
              onClick={onReset}
              style={{ ...plainBtn, padding: "3px 10px", fontSize: 11.5 }}
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ShareDialog({ onClose }: ShareDialogProps): React.ReactElement {
  const { session, start, join, joining } = useCollab();
  const status = useCollabStatus();
  const peerAdvice = peerCountAdvice(status.peers);
  const [joinInput, setJoinInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // P5: live signaling health. y-webrtc keeps existing P2P links alive even with
  // the signaling server down, but a NEW peer can't find the room without it, so
  // we surface the condition with a clear pointer at the editable URL field.
  const [signalingDown, setSignalingDown] = useState(false);
  useEffect(() => {
    if (!session) {
      setSignalingDown(false);
      return;
    }
    setSignalingDown(!session.signalingConnected);
    return session.reconnect.onSignalingChange((connected) =>
      setSignalingDown(!connected),
    );
  }, [session]);

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
            {peerAdvice.warn && (
              <div
                data-testid="collab-peer-warn-banner"
                style={{
                  ...honestNoteBox,
                  background: "#fdeede",
                  borderColor: "#e0a060",
                  color: "#6a3500",
                }}
              >
                <strong>Large session ({peerAdvice.participants} people).</strong>{" "}
                {peerAdvice.message}
              </div>
            )}
            {signalingDown && (
              <div
                data-testid="collab-signaling-down"
                style={{
                  ...honestNoteBox,
                  background: "#fdecec",
                  borderColor: "#e09a9a",
                  color: "#7a1f1f",
                }}
              >
                <strong>Signaling server unreachable.</strong> Peers already
                connected stay connected, but no one new can join until a
                signaling server is reachable. Check your connection or set a
                different server below.
              </div>
            )}
            <HonestNote />
            <SignalingSettings />
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

            <SignalingSettings />

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
