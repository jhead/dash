/**
 * Awareness state mapping (task 1345 P2) — uiStore → awareness fields, the
 * defensive remote-state parse, the change-diff (cursor-throttle gate), and the
 * symbol-editors derivation.
 */
import { describe, it, expect } from "vitest";
import { createUiStore } from "../../store/uiStore.js";
import type { CollabUser } from "../localUser.js";
import {
  asPeerPresence,
  changedAwarenessFields,
  symbolEditorsFromPeers,
  uiStateToAwareness,
  type PeerPresence,
} from "../awarenessState.js";

const USER: CollabUser = { id: "u1", name: "Swift Otter", color: "#e6194b" };

describe("uiStateToAwareness", () => {
  it("projects every uiStore field into the awareness shape", () => {
    const store = createUiStore();
    const ui = store.getState();
    ui.setActiveSceneIndex(2);
    ui.setCurrentFrame(7);
    ui.setCursorPos({ x: 123.5, y: -8 });
    ui.setSelectedShapeIds(["a", "b"]);
    ui.setSelectedInstanceId("inst-9");
    ui.setToolState({ ...ui.toolState, activeTool: "pencil" });
    ui.setEditContext({ mode: "symbol", symbolId: "sym-5", symbolName: "Ball" });

    const state = uiStateToAwareness(store.getState(), USER);
    expect(state.user).toEqual(USER);
    expect(state.scene).toBe(2);
    expect(state.frame).toBe(7);
    expect(state.cursor).toEqual({ x: 123.5, y: -8 });
    expect(state.selection).toEqual({ shapeIds: ["a", "b"], instanceId: "inst-9" });
    expect(state.tool).toBe("pencil");
    expect(state.editContext).toEqual({ mode: "symbol", symbolId: "sym-5", symbolName: "Ball" });
  });

  it("maps a null cursor (pointer off stage) and document edit-context", () => {
    const store = createUiStore();
    const state = uiStateToAwareness(store.getState(), USER);
    expect(state.cursor).toBeNull();
    expect(state.editContext).toEqual({ mode: "document" });
    expect(state.selection).toEqual({ shapeIds: [], instanceId: null });
    expect(state.tool).toBe("selection");
  });

  it("does not leak symbol fields when in document context", () => {
    const store = createUiStore();
    store.getState().setEditContext({ mode: "document" });
    const state = uiStateToAwareness(store.getState(), USER);
    expect(state.editContext).toEqual({ mode: "document" });
    expect("symbolId" in state.editContext).toBe(false);
  });
});

describe("changedAwarenessFields", () => {
  const base = uiStateToAwareness(createUiStore().getState(), USER);

  it("reports all fields when there is no prior state", () => {
    expect(changedAwarenessFields(null, base).sort()).toEqual(
      ["cursor", "editContext", "frame", "scene", "selection", "tool", "user"].sort(),
    );
  });

  it("reports only the cursor when only the cursor moved", () => {
    const next = { ...base, cursor: { x: 10, y: 20 } };
    expect(changedAwarenessFields(base, next)).toEqual(["cursor"]);
  });

  it("reports selection + tool together, no cursor", () => {
    const next = {
      ...base,
      tool: "brush",
      selection: { shapeIds: ["x"], instanceId: null },
    };
    expect(changedAwarenessFields(base, next).sort()).toEqual(["selection", "tool"]);
  });

  it("reports nothing when identical", () => {
    expect(changedAwarenessFields(base, { ...base })).toEqual([]);
  });
});

describe("asPeerPresence (defensive parse)", () => {
  it("parses a well-formed remote state", () => {
    const raw = uiStateToAwareness(createUiStore().getState(), USER);
    const p = asPeerPresence(42, raw);
    expect(p).not.toBeNull();
    expect(p!.clientId).toBe(42);
    expect(p!.user).toEqual(USER);
  });

  it("rejects a state with no user", () => {
    expect(asPeerPresence(1, { cursor: { x: 0, y: 0 } })).toBeNull();
    expect(asPeerPresence(1, null)).toBeNull();
    expect(asPeerPresence(1, "garbage")).toBeNull();
  });

  it("tolerates missing optional fields with safe defaults", () => {
    const p = asPeerPresence(7, { user: USER });
    expect(p).not.toBeNull();
    expect(p!.cursor).toBeNull();
    expect(p!.scene).toBe(0);
    expect(p!.frame).toBe(0);
    expect(p!.tool).toBe("selection");
    expect(p!.selection).toEqual({ shapeIds: [], instanceId: null });
    expect(p!.editContext).toEqual({ mode: "document" });
  });
});

describe("symbolEditorsFromPeers", () => {
  it("groups peers by the symbol they are editing", () => {
    const peers: PeerPresence[] = [
      mkPeer(1, "#aaa", "A", { mode: "symbol", symbolId: "s1", symbolName: "Ball" }),
      mkPeer(2, "#bbb", "B", { mode: "symbol", symbolId: "s1", symbolName: "Ball" }),
      mkPeer(3, "#ccc", "C", { mode: "symbol", symbolId: "s2", symbolName: "Box" }),
      mkPeer(4, "#ddd", "D", { mode: "document" }),
    ];
    const map = symbolEditorsFromPeers(peers);
    expect(map.get("s1")).toEqual([
      { color: "#aaa", name: "A" },
      { color: "#bbb", name: "B" },
    ]);
    expect(map.get("s2")).toEqual([{ color: "#ccc", name: "C" }]);
    expect(map.has("doc")).toBe(false);
  });
});

function mkPeer(
  clientId: number,
  color: string,
  name: string,
  editContext: PeerPresence["editContext"],
): PeerPresence {
  return {
    clientId,
    user: { id: `u${clientId}`, name, color },
    cursor: null,
    scene: 0,
    frame: 0,
    editContext,
    selection: { shapeIds: [], instanceId: null },
    tool: "selection",
  };
}
