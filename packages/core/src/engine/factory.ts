/**
 * Factory helpers for creating DisplayObject instances with sensible defaults.
 *
 * These helpers construct valid DisplayObject values (SymbolInstance,
 * TextDisplayObject, ShapeDisplayObject) without requiring callers to supply
 * every optional field.
 */

import type {
  DisplayObject,
  SymbolInstance,
  TextDisplayObject,
  ShapeDisplayObject,
  Color,
  Shape,
} from "./types.js";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// SymbolInstance factory
// ---------------------------------------------------------------------------

/**
 * Create a SymbolInstance (type === "instance") with sensible defaults.
 *
 * @param symbolId     - Library symbol identifier.
 * @param instanceName - Optional AS2 instance name.
 * @param x            - Stage x position (default 0).
 * @param y            - Stage y position (default 0).
 */
export function createSymbolInstance(
  symbolId: string,
  instanceName?: string,
  x: number = 0,
  y: number = 0
): SymbolInstance {
  return {
    type: "instance",
    id: newId(),
    symbolId,
    instanceName,
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 1,
    blendMode: "normal",
  };
}

// ---------------------------------------------------------------------------
// TextDisplayObject factory
// ---------------------------------------------------------------------------

const DEFAULT_TEXT_COLOR: Color = { r: 0, g: 0, b: 0, a: 255 };

/**
 * Create a TextDisplayObject (type === "text") with sensible defaults.
 *
 * @param text     - Initial text content.
 * @param x        - Stage x position (default 0).
 * @param y        - Stage y position (default 0).
 * @param width    - Bounding box width in pixels (default 100).
 * @param height   - Bounding box height in pixels (default 20).
 */
export function createTextInstance(
  text: string,
  x: number = 0,
  y: number = 0,
  width: number = 100,
  height: number = 20
): TextDisplayObject {
  return {
    type: "text",
    id: newId(),
    x,
    y,
    width,
    height,
    text,
    textType: "static",
    fontFamily: "Arial",
    fontSize: 12,
    bold: false,
    italic: false,
    color: DEFAULT_TEXT_COLOR,
    align: "left",
    multiline: false,
    wordWrap: false,
  };
}

// ---------------------------------------------------------------------------
// ShapeDisplayObject factory
// ---------------------------------------------------------------------------

/**
 * Create a ShapeDisplayObject (type === "shape") with sensible defaults.
 *
 * @param shape - Shape definition (defaults to an empty shape).
 * @param x     - Stage x position (default 0).
 * @param y     - Stage y position (default 0).
 */
export function createShapeInstance(
  shape: Shape = { id: newId(), paths: [] },
  x: number = 0,
  y: number = 0
): ShapeDisplayObject {
  return {
    type: "shape",
    id: newId(),
    shape,
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/** Returns true if the value is a DisplayObject (has the required type field). */
export function isDisplayObject(value: unknown): value is DisplayObject {
  if (typeof value !== "object" || value === null) return false;
  const t = (value as Record<string, unknown>).type;
  return (
    t === "instance" ||
    t === "shape" ||
    t === "drawing-object" ||
    t === "text" ||
    t === "bitmap" ||
    t === "group"
  );
}
