import {
  insertFrame,
  insertKeyframe,
  insertBlankKeyframe,
  removeFrame,
  clearKeyframe,
  type Timeline,
} from "@flash/core";
import type { CommandContext, EditorCommand } from "./types.js";
import { resolveActiveTimeline, withActiveTimeline, activeLayerId } from "../selectors/active.js";

/** Whether there is an active layer to operate on. */
function hasActiveLayer(ctx: CommandContext): boolean {
  const doc = ctx.doc.getState().history.present;
  const ui = ctx.ui.getState();
  const t = resolveActiveTimeline(doc, ui);
  return activeLayerId(t, ui.activeLayerIndex) != null;
}

/** Apply a timeline edit at the active layer/frame and push it to history. */
function applyAtActiveFrame(
  ctx: CommandContext,
  edit: (t: Timeline, layerId: string, frame: number) => Timeline
): void {
  const doc = ctx.doc.getState().history.present;
  const ui = ctx.ui.getState();
  const t = resolveActiveTimeline(doc, ui);
  const layerId = activeLayerId(t, ui.activeLayerIndex);
  if (!layerId) return;
  const next = withActiveTimeline(doc, ui, (tt) => edit(tt, layerId, ui.currentFrame));
  (ctx.services.pushDoc ?? ctx.doc.getState().pushDoc)(next);
}

export const timelineCommands: EditorCommand[] = [
  {
    id: "timeline.insertFrame",
    label: "Insert Frame",
    category: "timeline",
    shortcut: "F5",
    isEnabled: hasActiveLayer,
    run: (ctx) => applyAtActiveFrame(ctx, insertFrame),
  },
  {
    id: "timeline.insertKeyframe",
    label: "Insert Keyframe",
    category: "timeline",
    shortcut: "F6",
    isEnabled: hasActiveLayer,
    run: (ctx) => applyAtActiveFrame(ctx, insertKeyframe),
  },
  {
    id: "timeline.insertBlankKeyframe",
    label: "Insert Blank Keyframe",
    category: "timeline",
    shortcut: "F7",
    isEnabled: hasActiveLayer,
    run: (ctx) => applyAtActiveFrame(ctx, insertBlankKeyframe),
  },
  {
    id: "timeline.removeFrame",
    label: "Remove Frame",
    category: "timeline",
    shortcut: "Shift+F5",
    isEnabled: hasActiveLayer,
    run: (ctx) => applyAtActiveFrame(ctx, removeFrame),
  },
  {
    id: "timeline.clearKeyframe",
    label: "Clear Keyframe",
    category: "timeline",
    shortcut: "Shift+F6",
    isEnabled: hasActiveLayer,
    run: (ctx) => applyAtActiveFrame(ctx, clearKeyframe),
  },
];
