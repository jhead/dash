import { describe, it, expect } from "vitest";
import type { FlashDocument, Frame, Layer } from "../types.js";

function makeFrame(index: number, overrides: Partial<Frame> = {}): Frame {
  return {
    index, isKeyframe: index === 0, isEmpty: false, tweenType: "none",
    label: "", labelType: "name", script: "", sound: null,
    motionEase: 0, motionRotate: "none", motionRotateCount: 0,
    motionOrientToPath: false, motionSnap: false, motionSync: false, motionScale: true,
    shapeEase: 0, shapeBlend: "distributive", displayObjects: [],
    ...overrides,
  };
}

function makeLayer(id: string, name: string): Layer {
  return {
    id, name, type: "normal", visible: true, locked: false,
    outlineMode: false, outlineColor: "#000000", height: 20,
    parentFolderId: null, frameCount: 1, frames: [makeFrame(0)],
  };
}

function makeDoc(): FlashDocument {
  return {
    id: "snap-test",
    properties: {
      width: 550, height: 400, frameRate: 12, backgroundColor: "#ffffff",
      rulerUnits: "px",
      grid: { showGrid: false, snapToGrid: false, gridColor: "#999999", gridWidth: 18, gridHeight: 18 },
      guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
    },
    scenes: [{ id: "s1", name: "Scene 1", timeline: { layers: [makeLayer("l1", "Layer 1")] } }],
    library: { items: [], folders: [] },
  };
}

describe("FlashDocument snapshot/restore", () => {
  it("JSON.stringify does not throw", () => {
    const doc = makeDoc();
    expect(() => JSON.stringify(doc)).not.toThrow();
  });

  it("JSON round-trip produces identical id", () => {
    const doc = makeDoc();
    const restored = JSON.parse(JSON.stringify(doc)) as FlashDocument;
    expect(restored.id).toBe(doc.id);
  });

  it("JSON round-trip preserves properties", () => {
    const doc = makeDoc();
    const r = JSON.parse(JSON.stringify(doc)) as FlashDocument;
    expect(r.properties.width).toBe(550);
    expect(r.properties.frameRate).toBe(12);
    expect(r.properties.backgroundColor).toBe("#ffffff");
  });

  it("JSON round-trip preserves scene structure", () => {
    const doc = makeDoc();
    const r = JSON.parse(JSON.stringify(doc)) as FlashDocument;
    expect(r.scenes).toHaveLength(1);
    expect(r.scenes[0].name).toBe("Scene 1");
  });

  it("JSON round-trip preserves layer", () => {
    const doc = makeDoc();
    const r = JSON.parse(JSON.stringify(doc)) as FlashDocument;
    const layer = r.scenes[0].timeline.layers[0];
    expect(layer.id).toBe("l1");
    expect(layer.name).toBe("Layer 1");
    expect(layer.type).toBe("normal");
  });

  it("JSON round-trip preserves frame script", () => {
    const doc: FlashDocument = {
      ...makeDoc(),
      scenes: [{ id: "s1", name: "S1", timeline: { layers: [
        { ...makeLayer("l1", "L1"), frames: [makeFrame(0, { script: "stop();" })] }
      ] } }]
    };
    const r = JSON.parse(JSON.stringify(doc)) as FlashDocument;
    expect(r.scenes[0].timeline.layers[0].frames[0].script).toBe("stop();");
  });

  it("structuredClone produces identical doc", () => {
    const doc = makeDoc();
    const cloned = structuredClone(doc);
    expect(cloned).toEqual(doc);
  });

  it("structuredClone is deep copy (mutation doesn't affect original)", () => {
    const doc = makeDoc();
    const cloned = structuredClone(doc) as any;
    cloned.properties.width = 800;
    expect(doc.properties.width).toBe(550);
  });

  it("JSON size is reasonable (< 10KB for minimal doc)", () => {
    const doc = makeDoc();
    const json = JSON.stringify(doc);
    expect(json.length).toBeLessThan(10000);
  });

  it("doc with multiple frames round-trips", () => {
    const doc: FlashDocument = {
      ...makeDoc(),
      scenes: [{ id: "s1", name: "S1", timeline: { layers: [
        {
          ...makeLayer("l1", "L1"),
          frameCount: 3,
          frames: [makeFrame(0), makeFrame(1), makeFrame(2)],
        }
      ] } }]
    };
    const r = JSON.parse(JSON.stringify(doc)) as FlashDocument;
    expect(r.scenes[0].timeline.layers[0].frames).toHaveLength(3);
  });
});
