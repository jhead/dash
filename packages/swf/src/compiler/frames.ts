/**
 * Per-scene frame loop: emit the timeline (PlaceObject2/3, RemoveObject2,
 * FrameLabel, DoAction, StartSound, SoundStream*, VideoFrame, ShowFrame) for
 * every scene and frame. This is the compiler stage that diffs the display list
 * frame-to-frame and routes each object to the right PlaceObject variant.
 *
 * Extracted verbatim from compileDocument; all the maps/counters it formerly
 * closed over now arrive via {@link FrameLoopContext}. depthState/depthToObjId
 * and the change-detection helpers (colorEffectKey/computeClipActionsKey) are
 * loop-internal, exactly as before.
 */
import type { ButtonHandler, ClipAction, DisplayObject, FlashDocument, Symbol, SymbolInstance, VideoDisplayObject, SoundItem } from "@flash/core";
import { compileAS2, getTweenedFrame, applyEase } from "@flash/core";
import { Tag } from "../tags.js";
import { SwfWriter } from "../writer.js";
import {
  encodePlaceObject2,
  encodePlaceObject2Move,
  encodePlaceObject2WithAlpha,
  encodePlaceObject2WithName,
  encodePlaceObject2WithCXForm,
  encodePlaceObject2WithClipDepth,
  encodePlaceObject2WithClipActions,
  encodePlaceObject2MoveWithClipActions,
} from "../shapes.js";
import { encodePlaceObject2WithRatio } from "../morphshape.js";
import { encodePlaceObject2ForText } from "../text.js";
import {
  encodePlaceObject3WithFilters,
  encodePlaceObject3WithBlendMode,
  encodePlaceObject3WithCacheAsBitmap,
  hasEnabledFilters,
} from "../filters.js";
import { colorEffectToCXForm } from "../cxform.js";
import { encodeDefineButton2 } from "../buttons.js";
import { encodeSoundStreamBlock, encodeSoundStreamBlockMp3 } from "../audio.js";
import { encodeStartSound, encodeStartSound2 } from "../sounds.js";
import { encodeVideoFrame } from "../video.js";
import { encodeFrameLabel } from "../framelabel.js";
import type { CompileOptions } from "./options.js";
import { flattenDisplayObjects } from "./display.js";
import { videoFitTransform, type VideoStreamInfo } from "./media.js";
import { sceneFrameCount } from "./depth.js";
import { encodeRemoveObject2 } from "./scripts.js";
import { encodeExportAssets, encodeImportAssets2 } from "./symbols.js";
import { computeStreamSounds } from "./sound-stream.js";
import type { MorphSpanInfo } from "./characters.js";

/** Everything the frame loop reads, built by the earlier compiler pre-passes. */
export interface FrameLoopContext {
  writer: SwfWriter;
  doc: FlashDocument;
  props: FlashDocument["properties"];
  options?: CompileOptions;
  charIdMap: Map<string, number>;
  symbolById: Map<string, Symbol>;
  graphicButtonSymbolIds: Set<string>;
  fontCharIdMap: Map<string, number>;
  glyphIndexMapByFontKey: Map<string, ReadonlyMap<number, number>>;
  soundItems: SoundItem[];
  soundIdMap: Map<string, number>;
  videoCharIdMap: Map<string, number>;
  videoStreams: VideoStreamInfo[];
  videoDepths: Array<{ depth: number; charId: number; width: number; height: number; payloads: Uint8Array[] }>;
  videoFrameAdvancers: Array<{ charId: number; payloads: Uint8Array[] }>;
  maxVideoFrames: number;
  objCharIdMap: Map<string, number>;
  morphShapeObjIds: Set<string>;
  morphObjSpanInfo: Map<string, MorphSpanInfo[]>;
  getOrAssignDepth: (sceneIdx: number, layerIdx: number, objId: string) => number;
  exportEntries: { charId: number; name: string }[];
  importsByUrl: Map<string, Array<{ charId: number; name: string }>>;
  doInitActionBodies: Uint8Array[];
}

export function runFrameLoop(ctx: FrameLoopContext): void {
  const {
    writer, doc, props, charIdMap, symbolById, graphicButtonSymbolIds,
    fontCharIdMap, glyphIndexMapByFontKey, soundItems, soundIdMap, videoCharIdMap,
    videoStreams, videoDepths, videoFrameAdvancers, maxVideoFrames, objCharIdMap,
    morphShapeObjIds, morphObjSpanInfo, getOrAssignDepth, exportEntries,
    importsByUrl, doInitActionBodies,
  } = ctx;

  /**
   * Serialize a ColorEffect, standalone alpha, and visible=false to a string key for change detection.
   * Returns null when there is no active color effect, no non-default alpha, and visible is not false.
   */
  function colorEffectKey(displayObj: DisplayObject): string | null {
    // Track visible=false for all applicable display object types
    if (
      (displayObj.type === "instance" || displayObj.type === "shape" ||
       displayObj.type === "text" || displayObj.type === "bitmap") &&
      (displayObj as { visible?: boolean }).visible === false
    ) {
      return "visible:false";
    }
    if (displayObj.type !== "instance" && displayObj.type !== "text" && displayObj.type !== "bitmap" && displayObj.type !== "shape") return null;
    // Track colorEffect, blendMode, and standalone alpha for shape change detection
    if (displayObj.type === "shape") {
      const shp = displayObj as import("@flash/core").ShapeDisplayObject;
      const ce = shp.colorEffect;
      if (ce && ce.type !== "none") return JSON.stringify(ce);
      if (shp.blendMode && shp.blendMode !== "normal") {
        return `blend:${shp.blendMode};alpha:${shp.alpha ?? 1}`;
      }
      if (shp.alpha !== undefined && shp.alpha !== 1) {
        return `alpha:${shp.alpha}`;
      }
      return null;
    }
    const obj = displayObj as import("@flash/core").SymbolInstance | import("@flash/core").TextDisplayObject | import("@flash/core").BitmapDisplayObject;
    const ce = (obj as { colorEffect?: import("@flash/core").ColorEffect }).colorEffect;
    const hasColorEffect = ce && ce.type !== "none";
    if (hasColorEffect) return JSON.stringify(ce);
    // Track standalone alpha for instance and bitmap change detection
    if (displayObj.type === "instance") {
      const inst = displayObj as import("@flash/core").SymbolInstance;
      if (inst.alpha !== undefined && inst.alpha !== 1) {
        return `alpha:${inst.alpha}`;
      }
    }
    if (displayObj.type === "bitmap") {
      const bmp = displayObj as import("@flash/core").BitmapDisplayObject;
      if (bmp.alpha !== undefined && bmp.alpha !== 1) {
        return `alpha:${bmp.alpha}`;
      }
    }
    return null;
  }

  /**
   * Serialize the enabled filter list to a string key for change detection.
   * Returns null when the object carries no enabled filters.
   *
   * This is what makes filter TWEENS (e.g. the Blur timeline effect, which ramps
   * a BlurFilter 0 → max → 0) emit a fresh PlaceObject3 every frame: during a
   * motion tween the position is unchanged but the interpolated filter differs
   * each frame, so without a filters key the move would be suppressed and the
   * blur would freeze at its first-frame value.
   */
  function filtersKey(displayObj: DisplayObject): string | null {
    const filters = (displayObj as { filters?: readonly import("@flash/core").FlashFilter[] }).filters;
    if (!filters || !hasEnabledFilters(filters)) return null;
    return JSON.stringify(filters.filter((f) => f.enabled));
  }

  /** Compute a serialized key representing the effective clip actions for a SymbolInstance.
   *  Returns null if there are no effective clip actions. */
  function computeClipActionsKey(displayObj: DisplayObject): string | null {
    if (displayObj.type !== "instance") return null;
    const inst = displayObj as import("@flash/core").SymbolInstance;
    // loopMode / firstFrame (Loop / Play Once / Single Frame) are GRAPHIC-symbol
    // properties only. Movieclip and button instances play their own timeline
    // independently, so loopMode must be ignored for them — otherwise the
    // synthesized loop-control clip actions (e.g. single-frame → gotoAndStop(1))
    // freeze the nested movieclip on frame 0. (Binary FLAs carry a loop-mode byte
    // on every instance, so it is frequently "single-frame" on movieclips.)
    const isGraphic = symbolById.get(inst.symbolId)?.symbolType === "graphic";
    const loopMode = isGraphic ? (inst.loopMode ?? "loop") : "loop";
    const firstFrame = isGraphic ? (inst.firstFrame ?? 0) : 0;
    const explicit = inst.clipActions ?? [];
    if (loopMode === "loop" && firstFrame === 0 && explicit.length === 0) return null;
    return JSON.stringify({ loopMode, firstFrame, clipActions: explicit });
  }

  // Per-depth: last placed state (objId, x, y, scaleX, scaleY, rotation, skewX, skewY, ratio)
  interface DepthState {
    objId: string;
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    skewX: number;
    skewY: number;
    /** Last placed morph ratio (0..65535); -1 if not a morph shape. */
    ratio: number;
    /** Serialized color effect key for change detection (null = no effect). */
    colorEffectKey: string | null;
    /** Serialized filter-list key for change detection (null = no filters). */
    filtersKey: string | null;
    /** Serialized clip actions key for change detection (null = no clip actions). */
    clipActionsKey: string | null;
    /** Serialized letter-spacing key for change detection. */
    letterSpacingKey: string;
    /** Serialized restrict key for change detection. */
    restrictKey: string;
  }
  const depthState = new Map<number, DepthState>();

  // Track display list per depth: depth → current display-object id
  const depthToObjId = new Map<number, string>();

  if (doc.scenes.length === 0) {
    // No scenes — emit at least one ShowFrame for a valid 1-frame SWF
    writer.writeTag(Tag.ShowFrame, new Uint8Array(0));
  } else {
    for (let sceneIdx = 0; sceneIdx < doc.scenes.length; sceneIdx++) {
      const scene = doc.scenes[sceneIdx];
      const layers = scene.timeline.layers;

      // Scene-name FrameLabel suppressed: real Flash 8 does not emit scene names as
      // FrameLabel tags. Only user-created frame labels in the model become FrameLabel tags.

      // Between scenes: emit RemoveObject2 for every occupied depth to clear
      // the display list so the next scene starts with a clean stage.
      // (Skip for the very first scene — nothing to clear yet.)
      if (sceneIdx > 0) {
        for (const [depth] of depthState) {
          writer.writeTag(Tag.RemoveObject2, encodeRemoveObject2(depth));
          depthToObjId.delete(depth);
        }
        depthState.clear();
      }

      // Scene 0 must run long enough to deliver every video frame (one
      // VideoFrame tag lands before each ShowFrame).
      const maxFrames =
        sceneIdx === 0
          ? Math.max(sceneFrameCount(scene.timeline), maxVideoFrames)
          : sceneFrameCount(scene.timeline);

      // Pre-compute per-frame stream sound chunks for this scene. SWF requires
      // one SoundStreamBlock per ShowFrame carrying only that frame's samples,
      // interleaved SoundStreamHead → (Block → ShowFrame)×N. See
      // compiler/sound-stream.ts; per-frame blocks are emitted below.
      const streamSounds = computeStreamSounds(layers, soundItems, props.frameRate, maxFrames);

      // Emit ExportAssets (tag 56) in the first SWF frame (scene 0, frame 0).
      // Must appear BEFORE DoInitAction so the character IDs are mapped before
      // registerClass is called.
      if (sceneIdx === 0 && exportEntries.length > 0) {
        writer.writeTag(Tag.ExportAssets, encodeExportAssets(exportEntries));
      }

      // Emit ImportAssets2 (tag 71) in the first SWF frame, one tag per sharedUrl.
      // These must appear after ExportAssets but before DoInitAction.
      if (sceneIdx === 0 && importsByUrl.size > 0) {
        for (const [url, entries] of importsByUrl) {
          writer.writeTag(Tag.ImportAssets2, encodeImportAssets2(url, entries));
        }
      }

      // Emit DoInitAction tags at the start of the very first SWF frame (scene 0, frame 0).
      // These must appear before any PlaceObject tags in the frame.
      if (sceneIdx === 0 && doInitActionBodies.length > 0) {
        for (const body of doInitActionBodies) {
          writer.writeTag(Tag.DoInitAction, body);
        }
      }

      for (let frameIdx = 0; frameIdx < maxFrames; frameIdx++) {
        // Collect letterSpacing DoAction scripts for text fields placed this frame.
        // Each entry is a compiled AS2 snippet:
        //   var _tf=new TextFormat();_tf.letterSpacing=N;_root.name.setTextFormat(_tf);
        const letterSpacingActions: string[] = [];

        // Collect restrict DoAction scripts for input text fields with a restrict pattern.
        // Each entry is a compiled AS2 snippet: _root.name.restrict = "pattern";
        // DefineEditText has no built-in restrict field — it must be set via AS2 at runtime.
        const restrictActions: string[] = [];

        // Collect tab-order DoAction scripts for instances with accessibility.tabIndex
        // set. On scene 0 / frame 0, also emit the global _root.tabChildren = false when
        // doc.accessibility.useCustomTabOrder is true.
        const tabOrderActions: string[] = [];
        if (sceneIdx === 0 && frameIdx === 0 && doc.accessibility?.useCustomTabOrder) {
          tabOrderActions.push("_root.tabChildren = false;");
        }

        // Collect _accProps DoAction scripts for newly-placed instances with accessibility
        // name / description / shortcut / forceSimple fields set.
        // Flash 8 uses the _accProps object on a MovieClip to expose accessibility info
        // to MSAA screen readers (equivalent to AS2 `mc._accProps.name = "..."` etc.).
        const accPropsActions: string[] = [];

        // Collect _quality initialization script for scene 0 / frame 0.
        // Flash Player default is "HIGH"; only emit when explicitly set to something else.
        const qualityActions: string[] = [];
        if (sceneIdx === 0 && frameIdx === 0) {
          const quality = doc.properties?.quality;
          if (quality !== undefined && quality !== "high") {
            qualityActions.push(`_quality = "${quality.toUpperCase()}";`);
          }
        }

        // Video streams: placed once on scene 0 / frame 0, then advanced one
        // VideoFrame (tag 61) per ShowFrame. VideoFrame tags are emitted just
        // before this frame's ShowFrame (see below).
        if (sceneIdx === 0 && frameIdx === 0) {
          for (const v of videoDepths) {
            writer.writeTag(
              Tag.PlaceObject2,
              encodePlaceObject2(v.charId, v.depth, 0, 0)
            );
          }
        }

        // Collect the set of (depth, displayObj) that should be on-screen this frame.
        // Use getTweenedFrame to get interpolated positions during tween spans.
        const thisFrameDepths = new Map<
          number,
          { objId: string; displayObj: DisplayObject; layerIdx: number }
        >();

        // Pass 1: assign depths for all layers in natural order (li=0 first).
        // This ensures mask layers (typically lower li) receive lower depth values
        // than the masked layers below them, which is required by the SWF spec:
        // a PlaceObject2 with HasClipDepth at depth D clips layers D+1..clipDepth.
        for (let li = 0; li < layers.length; li++) {
          const layer = layers[li];
          if (layer.type === "guide") continue;
          if (layer.type === "folder") continue;
          const frame = getTweenedFrame(layer, frameIdx, scene.timeline);
          // Do not skip on isEmpty — the flag can be stale; use actual displayObjects length.
          if (!frame || frame.displayObjects.length === 0) continue;

          for (const obj of flattenDisplayObjects(frame.displayObjects)) {
            const depth = getOrAssignDepth(sceneIdx, li, obj.id);
            thisFrameDepths.set(depth, { objId: obj.id, displayObj: obj, layerIdx: li });
          }
        }

        // Pass 2: compute clipDepth for each mask layer now that all depths are known.
        // For mask layer at li, the clipDepth = max depth among all objects on the
        // consecutive run of 'masked' layers immediately following it (li+1, li+2, …).
        //
        // maskClipDepths: li → clipDepth value to use for objects on that layer
        const maskClipDepths = new Map<number, number>();

        for (let li = 0; li < layers.length; li++) {
          if (layers[li]!.type !== "mask") continue;

          let maxDepth = 0;
          for (let mli = li + 1; mli < layers.length; mli++) {
            const ml = layers[mli]!;
            if (ml.type !== "masked") break;
            const mFrame = getTweenedFrame(ml, frameIdx, scene.timeline);
            // Do not skip on isEmpty — the flag can be stale; use actual displayObjects length.
            if (!mFrame || mFrame.displayObjects.length === 0) continue;
            for (const obj of flattenDisplayObjects(mFrame.displayObjects)) {
              // Depths already assigned in pass 1 — getOrAssignDepth is idempotent
              const d = getOrAssignDepth(sceneIdx, mli, obj.id);
              if (d > maxDepth) maxDepth = d;
            }
          }

          if (maxDepth > 0) {
            maskClipDepths.set(li, maxDepth);
          }
        }

        // 1) Emit RemoveObject2 for depths that had something last frame but not this frame
        for (const [depth] of depthState) {
          if (!thisFrameDepths.has(depth)) {
            writer.writeTag(Tag.RemoveObject2, encodeRemoveObject2(depth));
            depthState.delete(depth);
            depthToObjId.delete(depth);
          }
        }

        // 2) Emit PlaceObject2 (new or update) for each object in this frame
        for (const [depth, { objId, displayObj, layerIdx }] of thisFrameDepths) {
          // Determine if this object belongs to a mask layer (HasClipDepth)
          const clipDepth = maskClipDepths.get(layerIdx);
          const prev = depthState.get(depth);

          // Extract transform from the (possibly interpolated) display object
          let x = 0;
          let y = 0;
          let scaleX = 1;
          let scaleY = 1;
          let rotation = 0;
          let skewX = 0;
          let skewY = 0;
          if ("x" in displayObj) x = (displayObj as { x: number }).x ?? 0;
          if ("y" in displayObj) y = (displayObj as { y: number }).y ?? 0;
          if ("scaleX" in displayObj)
            scaleX = (displayObj as { scaleX: number }).scaleX ?? 1;
          if ("scaleY" in displayObj)
            scaleY = (displayObj as { scaleY: number }).scaleY ?? 1;
          if ("rotation" in displayObj)
            rotation = (displayObj as { rotation: number }).rotation ?? 0;
          if ("skewX" in displayObj)
            skewX = (displayObj as { skewX: number }).skewX ?? 0;
          if ("skewY" in displayObj)
            skewY = (displayObj as { skewY: number }).skewY ?? 0;

          // NOTE: do NOT subtract registrationPoint from an instance's placement.
          // FLA import stores registrationPoint from the binary's absolute
          // registrationX/Y, which equals the instance's stage position (the
          // registration origin is where the instance sits). Subtracting it
          // collapsed every symbol instance to (0,0) — playButton/player stacked
          // at the stage top-left (task 1191). The placement x/y already IS the
          // stage position of the registration origin; the symbol's internal
          // geometry is centered on its own origin during definition encoding
          // (task 1171), so no extra offset is needed here.

          // Compute morph ratio if this is a morph shape object
          let morphRatio = -1;
          if (morphShapeObjIds.has(objId)) {
            const spanInfoList = morphObjSpanInfo.get(objId);
            if (spanInfoList) {
              for (const spanInfo of spanInfoList) {
                if (frameIdx >= spanInfo.startFrame && frameIdx <= spanInfo.endFrame) {
                  const spanLen = spanInfo.endFrame - spanInfo.startFrame + 1;
                  const frameOffset = frameIdx - spanInfo.startFrame;
                  const linearT = spanLen <= 1 ? 0 : frameOffset / (spanLen - 1);
                  const easedT = applyEase(linearT, spanInfo.ease, spanInfo.easeCurve);
                  morphRatio = Math.round(easedT * 65535);
                  break;
                }
              }
              // If not in any span (e.g. at the end keyframe itself), use 65535
              if (morphRatio === -1) morphRatio = 65535;
            }
          }

          const thisColorEffectKey = colorEffectKey(displayObj);
          const thisFiltersKey = filtersKey(displayObj);
          const thisClipActionsKey = computeClipActionsKey(displayObj);
          const thisLetterSpacingKey = displayObj.type === "text"
            ? String((displayObj as { letterSpacing?: number }).letterSpacing ?? 0)
            : "";
          const thisRestrictKey = displayObj.type === "text"
            ? ((displayObj as { restrict?: string }).restrict ?? "")
            : "";

          const isFirst = !prev;
          const posChanged =
            prev &&
            (prev.x !== x ||
              prev.y !== y ||
              prev.scaleX !== scaleX ||
              prev.scaleY !== scaleY ||
              prev.rotation !== rotation ||
              prev.skewX !== skewX ||
              prev.skewY !== skewY ||
              prev.objId !== objId ||
              prev.ratio !== morphRatio ||
              prev.colorEffectKey !== thisColorEffectKey ||
              prev.filtersKey !== thisFiltersKey ||
              prev.clipActionsKey !== thisClipActionsKey ||
              prev.letterSpacingKey !== thisLetterSpacingKey ||
              prev.restrictKey !== thisRestrictKey);

          if (isFirst) {
            // First placement at this depth
            if (
              displayObj.type === "shape" ||
              displayObj.type === "drawing-object"
            ) {
              const charId = objCharIdMap.get(objId)!;
              // Morph shape: use PlaceObject2WithRatio
              if (morphRatio >= 0) {
                const placeBody = encodePlaceObject2WithRatio(
                  charId,
                  depth,
                  x,
                  y,
                  morphRatio,
                  false
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              } else {
                const objTransform =
                  displayObj.type === "shape"
                    ? {
                        scaleX: displayObj.scaleX,
                        scaleY: displayObj.scaleY,
                        rotation: displayObj.rotation,
                      }
                    : undefined;
                if (clipDepth !== undefined) {
                  // Mask layer: place with HasClipDepth so the shape clips the layers below
                  const placeBody = encodePlaceObject2WithClipDepth(
                    charId,
                    depth,
                    x,
                    y,
                    clipDepth
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                } else if (hasEnabledFilters(displayObj.filters)) {
                  const shapeObj = displayObj as { colorEffect?: import("@flash/core").ColorEffect; visible?: boolean; alpha?: number; cacheAsBitmap?: boolean };
                  let shapeCXForm = shapeObj.colorEffect
                    ? colorEffectToCXForm(shapeObj.colorEffect) ?? undefined
                    : undefined;
                  if (!shapeCXForm && shapeObj.visible === false) {
                    shapeCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                  }
                  if (!shapeCXForm && shapeObj.alpha !== undefined && shapeObj.alpha !== 1) {
                    shapeCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: Math.round(Math.max(0, Math.min(1, shapeObj.alpha)) * 256), redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                  }
                  const placeBody = encodePlaceObject3WithFilters(
                    charId,
                    depth,
                    x,
                    y,
                    displayObj.filters!,
                    objTransform,
                    undefined,
                    undefined,
                    undefined,
                    !!shapeObj.cacheAsBitmap,
                    shapeCXForm
                  );
                  writer.writeTag(Tag.PlaceObject3, placeBody);
                } else if (displayObj.type === "shape" && displayObj.blendMode && displayObj.blendMode !== "normal") {
                  // blend mode requires PlaceObject3 (tag 70) with HasBlendMode bit set.
                  const placeBody = encodePlaceObject3WithBlendMode(
                    charId,
                    depth,
                    x,
                    y,
                    displayObj.blendMode,
                    displayObj.filters,
                    objTransform,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    !!displayObj.cacheAsBitmap
                  );
                  writer.writeTag(Tag.PlaceObject3, placeBody);
                } else if (displayObj.type === "shape" && displayObj.cacheAsBitmap) {
                  // cacheAsBitmap requires PlaceObject3 (tag 70) with HasCacheAsBitmap bit set.
                  // Also pass colorEffect as CXForm if present (bug fix: colorEffect was silently dropped).
                  const shapeObj = displayObj as { colorEffect?: import("@flash/core").ColorEffect; visible?: boolean; alpha?: number };
                  let shapeCacheCXForm = shapeObj.colorEffect
                    ? colorEffectToCXForm(shapeObj.colorEffect) ?? undefined
                    : undefined;
                  if (!shapeCacheCXForm && shapeObj.visible === false) {
                    shapeCacheCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                  }
                  if (!shapeCacheCXForm && shapeObj.alpha !== undefined && shapeObj.alpha !== 1) {
                    shapeCacheCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: Math.round(Math.max(0, Math.min(1, shapeObj.alpha)) * 256), redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                  }
                  const placeBody = encodePlaceObject3WithCacheAsBitmap(
                    charId,
                    depth,
                    x,
                    y,
                    objTransform,
                    shapeCacheCXForm
                  );
                  writer.writeTag(Tag.PlaceObject3, placeBody);
                } else if (displayObj.type === "shape" && (displayObj.colorEffect || displayObj.visible === false || (displayObj.alpha !== undefined && displayObj.alpha !== 1))) {
                  // colorEffect / visible=false / alpha: encode as CXFormWithAlpha.
                  let cxform = displayObj.colorEffect
                    ? colorEffectToCXForm(displayObj.colorEffect)
                    : null;
                  if (cxform === null && displayObj.visible === false) {
                    cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                  }
                  if (cxform === null && displayObj.alpha !== undefined && displayObj.alpha !== 1) {
                    cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: Math.round(Math.max(0, Math.min(1, displayObj.alpha)) * 256), redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                  }
                  if (cxform !== null) {
                    const placeBody = encodePlaceObject2WithCXForm(charId, depth, x, y, cxform, objTransform);
                    writer.writeTag(Tag.PlaceObject2, placeBody);
                  } else {
                    const placeBody = encodePlaceObject2(charId, depth, x, y, objTransform);
                    writer.writeTag(Tag.PlaceObject2, placeBody);
                  }
                } else {
                  const placeBody = encodePlaceObject2(
                    charId,
                    depth,
                    x,
                    y,
                    objTransform
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                }
              }
            } else if (displayObj.type === "text") {
              const charId = objCharIdMap.get(objId)!;
              // Named text fields (dynamic/input) must carry the instance name
              // in PlaceObject2 so AS2 can address them (_root.<name>.text = ...).
              const textName = displayObj.instanceName;
              if (hasEnabledFilters(displayObj.filters)) {
                // Filters require PlaceObject3 (tag 70). If the field also has
                // a name, pass it so both HasName and HasFilterList are set.
                // Also compute CXForm so colorEffect is preserved alongside filters.
                let textFilterCXForm = displayObj.colorEffect
                  ? colorEffectToCXForm(displayObj.colorEffect) ?? undefined
                  : undefined;
                if (!textFilterCXForm && displayObj.visible === false) {
                  textFilterCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                }
                const placeBody = encodePlaceObject3WithFilters(
                  charId,
                  depth,
                  x,
                  y,
                  displayObj.filters!,
                  undefined,
                  textName && textName.length > 0 ? textName : undefined,
                  undefined,
                  undefined,
                  undefined,
                  textFilterCXForm
                );
                writer.writeTag(Tag.PlaceObject3, placeBody);
              } else {
                // Check for color effect (CXFormWithAlpha).
                // Also synthesize a zero-alpha CXForm when visible===false.
                let cxform = displayObj.colorEffect
                  ? colorEffectToCXForm(displayObj.colorEffect)
                  : null;
                if (cxform === null && displayObj.visible === false) {
                  cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                }
                if (cxform !== null) {
                  const placeBody = encodePlaceObject2WithCXForm(
                    charId,
                    depth,
                    x,
                    y,
                    cxform,
                    undefined,
                    false,
                    textName && textName.length > 0 ? textName : undefined
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                } else {
                  const placeBody = textName && textName.length > 0
                    ? encodePlaceObject2WithName(charId, depth, x, y, textName)
                    : encodePlaceObject2ForText(charId, depth, x, y);
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                }
              }
              // If the text field has non-zero letterSpacing and a named instance,
              // emit a DoAction that calls setTextFormat to apply the spacing at runtime.
              // DefineEditText has no letterSpacing field — it must be set via AS2.
              const ls = displayObj.letterSpacing;
              if (ls != null && ls !== 0 && textName && textName.length > 0) {
                letterSpacingActions.push(
                  `var _tf=new TextFormat();_tf.letterSpacing=${ls};_root.${textName}.setTextFormat(_tf);`
                );
              }
              // If the input text field has a restrict pattern and a named instance,
              // emit a DoAction to set TextField.restrict at runtime.
              // DefineEditText has no built-in restrict field in the SWF spec.
              const restrict = displayObj.restrict;
              if (restrict != null && restrict.length > 0 && textName && textName.length > 0) {
                // Escape backslashes and double quotes in the pattern string.
                const escaped = restrict.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                restrictActions.push(`_root.${textName}.restrict = "${escaped}";`);
              }
            } else if (displayObj.type === "bitmap") {
              const charId = objCharIdMap.get(objId)!;
              const bmpTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0)
                ? { scaleX, scaleY, rotation }
                : undefined;
              const hasBlend = !!displayObj.blendMode && displayObj.blendMode !== 'normal';
              if (hasBlend || hasEnabledFilters(displayObj.filters)) {
                // blendMode or filters require PlaceObject3 (tag 70).
                // Compute CXForm so it can be embedded in the PO3 tag alongside blend/filters.
                const bmpCXForm = displayObj.colorEffect
                  ? colorEffectToCXForm(displayObj.colorEffect) ?? undefined
                  : undefined;
                const placeBody = hasBlend
                  ? encodePlaceObject3WithBlendMode(
                      charId,
                      depth,
                      x,
                      y,
                      displayObj.blendMode!,
                      displayObj.filters,
                      bmpTransform,
                      undefined,
                      bmpCXForm,
                      undefined,
                      undefined,
                      !!displayObj.cacheAsBitmap
                    )
                  : encodePlaceObject3WithFilters(
                      charId,
                      depth,
                      x,
                      y,
                      displayObj.filters!,
                      bmpTransform,
                      undefined,
                      undefined,
                      undefined,
                      !!displayObj.cacheAsBitmap,
                      bmpCXForm
                    );
                writer.writeTag(Tag.PlaceObject3, placeBody);
              } else {
                // Check for colorEffect or alpha (CXFormWithAlpha).
                const isHidden = displayObj.visible === false;
                let cxform = displayObj.colorEffect
                  ? colorEffectToCXForm(displayObj.colorEffect)
                  : null;
                if (cxform === null && isHidden) {
                  cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                }
                if (cxform === null && displayObj.alpha !== undefined && displayObj.alpha !== 1) {
                  cxform = {
                    redMult: 256, greenMult: 256, blueMult: 256,
                    alphaMult: Math.round(Math.max(0, Math.min(1, displayObj.alpha)) * 256),
                    redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0,
                  };
                }
                if (cxform !== null) {
                  const placeBody = encodePlaceObject2WithCXForm(charId, depth, x, y, cxform, bmpTransform);
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                } else {
                  const bmpInstanceName = displayObj.instanceName;
                  const placeBody = bmpInstanceName && bmpInstanceName.length > 0
                    ? encodePlaceObject2WithName(charId, depth, x, y, bmpInstanceName, bmpTransform)
                    : encodePlaceObject2(charId, depth, x, y, bmpTransform);
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                }
              }
            } else if (displayObj.type === "video") {
              const vdo = displayObj as VideoDisplayObject;
              const charId = videoCharIdMap.get(vdo.videoItemId);
              if (charId !== undefined) {
                const transform = videoFitTransform(vdo, videoStreams);
                const placeBody = encodePlaceObject2(charId, depth, x, y, transform);
                writer.writeTag(Tag.PlaceObject2, placeBody);
              }
            } else if (displayObj.type === "instance") {
              let charId = charIdMap.get(displayObj.symbolId);
              if (charId !== undefined) {
                // Button instances with instance-level on() handlers need a
                // unique DefineButton2 character (the handlers live in the tag,
                // not in PlaceObject2). Emit an inline DefineButton2 with the
                // instance's handlers and use its char ID for placement.
                const hasButtonHandlers =
                  !!displayObj.buttonHandlers && displayObj.buttonHandlers.length > 0;
                if (hasButtonHandlers) {
                  const sym = symbolById.get(displayObj.symbolId);
                  if (sym && (sym.symbolType === "button" || graphicButtonSymbolIds.has(sym.id))) {
                    const instCharId = writer.nextCharId();
                    const instHoisted: Array<{ tagType: number; body: Uint8Array }> = [];
                    const buttonBody = encodeDefineButton2(
                      instCharId,
                      sym,
                      doc,
                      charIdMap,
                      () => writer.nextCharId(),
                      instHoisted,
                      displayObj.buttonHandlers as readonly ButtonHandler[],
                      displayObj.trackAsMenu,
                      fontCharIdMap,
                      glyphIndexMapByFontKey
                    );
                    for (const def of instHoisted) {
                      writer.writeTag(def.tagType, def.body);
                    }
                    writer.writeTag(Tag.DefineButton2, buttonBody);
                    charId = instCharId;
                  }
                }

                // Mask layer: symbol instance as mask — place with HasClipDepth.
                if (clipDepth !== undefined) {
                  const instanceTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                    ? { scaleX, scaleY, rotation, skewX, skewY }
                    : undefined;
                  const placeBody = encodePlaceObject2WithClipDepth(
                    charId,
                    depth,
                    x,
                    y,
                    clipDepth,
                    instanceTransform
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                  depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, skewX, skewY, ratio: -1, colorEffectKey: thisColorEffectKey, filtersKey: thisFiltersKey, clipActionsKey: thisClipActionsKey, letterSpacingKey: thisLetterSpacingKey, restrictKey: thisRestrictKey });
                  continue;
                }

                // Resolve loopMode and firstFrame for graphic symbol instances.
                // loopMode / firstFrame (Loop / Play Once / Single Frame) only
                // apply to GRAPHIC symbols; movieclip and button instances play
                // their own timeline independently. Ignoring loopMode for non-
                // graphics prevents the synthesized loop-control clip actions
                // below (e.g. single-frame → gotoAndStop(1)) from freezing a
                // nested movieclip on frame 0. loopMode defaults to "loop" (no
                // extra encoding needed).
                const refSymbol = symbolById.get(displayObj.symbolId);
                const isGraphicInstance = refSymbol?.symbolType === "graphic";
                const loopMode = isGraphicInstance ? (displayObj.loopMode ?? "loop") : "loop";
                const instanceFirstFrame = isGraphicInstance ? (displayObj.firstFrame ?? 0) : 0;

                const hasBlend = !!displayObj.blendMode && displayObj.blendMode !== 'normal';
                const hasCacheAsBitmap = !!displayObj.cacheAsBitmap;
                // Synthesize clip actions for loopMode and firstFrame.
                // All three modes use clip actions (HasClipActions on PlaceObject2); the
                // Ratio field approach for single-frame was dropped because Ruffle's MovieClip
                // ignores on_ratio_changed and always shows frame 1 regardless of ratio.
                //
                //  play-once: enterFrame fires stop() when the clip reaches its last frame.
                //  single-frame: load fires gotoAndStop(N) to freeze on the chosen frame.
                //  loop/play-once with firstFrame>0: load fires gotoAndPlay(N) to start
                //    playback from the chosen frame.
                let effectiveClipActions = displayObj.clipActions ?? [];
                if (loopMode === "play-once") {
                  const playOnceAction: ClipAction = {
                    event: "enterFrame",
                    script: "if (this._currentframe >= this._totalframes) { this.stop(); }",
                  };
                  effectiveClipActions = [...effectiveClipActions, playOnceAction];
                }
                if (loopMode === "single-frame") {
                  // gotoAndStop uses 1-based frame numbers; instanceFirstFrame is 0-based.
                  const singleFrameAction: ClipAction = {
                    event: "load",
                    script: `this.gotoAndStop(${instanceFirstFrame + 1});`,
                  };
                  effectiveClipActions = [...effectiveClipActions, singleFrameAction];
                }
                // If firstFrame > 0, emit a load clip action to seek to the starting frame
                // before playback begins. This applies to "loop" and "play-once" modes.
                if ((loopMode === "loop" || loopMode === "play-once") && instanceFirstFrame > 0) {
                  const seekAction: ClipAction = {
                    event: "load",
                    script: `this.gotoAndPlay(${instanceFirstFrame + 1});`,
                  };
                  effectiveClipActions = [...effectiveClipActions, seekAction];
                }
                const hasClipActions = effectiveClipActions.length > 0;

                // Compute CXForm once — used in both the blend/filter and cacheAsBitmap paths.
                const instCXForm = displayObj.colorEffect
                  ? colorEffectToCXForm(displayObj.colorEffect) ?? undefined
                  : undefined;

                if (hasBlend || hasEnabledFilters(displayObj.filters)) {
                  // Blend/filter path: use PlaceObject3.
                  // Also embed CXForm (colorEffect) in the PO3 tag if present.
                  const placeBody = hasBlend
                    ? encodePlaceObject3WithBlendMode(
                        charId,
                        depth,
                        x,
                        y,
                        displayObj.blendMode!,
                        displayObj.filters,
                        undefined,
                        undefined,
                        instCXForm,
                        undefined,
                        (displayObj as SymbolInstance).instanceName ?? undefined,
                        !!displayObj.cacheAsBitmap
                      )
                    : encodePlaceObject3WithFilters(
                        charId,
                        depth,
                        x,
                        y,
                        displayObj.filters!,
                        undefined,
                        (displayObj as SymbolInstance).instanceName ?? undefined,
                        undefined,
                        undefined,
                        !!displayObj.cacheAsBitmap,
                        instCXForm
                      );
                  writer.writeTag(Tag.PlaceObject3, placeBody);
                  // Clip actions (play-once / single-frame / firstFrame seek): attach via a
                  // PlaceObject2 Move tag on the same depth.
                  if (hasClipActions) {
                    const moveBody = encodePlaceObject2MoveWithClipActions(depth, effectiveClipActions);
                    writer.writeTag(Tag.PlaceObject2, moveBody);
                  }
                } else if (hasCacheAsBitmap) {
                  // cacheAsBitmap requires PlaceObject3 (tag 70) with HasCacheAsBitmap bit set.
                  const instanceTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                    ? { scaleX, scaleY, rotation, skewX, skewY }
                    : undefined;
                  const placeBody = encodePlaceObject3WithCacheAsBitmap(
                    charId,
                    depth,
                    x,
                    y,
                    instanceTransform,
                    instCXForm
                  );
                  writer.writeTag(Tag.PlaceObject3, placeBody);
                } else if (hasClipActions) {
                  // Clip actions: encode CLIPACTIONRECORD block in PlaceObject2
                  const transform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                    ? { scaleX, scaleY, rotation, skewX, skewY }
                    : undefined;
                  const placeBody = encodePlaceObject2WithClipActions(
                    charId,
                    depth,
                    x,
                    y,
                    effectiveClipActions,
                    transform,
                    displayObj.instanceName
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                } else {
                  // Check for color effect (CXFormWithAlpha).
                  // Also synthesize a zero-alpha CXForm when visible===false, or from
                  // standalone alpha when colorEffect is absent.
                  let cxform = displayObj.colorEffect
                    ? colorEffectToCXForm(displayObj.colorEffect)
                    : null;
                  if (cxform === null && displayObj.visible === false) {
                    // visible=false: synthesize a fully-transparent CXForm (alphaMult=0)
                    cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                  }
                  if (cxform === null && displayObj.alpha !== undefined && displayObj.alpha !== 1) {
                    cxform = {
                      redMult: 256, greenMult: 256, blueMult: 256,
                      alphaMult: Math.round(Math.max(0, Math.min(1, displayObj.alpha)) * 256),
                      redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0,
                    };
                  }
                  if (cxform !== null) {
                    const transform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                      ? { scaleX, scaleY, rotation, skewX, skewY }
                      : undefined;
                    const placeBody = encodePlaceObject2WithCXForm(
                      charId,
                      depth,
                      x,
                      y,
                      cxform,
                      transform,
                      false,
                      displayObj.instanceName ?? undefined
                    );
                    writer.writeTag(Tag.PlaceObject2, placeBody);
                  } else {
                    const instanceName = displayObj.instanceName;
                    const instanceTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                      ? { scaleX, scaleY, rotation, skewX, skewY }
                      : undefined;
                    if (instanceName && instanceName.length > 0) {
                      const placeBody = encodePlaceObject2WithName(
                        charId,
                        depth,
                        x,
                        y,
                        instanceName,
                        instanceTransform
                      );
                      writer.writeTag(Tag.PlaceObject2, placeBody);
                    } else {
                      const placeBody = encodePlaceObject2(charId, depth, x, y, instanceTransform);
                      writer.writeTag(Tag.PlaceObject2, placeBody);
                    }
                  }
                }
              }
            }

            // If this is a newly-placed instance with an accessibility.tabIndex,
            // queue a DoAction to set tabEnabled and tabIndex via AS2.
            // Requires an instanceName so AS2 can address the object (_root.name).
            if (
              displayObj.type === "instance" &&
              displayObj.instanceName &&
              displayObj.instanceName.length > 0 &&
              displayObj.accessibility?.tabIndex != null
            ) {
              const name = displayObj.instanceName;
              const idx = displayObj.accessibility.tabIndex;
              // tabEnabled defaults to true for objects with a set tabIndex,
              // but emit it explicitly so Flash Player custom tab order works.
              const tabEnabled = displayObj.accessibility.enabled !== false;
              tabOrderActions.push(
                `_root.${name}.tabEnabled = ${tabEnabled};` +
                `_root.${name}.tabIndex = ${idx};`
              );
            }

            // If this is a newly-placed instance with _accProps fields (name,
            // description, shortcut, forceSimple, silent), emit an AS2 DoAction
            // to set the _accProps object on the instance. Flash 8 exposes these
            // to MSAA screen readers via the _accProps MovieClip property.
            // Requires an instanceName to address the object (_root.name).
            if (
              displayObj.type === "instance" &&
              displayObj.instanceName &&
              displayObj.instanceName.length > 0 &&
              displayObj.accessibility != null
            ) {
              const acc = displayObj.accessibility;
              const hasName = acc.name != null && acc.name !== "";
              const hasDesc = acc.description != null && acc.description !== "";
              const hasShortcut = acc.shortcut != null && acc.shortcut !== "";
              const hasForceSimple = acc.forceSimple != null;
              // "Make object accessible" unchecked (enabled === false) hides the
              // instance from MSAA screen readers via _accProps.silent = true.
              // Flash still silences the object even when other a11y fields are
              // set, so this is emitted alongside (not instead of) them.
              const hasSilent = acc.enabled === false;
              if (hasName || hasDesc || hasShortcut || hasForceSimple || hasSilent) {
                const iname = displayObj.instanceName;
                // Build the _accProps script:
                //   var _ap = new Object();
                //   _ap.name = "...";          // optional
                //   _ap.description = "...";   // optional
                //   _ap.shortcut = "...";       // optional
                //   _ap.forceSimple = true;     // optional
                //   _ap.silent = true;          // optional (enabled === false)
                //   _root.iname._accProps = _ap;
                const parts: string[] = ["var _ap = new Object();"];
                if (hasName) {
                  const escaped = (acc.name as string).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                  parts.push(`_ap.name = "${escaped}";`);
                }
                if (hasDesc) {
                  const escaped = (acc.description as string).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                  parts.push(`_ap.description = "${escaped}";`);
                }
                if (hasShortcut) {
                  const escaped = (acc.shortcut as string).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                  parts.push(`_ap.shortcut = "${escaped}";`);
                }
                if (hasForceSimple) {
                  parts.push(`_ap.forceSimple = ${acc.forceSimple ? "true" : "false"};`);
                }
                if (hasSilent) {
                  parts.push(`_ap.silent = true;`);
                }
                parts.push(`_root.${iname}._accProps = _ap;`);
                accPropsActions.push(parts.join(""));
              }
            }

            depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, skewX, skewY, ratio: morphRatio, colorEffectKey: thisColorEffectKey, filtersKey: thisFiltersKey, clipActionsKey: thisClipActionsKey, letterSpacingKey: thisLetterSpacingKey, restrictKey: thisRestrictKey });
          } else if (posChanged) {
            // Object moved, scaled, rotated, or replaced — emit PlaceObject2+Move
            if (
              displayObj.type === "shape" ||
              displayObj.type === "drawing-object"
            ) {
              const charId = objCharIdMap.get(objId)!;
              // Morph shape: use PlaceObject2WithRatio (move variant)
              if (morphRatio >= 0) {
                const placeBody = encodePlaceObject2WithRatio(
                  charId,
                  depth,
                  x,
                  y,
                  morphRatio,
                  true
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
                depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, skewX, skewY, ratio: morphRatio, colorEffectKey: thisColorEffectKey, filtersKey: thisFiltersKey, clipActionsKey: thisClipActionsKey, letterSpacingKey: thisLetterSpacingKey, restrictKey: thisRestrictKey });
                continue; // skip the generic depthState.set below
              }
              const objTransform =
                displayObj.type === "shape"
                  ? {
                      scaleX: displayObj.scaleX,
                      scaleY: displayObj.scaleY,
                      rotation: displayObj.rotation,
                    }
                  : undefined;
              const hasBlend = displayObj.type === "shape" && !!displayObj.blendMode && displayObj.blendMode !== "normal";
              if (hasBlend) {
                // Blend mode requires PlaceObject3 with move=true to preserve blend mode across moves
                const placeBody = encodePlaceObject3WithBlendMode(
                  charId,
                  depth,
                  x,
                  y,
                  displayObj.blendMode!,
                  displayObj.filters,
                  objTransform,
                  undefined,
                  undefined,
                  true,   // move = true
                  undefined,
                  !!(displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap
                );
                writer.writeTag(Tag.PlaceObject3, placeBody);
              } else if (hasEnabledFilters(displayObj.filters)) {
                // Filters require PlaceObject3 — re-emit full placement with filter list
                const shapeMoveObj = displayObj as { colorEffect?: import("@flash/core").ColorEffect; visible?: boolean; alpha?: number; cacheAsBitmap?: boolean };
                let shapeMoveCXForm = shapeMoveObj.colorEffect
                  ? colorEffectToCXForm(shapeMoveObj.colorEffect) ?? undefined
                  : undefined;
                if (!shapeMoveCXForm && shapeMoveObj.visible === false) {
                  shapeMoveCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                }
                if (!shapeMoveCXForm && shapeMoveObj.alpha !== undefined && shapeMoveObj.alpha !== 1) {
                  shapeMoveCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: Math.round(Math.max(0, Math.min(1, shapeMoveObj.alpha)) * 256), redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                }
                const placeBody = encodePlaceObject3WithFilters(
                  charId,
                  depth,
                  x,
                  y,
                  displayObj.filters!,
                  objTransform,
                  undefined,
                  undefined,
                  true,   // move = true
                  !!shapeMoveObj.cacheAsBitmap,
                  shapeMoveCXForm
                );
                writer.writeTag(Tag.PlaceObject3, placeBody);
              } else if (displayObj.type === "shape" && displayObj.visible === false) {
                // visible=false: encode as zero-alpha CXForm move
                const zeroCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                const placeBody = encodePlaceObject2WithCXForm(charId, depth, x, y, zeroCXForm, objTransform, true);
                writer.writeTag(Tag.PlaceObject2, placeBody);
              } else if (displayObj.type === "shape" && displayObj.alpha !== undefined && displayObj.alpha !== 1) {
                // alpha != 1: encode CXForm move with alphaMult
                const alphaCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: Math.round(Math.max(0, Math.min(1, displayObj.alpha)) * 256), redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                const placeBody = encodePlaceObject2WithCXForm(charId, depth, x, y, alphaCXForm, objTransform, true);
                writer.writeTag(Tag.PlaceObject2, placeBody);
              } else if (displayObj.type === "shape" && (displayObj as { cacheAsBitmap?: boolean }).cacheAsBitmap) {
                // cacheAsBitmap on move: re-emit PlaceObject3 with HasCacheAsBitmap
                const shapeMoveCache = displayObj as { colorEffect?: import("@flash/core").ColorEffect; visible?: boolean; alpha?: number };
                let shapeCacheMoveCXForm = shapeMoveCache.colorEffect
                  ? colorEffectToCXForm(shapeMoveCache.colorEffect) ?? undefined
                  : undefined;
                if (!shapeCacheMoveCXForm && shapeMoveCache.visible === false) {
                  shapeCacheMoveCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                }
                const placeBody = encodePlaceObject3WithCacheAsBitmap(charId, depth, x, y, objTransform, shapeCacheMoveCXForm);
                writer.writeTag(Tag.PlaceObject3, placeBody);
              } else {
                // Character changed at same depth — use Move+Character flags
                const newCharId =
                  prev!.objId !== objId ? charId : undefined;
                const placeBody = encodePlaceObject2Move(
                  charId,
                  depth,
                  x,
                  y,
                  objTransform,
                  newCharId !== undefined
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              }
            } else if (displayObj.type === "text") {
              const charId = objCharIdMap.get(objId)!;
              const textMoveName = displayObj.instanceName;
              if (hasEnabledFilters(displayObj.filters)) {
                // Filters require PlaceObject3 with the Move flag set so the
                // filter list is re-applied when the text field moves across frames.
                let textMoveCXForm = displayObj.colorEffect
                  ? colorEffectToCXForm(displayObj.colorEffect) ?? undefined
                  : undefined;
                if (!textMoveCXForm && displayObj.visible === false) {
                  textMoveCXForm = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                }
                const placeBody = encodePlaceObject3WithFilters(
                  charId,
                  depth,
                  x,
                  y,
                  displayObj.filters!,
                  undefined,
                  textMoveName && textMoveName.length > 0 ? textMoveName : undefined,
                  undefined,
                  true,  // move = true
                  undefined,
                  textMoveCXForm
                );
                writer.writeTag(Tag.PlaceObject3, placeBody);
              } else {
                let cxform = displayObj.colorEffect
                  ? colorEffectToCXForm(displayObj.colorEffect)
                  : null;
                if (cxform === null && displayObj.visible === false) {
                  cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                }
                if (cxform !== null) {
                  // Move + HasMatrix + HasColorTransform (no HasCharacter unless replacing)
                  const placeBody = encodePlaceObject2WithCXForm(
                    charId,
                    depth,
                    x,
                    y,
                    cxform,
                    undefined,
                    true,  // move = true
                    textMoveName && textMoveName.length > 0 ? textMoveName : undefined
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                } else {
                  const placeBody = encodePlaceObject2Move(
                    charId,
                    depth,
                    x,
                    y,
                    undefined,
                    prev!.objId !== objId
                  );
                  writer.writeTag(Tag.PlaceObject2, placeBody);
                }
              }
              // posChanged text path: also collect letterSpacing/restrict DoActions
              // so changes between keyframes are not silently dropped.
              const textMoveNameForAction = displayObj.instanceName;
              const lsMove = displayObj.letterSpacing;
              if (lsMove != null && lsMove !== 0 && textMoveNameForAction && textMoveNameForAction.length > 0) {
                letterSpacingActions.push(
                  `var _tf=new TextFormat();_tf.letterSpacing=${lsMove};_root.${textMoveNameForAction}.setTextFormat(_tf);`
                );
              }
              const restrictMove = displayObj.restrict;
              if (restrictMove != null && restrictMove.length > 0 && textMoveNameForAction && textMoveNameForAction.length > 0) {
                const escapedMove = restrictMove.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                restrictActions.push(`_root.${textMoveNameForAction}.restrict = "${escapedMove}";`);
              }
            } else if (displayObj.type === "bitmap") {
              const charId = objCharIdMap.get(objId)!;
              const bmpTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0)
                ? { scaleX, scaleY, rotation }
                : undefined;
              const isHidden = displayObj.visible === false;
              const hasAlpha =
                (displayObj.alpha !== undefined && displayObj.alpha !== 1) || isHidden;
              if (hasAlpha) {
                // Move with color transform — emit Move+HasMatrix+HasColorTransform
                const placeBody = encodePlaceObject2WithAlpha(
                  charId,
                  depth,
                  x,
                  y,
                  isHidden ? 0 : displayObj.alpha!,
                  bmpTransform,
                  true
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              } else {
                const placeBody = encodePlaceObject2Move(
                  charId,
                  depth,
                  x,
                  y,
                  bmpTransform,
                  prev!.objId !== objId
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              }
            } else if (displayObj.type === "video") {
              const vdo = displayObj as VideoDisplayObject;
              const charId = videoCharIdMap.get(vdo.videoItemId);
              if (charId !== undefined) {
                const transform = videoFitTransform(vdo, videoStreams);
                const placeBody = encodePlaceObject2Move(
                  charId,
                  depth,
                  x,
                  y,
                  transform,
                  prev!.objId !== objId
                );
                writer.writeTag(Tag.PlaceObject2, placeBody);
              }
            } else if (displayObj.type === "instance") {
              const charId = charIdMap.get(displayObj.symbolId);
              if (charId !== undefined) {
                // Check if blend mode requires PlaceObject3 for the Move.
                const hasBlend = !!displayObj.blendMode && displayObj.blendMode !== 'normal';
                if (hasBlend) {
                  // PlaceObject3 Move: preserves blend mode across positional updates.
                  const moveTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                    ? { scaleX, scaleY, rotation, skewX, skewY }
                    : undefined;
                  let cxformForBlend = displayObj.colorEffect
                    ? colorEffectToCXForm(displayObj.colorEffect) ?? undefined
                    : undefined;
                  if (!cxformForBlend && displayObj.visible === false) {
                    cxformForBlend = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                  }
                  if (!cxformForBlend && displayObj.alpha !== undefined && displayObj.alpha !== 1) {
                    cxformForBlend = {
                      redMult: 256, greenMult: 256, blueMult: 256,
                      alphaMult: Math.round(Math.max(0, Math.min(1, displayObj.alpha)) * 256),
                      redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0,
                    };
                  }
                  const placeBody = encodePlaceObject3WithBlendMode(
                    charId,
                    depth,
                    x,
                    y,
                    displayObj.blendMode!,
                    displayObj.filters,
                    moveTransform,
                    undefined,
                    cxformForBlend,
                    true,  // move = true
                    undefined,
                    !!displayObj.cacheAsBitmap
                  );
                  writer.writeTag(Tag.PlaceObject3, placeBody);
                } else if (hasEnabledFilters(displayObj.filters)) {
                  // Filters-only (no blend mode): PlaceObject3 Move with filter list.
                  const moveTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                    ? { scaleX, scaleY, rotation, skewX, skewY }
                    : undefined;
                  let cxformForFilters = displayObj.colorEffect
                    ? colorEffectToCXForm(displayObj.colorEffect) ?? undefined
                    : undefined;
                  if (!cxformForFilters && displayObj.visible === false) {
                    cxformForFilters = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                  }
                  if (!cxformForFilters && displayObj.alpha !== undefined && displayObj.alpha !== 1) {
                    cxformForFilters = {
                      redMult: 256, greenMult: 256, blueMult: 256,
                      alphaMult: Math.round(Math.max(0, Math.min(1, displayObj.alpha)) * 256),
                      redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0,
                    };
                  }
                  const filtersPlaceBody = encodePlaceObject3WithFilters(
                    charId,
                    depth,
                    x,
                    y,
                    displayObj.filters!,
                    moveTransform,
                    displayObj.instanceName ?? undefined,
                    undefined,
                    true,   // move = true
                    !!displayObj.cacheAsBitmap,
                    cxformForFilters
                  );
                  writer.writeTag(Tag.PlaceObject3, filtersPlaceBody);
                } else {
                  // Compute effective clip actions (loopMode, firstFrame, explicit clipActions).
                  const moveLoopMode = displayObj.loopMode ?? "loop";
                  const moveFirstFrame = displayObj.firstFrame ?? 0;
                  let moveEffectiveClipActions = displayObj.clipActions ?? [];
                  if (moveLoopMode === "play-once") {
                    moveEffectiveClipActions = [...moveEffectiveClipActions, {
                      event: "enterFrame",
                      script: "if (this._currentframe >= this._totalframes) { this.stop(); }",
                    }];
                  }
                  if (moveLoopMode === "single-frame") {
                    moveEffectiveClipActions = [...moveEffectiveClipActions, {
                      event: "load",
                      script: `this.gotoAndStop(${moveFirstFrame + 1});`,
                    }];
                  }
                  if ((moveLoopMode === "loop" || moveLoopMode === "play-once") && moveFirstFrame > 0) {
                    moveEffectiveClipActions = [...moveEffectiveClipActions, {
                      event: "load",
                      script: `this.gotoAndPlay(${moveFirstFrame + 1});`,
                    }];
                  }
                  const moveHasClipActions = moveEffectiveClipActions.length > 0;

                  // Check for color effect (CXFormWithAlpha).
                  // Also synthesize a zero-alpha CXForm when visible===false, or from
                  // standalone alpha when colorEffect is absent.
                  let cxform = displayObj.colorEffect
                    ? colorEffectToCXForm(displayObj.colorEffect)
                    : null;
                  if (cxform === null && displayObj.visible === false) {
                    cxform = { redMult: 256, greenMult: 256, blueMult: 256, alphaMult: 0, redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0 };
                  }
                  if (cxform === null && displayObj.alpha !== undefined && displayObj.alpha !== 1) {
                    cxform = {
                      redMult: 256, greenMult: 256, blueMult: 256,
                      alphaMult: Math.round(Math.max(0, Math.min(1, displayObj.alpha)) * 256),
                      redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0,
                    };
                  }
                  if (cxform !== null) {
                    const transform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                      ? { scaleX, scaleY, rotation, skewX, skewY }
                      : undefined;
                    // Move + HasMatrix + HasColorTransform (no HasCharacter unless replacing)
                    const placeBody = encodePlaceObject2WithCXForm(
                      charId,
                      depth,
                      x,
                      y,
                      cxform,
                      transform,
                      true,  // move = true
                      displayObj.instanceName ?? undefined
                    );
                    writer.writeTag(Tag.PlaceObject2, placeBody);
                    // If clip actions also changed, emit a separate Move+ClipActions tag.
                    if (moveHasClipActions) {
                      const clipBody = encodePlaceObject2MoveWithClipActions(depth, moveEffectiveClipActions);
                      writer.writeTag(Tag.PlaceObject2, clipBody);
                    }
                  } else if (moveHasClipActions) {
                    // Position + clip actions: emit position move then clip-actions tag.
                    const moveTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                      ? { scaleX, scaleY, rotation, skewX, skewY }
                      : undefined;
                    const moveBody = encodePlaceObject2Move(
                      charId,
                      depth,
                      x,
                      y,
                      moveTransform,
                      prev!.objId !== objId
                    );
                    writer.writeTag(Tag.PlaceObject2, moveBody);
                    const clipBody = encodePlaceObject2MoveWithClipActions(depth, moveEffectiveClipActions);
                    writer.writeTag(Tag.PlaceObject2, clipBody);
                  } else {
                    const moveTransform = (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skewX !== 0 || skewY !== 0)
                      ? { scaleX, scaleY, rotation, skewX, skewY }
                      : undefined;
                    const placeBody = encodePlaceObject2Move(
                      charId,
                      depth,
                      x,
                      y,
                      moveTransform,
                      prev!.objId !== objId
                    );
                    writer.writeTag(Tag.PlaceObject2, placeBody);
                  }
                }
              }
            }
            depthState.set(depth, { objId, x, y, scaleX, scaleY, rotation, skewX, skewY, ratio: morphRatio, colorEffectKey: thisColorEffectKey, filtersKey: thisFiltersKey, clipActionsKey: thisClipActionsKey, letterSpacingKey: thisLetterSpacingKey, restrictKey: thisRestrictKey });
          }
          // else: unchanged — emit nothing
        }

        // Emit sound tags for any keyframes at exactly this frame index that have sound.
        // For stream mode: SoundStreamHead + first SoundStreamBlock are handled by the
        // streamSounds pre-computation above; per-frame blocks are emitted just before
        // ShowFrame below. Here we only handle event/start/stop sounds.
        // For sounds with a linkageIdentifier: emit StartSound2 (tag 89) by class name.
        // For other modes (event/start/stop): emit StartSound (tag 15) by char ID.
        for (const layer of layers) {
          for (const frame of layer.frames) {
            if (
              frame.isKeyframe &&
              frame.index === frameIdx &&
              frame.sound !== null
            ) {
              const soundId = soundIdMap.get(frame.sound.libraryItemId);
              if (soundId !== undefined) {
                if (frame.sound.syncMode !== "stream") {
                  // Find the SoundItem to check for AS2 linkage class name.
                  const soundItem = soundItems.find(
                    (si) => si.id === frame.sound!.libraryItemId
                  );
                  const soundInfoOpts = {
                    loops: frame.sound.repeatCount,
                    stop: frame.sound.syncMode === "stop",
                    noMultiple: frame.sound.syncMode === "start",
                    effect: frame.sound.customEnvelope ? undefined : frame.sound.effect,
                    envelope: frame.sound.customEnvelope,
                    inPoint: frame.sound.inPoint,
                    outPoint: frame.sound.outPoint,
                  };
                  if (soundItem?.linkageIdentifier) {
                    // StartSound2 (tag 89): trigger by AS2 linkage class name.
                    const startSound2Body = encodeStartSound2(
                      soundItem.linkageIdentifier,
                      soundInfoOpts
                    );
                    writer.writeTag(Tag.StartSound2, startSound2Body);
                  } else {
                    const startSoundBody = encodeStartSound(soundId, soundInfoOpts);
                    writer.writeTag(Tag.StartSound, startSoundBody);
                  }
                }
              }
            }
          }
        }

        // Emit per-frame FrameLabel (tag 43) if any keyframe at this index has a
        // non-empty label of type "name" or "anchor".
        // Two FrameLabel tags at the same frame position are fine (second overrides);
        // emitting a user-defined label at frame 0 alongside the scene-name label is
        // correct and necessary for gotoAndPlay("start") to work when frame 0 is named.
        // Comment-type labels (labelType === "comment") are NOT emitted as FrameLabel.
        {
          let frameLabel: string | null = null;
          let frameLabelType: string = "name";
          outerLabel: for (const layer of layers) {
            for (const frame of layer.frames) {
              if (
                frame.index === frameIdx &&
                frame.isKeyframe &&
                frame.label !== "" &&
                (frame.labelType === "name" || frame.labelType === "anchor")
              ) {
                frameLabel = frame.label;
                frameLabelType = frame.labelType;
                break outerLabel;
              }
            }
          }
          if (frameLabel) {
            writer.writeTag(
              Tag.FrameLabel,
              encodeFrameLabel(frameLabel, frameLabelType === "anchor")
            );
          }
        }

        // Emit DoAction for any frame carrying a script at exactly this frame
        // index. DoAction must appear BEFORE ShowFrame so actions execute on
        // frame entry. The script is emitted regardless of `isKeyframe`: while
        // Flash's authoring UI only lets you attach a script to a keyframe, the
        // SWF runtime executes a DoAction on whatever frame it sits, and a
        // motion/shape tween's in-between frames can legitimately carry a script
        // (e.g. a `stop()` parked mid-tween). Gating on isKeyframe silently
        // dropped such scripts, so the movie never stopped on that frame.
        for (const layer of layers) {
          for (const frame of layer.frames) {
            if (
              frame.index === frameIdx &&
              frame.script?.trim()
            ) {
              const actionBytes = compileAS2(frame.script);
              if (actionBytes.length > 0) {
                // DoAction payload = AVM1 bytecode + EndAction (0x00)
                const doActionBody = new Uint8Array(actionBytes.length + 1);
                doActionBody.set(actionBytes);
                // doActionBody[actionBytes.length] is already 0x00 (EndAction)
                writer.writeTag(Tag.DoAction, doActionBody);
              }
            }
          }
        }

        // Emit DoAction for any text fields with non-zero letterSpacing placed this frame.
        // Each script: var _tf=new TextFormat();_tf.letterSpacing=N;_root.name.setTextFormat(_tf);
        for (const script of letterSpacingActions) {
          const actionBytes = compileAS2(script);
          if (actionBytes.length > 0) {
            const doActionBody = new Uint8Array(actionBytes.length + 1);
            doActionBody.set(actionBytes);
            // doActionBody[actionBytes.length] is already 0x00 (EndAction)
            writer.writeTag(Tag.DoAction, doActionBody);
          }
        }

        // Emit DoAction for any input text fields with a restrict pattern placed this frame.
        // Each script: _root.name.restrict = "pattern";
        for (const script of restrictActions) {
          const actionBytes = compileAS2(script);
          if (actionBytes.length > 0) {
            const doActionBody = new Uint8Array(actionBytes.length + 1);
            doActionBody.set(actionBytes);
            // doActionBody[actionBytes.length] is already 0x00 (EndAction)
            writer.writeTag(Tag.DoAction, doActionBody);
          }
        }

        // Emit DoAction for tab-order scripts (accessibility.tabIndex / useCustomTabOrder).
        // Global script (_root.tabChildren = false) is first, then per-object scripts.
        for (const script of tabOrderActions) {
          const actionBytes = compileAS2(script);
          if (actionBytes.length > 0) {
            const doActionBody = new Uint8Array(actionBytes.length + 1);
            doActionBody.set(actionBytes);
            // doActionBody[actionBytes.length] is already 0x00 (EndAction)
            writer.writeTag(Tag.DoAction, doActionBody);
          }
        }

        // Emit DoAction for _accProps scripts (accessibility name/description/shortcut).
        for (const script of accPropsActions) {
          const actionBytes = compileAS2(script);
          if (actionBytes.length > 0) {
            const doActionBody = new Uint8Array(actionBytes.length + 1);
            doActionBody.set(actionBytes);
            // doActionBody[actionBytes.length] is already 0x00 (EndAction)
            writer.writeTag(Tag.DoAction, doActionBody);
          }
        }

        // Emit DoAction for _quality initialization on scene 0 / frame 0.
        // Only emitted when quality is explicitly set to a non-default value (not "high").
        for (const script of qualityActions) {
          const actionBytes = compileAS2(script);
          if (actionBytes.length > 0) {
            const doActionBody = new Uint8Array(actionBytes.length + 1);
            doActionBody.set(actionBytes);
            // doActionBody[actionBytes.length] is already 0x00 (EndAction)
            writer.writeTag(Tag.DoAction, doActionBody);
          }
        }

        // Emit one VideoFrame (tag 61) per video stream for this SWF frame,
        // advancing through the demuxed FLV frames. Only on scene 0 (videos are
        // global characters placed once on the first scene's timeline).
        if (sceneIdx === 0) {
          for (const v of videoFrameAdvancers) {
            const payload = v.payloads[frameIdx];
            if (payload !== undefined) {
              writer.writeTag(
                Tag.VideoFrame,
                encodeVideoFrame(v.charId, frameIdx, payload)
              );
            }
          }
        }

        // Emit per-frame SoundStreamBlock tags for active stream sounds.
        // SWF spec requires one SoundStreamBlock per ShowFrame, interleaved
        // just before each ShowFrame tag. Each block carries only that frame's
        // audio samples. SoundStreamHead is emitted once at the stream's start
        // frame (chunkIdx===0), then one SoundStreamBlock per subsequent frame.
        for (const ss of streamSounds) {
          const chunkIdx = frameIdx - ss.startFrame;
          if (chunkIdx === 0) {
            // Emit SoundStreamHead just before the first SoundStreamBlock
            writer.writeTag(Tag.SoundStreamHead, ss.headBody);
          }
          if (chunkIdx >= 0 && chunkIdx < ss.chunks.length) {
            const chunk = ss.chunks[chunkIdx];
            let blockBody: Uint8Array;
            if (ss.isMP3) {
              // MP3 SoundStreamBlock: SampleCount UI16 + SeekSamples SI16 + data
              // SeekSamples is 0 for all blocks (no seek offset needed)
              blockBody = encodeSoundStreamBlockMp3(ss.samplesPerFrame, 0, chunk);
            } else {
              blockBody = encodeSoundStreamBlock(chunk);
            }
            writer.writeTag(Tag.SoundStreamBlock, blockBody);
          }
        }

        writer.writeTag(Tag.ShowFrame, new Uint8Array(0));
      }
    }
  }
}
