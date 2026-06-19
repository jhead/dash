// ---------------------------------------------------------------------------
// Agent Chat run loop (Phase 3).
//
// Wraps the AI SDK v6 `streamText` multi-step tool loop and turns its
// `fullStream` of TextStreamParts into a flat, UI-renderable transcript of
// `AgentEntry`s. The transform is split into a PURE reducer
// (`reduceAgentEvent`) so it can be unit-tested against a mocked stream with
// no API key / network, and a thin async driver (`runAgentTurn`) that wires
// up the model, tools, abort signal, and onError/onAbort fallbacks.
//
// Why a reducer over the raw stream parts?
//   - The fullStream emits fine-grained deltas (text-delta, reasoning-delta,
//     tool-input-delta) interleaved across steps. The UI wants a stable list
//     of message/thinking/tool-call entries that grow in place, plus step
//     boundaries and a terminal status (done / stopped / error). The reducer
//     folds the part stream into exactly that shape.
//   - `tool-call` carries name + input; the matching `tool-result` / `tool-error`
//     arrives later (after the tool executes). We index pending tool entries by
//     `toolCallId` so the result lands on the right chip.
// ---------------------------------------------------------------------------

import {
  streamText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type TextStreamPart,
} from "ai";

// --- The UI-facing transcript model -----------------------------------------

/** A streamed assistant text block (one per text-start within a step). */
export interface AgentTextEntry {
  kind: "text";
  id: string;
  text: string;
}

/** A reasoning / "thinking" block (one per reasoning-start within a step). */
export interface AgentReasoningEntry {
  kind: "reasoning";
  id: string;
  text: string;
}

/** Lifecycle of a single tool invocation, rendered as a chip. */
export type AgentToolStatus = "running" | "result" | "error";

/** A tool call chip: name -> args -> result/error. */
export interface AgentToolEntry {
  kind: "tool";
  /** The tool-call id; results are matched back to the call by this. */
  toolCallId: string;
  toolName: string;
  /** The parsed arguments the model passed (available once the call lands). */
  input: unknown;
  /** The tool's return value, once it resolves. */
  output?: unknown;
  /** An error message, if the tool threw / errored. */
  error?: string;
  status: AgentToolStatus;
}

/** A step boundary marker (one per model step in the multi-step loop). */
export interface AgentStepEntry {
  kind: "step";
  /** 1-based step number. */
  step: number;
}

export type AgentEntry =
  | AgentTextEntry
  | AgentReasoningEntry
  | AgentToolEntry
  | AgentStepEntry;

/** Terminal status of a run. `running` while the stream is live. */
export type AgentRunStatus = "running" | "done" | "stopped" | "error";

/**
 * The accumulated state the UI renders. `entries` is the ordered transcript of
 * the CURRENT assistant turn (text/reasoning/tool/step). `status` reflects the
 * terminal outcome; `error` carries a message when status is `"error"`.
 */
export interface AgentRunState {
  entries: AgentEntry[];
  status: AgentRunStatus;
  error?: string;
}

/** The initial reducer state for a fresh run. */
export function initialAgentRunState(): AgentRunState {
  return { entries: [], status: "running" };
}

// --- The pure reducer -------------------------------------------------------

/** Coerce an unknown error-ish value into a readable string. */
export function agentErrorMessage(err: unknown): string {
  if (err == null) return "Unknown error";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  // AI SDK errors carry their detail on `.message`; many providers nest the
  // useful text under `.message`, `.responseBody`, or `.error.message`.
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.length > 0) return o.message;
    if (
      o.error &&
      typeof o.error === "object" &&
      typeof (o.error as Record<string, unknown>).message === "string"
    ) {
      return (o.error as Record<string, string>).message;
    }
    if (typeof o.responseBody === "string" && o.responseBody.length > 0) {
      return o.responseBody;
    }
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Classification of a run failure into one of a few user-facing buckets, used by
 * the panel to render a clear, ACTIONABLE error state (vs. an opaque stack).
 */
export type AgentErrorKind =
  | "missing-key" // no API key configured
  | "auth" // invalid key / 401 / 403
  | "network" // network down / CORS / DNS / fetch failed
  | "rate-limit" // 429
  | "model" // bad model id / 400 / provider-side model error
  | "unknown";

export interface FriendlyAgentError {
  kind: AgentErrorKind;
  /** A short, human-readable, actionable message for the transcript. */
  message: string;
  /** When true, the panel should nudge the user toward Settings. */
  openSettings: boolean;
}

/** HTTP status, if the error object carries one (AI SDK / fetch errors do). */
function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    for (const k of ["statusCode", "status"]) {
      const v = o[k];
      if (typeof v === "number") return v;
    }
  }
  return undefined;
}

/**
 * Map a raw run error into a friendly, actionable {@link FriendlyAgentError}.
 *
 * Pure + dependency-free so it is exhaustively unit-testable. The panel calls
 * this for its terminal error message; missing-key is detected upstream (before
 * any request) but is included here for completeness.
 */
export function classifyAgentError(
  err: unknown,
  ctx: { hasKey: boolean; hasModel: boolean } = { hasKey: true, hasModel: true }
): FriendlyAgentError {
  if (!ctx.hasKey) {
    return {
      kind: "missing-key",
      message:
        "No OpenRouter API key set. Open Settings above and paste your key (it stays in this browser).",
      openSettings: true,
    };
  }
  if (!ctx.hasModel) {
    return {
      kind: "model",
      message:
        "No model selected. Open Settings above and choose a model to chat with.",
      openSettings: true,
    };
  }

  const raw = agentErrorMessage(err);
  const lower = raw.toLowerCase();
  const status = statusOf(err);

  if (status === 401 || status === 403 || /\b(401|403)\b/.test(lower) || /invalid api key|no auth|unauthor|forbidden|user not found/.test(lower)) {
    return {
      kind: "auth",
      message:
        "OpenRouter rejected the API key (auth failed). Check the key in Settings — it may be wrong, revoked, or out of credits.",
      openSettings: true,
    };
  }

  if (status === 429 || /\b429\b|rate limit|too many requests/.test(lower)) {
    return {
      kind: "rate-limit",
      message:
        "Rate limited by OpenRouter (429). Wait a moment and try again, or pick a less busy model.",
      openSettings: false,
    };
  }

  if (
    /failed to fetch|networkerror|network error|load failed|cors|err_network|fetch failed|enotfound|econnrefused|dns|offline|net::/.test(
      lower
    )
  ) {
    return {
      kind: "network",
      message:
        "Couldn't reach openrouter.ai. Check your internet connection (and that a browser extension / firewall isn't blocking the request).",
      openSettings: false,
    };
  }

  if (
    status === 400 ||
    status === 404 ||
    /\b(400|404)\b|model.*(not found|not available|invalid|unknown)|no endpoints found|not a valid model/.test(
      lower
    )
  ) {
    return {
      kind: "model",
      message: `The model couldn't process this request${
        raw ? ` (${raw})` : ""
      }. Try a different model in Settings.`,
      openSettings: true,
    };
  }

  return {
    kind: "unknown",
    message: raw || "Something went wrong running the agent. Try again.",
    openSettings: false,
  };
}

/**
 * Fold a single fullStream part into the run state, returning a NEW state
 * (never mutates the input — safe for React setState). Unknown / ignored part
 * types pass through unchanged.
 *
 * Step counting: `start-step` increments a step marker. We render the marker
 * lazily so a transcript that never produces a tool call still reads cleanly.
 */
export function reduceAgentEvent(
  state: AgentRunState,
  part: TextStreamPart<ToolSet>
): AgentRunState {
  switch (part.type) {
    case "start-step": {
      const step = countSteps(state) + 1;
      return appendEntry(state, { kind: "step", step });
    }

    case "text-delta": {
      return upsertText(state, part.id, part.text, "text");
    }

    case "reasoning-delta": {
      return upsertText(state, part.id, part.text, "reasoning");
    }

    case "tool-call": {
      const entry: AgentToolEntry = {
        kind: "tool",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        status: "running",
      };
      return appendEntry(state, entry);
    }

    case "tool-result": {
      return patchTool(state, part.toolCallId, (t) => ({
        ...t,
        output: part.output,
        status: "result",
      }));
    }

    case "tool-error": {
      return patchTool(state, part.toolCallId, (t) => ({
        ...t,
        error: agentErrorMessage(part.error),
        status: "error",
      }));
    }

    case "finish": {
      // Only flip to done if we did not already stop / error.
      if (state.status === "running") return { ...state, status: "done" };
      return state;
    }

    case "abort": {
      // Terminal: only transition from `running`, like `finish`. A trailing
      // abort must NOT clobber a prior `error` (a real failure outranks a
      // cancel) — and equally, the FIRST terminal event wins, so an
      // error-after-abort can't erase the abort. Whichever terminal arrives
      // first is kept; this is what defines abort↔error precedence.
      if (state.status === "running") return { ...state, status: "stopped" };
      return state;
    }

    case "error": {
      // Terminal: only transition from `running`. If we already reached a
      // terminal state (stopped/done/error) the first one stands; a later
      // error does not overwrite a prior abort, and vice versa.
      if (state.status === "running") {
        return {
          ...state,
          status: "error",
          error: agentErrorMessage(part.error),
        };
      }
      return state;
    }

    default:
      // text-start/end, reasoning-start/end, tool-input-*, finish-step,
      // start, source, file, raw, tool approvals — not rendered directly.
      return state;
  }
}

function countSteps(state: AgentRunState): number {
  let n = 0;
  for (const e of state.entries) if (e.kind === "step") n++;
  return n;
}

function appendEntry(state: AgentRunState, entry: AgentEntry): AgentRunState {
  return { ...state, entries: [...state.entries, entry] };
}

/**
 * Append-or-extend a text/reasoning entry by id. Streaming deltas with the same
 * id accumulate into one growing block; a new id starts a new block.
 */
function upsertText(
  state: AgentRunState,
  id: string,
  text: string,
  kind: "text" | "reasoning"
): AgentRunState {
  // Find the LAST entry with this kind + id (deltas for the active block are
  // always the most recent matching entry).
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const e = state.entries[i];
    if (e.kind === kind && e.id === id) {
      const updated = { ...e, text: e.text + text } as AgentEntry;
      const entries = state.entries.slice();
      entries[i] = updated;
      return { ...state, entries };
    }
  }
  const fresh: AgentEntry =
    kind === "text"
      ? { kind: "text", id, text }
      : { kind: "reasoning", id, text };
  return appendEntry(state, fresh);
}

function patchTool(
  state: AgentRunState,
  toolCallId: string,
  patch: (t: AgentToolEntry) => AgentToolEntry
): AgentRunState {
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const e = state.entries[i];
    if (e.kind === "tool" && e.toolCallId === toolCallId) {
      const entries = state.entries.slice();
      entries[i] = patch(e);
      return { ...state, entries };
    }
  }
  // Orphaned tool-result / tool-error: no matching tool-call entry. Without a
  // matching call this would be silently dropped — and any tool chip that DID
  // open under this id would otherwise be stuck on "running" forever. This can
  // happen if a result arrives for a call we never recorded (out-of-order /
  // dropped tool-call part). Warn loudly so it is observable; the run state is
  // left unchanged (there is no chip to attach the result to).
  warnOrphanedToolResult(toolCallId);
  return state;
}

/**
 * Surface an orphaned tool-result (a `tool-result`/`tool-error` whose
 * `toolCallId` matches no recorded `tool-call`). Extracted so tests can spy on
 * it and so the warning is centralized.
 */
function warnOrphanedToolResult(toolCallId: string): void {
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(
      `[agentLoop] tool-result/tool-error for unknown toolCallId "${toolCallId}" — no matching tool-call; dropping.`
    );
  }
}

// --- The async driver -------------------------------------------------------

/**
 * A minimal async-iterable of fullStream parts. `streamText().fullStream`
 * satisfies this; tests pass a hand-rolled async generator of parts.
 */
export type AgentPartStream = AsyncIterable<TextStreamPart<ToolSet>>;

export interface DrivePartStreamOptions {
  /** Called after each reducer step with the latest state (for re-render). */
  onState: (state: AgentRunState) => void;
}

/**
 * Drive a fullStream to completion, folding every part through the reducer and
 * pushing each new state to `onState`. Returns the FINAL state.
 *
 * Robustness: a `stopped` or `error` status, once reached, is never silently
 * overwritten by a trailing `finish`. The driver itself never throws — a thrown
 * iterator (fast-abort can reject the async iterator rather than emit an
 * `abort`/`error` part) is caught and folded into the state as a stopped/error
 * terminal, so the caller's `onError`/`onAbort` are belt-and-suspenders.
 */
export async function drivePartStream(
  stream: AgentPartStream,
  options: DrivePartStreamOptions,
  signal?: AbortSignal
): Promise<AgentRunState> {
  let state = initialAgentRunState();
  try {
    for await (const part of stream) {
      state = reduceAgentEvent(state, part);
      options.onState(state);
    }
  } catch (err) {
    // Abort surfaces here as a DOMException/AbortError on a fast cancel.
    if (isAbortError(err) || signal?.aborted) {
      if (state.status === "running") {
        state = { ...state, status: "stopped" };
        options.onState(state);
      }
    } else if (state.status === "running") {
      state = { ...state, status: "error", error: agentErrorMessage(err) };
      options.onState(state);
    }
  }
  return state;
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    ((err as { name?: string }).name === "AbortError" ||
      (err as { name?: string }).name === "TimeoutError")
  );
}

export interface RunAgentOptions {
  model: LanguageModel;
  system: string;
  tools: ToolSet;
  messages: ModelMessage[];
  /** Max model steps in the tool loop (stopWhen: stepCountIs(maxSteps)). */
  maxSteps: number;
  abortSignal: AbortSignal;
  onState: (state: AgentRunState) => void;
}

export interface RunAgentResult {
  state: AgentRunState;
  /** New model messages (assistant + tool) to append for the next turn. */
  responseMessages: ModelMessage[];
}

/**
 * Run one agent turn: kick off `streamText` (free-run, auto-executing tools up
 * to `maxSteps`) and drive its fullStream through the reducer. Handles BOTH
 * `onAbort` and `onError` (a fast abort can fire onError instead of emitting an
 * abort part) by folding them into the run state.
 *
 * Returns the final UI state plus the model `response.messages` so the caller
 * can extend the conversation history for multi-turn.
 */
export async function runAgentTurn(
  options: RunAgentOptions
): Promise<RunAgentResult> {
  const { model, system, tools, messages, maxSteps, abortSignal, onState } =
    options;

  // Track terminal status set by onAbort/onError so the driver can reconcile.
  let externalStatus: "stopped" | "error" | null = null;
  let externalError: string | undefined;

  const result = streamText({
    model,
    system,
    tools,
    messages,
    stopWhen: stepCountIs(maxSteps),
    abortSignal,
    onAbort() {
      externalStatus = "stopped";
    },
    onError({ error }) {
      // A fast abort can surface here rather than as an abort part.
      if (isAbortError(error) || abortSignal.aborted) {
        externalStatus = "stopped";
      } else {
        externalStatus = "error";
        externalError = agentErrorMessage(error);
      }
    },
  });

  let state = await drivePartStream(result.fullStream, { onState }, abortSignal);

  // Reconcile with onAbort/onError if the stream didn't already terminalize.
  if (externalStatus && state.status === "running") {
    state =
      externalStatus === "stopped"
        ? { ...state, status: "stopped" }
        : { ...state, status: "error", error: externalError };
    onState(state);
  } else if (externalStatus === "error" && state.status === "done") {
    // Error fired after a (premature) finish — error wins.
    state = { ...state, status: "error", error: externalError };
    onState(state);
  }

  // Collect the model's response messages for multi-turn continuation. On an
  // abort/error these may be unavailable; default to empty.
  let responseMessages: ModelMessage[] = [];
  try {
    const response = await result.response;
    responseMessages = response.messages as ModelMessage[];
  } catch {
    responseMessages = [];
  }

  return { state, responseMessages };
}
