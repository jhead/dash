/**
 * Shared guard: does the Timeline panel currently own keyboard input?
 *
 * The Timeline panel registers its OWN `window` keydown listener that is scoped
 * to "the panel (or something inside it) is the focused element" — it self-grabs
 * focus on mousedown, and its shortcuts (F5/F6/F7 insert-frame, Left/Right frame
 * scrub, Enter play-toggle, Ctrl+C/X/V frame clipboard, Delete/Backspace remove
 * frame) only act while that focus holds.
 *
 * Independently, the Stage / global command handlers (`StageArea.tsx`'s
 * Enter-playback, Delete, and Ctrl+C/X/V/D clipboard listeners, plus the
 * `useCommandKeyboard` dispatcher) also listen on `window` and previously bailed
 * ONLY on Ruffle-player focus — never on Timeline focus. A single Delete keypress
 * with the Timeline focused therefore fired BOTH sides: it removed a frame AND
 * deleted the selected stage object (data loss). Enter toggled play twice (net
 * no-op); Ctrl+C/X/V copied/cut frames AND the shape clipboard at once.
 *
 * Just like `isWithinRufflePlayer` lets the Stage handlers yield to a focused
 * SWF, `isTimelinePanelFocused` lets them yield to a focused Timeline: when this
 * returns true the Stage/global handlers early-return, so the Timeline's
 * panel-scoped handler is the sole consumer of the keypress. This is a
 * containment check on `document.activeElement`, NOT `stopPropagation` — global
 * commands the Timeline does NOT consume (undo/redo, Save, Test Movie) keep
 * flowing to their own listeners.
 *
 * The marker `data-timeline-panel="true"` is set on the Timeline panel root in
 * `Timeline.tsx`.
 */

/** The attribute marking the Timeline panel root subtree. */
export const TIMELINE_PANEL_ATTR = "data-timeline-panel";

const SELECTOR = `[${TIMELINE_PANEL_ATTR}]`;

/**
 * True when keyboard focus is currently inside (or on) the Timeline panel.
 *
 * Defensive against environments without `document` / `closest`
 * (node/headless): returns false rather than throwing.
 */
export function isTimelinePanelFocused(): boolean {
  const active =
    typeof document !== "undefined" ? document.activeElement : null;
  return !!(
    active &&
    typeof active.closest === "function" &&
    active.closest(SELECTOR)
  );
}
