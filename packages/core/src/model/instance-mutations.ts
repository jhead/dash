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
import { AS2_KEYWORDS } from "../as2/tokenizer.js";

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
// AS2 instance-name validation + setter
// ---------------------------------------------------------------------------

/**
 * AS2 identifier rule: first char is a letter, `_` or `$`; subsequent chars are
 * letters, digits, `_` or `$`. (ASCII only — matches the AS2 tokenizer, which
 * does not treat unicode letters as identifier chars.)
 */
const AS2_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Validate a string as an AS2 instance name. A valid instance name is a valid
 * AS2 identifier and not a reserved word — this is what AS2 needs to reference
 * the instance as `_root.<name>`. An empty string is treated as "clear the
 * name" and is considered valid (callers should map "" to undefined).
 *
 * Returns `{ ok: true }` when valid, otherwise `{ ok: false, error }` with a
 * human-readable reason suitable for surfacing to the agent.
 */
export function validateInstanceName(
  name: string,
): { ok: true } | { ok: false; error: string } {
  if (name === "") return { ok: true };
  if (!AS2_IDENTIFIER_RE.test(name)) {
    return {
      ok: false,
      error:
        `Invalid AS2 instance name "${name}". Names must start with a letter, ` +
        `_ or $, then contain only letters, digits, _ or $ (no spaces, dots, or ` +
        `other punctuation).`,
    };
  }
  if (AS2_KEYWORDS.has(name)) {
    return {
      ok: false,
      error:
        `Invalid AS2 instance name "${name}": it is a reserved ActionScript ` +
        `keyword and cannot be used as an instance name.`,
    };
  }
  return { ok: true };
}

/**
 * Return a new Frame where the display object with `instanceId` has its AS2
 * `instanceName` set to `name` (an empty string clears the name -> undefined).
 * Throws if `name` is not a valid AS2 instance name. If no object with the
 * given id exists the frame is returned unchanged.
 */
export function setInstanceName(
  frame: Frame,
  instanceId: string,
  name: string,
): Frame {
  const result = validateInstanceName(name);
  if (!result.ok) throw new Error(result.error);
  const instanceName = name === "" ? undefined : name;
  return {
    ...frame,
    displayObjects: frame.displayObjects.map((obj) =>
      obj.id === instanceId ? ({ ...obj, instanceName } as DisplayObject) : obj
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
