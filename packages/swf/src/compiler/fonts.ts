/**
 * Font subsetting / embedding helpers.
 *
 * (The three font pre-passes that emit DefineFont3/AlignZones are threaded
 * through CompileContext by the orchestrator; this module currently owns
 * {@link collectFontFaceRequests}, which the publish flow calls ahead of
 * compilation to resolve real system-font outlines for exactly the embedded
 * glyphs. It deliberately mirrors the compiler's subsetting logic.)
 */
import type { DisplayObject, FlashDocument, FontItem, Layer, Symbol, TextDisplayObject } from "@flash/core";
import { fontKey, computeEmbedCodePoints, FULL_CODE_POINTS } from "../fonts.js";

/**
 * Collect the embedded font-face requests for a document: one entry per unique
 * `fontKey(family, bold, italic)` used by a text field (or a font library item),
 * with the exact set of code points the published SWF will embed for that face.
 *
 * This mirrors compileDocument's font subsetting so the publish flow can resolve
 * real system-font outlines (via the async Local Font Access API pre-pass,
 * {@link resolveFontGlyphSources}) for exactly the glyphs that will be embedded,
 * then hand the result back through {@link CompileOptions.fontGlyphSources}.
 */
export function collectFontFaceRequests(
  doc: FlashDocument
): Array<{ family: string; bold: boolean; italic: boolean; codePoints: number[] }> {
  // Recursively walk display objects (including groups) gathering text fields.
  const walkText = (objs: readonly DisplayObject[], out: TextDisplayObject[]) => {
    for (const obj of objs) {
      if (obj.type === "group") walkText(obj.children, out);
      else if (obj.type === "text") out.push(obj);
    }
  };

  const faceInfo = new Map<string, { family: string; bold: boolean; italic: boolean; cps: Set<number> }>();
  const ensure = (family: string, bold: boolean, italic: boolean) => {
    const key = fontKey(family, bold, italic);
    let info = faceInfo.get(key);
    if (!info) {
      info = { family, bold, italic, cps: new Set<number>() };
      faceInfo.set(key, info);
    }
    return info;
  };

  const accumulate = (layers: readonly Layer[]) => {
    for (const layer of layers) {
      if (layer.type === "guide" || layer.type === "folder") continue;
      for (const frame of layer.frames) {
        if (!frame.isKeyframe) continue;
        const texts: TextDisplayObject[] = [];
        walkText(frame.displayObjects, texts);
        for (const obj of texts) {
          const info = ensure(obj.fontFamily, obj.bold, obj.italic);
          if (obj.embedRanges !== undefined) {
            for (const c of computeEmbedCodePoints(obj.embedRanges, obj.embedChars, obj.text)) info.cps.add(c);
          } else if (obj.textType === "static") {
            for (const c of computeEmbedCodePoints([], obj.embedChars, obj.text)) info.cps.add(c);
          }
          // Dynamic/input without explicit embedRanges: contributes nothing.
        }
      }
    }
  };

  for (const s of doc.scenes) accumulate(s.timeline.layers);
  for (const item of doc.library.items) {
    if (item.itemType === "symbol") accumulate((item as Symbol).timeline.layers);
    else if (item.itemType === "font") {
      const fi = item as FontItem;
      ensure(fi.fontName, fi.bold, fi.italic);
    }
  }

  return [...faceInfo.values()].map((info) => ({
    family: info.family,
    bold: info.bold,
    italic: info.italic,
    // Empty (e.g. font used only by un-embedded dynamic fields) → full default,
    // matching compileDocument's fallback so the resolved source covers the same
    // glyphs the font tag will embed.
    codePoints: info.cps.size > 0 ? [...info.cps].sort((a, b) => a - b) : [...FULL_CODE_POINTS],
  }));
}
