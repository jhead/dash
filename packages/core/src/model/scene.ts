import type { Scene } from "./types.js";
import { createTimeline } from "./timeline.js";

let _sceneIdCounter = 0;

function nextId(): string {
  return `scene-${++_sceneIdCounter}-${Date.now().toString(36)}`;
}

/**
 * Create a new Scene with an empty timeline.
 * The timeline starts with one normal layer and one blank keyframe at frame 0.
 */
export function createScene(name: string, overrides?: Partial<Scene>): Scene {
  return {
    id: nextId(),
    name,
    timeline: createTimeline(),
    ...overrides,
  };
}
