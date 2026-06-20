import { describe, it, expect, beforeEach } from "vitest";
import { AutosaveController } from "../projects/autosaveController.js";
import type { AutosaveTimers } from "../projects/autosaveController.js";
import type { FlashDocument } from "@flash/core";

// A controllable fake timer so debounce/supersession is deterministic.
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
  /** Advance time, firing any timers that come due (in order). */
  advance(ms: number): void {
    this.now += ms;
    const due = this.q.filter((t) => t.due <= this.now).sort((a, b) => a.due - b.due);
    this.q = this.q.filter((t) => t.due > this.now);
    for (const t of due) t.fn();
  }
}

// Stand-in document — the controller only passes it through to serialize().
function doc(id: string): FlashDocument {
  return { id } as unknown as FlashDocument;
}

describe("AutosaveController (debounce)", () => {
  let clock: FakeClock;
  beforeEach(() => {
    clock = new FakeClock();
  });

  it("debounces: only the latest doc within the quiet period is persisted", async () => {
    const persisted: string[] = [];
    const c = new AutosaveController({
      serialize: (d) => new TextEncoder().encode((d as { id: string }).id),
      persist: async (b) => { persisted.push(new TextDecoder().decode(b)); },
      delayMs: 1000,
      timers: clock.timers,
    });

    c.schedule(doc("a"));
    clock.advance(500);
    c.schedule(doc("b"));
    clock.advance(500); // 1000ms since "a" but only 500ms since "b" → no fire yet
    expect(persisted).toEqual([]);
    clock.advance(500); // now 1000ms quiet since "b"
    await Promise.resolve();
    await Promise.resolve();
    expect(persisted).toEqual(["b"]);
  });

  it("fires once after the quiet period for a single edit", async () => {
    const persisted: string[] = [];
    const c = new AutosaveController({
      serialize: (d) => new TextEncoder().encode((d as { id: string }).id),
      persist: async (b) => { persisted.push(new TextDecoder().decode(b)); },
      delayMs: 1500,
      timers: clock.timers,
    });
    c.schedule(doc("only"));
    clock.advance(1499);
    expect(persisted).toEqual([]);
    clock.advance(1);
    await Promise.resolve();
    expect(persisted).toEqual(["only"]);
  });

  it("flush() persists immediately, bypassing the debounce", async () => {
    const persisted: string[] = [];
    const c = new AutosaveController({
      serialize: (d) => new TextEncoder().encode((d as { id: string }).id),
      persist: async (b) => { persisted.push(new TextDecoder().decode(b)); },
      delayMs: 5000,
      timers: clock.timers,
    });
    c.schedule(doc("urgent"));
    await c.flush();
    expect(persisted).toEqual(["urgent"]);
    // The pending timer was cleared, so advancing does not double-save.
    clock.advance(5000);
    await Promise.resolve();
    expect(persisted).toEqual(["urgent"]);
  });

  it("cancel() drops the pending save", async () => {
    const persisted: string[] = [];
    const c = new AutosaveController({
      serialize: (d) => new TextEncoder().encode((d as { id: string }).id),
      persist: async (b) => { persisted.push(new TextDecoder().decode(b)); },
      delayMs: 1000,
      timers: clock.timers,
    });
    c.schedule(doc("x"));
    c.cancel();
    clock.advance(2000);
    await Promise.resolve();
    expect(persisted).toEqual([]);
  });

  it("reports persist errors via onError without throwing", async () => {
    const errors: unknown[] = [];
    const c = new AutosaveController({
      serialize: () => new Uint8Array([1]),
      persist: async () => { throw new Error("quota"); },
      delayMs: 100,
      timers: clock.timers,
      onError: (e) => errors.push(e),
    });
    c.schedule(doc("x"));
    clock.advance(100);
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("quota");
  });

  it("calls onSaved after a successful persist", async () => {
    let savedBytes: Uint8Array | null = null;
    const c = new AutosaveController({
      serialize: () => new Uint8Array([7, 8, 9]),
      persist: async () => {},
      delayMs: 100,
      timers: clock.timers,
      onSaved: (b) => { savedBytes = b; },
    });
    c.schedule(doc("x"));
    clock.advance(100);
    await Promise.resolve();
    expect(savedBytes).not.toBeNull();
    expect(Array.from(savedBytes!)).toEqual([7, 8, 9]);
  });
});
