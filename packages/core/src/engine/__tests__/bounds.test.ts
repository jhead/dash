import { describe, it, expect } from "vitest";
import { getTransformedBounds, getUnionBounds } from "../bounds.js";
import type { DisplayObject } from "../types.js";

describe("getTransformedBounds", () => {
  it("non-rotated object returns unchanged bounds", () => {
    const obj = { type: "text", id: "1", x: 10, y: 20, width: 100, height: 50, rotation: 0,
      text: "", textType: "static", fontFamily: "Arial", fontSize: 12, bold: false,
      italic: false, color: { r: 0, g: 0, b: 0, a: 255 }, align: "left",
      multiline: false, wordWrap: false } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("90° rotation swaps width and height", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 50, rotation: 90 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b.width).toBeCloseTo(50, 1);
    expect(b.height).toBeCloseTo(100, 1);
  });

  it("45° rotation of square is still square (larger)", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 100, rotation: 45 } as DisplayObject;
    const b = getTransformedBounds(obj);
    // diagonal = 100*sqrt(2) ≈ 141.4
    expect(b.width).toBeCloseTo(141.4, 0);
    expect(b.height).toBeCloseTo(141.4, 0);
  });

  it("45° rotation of 100x50 rect produces wider and taller AABB", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 50, rotation: 45 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b.width).toBeGreaterThan(100);
    expect(b.height).toBeGreaterThan(50);
  });

  it("scaleX=2 doubles width in non-rotated case", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 50, rotation: 0, scaleX: 2 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b.width).toBeCloseTo(200, 5);
    expect(b.height).toBeCloseTo(50, 5);
  });

  it("scaleY=0.5 halves height in non-rotated case", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 50, rotation: 0, scaleY: 0.5 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b.width).toBeCloseTo(100, 5);
    expect(b.height).toBeCloseTo(25, 5);
  });

  it("object with no rotation field is treated as 0 rotation", () => {
    // ShapeDisplayObject has optional rotation — omit it
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 5, y: 10, width: 60, height: 30 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b).toEqual({ x: 5, y: 10, width: 60, height: 30 });
  });

  it("180° rotation of a rectangle returns same-size AABB at same position", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 80, height: 40, rotation: 180 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b.width).toBeCloseTo(80, 1);
    expect(b.height).toBeCloseTo(40, 1);
  });

  it("scaled and rotated object produces correct AABB", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 50, rotation: 90, scaleX: 2, scaleY: 1 } as DisplayObject;
    const b = getTransformedBounds(obj);
    // After scaleX=2: effective width=200, height=50; 90° rotates these so AABB width≈50, height≈200
    expect(b.width).toBeCloseTo(50, 1);
    expect(b.height).toBeCloseTo(200, 1);
  });
});

describe("getUnionBounds", () => {
  it("returns null for empty array", () => {
    expect(getUnionBounds([])).toBeNull();
  });

  it("single object returns its own bounds", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 5, y: 10, width: 60, height: 30 } as DisplayObject;
    const b = getUnionBounds([obj]);
    expect(b).toEqual({ x: 5, y: 10, width: 60, height: 30 });
  });

  it("two non-overlapping objects produce correct union", () => {
    const a = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 50, height: 50 } as DisplayObject;
    const b = { type: "bitmap", id: "2", libraryItemId: "bmp2",
      x: 100, y: 100, width: 50, height: 50 } as DisplayObject;
    const u = getUnionBounds([a, b]);
    expect(u).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });
});
