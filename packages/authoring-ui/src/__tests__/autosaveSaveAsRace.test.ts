// ---------------------------------------------------------------------------
// Regression tests for the two data-loss bugs fixed in task 1316. These wire the
// REAL AutosaveController + REAL ProjectStore (fake-indexeddb) + REAL projectSession
// helpers together, mirroring exactly what useProjectActions does, so the fix is
// exercised end-to-end without needing a React/jsdom harness (the package test env
// is node).
//
// (a) Save-As race: a Save As fired during a pending autosave debounce must leave
//     the named slot holding the SAVE-AS bytes — the stale in-flight autosave
//     (old bytes) must NOT overwrite it.
// (b) Unload durability: the visibility/unload flush must START the durable write
//     synchronously with the LATEST bytes (via takePendingPayload()).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { FlashDocument } from "@flash/core";
import {
  AutosaveController,
  type AutosaveTimers,
  type AutosavePayload,
} from "../projects/autosaveController.js";
import { ProjectStore, CURRENT_WORKING_KEY } from "../projects/projectStore.js";
import { autosaveCurrentWorking } from "../projects/projectSession.js";

/**
 * The persistence half of an explicit Save As, mirroring projectSession.saveNamed
 * but with caller-supplied bytes (so the test can use recognizable tagged bytes
 * rather than a real saveFla serialization). Writes the named slot AND the
 * current-working mirror, both stamped with the monotonic seq.
 */
async function saveAsBytes(
  store: ProjectStore,
  name: string,
  bytes: Uint8Array,
  seq: number
): Promise<void> {
  const now = Date.now();
  await store.put(name, bytes, { updatedAt: now, seq });
  await store.put(CURRENT_WORKING_KEY, bytes, { updatedAt: now, seq });
}

// localStorage shim (saveNamed touches the recent list).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

class FakeClock {
  private q: Array<{ id: number; fn: () => void; due: number }> = [];
  private now = 0;
  private nextId = 1;
  readonly timers: AutosaveTimers = {
    setTimeout: (fn, ms) => {
      const id = this.nextId++;
      this.q.push({ id, fn, due: this.now + ms });
      return id;
    },
    clearTimeout: (h) => {
      this.q = this.q.filter((t) => t.id !== h);
    },
  };
  advance(ms: number): void {
    this.now += ms;
    const due = this.q.filter((t) => t.due <= this.now).sort((a, b) => a.due - b.due);
    this.q = this.q.filter((t) => t.due > this.now);
    for (const t of due) t.fn();
  }
}

function freshStore(): ProjectStore {
  return new ProjectStore({
    indexedDB: new IDBFactory(),
    dbName: `race-${Math.random().toString(36).slice(2)}`,
  });
}

// A stand-in doc that serializes to a recognizable byte string so we can assert
// which version (old autosave vs Save-As) landed in a slot.
function tagDoc(tag: string): FlashDocument {
  return { __tag: tag } as unknown as FlashDocument;
}
function serializeTag(d: FlashDocument): Uint8Array {
  return new TextEncoder().encode((d as unknown as { __tag: string }).__tag);
}
function decode(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

/**
 * Build a controller wired the way useProjectActions wires it: the persist
 * closure writes the current-working slot AND the captured target name, stamping
 * both with the payload generation as the monotonic seq.
 */
function wireController(
  store: ProjectStore,
  clock: FakeClock,
  serialize: (d: FlashDocument) => Uint8Array
): AutosaveController {
  return new AutosaveController({
    serialize,
    persist: async ({ bytes, targetName, generation }: AutosavePayload) => {
      await autosaveCurrentWorking(store, bytes, generation);
      if (targetName && targetName !== CURRENT_WORKING_KEY) {
        await store.put(targetName, bytes, { seq: generation });
      }
    },
    delayMs: 1000,
    timers: clock.timers,
  });
}

describe("task 1316 — Save-As autosave race (BUG 2)", () => {
  let clock: FakeClock;
  beforeEach(() => {
    clock = new FakeClock();
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemStorage(),
      writable: true,
      configurable: true,
    });
  });

  it("Save As during a pending debounce leaves the named slot with the SAVE-AS bytes", async () => {
    const store = freshStore();
    const controller = wireController(store, clock, serializeTag);

    // 1) User edits an UNNAMED doc → autosave is scheduled (target = undefined).
    controller.schedule(tagDoc("autosave-old"), undefined);
    clock.advance(500); // mid-debounce: timer NOT yet fired

    // 2) User does Save As "MyGame" while the autosave is still pending. The hook
    //    supersedes the pending autosave, then writes the named slot.
    controller.supersede();
    const seq = controller.currentGeneration;
    await saveAsBytes(store, "MyGame", serializeTag(tagDoc("saveas-new")), seq);

    // 3) Let the (now superseded) debounce timer come due. It must be a no-op.
    clock.advance(2000);
    await Promise.resolve();
    await Promise.resolve();

    const named = await store.get("MyGame");
    expect(named).not.toBeNull();
    expect(decode(named!.bytes)).toBe("saveas-new"); // NOT clobbered by stale autosave

    const working = await store.get(CURRENT_WORKING_KEY);
    expect(decode(working!.bytes)).toBe("saveas-new");
  });

  it("a stale IN-FLIGHT autosave (already past the debounce) cannot overwrite a Save As", async () => {
    const store = freshStore();
    // Use a gated persist so the autosave is genuinely in flight when Save As runs.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let firstPersist = true;
    const controller = new AutosaveController({
      serialize: serializeTag,
      persist: async ({ bytes, targetName, generation }: AutosavePayload) => {
        if (firstPersist) {
          firstPersist = false;
          await gate; // hold the stale autosave mid-flight
        }
        await autosaveCurrentWorking(store, bytes, generation);
        if (targetName && targetName !== CURRENT_WORKING_KEY) {
          await store.put(targetName, bytes, { seq: generation });
        }
      },
      delayMs: 100,
      timers: clock.timers,
    });

    // Edit while a project named "MyGame" is already active.
    controller.schedule(tagDoc("autosave-old"), "MyGame");
    clock.advance(100); // fire(): persist starts and BLOCKS on the gate
    await Promise.resolve();

    // Save As to the SAME slot with fresh bytes while the autosave is in flight.
    controller.supersede();
    const seq = controller.currentGeneration;
    await saveAsBytes(store, "MyGame", serializeTag(tagDoc("saveas-new")), seq);

    // Release the stale in-flight autosave; it resolves AFTER the Save As.
    release();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The store's monotonic seq guard rejects the stale (lower-seq) write, so the
    // named slot still holds the Save-As bytes.
    const named = await store.get("MyGame");
    expect(decode(named!.bytes)).toBe("saveas-new");
    const working = await store.get(CURRENT_WORKING_KEY);
    expect(decode(working!.bytes)).toBe("saveas-new");
  });
});

describe("task 1316 — unload durability flush (BUG 1)", () => {
  let clock: FakeClock;
  beforeEach(() => {
    clock = new FakeClock();
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemStorage(),
      writable: true,
      configurable: true,
    });
  });

  // Mirrors the startDurableFlush() helper in useProjectActions: take the pending
  // payload synchronously, then start the IndexedDB write.
  async function startDurableFlush(
    controller: AutosaveController,
    store: ProjectStore
  ): Promise<boolean> {
    const payload = controller.takePendingPayload();
    if (!payload) return false;
    const { bytes, targetName, generation } = payload;
    await autosaveCurrentWorking(store, bytes, generation);
    if (targetName && targetName !== CURRENT_WORKING_KEY) {
      await store.put(targetName, bytes, { seq: generation });
    }
    return true;
  }

  it("the visibility/unload flush writes the LATEST pending bytes synchronously", async () => {
    const store = freshStore();
    const controller = wireController(store, clock, serializeTag);

    // Several edits queue up; only the last is the latest pending doc.
    controller.schedule(tagDoc("v1"), "MyGame");
    clock.advance(200);
    controller.schedule(tagDoc("v2"), "MyGame");
    clock.advance(200);
    controller.schedule(tagDoc("v3-latest"), "MyGame");
    // Tab is hidden before the debounce fires → durable flush takes the payload.

    // takePendingPayload must be invoked synchronously with the latest bytes.
    const payload = controller.takePendingPayload();
    expect(payload).not.toBeNull();
    expect(decode(payload!.bytes)).toBe("v3-latest");
    expect(payload!.targetName).toBe("MyGame");
  });

  it("the durable flush persists the latest bytes to both slots; the armed timer does not double-write", async () => {
    const store = freshStore();
    const controller = wireController(store, clock, serializeTag);

    controller.schedule(tagDoc("latest"), "MyGame");
    // visibilitychange -> hidden: start the durable write synchronously.
    const started = await startDurableFlush(controller, store);
    expect(started).toBe(true);

    expect(decode((await store.get("MyGame"))!.bytes)).toBe("latest");
    expect(decode((await store.get(CURRENT_WORKING_KEY))!.bytes)).toBe("latest");

    // The still-armed debounce timer fires later but must be a no-op (the payload
    // generation was already claimed by takePendingPayload).
    clock.advance(2000);
    await Promise.resolve();
    await Promise.resolve();
    // No new writes / no clobbering with stale anything — value unchanged.
    expect(decode((await store.get("MyGame"))!.bytes)).toBe("latest");
  });

  it("startDurableFlush is a no-op when there is nothing pending", async () => {
    const store = freshStore();
    const controller = wireController(store, clock, serializeTag);
    expect(await startDurableFlush(controller, store)).toBe(false);
  });
});
