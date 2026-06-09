/**
 * Advanced CRUD tests for engine/layers.ts.
 * Covers: insert at specific index, folder cascade deletion, rename
 * preserving other properties, reorder (moveUp/moveDown via reorderLayer),
 * and setLayerCollapsed.
 */

import { describe, it, expect } from "vitest";
import {
  addLayer,
  deleteLayer,
  reorderLayer,
  renameLayer,
  setLayerCollapsed,
} from "../layers.js";
import { createDocument } from "../../model/document.js";
import { createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument, Layer } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(...layerNames: string[]): FlashDocument {
  const layers =
    layerNames.length > 0
      ? layerNames.map((name) => createLayer(name))
      : [createLayer("Layer 1")];
  const doc = createDocument();
  return {
    ...doc,
    scenes: [
      {
        ...doc.scenes[0],
        timeline: createTimeline({ layers }),
      },
    ],
  };
}

function getLayers(doc: FlashDocument): readonly Layer[] {
  return doc.scenes[0].timeline.layers;
}

function getLayer(doc: FlashDocument, idx: number): Layer {
  return getLayers(doc)[idx];
}

/** Build a doc that has a folder layer at index 0 and two child layers at 1, 2. */
function makeDocWithFolder(): FlashDocument {
  const folder = createLayer("Folder", "folder");
  const child1 = createLayer("Child 1", "normal", { parentFolderId: folder.id });
  const child2 = createLayer("Child 2", "normal", { parentFolderId: folder.id });
  const other = createLayer("Other", "normal");
  const doc = createDocument();
  return {
    ...doc,
    scenes: [
      {
        ...doc.scenes[0],
        timeline: createTimeline({ layers: [folder, child1, child2, other] }),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. addLayer — insert at specific index
// ---------------------------------------------------------------------------

describe("addLayer — insert at specific index", () => {
  it("inserts between layer 0 and layer 1 when afterLayerIdx=0", () => {
    const doc = makeDoc("A", "B");
    // afterLayerIdx=0 means insert AFTER index 0, so new layer lands at index 1
    const result = addLayer(doc, 0, 0, "normal", "New");
    const ls = getLayers(result);
    expect(ls).toHaveLength(3);
    expect(ls[0].name).toBe("A");
    expect(ls[1].name).toBe("New");
    expect(ls[2].name).toBe("B");
  });

  it("pushes original layer 1 to index 2 after insertion", () => {
    const doc = makeDoc("First", "Second");
    const secondId = getLayer(doc, 1).id;
    const result = addLayer(doc, 0, 0, "normal", "Middle");
    expect(getLayer(result, 2).id).toBe(secondId);
  });

  it("inserts at the beginning when afterLayerIdx is negative — clamps to 0", () => {
    const doc = makeDoc("A", "B");
    // afterLayerIdx=-1 → insertAt = max(0, -1+1) = 0 (prepend)
    const result = addLayer(doc, 0, -1, "normal", "First");
    const ls = getLayers(result);
    expect(ls[0].name).toBe("First");
    expect(ls[1].name).toBe("A");
    expect(ls[2].name).toBe("B");
  });

  it("inserts at the end when afterLayerIdx equals last index", () => {
    const doc = makeDoc("A", "B");
    const result = addLayer(doc, 0, 1, "normal", "Last");
    const ls = getLayers(result);
    expect(ls).toHaveLength(3);
    expect(ls[2].name).toBe("Last");
  });

  it("new layer inserted mid-list has correct default properties", () => {
    const doc = makeDoc("A", "B");
    const result = addLayer(doc, 0, 0, "guide", "GuideLayer");
    const inserted = getLayer(result, 1);
    expect(inserted.type).toBe("guide");
    expect(inserted.visible).toBe(true);
    expect(inserted.locked).toBe(false);
    expect(inserted.outlineMode).toBe(false);
    expect(inserted.parentFolderId).toBeNull();
    expect(inserted.frames).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. deleteLayer — folder and children
// ---------------------------------------------------------------------------

describe("deleteLayer — folder layer behaviour", () => {
  it("removes a folder layer without automatically removing its children", () => {
    // deleteLayer does NOT cascade — it is a simple filter by index.
    // After folder deletion, children retain their parentFolderId (now orphaned).
    const doc = makeDocWithFolder();
    const folderId = getLayer(doc, 0).id;

    const result = deleteLayer(doc, 0, 0); // delete the folder
    const ls = getLayers(result);

    // folder gone, children (and Other) remain
    expect(ls).toHaveLength(3);
    expect(ls.find((l) => l.id === folderId)).toBeUndefined();
    // children still reference the (now-deleted) folder id
    expect(ls[0].parentFolderId).toBe(folderId);
    expect(ls[1].parentFolderId).toBe(folderId);
  });

  it("deletes a child layer leaving folder and sibling intact", () => {
    const doc = makeDocWithFolder();
    const folderId = getLayer(doc, 0).id;
    const child1Id = getLayer(doc, 1).id;

    const result = deleteLayer(doc, 0, 1); // delete Child 1
    const ls = getLayers(result);

    expect(ls).toHaveLength(3);
    expect(ls.find((l) => l.id === child1Id)).toBeUndefined();
    // folder still present
    expect(ls[0].id).toBe(folderId);
    // Child 2 still present with correct parentFolderId
    expect(ls[1].parentFolderId).toBe(folderId);
  });

  it("does not remove last layer even if it is a folder", () => {
    const folder = createLayer("Folder", "folder");
    const doc = createDocument();
    const docWithOneFolder: FlashDocument = {
      ...doc,
      scenes: [
        {
          ...doc.scenes[0],
          timeline: createTimeline({ layers: [folder] }),
        },
      ],
    };
    const result = deleteLayer(docWithOneFolder, 0, 0);
    expect(result).toBe(docWithOneFolder);
  });
});

// ---------------------------------------------------------------------------
// 3. renameLayer — name changes, other properties unchanged
// ---------------------------------------------------------------------------

describe("renameLayer — preserves other properties", () => {
  it("updates only the name field", () => {
    const doc = makeDoc("OldName");
    const original = getLayer(doc, 0);
    const result = renameLayer(doc, 0, 0, "NewName");
    const updated = getLayer(result, 0);

    expect(updated.name).toBe("NewName");
    // All other properties must be identical
    expect(updated.id).toBe(original.id);
    expect(updated.type).toBe(original.type);
    expect(updated.visible).toBe(original.visible);
    expect(updated.locked).toBe(original.locked);
    expect(updated.outlineMode).toBe(original.outlineMode);
    expect(updated.outlineColor).toBe(original.outlineColor);
    expect(updated.height).toBe(original.height);
    expect(updated.parentFolderId).toBe(original.parentFolderId);
    expect(updated.frameCount).toBe(original.frameCount);
    expect(updated.frames).toBe(original.frames); // same reference
  });

  it("does not affect sibling layers", () => {
    const doc = makeDoc("A", "B", "C");
    const result = renameLayer(doc, 0, 1, "Renamed");
    expect(getLayer(result, 0).name).toBe("A");
    expect(getLayer(result, 2).name).toBe("C");
  });

  it("allows renaming to an empty string", () => {
    const doc = makeDoc("Layer 1");
    const result = renameLayer(doc, 0, 0, "");
    expect(getLayer(result, 0).name).toBe("");
  });

  it("is a no-op for out-of-range index", () => {
    const doc = makeDoc("Layer 1");
    const result = renameLayer(doc, 0, 5, "Ghost");
    expect(result).toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// 4. reorderLayer — moveUp / moveDown equivalent
// ---------------------------------------------------------------------------

describe("reorderLayer — move up / move down", () => {
  it("moves a layer up (decreases index)", () => {
    // "move up" = decrease index (closer to 0)
    const doc = makeDoc("A", "B", "C");
    const bId = getLayer(doc, 1).id;
    const result = reorderLayer(doc, 0, 1, 0); // move B from 1 to 0
    expect(getLayers(result).map((l) => l.name)).toEqual(["B", "A", "C"]);
    expect(getLayer(result, 0).id).toBe(bId);
  });

  it("moves a layer down (increases index)", () => {
    const doc = makeDoc("A", "B", "C");
    const bId = getLayer(doc, 1).id;
    const result = reorderLayer(doc, 0, 1, 2); // move B from 1 to 2
    expect(getLayers(result).map((l) => l.name)).toEqual(["A", "C", "B"]);
    expect(getLayer(result, 2).id).toBe(bId);
  });

  it("is a no-op when already at position 0 and asked to go to 0", () => {
    const doc = makeDoc("A", "B", "C");
    const result = reorderLayer(doc, 0, 0, 0);
    expect(result).toBe(doc);
  });

  it("clamps: moving first layer further up returns same doc", () => {
    const doc = makeDoc("A", "B", "C");
    // toIdx -1 clamps to 0, fromIdx is already 0 → no-op
    const result = reorderLayer(doc, 0, 0, -1);
    expect(result).toBe(doc);
  });

  it("clamps: moving last layer further down returns same doc", () => {
    const doc = makeDoc("A", "B", "C");
    // toIdx 99 clamps to 2, fromIdx is already 2 → no-op
    const result = reorderLayer(doc, 0, 2, 99);
    expect(result).toBe(doc);
  });

  it("does not mutate source layers array", () => {
    const doc = makeDoc("A", "B", "C");
    const original = getLayers(doc);
    reorderLayer(doc, 0, 0, 2);
    expect(getLayers(doc)).toBe(original);
  });

  it("moves layer from first to last in a 4-layer doc", () => {
    const doc = makeDoc("A", "B", "C", "D");
    const result = reorderLayer(doc, 0, 0, 3);
    expect(getLayers(result).map((l) => l.name)).toEqual(["B", "C", "D", "A"]);
  });
});

// ---------------------------------------------------------------------------
// 5. setLayerCollapsed
// ---------------------------------------------------------------------------

describe("setLayerCollapsed", () => {
  it("sets collapsed=true on a folder layer", () => {
    const folder = createLayer("Folder", "folder");
    const doc = createDocument();
    const docWithFolder: FlashDocument = {
      ...doc,
      scenes: [
        {
          ...doc.scenes[0],
          timeline: createTimeline({ layers: [folder] }),
        },
      ],
    };
    const result = setLayerCollapsed(docWithFolder, 0, 0, true);
    expect((getLayer(result, 0) as any).collapsed).toBe(true);
  });

  it("sets collapsed=false after it was true", () => {
    const folder = createLayer("Folder", "folder");
    const doc = createDocument();
    const docWithFolder: FlashDocument = {
      ...doc,
      scenes: [
        {
          ...doc.scenes[0],
          timeline: createTimeline({ layers: [folder] }),
        },
      ],
    };
    const expanded = setLayerCollapsed(docWithFolder, 0, 0, true);
    const collapsed = setLayerCollapsed(expanded, 0, 0, false);
    expect((getLayer(collapsed, 0) as any).collapsed).toBe(false);
  });

  it("does not affect other layers", () => {
    const doc = makeDoc("A", "B");
    const result = setLayerCollapsed(doc, 0, 0, true);
    // Layer B at index 1 should not have collapsed set
    const layerB = getLayer(result, 1) as any;
    expect(layerB.collapsed).toBeUndefined();
  });

  it("is a no-op for out-of-range index", () => {
    const doc = makeDoc("Layer 1");
    const result = setLayerCollapsed(doc, 0, 99, true);
    expect(result).toBe(doc);
  });
});
