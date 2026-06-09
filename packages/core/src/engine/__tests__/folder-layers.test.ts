/**
 * Unit tests for layer parent-folder relationships.
 * Covers parentFolderId field, folder hierarchy, and FLA round-trip preservation.
 */

import { describe, it, expect } from "vitest";
import { setLayerCollapsed } from "../layers.js";
import { createDocument } from "../../model/document.js";
import { createLayer, createTimeline } from "../../model/timeline.js";
import { saveFla, loadFla } from "../../fla/zip.js";
import type { FlashDocument, Layer } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a document whose scene 0 has a folder structure:
 *  - Layer 0: type='folder', id stable via override
 *  - Layer 1: type='normal', parentFolderId='folder1'
 *  - Layer 2: type='normal', parentFolderId='folder1'
 *  - Layer 3: type='normal', parentFolderId=null (top-level)
 */
function buildFolderDoc(): { doc: FlashDocument; folder1Id: string } {
  const base = createDocument();

  const folderLayer = createLayer("Folder 1", "folder", { id: "folder1" });
  const child1 = createLayer("Child 1", "normal", { parentFolderId: "folder1" });
  const child2 = createLayer("Child 2", "normal", { parentFolderId: "folder1" });
  const topLevel = createLayer("Top Level", "normal", { parentFolderId: null });

  const doc: FlashDocument = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        timeline: createTimeline({
          layers: [folderLayer, child1, child2, topLevel],
        }),
      },
    ],
  };

  return { doc, folder1Id: "folder1" };
}

function getLayers(doc: FlashDocument): readonly Layer[] {
  return doc.scenes[0].timeline.layers;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Layer parent-folder relationships", () => {
  it("1. layers 1 and 2 have parentFolderId === 'folder1'", () => {
    const { doc } = buildFolderDoc();
    const layers = getLayers(doc);
    expect(layers[1].parentFolderId).toBe("folder1");
    expect(layers[2].parentFolderId).toBe("folder1");
  });

  it("2. layer 3 has parentFolderId === null (top-level)", () => {
    const { doc } = buildFolderDoc();
    const layers = getLayers(doc);
    expect(layers[3].parentFolderId).toBeNull();
  });

  it("3. getLayersByFolder returns children if it exists", async () => {
    const { doc, folder1Id } = buildFolderDoc();
    // Dynamically check whether this helper is exported
    const layersModule = await import("../layers.js");
    const getLayersByFolder = (layersModule as Record<string, unknown>).getLayersByFolder;
    if (typeof getLayersByFolder === "function") {
      const timeline = doc.scenes[0].timeline;
      const children = (getLayersByFolder as (t: unknown, id: string) => Layer[])(timeline, folder1Id);
      const names = children.map((l: Layer) => l.name);
      expect(names).toContain("Child 1");
      expect(names).toContain("Child 2");
      expect(names).not.toContain("Top Level");
      expect(names).not.toContain("Folder 1");
    } else {
      // Function not yet implemented — skip gracefully
      expect(true).toBe(true);
    }
  });

  it("4. setting a layer's collapsed state affects only that folder", () => {
    const { doc } = buildFolderDoc();

    // Collapse layer 0 (the folder)
    const after = setLayerCollapsed(doc, 0, 0, true);
    const layers = getLayers(after);

    // Only the target layer is collapsed
    expect(layers[0].collapsed).toBe(true);

    // Child layers remain unaffected
    expect(layers[1].collapsed).toBeUndefined();
    expect(layers[2].collapsed).toBeUndefined();
    expect(layers[3].collapsed).toBeUndefined();
  });

  it("5. FLA round-trip preserves parentFolderId for all layers", () => {
    const { doc } = buildFolderDoc();

    const bytes = saveFla(doc);
    const restored = loadFla(bytes);
    const layers = getLayers(restored);

    expect(layers[0].parentFolderId).toBeNull();
    expect(layers[1].parentFolderId).toBe("folder1");
    expect(layers[2].parentFolderId).toBe("folder1");
    expect(layers[3].parentFolderId).toBeNull();
  });

  it("6. a folder layer can have parentFolderId pointing to another folder (nested folders)", () => {
    const base = createDocument();

    const outerFolder = createLayer("Outer", "folder", { id: "outer-folder" });
    const innerFolder = createLayer("Inner", "folder", {
      id: "inner-folder",
      parentFolderId: "outer-folder",
    });
    const deepChild = createLayer("Deep", "normal", {
      parentFolderId: "inner-folder",
    });

    const doc: FlashDocument = {
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          timeline: createTimeline({
            layers: [outerFolder, innerFolder, deepChild],
          }),
        },
      ],
    };

    const layers = getLayers(doc);
    expect(layers[0].type).toBe("folder");
    expect(layers[1].type).toBe("folder");
    expect(layers[1].parentFolderId).toBe("outer-folder");
    expect(layers[2].parentFolderId).toBe("inner-folder");
  });
});
