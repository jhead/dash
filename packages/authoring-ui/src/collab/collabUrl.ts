/**
 * Address-bar reflection of the live collab session (task 1354).
 *
 * The Figma / Google-Docs model: when you START or JOIN a session the browser's
 * address bar becomes the shareable room link, so the URL itself is the thing you
 * copy/bookmark and it reflects the live session. When you LEAVE, the collab
 * fragment is cleared so a stale link never lingers.
 *
 * Two hard rules carried over from the share-link design (collabLink.ts):
 *
 *   1. The secret lives ONLY in the URL **fragment** (`#room=…&k=…`). Browsers do
 *      not transmit the fragment to any server, so writing it into the address bar
 *      is still a no-server-round-trip operation — the capability never leaves the
 *      machine over the wire.
 *   2. Use `history.replaceState`, NOT `pushState`. The session link is a state of
 *      the current page, not a navigation; pushing it would pollute the back/
 *      forward history (and leak the key into more history entries). Replacing it
 *      keeps exactly one entry whose fragment tracks the current session.
 *
 * This module is intentionally tiny and PURE-of-React: it takes an injectable
 * `Window`-like object so it is fully unit-testable with a mock `history`/
 * `location` and never touches the real DOM in tests.
 */
import type { CollabLink } from "./collabLink.js";
import { collabLinkToFragment, parseCollabLink } from "./collabLink.js";

/** The minimal browser surface this module needs (so tests can mock it). */
export interface UrlWindowLike {
  readonly location: { readonly href: string };
  readonly history: {
    readonly state?: unknown;
    replaceState(data: unknown, unused: string, url?: string | null): void;
  };
}

/** Resolve the ambient window, or `null` in a non-browser/headless context. */
function resolveWindow(win?: UrlWindowLike): UrlWindowLike | null {
  if (win) return win;
  if (typeof window !== "undefined") return window as unknown as UrlWindowLike;
  return null;
}

/** Strip any existing `#fragment` from a full URL, keeping origin+path+search. */
function stripFragment(href: string): string {
  const hashIdx = href.indexOf("#");
  return hashIdx === -1 ? href : href.slice(0, hashIdx);
}

/**
 * Preserve whatever state the current history entry carries when we only want to
 * swap the URL. `history.state` may be absent on a mock; read it defensively.
 */
function historyState(w: UrlWindowLike): unknown {
  return w.history.state ?? null;
}

/**
 * Reflect a live session into the address bar: set the URL fragment to the share
 * link (`#room=…&k=…`) via `history.replaceState`. Origin, path, and query string
 * are preserved; only the fragment is replaced. No-op (returns false) when there
 * is no window (headless / Node tests that did not inject one).
 */
export function writeCollabFragment(
  link: CollabLink,
  win?: UrlWindowLike,
): boolean {
  const w = resolveWindow(win);
  if (!w) return false;
  const next = stripFragment(w.location.href) + collabLinkToFragment(link);
  // replaceState (NOT pushState): the session is page state, not navigation, and
  // we must not push the secret-bearing fragment into the back/forward history.
  w.history.replaceState(historyState(w), "", next);
  return true;
}

/**
 * Clear the collab fragment from the address bar (on Leave/stop) IF — and only
 * if — the current fragment is a collab link. A non-collab fragment (some other
 * app/router hash) is left untouched so we never stomp unrelated state. No-op
 * (returns false) when there is no window or no collab fragment to clear.
 */
export function clearCollabFragment(win?: UrlWindowLike): boolean {
  const w = resolveWindow(win);
  if (!w) return false;
  const href = w.location.href;
  // Only clear OUR fragment: if the hash doesn't parse as a collab link, leave it.
  if (!parseCollabLink(href)) return false;
  w.history.replaceState(historyState(w), "", stripFragment(href));
  return true;
}
