/**
 * Document-wide Find and Replace — pure functions for searching and replacing
 * text content, font faces, fill/stroke colors, and symbol references.
 *
 * All functions are pure: they take a FlashDocument and return new data
 * without mutating the input.
 */

import type { FlashDocument } from "./types.js";
import type {
  DisplayObject,
  TextDisplayObject,
  SymbolInstance,
  ShapeDisplayObject,
  DrawingObject,
  ShapePath,
  Color,
} from "../engine/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FindReplaceType = "text" | "font" | "color" | "symbol";

export interface FindReplaceCriteria {
  /** Which kind of search to perform. */
  type: FindReplaceType;
  /** For type "text": the string to search for. */
  searchText?: string;
  /** For type "font": the font family name to search for (case-insensitive). */
  searchFont?: string;
  /** For type "color": the hex color string to match (e.g. "#ff0000"). */
  searchColor?: string;
  /** For type "symbol": the library symbol id to search for. */
  searchSymbolId?: string;
  /** Whether the text search is case-sensitive (type "text" only). Default false. */
  caseSensitive?: boolean;
  /** Whether to match whole words only (type "text" only). Default false. */
  wholeWord?: boolean;
  /**
   * Scope of the search.
   * "current"  — search only doc.scenes[scopeSceneIndex]
   * "all"      — search all scenes (default)
   */
  scope?: "current" | "all";
  /** When scope is "current", which scene to limit to. */
  scopeSceneIndex?: number;
}

/** Location of a single match within the document. */
export interface MatchLocation {
  sceneIndex: number;
  layerIndex: number;
  frameIndex: number;
  /** Index of the display object within the frame's displayObjects array. */
  objectIndex: number;
  /** ID of the display object. */
  objectId: string;
  /** Human-readable path: "Scene N > Layer Name > Frame F > objectId/instanceName". */
  description: string;
}

export interface FindReplaceReplacement {
  /** For type "text": replacement string. */
  replaceText?: string;
  /** For type "font": replacement font family name. */
  replaceFont?: string;
  /** For type "color": replacement hex color string. */
  replaceColor?: string;
  /** For type "symbol": replacement library symbol id. */
  replaceSymbolId?: string;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Color (r/g/b/a) to lowercase hex string "#rrggbb" (alpha ignored).
 */
function colorToHex(c: Color): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

/**
 * Parse a CSS hex string ("#rrggbb" or "#rgb") to a Color.
 * Returns null if the string is not a valid hex color.
 */
function hexToColorParsed(hex: string): Color | null {
  const clean = hex.replace(/^#/, "").toLowerCase();
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16);
    const g = parseInt(clean[1]! + clean[1]!, 16);
    const b = parseInt(clean[2]! + clean[2]!, 16);
    return { r, g, b, a: 255 };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return { r, g, b, a: 255 };
  }
  return null;
}

/** Compare two hex color strings (case-insensitive, alpha ignored). */
function hexColorsMatch(a: string, b: string): boolean {
  return a.toLowerCase().replace(/^#/, "") === b.toLowerCase().replace(/^#/, "");
}

// ---------------------------------------------------------------------------
// Text matching helpers
// ---------------------------------------------------------------------------

function textMatches(
  content: string,
  searchText: string,
  caseSensitive: boolean,
  wholeWord: boolean
): boolean {
  if (!caseSensitive) {
    content = content.toLowerCase();
    searchText = searchText.toLowerCase();
  }
  if (wholeWord) {
    const re = new RegExp(`(?<![\\w])${escapeRegex(searchText)}(?![\\w])`);
    return re.test(content);
  }
  return content.includes(searchText);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Per-object matching
// ---------------------------------------------------------------------------

function objectMatchesText(
  obj: DisplayObject,
  criteria: FindReplaceCriteria
): boolean {
  if (obj.type !== "text") return false;
  const t = obj as TextDisplayObject;
  const search = criteria.searchText ?? "";
  if (!search) return false;
  return textMatches(
    t.text,
    search,
    criteria.caseSensitive ?? false,
    criteria.wholeWord ?? false
  );
}

function objectMatchesFont(
  obj: DisplayObject,
  criteria: FindReplaceCriteria
): boolean {
  if (obj.type !== "text") return false;
  const t = obj as TextDisplayObject;
  const search = criteria.searchFont ?? "";
  if (!search) return false;
  return t.fontFamily.toLowerCase() === search.toLowerCase();
}

function shapePathMatchesColor(path: ShapePath, searchHex: string): boolean {
  if (path.fill?.type === "solid") {
    if (hexColorsMatch(colorToHex(path.fill.color), searchHex)) return true;
  }
  if (path.stroke?.type === "solid") {
    if (hexColorsMatch(colorToHex(path.stroke.color), searchHex)) return true;
  }
  return false;
}

function objectMatchesColor(
  obj: DisplayObject,
  criteria: FindReplaceCriteria
): boolean {
  const searchHex = criteria.searchColor ?? "";
  if (!searchHex) return false;
  if (obj.type === "shape") {
    const s = obj as ShapeDisplayObject;
    return s.shape.paths.some((p) => shapePathMatchesColor(p, searchHex));
  }
  if (obj.type === "drawing-object") {
    const d = obj as DrawingObject;
    return d.shape.paths.some((p) => shapePathMatchesColor(p, searchHex));
  }
  if (obj.type === "text") {
    const t = obj as TextDisplayObject;
    return hexColorsMatch(colorToHex(t.color), searchHex);
  }
  return false;
}

function objectMatchesSymbol(
  obj: DisplayObject,
  criteria: FindReplaceCriteria
): boolean {
  if (obj.type !== "instance") return false;
  const inst = obj as SymbolInstance;
  return inst.symbolId === criteria.searchSymbolId;
}

function objectMatchesCriteria(
  obj: DisplayObject,
  criteria: FindReplaceCriteria
): boolean {
  switch (criteria.type) {
    case "text":   return objectMatchesText(obj, criteria);
    case "font":   return objectMatchesFont(obj, criteria);
    case "color":  return objectMatchesColor(obj, criteria);
    case "symbol": return objectMatchesSymbol(obj, criteria);
    default:       return false;
  }
}

// ---------------------------------------------------------------------------
// findInDocument
// ---------------------------------------------------------------------------

/**
 * Walk the document and return all locations that match the given criteria.
 * Searches `doc.scenes[].timeline.layers[].frames[].displayObjects`.
 */
export function findInDocument(
  doc: FlashDocument,
  criteria: FindReplaceCriteria
): MatchLocation[] {
  const results: MatchLocation[] = [];

  const scenesToSearch =
    criteria.scope === "current" && criteria.scopeSceneIndex !== undefined
      ? [{ scene: doc.scenes[criteria.scopeSceneIndex], index: criteria.scopeSceneIndex }]
      : doc.scenes.map((scene, index) => ({ scene, index }));

  for (const { scene, index: sceneIndex } of scenesToSearch) {
    if (!scene) continue;
    const layers = scene.timeline.layers;
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex]!;
      for (const frame of layer.frames) {
        if (!frame.isKeyframe) continue;
        for (let objIndex = 0; objIndex < frame.displayObjects.length; objIndex++) {
          const obj = frame.displayObjects[objIndex]!;
          if (objectMatchesCriteria(obj, criteria)) {
            const displayName =
              (obj as { instanceName?: string }).instanceName ?? obj.id;
            results.push({
              sceneIndex,
              layerIndex,
              frameIndex: frame.index,
              objectIndex: objIndex,
              objectId: obj.id,
              description: `Scene ${sceneIndex + 1} > ${layer.name} > Frame ${frame.index + 1} > ${displayName}`,
            });
          }
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Per-object replacement
// ---------------------------------------------------------------------------

function replaceObjectText(
  obj: TextDisplayObject,
  criteria: FindReplaceCriteria,
  replacement: FindReplaceReplacement
): TextDisplayObject {
  const search = criteria.searchText ?? "";
  const replace = replacement.replaceText ?? "";
  const cs = criteria.caseSensitive ?? false;
  const ww = criteria.wholeWord ?? false;

  let newText: string;
  if (ww) {
    const flags = cs ? "g" : "gi";
    const re = new RegExp(`(?<![\\w])${escapeRegex(search)}(?![\\w])`, flags);
    newText = obj.text.replace(re, replace);
  } else {
    if (cs) {
      newText = obj.text.split(search).join(replace);
    } else {
      const re = new RegExp(escapeRegex(search), "gi");
      newText = obj.text.replace(re, replace);
    }
  }
  return { ...obj, text: newText };
}

function replaceObjectFont(
  obj: TextDisplayObject,
  replacement: FindReplaceReplacement
): TextDisplayObject {
  const newFont = replacement.replaceFont;
  if (!newFont) return obj;
  return { ...obj, fontFamily: newFont };
}

function replaceShapePathColor(
  path: ShapePath,
  searchHex: string,
  replaceHex: string
): ShapePath {
  const newColor = hexToColorParsed(replaceHex);
  if (!newColor) return path;

  let changed = false;
  let newFill = path.fill;
  let newStroke = path.stroke;

  if (path.fill?.type === "solid" && hexColorsMatch(colorToHex(path.fill.color), searchHex)) {
    newFill = { type: "solid", color: { ...newColor, a: path.fill.color.a } };
    changed = true;
  }
  if (path.stroke?.type === "solid" && hexColorsMatch(colorToHex(path.stroke.color), searchHex)) {
    newStroke = { ...path.stroke, color: { ...newColor, a: path.stroke.color.a } };
    changed = true;
  }

  if (!changed) return path;
  return { ...path, fill: newFill, stroke: newStroke };
}

function replaceObjectColor(
  obj: DisplayObject,
  searchHex: string,
  replaceHex: string
): DisplayObject {
  if (obj.type === "shape") {
    const s = obj as ShapeDisplayObject;
    const newPaths = s.shape.paths.map((p) =>
      replaceShapePathColor(p, searchHex, replaceHex)
    );
    return { ...s, shape: { ...s.shape, paths: newPaths } };
  }
  if (obj.type === "drawing-object") {
    const d = obj as DrawingObject;
    const newPaths = d.shape.paths.map((p) =>
      replaceShapePathColor(p, searchHex, replaceHex)
    );
    return { ...d, shape: { ...d.shape, paths: newPaths } };
  }
  if (obj.type === "text") {
    const t = obj as TextDisplayObject;
    if (hexColorsMatch(colorToHex(t.color), searchHex)) {
      const newColor = hexToColorParsed(replaceHex);
      if (newColor) return { ...t, color: { ...newColor, a: t.color.a } };
    }
    return obj;
  }
  return obj;
}

function replaceObjectSymbol(
  obj: SymbolInstance,
  replacement: FindReplaceReplacement
): SymbolInstance {
  const newId = replacement.replaceSymbolId;
  if (!newId) return obj;
  return { ...obj, symbolId: newId };
}

/**
 * Apply a replacement to a single matching display object.
 * Returns the new display object (pure).
 */
function applyReplacementToObject(
  obj: DisplayObject,
  criteria: FindReplaceCriteria,
  replacement: FindReplaceReplacement
): DisplayObject {
  switch (criteria.type) {
    case "text":
      if (obj.type === "text")
        return replaceObjectText(obj as TextDisplayObject, criteria, replacement);
      break;
    case "font":
      if (obj.type === "text")
        return replaceObjectFont(obj as TextDisplayObject, replacement);
      break;
    case "color":
      return replaceObjectColor(obj, criteria.searchColor ?? "", replacement.replaceColor ?? "");
    case "symbol":
      if (obj.type === "instance")
        return replaceObjectSymbol(obj as SymbolInstance, replacement);
      break;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// replaceInDocument (single match)
// ---------------------------------------------------------------------------

/**
 * Apply a replacement to a single match location in the document.
 * Returns a new FlashDocument (pure — the input is not mutated).
 */
export function replaceInDocument(
  doc: FlashDocument,
  match: MatchLocation,
  replacement: FindReplaceReplacement,
  criteria: FindReplaceCriteria
): FlashDocument {
  const newScenes = doc.scenes.map((scene, si) => {
    if (si !== match.sceneIndex) return scene;
    const newLayers = scene.timeline.layers.map((layer, li) => {
      if (li !== match.layerIndex) return layer;
      const newFrames = layer.frames.map((frame) => {
        if (frame.index !== match.frameIndex || !frame.isKeyframe) return frame;
        const newObjects = frame.displayObjects.map((obj) => {
          if (obj.id !== match.objectId) return obj;
          return applyReplacementToObject(obj, criteria, replacement);
        });
        return { ...frame, displayObjects: newObjects };
      });
      return { ...layer, frames: newFrames };
    });
    return { ...scene, timeline: { ...scene.timeline, layers: newLayers } };
  });
  return { ...doc, scenes: newScenes };
}

// ---------------------------------------------------------------------------
// replaceAllInDocument
// ---------------------------------------------------------------------------

/**
 * Apply a replacement to ALL matches in the document.
 * Returns a new FlashDocument (pure).
 */
export function replaceAllInDocument(
  doc: FlashDocument,
  criteria: FindReplaceCriteria,
  replacement: FindReplaceReplacement
): FlashDocument {
  const matches = findInDocument(doc, criteria);
  // Build a set of (sceneIndex, layerIndex, frameIndex, objectId) for quick lookup
  type MatchKey = `${number}:${number}:${number}:${string}`;
  const matchSet = new Set<MatchKey>(
    matches.map((m) => `${m.sceneIndex}:${m.layerIndex}:${m.frameIndex}:${m.objectId}` as MatchKey)
  );

  const newScenes = doc.scenes.map((scene, si) => {
    const newLayers = scene.timeline.layers.map((layer, li) => {
      const newFrames = layer.frames.map((frame) => {
        if (!frame.isKeyframe) return frame;
        const newObjects = frame.displayObjects.map((obj) => {
          const key: MatchKey = `${si}:${li}:${frame.index}:${obj.id}`;
          if (!matchSet.has(key)) return obj;
          return applyReplacementToObject(obj, criteria, replacement);
        });
        return { ...frame, displayObjects: newObjects };
      });
      return { ...layer, frames: newFrames };
    });
    return { ...scene, timeline: { ...scene.timeline, layers: newLayers } };
  });
  return { ...doc, scenes: newScenes };
}
