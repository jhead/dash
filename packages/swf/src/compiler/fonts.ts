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
import { fontKey, computeEmbedCodePoints, FULL_CODE_POINTS, encodeDefineFont2, encodeDefineFontAlignZones } from "../fonts.js";
import type { GlyphSource } from "../font-extract.js";
import { Tag } from "../tags.js";
import { SwfWriter } from "../writer.js";
import { flattenDisplayObjects } from "./display.js";
import type { CompileOptions } from "./options.js";

/**
 * Outputs of the font pre-pass that downstream passes (text character
 * definitions, sprite/button emission) consume.
 */
export interface FontPassResult {
  /** fontKey(family,bold,italic) → SWF character ID of its DefineFont3/2. */
  fontCharIdMap: Map<string, number>;
  /** fontKey → sorted code points embedded for that face. */
  embedCodePointsByKey: Map<string, number[]>;
  /** fontKey → code-point → glyph-index map (subsetted fonts only). */
  glyphIndexMapByFontKey: Map<string, ReadonlyMap<number, number>>;
  /** Build a code-point → glyph-index map for a font key (for DefineText). */
  glyphIndexMapForKey: (key: string) => ReadonlyMap<number, number>;
}

/**
 * Font pre-pass: walk every scene + symbol timeline (and FontItem library
 * entries), collect the unique font faces used by text fields, subset their
 * embedded glyphs, and emit a DefineFont3 (or DefineFont2) + DefineFontAlignZones
 * tag for each — BEFORE any DefineText/DefineEditText that references them.
 *
 * Returns the lookups downstream passes need to resolve a font's character ID
 * and per-glyph indices. Byte-for-byte identical to the inline pass it replaces.
 */
export function runFontPass(
  writer: SwfWriter,
  doc: FlashDocument,
  options: CompileOptions | undefined
): FontPassResult {
  // For SWF v8 we prefer DefineFont3 (tag 75, UTF-16) over DefineFont2 (tag 48,
  // UCS-2). The tag body format is identical — only the tag code differs.
  // useFont3 defaults to true; pass useFont3: false to emit DefineFont2 instead.
  const useFont3 = options?.useFont3 !== false;
  const fontTagCode = useFont3 ? Tag.DefineFont3 : Tag.DefineFont2;
  // DefineFont3 stores glyph coordinates in a 20×-larger EM square than
  // DefineFont2; emit glyph outlines at the matching scale so Ruffle renders
  // them at the correct size.
  const fontCoordScale = useFont3 ? 20 : 1;
  const fontCharIdMap = new Map<string, number>();

  // Collect the set of font keys used by at least one "Auto kern" text field.
  // Those fonts get the DefineFont2/3 KerningTable so the player can apply pair
  // kerning; all other fonts emit KerningCount = 0. Walk both scene and symbol
  // timelines (the same surfaces the font pre-passes below cover).
  const kernedFontKeys = new Set<string>();
  {
    const scanFrames = (layers: readonly Layer[]) => {
      for (const layer of layers) {
        if (layer.type === "guide" || layer.type === "folder") continue;
        for (const frame of layer.frames) {
          if (!frame.isKeyframe) continue;
          for (const obj of flattenDisplayObjects(frame.displayObjects)) {
            if (obj.type === "text" && obj.autoKern) {
              kernedFontKeys.add(fontKey(obj.fontFamily, obj.bold, obj.italic));
            }
          }
        }
      }
    };
    for (const s of doc.scenes) scanFrames(s.timeline.layers);
    for (const item of doc.library.items) {
      if (item.itemType !== "symbol") continue;
      scanFrames((item as Symbol).timeline.layers);
    }
  }

  // ---------------------------------------------------------------------------
  // Font glyph subsetting ("Embed…" character ranges) — auto-subset by default.
  //
  // For each embedded font we compute the set of printable-ASCII code points to
  // embed. A font is shared (deduplicated by fontKey) across every field that
  // uses the same face/bold/italic, but the embed selection is per FIELD, so the
  // embedded set is the UNION of every field's selection.
  //
  // DEFAULT for STATIC text (no explicit embedRanges): auto-subset to the glyphs
  // the field's own text actually uses (plus space 0x20) — matching real Flash 8,
  // which embeds only the on-stage glyphs for static text. Static text is
  // immutable at runtime, so subsetting to its content is exact and safe.
  //
  // DYNAMIC / INPUT text (no explicit embedRanges): renders with DEVICE fonts
  // (UseOutlines=0), so its glyphs are NOT embedded. Such a field contributes
  // nothing to the embedded glyph set. (If a font face is used ONLY by such
  // fields, the set would be empty; we fall back to the full default set below
  // so the font tag is still well-formed for any outline path.)
  //
  // EXPLICIT embedRanges (task 1182): the field unions the named ranges, the
  // specific "include these characters", AND its own text (plus space).
  //
  // embedCodePointsByKey: fontKey → sorted code-point array embedded for that font.
  // glyphIndexByKey:      fontKey → code-point → glyph-index map for DefineText.
  // ---------------------------------------------------------------------------
  const embedCodePointsByKey = new Map<string, number[]>();
  {
    const unionByKey = new Map<string, Set<number>>();
    const accumulate = (layers: readonly Layer[]) => {
      for (const layer of layers) {
        if (layer.type === "guide" || layer.type === "folder") continue;
        for (const frame of layer.frames) {
          if (!frame.isKeyframe) continue;
          for (const obj of flattenDisplayObjects(frame.displayObjects)) {
            if (obj.type !== "text") continue;
            const key = fontKey(obj.fontFamily, obj.bold, obj.italic);
            let set = unionByKey.get(key);
            if (!set) {
              set = new Set<number>();
              unionByKey.set(key, set);
            }
            if (obj.embedRanges !== undefined) {
              // Explicit opt-in (task 1182): exactly the chosen ranges/chars/text.
              for (const c of computeEmbedCodePoints(obj.embedRanges, obj.embedChars, obj.text)) {
                set.add(c);
              }
            } else if (obj.textType === "static") {
              // Auto-subset static text to {space} ∪ {its own text}. Passing []
              // as ranges yields exactly that from computeEmbedCodePoints.
              for (const c of computeEmbedCodePoints([], obj.embedChars, obj.text)) {
                set.add(c);
              }
            }
            // Dynamic/input without explicit embedRanges: contributes nothing.
          }
        }
      }
    };
    for (const s of doc.scenes) accumulate(s.timeline.layers);
    for (const item of doc.library.items) {
      if (item.itemType !== "symbol") continue;
      accumulate((item as Symbol).timeline.layers);
    }
    for (const [key, set] of unionByKey) {
      // A font face used only by un-embedded dynamic/input fields has an empty
      // set; fall back to the full default so the font tag stays well-formed.
      const cps = set.size > 0 ? [...set].sort((a, b) => a - b) : [...FULL_CODE_POINTS];
      embedCodePointsByKey.set(key, cps);
    }
  }

  /**
   * Code points to embed for a font key. Every font face used by a text field has
   * an auto-subsetted entry; the FULL_CODE_POINTS fallback only applies to font
   * keys that somehow are not in the map (defensive — should not happen).
   */
  const codePointsForKey = (key: string): readonly number[] =>
    embedCodePointsByKey.get(key) ?? FULL_CODE_POINTS;

  /**
   * Glyph outline source for a font key. When the publish flow supplied a
   * resolved source (real system font via Local Font Access API, or its bundled
   * weight/style fallback), use it; otherwise pass undefined so encodeDefineFont2
   * selects the bundled fallback by the face's bold/italic flags.
   */
  const glyphSourceForKey = (key: string): GlyphSource | undefined =>
    options?.fontGlyphSources?.get(key);

  /** Build a code-point → glyph-index map for a font key (for DefineText). */
  const glyphIndexMapForKey = (key: string): ReadonlyMap<number, number> => {
    const m = new Map<number, number>();
    const cps = codePointsForKey(key);
    for (let i = 0; i < cps.length; i++) m.set(cps[i], i);
    return m;
  };

  // Glyph-index maps for subsetted fonts only (keys with an explicit embed range).
  // Passed to encodeDefineSprite / encodeDefineButton2 so their static DefineText
  // uses the correct subsetted glyph indices. Keys absent here fall back to the
  // legacy `code - 32` mapping (full default table) — byte-identical to before.
  const glyphIndexMapByFontKey = new Map<string, ReadonlyMap<number, number>>();
  for (const key of embedCodePointsByKey.keys()) {
    glyphIndexMapByFontKey.set(key, glyphIndexMapForKey(key));
  }

  // Emit a font definition for a single face if not already emitted.
  const emitFont = (
    key: string,
    family: string,
    bold: boolean,
    italic: boolean
  ): void => {
    if (fontCharIdMap.has(key)) return;
    const fontId = writer.nextCharId();
    fontCharIdMap.set(key, fontId);
    const cps = codePointsForKey(key);
    const fontBody = encodeDefineFont2(fontId, family, bold, italic, fontCoordScale, kernedFontKeys.has(key), cps, glyphSourceForKey(key));
    writer.writeTag(fontTagCode, fontBody);
    // Emit DefineFontAlignZones (tag 73) immediately after DefineFont3 for all
    // embedded fonts. Provides per-glyph stem-width hint zones that enable the
    // FlashType sub-pixel rendering path in Ruffle. Harmlessly ignored for
    // non-FlashType anti-alias modes.
    if (useFont3) {
      const alignZonesBody = encodeDefineFontAlignZones(fontId, cps.length, fontCoordScale);
      writer.writeTag(Tag.DefineFontAlignZones, alignZonesBody);
    }
    // DefineFontInfo2 (tag 62) suppressed: real Flash 8 does not emit this tag.
  };

  // Scene timeline font pre-pass.
  for (const s of doc.scenes) {
    for (const layer of s.timeline.layers) {
      if (layer.type === "guide") continue;
      if (layer.type === "folder") continue;
      for (const frame of layer.frames) {
        // Do not skip on isEmpty — the flag can be stale; iterate displayObjects directly.
        if (!frame.isKeyframe) continue;
        for (const obj of flattenDisplayObjects(frame.displayObjects)) {
          if (obj.type !== "text") continue;
          emitFont(fontKey(obj.fontFamily, obj.bold, obj.italic), obj.fontFamily, obj.bold, obj.italic);
        }
      }
    }
  }

  // Symbol timeline font pre-pass: walk all symbol timelines so that fonts used
  // only inside a symbol (not on any scene timeline) still get a DefineFont3 tag
  // and an entry in fontCharIdMap. Without this pass the key is never inserted,
  // encodeDefineSprite cannot look it up, and encodeDefineEditText is called
  // without a fontCharId. Mirrors the scene pre-pass above — same guard logic.
  for (const item of doc.library.items) {
    if (item.itemType !== "symbol") continue;
    const sym = item as Symbol;
    for (const layer of sym.timeline.layers) {
      if (layer.type === "guide") continue;
      if (layer.type === "folder") continue;
      for (const frame of layer.frames) {
        if (!frame.isKeyframe) continue;
        for (const obj of flattenDisplayObjects(frame.displayObjects)) {
          if (obj.type !== "text") continue;
          emitFont(fontKey(obj.fontFamily, obj.bold, obj.italic), obj.fontFamily, obj.bold, obj.italic);
        }
      }
    }
  }

  // Font library items pre-pass: emit DefineFont3 (or DefineFont2) tags for
  // FontItem library items. These represent explicitly embedded fonts defined
  // in the library panel. Any font already emitted by the text pre-pass above
  // is skipped to avoid duplicate font definitions.
  const fontLibraryItems = doc.library.items.filter(
    (item): item is FontItem => item.itemType === "font"
  );
  for (const fontItem of fontLibraryItems) {
    emitFont(fontKey(fontItem.fontName, fontItem.bold, fontItem.italic), fontItem.fontName, fontItem.bold, fontItem.italic);
  }

  return { fontCharIdMap, embedCodePointsByKey, glyphIndexMapByFontKey, glyphIndexMapForKey };
}

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
