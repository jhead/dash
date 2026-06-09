import type { FlashDocument } from '../model/types.js';
import type { DisplayObject } from './types.js';
import { CanvasRenderer } from './renderer.js';
import { getTweenedFrame } from '../model/timeline-query.js';

/**
 * Render a single frame of a FlashDocument to a PNG Blob using OffscreenCanvas.
 * Returns null if OffscreenCanvas is not available (e.g. Node.js without polyfill).
 *
 * @param doc         The Flash document to render.
 * @param sceneIndex  Zero-based index of the scene to render.
 * @param frameIndex  Zero-based frame index within the scene timeline.
 * @param width       Output width in pixels (defaults to doc.properties.width).
 * @param height      Output height in pixels (defaults to doc.properties.height).
 */
export async function snapshotFrame(
  doc: FlashDocument,
  sceneIndex: number,
  frameIndex: number,
  width?: number,
  height?: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;

  const scene = doc.scenes[sceneIndex];
  if (!scene) return null;

  const w = width ?? doc.properties.width;
  const h = height ?? doc.properties.height;

  // OffscreenCanvas is compatible with the Canvas 2D API but lacks .style;
  // we set width/height directly and avoid calling renderer.resize() which
  // would attempt to set canvas.style.width/height.
  const canvas = new OffscreenCanvas(w, h);
  const renderer = new CanvasRenderer(canvas as unknown as HTMLCanvasElement);

  // Build a SceneGraph from the timeline at the requested frame index.
  // Mirrors the pattern used in Shell.tsx fullSceneGraph useMemo.
  const layers = scene.timeline.layers.map((layer) => {
    const frame = getTweenedFrame(layer, frameIndex, scene.timeline);
    const objects: DisplayObject[] = frame ? [...frame.displayObjects] : [];
    return {
      id: layer.id,
      name: layer.name,
      type: layer.type,
      visible: layer.visible,
      locked: layer.locked,
      objects,
    };
  });

  const sceneGraph = { layers };
  const viewport = { x: 0, y: 0, zoom: 1 };

  renderer.render(sceneGraph, viewport, doc.library);

  return canvas.convertToBlob({ type: 'image/png' });
}
