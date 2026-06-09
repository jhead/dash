/**
 * Fine-grained display object / instance property mutation helpers.
 *
 * These operate on a single Frame (the immutable value-object), returning a
 * new Frame with the requested change applied.  They complement the higher-
 * level `updateDisplayObject` helper in timeline.ts which operates on the
 * full Timeline tree.
 */

import type { Frame } from "./types.js";
import type { DisplayObject } from "../engine/types.js";

// ---------------------------------------------------------------------------
// Generic property setter
// ---------------------------------------------------------------------------

/**
 * Return a new Frame where the display object with `instanceId` has property
 * `prop` set to `value`.  All other display objects are left unchanged.
 * If no object with the given id exists the frame is returned as-is.
 */
export function setInstanceProperty<K extends keyof DisplayObject>(
  frame: Frame,
  instanceId: string,
  prop: K,
  value: DisplayObject[K],
): Frame {
  return {
    ...frame,
    displayObjects: frame.displayObjects.map((obj) =>
      obj.id === instanceId ? ({ ...obj, [prop]: value } as DisplayObject) : obj
    ),
  };
}

// ---------------------------------------------------------------------------
// Transform helper
// ---------------------------------------------------------------------------

/**
 * Subset of display-object fields that represent a 2-D transform / appearance.
 * All fields are optional so callers can supply only what they need.
 */
export interface InstanceTransform {
  readonly x?: number;
  readonly y?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly rotation?: number;
  readonly skewX?: number;
  readonly skewY?: number;
  /** Opacity 0–1.  Stored on SymbolInstance and BitmapDisplayObject as `alpha`. */
  readonly alpha?: number;
}

/**
 * Return a new Frame where the display object with `instanceId` has all
 * supplied transform fields merged in (shallow-spread).  Fields not present
 * in `transform` are preserved from the original object.
 * If no object with the given id exists the frame is returned as-is.
 */
export function setInstanceTransform(
  frame: Frame,
  instanceId: string,
  transform: InstanceTransform,
): Frame {
  return {
    ...frame,
    displayObjects: frame.displayObjects.map((obj) =>
      obj.id === instanceId ? ({ ...obj, ...transform } as DisplayObject) : obj
    ),
  };
}
