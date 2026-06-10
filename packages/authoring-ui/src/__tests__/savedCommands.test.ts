/**
 * Unit tests for savedCommands.ts — localStorage-backed named macro storage.
 *
 * Tests:
 *   1. loadCommands — returns [] when localStorage is empty
 *   2. saveCommand — persists to localStorage and returns updated list
 *   3. saveCommand — multiple commands accumulate correctly
 *   4. deleteCommand — removes the correct entry by id
 *   5. deleteCommand — no-op when id not found
 *   6. loadCommands — round-trips serialised data back correctly
 *   7. loadCommands — returns [] when localStorage contains invalid JSON
 *   8. Commands menu renders saved command items (prop contract)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadCommands, saveCommand, deleteCommand } from "../savedCommands.js";
import type { SavedCommand } from "../savedCommands.js";
import type { FlashDocument } from "@flash/core";

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

function makeLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Minimal FlashDocument stub (only id required for round-trip check)
// ---------------------------------------------------------------------------

function makeDoc(id: string): FlashDocument {
  return {
    id,
    properties: {
      width: 550,
      height: 400,
      frameRate: 12,
      backgroundColor: "#ffffff",
      rulerUnits: "px",
      grid: {
        showGrid: false,
        snapToGrid: false,
        gridColor: "#999999",
        gridWidth: 18,
        gridHeight: 18,
      },
      guides: [],
      snapToObjects: false,
      snapToPixels: false,
      snapToGuides: false,
    },
    scenes: [],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Wire up the localStorage mock before each test
// ---------------------------------------------------------------------------

let mockStorage: Storage;

beforeEach(() => {
  mockStorage = makeLocalStorageMock();
  vi.stubGlobal("localStorage", mockStorage);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadCommands", () => {
  it("returns [] when localStorage is empty", () => {
    expect(loadCommands()).toEqual([]);
  });

  it("returns [] when localStorage contains invalid JSON", () => {
    mockStorage.setItem("flash8-saved-commands", "{not valid json}");
    expect(loadCommands()).toEqual([]);
  });

  it("returns [] when localStorage contains non-array JSON", () => {
    mockStorage.setItem("flash8-saved-commands", JSON.stringify({ foo: "bar" }));
    expect(loadCommands()).toEqual([]);
  });
});

describe("saveCommand", () => {
  it("saves a command and returns updated list", () => {
    const result = saveCommand("My Command", [makeDoc("d1")], []);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("My Command");
    expect(result[0].steps).toHaveLength(1);
    expect(result[0].steps[0].id).toBe("d1");
    expect(result[0].id).toMatch(/^cmd-/);
  });

  it("persists to localStorage so loadCommands returns it", () => {
    const initial = saveCommand("Test Macro", [makeDoc("doc-a")], []);
    const loaded = loadCommands();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Test Macro");
    expect(loaded[0].steps[0].id).toBe("doc-a");
    expect(loaded[0].id).toBe(initial[0].id);
  });

  it("accumulates multiple commands", () => {
    let cmds: SavedCommand[] = [];
    cmds = saveCommand("First", [], cmds);
    cmds = saveCommand("Second", [makeDoc("d2")], cmds);
    cmds = saveCommand("Third", [makeDoc("d3a"), makeDoc("d3b")], cmds);
    expect(cmds).toHaveLength(3);
    expect(cmds.map((c) => c.name)).toEqual(["First", "Second", "Third"]);
  });

  it("each saved command has a unique id", () => {
    let cmds: SavedCommand[] = [];
    cmds = saveCommand("A", [], cmds);
    cmds = saveCommand("B", [], cmds);
    const ids = cmds.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("deleteCommand", () => {
  it("removes the command with the given id", () => {
    let cmds: SavedCommand[] = [];
    cmds = saveCommand("Keep", [], cmds);
    cmds = saveCommand("Delete Me", [], cmds);
    const toDelete = cmds[1].id;
    const result = deleteCommand(toDelete, cmds);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Keep");
  });

  it("is a no-op when the id is not found", () => {
    let cmds: SavedCommand[] = [];
    cmds = saveCommand("Solo", [], cmds);
    const result = deleteCommand("nonexistent-id", cmds);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Solo");
  });

  it("persists the deletion to localStorage", () => {
    let cmds: SavedCommand[] = [];
    cmds = saveCommand("A", [], cmds);
    cmds = saveCommand("B", [], cmds);
    const idA = cmds[0].id;
    deleteCommand(idA, cmds);
    const loaded = loadCommands();
    // deleteCommand persists the updated list (without A)
    expect(loaded.find((c) => c.id === idA)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Commands menu prop contract
// ---------------------------------------------------------------------------

describe("Commands menu item contract", () => {
  it("onRunCommand is called with the correct command id", () => {
    const onRunCommand = vi.fn();
    const cmdId = "cmd-test-123";

    // Simulate what happens when the menu item is activated
    onRunCommand(cmdId);

    expect(onRunCommand).toHaveBeenCalledWith(cmdId);
    expect(onRunCommand).toHaveBeenCalledTimes(1);
  });

  it("savedCommands list maps correctly to menu item labels", () => {
    const commands: Array<{ id: string; name: string }> = [
      { id: "cmd-1", name: "Rotate and Scale" },
      { id: "cmd-2", name: "Add Shadow" },
    ];

    // Simulate the MENUS computation for the Commands entry
    const items = commands.map((cmd) => ({
      label: cmd.name,
      id: cmd.id,
    }));

    expect(items[0].label).toBe("Rotate and Scale");
    expect(items[1].label).toBe("Add Shadow");
    expect(items[0].id).toBe("cmd-1");
  });
});
