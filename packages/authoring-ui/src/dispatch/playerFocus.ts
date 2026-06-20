/**
 * Shared guard: is a keyboard event "owned" by a running Ruffle player?
 *
 * The authoring app registers many GLOBAL (`window`-level) `keydown` listeners —
 * tool-shortcut hotkeys, arrow-key nudge of selected stage objects, Test Movie /
 * zoom / panel toggles, clipboard, arrange/group, etc. When the user is
 * interacting with a running SWF inside a Ruffle player (the Test Movie modal OR
 * the Live Preview tab), those keys belong to the SWF, not to the editor: arrow
 * keys must drive the game, not nudge a selected shape; letter keys must reach
 * AVM1, not switch the active tool.
 *
 * Ruffle delivers keys to the SWF via its OWN `window` keydown listener, gated on
 * an internal focus flag set when the `<ruffle-player>` host receives focus
 * (a real click on the player is required — focus is load-bearing). So when the
 * player is focused, the genuine key target/`activeElement` is inside the player's
 * DOM subtree. We therefore SUPPRESS the authoring handlers (and skip
 * `preventDefault`) whenever the event originates inside a Ruffle host, while
 * Ruffle's separate window listener still receives the key — the SWF keeps
 * working (Key.isDown, onClipEvent(keyDown), …) and the editor stays quiet.
 *
 * We must NOT instead `stopPropagation()` on the player container: Ruffle's own
 * listener is ALSO on `window`, so stopping propagation to window would block the
 * SWF too. A containment check in each authoring handler is the correct mechanism.
 *
 * The marker is `data-ruffle-host="true"`, set on the RufflePlayer container in
 * `@flash/player`. Both the Test Movie modal and the Live Preview panel embed that
 * component, so this one check covers both.
 */

/** The attribute marking a RufflePlayer container subtree. */
export const RUFFLE_HOST_ATTR = "data-ruffle-host";

const SELECTOR = `[${RUFFLE_HOST_ATTR}]`;

/**
 * True when `node` is inside (or is) a Ruffle player host subtree.
 *
 * Defensive against non-Element nodes (text nodes, `window`, `document`) and
 * environments without `closest` (jsdom/headless).
 */
function isInsideRuffleHost(node: EventTarget | Node | null): boolean {
  let el: Element | null = null;
  if (node && typeof (node as Element).closest === "function") {
    el = node as Element;
  } else if (node && (node as Node).parentElement) {
    el = (node as Node).parentElement;
  }
  if (el && el.closest(SELECTOR)) return true;
  // Fall back to the document's focused element: covers the case where the key
  // event's `target` is `window`/`document` (Ruffle registers on `window`) but
  // focus is genuinely inside the player.
  const active =
    typeof document !== "undefined" ? document.activeElement : null;
  if (active && typeof active.closest === "function" && active.closest(SELECTOR)) {
    return true;
  }
  return false;
}

/**
 * Should the authoring app's global keyboard handlers IGNORE this event because a
 * Ruffle player (Test Movie / Live Preview) currently owns keyboard input?
 *
 * Returns true when the event target — or, failing that, the document's
 * `activeElement` — is within a `data-ruffle-host` subtree.
 */
export function isWithinRufflePlayer(e: { target?: EventTarget | null }): boolean {
  return isInsideRuffleHost(e?.target ?? null);
}
