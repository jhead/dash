import { describe, it, expect } from "vitest";
import { createDocument } from "@flash/core";
import {
  activeKeyframeForLayer,
  shapeDisplayObjectsAt,
  bitmapLibraryItems,
  soundLibraryItems,
  instanceNamesOf,
} from "../selectors/derived.js";

describe("derived selectors", () => {
  it("activeKeyframeForLayer returns null for hidden/locked/missing layers", () => {
    const doc = createDocument();
    const t = doc.scenes[0].timeline;
    expect(activeKeyframeForLayer(t, 999, 0)).toBeNull();
    const hidden = { ...t, layers: t.layers.map((l) => ({ ...l, visible: false })) };
    expect(activeKeyframeForLayer(hidden, 0, 0)).toBeNull();
    const locked = { ...t, layers: t.layers.map((l) => ({ ...l, locked: true })) };
    expect(activeKeyframeForLayer(locked, 0, 0)).toBeNull();
  });

  it("activeKeyframeForLayer picks the latest keyframe at or before the frame", () => {
    const doc = createDocument();
    const t = doc.scenes[0].timeline;
    const kf = activeKeyframeForLayer(t, 0, 0);
    expect(kf).not.toBeNull();
    expect(kf?.isKeyframe).toBe(true);
  });

  it("shapeDisplayObjectsAt returns only shapes (empty on a fresh doc)", () => {
    const doc = createDocument();
    const t = doc.scenes[0].timeline;
    const shapes = shapeDisplayObjectsAt(t, 0, 0);
    expect(Array.isArray(shapes)).toBe(true);
    expect(shapes.every((o) => o.type === "shape")).toBe(true);
  });

  it("library filters and instanceNames map work", () => {
    const doc = createDocument();
    expect(bitmapLibraryItems(doc.library).every((i) => i.itemType === "bitmap")).toBe(true);
    expect(soundLibraryItems(doc.library).every((i) => i.itemType === "sound")).toBe(true);
    const names = instanceNamesOf(doc.library);
    for (const item of doc.library.items) expect(names[item.id]).toBe(item.name);
  });
});
