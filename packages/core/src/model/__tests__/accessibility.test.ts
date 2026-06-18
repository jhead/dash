/**
 * Model round-trip tests for accessibility fields (task 1202).
 *
 * Verifies that DocumentAccessibility and ObjectAccessibility fields
 * survive mutations on the document model — i.e., that:
 * - FlashDocument.accessibility can be set and read back
 * - updateDisplayObject persists ObjectAccessibility on SymbolInstance
 * - Spread-update patterns preserve all accessibility fields
 */

import { describe, it, expect } from "vitest";
import {
  createDocument,
  addDisplayObject,
  updateDisplayObject,
} from "../index.js";
import type {
  FlashDocument,
  DocumentAccessibility,
} from "../types.js";
import type {
  ObjectAccessibility,
  SymbolInstance,
} from "../../engine/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstanceObj(id: string): SymbolInstance {
  return {
    type: "instance",
    id,
    symbolId: "sym-1",
    x: 100,
    y: 100,
  };
}

// ---------------------------------------------------------------------------
// DocumentAccessibility round-trip
// ---------------------------------------------------------------------------

describe("DocumentAccessibility model round-trip", () => {
  it("FlashDocument starts with no accessibility field", () => {
    const doc = createDocument();
    expect(doc.accessibility).toBeUndefined();
  });

  it("spreading DocumentAccessibility onto FlashDocument persists all fields", () => {
    const base = createDocument();
    const acc: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: true,
      useCustomTabOrder: false,
    };
    const doc: FlashDocument = { ...base, accessibility: acc };
    expect(doc.accessibility?.enabled).toBe(true);
    expect(doc.accessibility?.makeChildrenAccessible).toBe(true);
    expect(doc.accessibility?.useCustomTabOrder).toBe(false);
  });

  it("toggling enabled via spread preserves other fields", () => {
    const acc: DocumentAccessibility = {
      enabled: false,
      makeChildrenAccessible: true,
      useCustomTabOrder: true,
    };
    const toggled: DocumentAccessibility = { ...acc, enabled: true };
    expect(toggled.enabled).toBe(true);
    expect(toggled.makeChildrenAccessible).toBe(true);
    expect(toggled.useCustomTabOrder).toBe(true);
  });

  it("toggling makeChildrenAccessible via spread preserves other fields", () => {
    const acc: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: true,
      useCustomTabOrder: false,
    };
    const toggled: DocumentAccessibility = { ...acc, makeChildrenAccessible: false };
    expect(toggled.enabled).toBe(true);
    expect(toggled.makeChildrenAccessible).toBe(false);
    expect(toggled.useCustomTabOrder).toBe(false);
  });

  it("toggling useCustomTabOrder via spread preserves other fields", () => {
    const acc: DocumentAccessibility = {
      enabled: true,
      makeChildrenAccessible: false,
      useCustomTabOrder: false,
    };
    const toggled: DocumentAccessibility = { ...acc, useCustomTabOrder: true };
    expect(toggled.enabled).toBe(true);
    expect(toggled.makeChildrenAccessible).toBe(false);
    expect(toggled.useCustomTabOrder).toBe(true);
  });

  it("replacing DocumentAccessibility with a new object updates all fields", () => {
    const base = createDocument();
    const acc1: DocumentAccessibility = { enabled: true, makeChildrenAccessible: true, useCustomTabOrder: false };
    const doc1: FlashDocument = { ...base, accessibility: acc1 };
    const acc2: DocumentAccessibility = { enabled: false, makeChildrenAccessible: false, useCustomTabOrder: true };
    const doc2: FlashDocument = { ...doc1, accessibility: acc2 };
    expect(doc2.accessibility?.enabled).toBe(false);
    expect(doc2.accessibility?.makeChildrenAccessible).toBe(false);
    expect(doc2.accessibility?.useCustomTabOrder).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ObjectAccessibility round-trip via updateDisplayObject
// ---------------------------------------------------------------------------

describe("ObjectAccessibility model round-trip via updateDisplayObject", () => {
  function setupTimelineWithInstance() {
    const doc = createDocument();
    const scene = doc.scenes[0];
    const layer = scene.timeline.layers[0];
    const inst = makeInstanceObj("inst-1");
    // addDisplayObject adds to the governing keyframe at frameIndex 0
    const tl = addDisplayObject(scene.timeline, layer.id, 0, inst);
    return { tl, layer, inst };
  }

  it("updateDisplayObject persists ObjectAccessibility.name on SymbolInstance", () => {
    const { tl, layer, inst } = setupTimelineWithInstance();
    const acc: ObjectAccessibility = { enabled: true, name: "Play Button" };
    const updated = updateDisplayObject(tl, layer.id, 0, inst.id, { accessibility: acc });
    const frame = updated.layers[0].frames[0];
    const obj = frame.displayObjects.find((o) => o.id === inst.id) as SymbolInstance;
    expect(obj.accessibility?.name).toBe("Play Button");
    expect(obj.accessibility?.enabled).toBe(true);
  });

  it("updateDisplayObject persists ObjectAccessibility.description", () => {
    const { tl, layer, inst } = setupTimelineWithInstance();
    const acc: ObjectAccessibility = { enabled: true, description: "Plays the animation" };
    const updated = updateDisplayObject(tl, layer.id, 0, inst.id, { accessibility: acc });
    const frame = updated.layers[0].frames[0];
    const obj = frame.displayObjects.find((o) => o.id === inst.id) as SymbolInstance;
    expect(obj.accessibility?.description).toBe("Plays the animation");
  });

  it("updateDisplayObject persists ObjectAccessibility.shortcut", () => {
    const { tl, layer, inst } = setupTimelineWithInstance();
    const acc: ObjectAccessibility = { enabled: true, shortcut: "Space" };
    const updated = updateDisplayObject(tl, layer.id, 0, inst.id, { accessibility: acc });
    const frame = updated.layers[0].frames[0];
    const obj = frame.displayObjects.find((o) => o.id === inst.id) as SymbolInstance;
    expect(obj.accessibility?.shortcut).toBe("Space");
  });

  it("updateDisplayObject persists ObjectAccessibility.tabIndex", () => {
    const { tl, layer, inst } = setupTimelineWithInstance();
    const acc: ObjectAccessibility = { enabled: true, tabIndex: 5 };
    const updated = updateDisplayObject(tl, layer.id, 0, inst.id, { accessibility: acc });
    const frame = updated.layers[0].frames[0];
    const obj = frame.displayObjects.find((o) => o.id === inst.id) as SymbolInstance;
    expect(obj.accessibility?.tabIndex).toBe(5);
  });

  it("updateDisplayObject persists ObjectAccessibility.forceSimple", () => {
    const { tl, layer, inst } = setupTimelineWithInstance();
    const acc: ObjectAccessibility = { enabled: true, forceSimple: true };
    const updated = updateDisplayObject(tl, layer.id, 0, inst.id, { accessibility: acc });
    const frame = updated.layers[0].frames[0];
    const obj = frame.displayObjects.find((o) => o.id === inst.id) as SymbolInstance;
    expect(obj.accessibility?.forceSimple).toBe(true);
  });

  it("updateDisplayObject persists all ObjectAccessibility fields simultaneously", () => {
    const { tl, layer, inst } = setupTimelineWithInstance();
    const acc: ObjectAccessibility = {
      enabled: true,
      name: "Submit Form",
      description: "Submits the registration form",
      shortcut: "Enter",
      tabIndex: 1,
      forceSimple: false,
    };
    const updated = updateDisplayObject(tl, layer.id, 0, inst.id, { accessibility: acc });
    const frame = updated.layers[0].frames[0];
    const obj = frame.displayObjects.find((o) => o.id === inst.id) as SymbolInstance;
    expect(obj.accessibility?.enabled).toBe(true);
    expect(obj.accessibility?.name).toBe("Submit Form");
    expect(obj.accessibility?.description).toBe("Submits the registration form");
    expect(obj.accessibility?.shortcut).toBe("Enter");
    expect(obj.accessibility?.tabIndex).toBe(1);
    expect(obj.accessibility?.forceSimple).toBe(false);
  });

  it("updateDisplayObject with enabled=false persists the disabled state", () => {
    const { tl, layer, inst } = setupTimelineWithInstance();
    const acc: ObjectAccessibility = { enabled: false, name: "Hidden" };
    const updated = updateDisplayObject(tl, layer.id, 0, inst.id, { accessibility: acc });
    const frame = updated.layers[0].frames[0];
    const obj = frame.displayObjects.find((o) => o.id === inst.id) as SymbolInstance;
    expect(obj.accessibility?.enabled).toBe(false);
    expect(obj.accessibility?.name).toBe("Hidden");
  });

  it("accessibility update does not affect other display objects on the frame", () => {
    const { tl, layer } = setupTimelineWithInstance();
    const inst2 = makeInstanceObj("inst-2");
    const tl2 = addDisplayObject(tl, layer.id, 0, inst2);
    const acc: ObjectAccessibility = { enabled: true, name: "First" };
    const updated = updateDisplayObject(tl2, layer.id, 0, "inst-1", { accessibility: acc });
    const frame = updated.layers[0].frames[0];
    const obj2 = frame.displayObjects.find((o) => o.id === "inst-2") as SymbolInstance;
    // inst-2 should have no accessibility
    expect(obj2.accessibility).toBeUndefined();
  });
});
