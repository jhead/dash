/**
 * Depth-assignment helpers.
 *
 * (The full depth pre-pass — stable per-(scene:layer:objId) allocation with
 * mask grouping — is threaded through CompileContext by the orchestrator; this
 * module currently owns the standalone scene frame-count helper.)
 */
import type { FlashDocument, Timeline } from "@flash/core";
import { layerFrameCount } from "@flash/core";
import { flattenDisplayObjects } from "./display.js";

/**
 * Return the number of frames in a Timeline (max layer frameCount, min 1).
 */
export function sceneFrameCount(timeline: Timeline): number {
  if (!timeline.layers.length) return 1;
  let max = 1;
  for (const layer of timeline.layers) {
    const count = layerFrameCount(layer);
    if (count > max) max = count;
  }
  return max;
}

/** Allocates stable, monotonically-increasing SWF depths per (scene,layer,obj). */
export interface DepthAllocator {
  /**
   * Idempotently return the depth for an object in a specific scene+layer.
   * The same (sceneIdx, layerIdx, objId) always maps to the same depth; a new
   * triple gets the next free depth. Used by both the depth pre-pass (to seed
   * depths in visual order) and the frame loop (to resolve them).
   */
  getOrAssignDepth(sceneIdx: number, layerIdx: number, objId: string): number;
}

/** Create a fresh depth allocator (starts at depth 1). */
export function createDepthAllocator(): DepthAllocator {
  const layerObjDepth = new Map<string, number>();
  let nextDepth = 1;
  return {
    getOrAssignDepth(sceneIdx: number, layerIdx: number, objId: string): number {
      const key = `${sceneIdx}:${layerIdx}:${objId}`;
      let depth = layerObjDepth.get(key);
      if (depth === undefined) {
        depth = nextDepth++;
        layerObjDepth.set(key, depth);
      }
      return depth;
    },
  };
}

/**
 * Depth pre-pass: seed the allocator so that the layer at the TOP of the panel
 * (li=0) renders ON TOP in the SWF (highest depth) and the BOTTOM layer (li=n-1)
 * renders at the back (lowest depth). Flash convention: layers[0] is topmost.
 *
 * Special-case mask groups: the mask must have a LOWER depth than the masked
 * layers it clips (SWF: mask at depth D clips depths D+1..clipDepth). So within
 * each mask group the mask is assigned first (lower depth) then its masked
 * layers (higher depths), even though the mask sits visually above them.
 */
export function runDepthPrepass(alloc: DepthAllocator, doc: FlashDocument): void {
  for (let preSceneIdx = 0; preSceneIdx < doc.scenes.length; preSceneIdx++) {
    const preLayers = doc.scenes[preSceneIdx]!.timeline.layers;

    // Identify which layer indices are "masked" (belong to a mask group) so they
    // can be deferred and processed immediately after their owning mask layer.
    const isMaskedLi = new Set<number>();
    for (let li = 0; li < preLayers.length; li++) {
      if (preLayers[li]!.type === "mask") {
        for (let mli = li + 1; mli < preLayers.length; mli++) {
          if (preLayers[mli]!.type !== "masked") break;
          isMaskedLi.add(mli);
        }
      }
    }

    // Register all object IDs for a layer across every keyframe it has.
    // Groups are flattened so each child gets its own depth entry.
    const registerLayerDepths = (li: number) => {
      for (const frame of preLayers[li]!.frames) {
        if (!frame.isKeyframe) continue;
        for (const obj of flattenDisplayObjects(frame.displayObjects)) {
          alloc.getOrAssignDepth(preSceneIdx, li, obj.id);
        }
      }
    };

    // Iterate from bottom layer (li=n-1) to top (li=0) so bottom layers get lower
    // depth numbers (rendered first / behind) and top layers get higher numbers
    // (rendered last / in front).
    for (let li = preLayers.length - 1; li >= 0; li--) {
      const layer = preLayers[li]!;
      if (layer.type === "guide") continue;
      if (layer.type === "folder") continue;
      if (isMaskedLi.has(li)) continue; // handled when its owning mask is encountered

      registerLayerDepths(li);

      // Immediately follow a mask with its masked layers so the mask's depth is
      // lower than all of the depths assigned to the masked layers.
      if (layer.type === "mask") {
        for (let mli = li + 1; mli < preLayers.length; mli++) {
          if (preLayers[mli]!.type !== "masked") break;
          registerLayerDepths(mli);
        }
      }
    }
  }
}
