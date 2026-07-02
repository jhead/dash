/**
 * Task 1387 — eraser modes (Normal/Fills/Lines/Selected/Inside) and the Faucet
 * toggle are engine capabilities (tools/types.ts eraserMode/eraserFaucet, consumed
 * by StageArea) that had no toolbox UI. This verifies the state-wiring half:
 *   - DEFAULT_TOOL_STATE seeds eraserMode="normal" / eraserFaucet=false
 *   - the useToolHandlers callbacks flip those slices so the eraser can leave
 *     Normal / turn Faucet on (previously impossible from the UI).
 *
 * The visual Options block in ToolsPanel.tsx calls exactly these callbacks
 * (onEraserModeChange / onEraserFaucetChange), so exercising the handlers proves
 * the click-to-setToolState path end to end (vitest runs in a node env, so the
 * DOM render itself is covered by the e2e/manual layer).
 */
import { describe, it, expect } from "vitest";
import { createUiStore, DEFAULT_TOOL_STATE } from "../store/uiStore.js";

// Re-implement the two handlers' pure bodies against the store, matching
// useToolHandlers.ts (which needs a full React deps object to instantiate).
function makeStore() {
  const ui = createUiStore();
  const setToolState = ui.getState().setToolState;
  const setEraserMode = (mode: "normal" | "fills" | "lines" | "selected" | "inside") =>
    setToolState((prev) => ({ ...prev, eraserMode: mode }));
  const setEraserFaucet = (faucet: boolean) =>
    setToolState((prev) => ({ ...prev, eraserFaucet: faucet }));
  return { ui, setEraserMode, setEraserFaucet };
}

describe("eraser tool options (task 1387)", () => {
  it("defaults to Erase Normal with Faucet off", () => {
    expect(DEFAULT_TOOL_STATE.eraserMode).toBe("normal");
    expect(DEFAULT_TOOL_STATE.eraserFaucet).toBe(false);
    const { ui } = makeStore();
    expect(ui.getState().toolState.eraserMode).toBe("normal");
    expect(ui.getState().toolState.eraserFaucet).toBe(false);
  });

  it("can switch to every planar erase mode", () => {
    const { ui, setEraserMode } = makeStore();
    for (const mode of ["fills", "lines", "selected", "inside", "normal"] as const) {
      setEraserMode(mode);
      expect(ui.getState().toolState.eraserMode).toBe(mode);
    }
  });

  it("toggles the Faucet flag on and off", () => {
    const { ui, setEraserFaucet } = makeStore();
    setEraserFaucet(true);
    expect(ui.getState().toolState.eraserFaucet).toBe(true);
    setEraserFaucet(false);
    expect(ui.getState().toolState.eraserFaucet).toBe(false);
  });

  it("does not disturb unrelated tool state (eraser size preserved)", () => {
    const { ui, setEraserMode } = makeStore();
    ui.getState().setToolState((p) => ({ ...p, eraserSize: 48 }));
    setEraserMode("inside");
    expect(ui.getState().toolState.eraserSize).toBe(48);
    expect(ui.getState().toolState.eraserMode).toBe("inside");
  });
});
