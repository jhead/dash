import { describe, it, expect } from "vitest";
import {
  addScene,
  removeScene,
  renameScene,
  duplicateScene,
  moveScene,
} from "../document-mutations.js";
import { createDocument } from "../document.js";

function makeDoc() {
  return createDocument();
}

// ---------------------------------------------------------------------------
// addScene
// ---------------------------------------------------------------------------

describe("addScene", () => {
  it("appends new scene with given name", () => {
    const doc = makeDoc();
    const result = addScene(doc, "Act 2");
    expect(result.scenes[result.scenes.length - 1]!.name).toBe("Act 2");
  });

  it("creates unique id for the new scene", () => {
    const doc = makeDoc();
    const result = addScene(doc, "New");
    const existingIds = doc.scenes.map((s) => s.id);
    const newId = result.scenes[result.scenes.length - 1]!.id;
    expect(existingIds).not.toContain(newId);
  });

  it("returns a new doc reference (immutable)", () => {
    const doc = makeDoc();
    const result = addScene(doc, "X");
    expect(result).not.toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// removeScene
// ---------------------------------------------------------------------------

describe("removeScene", () => {
  it("removes a scene by id", () => {
    const doc = addScene(makeDoc(), "Scene B");
    const target = doc.scenes[1]!;
    const result = removeScene(doc, target.id);
    expect(result.scenes.find((s) => s.id === target.id)).toBeUndefined();
  });

  it("is no-op when only 1 scene remains", () => {
    const doc = makeDoc();
    const only = doc.scenes[0]!;
    const result = removeScene(doc, only.id);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.id).toBe(only.id);
  });

  it("returns a new doc reference (immutable)", () => {
    const doc = addScene(makeDoc(), "B");
    const target = doc.scenes[1]!;
    const result = removeScene(doc, target.id);
    expect(result).not.toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// renameScene
// ---------------------------------------------------------------------------

describe("renameScene", () => {
  it("changes scene name", () => {
    const doc = makeDoc();
    const scene = doc.scenes[0]!;
    const result = renameScene(doc, scene.id, "Renamed");
    expect(result.scenes[0]!.name).toBe("Renamed");
  });

  it("preserves timeline after rename", () => {
    const doc = makeDoc();
    const scene = doc.scenes[0]!;
    const result = renameScene(doc, scene.id, "New Name");
    expect(result.scenes[0]!.timeline).toBe(scene.timeline);
  });

  it("returns a new doc reference (immutable)", () => {
    const doc = makeDoc();
    const result = renameScene(doc, doc.scenes[0]!.id, "Z");
    expect(result).not.toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// duplicateScene
// ---------------------------------------------------------------------------

describe("duplicateScene", () => {
  it("copies timeline and gives new id", () => {
    const doc = makeDoc();
    const original = doc.scenes[0]!;
    const result = duplicateScene(doc, original.id);
    const copy = result.scenes.find((s) => s.id !== original.id)!;
    expect(copy).toBeDefined();
    expect(copy.id).not.toBe(original.id);
    // timeline is a deep copy, not same reference
    expect(copy.timeline).not.toBe(original.timeline);
  });

  it("inserts copy after the original", () => {
    const doc = addScene(makeDoc(), "B");
    const original = doc.scenes[0]!;
    const result = duplicateScene(doc, original.id);
    const origIdx = result.scenes.findIndex((s) => s.id === original.id);
    const copyIdx = result.scenes.findIndex(
      (s) => s.id !== original.id && s.name === `${original.name} copy`
    );
    expect(copyIdx).toBe(origIdx + 1);
  });

  it("returns a new doc reference (immutable)", () => {
    const doc = makeDoc();
    const result = duplicateScene(doc, doc.scenes[0]!.id);
    expect(result).not.toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// moveScene
// ---------------------------------------------------------------------------

describe("moveScene", () => {
  it("changes scene order", () => {
    const doc = addScene(addScene(makeDoc(), "B"), "C");
    const first = doc.scenes[0]!;
    const result = moveScene(doc, first.id, 2);
    expect(result.scenes[2]!.id).toBe(first.id);
  });

  it("is a no-op when scene id is not found", () => {
    const doc = makeDoc();
    const result = moveScene(doc, "no-such-id", 0);
    expect(result).toBe(doc);
  });

  it("returns a new doc reference (immutable)", () => {
    const doc = addScene(makeDoc(), "B");
    const result = moveScene(doc, doc.scenes[0]!.id, 1);
    expect(result).not.toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// All operations return new doc (immutability summary)
// ---------------------------------------------------------------------------

describe("immutability", () => {
  it("all operations return new doc references", () => {
    const doc = addScene(makeDoc(), "B");
    expect(addScene(doc, "C")).not.toBe(doc);
    expect(removeScene(doc, doc.scenes[1]!.id)).not.toBe(doc);
    expect(renameScene(doc, doc.scenes[0]!.id, "X")).not.toBe(doc);
    expect(duplicateScene(doc, doc.scenes[0]!.id)).not.toBe(doc);
    expect(moveScene(doc, doc.scenes[0]!.id, 1)).not.toBe(doc);
  });
});
