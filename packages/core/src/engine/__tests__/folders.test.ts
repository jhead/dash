/**
 * Unit tests for layer folder collapse/expand — setLayerCollapsed.
 */

import { describe, it, expect } from "vitest";
import { setLayerCollapsed } from "../layers.js";
import { createDocument } from "../../model/document.js";
import { createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a document with the provided layers in scene 0. */
function makeDoc(...layers: ReturnType<typeof createLayer>[]): FlashDocument {
  const doc = createDocument();
  return {
    ...doc,
    scenes: [
      {
        ...doc.scenes[0],
        timeline: createTimeline({ layers: layers.length > 0 ? layers : undefined }),
      },
    ],
  };
}

/** Return scene 0's layers array. */
function getLayers(doc: FlashDocument) {
  return doc.scenes[0].timeline.layers;
}

// ---------------------------------------------------------------------------
// setLayerCollapsed
// ---------------------------------------------------------------------------

describe("setLayerCollapsed", () => {
  it("1. sets collapsed=true on the target layer", () => {
    const folder = createLayer("Folder", "folder");
    const doc = makeDoc(folder);

    const result = setLayerCollapsed(doc, 0, 0, true);
    expect(getLayers(result)[0].collapsed).toBe(true);
  });

  it("2. sets collapsed=false on the target layer", () => {
    // Start with collapsed=true, then flip back to false
    const folder = createLayer("Folder", "folder");
    const doc = makeDoc(folder);
    const collapsed = setLayerCollapsed(doc, 0, 0, true);

    const result = setLayerCollapsed(collapsed, 0, 0, false);
    expect(getLayers(result)[0].collapsed).toBe(false);
  });

  it("3. out-of-range sceneIdx returns doc unchanged", () => {
    const folder = createLayer("Folder", "folder");
    const doc = makeDoc(folder);

    const result = setLayerCollapsed(doc, 99, 0, true);
    expect(result).toBe(doc);
  });

  it("3. out-of-range layerIdx returns doc unchanged", () => {
    const folder = createLayer("Folder", "folder");
    const doc = makeDoc(folder);

    const result = setLayerCollapsed(doc, 0, 99, true);
    expect(result).toBe(doc);
  });

  it("3. negative layerIdx returns doc unchanged", () => {
    const folder = createLayer("Folder", "folder");
    const doc = makeDoc(folder);

    const result = setLayerCollapsed(doc, 0, -1, true);
    expect(result).toBe(doc);
  });

  it("4. non-folder layers can also have collapsed set (UI may use it)", () => {
    const normal = createLayer("Layer 1", "normal");
    const guide = createLayer("Guide", "guide");
    const doc = makeDoc(normal, guide);

    const resultNormal = setLayerCollapsed(doc, 0, 0, true);
    const resultGuide = setLayerCollapsed(doc, 0, 1, true);

    expect(getLayers(resultNormal)[0].collapsed).toBe(true);
    expect(getLayers(resultGuide)[1].collapsed).toBe(true);
  });

  it("5. child layers (by parentFolderId) are still present after parent collapsed", () => {
    const folder = createLayer("Folder", "folder");
    const child1 = createLayer("Child 1", "normal", { parentFolderId: folder.id });
    const child2 = createLayer("Child 2", "normal", { parentFolderId: folder.id });
    const doc = makeDoc(folder, child1, child2);

    const result = setLayerCollapsed(doc, 0, 0, true);
    const layers = getLayers(result);

    // All three layers should still be present
    expect(layers).toHaveLength(3);
    // Children still have their parentFolderId
    expect(layers[1].parentFolderId).toBe(folder.id);
    expect(layers[2].parentFolderId).toBe(folder.id);
  });

  it("6. other layer properties are unchanged (name, type, visible, etc.)", () => {
    const folder = createLayer("MyFolder", "folder");
    const original = { ...folder };
    const doc = makeDoc(folder);

    const result = setLayerCollapsed(doc, 0, 0, true);
    const updated = getLayers(result)[0];

    expect(updated.name).toBe(original.name);
    expect(updated.type).toBe(original.type);
    expect(updated.visible).toBe(original.visible);
    expect(updated.locked).toBe(original.locked);
    expect(updated.outlineMode).toBe(original.outlineMode);
    expect(updated.outlineColor).toBe(original.outlineColor);
    expect(updated.height).toBe(original.height);
    expect(updated.parentFolderId).toBe(original.parentFolderId);
    expect(updated.frameCount).toBe(original.frameCount);
    expect(updated.frames).toEqual(original.frames);
    // Only collapsed changed
    expect(updated.collapsed).toBe(true);
  });

  it("7. immutability: original doc is unchanged after setLayerCollapsed", () => {
    const folder = createLayer("Folder", "folder");
    const doc = makeDoc(folder);
    const originalLayers = getLayers(doc);
    const originalCollapsed = originalLayers[0].collapsed;

    setLayerCollapsed(doc, 0, 0, true);

    // Original doc's layers reference must not change
    expect(getLayers(doc)).toBe(originalLayers);
    // Original layer's collapsed property must not change
    expect(getLayers(doc)[0].collapsed).toBe(originalCollapsed);
  });
});
