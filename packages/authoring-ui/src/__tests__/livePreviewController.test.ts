import { describe, it, expect, vi } from "vitest";
import {
  LivePreviewController,
  type LivePreviewSnapshot,
} from "../preview/livePreviewController.js";

/**
 * A controllable fake timer + clock so the debounce/supersede semantics are
 * tested deterministically (no real timeouts, no flakiness).
 */
function makeHarness() {
  let nowMs = 0;
  type Pending = { id: number; fn: () => void; at: number };
  let nextId = 1;
  const pending: Pending[] = [];
  const snapshots: LivePreviewSnapshot[] = [];

  const setTimeoutFn = (fn: () => void, ms: number) => {
    const p = { id: nextId++, fn, at: nowMs + ms };
    pending.push(p);
    return p.id;
  };
  const clearTimeoutFn = (handle: unknown) => {
    const idx = pending.findIndex((p) => p.id === handle);
    if (idx >= 0) pending.splice(idx, 1);
  };
  const now = () => nowMs;

  /** Advance the clock and fire any timers that are now due. */
  const advance = (ms: number) => {
    nowMs += ms;
    const due = pending.filter((p) => p.at <= nowMs);
    for (const p of due) {
      const i = pending.indexOf(p);
      if (i >= 0) pending.splice(i, 1);
      p.fn();
    }
  };

  return { setTimeoutFn, clearTimeoutFn, now, advance, snapshots, setNow: (n: number) => (nowMs = n) };
}

const bytes = (n: number) => new Uint8Array([n]);

describe("LivePreviewController — debounce", () => {
  it("coalesces rapid requests into a single trailing compile", async () => {
    const h = makeHarness();
    const compileFn = vi.fn(async () => bytes(1));
    const ctl = new LivePreviewController({
      compileFn,
      onChange: (s) => h.snapshots.push(s),
      debounceMs: 300,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
      now: h.now,
    });

    ctl.request();
    h.advance(100);
    ctl.request();
    h.advance(100);
    ctl.request();
    // Not yet — debounce window not elapsed since the last request.
    expect(compileFn).not.toHaveBeenCalled();
    h.advance(300);
    await Promise.resolve();
    expect(compileFn).toHaveBeenCalledTimes(1);
  });

  it("immediate request bypasses the debounce", async () => {
    const h = makeHarness();
    const compileFn = vi.fn(async () => bytes(1));
    const ctl = new LivePreviewController({
      compileFn,
      onChange: () => {},
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
      now: h.now,
    });
    ctl.request({ immediate: true });
    expect(compileFn).toHaveBeenCalledTimes(1);
  });
});

describe("LivePreviewController — supersede", () => {
  it("discards a superseded in-flight compile; only the newest publishes", async () => {
    const h = makeHarness();
    // First compile resolves slowly; second resolves immediately.
    const resolvers: Array<(b: Uint8Array) => void> = [];
    const compileFn = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const ctl = new LivePreviewController({
      compileFn,
      onChange: (s) => h.snapshots.push(s),
      debounceMs: 0,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
      now: h.now,
    });

    // Start compile #1 immediately.
    ctl.request({ immediate: true });
    expect(compileFn).toHaveBeenCalledTimes(1);
    // Start compile #2 immediately (supersedes #1, which is still pending).
    ctl.request({ immediate: true });
    expect(compileFn).toHaveBeenCalledTimes(2);

    // Resolve #2 first (the newest): it should publish.
    resolvers[1](bytes(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(ctl.getSnapshot().swfBytes).toEqual(bytes(2));
    expect(ctl.getSnapshot().status).toBe("up-to-date");

    // Now resolve the STALE #1: it must NOT overwrite #2.
    resolvers[0](bytes(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(ctl.getSnapshot().swfBytes).toEqual(bytes(2));
  });
});

describe("LivePreviewController — error keeps last good", () => {
  it("retains the last good SWF and surfaces the error on compile failure", async () => {
    const h = makeHarness();
    let mode: "ok" | "fail" = "ok";
    const compileFn = vi.fn(async () => {
      if (mode === "fail") throw new Error("Unexpected token at line 3");
      return bytes(42);
    });
    const ctl = new LivePreviewController({
      compileFn,
      onChange: (s) => h.snapshots.push(s),
      debounceMs: 0,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
      now: h.now,
    });

    // First compile succeeds → last good = bytes(42).
    ctl.request({ immediate: true });
    await flush();
    expect(ctl.getSnapshot().status).toBe("up-to-date");
    expect(ctl.getSnapshot().swfBytes).toEqual(bytes(42));

    // Second compile fails → error surfaced, last good RETAINED.
    mode = "fail";
    ctl.request({ immediate: true });
    await flush();
    const snap = ctl.getSnapshot();
    expect(snap.status).toBe("error");
    expect(snap.error).toContain("Unexpected token");
    expect(snap.swfBytes).toEqual(bytes(42)); // unchanged — preview stays on last good

    // Recovery: a subsequent success clears the error and swaps bytes.
    mode = "ok";
    const compileOk = vi.fn(async () => bytes(7));
    // swap the compile fn for a new good output by recreating with same harness
    const ctl2 = new LivePreviewController({
      compileFn: compileOk,
      onChange: () => {},
      debounceMs: 0,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
      now: h.now,
    });
    ctl2.request({ immediate: true });
    await flush();
    expect(ctl2.getSnapshot().status).toBe("up-to-date");
    expect(ctl2.getSnapshot().error).toBeNull();
    expect(ctl2.getSnapshot().swfBytes).toEqual(bytes(7));
  });

  it("records swfSize and compileMs on success", async () => {
    const h = makeHarness();
    const compileFn = vi.fn(async () => {
      h.setNow(120); // simulate 120ms elapsed during the await
      return new Uint8Array([0, 0, 0, 0, 0]);
    });
    const ctl = new LivePreviewController({
      compileFn,
      onChange: () => {},
      debounceMs: 0,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
      now: h.now,
    });
    ctl.request({ immediate: true });
    await flush();
    expect(ctl.getSnapshot().swfSize).toBe(5);
    expect(ctl.getSnapshot().compileMs).toBe(120);
  });
});

describe("LivePreviewController — dispose", () => {
  it("does not publish after dispose", async () => {
    const h = makeHarness();
    let resolve!: (b: Uint8Array) => void;
    const compileFn = vi.fn(
      () => new Promise<Uint8Array>((r) => (resolve = r))
    );
    const onChange = vi.fn();
    const ctl = new LivePreviewController({
      compileFn,
      onChange,
      debounceMs: 0,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
      now: h.now,
    });
    ctl.request({ immediate: true });
    ctl.dispose();
    resolve(bytes(9));
    await flush();
    // The compiling snapshot may have fired, but no up-to-date publish after dispose.
    expect(ctl.getSnapshot().status).not.toBe("up-to-date");
  });

  it("a pending debounced compile is cancelled by dispose", () => {
    const h = makeHarness();
    const compileFn = vi.fn(async () => bytes(1));
    const ctl = new LivePreviewController({
      compileFn,
      onChange: () => {},
      debounceMs: 300,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
      now: h.now,
    });
    ctl.request();
    ctl.dispose();
    h.advance(500);
    expect(compileFn).not.toHaveBeenCalled();
  });
});

async function flush() {
  // Let microtasks settle (the async compile + chained .then handlers).
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
