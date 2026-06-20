// ---------------------------------------------------------------------------
// "Start from scene / frame" derivation for Live Preview (task 1308).
//
// Ruffle's bundled player API has no public "seek to frame N of scene M before
// the first tick" entry point, and the SWF format has no start-frame field. The
// reliable, compiler-reusing way to begin playback at an arbitrary scene/frame
// is the same trick Flash authors use: put a `gotoAndPlay`/`gotoAndStop` on the
// FIRST keyframe of the movie. We do that on a SHALLOW-CLONED document so the
// real editor document is never mutated, then hand the clone to the existing
// publish path (compileDocument) — the compiler is NOT duplicated or modified.
//
// We PREPEND the goto to scene 0 / layer 0's governing keyframe-1 script so any
// author script on that frame still runs after the seek.
// ---------------------------------------------------------------------------

import type { FlashDocument } from "@flash/core";
import { getGoverningKeyframe } from "@flash/core";

export interface StartAt {
  /** 0-based scene index to begin at. */
  sceneIndex: number;
  /** 1-based frame number within that scene to begin at. */
  frame: number;
  /** When true, hold on the target frame (gotoAndStop) instead of playing. */
  hold?: boolean;
}

/**
 * Build the AS2 seek statement. For the FIRST scene we can goto a frame number
 * directly; for a later scene we target it by name so playback jumps scenes.
 * Frame numbers are 1-based in AS2.
 */
export function buildStartScript(
  doc: FlashDocument,
  startAt: StartAt
): string | null {
  const sceneCount = doc.scenes.length;
  if (sceneCount === 0) return null;
  const sceneIdx = clampInt(startAt.sceneIndex, 0, sceneCount - 1);
  const scene = doc.scenes[sceneIdx];
  const maxFrame = sceneFrameCount(doc, sceneIdx);
  const frame = clampInt(startAt.frame, 1, Math.max(1, maxFrame));
  // No-op when we'd just start at scene 0 / frame 1 playing.
  if (sceneIdx === 0 && frame === 1 && !startAt.hold) return null;
  const verb = startAt.hold ? "gotoAndStop" : "gotoAndPlay";
  if (sceneIdx === 0) {
    return `${verb}(${frame});`;
  }
  // Target a later scene by name (Flash supports gotoAndPlay("Scene", frame)).
  const sceneName = (scene.name || `Scene ${sceneIdx + 1}`).replace(/"/g, '\\"');
  return `${verb}("${sceneName}", ${frame});`;
}

/** Count the number of frames in scene `sceneIdx` (the longest layer span). */
export function sceneFrameCount(doc: FlashDocument, sceneIdx: number): number {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return 1;
  let max = 1;
  for (const layer of scene.timeline.layers) {
    for (const f of layer.frames) {
      // Frame.index is 0-based; convert to a 1-based count.
      if (f.index + 1 > max) max = f.index + 1;
    }
  }
  return max;
}

/**
 * Return a SHALLOW-CLONED document whose scene-0 / layer-0 governing keyframe-1
 * script is prefixed with the start-seek statement. Returns the ORIGINAL doc
 * reference unchanged when no seek is needed (start = scene 0 / frame 1 / play)
 * or when there is no keyframe to attach to.
 */
export function applyStartAt(doc: FlashDocument, startAt: StartAt): FlashDocument {
  const script = buildStartScript(doc, startAt);
  if (script === null) return doc;
  // Attach to scene 0 (the movie's main timeline entry point) so the seek runs
  // on the very first tick regardless of which scene we want to land on.
  const scene0 = doc.scenes[0];
  if (!scene0) return doc;
  const layers = scene0.timeline.layers;
  if (layers.length === 0) return doc;
  const layer0 = layers[0];
  const kf = getGoverningKeyframe(layer0, 0);
  if (!kf) return doc;

  const newFrames = layer0.frames.map((f) =>
    f.index === kf.index
      ? { ...f, script: f.script ? `${script}\n${f.script}` : script }
      : f
  );
  const newLayer0 = { ...layer0, frames: newFrames };
  const newLayers = [newLayer0, ...layers.slice(1)];
  const newScene0 = { ...scene0, timeline: { ...scene0.timeline, layers: newLayers } };
  return { ...doc, scenes: [newScene0, ...doc.scenes.slice(1)] };
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  const i = Math.round(n);
  return Math.min(max, Math.max(min, i));
}
