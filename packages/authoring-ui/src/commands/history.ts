import type { EditorCommand } from "./types.js";
import { selectCanUndo, selectCanRedo } from "../store/documentStore.js";

export const historyCommands: EditorCommand[] = [
  {
    id: "history.undo",
    label: "Undo",
    category: "edit",
    shortcut: "Mod+Z",
    isEnabled: (ctx) => selectCanUndo(ctx.doc.getState()),
    run: (ctx) => ctx.doc.getState().undo(),
  },
  {
    id: "history.redo",
    label: "Redo",
    category: "edit",
    shortcut: "Mod+Shift+Z",
    isEnabled: (ctx) => selectCanRedo(ctx.doc.getState()),
    run: (ctx) => ctx.doc.getState().redo(),
  },
];
