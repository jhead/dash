// Unit tests for the Agent Chat run loop (Phase 3, task 1278).
//
// The fullStream -> UI reducer is the heart of the panel: it folds AI SDK v6
// TextStreamParts (text/reasoning/tool-call/tool-result/tool-error/step/abort/
// error/finish) into a renderable transcript. These tests drive it with a
// MOCKED async stream of parts — no real API key / network — covering each
// part type and the terminal-status precedence rules.

import { describe, it, expect } from "vitest";
import type { TextStreamPart, ToolSet } from "ai";
import {
  reduceAgentEvent,
  initialAgentRunState,
  drivePartStream,
  agentErrorMessage,
  classifyAgentError,
  clampMaxSteps,
  DEFAULT_MAX_STEPS,
  MAX_STEPS_LIMIT,
  MIN_MAX_STEPS,
  type AgentRunState,
  type AgentToolEntry,
  type AgentTextEntry,
  type AgentReasoningEntry,
} from "../agentLoop.js";

type Part = TextStreamPart<ToolSet>;

/** Fold a sequence of parts through the pure reducer. */
function fold(parts: Part[]): AgentRunState {
  return parts.reduce(reduceAgentEvent, initialAgentRunState());
}

/** A mock async fullStream of parts. */
async function* mockStream(parts: Part[]): AsyncIterable<Part> {
  for (const p of parts) yield p;
}

/** A mock stream that throws after emitting some parts (fast-abort path). */
async function* throwingStream(
  parts: Part[],
  err: unknown
): AsyncIterable<Part> {
  for (const p of parts) yield p;
  throw err;
}

describe("reduceAgentEvent — text", () => {
  it("accumulates text-delta with the same id into one block", () => {
    const state = fold([
      { type: "start-step" } as Part,
      { type: "text-delta", id: "t1", text: "Hello" } as Part,
      { type: "text-delta", id: "t1", text: ", world" } as Part,
      { type: "finish", finishReason: "stop" } as unknown as Part,
    ]);
    const texts = state.entries.filter(
      (e): e is AgentTextEntry => e.kind === "text"
    );
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe("Hello, world");
    expect(state.status).toBe("done");
  });

  it("starts a new text block for a new id", () => {
    const state = fold([
      { type: "text-delta", id: "a", text: "one" } as Part,
      { type: "text-delta", id: "b", text: "two" } as Part,
    ]);
    const texts = state.entries.filter((e) => e.kind === "text");
    expect(texts).toHaveLength(2);
  });
});

describe("reduceAgentEvent — reasoning (thinking)", () => {
  it("accumulates reasoning-delta into a reasoning block", () => {
    const state = fold([
      { type: "reasoning-delta", id: "r1", text: "Let me " } as Part,
      { type: "reasoning-delta", id: "r1", text: "think." } as Part,
    ]);
    const reasoning = state.entries.filter(
      (e): e is AgentReasoningEntry => e.kind === "reasoning"
    );
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].text).toBe("Let me think.");
  });
});

describe("reduceAgentEvent — tool call/result/error", () => {
  it("creates a running chip on tool-call and resolves it on tool-result", () => {
    const state = fold([
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "doc_summary",
        input: { foo: 1 },
      } as unknown as Part,
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "doc_summary",
        input: { foo: 1 },
        output: { rev: 5 },
      } as unknown as Part,
    ]);
    const tool = state.entries.find(
      (e): e is AgentToolEntry => e.kind === "tool"
    );
    expect(tool).toBeDefined();
    expect(tool!.toolName).toBe("doc_summary");
    expect(tool!.input).toEqual({ foo: 1 });
    expect(tool!.status).toBe("result");
    expect(tool!.output).toEqual({ rev: 5 });
  });

  it("marks the chip errored on tool-error", () => {
    const state = fold([
      {
        type: "tool-call",
        toolCallId: "c2",
        toolName: "doc_get",
        input: {},
      } as unknown as Part,
      {
        type: "tool-error",
        toolCallId: "c2",
        toolName: "doc_get",
        input: {},
        error: new Error("boom"),
      } as unknown as Part,
    ]);
    const tool = state.entries.find(
      (e): e is AgentToolEntry => e.kind === "tool"
    )!;
    expect(tool.status).toBe("error");
    expect(tool.error).toBe("boom");
  });

  it("matches results to the right call by toolCallId across interleaved calls", () => {
    const state = fold([
      { type: "tool-call", toolCallId: "a", toolName: "x", input: {} } as unknown as Part,
      { type: "tool-call", toolCallId: "b", toolName: "y", input: {} } as unknown as Part,
      { type: "tool-result", toolCallId: "a", toolName: "x", input: {}, output: 1 } as unknown as Part,
      { type: "tool-result", toolCallId: "b", toolName: "y", input: {}, output: 2 } as unknown as Part,
    ]);
    const tools = state.entries.filter(
      (e): e is AgentToolEntry => e.kind === "tool"
    );
    expect(tools.map((t) => t.output)).toEqual([1, 2]);
  });
});

describe("reduceAgentEvent — step boundaries", () => {
  it("emits a numbered step marker per start-step", () => {
    const state = fold([
      { type: "start-step" } as Part,
      { type: "text-delta", id: "t", text: "a" } as Part,
      { type: "start-step" } as Part,
      { type: "text-delta", id: "u", text: "b" } as Part,
    ]);
    const steps = state.entries.filter((e) => e.kind === "step");
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => (s as { step: number }).step)).toEqual([1, 2]);
  });
});

describe("reduceAgentEvent — terminal status", () => {
  it("flips to done on finish", () => {
    const state = fold([
      { type: "start" } as Part,
      { type: "finish", finishReason: "stop" } as unknown as Part,
    ]);
    expect(state.status).toBe("done");
  });

  it("flips to stopped on abort and a trailing finish does NOT override it", () => {
    const state = fold([
      { type: "text-delta", id: "t", text: "partial" } as Part,
      { type: "abort", reason: "user" } as Part,
      { type: "finish", finishReason: "stop" } as unknown as Part,
    ]);
    expect(state.status).toBe("stopped");
  });

  it("flips to error and records the message", () => {
    const state = fold([
      { type: "error", error: new Error("network down") } as Part,
    ]);
    expect(state.status).toBe("error");
    expect(state.error).toBe("network down");
  });
});

describe("step cap — value + configurability (task 1305)", () => {
  it("defaults to a generous backstop (not the old 24) but stays bounded", () => {
    // The user report was the 24-step cap cutting long tasks off mid-work. The
    // default is raised substantially; pin the contract so it can't silently
    // regress back to a tiny value, and assert it's a real bound (never ∞).
    expect(DEFAULT_MAX_STEPS).toBeGreaterThanOrEqual(100);
    expect(DEFAULT_MAX_STEPS).toBeLessThanOrEqual(MAX_STEPS_LIMIT);
    expect(Number.isFinite(MAX_STEPS_LIMIT)).toBe(true);
    expect(MIN_MAX_STEPS).toBeGreaterThanOrEqual(1);
  });

  it("clampMaxSteps falls back to the default for non-finite/missing values", () => {
    expect(clampMaxSteps(undefined)).toBe(DEFAULT_MAX_STEPS);
    expect(clampMaxSteps(null)).toBe(DEFAULT_MAX_STEPS);
    expect(clampMaxSteps(NaN)).toBe(DEFAULT_MAX_STEPS);
    expect(clampMaxSteps(Infinity)).toBe(DEFAULT_MAX_STEPS);
    expect(clampMaxSteps("200" as unknown)).toBe(DEFAULT_MAX_STEPS);
  });

  it("clampMaxSteps keeps an in-range value (floored) and clamps the extremes", () => {
    expect(clampMaxSteps(200)).toBe(200);
    expect(clampMaxSteps(150.9)).toBe(150);
    expect(clampMaxSteps(0)).toBe(MIN_MAX_STEPS);
    expect(clampMaxSteps(-5)).toBe(MIN_MAX_STEPS);
    expect(clampMaxSteps(MAX_STEPS_LIMIT + 10_000)).toBe(MAX_STEPS_LIMIT);
  });
});

describe("reduceAgentEvent — max-steps terminal (cap reached, task 1305)", () => {
  it("flips to max-steps when finish carries finishReason 'tool-calls'", () => {
    // The step-cap backstop fired: the last step emitted tool calls but the
    // loop refused to continue, so the top-level finish reports 'tool-calls'.
    // This must be a DISTINCT, surfaced terminal — not a misleading 'done'.
    const state = fold([
      { type: "start-step" } as Part,
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "stage_add_shape",
        input: {},
      } as unknown as Part,
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "stage_add_shape",
        input: {},
        output: { ok: true },
      } as unknown as Part,
      { type: "finish", finishReason: "tool-calls" } as unknown as Part,
    ]);
    expect(state.status).toBe("max-steps");
  });

  it("still flips to done on a natural finish (finishReason 'stop')", () => {
    const state = fold([
      { type: "start-step" } as Part,
      { type: "text-delta", id: "t", text: "all done" } as Part,
      { type: "finish", finishReason: "stop" } as unknown as Part,
    ]);
    expect(state.status).toBe("done");
  });

  it("a prior abort outranks a max-steps finish (first terminal wins)", () => {
    const state = fold([
      { type: "tool-call", toolCallId: "c", toolName: "x", input: {} } as unknown as Part,
      { type: "abort", reason: "user" } as Part,
      { type: "finish", finishReason: "tool-calls" } as unknown as Part,
    ]);
    expect(state.status).toBe("stopped");
  });
});

describe("reduceAgentEvent — abort/error terminal precedence", () => {
  it("error-then-abort keeps the error (a real failure outranks a cancel)", () => {
    const state = fold([
      { type: "text-delta", id: "t", text: "partial" } as Part,
      { type: "error", error: new Error("boom") } as Part,
      { type: "abort", reason: "user" } as Part,
    ]);
    expect(state.status).toBe("error");
    expect(state.error).toBe("boom");
  });

  it("abort-then-error keeps the abort (first terminal wins)", () => {
    const state = fold([
      { type: "text-delta", id: "t", text: "partial" } as Part,
      { type: "abort", reason: "user" } as Part,
      { type: "error", error: new Error("late boom") } as Part,
    ]);
    expect(state.status).toBe("stopped");
    expect(state.error).toBeUndefined();
  });

  it("a trailing abort does NOT override a finished (done) run", () => {
    const state = fold([
      { type: "finish", finishReason: "stop" } as unknown as Part,
      { type: "abort", reason: "user" } as Part,
    ]);
    expect(state.status).toBe("done");
  });
});

describe("reduceAgentEvent — orphaned tool-result", () => {
  it("warns and does not throw when a tool-result has an unknown toolCallId", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const state = fold([
        { type: "tool-call", toolCallId: "known", toolName: "x", input: {} } as unknown as Part,
        // result for a call we never recorded:
        { type: "tool-result", toolCallId: "ghost", toolName: "x", input: {}, output: 1 } as unknown as Part,
      ]);
      // The known chip is untouched and stays running (no result arrived for it).
      const known = state.entries.find(
        (e): e is AgentToolEntry => e.kind === "tool" && e.toolCallId === "known"
      );
      expect(known?.status).toBe("running");
      // No phantom chip was created for the ghost id.
      expect(
        state.entries.some((e) => e.kind === "tool" && e.toolCallId === "ghost")
      ).toBe(false);
      // The orphan was surfaced via a warning mentioning the id.
      expect(warnings.some((w) => w.includes("ghost"))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it("warns on an orphaned tool-error too (chip would otherwise stick on running)", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const state = fold([
        { type: "tool-error", toolCallId: "missing", toolName: "y", input: {}, error: new Error("nope") } as unknown as Part,
      ]);
      expect(state.entries.length).toBe(0);
      expect(warnings.some((w) => w.includes("missing"))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});

describe("drivePartStream", () => {
  it("pushes a new state per part and returns the final state", async () => {
    const states: AgentRunState[] = [];
    const final = await drivePartStream(
      mockStream([
        { type: "start-step" } as Part,
        { type: "text-delta", id: "t", text: "hi" } as Part,
        { type: "finish", finishReason: "stop" } as unknown as Part,
      ]),
      { onState: (s) => states.push(s) }
    );
    expect(states.length).toBe(3);
    expect(final.status).toBe("done");
    expect(
      final.entries.find((e) => e.kind === "text" && e.text === "hi")
    ).toBeTruthy();
  });

  it("folds a thrown AbortError into a stopped terminal", async () => {
    const abortErr = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    const final = await drivePartStream(
      throwingStream(
        [{ type: "text-delta", id: "t", text: "x" } as Part],
        abortErr
      ),
      { onState: () => {} }
    );
    expect(final.status).toBe("stopped");
  });

  it("folds a thrown non-abort error into an error terminal", async () => {
    const final = await drivePartStream(
      throwingStream(
        [{ type: "text-delta", id: "t", text: "x" } as Part],
        new Error("kaboom")
      ),
      { onState: () => {} }
    );
    expect(final.status).toBe("error");
    expect(final.error).toBe("kaboom");
  });

  it("treats a thrown error as stopped when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const final = await drivePartStream(
      throwingStream(
        [{ type: "text-delta", id: "t", text: "x" } as Part],
        new Error("late failure during cancel")
      ),
      { onState: () => {} },
      controller.signal
    );
    expect(final.status).toBe("stopped");
  });
});

describe("agentErrorMessage", () => {
  it("handles Error, string, object, and nullish inputs", () => {
    expect(agentErrorMessage(new Error("e"))).toBe("e");
    expect(agentErrorMessage("s")).toBe("s");
    expect(agentErrorMessage({ a: 1 })).toBe('{"a":1}');
    expect(agentErrorMessage(null)).toBe("Unknown error");
  });

  it("digs the message out of AI-SDK-style nested error objects", () => {
    expect(agentErrorMessage({ message: "top-level msg" })).toBe(
      "top-level msg"
    );
    expect(
      agentErrorMessage({ error: { message: "nested provider msg" } })
    ).toBe("nested provider msg");
    expect(agentErrorMessage({ responseBody: "raw body text" })).toBe(
      "raw body text"
    );
  });
});

describe("classifyAgentError — actionable error buckets", () => {
  it("reports a missing key before anything else", () => {
    const f = classifyAgentError(new Error("whatever"), {
      hasKey: false,
      hasModel: true,
    });
    expect(f.kind).toBe("missing-key");
    expect(f.openSettings).toBe(true);
    expect(f.message).toMatch(/api key/i);
  });

  it("reports a missing model when a key is present", () => {
    const f = classifyAgentError(null, { hasKey: true, hasModel: false });
    expect(f.kind).toBe("model");
    expect(f.openSettings).toBe(true);
    expect(f.message).toMatch(/model/i);
  });

  it("classifies a 401 as an auth failure", () => {
    const f = classifyAgentError({ statusCode: 401, message: "Unauthorized" });
    expect(f.kind).toBe("auth");
    expect(f.openSettings).toBe(true);
  });

  it("classifies an invalid-key message (no status) as auth", () => {
    const f = classifyAgentError(new Error("Invalid API key provided"));
    expect(f.kind).toBe("auth");
  });

  it("classifies a 429 as rate-limit and does not nudge settings", () => {
    const f = classifyAgentError({ statusCode: 429, message: "Too Many Requests" });
    expect(f.kind).toBe("rate-limit");
    expect(f.openSettings).toBe(false);
  });

  it("classifies a fetch/CORS failure as network", () => {
    const f = classifyAgentError(new TypeError("Failed to fetch"));
    expect(f.kind).toBe("network");
    expect(f.message).toMatch(/openrouter\.ai|internet/i);
  });

  it("classifies a bad model id as a model error", () => {
    const f = classifyAgentError({
      statusCode: 400,
      message: "model not found: foo/bar",
    });
    expect(f.kind).toBe("model");
    expect(f.openSettings).toBe(true);
  });

  it("falls back to unknown with the raw message", () => {
    const f = classifyAgentError(new Error("some weird thing"));
    expect(f.kind).toBe("unknown");
    expect(f.message).toBe("some weird thing");
  });
});
