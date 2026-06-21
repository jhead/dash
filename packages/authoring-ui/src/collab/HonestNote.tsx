/**
 * The HONEST collaboration disclosure (docs 37) — shared by the Share dialog and
 * the incoming-link consent prompt (task 1357).
 *
 * Three load-bearing facts a user must see BEFORE they expose themselves to a
 * P2P session: the link grants full edit access, peers connect peer-to-peer over
 * WebRTC (so IP addresses are mutually visible), and the document data itself is
 * end-to-end encrypted with no server of ours in the middle. The consent gate on
 * a navigated `#room` link reuses this exact copy so the joiner's decision is as
 * informed as the host's.
 */
import React from "react";

export const honestNoteBox: React.CSSProperties = {
  background: "#fff6da",
  border: "1px solid #e3c969",
  borderRadius: 4,
  padding: "8px 10px",
  fontSize: 11.5,
  lineHeight: 1.45,
  margin: "12px 0",
  color: "#5b4a10",
};

export function HonestNote(): React.ReactElement {
  return (
    <div style={honestNoteBox} data-testid="collab-honest-note">
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
          directly between users — there is <strong>no server of ours</strong> in
          the middle (a public signaling server only brokers the initial
          handshake; it never sees your data or the key).
        </li>
      </ul>
    </div>
  );
}
