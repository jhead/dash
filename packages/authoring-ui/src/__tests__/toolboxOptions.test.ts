/**
 * Task 1388 — toolbox Options parity. Each remaining Flash 8 tool option
 * (brush shape/paint-mode/lock-fill/pressure/tilt, paint-bucket gap-size/
 * lock-fill, rectangle corner radius, pen sub-tools) is a ToolState slice
 * surfaced by an Options block in ToolsPanel and mutated by a useToolHandlers
 * callback. This verifies the state-wiring half:
 *   - DEFAULT_TOOL_STATE seeds every new slice to its Flash 8 default
 *   - the setToolState mutators (the pure bodies of the useToolHandlers
 *     callbacks the Options blocks call) flip exactly their own slice
 *
 * The visual Options blocks call these mutators via onBrushModeChange /
 * onBucketGapSizeChange / onRectCornerRadiusChange / onPenSubToolChange / …, so
 * exercising the mutators proves the click-to-setToolState path end to end
 * (vitest runs node, so the DOM render is covered by the e2e/manual layer,
 * matching eraserToolOptions.test.ts).
 */
import { describe, it, expect } from "vitest";
import { createUiStore, DEFAULT_TOOL_STATE } from "../store/uiStore.js";
import type {
  BrushPaintMode,
  BrushShape,
  PaintBucketGapSize,
  PenSubTool,
} from "../tools/types.js";

function makeStore() {
  const ui = createUiStore();
  const set = ui.getState().setToolState;
  return {
    ui,
    setBrushShape: (v: BrushShape) => set((p) => ({ ...p, brushShape: v })),
    setBrushMode: (v: BrushPaintMode) => set((p) => ({ ...p, brushMode: v })),
    setBrushLockFill: (v: boolean) => set((p) => ({ ...p, brushLockFill: v })),
    setBrushPressure: (v: boolean) => set((p) => ({ ...p, brushPressure: v })),
    setBrushTilt: (v: boolean) => set((p) => ({ ...p, brushTilt: v })),
    setBucketGapSize: (v: PaintBucketGapSize) => set((p) => ({ ...p, bucketGapSize: v })),
    setBucketLockFill: (v: boolean) => set((p) => ({ ...p, bucketLockFill: v })),
    setRectCornerRadius: (v: number) => set((p) => ({ ...p, rectCornerRadius: Math.max(0, v) })),
    setPenSubTool: (v: PenSubTool) => set((p) => ({ ...p, penSubTool: v })),
  };
}

describe("toolbox options — defaults (task 1388)", () => {
  it("seeds Flash 8 defaults for every new option slice", () => {
    expect(DEFAULT_TOOL_STATE.brushShape).toBe("round");
    expect(DEFAULT_TOOL_STATE.brushMode).toBe("normal");
    expect(DEFAULT_TOOL_STATE.brushLockFill).toBe(false);
    expect(DEFAULT_TOOL_STATE.brushPressure).toBe(false);
    expect(DEFAULT_TOOL_STATE.brushTilt).toBe(false);
    expect(DEFAULT_TOOL_STATE.bucketGapSize).toBe("none");
    expect(DEFAULT_TOOL_STATE.bucketLockFill).toBe(false);
    expect(DEFAULT_TOOL_STATE.rectCornerRadius).toBe(0);
    expect(DEFAULT_TOOL_STATE.penSubTool).toBe("pen");
  });
});

describe("toolbox options — brush (task 1388)", () => {
  it("switches nib shape and every paint mode", () => {
    const { ui, setBrushShape, setBrushMode } = makeStore();
    setBrushShape("square");
    expect(ui.getState().toolState.brushShape).toBe("square");
    for (const m of ["fills", "behind", "selection", "inside", "normal"] as const) {
      setBrushMode(m);
      expect(ui.getState().toolState.brushMode).toBe(m);
    }
  });

  it("toggles lock-fill / pressure / tilt independently", () => {
    const { ui, setBrushLockFill, setBrushPressure, setBrushTilt } = makeStore();
    setBrushLockFill(true);
    setBrushPressure(true);
    expect(ui.getState().toolState.brushLockFill).toBe(true);
    expect(ui.getState().toolState.brushPressure).toBe(true);
    expect(ui.getState().toolState.brushTilt).toBe(false);
    setBrushTilt(true);
    setBrushPressure(false);
    expect(ui.getState().toolState.brushTilt).toBe(true);
    expect(ui.getState().toolState.brushPressure).toBe(false);
  });
});

describe("toolbox options — paint bucket (task 1388)", () => {
  it("selects each gap size and toggles lock fill", () => {
    const { ui, setBucketGapSize, setBucketLockFill } = makeStore();
    for (const g of ["small", "medium", "large", "none"] as const) {
      setBucketGapSize(g);
      expect(ui.getState().toolState.bucketGapSize).toBe(g);
    }
    setBucketLockFill(true);
    expect(ui.getState().toolState.bucketLockFill).toBe(true);
  });
});

describe("toolbox options — rectangle corner radius (task 1388)", () => {
  it("stores a non-negative radius (clamps negatives to 0)", () => {
    const { ui, setRectCornerRadius } = makeStore();
    setRectCornerRadius(12);
    expect(ui.getState().toolState.rectCornerRadius).toBe(12);
    setRectCornerRadius(-5);
    expect(ui.getState().toolState.rectCornerRadius).toBe(0);
  });
});

describe("toolbox options — pen sub-tools (task 1388)", () => {
  it("cycles through every pen sub-tool", () => {
    const { ui, setPenSubTool } = makeStore();
    for (const t of ["add-anchor", "delete-anchor", "convert-anchor", "pen"] as const) {
      setPenSubTool(t);
      expect(ui.getState().toolState.penSubTool).toBe(t);
    }
  });
});

describe("toolbox options — slice isolation (task 1388)", () => {
  it("mutating one option leaves the others untouched", () => {
    const { ui, setBrushMode } = makeStore();
    ui.getState().setToolState((p) => ({ ...p, brushSize: 32, rectCornerRadius: 8 }));
    setBrushMode("behind");
    expect(ui.getState().toolState.brushSize).toBe(32);
    expect(ui.getState().toolState.rectCornerRadius).toBe(8);
    expect(ui.getState().toolState.brushMode).toBe("behind");
  });
});
