import type { DocumentProperties, FlashDocument, GridSettings } from "./types.js";
import { createScene } from "./scene.js";
import { createLibrary } from "./library.js";

let _docIdCounter = 0;

function nextId(): string {
  return `doc-${++_docIdCounter}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Default sub-objects
// ---------------------------------------------------------------------------

export function createGridSettings(
  overrides?: Partial<GridSettings>
): GridSettings {
  return {
    showGrid: false,
    snapToGrid: false,
    gridColor: "#999999",
    gridWidth: 18,
    gridHeight: 18,
    ...overrides,
  };
}

export function createDocumentProperties(
  overrides?: Partial<DocumentProperties>
): DocumentProperties {
  return {
    width: 550,
    height: 400,
    frameRate: 12,
    backgroundColor: "#ffffff",
    rulerUnits: "px",
    grid: createGridSettings(),
    guides: [],
    // Flash 8 ships with the Selection tool's magnet (Snap to Objects) ON by
    // default — see docs/04-toolbox.md. Round-trip tests set this explicitly,
    // so the default change does not affect FLA (de)serialization fidelity.
    snapToObjects: true,
    snapToPixels: false,
    snapToGuides: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Document factory
// ---------------------------------------------------------------------------

/**
 * Create a new Flash document with Flash 8 defaults:
 *   - Stage: 550 × 400 px
 *   - Frame rate: 12 fps
 *   - Background: #ffffff
 *   - One scene ("Scene 1") with one normal layer and one blank keyframe at frame 0
 *   - Empty library
 */
export function createDocument(
  overrides?: Partial<FlashDocument>
): FlashDocument {
  return {
    id: nextId(),
    properties: createDocumentProperties(),
    scenes: [createScene("Scene 1")],
    library: createLibrary(),
    ...overrides,
  };
}
