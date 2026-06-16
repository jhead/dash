import type { DocumentStoreApi } from "../store/documentStore.js";
import type { UiStoreApi } from "../store/uiStore.js";

/**
 * Side-effecting services a command may need that live outside the stores
 * (publish/compile, stage screenshot, file IO, …). Grown as commands migrate
 * off Shell. Optional so partial contexts (tests) stay cheap to build.
 */
export interface CommandServices {
  publish?: () => Promise<void>;
  testMovie?: () => Promise<void>;
  screenshot?: (frameIndex?: number) => string;
}

/**
 * Everything a command's `run`/`isEnabled` may read or mutate. Commands receive
 * the raw store handles (getState/setState) so they work identically whether
 * invoked from React (menu/keyboard) or non-React callers (agent/JSFL).
 */
export interface CommandContext {
  doc: DocumentStoreApi;
  ui: UiStoreApi;
  services: CommandServices;
}

/**
 * A single editor operation — the one place its id, label, shortcut, enabled
 * predicate, and behavior are defined. MenuBar, keyboard, agent, and JSFL all
 * dispatch these by id (named `EditorCommand` to avoid clashing with the
 * history `Command` type exported by @flash/core).
 */
export interface EditorCommand<Args = void> {
  /** Stable dotted id, e.g. "timeline.insertKeyframe". */
  id: string;
  /** Human label for menus. */
  label: string;
  /** Grouping for menus/palette, e.g. "edit", "timeline". */
  category?: string;
  /** Keyboard shortcut spec, e.g. "Ctrl+Shift+H", "F6", "Mod+Z". */
  shortcut?: string;
  /** When false, menu item is greyed out and dispatch is a no-op. Default: enabled. */
  isEnabled?: (ctx: CommandContext) => boolean;
  /** Perform the operation. */
  run: (ctx: CommandContext, args: Args) => void | Promise<void>;
}

/** Convenience: a command with no run-args. */
export type EditorCommandAny = EditorCommand<any>;
