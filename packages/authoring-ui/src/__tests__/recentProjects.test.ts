import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRecentProjects,
  saveRecentProjects,
  touchRecentProject,
  removeRecentProject,
  clearActiveProject,
  RECENT_PROJECTS_CAP,
  EMPTY_RECENT_STATE,
  type RecentEntry,
} from "../projects/recentProjects.js";

// Minimal in-memory localStorage shim (node test env has no localStorage).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

function installStorage(): MemStorage {
  const s = new MemStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: s,
    writable: true,
    configurable: true,
  });
  return s;
}

function entry(id: string, updatedAt: number): RecentEntry {
  return { id, label: id, updatedAt };
}

describe("recentProjects (localStorage)", () => {
  beforeEach(() => {
    installStorage();
  });

  it("returns empty state when nothing is stored", () => {
    expect(loadRecentProjects()).toEqual(EMPTY_RECENT_STATE);
  });

  it("persists and reloads via a versioned envelope", () => {
    saveRecentProjects({ activeId: "p", recent: [entry("p", 5)] });
    const loaded = loadRecentProjects();
    expect(loaded.activeId).toBe("p");
    expect(loaded.recent.map((e) => e.id)).toEqual(["p"]);
  });

  it("touch moves an entry to front, de-duplicates, and sets it active", () => {
    let state = touchRecentProject(EMPTY_RECENT_STATE, entry("a", 1));
    state = touchRecentProject(state, entry("b", 2));
    state = touchRecentProject(state, entry("a", 3)); // a again, newer
    expect(state.activeId).toBe("a");
    expect(state.recent.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("caps the recent list at RECENT_PROJECTS_CAP", () => {
    let state = EMPTY_RECENT_STATE;
    for (let i = 0; i < RECENT_PROJECTS_CAP + 5; i++) {
      state = touchRecentProject(state, entry(`p${i}`, i));
    }
    expect(state.recent).toHaveLength(RECENT_PROJECTS_CAP);
    // Most recent first: the last-touched p19 leads.
    expect(state.recent[0].id).toBe(`p${RECENT_PROJECTS_CAP + 4}`);
  });

  it("remove drops an entry and clears active when it was active", () => {
    let state = touchRecentProject(EMPTY_RECENT_STATE, entry("a", 1));
    state = touchRecentProject(state, entry("b", 2));
    state = removeRecentProject(state, "b"); // b was active
    expect(state.recent.map((e) => e.id)).toEqual(["a"]);
    expect(state.activeId).toBeUndefined();
  });

  it("clearActiveProject keeps the recent list but drops the active id", () => {
    let state = touchRecentProject(EMPTY_RECENT_STATE, entry("a", 1));
    state = clearActiveProject(state);
    expect(state.activeId).toBeUndefined();
    expect(state.recent.map((e) => e.id)).toEqual(["a"]);
  });

  it("normalizes/recovers from a corrupt stored value (parse fallback)", () => {
    localStorage.setItem("flash8.recentProjects", "{not valid json");
    expect(loadRecentProjects()).toEqual(EMPTY_RECENT_STATE);
  });

  it("drops invalid entries during normalization", () => {
    localStorage.setItem(
      "flash8.recentProjects",
      JSON.stringify({
        version: 1,
        state: {
          activeId: "ok",
          recent: [
            { id: "ok", label: "ok", updatedAt: 1 },
            { id: "", label: "bad", updatedAt: 2 }, // empty id → dropped
            { nope: true }, // junk → dropped
            { id: "ok", label: "dup", updatedAt: 3 }, // duplicate id → dropped
          ],
        },
      })
    );
    const loaded = loadRecentProjects();
    expect(loaded.recent.map((e) => e.id)).toEqual(["ok"]);
  });
});
