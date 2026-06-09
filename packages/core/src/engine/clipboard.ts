import type { Frame } from "../model/types.js";
import type { DisplayObject } from "./types.js";

function generateNewId(): string {
  return `obj-${Math.random().toString(36).slice(2)}`;
}

/** Returns copies of the specified display objects with new IDs */
export function copyDisplayObjects(
  frame: Frame,
  ids: string[]
): DisplayObject[] {
  return frame.displayObjects
    .filter(obj => ids.includes(obj.id))
    .map(obj => ({ ...obj, id: generateNewId() }));
}

/** Returns a new Frame with additional display objects pasted in */
export function pasteDisplayObjects(
  frame: Frame,
  objects: DisplayObject[]
): Frame {
  return { ...frame, displayObjects: [...frame.displayObjects, ...objects] };
}

/** Returns [copies, newFrame] — copies with new IDs, frame without originals */
export function cutDisplayObjects(
  frame: Frame,
  ids: string[]
): [DisplayObject[], Frame] {
  const copies = copyDisplayObjects(frame, ids);
  const newFrame = {
    ...frame,
    displayObjects: frame.displayObjects.filter(obj => !ids.includes(obj.id))
  };
  return [copies, newFrame];
}

/** Returns a new Frame with specified display objects removed */
export function deleteDisplayObjects(frame: Frame, ids: string[]): Frame {
  return {
    ...frame,
    displayObjects: frame.displayObjects.filter(obj => !ids.includes(obj.id))
  };
}
