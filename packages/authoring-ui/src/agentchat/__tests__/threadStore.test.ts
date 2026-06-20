import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentRunState } from "../agentLoop.js";

const STORAGE_KEY = "flash8.agentThreads";

// The authoring-ui vitest environment is "node" (no DOM), so install a minimal
// in-memory localStorage before importing the module under test. A throwing
// variant is swapped in for the quota-failure cases.
class MemoryStorage {
  store = new Map<string, string>();
  throwOnSet = false;
  /** Count of successful setItem calls (task 1293: bound per-delta writes). */
  setCount = 0;
  getItem(k: string) {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.throwOnSet) {
      const e = new Error("QuotaExceededError");
      e.name = "QuotaExceededError";
      throw e;
    }
    this.setCount += 1;
    this.store.set(k, String(v));
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

const hadLocalStorage = "localStorage" in globalThis;
const mem = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = mem;

const mod = await import("../threadStore.js");
const {
  useThreadStore,
  loadThreads,
  saveThreads,
  boundForStorage,
  deriveTitle,
  selectThreadsByRecency,
  selectActiveThread,
  DEFAULT_THREAD_TITLE,
  MAX_THREADS,
  MAX_TURNS_PER_THREAD,
  MAX_TITLE_LEN,
} = mod;

afterAll(() => {
  if (!hadLocalStorage) {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  }
});

/** Reset the live zustand store + storage to a clean empty state per test. */
function resetStore(): void {
  mem.throwOnSet = false;
  mem.clear();
  mem.setCount = 0;
  useThreadStore.setState({ threads: [], activeThreadId: null });
}

const runningRun: AgentRunState = { entries: [], status: "running" };

const doneRun: AgentRunState = {
  entries: [{ kind: "text", id: "t1", text: "hello" }],
  status: "done",
};

beforeEach(() => {
  resetStore();
});

describe("deriveTitle", () => {
  it("uses the first user message, collapsing whitespace", () => {
    expect(deriveTitle("  draw   a\n red  rect ")).toBe("draw a red rect");
  });

  it("falls back to the default for blank input", () => {
    expect(deriveTitle("")).toBe(DEFAULT_THREAD_TITLE);
    expect(deriveTitle("   \n\t ")).toBe(DEFAULT_THREAD_TITLE);
  });

  it("truncates long messages with an ellipsis", () => {
    const long = "x".repeat(200);
    const title = deriveTitle(long);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LEN);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("new / select / clear / delete", () => {
  it("newThread creates an empty active thread", () => {
    const id = useThreadStore.getState().newThread();
    const s = useThreadStore.getState();
    expect(s.activeThreadId).toBe(id);
    expect(s.threads).toHaveLength(1);
    const t = selectActiveThread(s)!;
    expect(t.title).toBe(DEFAULT_THREAD_TITLE);
    expect(t.transcript).toEqual([]);
    expect(t.history).toEqual([]);
  });

  it("appendUserAndAssistant records turns + history and derives the title", () => {
    const st = useThreadStore.getState();
    const id = st.newThread();
    st.appendUserAndAssistant(
      { role: "user", id: "u1", text: "build a game" },
      { role: "assistant", id: "a1", run: { entries: [], status: "running" } },
      { role: "user", content: "build a game" }
    );
    const t = useThreadStore.getState().threads.find((x) => x.id === id)!;
    expect(t.title).toBe("build a game");
    expect(t.transcript.map((x) => x.role)).toEqual(["user", "assistant"]);
    expect(t.history).toEqual([{ role: "user", content: "build a game" }]);
  });

  it("appendUserAndAssistant creates an active thread when none exists", () => {
    expect(useThreadStore.getState().activeThreadId).toBeNull();
    useThreadStore.getState().appendUserAndAssistant(
      { role: "user", id: "u1", text: "hi" },
      { role: "assistant", id: "a1", run: { entries: [], status: "running" } },
      { role: "user", content: "hi" }
    );
    const s = useThreadStore.getState();
    expect(s.activeThreadId).not.toBeNull();
    expect(s.threads).toHaveLength(1);
  });

  it("patchAssistantRun updates the streaming run on its origin thread", () => {
    const st = useThreadStore.getState();
    const id = st.newThread();
    st.appendUserAndAssistant(
      { role: "user", id: "u1", text: "hi" },
      { role: "assistant", id: "a1", run: { entries: [], status: "running" } },
      { role: "user", content: "hi" }
    );
    st.patchAssistantRun(id, "a1", doneRun);
    const t = selectActiveThread(useThreadStore.getState())!;
    const assistant = t.transcript.find((x) => x.role === "assistant")!;
    expect(assistant.role).toBe("assistant");
    if (assistant.role === "assistant") {
      expect(assistant.run.status).toBe("done");
    }
  });

  it("selectThread switches the active thread; unknown id is a no-op", () => {
    const st = useThreadStore.getState();
    const a = st.newThread();
    const b = st.newThread();
    expect(useThreadStore.getState().activeThreadId).toBe(b);
    st.selectThread(a);
    expect(useThreadStore.getState().activeThreadId).toBe(a);
    st.selectThread("does-not-exist");
    expect(useThreadStore.getState().activeThreadId).toBe(a);
  });

  it("clearActiveThread empties the transcript/history but keeps the thread + id", () => {
    const st = useThreadStore.getState();
    const id = st.newThread();
    st.appendUserAndAssistant(
      { role: "user", id: "u1", text: "hi" },
      { role: "assistant", id: "a1", run: { entries: [], status: "running" } },
      { role: "user", content: "hi" }
    );
    st.clearActiveThread();
    const s = useThreadStore.getState();
    expect(s.activeThreadId).toBe(id);
    expect(s.threads).toHaveLength(1);
    const t = s.threads[0];
    expect(t.transcript).toEqual([]);
    expect(t.history).toEqual([]);
    expect(t.title).toBe(DEFAULT_THREAD_TITLE);
  });

  it("deleteThread removes a thread; deleting the active one falls back to the most recent", () => {
    const st = useThreadStore.getState();
    const a = st.newThread();
    // Make `a` the most-recently updated by giving it activity, then create b.
    const b = st.newThread();
    st.selectThread(b);
    st.deleteThread(b);
    // After deleting the active `b`, the active id falls back to a surviving thread.
    expect(useThreadStore.getState().activeThreadId).toBe(a);
    expect(useThreadStore.getState().threads.map((t) => t.id)).toEqual([a]);
    st.deleteThread(a);
    expect(useThreadStore.getState().threads).toHaveLength(0);
    expect(useThreadStore.getState().activeThreadId).toBeNull();
  });
});

describe("persistence round-trip through localStorage", () => {
  it("writes to localStorage and reloads identical state", () => {
    const st = useThreadStore.getState();
    const id = st.newThread();
    st.appendUserAndAssistant(
      { role: "user", id: "u1", text: "draw a circle" },
      { role: "assistant", id: "a1", run: doneRun },
      { role: "user", content: "draw a circle" }
    );
    // The store persisted on every mutation; loadThreads reads it back.
    const reloaded = loadThreads();
    expect(reloaded.activeThreadId).toBe(id);
    expect(reloaded.threads).toHaveLength(1);
    expect(reloaded.threads[0].title).toBe("draw a circle");
    expect(reloaded.threads[0].transcript).toHaveLength(2);
    expect(reloaded.threads[0].history).toEqual([
      { role: "user", content: "draw a circle" },
    ]);
  });

  it("restores the active thread on a simulated remount (re-read from storage)", () => {
    const st = useThreadStore.getState();
    const a = st.newThread();
    const b = st.newThread();
    st.selectThread(a);
    // Simulate a page reload: a fresh read of persisted state.
    const reloaded = loadThreads();
    expect(reloaded.activeThreadId).toBe(a);
    expect(reloaded.threads.map((t) => t.id).sort()).toEqual([a, b].sort());
  });

  it("returns an empty store when nothing is persisted", () => {
    mem.clear();
    expect(loadThreads()).toEqual({ threads: [], activeThreadId: null });
  });
});

describe("parse / quota failure fallback", () => {
  it("falls back to an empty store on malformed JSON", () => {
    mem.setItem(STORAGE_KEY, "{not valid json");
    expect(loadThreads()).toEqual({ threads: [], activeThreadId: null });
  });

  it("ignores non-object persisted payloads", () => {
    mem.setItem(STORAGE_KEY, JSON.stringify(42));
    expect(loadThreads()).toEqual({ threads: [], activeThreadId: null });
  });

  it("drops malformed threads and repairs a dangling activeThreadId", () => {
    mem.setItem(
      STORAGE_KEY,
      JSON.stringify({
        threads: [
          { id: "ok", title: "Kept", transcript: [], history: [], createdAt: 1, updatedAt: 2 },
          { notAThread: true },
          null,
        ],
        activeThreadId: "missing",
      })
    );
    const loaded = loadThreads();
    expect(loaded.threads).toHaveLength(1);
    expect(loaded.threads[0].id).toBe("ok");
    // The dangling active id was repaired to the surviving thread.
    expect(loaded.activeThreadId).toBe("ok");
  });

  it("saveThreads never throws on a quota error", () => {
    mem.throwOnSet = true;
    expect(() =>
      saveThreads({
        threads: [
          {
            id: "x",
            title: "t",
            transcript: [],
            history: [],
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        activeThreadId: "x",
      })
    ).not.toThrow();
  });

  it("store mutations never throw when storage rejects writes (quota)", () => {
    mem.throwOnSet = true;
    expect(() => useThreadStore.getState().newThread()).not.toThrow();
    // In-memory state still updated even though the write was rejected.
    expect(useThreadStore.getState().threads).toHaveLength(1);
  });
});

describe("storage bounding (quota hygiene)", () => {
  it("keeps only the MAX_THREADS most-recently-updated threads", () => {
    const threads = Array.from({ length: MAX_THREADS + 5 }, (_, i) => ({
      id: `t${i}`,
      title: `T${i}`,
      transcript: [],
      history: [],
      createdAt: i,
      updatedAt: i, // higher index = more recent
    }));
    const bounded = boundForStorage({ threads, activeThreadId: "t0" });
    expect(bounded.threads).toHaveLength(MAX_THREADS);
    // The oldest (t0) is dropped; the newest is kept.
    expect(bounded.threads.some((t) => t.id === "t0")).toBe(false);
    expect(bounded.threads[0].id).toBe(`t${MAX_THREADS + 4}`);
    // activeThreadId pointing at a dropped thread is repaired.
    expect(bounded.threads.some((t) => t.id === bounded.activeThreadId)).toBe(
      true
    );
  });

  it("trims an oversized transcript to the most recent MAX_TURNS_PER_THREAD", () => {
    const transcript = Array.from(
      { length: MAX_TURNS_PER_THREAD + 50 },
      (_, i) => ({ role: "user" as const, id: `u${i}`, text: `m${i}` })
    );
    const bounded = boundForStorage({
      threads: [
        {
          id: "big",
          title: "Big",
          transcript,
          history: [],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      activeThreadId: "big",
    });
    expect(bounded.threads[0].transcript).toHaveLength(MAX_TURNS_PER_THREAD);
    // The most-recent turn is preserved (oldest dropped).
    const last = bounded.threads[0].transcript.at(-1)!;
    expect(last.id).toBe(`u${MAX_TURNS_PER_THREAD + 49}`);
  });
});

describe("thread-scoped streaming patches (task 1293 correctness)", () => {
  it("keeps patching the ORIGIN thread after the active thread switches", () => {
    const st = useThreadStore.getState();
    const a = st.newThread();
    st.appendUserAndAssistant(
      { role: "user", id: "u1", text: "on A" },
      { role: "assistant", id: "a1", run: runningRun },
      { role: "user", content: "on A" }
    );
    // A run is in flight on thread A; the user opens/switches to a new thread B.
    const b = st.newThread();
    expect(useThreadStore.getState().activeThreadId).toBe(b);

    // A streaming delta arrives — it must land on A (origin), NOT B (active).
    st.patchAssistantRun(a, "a1", {
      entries: [{ kind: "text", id: "t1", text: "partial" }],
      status: "running",
    });
    // And the terminal patch too.
    st.patchAssistantRun(a, "a1", doneRun);

    const threadA = useThreadStore.getState().threads.find((t) => t.id === a)!;
    const assistantA = threadA.transcript.find((x) => x.role === "assistant")!;
    expect(assistantA.role).toBe("assistant");
    if (assistantA.role === "assistant") {
      expect(assistantA.run.status).toBe("done");
    }
    // Thread B is untouched (still empty).
    const threadB = useThreadStore.getState().threads.find((t) => t.id === b)!;
    expect(threadB.transcript).toEqual([]);
  });

  it("is a no-op for an unknown threadId", () => {
    const st = useThreadStore.getState();
    const a = st.newThread();
    st.appendUserAndAssistant(
      { role: "user", id: "u1", text: "hi" },
      { role: "assistant", id: "a1", run: runningRun },
      { role: "user", content: "hi" }
    );
    expect(() => st.patchAssistantRun("ghost-thread", "a1", doneRun)).not.toThrow();
    const threadA = useThreadStore.getState().threads.find((t) => t.id === a)!;
    const assistantA = threadA.transcript.find((x) => x.role === "assistant")!;
    if (assistantA.role === "assistant") {
      expect(assistantA.run.status).toBe("running");
    }
  });
});

describe("persist-on-terminal only (task 1293 perf/durability)", () => {
  it("does NOT write to localStorage per streaming delta, but DOES on terminal", () => {
    const st = useThreadStore.getState();
    const a = st.newThread();
    st.appendUserAndAssistant(
      { role: "user", id: "u1", text: "go" },
      { role: "assistant", id: "a1", run: runningRun },
      { role: "user", content: "go" }
    );
    // Baseline: structural mutations above DID persist.
    const baseline = mem.setCount;
    expect(baseline).toBeGreaterThan(0);

    // Many streaming deltas (all non-terminal `running`) must add ZERO writes.
    for (let i = 0; i < 50; i++) {
      st.patchAssistantRun(a, "a1", {
        entries: [{ kind: "text", id: "t1", text: "x".repeat(i) }],
        status: "running",
      });
    }
    expect(mem.setCount).toBe(baseline);

    // In-memory UI state still reflects the latest delta.
    const live = useThreadStore.getState().threads.find((t) => t.id === a)!;
    const liveAssistant = live.transcript.find((x) => x.role === "assistant")!;
    if (liveAssistant.role === "assistant") {
      expect(liveAssistant.run.entries).toHaveLength(1);
    }

    // The terminal patch persists exactly once.
    st.patchAssistantRun(a, "a1", doneRun);
    expect(mem.setCount).toBe(baseline + 1);

    // And the persisted snapshot carries the terminal (done) run.
    const reloaded = loadThreads();
    const reloadedAssistant = reloaded.threads
      .find((t) => t.id === a)!
      .transcript.find((x) => x.role === "assistant")!;
    if (reloadedAssistant.role === "assistant") {
      expect(reloadedAssistant.run.status).toBe("done");
    }
  });

  it("persists each terminal status (done/error/stopped)", () => {
    for (const status of ["done", "error", "stopped"] as const) {
      resetStore();
      const st = useThreadStore.getState();
      const a = st.newThread();
      st.appendUserAndAssistant(
        { role: "user", id: "u1", text: "go" },
        { role: "assistant", id: "a1", run: runningRun },
        { role: "user", content: "go" }
      );
      const baseline = mem.setCount;
      st.patchAssistantRun(a, "a1", { entries: [], status });
      expect(mem.setCount).toBe(baseline + 1);
    }
  });
});

describe("hydrate coerces a mid-run 'running' to terminal (task 1293)", () => {
  it("turns a persisted 'running' assistant run into 'stopped' on load", () => {
    // Simulate a mid-stream page refresh: persisted state has a `running` run.
    mem.setItem(
      STORAGE_KEY,
      JSON.stringify({
        threads: [
          {
            id: "mid",
            title: "Interrupted",
            transcript: [
              { role: "user", id: "u1", text: "go" },
              {
                role: "assistant",
                id: "a1",
                run: {
                  entries: [{ kind: "text", id: "t1", text: "half" }],
                  status: "running",
                },
              },
            ],
            history: [{ role: "user", content: "go" }],
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        activeThreadId: "mid",
      })
    );
    const loaded = loadThreads();
    const assistant = loaded.threads[0].transcript.find(
      (x) => x.role === "assistant"
    )!;
    expect(assistant.role).toBe("assistant");
    if (assistant.role === "assistant") {
      expect(assistant.run.status).toBe("stopped");
      // The partial text is preserved — only the status is coerced.
      expect(assistant.run.entries).toHaveLength(1);
    }
  });

  it("leaves already-terminal runs untouched on load", () => {
    mem.setItem(
      STORAGE_KEY,
      JSON.stringify({
        threads: [
          {
            id: "done",
            title: "Finished",
            transcript: [
              { role: "user", id: "u1", text: "go" },
              { role: "assistant", id: "a1", run: doneRun },
            ],
            history: [],
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        activeThreadId: "done",
      })
    );
    const loaded = loadThreads();
    const assistant = loaded.threads[0].transcript.find(
      (x) => x.role === "assistant"
    )!;
    if (assistant.role === "assistant") {
      expect(assistant.run.status).toBe("done");
    }
  });
});

// Adversarial-persistence guard (mirrors the 1316/1317 bug classes applied to
// the chat-thread surface): prove there is NO lost-on-close window, NO stale/
// wrong-target write when a run finalizes after a switch/delete, and NO id
// canonicalization asymmetry. These are the close/switch/finalize paths the
// happy-path suite above does not adversarially exercise.
describe("adversarial persistence (1316/1317 classes)", () => {
  // CLASS 1 — lost-on-close / flush-before-debounce.
  it("persists the completed user message + assistant turn at SEND, before any stream (close-mid-flight loses nothing)", () => {
    const st = useThreadStore.getState();
    const id = st.newThread();
    // submitMessage appends user+assistant synchronously BEFORE awaiting runTurn.
    st.appendUserAndAssistant(
      { role: "user", id: "u1", text: "save me" },
      { role: "assistant", id: "a1", run: runningRun },
      { role: "user", content: "save me" }
    );
    // SIMULATE A TAB CLOSE NOW: no await, no terminal patch. Re-read storage.
    const reloaded = loadThreads();
    const t = reloaded.threads.find((x) => x.id === id)!;
    const user = t.transcript.find((x) => x.role === "user");
    expect(user && user.role === "user" && user.text).toBe("save me");
    expect(t.history).toEqual([{ role: "user", content: "save me" }]);
    // A persisted mid-stream `running` run is coerced to `stopped` (never lost,
    // never stuck "Working…").
    const a = t.transcript.find((x) => x.role === "assistant");
    if (a && a.role === "assistant") expect(a.run.status).toBe("stopped");
  });

  // CLASS 2 — stale-write-race / wrong-target.
  it("a terminal run finalizing AFTER the user switched to B lands on its origin A and never clobbers B", () => {
    const st = useThreadStore.getState();
    const a = st.newThread();
    st.appendUserAndAssistant(
      { role: "user", id: "u1", text: "on A" },
      { role: "assistant", id: "a1", run: runningRun },
      { role: "user", content: "on A" }
    );
    const b = st.newThread();
    st.appendUserAndAssistant(
      { role: "user", id: "u2", text: "on B" },
      { role: "assistant", id: "b1", run: runningRun },
      { role: "user", content: "on B" }
    );
    // A's run finalizes (the panel targets the captured origin id explicitly).
    st.patchAssistantRun(a, "a1", doneRun);
    const persisted = loadThreads();
    const ta = persisted.threads.find((x) => x.id === a)!;
    const tb = persisted.threads.find((x) => x.id === b)!;
    const aA = ta.transcript.find((x) => x.role === "assistant");
    if (aA && aA.role === "assistant") expect(aA.run.status).toBe("done");
    // B's own content is untouched by A's finalizing run.
    const uB = tb.transcript.find((x) => x.role === "user");
    expect(uB && uB.role === "user" && uB.text).toBe("on B");
  });

  it("deleting the origin thread mid-run makes the terminal patch a safe no-op (no resurrect, no throw, no cross-write)", () => {
    const st = useThreadStore.getState();
    const a = st.newThread();
    st.appendUserAndAssistant(
      { role: "user", id: "u1", text: "doomed" },
      { role: "assistant", id: "a1", run: runningRun },
      { role: "user", content: "doomed" }
    );
    const b = st.newThread(); // b becomes active
    st.deleteThread(a); // delete the now-non-active origin
    expect(() => st.patchAssistantRun(a, "a1", doneRun)).not.toThrow();
    const persisted = loadThreads();
    expect(persisted.threads.find((x) => x.id === a)).toBeUndefined();
    expect(persisted.threads.find((x) => x.id === b)).toBeDefined();
  });

  // CLASS 3 — key/canonicalization mismatch.
  it("thread ids are matched EXACTLY (no trim/normalize on either side), so a near-miss id never cross-writes", () => {
    const st = useThreadStore.getState();
    const a = st.newThread();
    st.appendUserAndAssistant(
      { role: "user", id: "u1", text: "hi" },
      { role: "assistant", id: "a1", run: runningRun },
      { role: "user", content: "hi" }
    );
    // A trailing-space variant must NOT match (asymmetric normalization would be
    // the 1317 Bug-A class).
    st.patchAssistantRun(a + " ", "a1", doneRun);
    const t1 = useThreadStore.getState().threads.find((x) => x.id === a)!;
    const a1 = t1.transcript.find((x) => x.role === "assistant");
    if (a1 && a1.role === "assistant") expect(a1.run.status).toBe("running");
    // The exact id matches.
    st.patchAssistantRun(a, "a1", doneRun);
    const t2 = useThreadStore.getState().threads.find((x) => x.id === a)!;
    const a2 = t2.transcript.find((x) => x.role === "assistant");
    if (a2 && a2.role === "assistant") expect(a2.run.status).toBe("done");
  });
});

describe("selectors", () => {
  it("selectThreadsByRecency sorts most-recent first", () => {
    useThreadStore.setState({
      threads: [
        { id: "old", title: "Old", transcript: [], history: [], createdAt: 1, updatedAt: 1 },
        { id: "new", title: "New", transcript: [], history: [], createdAt: 2, updatedAt: 9 },
        { id: "mid", title: "Mid", transcript: [], history: [], createdAt: 3, updatedAt: 5 },
      ],
      activeThreadId: "new",
    });
    const ordered = selectThreadsByRecency(useThreadStore.getState());
    expect(ordered.map((t) => t.id)).toEqual(["new", "mid", "old"]);
  });
});
