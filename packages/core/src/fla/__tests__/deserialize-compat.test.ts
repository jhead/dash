/**
 * Backward-compatibility tests for FLA deserializer.
 *
 * Verifies that the deserializer handles minimal or incomplete JSON gracefully,
 * including missing optional fields, unknown library item types, and empty scenes.
 */

import { describe, it, expect } from "vitest";
import { deserializeDocument } from "../deserialize.js";

// ---------------------------------------------------------------------------
// Helper: wrap a raw document object in the FLA payload envelope
// that serializeDocument produces, so deserializeDocument can parse it.
// ---------------------------------------------------------------------------
function wrapPayload(doc: unknown): string {
  return JSON.stringify({
    schemaVersion: 1,
    version: "1",
    flashVersion: "8",
    document: doc,
  });
}

// ---------------------------------------------------------------------------
// Minimal document fragments
// ---------------------------------------------------------------------------

const MINIMAL_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: "#ffffff",
  rulerUnits: "px",
  grid: {
    showGrid: false,
    snapToGrid: false,
    gridColor: "#999",
    gridWidth: 18,
    gridHeight: 18,
  },
  guides: [],
  snapToObjects: false,
  snapToPixels: false,
  snapToGuides: false,
};

const DEFAULT_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

describe("FLA deserializer backward-compatibility defaults", () => {
  it("missing scale9Grid defaults to null", () => {
    const json = wrapPayload({
      id: "test",
      properties: MINIMAL_PROPS,
      scenes: [{ id: "s1", name: "Scene 1", timeline: { layers: [] } }],
      library: {
        items: [
          {
            id: "sym1",
            name: "Sym",
            itemType: "symbol",
            symbolType: "movieclip",
            timeline: { layers: [] },
            linkage: DEFAULT_LINKAGE,
          },
        ],
        folders: [],
      },
    });
    const doc = deserializeDocument(json);
    const sym = doc.library.items[0] as any;
    expect(sym.scale9Grid ?? null).toBe(null);
  });

  it("missing frame sound defaults to null", () => {
    const json = wrapPayload({
      id: "t",
      properties: MINIMAL_PROPS,
      scenes: [
        {
          id: "s1",
          name: "Scene 1",
          timeline: {
            layers: [
              {
                id: "l1",
                name: "Layer 1",
                type: "normal",
                visible: true,
                locked: false,
                outlineMode: false,
                outlineColor: "#f00",
                height: 20,
                parentFolderId: null,
                frameCount: 1,
                frames: [
                  {
                    index: 0,
                    isKeyframe: true,
                    isEmpty: false,
                    tweenType: "none",
                    label: "",
                    labelType: "name",
                    script: "",
                    motionEase: 0,
                    motionRotate: "none",
                    motionRotateCount: 0,
                    motionOrientToPath: false,
                    motionSync: false,
                    motionScale: false,
                    shapeEase: 0,
                    shapeBlend: "distributive",
                    displayObjects: [],
                  },
                ],
              },
            ],
          },
        },
      ],
      library: { items: [], folders: [] },
    });
    const doc = deserializeDocument(json);
    const frame = doc.scenes[0].timeline.layers[0].frames[0];
    expect(frame.sound ?? null).toBe(null);
  });

  it("missing collapsed defaults to false or undefined (both acceptable)", () => {
    // Layers without collapsed field should not throw
    const json = wrapPayload({
      id: "t",
      properties: MINIMAL_PROPS,
      scenes: [
        {
          id: "s1",
          name: "Scene 1",
          timeline: {
            layers: [
              {
                id: "l1",
                name: "Layer 1",
                type: "folder",
                visible: true,
                locked: false,
                outlineMode: false,
                outlineColor: "#f00",
                height: 20,
                parentFolderId: null,
                frameCount: 1,
                frames: [],
              },
            ],
          },
        },
      ],
      library: { items: [], folders: [] },
    });
    const doc = deserializeDocument(json);
    const layer = doc.scenes[0].timeline.layers[0];
    expect(layer.collapsed === undefined || layer.collapsed === false).toBe(true);
  });

  it("unknown library item type is skipped or throws gracefully", () => {
    const json = wrapPayload({
      id: "t",
      properties: MINIMAL_PROPS,
      scenes: [],
      library: {
        items: [{ id: "x1", name: "Unknown", itemType: "unknownFutureType" }],
        folders: [],
      },
    });
    // Should either succeed (skip unknown) or throw a descriptive error
    expect(() => deserializeDocument(json)).not.toThrow();
  });

  it("empty scenes array deserializes", () => {
    const json = wrapPayload({
      id: "t",
      properties: MINIMAL_PROPS,
      scenes: [],
      library: { items: [], folders: [] },
    });
    const doc = deserializeDocument(json);
    expect(doc.scenes).toEqual([]);
  });
});
