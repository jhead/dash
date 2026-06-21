/**
 * Incoming-link detection for the consent-gated join (task 1357).
 *
 * Tasks 1344/1354 made the address bar carry the `#room=…&k=…` fragment, but
 * NOTHING read it at app load — a freshly-navigated share link was inert. This
 * module is the pure decision layer for the JOINER half: it reads the current URL
 * fragment and decides whether it represents a join INVITATION that should raise a
 * consent prompt.
 *
 * The link IS the capability (the secret `k` lives only in the fragment, which the
 * inviter deliberately shared), so navigating to it is a genuine join intent — but
 * joining exposes the joiner's IP/presence to the other participants, so it must be
 * INFORMED. Hence: detect → CONSENT prompt → join, never a silent auto-connect.
 *
 * This module is intentionally PURE-of-React and DOM-free in its core logic: it
 * takes an injectable `Window`-like object so it is fully unit-testable with a mock
 * `location`, and it never constructs a provider or touches Yjs. The actual join
 * (and the address-bar canonicalization) is the caller's job, run only on confirm.
 */
import type { CollabLink } from "./collabLink.js";
import { parseCollabLink } from "./collabLink.js";
import { COLLAB_ENABLED_DEFAULT } from "../store/collabFlag.js";

/** The minimal browser surface this module needs (so tests can mock it). */
export interface AutoJoinWindowLike {
  readonly location: { readonly href: string };
}

/** Resolve the ambient window, or `null` in a non-browser/headless context. */
function resolveWindow(win?: AutoJoinWindowLike): AutoJoinWindowLike | null {
  if (win) return win;
  if (typeof window !== "undefined") {
    return window as unknown as AutoJoinWindowLike;
  }
  return null;
}

/**
 * Inspect the current URL fragment and return the parsed `CollabLink` IF it is a
 * join invitation we should consent-gate, or `null` otherwise.
 *
 * Returns `null` (no prompt) when:
 *   - collaboration is disabled by the feature flag (when `collabEnabled` is
 *     false — defaults to the build flag);
 *   - there is already a live session (`sessionLive` true) — the fragment we wrote
 *     on our OWN Start/Join must never re-trigger the prompt (1354 writes it via
 *     replaceState AFTER the session exists, so guarding on a live session breaks
 *     the self-join loop);
 *   - there is no window (headless / Node tests that did not inject one);
 *   - the fragment is absent or is not a collab link (`#room=…&k=…`).
 *
 * The caller runs this ONCE at mount, before any session exists, so a host's own
 * Start (which writes the fragment only after `session` becomes non-null) is never
 * mistaken for an incoming invitation.
 */
export function detectIncomingCollabLink(opts: {
  win?: AutoJoinWindowLike;
  sessionLive: boolean;
  collabEnabled?: boolean;
}): CollabLink | null {
  const collabEnabled = opts.collabEnabled ?? COLLAB_ENABLED_DEFAULT;
  // Note: COLLAB_ENABLED_DEFAULT gates only whether the SOLO app auto-prompts; a
  // navigated link is itself an explicit opt-in, so callers that always allow join
  // pass `collabEnabled: true`. Kept as a guard so a build can disable collab.
  if (!collabEnabled) return null;
  // A live session means the fragment is OURS (written on Start/Join) — never
  // re-prompt over it.
  if (opts.sessionLive) return null;
  const w = resolveWindow(opts.win);
  if (!w) return null;
  return parseCollabLink(w.location.href);
}
