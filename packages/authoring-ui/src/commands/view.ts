import type { CommandContext, EditorCommand } from "./types.js";
import { withProperties } from "../store/documentStore.js";

/** Toggle a boolean field on doc.properties.grid and push to history. */
function toggleGrid(ctx: CommandContext, key: "showGrid" | "snapToGrid"): void {
  const doc = ctx.doc.getState().history.present;
  const next = withProperties(doc, (p) => ({ ...p, grid: { ...p.grid, [key]: !p.grid[key] } }));
  (ctx.services.pushDoc ?? ctx.doc.getState().pushDoc)(next);
}

/** Toggle a boolean field directly on doc.properties and push to history. */
function toggleProp(ctx: CommandContext, key: "snapToObjects" | "snapToGuides"): void {
  const doc = ctx.doc.getState().history.present;
  const next = withProperties(doc, (p) => ({ ...p, [key]: !p[key] }));
  (ctx.services.pushDoc ?? ctx.doc.getState().pushDoc)(next);
}

export const viewCommands: EditorCommand[] = [
  {
    id: "view.toggleRulers",
    label: "Rulers",
    category: "view",
    run: (ctx) => ctx.ui.getState().setShowRulers((v) => !v),
  },
  {
    id: "view.toggleSnapToPixels",
    label: "Snap to Pixels",
    category: "view",
    run: (ctx) => ctx.ui.getState().setSnapToPixels((v) => !v),
  },
  {
    id: "view.toggleGrid",
    label: "Show Grid",
    category: "view",
    run: (ctx) => toggleGrid(ctx, "showGrid"),
  },
  {
    id: "view.toggleSnapToGrid",
    label: "Snap to Grid",
    category: "view",
    run: (ctx) => toggleGrid(ctx, "snapToGrid"),
  },
  {
    id: "view.toggleSnapToObjects",
    label: "Snap to Objects",
    category: "view",
    run: (ctx) => toggleProp(ctx, "snapToObjects"),
  },
  {
    id: "view.toggleSnapToGuides",
    label: "Snap to Guides",
    category: "view",
    run: (ctx) => toggleProp(ctx, "snapToGuides"),
  },
];
