/**
 * Shared display-list utilities used across compiler passes.
 */
import type { DisplayObject } from "@flash/core";

/**
 * Flatten GroupObjects into a flat list of placeable DisplayObjects.
 *
 * GroupObject (type "group") is a container with x/y and children[]. It has no
 * SWF equivalent — instead, each child is placed directly on the stage with the
 * group's x/y accumulated into the child's own position. Nesting is handled by
 * accumulating dx/dy through recursive calls.
 *
 * Returns a flat array of non-group DisplayObjects with positions adjusted.
 */
export function flattenDisplayObjects(
  objs: readonly DisplayObject[],
  dx = 0,
  dy = 0
): DisplayObject[] {
  const result: DisplayObject[] = [];
  for (const obj of objs) {
    if (obj.type === "group") {
      // Recurse into children, accumulating the group's offset
      const childFlat = flattenDisplayObjects(
        obj.children,
        dx + obj.x,
        dy + obj.y
      );
      result.push(...childFlat);
    } else if (dx !== 0 || dy !== 0) {
      // Apply accumulated group offset to non-group child
      result.push({ ...obj, x: (obj.x ?? 0) + dx, y: (obj.y ?? 0) + dy } as DisplayObject);
    } else {
      result.push(obj);
    }
  }
  return result;
}
