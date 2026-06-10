/**
 * Unit tests for the expanded JSFL runtime (task 0616).
 *
 * Covers:
 *  - timeline.insertFrames / removeFrames / insertKeyframe / insertBlankKeyframe
 *  - timeline.convertToKeyframes / convertToBlankKeyframes
 *  - timeline.createMotionTween / setFrameProperty
 *  - timeline.layers[] — addNewLayer / deleteLayer / setSelectedLayers
 *  - layer properties — name / visible / locked / layerType
 *  - frame properties — actionScript / labelName / tweenType / elements
 *  - document property setters — width / height / frameRate / backgroundColor
 *  - doc.setSelectionRect / doc.deleteSelection
 *  - doc.convertToSymbol
 *  - doc.library — items / addNewItem / deleteItem / renameItem
 */

import { describe, it, expect } from "vitest";
import { createDocument } from "@flash/core";
import { runJsfl, buildJsflContext } from "../runtime.js";
import type { JsflContext } from "../runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Parameters<typeof createDocument>[0]): JsflContext {
  return buildJsflContext(createDocument(overrides), 0, 0);
}

// ---------------------------------------------------------------------------
// Document property setters
// ---------------------------------------------------------------------------

describe("document property setters", () => {
  it("can set doc.width", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM(); doc.width = 800; fl.trace(doc.width);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["800"]);
    expect(result.finalDocument!.properties.width).toBe(800);
  });

  it("can set doc.height", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM(); doc.height = 600; fl.trace(doc.height);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["600"]);
    expect(result.finalDocument!.properties.height).toBe(600);
  });

  it("can set doc.frameRate", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM(); doc.frameRate = 24; fl.trace(doc.frameRate);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["24"]);
    expect(result.finalDocument!.properties.frameRate).toBe(24);
  });

  it("can set doc.backgroundColor", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM(); doc.backgroundColor = "#ff0000"; fl.trace(doc.backgroundColor);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["#ff0000"]);
    expect(result.finalDocument!.properties.backgroundColor).toBe("#ff0000");
  });
});

// ---------------------------------------------------------------------------
// Timeline layer access
// ---------------------------------------------------------------------------

describe("timeline.layers[]", () => {
  it("exposes layers array", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       fl.trace(tl.layers.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["1"]);
  });

  it("layer.name reads the layer name", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       fl.trace(tl.layers[0].name);`,
      ctx
    );
    expect(result.traces).toEqual(["Layer 1"]);
  });

  it("can set layer.name", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.layers[0].name = "Actions";
       fl.trace(tl.layers[0].name);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["Actions"]);
    expect(
      result.finalDocument!.scenes[0].timeline.layers[0].name
    ).toBe("Actions");
  });

  it("can set layer.visible = false", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.layers[0].visible = false;
       fl.trace(tl.layers[0].visible);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["false"]);
    expect(
      result.finalDocument!.scenes[0].timeline.layers[0].visible
    ).toBe(false);
  });

  it("can set layer.locked = true", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.layers[0].locked = true;
       fl.trace(tl.layers[0].locked);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["true"]);
    expect(
      result.finalDocument!.scenes[0].timeline.layers[0].locked
    ).toBe(true);
  });

  it("can set layer.layerType", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.layers[0].layerType = "guide";
       fl.trace(tl.layers[0].layerType);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["guide"]);
    expect(
      result.finalDocument!.scenes[0].timeline.layers[0].type
    ).toBe("guide");
  });
});

// ---------------------------------------------------------------------------
// addNewLayer / deleteLayer / setSelectedLayers
// ---------------------------------------------------------------------------

describe("timeline.addNewLayer / deleteLayer / setSelectedLayers", () => {
  it("addNewLayer adds a layer and returns updated count", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.addNewLayer("Layer 2");
       fl.trace(tl.layers.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["2"]);
    expect(
      result.finalDocument!.scenes[0].timeline.layers.length
    ).toBe(2);
  });

  it("deleteLayer removes a layer by index", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.addNewLayer("Layer 2");
       tl.deleteLayer(1);
       fl.trace(tl.layers.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["1"]);
  });

  it("setSelectedLayers updates currentLayer", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.addNewLayer("Layer 2");
       tl.setSelectedLayers(1);
       fl.trace(tl.currentLayer);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["1"]);
  });

  it("addNewLayer with type 'guide' sets layerType to guide", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.addNewLayer("Guide 1", "guide");
       fl.trace(tl.layers[0].layerType);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["guide"]);
    expect(result.finalDocument!.scenes[0].timeline.layers[0].type).toBe("guide");
  });

  it("addNewLayer with type 'mask' sets layerType to mask", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.addNewLayer("Mask 1", "mask");
       fl.trace(tl.layers[0].layerType);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["mask"]);
    expect(result.finalDocument!.scenes[0].timeline.layers[0].type).toBe("mask");
  });

  it("addNewLayer with addAbove=true inserts above selected layer", () => {
    const ctx = makeCtx();
    // Start with Layer 1 (index 0). Select it (already selected). Add above → new layer at 0.
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.addNewLayer("A", "normal", true);
       fl.trace(tl.layers[0].name);
       fl.trace(tl.layers[1].name);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    // currentLayer=0 before add; addAbove=true → new layer goes to index 0
    expect(result.traces).toEqual(["A", "Layer 1"]);
  });

  it("addNewLayer with addAbove=false inserts below selected layer", () => {
    const ctx = makeCtx();
    // Layer 1 is at index 0 (selected). addAbove=false → new layer goes below it at index 1.
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.addNewLayer("B", "normal", false);
       fl.trace(tl.layers[0].name);
       fl.trace(tl.layers[1].name);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["Layer 1", "B"]);
  });

  it("addNewLayer respects addAbove when selected layer is not topmost", () => {
    const ctx = makeCtx();
    // Add two extra layers first, then select layer at index 1, add above → new at 1.
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.addNewLayer("Layer 2");
       tl.addNewLayer("Layer 3");
       // layers: [Layer 3, Layer 2, Layer 1]
       tl.setSelectedLayers(1);
       tl.addNewLayer("Above2", "normal", true);
       fl.trace(tl.layers[1].name);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["Above2"]);
  });
});

// ---------------------------------------------------------------------------
// insertFrames / removeFrames
// ---------------------------------------------------------------------------

describe("timeline.insertFrames / removeFrames", () => {
  it("insertFrames increases frameCount", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       fl.trace(tl.frameCount);
       tl.insertFrames(4);
       fl.trace(tl.frameCount);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces[0]).toBe("1");
    expect(Number(result.traces[1])).toBeGreaterThanOrEqual(4);
  });

  it("removeFrames decreases frameCount", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.insertFrames(5);
       var before = tl.frameCount;
       tl.removeFrames(2);
       fl.trace(tl.frameCount < before ? "yes" : "no");`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["yes"]);
  });
});

// ---------------------------------------------------------------------------
// insertKeyframe / insertBlankKeyframe
// ---------------------------------------------------------------------------

describe("timeline.insertKeyframe / insertBlankKeyframe", () => {
  it("insertKeyframe adds a keyframe", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.insertKeyframe(3);
       var layer = tl.layers[0];
       fl.trace(layer.frameCount >= 4 ? "ok" : "fail");`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["ok"]);
  });

  it("insertBlankKeyframe adds an empty keyframe", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.insertBlankKeyframe(5);
       var layer = tl.layers[0];
       fl.trace(layer.frameCount >= 6 ? "ok" : "fail");`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["ok"]);
  });

  it("convertToKeyframes is an alias for insertKeyframe", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.convertToKeyframes(2);
       var layer = tl.layers[0];
       fl.trace(layer.frameCount >= 3 ? "ok" : "fail");`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["ok"]);
  });

  it("convertToBlankKeyframes is an alias for insertBlankKeyframe", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.convertToBlankKeyframes(4);
       var layer = tl.layers[0];
       fl.trace(layer.frameCount >= 5 ? "ok" : "fail");`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["ok"]);
  });
});

// ---------------------------------------------------------------------------
// createMotionTween / setFrameProperty
// ---------------------------------------------------------------------------

describe("timeline.createMotionTween / setFrameProperty", () => {
  it("createMotionTween sets tween on current frame", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.createMotionTween(0);
       var frame = tl.layers[0].frames[0];
       fl.trace(frame.tweenType);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["motion"]);
  });

  it("setFrameProperty tweenType=motion sets motion tween", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.setFrameProperty("tweenType", "motion", 0);
       fl.trace(tl.layers[0].frames[0].tweenType);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["motion"]);
  });

  it("setFrameProperty tweenType=shape sets shape tween", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.setFrameProperty("tweenType", "shape", 0);
       fl.trace(tl.layers[0].frames[0].tweenType);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["shape"]);
  });

  it("setFrameProperty label sets frame label", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.setFrameProperty("label", "start", 0);
       fl.trace(tl.layers[0].frames[0].labelName);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["start"]);
  });

  it("setFrameProperty actionScript sets script on frame", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.setFrameProperty("actionScript", "stop();", 0);
       fl.trace(tl.layers[0].frames[0].actionScript);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["stop();"]);
  });
});

// ---------------------------------------------------------------------------
// Frame access — actionScript / labelName / tweenType / elements
// ---------------------------------------------------------------------------

describe("frame.actionScript", () => {
  it("can get actionScript (empty by default)", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       fl.trace(tl.layers[0].frames[0].actionScript);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual([""]);
  });

  it("can set actionScript on a keyframe", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.layers[0].frames[0].actionScript = "stop();";
       fl.trace(tl.layers[0].frames[0].actionScript);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["stop();"]);
    const scene = result.finalDocument!.scenes[0];
    const kf = scene.timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    );
    expect(kf?.script).toBe("stop();");
  });
});

describe("frame.labelName", () => {
  it("can get labelName (empty by default)", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       fl.trace(tl.layers[0].frames[0].labelName);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual([""]);
  });

  it("can set labelName", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       tl.layers[0].frames[0].labelName = "intro";
       fl.trace(tl.layers[0].frames[0].labelName);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["intro"]);
    const scene = result.finalDocument!.scenes[0];
    const kf = scene.timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    );
    expect(kf?.label).toBe("intro");
  });
});

describe("frame.tweenType", () => {
  it("is 'none' by default", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       fl.trace(tl.layers[0].frames[0].tweenType);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["none"]);
  });
});

describe("frame.elements", () => {
  it("is empty by default", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       fl.trace(tl.layers[0].frames[0].elements.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["0"]);
  });

  it("contains objects after addNewRectangle", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:0,top:0,right:50,bottom:50},0);
       var tl = doc.getTimeline();
       fl.trace(tl.layers[0].frames[0].elements.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["1"]);
  });
});

// ---------------------------------------------------------------------------
// doc.setSelectionRect / doc.deleteSelection
// ---------------------------------------------------------------------------

describe("doc.setSelectionRect / deleteSelection", () => {
  it("setSelectionRect selects objects within the rect", () => {
    const ctx = makeCtx();
    // addNewText uses bounds.left/top as x/y, so positions are meaningful
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewText({left:10,top:10,right:60,bottom:30}, "in");
       doc.addNewText({left:200,top:200,right:250,bottom:220}, "out");
       doc.setSelectionRect({left:0,top:0,right:100,bottom:100});
       fl.trace(doc.selection.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["1"]);
  });

  it("deleteSelection removes selected objects", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:10,top:10,right:60,bottom:60},0);
       doc.selectAll();
       doc.deleteSelection();
       var tl = doc.getTimeline();
       fl.trace(tl.layers[0].frames[0].elements.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["0"]);
  });

  it("deleteSelection is a no-op when nothing selected", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:0,top:0,right:50,bottom:50},0);
       doc.deleteSelection();
       var tl = doc.getTimeline();
       fl.trace(tl.layers[0].frames[0].elements.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["1"]);
  });
});

// ---------------------------------------------------------------------------
// doc.convertToSymbol
// ---------------------------------------------------------------------------

describe("doc.convertToSymbol", () => {
  it("converts selected objects to a movie clip in the library", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:0,top:0,right:50,bottom:50},0);
       doc.selectAll();
       doc.convertToSymbol("movie clip", "MySymbol", "center");
       fl.trace(doc.library.items.length);
       fl.trace(doc.library.items[0].name);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces[0]).toBe("1");
    expect(result.traces[1]).toBe("MySymbol");
    // Original shape replaced with instance
    const scene = result.finalDocument!.scenes[0];
    const kf = scene.timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    );
    expect(kf?.displayObjects[0].type).toBe("instance");
  });

  it("convertToSymbol for a graphic type creates a graphic symbol", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewOval({left:0,top:0,right:40,bottom:40});
       doc.selectAll();
       doc.convertToSymbol("graphic", "GraphicSym");
       fl.trace(doc.library.items[0].itemType);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["symbol"]);
  });
});

// ---------------------------------------------------------------------------
// doc.library
// ---------------------------------------------------------------------------

describe("doc.library", () => {
  it("items is empty by default", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `fl.trace(fl.getDocumentDOM().library.items.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["0"]);
  });

  it("addNewItem adds a symbol to the library", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var lib = fl.getDocumentDOM().library;
       lib.addNewItem("movie clip", "Ball");
       fl.trace(lib.items.length);
       fl.trace(lib.items[0].name);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["1", "Ball"]);
    expect(
      result.finalDocument!.library.items.find((i) => i.name === "Ball")
    ).toBeDefined();
  });

  it("addNewItem for button type", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var lib = fl.getDocumentDOM().library;
       lib.addNewItem("button", "MyButton");
       fl.trace(lib.items[0].name);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["MyButton"]);
  });

  it("deleteItem removes the item from the library", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var lib = fl.getDocumentDOM().library;
       lib.addNewItem("movie clip", "Temp");
       lib.deleteItem("Temp");
       fl.trace(lib.items.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["0"]);
    expect(result.finalDocument!.library.items.length).toBe(0);
  });

  it("deleteItem is a no-op for unknown item", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var lib = fl.getDocumentDOM().library;
       lib.addNewItem("movie clip", "Keep");
       lib.deleteItem("nonexistent");
       fl.trace(lib.items.length);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["1"]);
  });

  it("renameItem renames an existing library item", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var lib = fl.getDocumentDOM().library;
       lib.addNewItem("graphic", "OldName");
       var ok = lib.renameItem("OldName", "NewName");
       fl.trace(ok);
       fl.trace(lib.items[0].name);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["true", "NewName"]);
    expect(
      result.finalDocument!.library.items.find((i) => i.name === "NewName")
    ).toBeDefined();
  });

  it("renameItem returns false for unknown item", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var lib = fl.getDocumentDOM().library;
       var ok = lib.renameItem("ghost", "NewName");
       fl.trace(ok);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["false"]);
  });

  it("selectItem returns true (no-op compat)", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var lib = fl.getDocumentDOM().library;
       lib.addNewItem("movie clip", "Thing");
       fl.trace(lib.selectItem("Thing"));`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["true"]);
  });
});

// ---------------------------------------------------------------------------
// Ensure module-level state does NOT leak between test runs
// ---------------------------------------------------------------------------

describe("isolated state between builds", () => {
  it("two separate contexts do not share state", () => {
    const ctxA = makeCtx();
    const ctxB = makeCtx();

    runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:0,top:0,right:10,bottom:10},0);`,
      ctxA
    );

    const resultB = runJsfl(
      `var tl = fl.getDocumentDOM().getTimeline();
       fl.trace(tl.layers[0].frames[0].elements.length);`,
      ctxB
    );
    // ctxB should not see the rectangle added in ctxA
    expect(resultB.traces).toEqual(["0"]);
  });
});

// ---------------------------------------------------------------------------
// frame.elements writable Proxy (task 0993)
// ---------------------------------------------------------------------------

describe("frame.elements writable Proxy", () => {
  it("setting element.x mutates the document model", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:10, top:20, right:60, bottom:70}, 0);
       var elem = doc.getTimeline().layers[0].frames[0].elements[0];
       elem.x = 100;`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const kf = result.finalDocument!.scenes[0].timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    );
    expect(kf?.displayObjects[0].x).toBe(100);
  });

  it("setting element.y mutates the document model", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:10, top:20, right:60, bottom:70}, 0);
       var elem = doc.getTimeline().layers[0].frames[0].elements[0];
       elem.y = 200;`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const kf = result.finalDocument!.scenes[0].timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    );
    expect(kf?.displayObjects[0].y).toBe(200);
  });

  it("setting element.rotation mutates the document model", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:0, top:0, right:50, bottom:50}, 0);
       var elem = doc.getTimeline().layers[0].frames[0].elements[0];
       elem.rotation = 45;`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const kf = result.finalDocument!.scenes[0].timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    );
    const obj = kf?.displayObjects[0] as { rotation?: number };
    expect(obj?.rotation).toBe(45);
  });

  it("setting element.alpha mutates the document model", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:0, top:0, right:50, bottom:50}, 0);
       var elem = doc.getTimeline().layers[0].frames[0].elements[0];
       elem.alpha = 0.5;`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const kf = result.finalDocument!.scenes[0].timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    );
    const obj = kf?.displayObjects[0] as { alpha?: number };
    expect(obj?.alpha).toBe(0.5);
  });

  it("setting element.visible = false mutates the document model", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:0, top:0, right:50, bottom:50}, 0);
       var elem = doc.getTimeline().layers[0].frames[0].elements[0];
       elem.visible = false;`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const kf = result.finalDocument!.scenes[0].timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    );
    const obj = kf?.displayObjects[0] as { visible?: boolean };
    expect(obj?.visible).toBe(false);
  });

  it("setting element.name maps to instanceName on SymbolInstance", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:0, top:0, right:50, bottom:50}, 0);
       doc.selectAll();
       doc.convertToSymbol("movie clip", "myClip");
       // The element is now a SymbolInstance
       var elem = doc.getTimeline().layers[0].frames[0].elements[0];
       fl.trace(elem.type);
       elem.name = "myInstance";`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["instance"]);
    const kf = result.finalDocument!.scenes[0].timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    );
    const inst = kf?.displayObjects[0] as { instanceName?: string };
    expect(inst?.instanceName).toBe("myInstance");
  });

  it("element.name getter returns instanceName from SymbolInstance", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:0, top:0, right:50, bottom:50}, 0);
       doc.selectAll();
       doc.convertToSymbol("movie clip", "mc");
       var elem = doc.getTimeline().layers[0].frames[0].elements[0];
       elem.name = "myMC";
       fl.trace(elem.name);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    expect(result.traces).toEqual(["myMC"]);
  });

  it("setting element.x does not affect other elements", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:10, top:10, right:60, bottom:60}, 0);
       doc.addNewOval({left:100, top:100, right:150, bottom:150});
       var elems = doc.getTimeline().layers[0].frames[0].elements;
       elems[0].x = 999;
       fl.trace(elems[1].x);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    // Second element x should be unchanged (0, since shapes store offset separately)
    const kf = result.finalDocument!.scenes[0].timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    );
    expect(kf?.displayObjects[0].x).toBe(999);
    // Second element should not have been changed
    expect(kf?.displayObjects[1].x).not.toBe(999);
  });

  it("setting multiple properties in sequence works", () => {
    const ctx = makeCtx();
    const result = runJsfl(
      `var doc = fl.getDocumentDOM();
       doc.addNewRectangle({left:0, top:0, right:50, bottom:50}, 0);
       var elem = doc.getTimeline().layers[0].frames[0].elements[0];
       elem.x = 77;
       elem.y = 88;
       elem.rotation = 30;
       fl.trace(elem.x + "," + elem.y);`,
      ctx
    );
    expect(result.error).toBeUndefined();
    const kf = result.finalDocument!.scenes[0].timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 0
    );
    expect(kf?.displayObjects[0].x).toBe(77);
    expect(kf?.displayObjects[0].y).toBe(88);
    const obj = kf?.displayObjects[0] as { rotation?: number };
    expect(obj?.rotation).toBe(30);
  });
});
