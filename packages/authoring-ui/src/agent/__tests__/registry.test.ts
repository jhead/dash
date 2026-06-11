/**
 * Unit tests for AgentCommandRegistry (task 0614).
 *
 * Tests are grouped by domain and cover one representative mutate→read
 * round-trip per domain to guard against regressions.
 *
 * The registry is wired up with a minimal set of callbacks backed by
 * plain @flash/core state (no React, no DOM).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createDocument, createSymbolInLibrary } from "@flash/core";
import type { FlashDocument } from "@flash/core";
import {
  setAgentCallbacks,
  clearAgentCallbacks,
  bumpRev,
  dispatchAgentCommand,
  getRev,
} from "../registry.js";

// ---------------------------------------------------------------------------
// Test harness — minimal callbacks backed by plain state
// ---------------------------------------------------------------------------

interface HarnessState {
  doc: FlashDocument;
  selectedIds: string[];
  currentFrame: number;
  activeLayerIndex: number;
  activeTool: string;
  editContext: { mode: "document" | "symbol"; symbolId?: string };
  activeSceneIndex: number;
  undoHistory: FlashDocument[];
  redoStack: FlashDocument[];
  zoom: number;
  panX: number;
  panY: number;
  playing: boolean;
}

function makeHarness(initial?: FlashDocument) {
  const state: HarnessState = {
    doc: initial ?? createDocument(),
    selectedIds: [],
    currentFrame: 0,
    activeLayerIndex: 0,
    activeTool: "selection",
    editContext: { mode: "document" },
    activeSceneIndex: 0,
    undoHistory: [],
    redoStack: [],
    zoom: 1,
    panX: 0,
    panY: 0,
    playing: false,
  };

  const pushDoc = (newDoc: FlashDocument) => {
    state.undoHistory.push(state.doc);
    state.redoStack = [];
    state.doc = newDoc;
    bumpRev();
  };

  const undo = () => {
    const prev = state.undoHistory.pop();
    if (prev) {
      state.redoStack.push(state.doc);
      state.doc = prev;
    }
  };

  const redo = () => {
    const next = state.redoStack.pop();
    if (next) {
      state.undoHistory.push(state.doc);
      state.doc = next;
    }
  };

  setAgentCallbacks({
    getDoc: () => state.doc,
    getSelectedIds: () => state.selectedIds,
    getCurrentFrame: () => state.currentFrame,
    getActiveLayerIndex: () => state.activeLayerIndex,
    getActiveTool: () => state.activeTool,
    getEditContext: () => state.editContext,
    getActiveSceneIndex: () => state.activeSceneIndex,
    getUndoDepth: () => state.undoHistory.length,
    getRedoDepth: () => state.redoStack.length,

    pushDoc,
    undo,
    redo,

    setCurrentFrame: (f: number) => { state.currentFrame = f; },
    setActiveLayerByIndex: (i: number) => { state.activeLayerIndex = i; },
    setActiveLayerById: (layerId: string) => {
      const idx = state.doc.scenes[0].timeline.layers.findIndex((l) => l.id === layerId);
      if (idx >= 0) state.activeLayerIndex = idx;
    },
    setSelectedIds: (ids: string[]) => { state.selectedIds = ids; },
    setZoom: (z: number) => { state.zoom = z; },
    setPan: (x: number, y: number) => { state.panX = x; state.panY = y; },
    selectTool: (toolId: string) => { state.activeTool = toolId; },
    startPlayback: () => { state.playing = true; },
    stopPlayback: () => { state.playing = false; },
    setActiveSceneIndex: (index: number) => { state.activeSceneIndex = index; },

    runJSFL: (_source: string) => ({
      traces: ["jsfl-ran"],
      returnValue: undefined,
      error: undefined,
      rev: getRev(),
    }),
    screenshotStage: (_frameIndex?: number) => "fake-png-base64",
    publishToBytes: () => Promise.resolve(new Uint8Array([0x46, 0x57, 0x53, 0x08])),
  });

  return state;
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let state: HarnessState;

beforeEach(() => {
  clearAgentCallbacks();
  state = makeHarness();
});

// ---------------------------------------------------------------------------
// Session & document
// ---------------------------------------------------------------------------

describe("editor_status", () => {
  it("returns alive=true with doc info and rev", async () => {
    const result = await dispatchAgentCommand("editor_status", {}) as Record<string, unknown>;
    expect(result["alive"]).toBe(true);
    expect(typeof result["width"]).toBe("number");
    expect(typeof result["rev"]).toBe("number");
  });
});

describe("doc_get", () => {
  it("returns full doc when path omitted", async () => {
    const result = await dispatchAgentCommand("doc_get", {}) as Record<string, unknown>;
    expect(typeof result["rev"]).toBe("number");
    const value = result["value"] as Record<string, unknown>;
    expect(Array.isArray(value["scenes"])).toBe(true);
  });

  it("returns subtree at path", async () => {
    const result = await dispatchAgentCommand("doc_get", { path: "/properties" }) as Record<string, unknown>;
    const value = result["value"] as Record<string, unknown>;
    expect(typeof value["width"]).toBe("number");
  });

  it("errors on bad path", async () => {
    await expect(dispatchAgentCommand("doc_get", { path: "/nonexistent" })).rejects.toThrow();
  });
});

describe("doc_summary", () => {
  it("returns document summary with scenes and library", async () => {
    const result = await dispatchAgentCommand("doc_summary", {}) as Record<string, unknown>;
    expect(Array.isArray(result["scenes"])).toBe(true);
    expect(Array.isArray(result["library"])).toBe(true);
  });
});

describe("doc_set_properties", () => {
  it("updates document properties", async () => {
    const result = await dispatchAgentCommand("doc_set_properties", {
      width: 800,
      height: 600,
      frameRate: 24,
      backgroundColor: "#0000ff",
    }) as Record<string, unknown>;
    expect(result["ok"]).toBe(true);
    expect(state.doc.properties.width).toBe(800);
    expect(state.doc.properties.height).toBe(600);
    expect(state.doc.properties.frameRate).toBe(24);
    expect(state.doc.properties.backgroundColor).toBe("#0000ff");
  });
});

describe("history_undo / history_redo / history_depth", () => {
  it("undoes and redoes a mutation", async () => {
    const revBefore = getRev();
    await dispatchAgentCommand("doc_set_properties", { width: 999 });
    expect(state.doc.properties.width).toBe(999);

    await dispatchAgentCommand("history_undo", {});
    expect(state.doc.properties.width).not.toBe(999);

    await dispatchAgentCommand("history_redo", {});
    expect(state.doc.properties.width).toBe(999);

    const depth = await dispatchAgentCommand("history_depth", {}) as Record<string, unknown>;
    expect(typeof depth["undo"]).toBe("number");
    expect(typeof depth["redo"]).toBe("number");

    // suppress unused var warning
    void revBefore;
  });
});

// ---------------------------------------------------------------------------
// Stage & selection
// ---------------------------------------------------------------------------

describe("stage_add_shape", () => {
  it("adds a rect to the stage", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    const result = await dispatchAgentCommand("stage_add_shape", {
      kind: "rect",
      x1: 10,
      y1: 10,
      x2: 110,
      y2: 60,
      fill: "#ff0000",
      layerId,
      frameIndex: 0,
    }) as Record<string, unknown>;
    expect(typeof result["id"]).toBe("string");
    expect(typeof result["rev"]).toBe("number");

    // Verify via doc_get
    const docResult = await dispatchAgentCommand("doc_get", {}) as Record<string, unknown>;
    const doc = (docResult["value"] as Record<string, unknown>);
    const scenes = doc["scenes"] as Array<Record<string, unknown>>;
    const layers = (scenes[0]["timeline"] as Record<string, unknown>)["layers"] as Array<Record<string, unknown>>;
    const frames = layers[0]["frames"] as Array<Record<string, unknown>>;
    const kf0 = frames[0];
    const objects = kf0["displayObjects"] as unknown[];
    expect(objects).toHaveLength(1);
  });

  it("adds an oval", async () => {
    const result = await dispatchAgentCommand("stage_add_shape", {
      kind: "oval",
      x1: 0,
      y1: 0,
      x2: 50,
      y2: 50,
      stroke: "#000000",
    }) as Record<string, unknown>;
    expect(result["id"]).toBeTruthy();
  });

  it("adds a line", async () => {
    const result = await dispatchAgentCommand("stage_add_shape", {
      kind: "line",
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 100,
    }) as Record<string, unknown>;
    expect(result["id"]).toBeTruthy();
  });

  it("adds a rect with a linear gradient fill", async () => {
    const result = await dispatchAgentCommand("stage_add_shape", {
      kind: "rect",
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 50,
      fill: {
        type: "linear",
        stops: [
          { color: "#ff0000", ratio: 0 },
          { color: "#0000ff", ratio: 1 },
        ],
        angle: 90,
      },
    }) as Record<string, unknown>;
    expect(result["id"]).toBeTruthy();

    const docResult = await dispatchAgentCommand("doc_get", {}) as Record<string, unknown>;
    const doc = docResult["value"] as Record<string, unknown>;
    const scenes = doc["scenes"] as Array<Record<string, unknown>>;
    const layers = (scenes[0]["timeline"] as Record<string, unknown>)["layers"] as Array<Record<string, unknown>>;
    const frames = layers[0]["frames"] as Array<Record<string, unknown>>;
    const objs = frames[0]["displayObjects"] as Array<Record<string, unknown>>;
    const shape = objs.find((o) => o["id"] === result["id"]) as Record<string, unknown> | undefined;
    expect(shape).toBeDefined();
    const shapeData = shape!["shape"] as Record<string, unknown>;
    const paths = shapeData["paths"] as Array<Record<string, unknown>>;
    expect(paths.length).toBeGreaterThan(0);
    const fill = paths[0]["fill"] as Record<string, unknown> | undefined;
    expect(fill).toBeDefined();
    expect(fill!["type"]).toBe("linear-gradient");
    const stops = fill!["stops"] as Array<Record<string, unknown>>;
    expect(stops).toHaveLength(2);
    expect(stops[0]["ratio"]).toBe(0);
    expect(stops[1]["ratio"]).toBe(255);
  });

  it("adds an oval with a radial gradient fill", async () => {
    const result = await dispatchAgentCommand("stage_add_shape", {
      kind: "oval",
      x1: 0,
      y1: 0,
      x2: 80,
      y2: 80,
      fill: {
        type: "radial",
        stops: [
          { color: "#ffffff", alpha: 1, ratio: 0 },
          { color: "#000000", alpha: 0.5, ratio: 1 },
        ],
        focalPoint: 0.2,
      },
    }) as Record<string, unknown>;
    expect(result["id"]).toBeTruthy();

    const docResult = await dispatchAgentCommand("doc_get", {}) as Record<string, unknown>;
    const doc = docResult["value"] as Record<string, unknown>;
    const scenes = doc["scenes"] as Array<Record<string, unknown>>;
    const layers = (scenes[0]["timeline"] as Record<string, unknown>)["layers"] as Array<Record<string, unknown>>;
    const frames = layers[0]["frames"] as Array<Record<string, unknown>>;
    const objs = frames[0]["displayObjects"] as Array<Record<string, unknown>>;
    const shape = objs.find((o) => o["id"] === result["id"]) as Record<string, unknown> | undefined;
    expect(shape).toBeDefined();
    const shapeData = shape!["shape"] as Record<string, unknown>;
    const paths = shapeData["paths"] as Array<Record<string, unknown>>;
    expect(paths.length).toBeGreaterThan(0);
    const fill = paths[0]["fill"] as Record<string, unknown> | undefined;
    expect(fill).toBeDefined();
    expect(fill!["type"]).toBe("radial-gradient");
    const stops = fill!["stops"] as Array<Record<string, unknown>>;
    expect(stops).toHaveLength(2);
    // alpha=1 → a=255; alpha=0.5 → a=128
    const stop0color = stops[0]["color"] as Record<string, unknown>;
    const stop1color = stops[1]["color"] as Record<string, unknown>;
    expect(stop0color["a"]).toBe(255);
    expect(stop1color["a"]).toBe(128);
  });
});

describe("stage_add_text", () => {
  it("adds a text object", async () => {
    const result = await dispatchAgentCommand("stage_add_text", {
      x: 10,
      y: 20,
      width: 200,
      height: 30,
      text: "Hello World",
      color: "#333333",
    }) as Record<string, unknown>;
    expect(typeof result["id"]).toBe("string");

    const docResult = await dispatchAgentCommand("doc_get", {}) as Record<string, unknown>;
    const doc = (docResult["value"] as Record<string, unknown>);
    const scenes = doc["scenes"] as Array<Record<string, unknown>>;
    const layers = (scenes[0]["timeline"] as Record<string, unknown>)["layers"] as Array<Record<string, unknown>>;
    const frames = layers[0]["frames"] as Array<Record<string, unknown>>;
    const objs = frames[0]["displayObjects"] as Array<Record<string, unknown>>;
    const textObj = objs.find((o) => o["type"] === "text");
    expect(textObj).toBeTruthy();
    expect((textObj as Record<string, unknown>)["text"]).toBe("Hello World");
  });
});

describe("stage_place_instance", () => {
  it("places a symbol instance after creating the symbol", async () => {
    const symResult = await dispatchAgentCommand("library_create_symbol", {
      name: "Ball",
      symbolType: "movieclip",
    }) as Record<string, unknown>;
    const symbolId = symResult["symbolId"] as string;

    const result = await dispatchAgentCommand("stage_place_instance", {
      symbolId,
      x: 100,
      y: 200,
    }) as Record<string, unknown>;
    expect(typeof result["id"]).toBe("string");
  });

  it("errors on unknown symbolId", async () => {
    await expect(
      dispatchAgentCommand("stage_place_instance", { symbolId: "no-such-sym", x: 0, y: 0 })
    ).rejects.toThrow(/symbolId/);
  });

  it("places instance with scaleX, scaleY, and rotation", async () => {
    const symResult = await dispatchAgentCommand("library_create_symbol", {
      name: "Scaled",
      symbolType: "movieclip",
    }) as Record<string, unknown>;
    const symbolId = symResult["symbolId"] as string;

    await dispatchAgentCommand("stage_place_instance", {
      symbolId,
      x: 50,
      y: 50,
      scaleX: 2,
      scaleY: 0.5,
      rotation: 45,
    });

    const objs = state.doc.scenes[0].timeline.layers[0].frames[0].displayObjects;
    const inst = objs.find((o) => o.type === "instance") as Record<string, unknown> | undefined;
    expect(inst).toBeDefined();
    expect(inst!["scaleX"]).toBe(2);
    expect(inst!["scaleY"]).toBe(0.5);
    expect(inst!["rotation"]).toBe(45);
  });

  it("places instance with blendMode and colorEffect", async () => {
    const symResult = await dispatchAgentCommand("library_create_symbol", {
      name: "Blended",
      symbolType: "movieclip",
    }) as Record<string, unknown>;
    const symbolId = symResult["symbolId"] as string;

    await dispatchAgentCommand("stage_place_instance", {
      symbolId,
      x: 0,
      y: 0,
      blendMode: "multiply",
      colorEffect: { type: "brightness", brightness: 50 },
    });

    const objs = state.doc.scenes[0].timeline.layers[0].frames[0].displayObjects;
    const inst = objs.find(
      (o) => o.type === "instance" && (o as unknown as Record<string, unknown>)["blendMode"] === "multiply"
    ) as unknown as Record<string, unknown> | undefined;
    expect(inst).toBeDefined();
    expect(inst!["blendMode"]).toBe("multiply");
    expect((inst!["colorEffect"] as Record<string, unknown>)["type"]).toBe("brightness");
    expect((inst!["colorEffect"] as Record<string, unknown>)["brightness"]).toBe(50);
  });

  it("places graphic instance with loopMode and firstFrame", async () => {
    const symResult = await dispatchAgentCommand("library_create_symbol", {
      name: "Graphic",
      symbolType: "graphic",
    }) as Record<string, unknown>;
    const symbolId = symResult["symbolId"] as string;

    await dispatchAgentCommand("stage_place_instance", {
      symbolId,
      x: 0,
      y: 0,
      loopMode: "single-frame",
      firstFrame: 3,
    });

    const objs = state.doc.scenes[0].timeline.layers[0].frames[0].displayObjects;
    const inst = objs.find(
      (o) => o.type === "instance" && (o as unknown as Record<string, unknown>)["loopMode"] === "single-frame"
    ) as unknown as Record<string, unknown> | undefined;
    expect(inst).toBeDefined();
    expect(inst!["loopMode"]).toBe("single-frame");
    expect(inst!["firstFrame"]).toBe(3);
  });

  it("errors on invalid blendMode", async () => {
    const symResult = await dispatchAgentCommand("library_create_symbol", {
      name: "Bad",
      symbolType: "movieclip",
    }) as Record<string, unknown>;
    const symbolId = symResult["symbolId"] as string;

    await expect(
      dispatchAgentCommand("stage_place_instance", { symbolId, x: 0, y: 0, blendMode: "not-a-mode" })
    ).rejects.toThrow(/blendMode/);
  });
});

describe("stage_add_video", () => {
  beforeEach(() => {
    // Seed the document with a VideoItem in the library.
    const doc = state.doc;
    const video = {
      id: "vid-1",
      name: "clip.flv",
      itemType: "video" as const,
      dataUri: "",
      frameCount: 30,
      frameRate: 30,
      width: 320,
      height: 240,
    };
    state.doc = {
      ...doc,
      library: { ...doc.library, items: [...doc.library.items, video] },
    };
  });

  it("places a video display object using native dimensions by default", async () => {
    const result = (await dispatchAgentCommand("stage_add_video", {
      videoItemId: "vid-1",
      x: 50,
      y: 60,
    })) as Record<string, unknown>;
    expect(typeof result["id"]).toBe("string");

    const objs = state.doc.scenes[0].timeline.layers[0].frames[0].displayObjects;
    const placed = objs.find((o) => o.type === "video") as Record<string, unknown> | undefined;
    expect(placed).toBeDefined();
    expect(placed!["videoItemId"]).toBe("vid-1");
    expect(placed!["x"]).toBe(50);
    expect(placed!["y"]).toBe(60);
    expect(placed!["width"]).toBe(320);
    expect(placed!["height"]).toBe(240);
  });

  it("honours explicit width/height overrides", async () => {
    await dispatchAgentCommand("stage_add_video", {
      videoItemId: "vid-1",
      x: 0,
      y: 0,
      width: 160,
      height: 120,
    });
    const objs = state.doc.scenes[0].timeline.layers[0].frames[0].displayObjects;
    const placed = objs.find((o) => o.type === "video") as unknown as Record<string, unknown>;
    expect(placed["width"]).toBe(160);
    expect(placed["height"]).toBe(120);
  });

  it("errors on unknown videoItemId", async () => {
    await expect(
      dispatchAgentCommand("stage_add_video", { videoItemId: "no-such-vid", x: 0, y: 0 })
    ).rejects.toThrow(/videoItemId/);
  });
});

describe("stage_remove", () => {
  it("removes objects from stage", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    const addResult = await dispatchAgentCommand("stage_add_shape", {
      kind: "rect", x1: 0, y1: 0, x2: 10, y2: 10, layerId, frameIndex: 0,
    }) as Record<string, unknown>;
    const id = addResult["id"] as string;

    await dispatchAgentCommand("stage_remove", { ids: [id], layerId, frameIndex: 0 });

    const docResult = await dispatchAgentCommand("doc_get", {}) as Record<string, unknown>;
    const doc = (docResult["value"] as Record<string, unknown>);
    const scenes = doc["scenes"] as Array<Record<string, unknown>>;
    const layers = (scenes[0]["timeline"] as Record<string, unknown>)["layers"] as Array<Record<string, unknown>>;
    const frames = layers[0]["frames"] as Array<Record<string, unknown>>;
    const objs = frames[0]["displayObjects"] as unknown[];
    expect(objs).toHaveLength(0);
  });
});

describe("stage_update", () => {
  it("updates position of an object", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    const addResult = await dispatchAgentCommand("stage_add_text", {
      x: 0, y: 0, width: 100, height: 20, text: "Foo", layerId, frameIndex: 0,
    }) as Record<string, unknown>;
    const id = addResult["id"] as string;

    await dispatchAgentCommand("stage_update", {
      id,
      layerId,
      frameIndex: 0,
      updates: { x: 50, y: 75 },
    });

    const docResult = await dispatchAgentCommand("doc_get", {}) as Record<string, unknown>;
    const doc = (docResult["value"] as Record<string, unknown>);
    const scenes = doc["scenes"] as Array<Record<string, unknown>>;
    const layers = (scenes[0]["timeline"] as Record<string, unknown>)["layers"] as Array<Record<string, unknown>>;
    const frames = layers[0]["frames"] as Array<Record<string, unknown>>;
    const objs = frames[0]["displayObjects"] as Array<Record<string, unknown>>;
    const updated = objs.find((o) => o["id"] === id)!;
    expect(updated["x"]).toBe(50);
    expect(updated["y"]).toBe(75);
  });
});

describe("selection_get / selection_set", () => {
  it("sets and gets selection", async () => {
    await dispatchAgentCommand("selection_set", { ids: ["fake-id"] });
    expect(state.selectedIds).toContain("fake-id");

    const result = await dispatchAgentCommand("selection_get", {}) as Record<string, unknown>;
    expect((result["ids"] as string[]).includes("fake-id")).toBe(true);
  });

  it("selection_set all:true selects all objects on current frame", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    await dispatchAgentCommand("stage_add_shape", {
      kind: "rect", x1: 0, y1: 0, x2: 10, y2: 10, layerId, frameIndex: 0,
    });
    await dispatchAgentCommand("selection_set", { all: true });
    expect(state.selectedIds.length).toBeGreaterThan(0);
  });
});

describe("view_set", () => {
  it("updates zoom and current frame", async () => {
    await dispatchAgentCommand("view_set", { zoom: 2.0, currentFrame: 5 });
    expect(state.zoom).toBe(2.0);
    expect(state.currentFrame).toBe(5);
  });
});

describe("tool_select", () => {
  it("selects a tool", async () => {
    await dispatchAgentCommand("tool_select", { toolId: "pen" });
    expect(state.activeTool).toBe("pen");
  });

  it("errors on unknown tool", async () => {
    await expect(
      dispatchAgentCommand("tool_select", { toolId: "flamethrower" })
    ).rejects.toThrow(/toolId/);
  });
});

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

describe("timeline_add_layer / remove_layer / update_layer", () => {
  it("adds and removes a layer", async () => {
    const before = state.doc.scenes[0].timeline.layers.length;

    const addResult = await dispatchAgentCommand("timeline_add_layer", {
      name: "New Layer",
    }) as Record<string, unknown>;
    const layerId = addResult["layerId"] as string;
    expect(typeof layerId).toBe("string");
    expect(state.doc.scenes[0].timeline.layers.length).toBe(before + 1);

    await dispatchAgentCommand("timeline_remove_layer", { layerId });
    expect(state.doc.scenes[0].timeline.layers.length).toBe(before);
  });

  it("updates layer name and locked state", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    await dispatchAgentCommand("timeline_update_layer", {
      layerId,
      name: "Background",
      locked: true,
    });
    const layer = state.doc.scenes[0].timeline.layers.find((l) => l.id === layerId)!;
    expect(layer.name).toBe("Background");
    expect(layer.locked).toBe(true);
  });
});

describe("timeline frame operations", () => {
  it("inserts a frame", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    const before = state.doc.scenes[0].timeline.layers[0].frameCount;
    await dispatchAgentCommand("timeline_insert_frame", { layerId, frameIndex: 0 });
    expect(state.doc.scenes[0].timeline.layers[0].frameCount).toBe(before + 1);
  });

  it("inserts a keyframe", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    await dispatchAgentCommand("timeline_insert_keyframe", { layerId, frameIndex: 1 });
    const kfs = state.doc.scenes[0].timeline.layers[0].frames.filter((f) => f.isKeyframe);
    expect(kfs.length).toBeGreaterThan(1);
  });

  it("inserts a blank keyframe", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    await dispatchAgentCommand("timeline_insert_blank_keyframe", { layerId, frameIndex: 2 });
    const kf2 = state.doc.scenes[0].timeline.layers[0].frames.find(
      (f) => f.isKeyframe && f.index === 2
    );
    expect(kf2).toBeTruthy();
    expect(kf2!.isEmpty).toBe(true);
  });

  it("removes a frame after inserting one", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    await dispatchAgentCommand("timeline_insert_frame", { layerId, frameIndex: 0 });
    const after = state.doc.scenes[0].timeline.layers[0].frameCount;
    await dispatchAgentCommand("timeline_remove_frame", { layerId, frameIndex: 0 });
    expect(state.doc.scenes[0].timeline.layers[0].frameCount).toBe(after - 1);
  });

  it("sets a frame label", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    await dispatchAgentCommand("timeline_set_frame_label", {
      layerId,
      frameIndex: 0,
      label: "start",
      labelType: "anchor",
    });
    const kf = state.doc.scenes[0].timeline.layers[0].frames[0];
    expect(kf.label).toBe("start");
    expect(kf.labelType).toBe("anchor");
  });

  it("sets and clears a tween", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    await dispatchAgentCommand("timeline_set_tween", {
      layerId,
      frameIndex: 0,
      kind: "motion",
      props: { ease: 50 },
    });
    expect(state.doc.scenes[0].timeline.layers[0].frames[0].tweenType).toBe("motion");

    await dispatchAgentCommand("timeline_set_tween", {
      layerId,
      frameIndex: 0,
      kind: null,
    });
    expect(state.doc.scenes[0].timeline.layers[0].frames[0].tweenType).toBe("none");
  });

  it("maps rotate, rotateCount, scale, orientToPath, sync props for motion tween", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    await dispatchAgentCommand("timeline_set_tween", {
      layerId,
      frameIndex: 0,
      kind: "motion",
      props: {
        ease: -25,
        rotate: "cw",
        rotateCount: 2,
        scale: true,
        orientToPath: true,
        sync: false,
      },
    });
    const kf = state.doc.scenes[0].timeline.layers[0].frames[0];
    expect(kf.tweenType).toBe("motion");
    expect(kf.motionEase).toBe(-25);
    expect(kf.motionRotate).toBe("cw");
    expect(kf.motionRotateCount).toBe(2);
    expect(kf.motionScale).toBe(true);
    expect(kf.motionOrientToPath).toBe(true);
    expect(kf.motionSync).toBe(false);
  });
});

describe("timeline_goto_frame / playback_play / playback_stop", () => {
  it("moves the playhead", async () => {
    await dispatchAgentCommand("timeline_goto_frame", { frameIndex: 7 });
    expect(state.currentFrame).toBe(7);
  });

  it("starts and stops playback", async () => {
    await dispatchAgentCommand("playback_play", {});
    expect(state.playing).toBe(true);
    await dispatchAgentCommand("playback_stop", {});
    expect(state.playing).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Code (AS2)
// ---------------------------------------------------------------------------

describe("script_get / script_set / script_check / script_list", () => {
  it("sets and gets a script", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    await dispatchAgentCommand("script_set", {
      layerId,
      frameIndex: 0,
      script: "stop();",
    });

    const getResult = await dispatchAgentCommand("script_get", {
      layerId,
      frameIndex: 0,
    }) as Record<string, unknown>;
    expect(getResult["script"]).toBe("stop();");
  });

  it("script_set saves broken script and returns ok:true with error diagnostics (Flash 8 parity)", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    const brokenScript = "function broken( {";
    const result = await dispatchAgentCommand("script_set", {
      layerId,
      frameIndex: 0,
      script: brokenScript,
    }) as Record<string, unknown>;
    // Flash 8 parity: always saves; ok is always true
    expect(result["ok"]).toBe(true);
    // Diagnostics must contain at least one error entry
    const diag = result["diagnostics"] as unknown[];
    expect(diag.length).toBeGreaterThan(0);
    // Script should actually have been saved to the document
    const getResult = await dispatchAgentCommand("script_get", {
      layerId,
      frameIndex: 0,
    }) as Record<string, unknown>;
    expect(getResult["script"]).toBe(brokenScript);
  });

  it("script_set returns empty diagnostics for valid script", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    const result = await dispatchAgentCommand("script_set", {
      layerId,
      frameIndex: 0,
      script: "stop();",
    }) as Record<string, unknown>;
    const diag = result["diagnostics"] as unknown[];
    expect(diag).toHaveLength(0);
  });

  it("script_check checks without mutating", async () => {
    const before = state.doc.scenes[0].timeline.layers[0].frames[0].script;

    const result = await dispatchAgentCommand("script_check", {
      script: "undefined_function_call(",
    }) as Record<string, unknown>;
    const diag = result["diagnostics"] as unknown[];
    expect(diag.length).toBeGreaterThan(0);

    // Document should be unchanged
    expect(state.doc.scenes[0].timeline.layers[0].frames[0].script).toBe(before);
  });

  it("script_list returns scripts with previews", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    await dispatchAgentCommand("script_set", {
      layerId,
      frameIndex: 0,
      script: "trace('hello');",
    });

    const result = await dispatchAgentCommand("script_list", {}) as Record<string, unknown>;
    const scripts = result["scripts"] as Array<Record<string, unknown>>;
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts[0]["preview"]).toContain("trace");
  });
});

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

describe("library_list / library_create_symbol / library_rename / library_remove", () => {
  it("creates a symbol and lists it", async () => {
    const before = state.doc.library.items.length;
    const createResult = await dispatchAgentCommand("library_create_symbol", {
      name: "MySymbol",
      symbolType: "movieclip",
    }) as Record<string, unknown>;
    const symbolId = createResult["symbolId"] as string;
    expect(typeof symbolId).toBe("string");
    expect(state.doc.library.items.length).toBe(before + 1);

    const listResult = await dispatchAgentCommand("library_list", {}) as Record<string, unknown>;
    const items = listResult["items"] as Array<Record<string, unknown>>;
    expect(items.some((i) => i["id"] === symbolId)).toBe(true);
  });

  it("renames a library item", async () => {
    const { symbolId } = await dispatchAgentCommand("library_create_symbol", {
      name: "OldName",
      symbolType: "graphic",
    }) as { symbolId: string };

    await dispatchAgentCommand("library_rename", { itemId: symbolId, name: "NewName" });
    const item = state.doc.library.items.find((i) => i.id === symbolId);
    expect(item?.name).toBe("NewName");
  });

  it("removes a library item", async () => {
    const { symbolId } = await dispatchAgentCommand("library_create_symbol", {
      name: "ToDelete",
      symbolType: "movieclip",
    }) as { symbolId: string };

    await dispatchAgentCommand("library_remove", { itemId: symbolId });
    expect(state.doc.library.items.find((i) => i.id === symbolId)).toBeUndefined();
  });

  it("errors on unknown itemId for rename", async () => {
    await expect(
      dispatchAgentCommand("library_rename", { itemId: "no-such-item", name: "x" })
    ).rejects.toThrow(/itemId/);
  });
});

describe("library_convert_to_symbol", () => {
  it("converts display objects to a symbol and replaces them with an instance", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    const addResult = await dispatchAgentCommand("stage_add_shape", {
      kind: "rect", x1: 0, y1: 0, x2: 50, y2: 50, layerId, frameIndex: 0,
    }) as { id: string };

    const convertResult = await dispatchAgentCommand("library_convert_to_symbol", {
      ids: [addResult.id],
      name: "ConvertedSymbol",
      symbolType: "movieclip",
      layerId,
      frameIndex: 0,
    }) as { symbolId: string; instanceId: string };

    expect(typeof convertResult.symbolId).toBe("string");
    expect(typeof convertResult.instanceId).toBe("string");

    // Symbol should be in library
    expect(state.doc.library.items.find((i) => i.id === convertResult.symbolId)).toBeTruthy();

    // Instance should be on stage
    const kf = state.doc.scenes[0].timeline.layers[0].frames[0];
    const instance = kf.displayObjects.find((o) => o.id === convertResult.instanceId);
    expect(instance).toBeTruthy();
    expect(instance?.type).toBe("instance");
  });

  it("normalizes coords: instance origin = selection visual top-left, content shifted into symbol-local space (task 0707)", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    // stage_add_shape bakes the rect geometry at absolute stage coords
    // (here top-left at 200,150) while leaving the object's x/y at 0.
    const addResult = await dispatchAgentCommand("stage_add_shape", {
      kind: "rect", x1: 200, y1: 150, x2: 300, y2: 230, fill: "#ff0000",
      layerId, frameIndex: 0,
    }) as { id: string };

    const convertResult = await dispatchAgentCommand("library_convert_to_symbol", {
      ids: [addResult.id],
      name: "NormalizedSymbol",
      symbolType: "movieclip",
      layerId,
      frameIndex: 0,
    }) as { symbolId: string; instanceId: string };

    // The placed instance must sit at the selection's true visual top-left,
    // NOT at (0,0) (which is what the object's raw x/y field was).
    const kf = state.doc.scenes[0].timeline.layers[0].frames[0];
    const instance = kf.displayObjects.find((o) => o.id === convertResult.instanceId);
    expect(instance).toBeTruthy();
    expect((instance as { x: number }).x).toBeCloseTo(200, 6);
    expect((instance as { y: number }).y).toBeCloseTo(150, 6);

    // The symbol's content must be normalized so its visual top-left is at the
    // registration point (0,0). The shape geometry's leftmost point is at 200
    // in path space, so the object's x must be shifted by -200 to compensate.
    const sym = state.doc.library.items.find((i) => i.id === convertResult.symbolId);
    expect(sym?.itemType).toBe("symbol");
    if (sym?.itemType === "symbol") {
      const frame = sym.timeline.layers[0].frames[0];
      expect(frame.isEmpty).toBe(false);
      expect(frame.displayObjects).toHaveLength(1);
      const local = frame.displayObjects[0] as { type: string; x: number; y: number };
      expect(local.type).toBe("shape");
      expect(local.x).toBeCloseTo(-200, 6);
      expect(local.y).toBeCloseTo(-150, 6);
    }
  });
});

describe("library_set_linkage", () => {
  it("sets linkageId and exportForActionScript on a symbol", async () => {
    const { symbolId } = await dispatchAgentCommand("library_create_symbol", {
      name: "Enemy",
      symbolType: "movieclip",
    }) as { symbolId: string };

    const result = await dispatchAgentCommand("library_set_linkage", {
      symbolId,
      linkageId: "EnemyMC",
      exportForActionScript: true,
      exportInFirstFrame: true,
    }) as Record<string, unknown>;

    expect(result["ok"]).toBe(true);
    const sym = state.doc.library.items.find((i) => i.id === symbolId);
    expect(sym?.itemType).toBe("symbol");
    if (sym?.itemType === "symbol") {
      expect(sym.linkage.linkageIdentifier).toBe("EnemyMC");
      expect(sym.linkage.exportForActionScript).toBe(true);
      expect(sym.linkage.exportInFirstFrame).toBe(true);
    }
  });

  it("partial update — only updates specified fields", async () => {
    const { symbolId } = await dispatchAgentCommand("library_create_symbol", {
      name: "Player",
      symbolType: "movieclip",
    }) as { symbolId: string };

    // First set full linkage
    await dispatchAgentCommand("library_set_linkage", {
      symbolId,
      linkageId: "PlayerMC",
      exportForActionScript: true,
      exportInFirstFrame: false,
    });

    // Then update only exportInFirstFrame
    await dispatchAgentCommand("library_set_linkage", {
      symbolId,
      exportInFirstFrame: true,
    });

    const sym = state.doc.library.items.find((i) => i.id === symbolId);
    if (sym?.itemType === "symbol") {
      // linkageId and exportForActionScript must be unchanged
      expect(sym.linkage.linkageIdentifier).toBe("PlayerMC");
      expect(sym.linkage.exportForActionScript).toBe(true);
      expect(sym.linkage.exportInFirstFrame).toBe(true);
    }
  });

  it("errors on unknown symbolId", async () => {
    await expect(
      dispatchAgentCommand("library_set_linkage", {
        symbolId: "no-such-symbol",
        linkageId: "X",
      })
    ).rejects.toThrow(/symbolId/);
  });

  it("errors when item is not a symbol", async () => {
    // Import a bitmap and try to set linkage on it
    const importResult = await dispatchAgentCommand("library_import_bitmap", {
      data: "iVBORw0KGgo=",
      name: "bg.png",
      mimeType: "image/png",
    }) as { itemId: string };

    await expect(
      dispatchAgentCommand("library_set_linkage", {
        symbolId: importResult.itemId,
        linkageId: "bg",
      })
    ).rejects.toThrow(/symbol/);
  });
});

// ---------------------------------------------------------------------------
// Output & escape hatches
// ---------------------------------------------------------------------------

describe("jsfl_run", () => {
  it("calls the JSFL runner and returns traces", async () => {
    const result = await dispatchAgentCommand("jsfl_run", {
      source: "fl.trace('hello');",
    }) as Record<string, unknown>;
    expect(result["traces"]).toEqual(["jsfl-ran"]);
  });
});

describe("stage_screenshot", () => {
  it("returns a png base64 string and dimensions", async () => {
    const result = await dispatchAgentCommand("stage_screenshot", {}) as Record<string, unknown>;
    expect(typeof result["pngBase64"]).toBe("string");
    expect(typeof result["width"]).toBe("number");
    expect(typeof result["height"]).toBe("number");
  });
});

describe("publish_swf", () => {
  it("returns swf bytes as base64", async () => {
    const result = await dispatchAgentCommand("publish_swf", {}) as Record<string, unknown>;
    expect(typeof result["swfBase64"]).toBe("string");
    expect(typeof result["byteLength"]).toBe("number");
  });
});

describe("file_save_fla / file_load_fla", () => {
  it("round-trips a document through fla save/load", async () => {
    // Set a distinctive property
    await dispatchAgentCommand("doc_set_properties", { width: 1234 });
    expect(state.doc.properties.width).toBe(1234);

    // Save
    const saveResult = await dispatchAgentCommand("file_save_fla", {}) as {
      flaBase64: string;
      byteLength: number;
    };
    expect(saveResult.byteLength).toBeGreaterThan(0);

    // Change the document
    await dispatchAgentCommand("doc_set_properties", { width: 550 });
    expect(state.doc.properties.width).toBe(550);

    // Load the saved fla back
    await dispatchAgentCommand("file_load_fla", { flaBase64: saveResult.flaBase64 });
    // The restored document should have the saved width
    expect(state.doc.properties.width).toBe(1234);
  });
});

// ---------------------------------------------------------------------------
// Unknown command errors
// ---------------------------------------------------------------------------

describe("dispatch — unknown command", () => {
  it("throws with helpful message", async () => {
    await expect(
      dispatchAgentCommand("not_a_real_command", {})
    ).rejects.toThrow(/Unknown agent command/);
  });
});

// ---------------------------------------------------------------------------
// Scene commands — scene_add / scene_remove / scene_rename / scene_select
// ---------------------------------------------------------------------------

describe("scene_add", () => {
  it("adds a scene and returns sceneIndex + sceneName", async () => {
    const result = await dispatchAgentCommand("scene_add", {}) as {
      sceneIndex: number;
      sceneName: string;
      rev: number;
    };
    expect(result.sceneIndex).toBe(1); // appended at index 1 (after the initial scene)
    expect(typeof result.sceneName).toBe("string");
    expect(state.doc.scenes.length).toBe(2);
  });

  it("adds a scene with a custom name", async () => {
    const result = await dispatchAgentCommand("scene_add", { name: "Level 2" }) as {
      sceneIndex: number;
      sceneName: string;
    };
    expect(result.sceneName).toBe("Level 2");
    expect(state.doc.scenes[result.sceneIndex].name).toBe("Level 2");
  });

  it("increments the rev counter", async () => {
    const revBefore = state.undoHistory.length;
    await dispatchAgentCommand("scene_add", {});
    // pushDoc was called once so undoHistory grew
    expect(state.undoHistory.length).toBe(revBefore + 1);
  });

  it("multiple scene_add calls accumulate scenes", async () => {
    await dispatchAgentCommand("scene_add", { name: "Scene 2" });
    await dispatchAgentCommand("scene_add", { name: "Scene 3" });
    expect(state.doc.scenes.length).toBe(3);
  });
});

describe("scene_remove", () => {
  it("removes a scene by index", async () => {
    await dispatchAgentCommand("scene_add", { name: "Extra Scene" });
    expect(state.doc.scenes.length).toBe(2);
    await dispatchAgentCommand("scene_remove", { index: 1 });
    expect(state.doc.scenes.length).toBe(1);
  });

  it("throws when removing the only scene", async () => {
    await expect(
      dispatchAgentCommand("scene_remove", { index: 0 })
    ).rejects.toThrow(/cannot remove the only scene/);
  });

  it("throws when index is out of bounds", async () => {
    await expect(
      dispatchAgentCommand("scene_remove", { index: 5 })
    ).rejects.toThrow(/out of bounds/);
  });

  it("clamps activeSceneIndex after removal", async () => {
    await dispatchAgentCommand("scene_add", { name: "Scene B" });
    state.activeSceneIndex = 1; // manually set active to the second scene
    await dispatchAgentCommand("scene_remove", { index: 1 });
    // After removing index 1, active scene should be clamped to 0
    expect(state.activeSceneIndex).toBe(0);
  });
});

describe("scene_rename", () => {
  it("renames a scene", async () => {
    await dispatchAgentCommand("scene_rename", { index: 0, name: "Intro" });
    expect(state.doc.scenes[0].name).toBe("Intro");
  });

  it("goes through history (pushDoc called)", async () => {
    const histLen = state.undoHistory.length;
    await dispatchAgentCommand("scene_rename", { index: 0, name: "My Scene" });
    expect(state.undoHistory.length).toBe(histLen + 1);
  });

  it("throws when index is out of bounds", async () => {
    await expect(
      dispatchAgentCommand("scene_rename", { index: 99, name: "Bad" })
    ).rejects.toThrow(/out of bounds/);
  });
});

describe("scene_select", () => {
  it("selects a scene by index", async () => {
    await dispatchAgentCommand("scene_add", { name: "Scene 2" });
    await dispatchAgentCommand("scene_select", { index: 1 });
    expect(state.activeSceneIndex).toBe(1);
  });

  it("does NOT go through history (UI state only)", async () => {
    await dispatchAgentCommand("scene_add", {});
    const histLen = state.undoHistory.length;
    await dispatchAgentCommand("scene_select", { index: 1 });
    // setActiveSceneIndex is UI state — should NOT push to history
    expect(state.undoHistory.length).toBe(histLen);
  });

  it("throws when index is out of bounds", async () => {
    await expect(
      dispatchAgentCommand("scene_select", { index: 5 })
    ).rejects.toThrow(/out of bounds/);
  });

  it("selecting index 0 works on a fresh doc", async () => {
    const result = await dispatchAgentCommand("scene_select", { index: 0 }) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(state.activeSceneIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Symbol-edit mode (task 1076) — structured tools must target the symbol
// timeline, not the scene timeline, when editContext.mode === "symbol".
// ---------------------------------------------------------------------------

describe("symbol-edit mode routing", () => {
  /** Helper: create a symbol in the library and put the harness in symbol-edit mode. */
  function enterSymbolEditMode() {
    const doc = state.doc;
    const { library, item } = createSymbolInLibrary(doc.library, "MyMC", "movieclip");
    state.doc = { ...doc, library };
    // Simulate in-place editing — activate the symbol timeline
    state.editContext = { mode: "symbol", symbolId: item.id };
    return { symId: item.id };
  }

  it("stage_add_shape targets the symbol timeline, not the scene", async () => {
    const { symId } = enterSymbolEditMode();

    const sceneBefore = state.doc.scenes[0].timeline.layers[0].frames[0].displayObjects.length;
    const symBefore = (state.doc.library.items.find((i) => i.id === symId) as unknown as { timeline: { layers: { frames: { displayObjects: unknown[] }[] }[] } })
      .timeline.layers[0].frames[0].displayObjects.length;

    await dispatchAgentCommand("stage_add_shape", {
      kind: "rect", x1: 0, y1: 0, x2: 50, y2: 50, fill: "#ff0000",
    });

    const sceneAfter = state.doc.scenes[0].timeline.layers[0].frames[0].displayObjects.length;
    const symAfter = (state.doc.library.items.find((i) => i.id === symId) as unknown as { timeline: { layers: { frames: { displayObjects: unknown[] }[] }[] } })
      .timeline.layers[0].frames[0].displayObjects.length;

    // Object should land in symbol, not scene
    expect(symAfter).toBe(symBefore + 1);
    expect(sceneAfter).toBe(sceneBefore);
  });

  it("stage_add_text targets the symbol timeline", async () => {
    const { symId } = enterSymbolEditMode();

    await dispatchAgentCommand("stage_add_text", {
      x: 10, y: 10, width: 100, height: 30, text: "hello",
    });

    const symTimeline = (state.doc.library.items.find((i) => i.id === symId) as unknown as { timeline: { layers: { frames: { displayObjects: unknown[] }[] }[] } })
      .timeline;
    const count = symTimeline.layers[0].frames[0].displayObjects.length;
    expect(count).toBe(1);
    // Scene should be untouched
    const sceneCount = state.doc.scenes[0].timeline.layers[0].frames[0].displayObjects.length;
    expect(sceneCount).toBe(0);
  });

  it("stage_update targets the symbol timeline", async () => {
    const { symId } = enterSymbolEditMode();

    // First add a shape into the symbol
    const addResult = await dispatchAgentCommand("stage_add_shape", {
      kind: "rect", x1: 0, y1: 0, x2: 50, y2: 50, fill: "#ff0000",
    }) as { id: string };
    const objId = addResult.id;

    // Update should also target the symbol timeline
    await dispatchAgentCommand("stage_update", { id: objId, updates: { x: 99 } });

    const symTimeline = (state.doc.library.items.find((i) => i.id === symId) as unknown as { timeline: { layers: { frames: { displayObjects: { id: string; x?: number }[] }[] }[] } })
      .timeline;
    const obj = symTimeline.layers[0].frames[0].displayObjects.find((o) => o.id === objId);
    expect(obj?.x).toBe(99);
  });

  it("stage_remove targets the symbol timeline", async () => {
    const { symId } = enterSymbolEditMode();

    const addResult = await dispatchAgentCommand("stage_add_shape", {
      kind: "rect", x1: 0, y1: 0, x2: 50, y2: 50,
    }) as { id: string };
    const objId = addResult.id;

    await dispatchAgentCommand("stage_remove", { ids: [objId] });

    const symTimeline = (state.doc.library.items.find((i) => i.id === symId) as unknown as { timeline: { layers: { frames: { displayObjects: unknown[] }[] }[] } })
      .timeline;
    expect(symTimeline.layers[0].frames[0].displayObjects.length).toBe(0);
  });

  it("timeline_add_layer targets the symbol timeline", async () => {
    const { symId } = enterSymbolEditMode();

    const layersBefore = (state.doc.library.items.find((i) => i.id === symId) as unknown as { timeline: { layers: unknown[] } })
      .timeline.layers.length;

    await dispatchAgentCommand("timeline_add_layer", { name: "Layer2" });

    const layersAfter = (state.doc.library.items.find((i) => i.id === symId) as unknown as { timeline: { layers: unknown[] } })
      .timeline.layers.length;

    expect(layersAfter).toBe(layersBefore + 1);
    // Scene should be untouched
    const sceneLayers = state.doc.scenes[0].timeline.layers.length;
    expect(sceneLayers).toBe(layersBefore); // same count as symbol had before
  });

  it("editor_status reports symbol timeline layer/frame counts", async () => {
    const { symId } = enterSymbolEditMode();

    // Add a second layer to the symbol so its count differs from the scene
    await dispatchAgentCommand("timeline_add_layer", {});

    const status = await dispatchAgentCommand("editor_status", {}) as Record<string, unknown>;
    const symTimeline = (state.doc.library.items.find((i) => i.id === symId) as unknown as { timeline: { layers: unknown[] } })
      .timeline;
    expect(status["layerCount"]).toBe(symTimeline.layers.length);

    const editCtx = status["editContext"] as { mode: string; symbolId?: string };
    expect(editCtx.mode).toBe("symbol");
    expect(editCtx.symbolId).toBe(symId);
  });

  it("falls back to scene timeline when not in symbol-edit mode", async () => {
    // document mode (default)
    expect(state.editContext.mode).toBe("document");

    await dispatchAgentCommand("stage_add_shape", {
      kind: "rect", x1: 0, y1: 0, x2: 50, y2: 50,
    });

    const sceneCount = state.doc.scenes[0].timeline.layers[0].frames[0].displayObjects.length;
    expect(sceneCount).toBe(1);
  });
});
