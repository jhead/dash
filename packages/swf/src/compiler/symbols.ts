/**
 * Symbol-library helpers: dependency ordering and the small linkage/grid tag
 * encoders used when emitting symbol character definitions.
 *
 * (The full symbol-definition emission pass is threaded through CompileContext
 * by the orchestrator; this module currently owns the standalone, state-free
 * pieces.)
 */
import type { ButtonSounds, FlashDocument, SoundItem, Symbol } from "@flash/core";
import { BitWriter } from "../bits.js";
import { writeRect, px } from "../helpers.js";
import { Tag } from "../tags.js";
import { SwfWriter } from "../writer.js";
import { encodeDefineSprite } from "../sprite.js";
import { encodeDefineButton2, encodeDefineButtonSound } from "../buttons.js";
import { encodeDoInitAction } from "../doInitAction.js";
import type { VideoStreamInfo } from "./media.js";
import type { PhotoBitmapOptions } from "../bitmaps.js";

/**
 * Sort symbols so that each symbol appears after all symbols it references
 * (dependencies come first). This ensures DefineSprite tags are emitted in
 * dependency order so referenced sprites are always defined before use.
 */
export function topoSortSymbols(symbols: Symbol[]): Symbol[] {
  const idToSymbol = new Map<string, Symbol>(symbols.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const result: Symbol[] = [];

  function visit(sym: Symbol): void {
    if (visited.has(sym.id)) return;
    visited.add(sym.id);

    // Walk all frames in all layers looking for SymbolInstance references
    for (const layer of sym.timeline.layers) {
      for (const frame of layer.frames) {
        for (const obj of frame.displayObjects) {
          if (obj.type === "instance") {
            const dep = idToSymbol.get(obj.symbolId);
            if (dep) visit(dep);
          }
        }
      }
    }

    result.push(sym);
  }

  for (const sym of symbols) {
    visit(sym);
  }

  return result;
}

/**
 * Encode an ExportAssets (tag 56) tag body.
 *
 * Format (SWF spec):
 *   UI16  Count
 *   For each symbol:
 *     UI16    CharacterId
 *     STRING  Name (null-terminated UTF-8)
 */
export function encodeExportAssets(symbols: Array<{ charId: number; name: string }>): Uint8Array {
  // Calculate total byte length: 2 (count) + per-symbol: 2 (UI16 charId) + name bytes + 1 (NUL)
  let totalLen = 2;
  for (const s of symbols) {
    totalLen += 2 + s.name.length + 1;
  }
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  view.setUint16(0, symbols.length, true /* LE */);
  let offset = 2;
  for (const s of symbols) {
    view.setUint16(offset, s.charId, true /* LE */);
    offset += 2;
    for (let i = 0; i < s.name.length; i++) {
      buf[offset++] = s.name.charCodeAt(i);
    }
    buf[offset++] = 0; // NUL terminator
  }
  return buf;
}

/**
 * Encode an ImportAssets2 (tag 71) tag body.
 *
 * Format (SWF spec):
 *   STRING  URL (null-terminated)
 *   UI8     Reserved = 1
 *   UI8     Reserved = 0
 *   UI16    Count
 *   For each symbol:
 *     UI16    CharacterId
 *     STRING  Name (null-terminated UTF-8)
 */
export function encodeImportAssets2(url: string, symbols: Array<{ charId: number; name: string }>): Uint8Array {
  // Calculate total byte length:
  // url bytes + 1 (NUL) + 2 (reserved) + 2 (count) + per-symbol: 2 (UI16 charId) + name bytes + 1 (NUL)
  let totalLen = url.length + 1 + 2 + 2;
  for (const s of symbols) {
    totalLen += 2 + s.name.length + 1;
  }
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  let offset = 0;
  // Write URL null-terminated
  for (let i = 0; i < url.length; i++) {
    buf[offset++] = url.charCodeAt(i);
  }
  buf[offset++] = 0; // NUL terminator
  // Reserved bytes
  buf[offset++] = 1;
  buf[offset++] = 0;
  // Count
  view.setUint16(offset, symbols.length, true /* LE */);
  offset += 2;
  // Each symbol: charId + name
  for (const s of symbols) {
    view.setUint16(offset, s.charId, true /* LE */);
    offset += 2;
    for (let i = 0; i < s.name.length; i++) {
      buf[offset++] = s.name.charCodeAt(i);
    }
    buf[offset++] = 0; // NUL terminator
  }
  return buf;
}

/**
 * Encode a DefineScalingGrid (tag 78) body.
 *
 * Format (SWF spec §12.34):
 *   UI16   SpriteID (the DefineSprite character ID)
 *   RECT   Splitter (the 9-slice grid rectangle in twips)
 *
 * The RECT defines the inner rectangle of the 9-slice grid:
 *   xMin = left boundary, xMax = right boundary
 *   yMin = top boundary,  yMax = bottom boundary
 */
export function encodeDefineScalingGrid(
  spriteId: number,
  grid: { x: number; y: number; width: number; height: number }
): Uint8Array {
  const bw = new BitWriter();
  bw.writeUI16LE(spriteId);
  writeRect(
    bw,
    px(grid.x),
    px(grid.x + grid.width),
    px(grid.y),
    px(grid.y + grid.height)
  );
  return bw.getBytes();
}

/** Inputs the symbol-definition pass needs (all built by earlier pre-passes). */
export interface SymbolPassInput {
  writer: SwfWriter;
  doc: FlashDocument;
  symbols: Symbol[];
  charIdMap: Map<string, number>;
  graphicButtonSymbolIds: Set<string>;
  fontCharIdMap: Map<string, number>;
  glyphIndexMapByFontKey: Map<string, ReadonlyMap<number, number>>;
  soundItems: SoundItem[];
  soundIdMap: Map<string, number>;
  videoCharIdMap: Map<string, number>;
  videoStreams: VideoStreamInfo[];
  /** Publish-Settings JPEG quality + decoded bitmap pixels (task 1287), passed
   *  to the sprite/button encoders so symbol-internal photo bitmaps re-encode at
   *  the chosen quality. Optional — absent for callers that pass no quality. */
  photoOptions?: PhotoBitmapOptions;
}

/** Linkage entries collected during symbol emission, emitted in the first frame. */
export interface SymbolPassResult {
  exportEntries: { charId: number; name: string }[];
  importsByUrl: Map<string, Array<{ charId: number; name: string }>>;
  doInitActionBodies: Uint8Array[];
}

/**
 * Emit the library-level character definition for every symbol (DefineSprite
 * (39) for graphics/movieclips, DefineButton2 (34) for buttons, with hoisted
 * shape/text definitions and an optional DefineScalingGrid (78)), then collect
 * the AS2 linkage entries (ExportAssets / ImportAssets2 / DoInitAction) and emit
 * the deferred DefineButtonSound (17) tags now that soundIdMap is populated.
 *
 * Symbols in `graphicButtonSymbolIds` are skipped here — they emit an inline
 * DefineButton2 at instance-placement time in the frame loop instead.
 */
export function runSymbolPass(input: SymbolPassInput): SymbolPassResult {
  const {
    writer, doc, symbols, charIdMap, graphicButtonSymbolIds,
    fontCharIdMap, glyphIndexMapByFontKey, soundItems, soundIdMap,
    videoCharIdMap, videoStreams, photoOptions,
  } = input;

  const pendingButtonSounds: Array<{ charId: number; sounds: ButtonSounds }> = [];

  // Emit DefineSprite for each symbol (using the pre-assigned IDs).
  // encodeDefineSprite returns the tag *body* (SpriteID + FrameCount + inner tags);
  // writeTag wraps it with the DefineSprite record header.
  // Bug 3 fix: hoist character definitions (DefineShape4, DefineEditText) that
  // were embedded inside sprite bodies to the top level *before* their sprite tag.
  for (const sym of symbols) {
    const symCharId = charIdMap.get(sym.id)!;

    // Collect hoisted definition tags (DefineShape4, DefineEditText, etc.) that must
    // appear at top level before the symbol definition tag.
    const hoistedDefs: Array<{ tagType: number; body: Uint8Array }> = [];

    if (graphicButtonSymbolIds.has(sym.id)) {
      // Symbol placed only as a button instance carrying instance-level on()
      // handlers: skip the library-level definition here. An inline
      // DefineButton2 will be emitted at instance-placement time (see the
      // instance handling loop below), which hoists shapes/text and wraps them
      // with the per-instance button handlers. This applies to graphic/movieclip
      // symbols used as buttons AND to real button symbols (symbolType ===
      // "button") whose every placement carries handlers.
    } else if (sym.symbolType === "button") {
      // Button symbols: emit DefineButton2 (tag 34) instead of DefineSprite (tag 39).
      const buttonBody = encodeDefineButton2(
        symCharId,
        sym,
        doc,
        charIdMap,
        () => writer.nextCharId(),
        hoistedDefs,
        undefined,
        undefined,
        fontCharIdMap,
        glyphIndexMapByFontKey,
        photoOptions
      );

      // Emit hoisted shape/text definition tags first
      for (const def of hoistedDefs) {
        writer.writeTag(def.tagType, def.body);
      }

      writer.writeTag(Tag.DefineButton2, buttonBody);

      // Collect for deferred DefineButtonSound emit (needs soundIdMap, built above)
      if (sym.buttonSounds) {
        pendingButtonSounds.push({ charId: symCharId, sounds: sym.buttonSounds });
      }
    } else {
      const spriteBody = encodeDefineSprite(
        symCharId,
        sym,
        doc,
        charIdMap,
        () => writer.nextCharId(),
        hoistedDefs,
        fontCharIdMap,
        soundIdMap,
        videoCharIdMap,
        videoStreams,
        glyphIndexMapByFontKey,
        photoOptions
      );

      // Emit hoisted definition tags first
      for (const def of hoistedDefs) {
        writer.writeTag(def.tagType, def.body);
      }

      writer.writeTag(Tag.DefineSprite, spriteBody);

      // Emit DefineScalingGrid (tag 78) immediately after DefineSprite when
      // the symbol has a non-null 9-slice grid.
      if (sym.scale9Grid !== null) {
        const gridBody = encodeDefineScalingGrid(symCharId, sym.scale9Grid);
        writer.writeTag(Tag.DefineScalingGrid, gridBody);
      }
    }
  }

  // 3b. Collect ExportAssets entries for symbols with exportForActionScript=true
  // or exportForRuntimeSharing=true.
  // These will be emitted inside the first SWF frame (after FrameLabel, before DoInitAction).
  const exportEntries: { charId: number; name: string }[] = [];
  for (const sym of symbols) {
    const shouldExport =
      (sym.linkage.exportForActionScript && sym.linkage.linkageIdentifier) ||
      (sym.linkage.exportForRuntimeSharing && sym.linkage.linkageIdentifier);
    if (shouldExport && sym.linkage.linkageIdentifier) {
      const charId = charIdMap.get(sym.id);
      if (charId !== undefined) {
        exportEntries.push({ charId, name: sym.linkage.linkageIdentifier });
      }
    }
  }

  // 3b2. Collect ImportAssets2 entries grouped by sharedUrl for symbols with
  // importForRuntimeSharing=true and a non-empty sharedUrl and linkageIdentifier.
  // These will be emitted in the first SWF frame, after ExportAssets.
  const importsByUrl = new Map<string, Array<{ charId: number; name: string }>>();
  for (const sym of symbols) {
    if (
      sym.linkage.importForRuntimeSharing &&
      sym.linkage.sharedUrl &&
      sym.linkage.linkageIdentifier
    ) {
      const charId = charIdMap.get(sym.id);
      if (charId !== undefined) {
        const group = importsByUrl.get(sym.linkage.sharedUrl) ?? [];
        group.push({ charId, name: sym.linkage.linkageIdentifier });
        importsByUrl.set(sym.linkage.sharedUrl, group);
      }
    }
  }

  // 3c-init. Collect DoInitAction bodies for symbols with exportForActionScript=true
  // and a className. These will be emitted at the start of the first SWF frame.
  const doInitActionBodies: Uint8Array[] = [];
  for (const sym of symbols) {
    if (sym.linkage.exportForActionScript && sym.linkage.className) {
      const charId = charIdMap.get(sym.id);
      if (charId !== undefined) {
        const linkageId = sym.linkage.linkageIdentifier || sym.linkage.className;
        doInitActionBodies.push(encodeDoInitAction(charId, sym.linkage.className, linkageId));
      }
    }
  }

  // 3c. Add ExportAssets entries for sound items with AS2 linkage identifiers.
  //     (DefineSound tags were already emitted in the pre-pass above; soundIdMap
  //      and soundItems are already populated.)
  for (const soundItem of soundItems) {
    const soundId = soundIdMap.get(soundItem.id);
    if (soundId !== undefined && soundItem.exportForActionScript && soundItem.linkageIdentifier) {
      exportEntries.push({ charId: soundId, name: soundItem.linkageIdentifier });
    }
  }

  // Emit deferred DefineButtonSound tags now that soundIdMap is populated.
  for (const { charId, sounds } of pendingButtonSounds) {
    const soundBody = encodeDefineButtonSound(charId, sounds, soundIdMap);
    writer.writeTag(Tag.DefineButtonSound, soundBody);
  }

  return { exportEntries, importsByUrl, doInitActionBodies };
}
