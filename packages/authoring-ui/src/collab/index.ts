/**
 * Optional P2P multiplayer — opt-in y-webrtc transport + shareable link
 * (task 1344 P1). Default OFF: nothing here constructs a provider, opens a
 * network/signaling connection, or creates awareness until `startCollab` /
 * `joinCollab` is explicitly called.
 *
 * Layers:
 *   - collabLink:    pure parse/generate of the `#room=…&k=…` share fragment.
 *   - signaling:     user-editable signaling-server config (handshake-only).
 *   - collabSession: the provider wiring (start = host / join = adopt-on-sync),
 *     bound to the document store's Y.Doc via the P0 `attachCollab` binding.
 */
export {
  type CollabLink,
  generateCollabLink,
  parseCollabLink,
  collabLinkToFragment,
  buildShareUrl,
} from "./collabLink.js";

export {
  DEFAULT_SIGNALING_SERVERS,
  parseSignalingServers,
  getSignalingServers,
  setSignalingServers,
} from "./signaling.js";

export {
  type CollabSession,
  type StartCollabOptions,
  startCollab,
  joinCollab,
} from "./collabSession.js";

// ---------------------------------------------------------------------------
// Phase 2 — awareness / presence (task 1345): live cursors, selection,
// scene/frame, tool, presence avatars, follow-a-peer, library editing badge.
// ---------------------------------------------------------------------------
export {
  type CollabUser,
  PRESENCE_COLORS,
  colorForId,
  createLocalUser,
  getLocalUser,
  setLocalUser,
} from "./localUser.js";

export {
  type AwarenessState,
  type PeerPresence,
  type PeerSelection,
  type PeerEditContext,
  type CursorPoint,
  uiStateToAwareness,
  asPeerPresence,
  changedAwarenessFields,
  symbolEditorsFromPeers,
} from "./awarenessState.js";

export {
  type AwarenessController,
  type AttachAwarenessOptions,
  attachAwareness,
  readPeers,
} from "./awareness.js";

export {
  CollabProvider,
  useCollab,
  usePeers,
  type CollabContextValue,
} from "./CollabContext.js";

export { RemoteCursorsOverlay } from "./RemoteCursorsOverlay.js";
export { PresenceAvatars } from "./PresenceAvatars.js";
