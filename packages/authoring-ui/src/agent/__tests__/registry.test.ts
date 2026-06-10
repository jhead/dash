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
import { createDocument } from "@flash/core";
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

    runJSFL: (_source: string) => ({
      traces: ["jsfl-ran"],
      returnValue: undefined,
      error: undefined,
      rev: getRev(),
    }),
    screenshotStage: (_frameIndex?: number) => "fake-png-base64",
    publishToBytes: () => new Uint8Array([0x46, 0x57, 0x53, 0x08]),
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
    const placed = objs.find((o) => o.type === "video") as Record<string, unknown>;
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

  it("script_set returns diagnostics for broken script (non-blocking)", async () => {
    const layerId = state.doc.scenes[0].timeline.layers[0].id;
    const result = await dispatchAgentCommand("script_set", {
      layerId,
      frameIndex: 0,
      script: "function broken( {",
    }) as Record<string, unknown>;
    // Write should succeed
    expect(result["ok"]).toBe(true);
    // Diagnostics should be non-empty for broken script
    const diag = result["diagnostics"] as unknown[];
    expect(diag.length).toBeGreaterThan(0);
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
