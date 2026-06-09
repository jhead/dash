import { zipSync, strToU8 } from "fflate";
import { createDocument } from "../../model/document.js";
import { saveFla, loadFla } from "../zip.js";
import { serializeDocument } from "../serialize.js";
import type { ClipAction, SymbolInstance, FlashDocument } from "../../engine/types.js";

describe("FLA round-trip", () => {
  it("serializes and deserializes a default document with lossless round-trip", () => {
    const original = createDocument();

    const bytes = saveFla(original);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const restored = loadFla(bytes);

    // Document identity fields
    expect(restored.id).toBe(original.id);

    // Document properties
    expect(restored.properties.width).toBe(original.properties.width);
    expect(restored.properties.height).toBe(original.properties.height);
    expect(restored.properties.frameRate).toBe(original.properties.frameRate);
    expect(restored.properties.backgroundColor).toBe(
      original.properties.backgroundColor
    );

    // Scenes
    expect(restored.scenes).toHaveLength(original.scenes.length);
    expect(restored.scenes[0]?.name).toBe(original.scenes[0]?.name);

    // Layers
    const originalLayer = original.scenes[0]?.timeline.layers[0];
    const restoredLayer = restored.scenes[0]?.timeline.layers[0];
    expect(restoredLayer?.name).toBe(originalLayer?.name);
    expect(restoredLayer?.type).toBe(originalLayer?.type);

    // Library
    expect(restored.library.items).toHaveLength(original.library.items.length);
  });

  it("produces a zip archive (starts with PK signature)", () => {
    const doc = createDocument();
    const bytes = saveFla(doc);
    // ZIP local file header magic: 0x50 0x4B 0x03 0x04
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it("throws a descriptive error when bytes are not a valid zip", () => {
    const garbage = new Uint8Array([1, 2, 3, 4]);
    expect(() => loadFla(garbage)).toThrow(/FLA open error/);
  });

  it("preserves a JPEG bitmap asset (image/jpeg) with correct MIME on round-trip", () => {
    // Minimal 1×1 JPEG as a data URI (header bytes only — enough for base64 round-trip)
    const jpegDataUri = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

    const doc = createDocument();
    const docWithBitmap = {
      ...doc,
      library: {
        ...doc.library,
        items: [
          ...doc.library.items,
          {
            id: "bmp-jpeg-1",
            name: "photo.jpg",
            itemType: "bitmap" as const,
            dataUri: jpegDataUri,
            originalWidth: 1,
            originalHeight: 1,
            allowSmoothing: false,
            compressionType: "photo" as const,
            quality: 80,
          },
        ],
      },
    };

    const restored = loadFla(saveFla(docWithBitmap));
    const restoredItem = restored.library.items.find(i => i.id === "bmp-jpeg-1");
    expect(restoredItem).toBeDefined();
    expect(restoredItem?.dataUri).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("preserves a GIF bitmap asset (image/gif) with correct MIME on round-trip", () => {
    const gifDataUri = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

    const doc = createDocument();
    const docWithBitmap = {
      ...doc,
      library: {
        ...doc.library,
        items: [
          ...doc.library.items,
          {
            id: "bmp-gif-1",
            name: "anim.gif",
            itemType: "bitmap" as const,
            dataUri: gifDataUri,
            originalWidth: 1,
            originalHeight: 1,
            allowSmoothing: false,
            compressionType: "lossless" as const,
            quality: 100,
          },
        ],
      },
    };

    const restored = loadFla(saveFla(docWithBitmap));
    const restoredItem = restored.library.items.find(i => i.id === "bmp-gif-1");
    expect(restoredItem).toBeDefined();
    expect(restoredItem?.dataUri).toMatch(/^data:image\/gif;base64,/);
  });

  it("preserves a WAV sound asset (audio/wav) with correct MIME on round-trip", () => {
    const wavDataUri = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAA==";

    const doc = createDocument();
    const docWithSound = {
      ...doc,
      library: {
        ...doc.library,
        items: [
          ...doc.library.items,
          {
            id: "snd-wav-1",
            name: "effect.wav",
            itemType: "sound" as const,
            dataUri: wavDataUri,
            sampleRate: 44100,
            sampleSize: 16 as const,
            isStereo: false,
            durationSeconds: 0.1,
            compressionType: "raw" as const,
          },
        ],
      },
    };

    const restored = loadFla(saveFla(docWithSound));
    const restoredItem = restored.library.items.find(i => i.id === "snd-wav-1");
    expect(restoredItem).toBeDefined();
    expect(restoredItem?.dataUri).toMatch(/^data:audio\/wav;base64,/);
  });

  it("preserves a PNG bitmap asset (image/png) with correct MIME on round-trip", () => {
    // 1×1 transparent PNG base64
    const pngDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const doc = createDocument();
    const docWithBitmap = {
      ...doc,
      library: {
        ...doc.library,
        items: [
          ...doc.library.items,
          {
            id: "bmp-png-1",
            name: "sprite.png",
            itemType: "bitmap" as const,
            dataUri: pngDataUri,
            originalWidth: 1,
            originalHeight: 1,
            allowSmoothing: true,
            compressionType: "lossless" as const,
            quality: 100,
          },
        ],
      },
    };

    const restored = loadFla(saveFla(docWithBitmap));
    const restoredItem = restored.library.items.find(i => i.id === "bmp-png-1");
    expect(restoredItem).toBeDefined();
    expect(restoredItem?.dataUri).toMatch(/^data:image\/png;base64,/);
  });

  it("throws a descriptive error when a referenced asset entry is missing", () => {
    // Build a document with a bitmap item whose dataUri references an asset
    const doc = createDocument();
    const docWithAssetRef = {
      ...doc,
      library: {
        ...doc.library,
        items: [
          ...doc.library.items,
          {
            id: "bmp-missing-1",
            name: "ghost.png",
            itemType: "bitmap" as const,
            // Already an asset: reference — simulates a corrupted/partial archive
            dataUri: "asset:bitmaps/bmp-missing-1.png",
            originalWidth: 10,
            originalHeight: 10,
            allowSmoothing: false,
            compressionType: "lossless" as const,
            quality: 100,
          },
        ],
      },
    };

    // Build the zip manually without including the asset entry
    const json = serializeDocument(docWithAssetRef as Parameters<typeof serializeDocument>[0]);
    const flaBytes = zipSync({ "document.json": strToU8(json) });

    expect(() => loadFla(flaBytes)).toThrow(
      /FLA open error: missing asset entry "assets\/bitmaps\/bmp-missing-1\.png"/
    );
  });

  it("preserves clipActions on a SymbolInstance through FLA round-trip", () => {
    const doc = createDocument();

    // Build a minimal doc with a movieclip symbol and an instance with clipActions
    const clipActions: ClipAction[] = [
      { event: "load", script: "trace('loaded');" },
      { event: "enterFrame", script: "this._x += 5;" },
    ];

    const sym = {
      id: "sym-clip-1",
      name: "MyClip",
      itemType: "symbol" as const,
      symbolType: "movieclip" as const,
      timeline: {
        layers: [{
          id: "lyr-1", name: "Layer 1", type: "normal" as const,
          visible: true, locked: false, outlineMode: false,
          outlineColor: "#ff0000", height: 20, parentFolderId: null,
          frames: [{
            index: 0, isKeyframe: true, isEmpty: true, tweenType: "none" as const,
            label: "", labelType: "name" as const, script: "", sound: null,
            motionEase: 0, motionRotate: "none" as const, motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: "distributive" as const, displayObjects: [],
          }],
          frameCount: 1,
        }],
      },
      linkage: {
        exportForActionScript: false, exportInFirstFrame: false,
        linkageIdentifier: "", className: "",
        exportForRuntimeSharing: false, importForRuntimeSharing: false, sharedUrl: "",
      },
      scale9Grid: null,
    };

    const inst: SymbolInstance = {
      id: "inst-clip-1", type: "instance", symbolId: "sym-clip-1",
      x: 100, y: 50, instanceName: "myMC", clipActions,
    };

    const frame = {
      index: 0, isKeyframe: true, isEmpty: false, tweenType: "none" as const,
      label: "", labelType: "name" as const, script: "", sound: null,
      motionEase: 0, motionRotate: "none" as const, motionRotateCount: 0,
      motionOrientToPath: false, motionSync: false, motionScale: false,
      shapeEase: 0, shapeBlend: "distributive" as const, displayObjects: [inst],
    };

    const docWithClipActions: FlashDocument = {
      ...doc,
      library: { ...doc.library, items: [...doc.library.items, sym] },
      scenes: [{
        ...doc.scenes[0]!,
        timeline: {
          layers: [{
            ...doc.scenes[0]!.timeline.layers[0]!,
            frames: [frame],
            frameCount: 1,
          }],
        },
      }],
    };

    const restored = loadFla(saveFla(docWithClipActions));

    // Find the restored instance
    const restoredFrame = restored.scenes[0]?.timeline.layers[0]?.frames[0];
    expect(restoredFrame).toBeDefined();

    const restoredInst = restoredFrame!.displayObjects.find(
      (o) => o.id === "inst-clip-1"
    ) as SymbolInstance | undefined;
    expect(restoredInst).toBeDefined();
    expect(restoredInst!.clipActions).toHaveLength(2);
    expect(restoredInst!.clipActions![0]!.event).toBe("load");
    expect(restoredInst!.clipActions![0]!.script).toBe("trace('loaded');");
    expect(restoredInst!.clipActions![1]!.event).toBe("enterFrame");
    expect(restoredInst!.clipActions![1]!.script).toBe("this._x += 5;");
    expect(restoredInst!.instanceName).toBe("myMC");
  });

  it("preserves custom document properties on round-trip", () => {
    const doc = createDocument({
      properties: {
        width: 800,
        height: 600,
        frameRate: 24,
        backgroundColor: "#336699",
        rulerUnits: "inches",
        grid: {
          showGrid: true,
          snapToGrid: true,
          gridColor: "#cccccc",
          gridWidth: 20,
          gridHeight: 20,
        },
        guides: [],
        snapToObjects: true,
        snapToPixels: false,
        snapToGuides: false,
      },
    });

    const restored = loadFla(saveFla(doc));

    expect(restored.properties.width).toBe(800);
    expect(restored.properties.height).toBe(600);
    expect(restored.properties.frameRate).toBe(24);
    expect(restored.properties.backgroundColor).toBe("#336699");
    expect(restored.properties.rulerUnits).toBe("inches");
    expect(restored.properties.grid.showGrid).toBe(true);
    expect(restored.properties.snapToObjects).toBe(true);
  });
});
