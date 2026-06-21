/**
 * Peer-count realism (collab P5 / docs 37 §13) — graceful behavior + a clear UI
 * message past a soft threshold.
 *
 * y-webrtc forms a FULL MESH: every peer holds a direct WebRTC connection to
 * every other peer, so the number of connections grows O(N^2). Each peer also
 * re-broadcasts every CRDT update and awareness change to all its links, so both
 * bandwidth and CPU per peer scale ~linearly with N (and the mesh's total
 * connection count quadratically). This is fine for a handful of collaborators
 * (the realistic Flash-authoring case) but degrades past ~15 peers — connection
 * setup time climbs, cursor presence gets jittery, and a weak peer can stall.
 *
 * We deliberately impose NO artificial cap (the transport keeps working and
 * convergence stays correct — Yjs guarantees that regardless of N), but we DO
 * set expectations: once the peer count crosses the soft threshold the presence
 * UI shows a non-blocking warning so the user understands why things may slow
 * down and can split into smaller rooms.
 */

/**
 * Soft threshold (number of OTHER peers) past which we surface a degradation
 * warning. Not a cap — collaboration keeps working; this only sets expectations.
 * 15 chosen as the point where the N^2 mesh setup + per-peer fan-out cost starts
 * to be noticeable in practice for a WebRTC full mesh.
 */
export const PEER_COUNT_WARN_THRESHOLD = 15;

/** Severity of the peer-count condition. */
export type PeerCountSeverity = "ok" | "high";

export interface PeerCountAdvice {
  severity: PeerCountSeverity;
  /** Total participants including the local user (peers + 1). */
  participants: number;
  /** Whether to show the high-peer-count warning. */
  warn: boolean;
  /** A short, human-readable message (empty when `severity === "ok"`). */
  message: string;
}

/**
 * Pure mapping from a peer count to UI advice. `peers` is the number of OTHER
 * peers (as reported by the provider), so participant count is `peers + 1`.
 */
export function peerCountAdvice(peers: number): PeerCountAdvice {
  const safe = Number.isFinite(peers) && peers > 0 ? Math.floor(peers) : 0;
  const participants = safe + 1;
  const warn = participants > PEER_COUNT_WARN_THRESHOLD;
  return {
    severity: warn ? "high" : "ok",
    participants,
    warn,
    message: warn
      ? `${participants} users are in this session. ` +
        `Collaboration uses a peer-to-peer mesh, so large groups (over ` +
        `${PEER_COUNT_WARN_THRESHOLD}) can get slow or unstable — consider ` +
        `splitting into smaller rooms.`
      : "",
  };
}
