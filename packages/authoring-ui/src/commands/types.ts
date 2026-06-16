import type { FlashDocument } from "@flash/core";
import type { DocumentStoreApi } from "../store/documentStore.js";
import type { UiStoreApi } from "../store/uiStore.js";

/**
 * Side-effecting services a command may need that live outside the stores:
 * the rev-bumping document mutator and component-coupled behaviour (playback's
 * RAF loop, publish/compile, stage screenshot). This is the escape hatch that
 * lets store-coupled command logic live in command modules while genuinely
 * component-bound bits stay in Shell. Optional so partial contexts (tests) are
 * cheap to build.
 */
export interface CommandServices {
  /** Record a document mutation AND bump the agent rev (Shell's pushDoc). */
  pushDoc?: (next: FlashDocument) => void;
  startPlayback?: () => void;
  stopPlayback?: () => void;
  publish?: () => Promise<void> | void;
  testMovie?: () => Promise<void> | void;
  screenshot?: (frameIndex?: number) => string;
  /**
   * Component-coupled editor operations that still live as Shell handlers
   * (clipboard, grouping, text formatting, …). Their commands delegate here so
   * menu/keyboard/agent share one dispatch surface today; the logic migrates
   * into command modules incrementally. See commands/editor.ts.
   */
  editor?: EditorActions;
}

/** The not-yet-fully-migrated editor operations, delegated to Shell handlers. */
export interface EditorActions {
  copy(): void;
  cut(): void;
  paste(): void;
  pasteInPlace(): void;
  deleteSelected(): void;
  duplicate(): void;
  group(): void;
  ungroup(): void;
  breakApart(): void;
  bringToFront(): void;
  sendToBack(): void;
  textBold(): void;
  textItalic(): void;
  textUnderline(): void;
  textAlignLeft(): void;
  textAlignCenter(): void;
  textAlignRight(): void;
  textAlignJustify(): void;
  textTrackingIncrease(): void;
  textTrackingDecrease(): void;
  textTrackingReset(): void;
  addShapeHint(): void;
  toggleFindReplace(): void;
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
