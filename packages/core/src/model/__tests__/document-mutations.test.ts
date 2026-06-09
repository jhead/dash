import { describe, it, expect } from "vitest";
import {
  addScene,
  removeScene,
  renameScene,
  reorderScenes,
  duplicateScene,
} from "../document-mutations.js";
import { createDocument } from "../document.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc() {
  return createDocument();
}

// ---------------------------------------------------------------------------
// addScene
// ---------------------------------------------------------------------------

describe("addScene", () => {
  it("adds a scene, increasing scene count by 1", () => {
    const doc = makeDoc();
    const updated = addScene(doc);
    expect(updated.scenes).toHaveLength(doc.scenes.length + 1);
  });

  it("adds a scene with a unique id different from existing scenes", () => {
    const doc = makeDoc();
    const updated = addScene(doc);
    const existingIds = doc.scenes.map((s) => s.id);
    const newScene = updated.scenes[updated.scenes.length - 1]!;
    expect(existingIds).not.toContain(newScene.id);
  });

  it("new scene has a timeline with at least one layer", () => {
    const doc = makeDoc();
    const updated = addScene(doc);
    const newScene = updated.scenes[updated.scenes.length - 1]!;
    expect(newScene.timeline.layers.length).toBeGreaterThanOrEqual(1);
  });

  it("new scene has a layer with a keyframe at index 0", () => {
    const doc = makeDoc();
    const updated = addScene(doc);
    const newScene = updated.scenes[updated.scenes.length - 1]!;
    const layer = newScene.timeline.layers[0]!;
    const frame0 = layer.frames.find((f) => f.index === 0 && f.isKeyframe);
    expect(frame0).toBeDefined();
  });

  it("uses provided name for the new scene", () => {
    const doc = makeDoc();
    const updated = addScene(doc, "My Custom Scene");
    const newScene = updated.scenes[updated.scenes.length - 1]!;
    expect(newScene.name).toBe("My Custom Scene");
  });

  it("generates a default name when no name provided", () => {
    const doc = makeDoc();
    const updated = addScene(doc);
    const newScene = updated.scenes[updated.scenes.length - 1]!;
    expect(newScene.name).toBeTruthy();
    expect(newScene.name.length).toBeGreaterThan(0);
  });

  it("appends the new scene at the end", () => {
    const doc = makeDoc();
    const updated = addScene(doc, "Last Scene");
    expect(updated.scenes[updated.scenes.length - 1]!.name).toBe("Last Scene");
  });
});

// ---------------------------------------------------------------------------
// removeScene
// ---------------------------------------------------------------------------

describe("removeScene", () => {
  it("removes the specified scene by id", () => {
    const doc = makeDoc();
    const docWithTwo = addScene(doc, "Scene 2");
    const sceneToRemove = docWithTwo.scenes[1]!;
    const result = removeScene(docWithTwo, sceneToRemove.id);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes.find((s) => s.id === sceneToRemove.id)).toBeUndefined();
  });

  it("does not remove the last scene (no-op)", () => {
    const doc = makeDoc(); // one scene
    const originalScene = doc.scenes[0]!;
    const result = removeScene(doc, originalScene.id);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.id).toBe(originalScene.id);
  });

  it("is a no-op when the scene id is not found", () => {
    const doc = makeDoc();
    const docWithTwo = addScene(doc);
    const result = removeScene(docWithTwo, "non-existent-id");
    expect(result.scenes).toHaveLength(2);
  });

  it("preserves remaining scenes after removal", () => {
    const doc = makeDoc();
    const docWithThree = addScene(addScene(doc, "Scene 2"), "Scene 3");
    const sceneToRemove = docWithThree.scenes[1]!;
    const result = removeScene(docWithThree, sceneToRemove.id);
    expect(result.scenes).toHaveLength(2);
    const remainingNames = result.scenes.map((s) => s.name);
    expect(remainingNames).not.toContain(sceneToRemove.name);
  });
});

// ---------------------------------------------------------------------------
// renameScene
// ---------------------------------------------------------------------------

describe("renameScene", () => {
  it("updates the scene name", () => {
    const doc = makeDoc();
    const scene = doc.scenes[0]!;
    const result = renameScene(doc, scene.id, "Renamed Scene");
    expect(result.scenes[0]!.name).toBe("Renamed Scene");
  });

  it("does not change other scene properties when renaming", () => {
    const doc = makeDoc();
    const scene = doc.scenes[0]!;
    const result = renameScene(doc, scene.id, "New Name");
    const renamed = result.scenes[0]!;
    expect(renamed.id).toBe(scene.id);
    expect(renamed.timeline).toBe(scene.timeline); // same reference
  });

  it("is a no-op when scene id is not found", () => {
    const doc = makeDoc();
    const result = renameScene(doc, "non-existent-id", "Ghost Name");
    expect(result.scenes[0]!.name).toBe(doc.scenes[0]!.name);
  });

  it("can rename a scene to an empty string", () => {
    const doc = makeDoc();
    const scene = doc.scenes[0]!;
    const result = renameScene(doc, scene.id, "");
    expect(result.scenes[0]!.name).toBe("");
  });
});

// ---------------------------------------------------------------------------
// reorderScenes
// ---------------------------------------------------------------------------

describe("reorderScenes", () => {
  it("moves a scene to a new index", () => {
    const doc = addScene(addScene(makeDoc(), "Scene 2"), "Scene 3");
    // doc.scenes = [Scene 1, Scene 2, Scene 3]
    const result = reorderScenes(doc, 0, 2);
    expect(result.scenes[2]!.name).toBe(doc.scenes[0]!.name);
  });

  it("moves a scene to index 0 (front)", () => {
    const doc = addScene(addScene(makeDoc(), "Scene 2"), "Scene 3");
    const lastScene = doc.scenes[2]!;
    const result = reorderScenes(doc, 2, 0);
    expect(result.scenes[0]!.id).toBe(lastScene.id);
  });

  it("is a no-op when fromIndex equals toIndex", () => {
    const doc = addScene(makeDoc(), "Scene 2");
    const result = reorderScenes(doc, 0, 0);
    expect(result).toBe(doc);
  });

  it("preserves all scenes — count stays the same", () => {
    const doc = addScene(addScene(makeDoc(), "Scene 2"), "Scene 3");
    const result = reorderScenes(doc, 0, 2);
    expect(result.scenes).toHaveLength(3);
  });

  it("is immutable — original doc is unchanged", () => {
    const doc = addScene(makeDoc(), "Scene 2");
    const originalOrder = doc.scenes.map((s) => s.id);
    reorderScenes(doc, 0, 1);
    expect(doc.scenes.map((s) => s.id)).toEqual(originalOrder);
  });

  it("clamps out-of-bounds toIndex to last position", () => {
    const doc = addScene(makeDoc(), "Scene 2");
    const firstScene = doc.scenes[0]!;
    const result = reorderScenes(doc, 0, 999);
    expect(result.scenes[result.scenes.length - 1]!.id).toBe(firstScene.id);
  });
});

// ---------------------------------------------------------------------------
// duplicateScene
// ---------------------------------------------------------------------------

describe("duplicateScene", () => {
  it("creates a copy with a new id", () => {
    const doc = makeDoc();
    const original = doc.scenes[0]!;
    const result = duplicateScene(doc, original.id);
    const copy = result.scenes.find((s) => s.id !== original.id);
    expect(copy).toBeDefined();
    expect(copy!.id).not.toBe(original.id);
  });

  it("names the copy with a ' copy' suffix", () => {
    const doc = makeDoc();
    const original = doc.scenes[0]!;
    const result = duplicateScene(doc, original.id);
    const copy = result.scenes.find((s) => s.id !== original.id)!;
    expect(copy.name).toBe(`${original.name} copy`);
  });

  it("increases scene count by 1", () => {
    const doc = makeDoc();
    const result = duplicateScene(doc, doc.scenes[0]!.id);
    expect(result.scenes).toHaveLength(doc.scenes.length + 1);
  });

  it("is a no-op when scene id is not found", () => {
    const doc = makeDoc();
    const result = duplicateScene(doc, "nonexistent-id");
    expect(result).toBe(doc);
  });

  it("is immutable — original doc is unchanged", () => {
    const doc = makeDoc();
    const originalCount = doc.scenes.length;
    duplicateScene(doc, doc.scenes[0]!.id);
    expect(doc.scenes).toHaveLength(originalCount);
  });

  it("all operations return new doc references (immutable)", () => {
    const doc = makeDoc();
    const resultAdd = addScene(doc);
    const resultRemove = removeScene(addScene(doc), addScene(doc).scenes[1]!.id);
    const resultRename = renameScene(doc, doc.scenes[0]!.id, "X");
    const resultDuplicate = duplicateScene(doc, doc.scenes[0]!.id);
    expect(resultAdd).not.toBe(doc);
    expect(resultRemove).not.toBe(doc);
    expect(resultRename).not.toBe(doc);
    expect(resultDuplicate).not.toBe(doc);
  });
});
