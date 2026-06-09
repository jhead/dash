import { describe, it, expect } from "vitest";
import type { Timeline } from "../types.js";
import {
  getLayersInFolder,
  getTopLevelLayers,
  setFolderCollapsed,
  getLayerDepth,
} from "../layer-folder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTimeline(): Timeline {
  return {
    layers: [
      {
        id: "folder1",
        name: "Folder",
        type: "folder" as const,
        visible: true,
        locked: false,
        outlineMode: false,
        outlineColor: "#f00",
        height: 20,
        parentFolderId: null,
        frameCount: 1,
        frames: [],
      },
      {
        id: "child1",
        name: "Child 1",
        type: "normal" as const,
        visible: true,
        locked: false,
        outlineMode: false,
        outlineColor: "#0f0",
        height: 20,
        parentFolderId: "folder1",
        frameCount: 1,
        frames: [],
      },
      {
        id: "child2",
        name: "Child 2",
        type: "normal" as const,
        visible: true,
        locked: false,
        outlineMode: false,
        outlineColor: "#00f",
        height: 20,
        parentFolderId: "folder1",
        frameCount: 1,
        frames: [],
      },
      {
        id: "toplevel",
        name: "Top",
        type: "normal" as const,
        visible: true,
        locked: false,
        outlineMode: false,
        outlineColor: "#f0f",
        height: 20,
        parentFolderId: null,
        frameCount: 1,
        frames: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// getLayersInFolder
// ---------------------------------------------------------------------------

describe("getLayersInFolder", () => {
  it("returns layers with matching parentFolderId", () => {
    const tl = makeTimeline();
    const result = getLayersInFolder(tl, "folder1");
    expect(result.map((l) => l.id)).toEqual(["child1", "child2"]);
  });

  it("returns empty array for unknown folder id", () => {
    const tl = makeTimeline();
    expect(getLayersInFolder(tl, "nonexistent")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getTopLevelLayers
// ---------------------------------------------------------------------------

describe("getTopLevelLayers", () => {
  it("returns layers with parentFolderId === null", () => {
    const tl = makeTimeline();
    const result = getTopLevelLayers(tl);
    expect(result.map((l) => l.id)).toEqual(["folder1", "toplevel"]);
  });
});

// ---------------------------------------------------------------------------
// setFolderCollapsed
// ---------------------------------------------------------------------------

describe("setFolderCollapsed", () => {
  it("sets collapsed=true on folder layer", () => {
    const tl = makeTimeline();
    const updated = setFolderCollapsed(tl, "folder1", true);
    const folder = updated.layers.find((l) => l.id === "folder1");
    expect(folder?.collapsed).toBe(true);
  });

  it("sets collapsed=false on folder layer", () => {
    const tl = makeTimeline();
    // First collapse it
    const collapsed = setFolderCollapsed(tl, "folder1", true);
    // Then expand it
    const expanded = setFolderCollapsed(collapsed, "folder1", false);
    const folder = expanded.layers.find((l) => l.id === "folder1");
    expect(folder?.collapsed).toBe(false);
  });

  it("is a no-op for a non-folder layer", () => {
    const tl = makeTimeline();
    const updated = setFolderCollapsed(tl, "child1", true);
    const child = updated.layers.find((l) => l.id === "child1");
    // collapsed should not be set since child1 is type 'normal'
    expect(child?.collapsed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getLayerDepth
// ---------------------------------------------------------------------------

describe("getLayerDepth", () => {
  it("returns 0 for a top-level layer", () => {
    const tl = makeTimeline();
    expect(getLayerDepth(tl, "toplevel")).toBe(0);
  });

  it("returns 0 for a top-level folder", () => {
    const tl = makeTimeline();
    expect(getLayerDepth(tl, "folder1")).toBe(0);
  });

  it("returns 1 for an immediate child of a folder", () => {
    const tl = makeTimeline();
    expect(getLayerDepth(tl, "child1")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("immutability", () => {
  it("does not mutate the original timeline", () => {
    const tl = makeTimeline();
    const originalLayers = tl.layers;
    setFolderCollapsed(tl, "folder1", true);
    expect(tl.layers).toBe(originalLayers);
    expect(tl.layers.find((l) => l.id === "folder1")?.collapsed).toBeUndefined();
  });
});
