import { useEffect, useRef } from "react";
import { isWithinRufflePlayer } from "./playerFocus.js";

export interface CommandKeyboardOptions {
  /** Dispatch a command by id (disabled commands no-op in the registry). */
  dispatch: (id: string) => void;
  /** Arrow-key nudge — dx/dy in px (Shift = 8, plain = 1). Not a command (carries args). */
  onNudge?: (dx: number, dy: number) => void;
}

/** The subset of KeyboardEvent the resolver reads (so it's testable without DOM). */
export interface KeyChord {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type KeyBinding =
  | { type: "command"; id: string; preventDefault: boolean }
  | { type: "nudge"; dx: number; dy: number }
  | null;

/**
 * Pure key-chord → binding resolver. Mirrors the previous useKeyboardShortcuts
 * if/else order exactly to preserve behaviour (F5/F6 ignore Shift; Escape and
 * Enter don't preventDefault; Delete is preventDefault'd even when edit.delete
 * ends up disabled at dispatch time).
 */
export function resolveKeyBinding(e: KeyChord): KeyBinding {
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const shift = !!e.shiftKey;
  const alt = !!e.altKey;
  const cmd = (id: string, preventDefault = true): KeyBinding => ({ type: "command", id, preventDefault });

  if (ctrl && !shift && e.key === "z") return cmd("history.undo");
  if (ctrl && shift && e.key === "z") return cmd("history.redo");
  if (ctrl && !shift && e.key === "y") return cmd("history.redo");
  if (ctrl && !shift && e.key === "c") return cmd("edit.copy");
  if (ctrl && !shift && e.key === "x") return cmd("edit.cut");
  if (ctrl && !shift && e.key === "v") return cmd("edit.paste");
  if (ctrl && shift && e.key === "v") return cmd("edit.pasteInPlace");
  if (e.key === "Delete" || e.key === "Backspace") return cmd("edit.delete");
  if (ctrl && !shift && e.key === "a") return cmd("edit.selectAll");
  if (e.key === "Escape") return cmd("edit.deselectAll", false);
  if (ctrl && !shift && e.key === "g") return cmd("edit.group");
  if (ctrl && shift && e.key === "g") return cmd("edit.ungroup");
  if (ctrl && !shift && e.key === "b") return cmd("edit.breakApart");
  if (e.key === "F5") return cmd("timeline.insertFrame");
  if (e.key === "F6") return cmd("timeline.insertKeyframe");
  if (e.key === "F7") return cmd("timeline.insertBlankKeyframe");
  if (ctrl && !shift && e.key === "d") return cmd("edit.duplicate");
  if (e.key === "Enter") return cmd("playback.toggle", false);
  if (ctrl && shift && e.key === "b") return cmd("text.bold");
  if (ctrl && shift && e.key === "i") return cmd("text.italic");
  if (ctrl && shift && e.key === "u") return cmd("text.underline");
  if (ctrl && shift && e.key === "l") return cmd("text.alignLeft");
  if (ctrl && shift && e.key === "e") return cmd("text.alignCenter");
  if (ctrl && shift && e.key === "r") return cmd("text.alignRight");
  if (ctrl && shift && e.key === "j") return cmd("text.alignJustify");
  if (ctrl && shift && e.key === "h") return cmd("shape.addHint");
  if (ctrl && !shift && e.key === "h") return cmd("edit.findReplace");
  if (!ctrl && alt && e.key === "ArrowRight") return cmd("text.trackingIncrease");
  if (!ctrl && alt && e.key === "ArrowLeft") return cmd("text.trackingDecrease");
  if (ctrl && alt && e.key === "ArrowRight") return cmd("text.trackingReset");
  if (!ctrl && !alt && e.key === "ArrowLeft") return { type: "nudge", dx: shift ? -8 : -1, dy: 0 };
  if (!ctrl && !alt && e.key === "ArrowRight") return { type: "nudge", dx: shift ? 8 : 1, dy: 0 };
  if (!ctrl && !alt && e.key === "ArrowUp") return { type: "nudge", dx: 0, dy: shift ? -8 : -1 };
  if (!ctrl && !alt && e.key === "ArrowDown") return { type: "nudge", dx: 0, dy: shift ? 8 : 1 };
  return null;
}

/**
 * Global keyboard → command dispatch. Replaces useKeyboardShortcuts: every
 * binding resolves to a command id dispatched through the registry, so the
 * keyboard shares one source of truth (and enabled-state) with the menu/agent.
 */
export function useCommandKeyboard(opts: CommandKeyboardOptions): void {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire while a Ruffle player (Test Movie / Live Preview) owns input.
      if (isWithinRufflePlayer(e)) return;
      // Don't fire while typing in an input/textarea.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const binding = resolveKeyBinding(e);
      if (!binding) return;
      const { dispatch, onNudge } = ref.current;
      if (binding.type === "nudge") {
        e.preventDefault();
        onNudge?.(binding.dx, binding.dy);
      } else {
        if (binding.preventDefault) e.preventDefault();
        dispatch(binding.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
