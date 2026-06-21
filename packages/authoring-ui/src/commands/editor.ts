import type { CommandContext, EditorActions, EditorCommand } from "./types.js";

/** Delegate to a Shell-provided EditorActions method (no-op if not wired). */
function run(fn: (e: EditorActions) => void): (ctx: CommandContext) => void {
  return (ctx) => {
    const e = ctx.services.editor;
    if (e) fn(e);
  };
}

const hasSelection = (ctx: CommandContext): boolean => {
  const ui = ctx.ui.getState();
  // A vector shape selected via the Selection tool goes into the planar
  // SUBSELECTION model, not selectedShapeIds (the planar-merge P5 cutover made
  // partial-select always-on for the Selection tool). Delete must be enabled for
  // EITHER selection model, else Delete/Backspace no-op on a selected vector
  // shape (task 1361).
  if (ui.selectedShapeIds.length > 0) return true;
  const sub = ui.subSelection;
  return sub != null && sub.keys.length > 0;
};

/**
 * Commands for editor operations whose logic still lives as Shell handlers
 * (clipboard, grouping, arrange, text formatting, shape hints). They delegate
 * via services so menu/keyboard/agent dispatch them by id today; bodies migrate
 * into modules over time. `shortcut` is the display label — the actual key
 * bindings live in dispatch/keyboard.ts (which dispatches these same ids).
 */
export const editorCommands: EditorCommand[] = [
  { id: "edit.copy", label: "Copy", category: "edit", shortcut: "Mod+C", run: run((e) => e.copy()) },
  { id: "edit.cut", label: "Cut", category: "edit", shortcut: "Mod+X", run: run((e) => e.cut()) },
  { id: "edit.paste", label: "Paste", category: "edit", shortcut: "Mod+V", run: run((e) => e.paste()) },
  { id: "edit.pasteInPlace", label: "Paste in Place", category: "edit", shortcut: "Mod+Shift+V", run: run((e) => e.pasteInPlace()) },
  // Delete was the one keyboard op explicitly gated on a selection (old onDelete).
  { id: "edit.delete", label: "Delete", category: "edit", shortcut: "Delete", isEnabled: hasSelection, run: run((e) => e.deleteSelected()) },
  { id: "edit.duplicate", label: "Duplicate", category: "edit", shortcut: "Mod+D", run: run((e) => e.duplicate()) },
  { id: "edit.group", label: "Group", category: "modify", shortcut: "Mod+G", run: run((e) => e.group()) },
  { id: "edit.ungroup", label: "Ungroup", category: "modify", shortcut: "Mod+Shift+G", run: run((e) => e.ungroup()) },
  { id: "edit.breakApart", label: "Break Apart", category: "modify", shortcut: "Mod+B", run: run((e) => e.breakApart()) },
  { id: "edit.bringToFront", label: "Bring to Front", category: "modify", run: run((e) => e.bringToFront()) },
  { id: "edit.sendToBack", label: "Send to Back", category: "modify", run: run((e) => e.sendToBack()) },
  { id: "edit.findReplace", label: "Find and Replace", category: "edit", shortcut: "Mod+H", run: run((e) => e.toggleFindReplace()) },
  { id: "text.bold", label: "Bold", category: "text", shortcut: "Mod+Shift+B", run: run((e) => e.textBold()) },
  { id: "text.italic", label: "Italic", category: "text", shortcut: "Mod+Shift+I", run: run((e) => e.textItalic()) },
  { id: "text.underline", label: "Underline", category: "text", shortcut: "Mod+Shift+U", run: run((e) => e.textUnderline()) },
  { id: "text.alignLeft", label: "Align Left", category: "text", shortcut: "Mod+Shift+L", run: run((e) => e.textAlignLeft()) },
  { id: "text.alignCenter", label: "Align Center", category: "text", shortcut: "Mod+Shift+E", run: run((e) => e.textAlignCenter()) },
  { id: "text.alignRight", label: "Align Right", category: "text", shortcut: "Mod+Shift+R", run: run((e) => e.textAlignRight()) },
  { id: "text.alignJustify", label: "Justify", category: "text", shortcut: "Mod+Shift+J", run: run((e) => e.textAlignJustify()) },
  { id: "text.trackingIncrease", label: "Increase Tracking", category: "text", shortcut: "Alt+Right", run: run((e) => e.textTrackingIncrease()) },
  { id: "text.trackingDecrease", label: "Decrease Tracking", category: "text", shortcut: "Alt+Left", run: run((e) => e.textTrackingDecrease()) },
  { id: "text.trackingReset", label: "Reset Tracking", category: "text", shortcut: "Mod+Alt+Right", run: run((e) => e.textTrackingReset()) },
  { id: "shape.addHint", label: "Add Shape Hint", category: "modify", shortcut: "Mod+Shift+H", run: run((e) => e.addShapeHint()) },
];
