import type { Frame } from "./types.js";

function moveItem<T>(arr: readonly T[], fromIdx: number, toIdx: number): T[] {
  if (fromIdx < 0 || fromIdx >= arr.length) return [...arr];
  const result = [...arr];
  const [item] = result.splice(fromIdx, 1);
  const clamped = Math.max(0, Math.min(toIdx, result.length));
  result.splice(clamped, 0, item);
  return result;
}

export function moveDisplayObjectUp(frame: Frame, objectId: string): Frame {
  const idx = frame.displayObjects.findIndex(d => d.id === objectId);
  if (idx < 0 || idx >= frame.displayObjects.length - 1) return frame;
  return { ...frame, displayObjects: moveItem(frame.displayObjects, idx, idx + 1) };
}

export function moveDisplayObjectDown(frame: Frame, objectId: string): Frame {
  const idx = frame.displayObjects.findIndex(d => d.id === objectId);
  if (idx <= 0) return frame;
  return { ...frame, displayObjects: moveItem(frame.displayObjects, idx, idx - 1) };
}

export function moveDisplayObjectToTop(frame: Frame, objectId: string): Frame {
  const idx = frame.displayObjects.findIndex(d => d.id === objectId);
  if (idx < 0) return frame;
  return { ...frame, displayObjects: moveItem(frame.displayObjects, idx, frame.displayObjects.length) };
}

export function moveDisplayObjectToBottom(frame: Frame, objectId: string): Frame {
  const idx = frame.displayObjects.findIndex(d => d.id === objectId);
  if (idx < 0) return frame;
  return { ...frame, displayObjects: moveItem(frame.displayObjects, idx, 0) };
}
