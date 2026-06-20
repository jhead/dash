import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createDocument, saveFla } from "@flash/core";
import { ProjectStore, CURRENT_WORKING_KEY } from "../projects/projectStore.js";
import {
  restoreOnLoad,
  saveNamed,
  openNamed,
  autosaveCurrentWorking,
  sanitizeProjectName,
} from "../projects/projectSession.js";
import { EMPTY_RECENT_STATE } from "../projects/recentProjects.js";

// localStorage shim (saveNamed/openNamed touch the recent list, which persists).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

function freshStore(): ProjectStore {
  return new ProjectStore({
    indexedDB: new IDBFactory(),
    dbName: `sess-${Math.random().toString(36).slice(2)}`,
  });
}

describe("projectSession", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemStorage(),
      writable: true,
      configurable: true,
    });
  });

  describe("sanitizeProjectName", () => {
    it("trims, strips .fla, and rejects empties / the reserved key", () => {
      expect(sanitizeProjectName("  Hello.fla ")).toBe("Hello");
      expect(sanitizeProjectName("Game")).toBe("Game");
      expect(sanitizeProjectName("   ")).toBeNull();
      expect(sanitizeProjectName(CURRENT_WORKING_KEY)).toBeNull();
    });
  });

  describe("Save As naming", () => {
    it("stores under the name, mirrors to the current-working slot, and sets active", async () => {
      const store = freshStore();
      const doc = createDocument();
      const { recent, meta } = await saveNamed(store, EMPTY_RECENT_STATE, "Pong", doc);
      expect(meta.name).toBe("Pong");
      expect(recent.activeId).toBe("Pong");
      expect(recent.recent.map((e) => e.id)).toEqual(["Pong"]);

      // Both the named slot AND the working slot hold the bytes.
      expect(await store.has("Pong")).toBe(true);
      expect(await store.has(CURRENT_WORKING_KEY)).toBe(true);
    });
  });

  describe("restoreOnLoad", () => {
    it("restores the current-working autosave slot (F5 recovery)", async () => {
      const store = freshStore();
      const doc = createDocument();
      await autosaveCurrentWorking(store, saveFla(doc));

      const result = await restoreOnLoad(store, EMPTY_RECENT_STATE);
      expect(result).not.toBeNull();
      expect(result!.fromCurrentWorking).toBe(true);
      expect(result!.doc.id).toBe(doc.id);
      expect(result!.name).toBeUndefined(); // unnamed in-progress work
    });

    it("reports the active name when the named project still exists", async () => {
      const store = freshStore();
      const doc = createDocument();
      const { recent } = await saveNamed(store, EMPTY_RECENT_STATE, "Named", doc);

      const result = await restoreOnLoad(store, recent);
      expect(result).not.toBeNull();
      expect(result!.fromCurrentWorking).toBe(true);
      expect(result!.name).toBe("Named");
      expect(result!.doc.id).toBe(doc.id);
    });

    it("falls back to the active named project when there is no working slot", async () => {
      const store = freshStore();
      const doc = createDocument();
      // Save named, then wipe the current-working slot.
      const { recent } = await saveNamed(store, EMPTY_RECENT_STATE, "OnlyNamed", doc);
      await store.delete(CURRENT_WORKING_KEY);

      const result = await restoreOnLoad(store, recent);
      expect(result).not.toBeNull();
      expect(result!.fromCurrentWorking).toBe(false);
      expect(result!.name).toBe("OnlyNamed");
      expect(result!.doc.id).toBe(doc.id);
    });

    it("returns null on an empty store (caller starts a fresh doc)", async () => {
      const store = freshStore();
      expect(await restoreOnLoad(store, EMPTY_RECENT_STATE)).toBeNull();
    });

    it("returns null (does not throw) when the working slot bytes are unparseable", async () => {
      const store = freshStore();
      await store.put(CURRENT_WORKING_KEY, new Uint8Array([0xff, 0x00, 0x12, 0x34]));
      expect(await restoreOnLoad(store, EMPTY_RECENT_STATE)).toBeNull();
    });
  });

  describe("openNamed", () => {
    it("loads a stored project and makes it active + most-recent", async () => {
      const store = freshStore();
      const docA = createDocument();
      const docB = createDocument();
      let { recent } = await saveNamed(store, EMPTY_RECENT_STATE, "A", docA);
      ({ recent } = await saveNamed(store, recent, "B", docB));
      // B is active now; reopen A.
      const opened = await openNamed(store, recent, "A");
      expect(opened).not.toBeNull();
      expect(opened!.doc.id).toBe(docA.id);
      expect(opened!.recent.activeId).toBe("A");
      expect(opened!.recent.recent[0].id).toBe("A");
    });

    it("returns null for a missing project", async () => {
      const store = freshStore();
      expect(await openNamed(store, EMPTY_RECENT_STATE, "ghost")).toBeNull();
    });
  });
});
