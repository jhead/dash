import type { Timeline, Layer } from "./types.js";
import { createLayer } from "./timeline.js";

export function isGuidedLayer(layer: Layer): boolean {
  return layer.type === "guided";
}

export function isMaskedLayer(layer: Layer): boolean {
  return layer.type === "masked";
}

export interface LayerPairingIssue {
  layerId: string;
  message: string;
}

export function validateLayerPairing(timeline: Timeline): LayerPairingIssue[] {
  const issues: LayerPairingIssue[] = [];
  const layers = timeline.layers;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (layer.type === "guide") {
      // Guide layer should have at least one guided layer below it
      const hasGuided = layers.slice(i + 1).some(l => l.type === "guided");
      if (!hasGuided) {
        issues.push({ layerId: layer.id, message: "Guide layer has no guided layers below it" });
      }
    }
    if (layer.type === "mask") {
      const hasMasked = layers.slice(i + 1).some(l => l.type === "masked");
      if (!hasMasked) {
        issues.push({ layerId: layer.id, message: "Mask layer has no masked layers below it" });
      }
    }
  }
  return issues;
}

export function getGuideLayerFor(timeline: Timeline, guidedLayerId: string): Layer | undefined {
  const idx = timeline.layers.findIndex(l => l.id === guidedLayerId);
  if (idx < 0) return undefined;
  for (let i = idx - 1; i >= 0; i--) {
    if (timeline.layers[i].type === "guide") return timeline.layers[i];
  }
  return undefined;
}

export function getMaskLayerFor(timeline: Timeline, maskedLayerId: string): Layer | undefined {
  const idx = timeline.layers.findIndex(l => l.id === maskedLayerId);
  if (idx < 0) return undefined;
  for (let i = idx - 1; i >= 0; i--) {
    if (timeline.layers[i].type === "mask") return timeline.layers[i];
  }
  return undefined;
}

export function addGuideLayerAbove(timeline: Timeline, layerId: string): Timeline {
  const idx = timeline.layers.findIndex(l => l.id === layerId);
  if (idx < 0) return timeline;

  // Set target layer type to "guided"
  const targetLayer: Layer = { ...timeline.layers[idx]!, type: "guided" };

  // Insert guide layer above (before) the target
  const guideLayer: Layer = createLayer(`Guide: ${targetLayer.name}`, "guide", {
    outlineColor: "#00aa00",
    frameCount: targetLayer.frameCount,
    frames: [],
  });

  const layers = [...timeline.layers];
  layers[idx] = targetLayer;
  layers.splice(idx, 0, guideLayer);
  return { ...timeline, layers };
}

export function addMaskLayerAbove(timeline: Timeline, layerId: string): Timeline {
  const idx = timeline.layers.findIndex(l => l.id === layerId);
  if (idx < 0) return timeline;

  const targetLayer: Layer = { ...timeline.layers[idx]!, type: "masked" };

  const maskLayer: Layer = createLayer(`Mask: ${targetLayer.name}`, "mask", {
    outlineColor: "#aa0000",
    frameCount: targetLayer.frameCount,
    frames: [],
  });

  const layers = [...timeline.layers];
  layers[idx] = targetLayer;
  layers.splice(idx, 0, maskLayer);
  return { ...timeline, layers };
}
