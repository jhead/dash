/**
 * Document model → SWF binary compiler.
 *
 * Emits a valid SWF v8 with:
 *  - FileAttributes, SetBackgroundColor
 *  - DefineShape4 + PlaceObject2 per shape (defined once, placed per-frame with Move semantics)
 *  - DefineEditText + PlaceObject2 per text field
 *  - PlaceObject3 (with FILTERLIST) for objects with Flash 8 filters
 *  - RemoveObject2 when objects leave the display list
 *  - ShowFrame per frame, End
 */
import type { DisplayObject, FlashDocument, Symbol, SymbolInstance, VideoDisplayObject } from "@flash/core";
import { SwfWriter } from "./writer.js";
// Extracted compiler-pass helpers (see compiler/ for the decomposition).
import type { CompileOptions } from "./compiler/options.js";
import { emitHeaderTags } from "./compiler/header.js";
import { assembleSwf } from "./compiler/assemble.js";
import { flattenDisplayObjects } from "./compiler/display.js";
import { topoSortSymbols, encodeExportAssets, encodeImportAssets2, runSymbolPass } from "./compiler/symbols.js";
import { runComponentPass } from "./compiler/components.js";
import { runClassPass } from "./compiler/classes.js";
import { runCharacterPass } from "./compiler/characters.js";
import { runMediaPass } from "./compiler/media.js";
import { createDepthAllocator, runDepthPrepass } from "./compiler/depth.js";
import { runFrameLoop } from "./compiler/frames.js";
import { collectFontFaceRequests, runFontPass } from "./compiler/fonts.js";

// Re-exported for the package public API (index.ts imports these from here).
export type { CompileOptions };
export { encodeExportAssets, encodeImportAssets2, collectFontFaceRequests };

// ---------------------------------------------------------------------------
// Main compiler
// ---------------------------------------------------------------------------

/**
 * Compile a FlashDocument into a binary SWF v8 byte array.
 *
 * The produced SWF is valid and playable in Ruffle.
 */
export function compileDocument(doc: FlashDocument, options?: CompileOptions): Uint8Array {
  const props = doc.properties;
  const writer = new SwfWriter();

  // 1-2. Header / document-attribute tags (FileAttributes … SetBackgroundColor).
  emitHeaderTags(writer, props, options);

  // 3. Compile library symbols → DefineSprite tags
  //    Build charIdMap: symbolId → SWF character ID
  const rawSymbols = doc.library.items.filter(
    (item): item is Symbol => item.itemType === "symbol"
  );

  // Sort symbols topologically so dependencies are emitted first
  const symbols = topoSortSymbols(rawSymbols);

  // Quick lookup: symbolId → Symbol (for instance-level overrides in compile loop)
  const symbolById = new Map<string, Symbol>(symbols.map((s) => [s.id, s]));

  const charIdMap = new Map<string, number>();
  // Assign character IDs to all symbols up front (so nested instances resolve)
  for (const sym of symbols) {
    charIdMap.set(sym.id, writer.nextCharId());
  }

  // Pre-scan: find symbols that are placed *only* as button instances carrying
  // instance-level on() handlers (buttonHandlers).  Each such placement emits its
  // own inline DefineButton2 tag (the handlers live in the tag, not in
  // PlaceObject2), so the library-level definition (DefineSprite for a graphic /
  // movieclip, or DefineButton2 for a button symbol) must NOT also be emitted —
  // otherwise the button would be defined twice.
  //
  // This covers two cases:
  //   1. A graphic/movieclip symbol used as a button instance (legacy authoring
  //      where on() handlers were attached to a non-button symbol).
  //   2. A real button symbol (symbolType === "button") whose every placement
  //      carries instance-level handlers — common for buttons imported from a
  //      binary FLA, where the on(release){...} script lives on the instance.
  //
  // A button symbol with NO handler-bearing placement (e.g. one driven purely by
  // symbol-level buttonActions) is NOT collected here, so it still emits its
  // library-level DefineButton2.
  const graphicButtonSymbolIds = new Set<string>();
  {
    const allTimelines: Array<{ layers: readonly { frames: readonly { displayObjects: readonly DisplayObject[] }[] }[] }> = [
      ...doc.scenes.map((s) => s.timeline),
      ...symbols.map((s) => s.timeline),
    ];
    // Track, per symbol, whether it is ever placed with handlers and ever placed
    // without handlers. Only symbols placed exclusively with handlers are safe to
    // emit inline-only.
    const placedWithHandlers = new Set<string>();
    const placedWithoutHandlers = new Set<string>();
    for (const timeline of allTimelines) {
      for (const layer of timeline.layers) {
        for (const frame of layer.frames) {
          for (const obj of frame.displayObjects) {
            const inst = obj as SymbolInstance;
            if (inst.type !== "instance") continue;
            if (inst.buttonHandlers && inst.buttonHandlers.length > 0) {
              placedWithHandlers.add(inst.symbolId);
            } else {
              placedWithoutHandlers.add(inst.symbolId);
            }
          }
        }
      }
    }
    for (const symbolId of placedWithHandlers) {
      if (placedWithoutHandlers.has(symbolId)) continue;
      graphicButtonSymbolIds.add(symbolId);
    }
  }

  // Font pre-pass: emit DefineFont3/2 + DefineFontAlignZones tags for every font
  // face used by a text field (scene + symbol timelines) and FontItem library
  // entries, with per-field glyph subsetting. Returns the lookups downstream
  // text emission needs. See compiler/fonts.ts.
  const { fontCharIdMap, embedCodePointsByKey, glyphIndexMapByFontKey, glyphIndexMapForKey } =
    runFontPass(writer, doc, options);

  // Sound/video library definition pre-pass: emit DefineSound and
  // DefineVideoStream tags BEFORE the symbol loop so encodeDefineSprite can
  // resolve their character IDs inside symbol timelines. See compiler/media.ts.
  const { soundItems, soundIdMap, videoCharIdMap, videoStreams } = runMediaPass(writer, doc);

  // Symbol definition pass: emit DefineSprite/DefineButton2 (+ hoisted defs,
  // scaling grids, deferred DefineButtonSound) for every library symbol and
  // collect the AS2 linkage entries to emit in the first frame. See
  // compiler/symbols.ts.
  const { exportEntries, importsByUrl, doInitActionBodies } = runSymbolPass({
    writer,
    doc,
    symbols,
    charIdMap,
    graphicButtonSymbolIds,
    fontCharIdMap,
    glyphIndexMapByFontKey,
    soundItems,
    soundIdMap,
    videoCharIdMap,
    videoStreams,
    // Thread the Publish-Settings JPEG quality + decoded pixels so symbol-internal
    // photo bitmaps re-encode at the chosen quality, not their original bytes (task 1287).
    photoOptions: { jpegQuality: options?.jpegQuality, bitmapPixels: options?.bitmapPixels },
  });

  // 3d. Placed v2-component pass (task 1229): synthesize a DefineSprite +
  // ExportAssets + DoInitAction for every ComponentItem placed on a timeline, so
  // a placed mx.controls.* component resolves to a real character id (instead of
  // being silently dropped) and registers its AS2 class. Runs AFTER the symbol
  // pass (char ids already assigned) and BEFORE the frame loop (so the placement
  // path can resolve charIdMap.get(symbolId)). The export/init entries are merged
  // into the symbol-pass results so the existing first-frame ExportAssets /
  // DoInitAction machinery (compiler/frames.ts) emits them. See compiler/components.ts.
  const componentPass = runComponentPass({ writer, doc, charIdMap });
  exportEntries.push(...componentPass.exportEntries);
  doInitActionBodies.push(...componentPass.doInitActionBodies);

  // 3e. AS2 user-class pass (task 1299): compile each external `.as` class
  // attached to the document (doc.asClasses) into a class-DEFINITION
  // DoInitAction, topologically ordered superclass-before-subclass. These MUST
  // execute BEFORE the registerClass bindings the symbol pass emitted (which do
  // `Object.registerClass(linkageId, ClassName)` and dereference the class
  // constructor), so the class definition exists in _global when registerClass
  // resolves it. We PREPEND them to the front of doInitActionBodies (the symbol-
  // pass registerClass bodies and component bodies were already pushed above).
  // import statements are a pure resolution hint and emit no bytecode. See
  // compiler/classes.ts.
  const classPass = runClassPass(doc);
  if (classPass.doInitActionBodies.length > 0) {
    doInitActionBodies.unshift(...classPass.doInitActionBodies);
  }

  // 4. Frames — iterate ALL scenes' timelines.
  //    Each scene gets a FrameLabel tag (scene name) at its first frame.
  //    Between scenes we emit RemoveObject2 for all occupied depths to reset
  //    the display list so each scene starts with a clean stage.

  // Stable depth allocation per (sceneIdx:layerIdx:objId); shared by the depth
  // pre-pass and the frame loop. See compiler/depth.ts.
  const depthAllocator = createDepthAllocator();
  const { getOrAssignDepth } = depthAllocator;

  // Determine which library video streams are explicitly placed via a
  // VideoDisplayObject on the timeline. Those are positioned model-driven
  // through the normal per-layer depth/placement path below. Any stream NOT
  // referenced keeps the legacy fixed placement so a bare library video still
  // appears on the stage.
  const referencedVideoItemIds = new Set<string>();
  for (const scene of doc.scenes) {
    for (const layer of scene.timeline.layers) {
      for (const frame of layer.frames) {
        for (const obj of flattenDisplayObjects(frame.displayObjects)) {
          if (obj.type === "video") {
            referencedVideoItemIds.add((obj as VideoDisplayObject).videoItemId);
          }
        }
      }
    }
  }

  // Video streams are placed on high, dedicated depths (above any shape/text
  // depth) so they never collide with the per-layer depth assignment below.
  // Only streams NOT placed via a VideoDisplayObject get this legacy fixed
  // placement; the rest are placed model-driven in the frame loop.
  const videoDepthBase = 50000;
  const videoDepths = videoStreams
    .filter((vs) => !referencedVideoItemIds.has(vs.itemId))
    .map((vs, i) => ({
      depth: videoDepthBase + i,
      charId: vs.charId,
      width: vs.width,
      height: vs.height,
      payloads: vs.payloads,
    }));
  // VideoFrame (tag 61) advancement applies to EVERY stream — both the
  // legacy fixed-placed ones and those placed via a VideoDisplayObject — so
  // each placed stream character receives its decoded frames.
  const videoFrameAdvancers = videoStreams.map((vs) => ({
    charId: vs.charId,
    payloads: vs.payloads,
  }));

  // Longest video, in frames — the SWF must run at least this many frames so
  // every VideoFrame tag has a ShowFrame to land before.
  const maxVideoFrames = videoFrameAdvancers.reduce(
    (m, v) => Math.max(m, v.payloads.length),
    0
  );

  // Character-definition pre-pass: emit DefineShape4 / DefineText /
  // DefineEditText / DefineMorphShape2 / bitmap DefineBits for every display
  // object across all scenes, so an object defined in one scene can be
  // referenced in another. See compiler/characters.ts.
  const { objCharIdMap, morphShapeObjIds, morphObjSpanInfo } = runCharacterPass({
    writer,
    doc,
    options,
    fontCharIdMap,
    glyphIndexMapForKey,
    embedCodePointsByKey,
  });

  // Depth pre-pass: seed the allocator in visual order (top layer → highest
  // depth, mask before its masked layers). See compiler/depth.ts.
  runDepthPrepass(depthAllocator, doc);

  // Frame loop: emit every scene/frame timeline tag (PlaceObject2/3,
  // RemoveObject2, FrameLabel, DoAction, sounds, VideoFrame, ShowFrame).
  // See compiler/frames.ts.
  runFrameLoop({
    writer, doc, props, options, charIdMap, symbolById, graphicButtonSymbolIds,
    fontCharIdMap, glyphIndexMapByFontKey, soundItems, soundIdMap, videoCharIdMap,
    videoStreams, videoDepths, videoFrameAdvancers, maxVideoFrames, objCharIdMap,
    morphShapeObjIds, morphObjSpanInfo, getOrAssignDepth, exportEntries,
    importsByUrl, doInitActionBodies,
  });

  // 5. End tag, assemble the binary, and optionally zlib-compress (CWS).
  return assembleSwf(writer, doc, maxVideoFrames, options);
}
