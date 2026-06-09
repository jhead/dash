import { describe, it, expect } from "vitest";
import { setInstanceProperty, setInstanceTransform } from "../instance-mutations.js";
import type { Frame } from "../types.js";
import type { DisplayObject, SymbolInstance } from "../../engine/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(id: string, overrides: Partial<SymbolInstance> = {}): SymbolInstance {
  return {
    type: "instance",
    id,
    symbolId: "sym-1",
    x: 0,
    y: 0,
    ...overrides,
  };
}

function makeShape(id: string, x = 0, y = 0): DisplayObject {
  return {
    type: "shape",
    id,
    shape: { paths: [] },
    x,
    y,
  };
}

function makeFrame(displayObjects: readonly DisplayObject[]): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: false,
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects,
  };
}

// ---------------------------------------------------------------------------
// setInstanceProperty
// ---------------------------------------------------------------------------

describe("setInstanceProperty", () => {
  it("sets x correctly on target instance", () => {
    const instance = makeInstance("inst-1", { x: 0 });
    const frame = makeFrame([instance]);
    const result = setInstanceProperty(frame, "inst-1", "x", 100);
    const updated = result.displayObjects.find((o) => o.id === "inst-1") as SymbolInstance;
    expect(updated.x).toBe(100);
  });

  it("sets y correctly on target instance", () => {
    const instance = makeInstance("inst-1", { y: 0 });
    const frame = makeFrame([instance]);
    const result = setInstanceProperty(frame, "inst-1", "y", 200);
    const updated = result.displayObjects.find((o) => o.id === "inst-1") as SymbolInstance;
    expect(updated.y).toBe(200);
  });

  it("does not mutate the original frame", () => {
    const instance = makeInstance("inst-1", { x: 0 });
    const frame = makeFrame([instance]);
    setInstanceProperty(frame, "inst-1", "x", 99);
    expect((frame.displayObjects[0] as SymbolInstance).x).toBe(0);
  });

  it("does not mutate the original displayObjects array", () => {
    const instance = makeInstance("inst-1", { x: 0 });
    const frame = makeFrame([instance]);
    const originalArr = frame.displayObjects;
    setInstanceProperty(frame, "inst-1", "x", 50);
    expect(frame.displayObjects).toBe(originalArr);
  });

  it("only affects the target instance", () => {
    const inst1 = makeInstance("inst-1", { x: 10 });
    const inst2 = makeInstance("inst-2", { x: 20 });
    const frame = makeFrame([inst1, inst2]);
    const result = setInstanceProperty(frame, "inst-1", "x", 99);
    const other = result.displayObjects.find((o) => o.id === "inst-2") as SymbolInstance;
    expect(other.x).toBe(20);
  });

  it("preserves all other instances in the frame", () => {
    const inst1 = makeInstance("inst-1");
    const inst2 = makeInstance("inst-2");
    const inst3 = makeInstance("inst-3");
    const frame = makeFrame([inst1, inst2, inst3]);
    const result = setInstanceProperty(frame, "inst-1", "x", 5);
    expect(result.displayObjects).toHaveLength(3);
    expect(result.displayObjects[1].id).toBe("inst-2");
    expect(result.displayObjects[2].id).toBe("inst-3");
  });

  it("returns frame with same display object count when instanceId not found", () => {
    const inst1 = makeInstance("inst-1", { x: 10 });
    const frame = makeFrame([inst1]);
    const result = setInstanceProperty(frame, "no-such-id", "x", 999);
    expect(result.displayObjects).toHaveLength(1);
    expect((result.displayObjects[0] as SymbolInstance).x).toBe(10);
  });

  it("can set alpha on a SymbolInstance", () => {
    const instance = makeInstance("inst-1");
    const frame = makeFrame([instance]);
    const result = setInstanceProperty(frame, "inst-1", "alpha", 0.5);
    const updated = result.displayObjects.find((o) => o.id === "inst-1") as SymbolInstance;
    expect(updated.alpha).toBe(0.5);
  });

  it("works with non-instance (shape) display objects", () => {
    const shape = makeShape("shape-1", 0, 0);
    const frame = makeFrame([shape]);
    const result = setInstanceProperty(frame, "shape-1", "x", 77);
    expect((result.displayObjects[0] as DisplayObject & { x: number }).x).toBe(77);
  });
});

// ---------------------------------------------------------------------------
// setInstanceTransform
// ---------------------------------------------------------------------------

describe("setInstanceTransform", () => {
  it("updates x and y together", () => {
    const instance = makeInstance("inst-1", { x: 0, y: 0 });
    const frame = makeFrame([instance]);
    const result = setInstanceTransform(frame, "inst-1", { x: 50, y: 75 });
    const updated = result.displayObjects.find((o) => o.id === "inst-1") as SymbolInstance;
    expect(updated.x).toBe(50);
    expect(updated.y).toBe(75);
  });

  it("partial transform preserves unspecified fields", () => {
    const instance = makeInstance("inst-1", { x: 10, y: 20, rotation: 45 });
    const frame = makeFrame([instance]);
    const result = setInstanceTransform(frame, "inst-1", { x: 99 });
    const updated = result.displayObjects.find((o) => o.id === "inst-1") as SymbolInstance;
    expect(updated.x).toBe(99);
    expect(updated.y).toBe(20);
    expect(updated.rotation).toBe(45);
  });

  it("does not mutate the original frame", () => {
    const instance = makeInstance("inst-1", { x: 0, y: 0 });
    const frame = makeFrame([instance]);
    setInstanceTransform(frame, "inst-1", { x: 100, y: 100 });
    expect((frame.displayObjects[0] as SymbolInstance).x).toBe(0);
    expect((frame.displayObjects[0] as SymbolInstance).y).toBe(0);
  });

  it("updates alpha", () => {
    const instance = makeInstance("inst-1");
    const frame = makeFrame([instance]);
    const result = setInstanceTransform(frame, "inst-1", { alpha: 0.3 });
    const updated = result.displayObjects.find((o) => o.id === "inst-1") as SymbolInstance;
    expect(updated.alpha).toBe(0.3);
  });

  it("updates scaleX and scaleY together", () => {
    const instance = makeInstance("inst-1");
    const frame = makeFrame([instance]);
    const result = setInstanceTransform(frame, "inst-1", { scaleX: 2, scaleY: 0.5 });
    const updated = result.displayObjects.find((o) => o.id === "inst-1") as SymbolInstance;
    expect(updated.scaleX).toBe(2);
    expect(updated.scaleY).toBe(0.5);
  });

  it("unknown instanceId leaves all display objects unchanged", () => {
    const inst1 = makeInstance("inst-1", { x: 10 });
    const inst2 = makeInstance("inst-2", { x: 20 });
    const frame = makeFrame([inst1, inst2]);
    const result = setInstanceTransform(frame, "no-such-id", { x: 999 });
    expect((result.displayObjects[0] as SymbolInstance).x).toBe(10);
    expect((result.displayObjects[1] as SymbolInstance).x).toBe(20);
  });

  it("unknown instanceId returns frame with same object count", () => {
    const frame = makeFrame([makeInstance("inst-1")]);
    const result = setInstanceTransform(frame, "ghost", { x: 1 });
    expect(result.displayObjects).toHaveLength(1);
  });

  it("updates rotation correctly", () => {
    const instance = makeInstance("inst-1", { rotation: 0 });
    const frame = makeFrame([instance]);
    const result = setInstanceTransform(frame, "inst-1", { rotation: 90 });
    const updated = result.displayObjects.find((o) => o.id === "inst-1") as SymbolInstance;
    expect(updated.rotation).toBe(90);
  });

  it("only modifies the target when multiple instances present", () => {
    const inst1 = makeInstance("inst-1", { x: 0, y: 0 });
    const inst2 = makeInstance("inst-2", { x: 100, y: 100 });
    const frame = makeFrame([inst1, inst2]);
    const result = setInstanceTransform(frame, "inst-1", { x: 55, y: 55 });
    const other = result.displayObjects.find((o) => o.id === "inst-2") as SymbolInstance;
    expect(other.x).toBe(100);
    expect(other.y).toBe(100);
  });
});
