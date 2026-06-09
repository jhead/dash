/**
 * Comprehensive FLA save/load round-trip tests.
 *
 * Each test builds a FlashDocument with specific fields set, serializes it via
 * saveFla(), deserializes via loadFla(), then asserts the loaded document
 * has the same values as the original.
 */

import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { createDocument, createDocumentProperties } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import {
  createLayer,
  createFrame,
  createTimeline,
  insertKeyframe,
  addDisplayObject,
} from "../../model/timeline.js";
import { addScene } from "../../model/document-mutations.js";
import { saveFla, loadFla } from "../zip.js";
import { serializeDocument } from "../serialize.js";
import type {
  FlashDocument,
  Scene,
  Layer,
  Frame,
  Symbol,
  BitmapItem,
  Library,
} from "../../model/types.js";
import type {
  ShapeDisplayObject,
  TextDisplayObject,
  SymbolInstance,
} from "../../engine/types.js";

// ---------------------------------------------------------------------------
// Helper: Build a minimal shape display object
// ---------------------------------------------------------------------------
function makeShape(id: string, x: number, y: number): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: {
      id: `shape-inner-${id}`,
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 100, y: 0 } },
            { type: "line", to: { x: 100, y: 50 } },
            { type: "line", to: { x: 0, y: 50 } },
          ],
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
          closed: true,
        },
      ],
    },
    x,
    y,
  };
}

// ---------------------------------------------------------------------------
// Helper: Build a text display object
// ---------------------------------------------------------------------------
function makeText(id: string): TextDisplayObject {
  return {
    type: "text",
    id,
    x: 10,
    y: 20,
    width: 200,
    height: 50,
    text: "Hello World",
    textType: "static",
    fontFamily: "Arial",
    fontSize: 24,
    bold: true,
    italic: false,
    color: { r: 0, g: 128, b: 255, a: 255 },
    align: "center",
    multiline: false,
    wordWrap: false,
  };
}

// ---------------------------------------------------------------------------
// 1. Document properties round-trip
// ---------------------------------------------------------------------------
describe("roundtrip: document properties", () => {
  it("width, height, frameRate, backgroundColor, and rulerUnits survive round-trip", () => {
    const doc = createDocument({
      properties: createDocumentProperties({
        width: 800,
        height: 600,
        frameRate: 30,
        backgroundColor: "#ff0000",
        rulerUnits: "inches",
      }),
    });

    const restored = loadFla(saveFla(doc));

    expect(restored.properties.width).toBe(800);
    expect(restored.properties.height).toBe(600);
    expect(restored.properties.frameRate).toBe(30);
    expect(restored.properties.backgroundColor).toBe("#ff0000");
    expect(restored.properties.rulerUnits).toBe("inches");
  });
});

// ---------------------------------------------------------------------------
// 2. Multiple scenes
// ---------------------------------------------------------------------------
describe("roundtrip: multiple scenes", () => {
  it("3 scenes with names Intro, Main, Outro are all present after load", () => {
    let doc = createDocument();
    // Replace the default scene and add two more
    const intro = createScene("Intro");
    const main = createScene("Main");
    const outro = createScene("Outro");
    doc = { ...doc, scenes: [intro, main, outro] };

    const restored = loadFla(saveFla(doc));

    expect(restored.scenes).toHaveLength(3);
    expect(restored.scenes[0]?.name).toBe("Intro");
    expect(restored.scenes[1]?.name).toBe("Main");
    expect(restored.scenes[2]?.name).toBe("Outro");
  });
});

// ---------------------------------------------------------------------------
// 3. Layer properties
// ---------------------------------------------------------------------------
describe("roundtrip: layer properties", () => {
  it("name, type, visible, locked, outlineColor survive round-trip", () => {
    const layer = createLayer("Effects", "guide", {
      visible: false,
      locked: true,
      outlineColor: "#00ff00",
    });

    const scene: Scene = {
      id: "sc-layer-test",
      name: "Scene 1",
      timeline: { layers: [layer] },
    };
    const doc: FlashDocument = {
      ...createDocument(),
      scenes: [scene],
    };

    const restored = loadFla(saveFla(doc));
    const restoredLayer = restored.scenes[0]?.timeline.layers[0];

    expect(restoredLayer?.name).toBe("Effects");
    expect(restoredLayer?.type).toBe("guide");
    expect(restoredLayer?.visible).toBe(false);
    expect(restoredLayer?.locked).toBe(true);
    expect(restoredLayer?.outlineColor).toBe("#00ff00");
  });
});

// ---------------------------------------------------------------------------
// 4. Keyframe display objects — ShapeDisplayObject
// ---------------------------------------------------------------------------
describe("roundtrip: shape display object", () => {
  it("rectangle shape at x=100, y=50 — x/y preserved after round-trip", () => {
    const shape = makeShape("shape-1", 100, 50);
    const frame = createFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      displayObjects: [shape],
    });

    const layer = createLayer("Shapes", "normal", { frames: [frame] });
    const scene: Scene = {
      id: "sc-shape-test",
      name: "Scene 1",
      timeline: { layers: [layer] },
    };
    const doc: FlashDocument = { ...createDocument(), scenes: [scene] };

    const restored = loadFla(saveFla(doc));
    const restoredFrame = restored.scenes[0]?.timeline.layers[0]?.frames[0];
    const restoredShape = restoredFrame?.displayObjects[0] as ShapeDisplayObject | undefined;

    expect(restoredShape?.type).toBe("shape");
    expect(restoredShape?.x).toBe(100);
    expect(restoredShape?.y).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 5. TextDisplayObject
// ---------------------------------------------------------------------------
describe("roundtrip: TextDisplayObject", () => {
  it("text, fontFamily, fontSize, bold, color, align survive round-trip", () => {
    const textObj = makeText("txt-1");
    const frame = createFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      displayObjects: [textObj],
    });
    const layer = createLayer("Text", "normal", { frames: [frame] });
    const scene: Scene = {
      id: "sc-text-test",
      name: "Scene 1",
      timeline: { layers: [layer] },
    };
    const doc: FlashDocument = { ...createDocument(), scenes: [scene] };

    const restored = loadFla(saveFla(doc));
    const restoredFrame = restored.scenes[0]?.timeline.layers[0]?.frames[0];
    const restoredText = restoredFrame?.displayObjects[0] as TextDisplayObject | undefined;

    expect(restoredText?.type).toBe("text");
    expect(restoredText?.text).toBe("Hello World");
    expect(restoredText?.fontFamily).toBe("Arial");
    expect(restoredText?.fontSize).toBe(24);
    expect(restoredText?.bold).toBe(true);
    expect(restoredText?.color).toEqual({ r: 0, g: 128, b: 255, a: 255 });
    expect(restoredText?.align).toBe("center");
  });
});

// ---------------------------------------------------------------------------
// 6. BitmapItem in library
// ---------------------------------------------------------------------------
describe("roundtrip: BitmapItem in library", () => {
  it("dataUri round-trips correctly (base64 encodes to zip entry, decodes back)", () => {
    // Minimal 1x1 PNG
    const pngDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const bitmapItem: BitmapItem = {
      id: "bmp-roundtrip-1",
      name: "sprite.png",
      itemType: "bitmap",
      dataUri: pngDataUri,
      originalWidth: 1,
      originalHeight: 1,
      allowSmoothing: true,
      compressionType: "lossless",
      quality: 100,
    };

    const doc = createDocument({
      library: {
        items: [bitmapItem],
        folders: [],
      },
    });

    const restored = loadFla(saveFla(doc));
    const restoredItem = restored.library.items.find(i => i.id === "bmp-roundtrip-1");

    expect(restoredItem).toBeDefined();
    expect(restoredItem?.itemType).toBe("bitmap");
    // The dataUri should be restored as a proper data URI (not an asset: reference)
    expect(restoredItem?.dataUri).toMatch(/^data:image\/png;base64,/);
    // Content should be identical after encode/decode
    expect(restoredItem?.dataUri).toBe(pngDataUri);
  });
});

// ---------------------------------------------------------------------------
// 7. Symbol in library with timeline
// ---------------------------------------------------------------------------
describe("roundtrip: Symbol in library", () => {
  it("symbol with timeline (1 layer, 2 keyframes, display object) survives round-trip", () => {
    const shape1 = makeShape("sym-shape-1", 0, 0);
    const shape2 = makeShape("sym-shape-2", 50, 50);
    const frame0 = createFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      displayObjects: [shape1],
    });
    const frame5 = createFrame(5, {
      isKeyframe: true,
      isEmpty: false,
      displayObjects: [shape2],
    });

    const symbolLayer = createLayer("Layer 1", "normal", {
      frames: [frame0, frame5],
      frameCount: 6,
    });

    const symbol: Symbol = {
      id: "sym-1",
      name: "MyMovieClip",
      itemType: "symbol",
      symbolType: "movieclip",
      timeline: { layers: [symbolLayer] },
      linkage: {
        exportForActionScript: false,
        exportInFirstFrame: false,
        linkageIdentifier: "",
        className: "",
        exportForRuntimeSharing: false,
        importForRuntimeSharing: false,
        sharedUrl: "",
      },
      scale9Grid: null,
    };

    const doc = createDocument({
      library: { items: [symbol], folders: [] },
    });

    const restored = loadFla(saveFla(doc));
    const restoredSymbol = restored.library.items.find(i => i.id === "sym-1") as Symbol | undefined;

    expect(restoredSymbol).toBeDefined();
    expect(restoredSymbol?.name).toBe("MyMovieClip");
    expect(restoredSymbol?.symbolType).toBe("movieclip");
    expect(restoredSymbol?.timeline.layers).toHaveLength(1);
    expect(restoredSymbol?.timeline.layers[0]?.frames).toHaveLength(2);
    const restoredFrame5 = restoredSymbol?.timeline.layers[0]?.frames.find(f => f.index === 5);
    expect(restoredFrame5?.isKeyframe).toBe(true);
    expect(restoredFrame5?.displayObjects[0]).toMatchObject({ type: "shape", x: 50, y: 50 });
  });
});

// ---------------------------------------------------------------------------
// 8. Motion tween settings
// ---------------------------------------------------------------------------
describe("roundtrip: motion tween settings", () => {
  it("motionEase, motionRotate, motionRotateCount survive on keyframe", () => {
    const frame = createFrame(0, {
      isKeyframe: true,
      isEmpty: true,
      tweenType: "motion",
      motionEase: 50,
      motionRotate: "cw",
      motionRotateCount: 2,
    });

    const layer = createLayer("Tween Layer", "normal", { frames: [frame] });
    const scene: Scene = {
      id: "sc-tween-test",
      name: "Scene 1",
      timeline: { layers: [layer] },
    };
    const doc: FlashDocument = { ...createDocument(), scenes: [scene] };

    const restored = loadFla(saveFla(doc));
    const restoredFrame = restored.scenes[0]?.timeline.layers[0]?.frames[0];

    expect(restoredFrame?.tweenType).toBe("motion");
    expect(restoredFrame?.motionEase).toBe(50);
    expect(restoredFrame?.motionRotate).toBe("cw");
    expect(restoredFrame?.motionRotateCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 9. SymbolInstance
// ---------------------------------------------------------------------------
describe("roundtrip: SymbolInstance", () => {
  it("scaleX, rotation, alpha, instanceName survive round-trip", () => {
    const instance: SymbolInstance = {
      type: "instance",
      id: "inst-1",
      symbolId: "sym-placeholder",
      x: 200,
      y: 150,
      scaleX: 2.0,
      scaleY: 1.5,
      rotation: 45,
      alpha: 0.5,
      instanceName: "myClip",
    };

    const frame = createFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      displayObjects: [instance],
    });
    const layer = createLayer("Instances", "normal", { frames: [frame] });
    const scene: Scene = {
      id: "sc-inst-test",
      name: "Scene 1",
      timeline: { layers: [layer] },
    };
    const doc: FlashDocument = { ...createDocument(), scenes: [scene] };

    const restored = loadFla(saveFla(doc));
    const restoredFrame = restored.scenes[0]?.timeline.layers[0]?.frames[0];
    const restoredInst = restoredFrame?.displayObjects[0] as SymbolInstance | undefined;

    expect(restoredInst?.type).toBe("instance");
    expect(restoredInst?.x).toBe(200);
    expect(restoredInst?.y).toBe(150);
    expect(restoredInst?.scaleX).toBe(2.0);
    expect(restoredInst?.rotation).toBe(45);
    expect(restoredInst?.alpha).toBe(0.5);
    expect(restoredInst?.instanceName).toBe("myClip");
  });
});

// ---------------------------------------------------------------------------
// 10. Grid and guides
// ---------------------------------------------------------------------------
describe("roundtrip: grid and guides", () => {
  it("showGrid, gridWidth, and a horizontal guide at y=100 survive round-trip", () => {
    const doc = createDocument({
      properties: createDocumentProperties({
        grid: {
          showGrid: true,
          snapToGrid: false,
          gridColor: "#cccccc",
          gridWidth: 20,
          gridHeight: 18,
        },
        guides: [
          { id: "guide-1", orientation: "horizontal", position: 100 },
        ],
      }),
    });

    const restored = loadFla(saveFla(doc));

    expect(restored.properties.grid.showGrid).toBe(true);
    expect(restored.properties.grid.gridWidth).toBe(20);
    expect(restored.properties.guides).toHaveLength(1);
    expect(restored.properties.guides[0]?.orientation).toBe("horizontal");
    expect(restored.properties.guides[0]?.position).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 11. Corrupt zip
// ---------------------------------------------------------------------------
describe("roundtrip: corrupt zip", () => {
  it("loadFla(new Uint8Array([1,2,3])) throws with message containing 'FLA open error'", () => {
    expect(() => loadFla(new Uint8Array([1, 2, 3]))).toThrow(/FLA open error/);
  });
});

// ---------------------------------------------------------------------------
// 12. Missing asset
// ---------------------------------------------------------------------------
describe("roundtrip: missing asset", () => {
  it("zip with broken asset reference throws with message containing 'missing asset entry'", () => {
    const doc = createDocument({
      library: {
        items: [
          {
            id: "bmp-ghost",
            name: "ghost.png",
            itemType: "bitmap",
            // Already an asset: reference — simulates a corrupted archive
            dataUri: "asset:bitmaps/bmp-ghost.png",
            originalWidth: 10,
            originalHeight: 10,
            allowSmoothing: false,
            compressionType: "lossless",
            quality: 100,
          } as BitmapItem,
        ],
        folders: [],
      },
    });

    // Build the zip manually without including the asset entry
    const json = serializeDocument(doc);
    const flaBytes = zipSync({ "document.json": strToU8(json) });

    expect(() => loadFla(flaBytes)).toThrow(/missing asset entry/);
  });
});

// ---------------------------------------------------------------------------
// 14. Frame scripts
// ---------------------------------------------------------------------------
describe("roundtrip: frame scripts", () => {
  it("frame.script string survives round-trip", () => {
    const script = "stop();\ntrace(\"frame 1\");";
    const frame = createFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      script,
    });

    const layer = createLayer("Actions", "normal", { frames: [frame] });
    const scene: Scene = {
      id: "sc-script-test",
      name: "Scene 1",
      timeline: { layers: [layer] },
    };
    const doc: FlashDocument = { ...createDocument(), scenes: [scene] };

    const restored = loadFla(saveFla(doc));
    const restoredFrame = restored.scenes[0]?.timeline.layers[0]?.frames[0];

    expect(restoredFrame?.script).toBe(script);
  });
});

// ---------------------------------------------------------------------------
// 15. Immutability
// ---------------------------------------------------------------------------
describe("roundtrip: immutability", () => {
  it("saveFla does not mutate the input document", () => {
    const doc = createDocument({
      properties: createDocumentProperties({
        width: 640,
        height: 480,
        frameRate: 24,
        backgroundColor: "#112233",
      }),
    });

    // Capture a snapshot of some properties before
    const originalId = doc.id;
    const originalWidth = doc.properties.width;
    const originalSceneCount = doc.scenes.length;
    const originalLibraryCount = doc.library.items.length;

    saveFla(doc);

    // Verify the document is unchanged after serialization
    expect(doc.id).toBe(originalId);
    expect(doc.properties.width).toBe(originalWidth);
    expect(doc.scenes).toHaveLength(originalSceneCount);
    expect(doc.library.items).toHaveLength(originalLibraryCount);
  });
});

// ---------------------------------------------------------------------------
// 13. Large document performance
// ---------------------------------------------------------------------------
describe("roundtrip: large document", () => {
  it("50 layers x 100 frames round-trips in under 1000ms", () => {
    // Build a document with 50 layers, each having 100 frames (keyframes at 0 and 99)
    const layers: Layer[] = [];
    for (let i = 0; i < 50; i++) {
      const frame0 = createFrame(0, {
        isKeyframe: true,
        isEmpty: false,
        displayObjects: [makeShape(`shape-${i}-0`, i * 2, i * 2)],
      });
      const frame99 = createFrame(99, {
        isKeyframe: true,
        isEmpty: false,
        displayObjects: [makeShape(`shape-${i}-99`, i * 2 + 50, i * 2 + 50)],
      });
      layers.push(
        createLayer(`Layer ${i + 1}`, "normal", {
          frames: [frame0, frame99],
          frameCount: 100,
        })
      );
    }

    const scene: Scene = {
      id: "sc-large",
      name: "Scene 1",
      timeline: { layers },
    };
    const doc: FlashDocument = { ...createDocument(), scenes: [scene] };

    const start = Date.now();
    const bytes = saveFla(doc);
    const restored = loadFla(bytes);
    const elapsed = Date.now() - start;

    // Verify correctness
    expect(restored.scenes[0]?.timeline.layers).toHaveLength(50);
    expect(restored.scenes[0]?.timeline.layers[0]?.frames).toHaveLength(2);
    expect(restored.scenes[0]?.timeline.layers[49]?.name).toBe("Layer 50");

    // Verify performance
    expect(elapsed).toBeLessThan(1000);
  });
});
