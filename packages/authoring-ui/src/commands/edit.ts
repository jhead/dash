import { getGoverningKeyframe } from "@flash/core";
import type { EditorCommand } from "./types.js";
import { resolveActiveTimeline, safeLayerIndex } from "../selectors/active.js";

export const editCommands: EditorCommand[] = [
  {
    id: "edit.selectAll",
    label: "Select All",
    category: "edit",
    shortcut: "Mod+A",
    run: (ctx) => {
      const doc = ctx.doc.getState().history.present;
      const ui = ctx.ui.getState();
      const t = resolveActiveTimeline(doc, ui);
      const layer = t.layers[safeLayerIndex(t, ui.activeLayerIndex)];
      if (!layer) return;
      const kf = getGoverningKeyframe(layer, ui.currentFrame);
      if (!kf || kf.displayObjects.length === 0) return;
      ui.setSelectedShapeIds(kf.displayObjects.map((o) => o.id));
    },
  },
  {
    id: "edit.deselectAll",
    label: "Deselect All",
    category: "edit",
    run: (ctx) => ctx.ui.getState().setSelectedShapeIds([]),
  },
];
