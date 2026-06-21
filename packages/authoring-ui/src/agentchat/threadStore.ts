import { create } from "zustand";
import type { ModelMessage } from "ai";
import type { AgentRunState, AgentTurnUsage } from "./agentLoop.js";

// ---------------------------------------------------------------------------
// Agent Chat thread store (task 1291) — PERSISTED conversation state.
//
// Before this, AgentChatPanel held the conversation (`turns` + the
// `historyRef` ModelMessage[]) in component state/refs, so it was LOST when the
// user left the Agent tab (the panel unmounts) and on a full page refresh. This
// store lifts that state out of the component into a localStorage-backed zustand
// store so a conversation survives BOTH:
//   - navigating off and back to the Agent tab (unmount/remount), and
//   - a full page reload (the active thread is restored on mount).
//
// It also adds MULTI-THREAD support: many independent conversations, each with
// its own rendered transcript + ModelMessage history, plus an `activeThreadId`.
//
// Persistence hygiene (mirrors preferences.ts):
//   - try/catch around every localStorage read/write (quota / privacy-mode /
//     malformed JSON all fall back to an empty store, never throw),
//   - a cap on the number of stored threads (oldest-updated dropped first), and
//   - per-thread transcript/history trimming so one runaway conversation can't
//     blow the ~5MB localStorage quota.
//
// The IN-FLIGHT run writes into its ORIGIN thread: AgentChatPanel captures the
// threadId at send time and patches the streaming AgentRunState onto THAT
// thread's transcript via `patchAssistantRun(threadId, ...)`, so streaming/
// thinking/tool chips land in the thread the run was started on even if the user
// switches the active thread mid-flight (task 1293).
//
// PERSISTENCE (task 1293): streaming deltas are kept in memory only — they update
// the live UI but do NOT hit localStorage (per-delta writes thrashed storage and
// risked quota). The store persists only on TERMINAL run state (done/error/
// stopped) and on history append + structural mutations (new/select/clear/delete/
// append). On hydrate, any thread left in a non-terminal `running` run (a mid-run
// refresh) is coerced to a terminal `stopped` state so it never sticks "running".
// ---------------------------------------------------------------------------

const STORAGE_KEY = "flash8.agentThreads";

/** Max number of threads kept in storage (oldest-updated trimmed first). */
export const MAX_THREADS = 30;

/** Max transcript turns kept per thread (oldest dropped first when trimming). */
export const MAX_TURNS_PER_THREAD = 400;

/** Max ModelMessage history entries kept per thread (oldest dropped first). */
export const MAX_HISTORY_PER_THREAD = 400;

/** Max characters for a derived thread title. */
export const MAX_TITLE_LEN = 48;

/** Default title for a thread with no user message yet. */
export const DEFAULT_THREAD_TITLE = "New chat";

// --- Transcript model (mirrors AgentChatPanel's Turn) -----------------------

/** A user message in the visible transcript. */
export interface UserTurn {
  role: "user";
  id: string;
  text: string;
}

/** A completed/live assistant turn in the visible transcript. */
export interface AssistantTurn {
  role: "assistant";
  id: string;
  run: AgentRunState;
}

export type Turn = UserTurn | AssistantTurn;

/**
 * Running per-thread token + cost totals (task 1337), summed across EVERY turn
 * in the thread and persisted alongside the transcript so they survive a reload
 * / thread-switch. A fresh thread starts at all-zero.
 *
 * `cost` is the running USD total. `costKnown` is false until at least one turn
 * contributed a cost (so the UI can distinguish "$0.00" from "cost unknown").
 * `costHasEstimate` records whether ANY contributing turn's cost was COMPUTED
 * from pricing rather than reported by OpenRouter — when true the UI labels the
 * total 'est.'.
 */
export interface ThreadUsage {
  /** Total tokens consumed by the whole thread (sum of all turns). */
  totalTokens: number;
  /** Total input (prompt) tokens for the thread. */
  inputTokens: number;
  /** Total output (completion) tokens for the thread. */
  outputTokens: number;
  /** Running USD cost for the thread (only meaningful when `costKnown`). */
  cost: number;
  /** True once any turn contributed a known cost. */
  costKnown: boolean;
  /** True when any contributing turn's cost was estimated from pricing. */
  costHasEstimate: boolean;
}

/** A zero-valued thread usage — the starting total for a fresh thread. */
export function emptyThreadUsage(): ThreadUsage {
  return {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    costKnown: false,
    costHasEstimate: false,
  };
}

/**
 * Fold one turn's {@link AgentTurnUsage} into a thread's running {@link
 * ThreadUsage}, returning a NEW total (pure — safe for setState + unit testing).
 * Tokens always accumulate. Cost accumulates only when the turn carried one;
 * the first known cost flips `costKnown`, and an estimated turn-cost flips
 * `costHasEstimate` so the whole-thread total is labeled 'est.'.
 */
export function accumulateUsage(
  prev: ThreadUsage,
  turn: AgentTurnUsage
): ThreadUsage {
  const next: ThreadUsage = {
    totalTokens: prev.totalTokens + nonNeg(turn.totalTokens),
    inputTokens: prev.inputTokens + nonNeg(turn.inputTokens),
    outputTokens: prev.outputTokens + nonNeg(turn.outputTokens),
    cost: prev.cost,
    costKnown: prev.costKnown,
    costHasEstimate: prev.costHasEstimate,
  };
  if (typeof turn.cost === "number" && Number.isFinite(turn.cost)) {
    next.cost = prev.cost + turn.cost;
    next.costKnown = true;
    if (turn.costIsEstimated) next.costHasEstimate = true;
  }
  return next;
}

/** Clamp a value to a finite, non-negative number (0 for junk). */
function nonNeg(n: number): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Validate + coerce a parsed usage blob into a well-formed {@link ThreadUsage}. */
function normalizeUsage(raw: unknown): ThreadUsage {
  if (!raw || typeof raw !== "object") return emptyThreadUsage();
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  return {
    totalTokens: num(o.totalTokens),
    inputTokens: num(o.inputTokens),
    outputTokens: num(o.outputTokens),
    cost: num(o.cost),
    costKnown: o.costKnown === true,
    costHasEstimate: o.costHasEstimate === true,
  };
}

/** One conversation thread. */
export interface ChatThread {
  id: string;
  /** Derived from the first user message (truncated); DEFAULT_THREAD_TITLE until then. */
  title: string;
  /** The rendered transcript (user bubbles + assistant runs). */
  transcript: Turn[];
  /** The model-message history (assistant + tool), preserved for multi-turn context. */
  history: ModelMessage[];
  /** Running token + cost totals for the thread (task 1337). */
  usage: ThreadUsage;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadState {
  threads: ChatThread[];
  activeThreadId: string | null;

  // --- Actions ---
  /** Create a fresh empty thread and make it active. Returns its id. */
  newThread: () => string;
  /** Switch the active thread (no-op if id is unknown). */
  selectThread: (id: string) => void;
  /** Delete a thread; if it was active, fall back to the most-recent remaining (or a fresh one). */
  deleteThread: (id: string) => void;
  /** Empty the active thread's transcript + history in place (keeps the thread + id). */
  clearActiveThread: () => void;
  /**
   * Append a user turn + a live assistant turn to the active thread, recording
   * the user message in the history. Auto-derives the title from the first user
   * message. Returns the new assistant turn id (so the panel can patch streaming
   * state onto it). Creates an active thread first if none exists.
   */
  appendUserAndAssistant: (
    userTurn: UserTurn,
    assistantTurn: AssistantTurn,
    userMessage: ModelMessage
  ) => string;
  /**
   * Patch the streaming AgentRunState onto an assistant turn in the THREAD it was
   * started on (NOT necessarily the active thread). Live (non-terminal `running`)
   * patches update in-memory state only — they are NOT persisted to localStorage,
   * so streaming deltas don't thrash storage. A TERMINAL patch (done/error/
   * stopped) IS persisted so the finished run survives a refresh (task 1293).
   */
  patchAssistantRun: (
    threadId: string,
    assistantId: string,
    run: AgentRunState
  ) => void;
  /** Append model response messages (assistant + tool) to the active thread's history. */
  appendActiveHistory: (messages: ModelMessage[]) => void;
  /**
   * Fold one completed turn's token + cost usage into a thread's running totals
   * (task 1337). Targets the thread the turn ran on (NOT necessarily the active
   * one — a turn can finish after the user switched away), and ALWAYS persists
   * (a completed turn's totals must survive a refresh). No-op for unknown ids.
   */
  addThreadUsage: (threadId: string, usage: AgentTurnUsage) => void;
  /**
   * Add JUST a cost amount (USD) to a thread's running total, without touching
   * tokens (task 1337). Used to fill in a COMPUTED ('est.') cost asynchronously
   * AFTER the turn's tokens were already accumulated — so the footer can show
   * tokens immediately and gain a cost estimate once pricing resolves, with no
   * double-counting of tokens. Always persists; no-op for unknown ids / non-
   * finite costs.
   */
  addThreadCost: (
    threadId: string,
    cost: number,
    estimated: boolean
  ) => void;
}

/** A run status that will never change again (the stream has ended). */
function isTerminalRunStatus(status: AgentRunState["status"]): boolean {
  return status === "done" || status === "error" || status === "stopped";
}

// --- Title derivation -------------------------------------------------------

/**
 * Derive a thread title from the first user message: collapse whitespace and
 * truncate to {@link MAX_TITLE_LEN} (with an ellipsis). Blank input keeps the
 * default title.
 */
export function deriveTitle(firstUserMessage: string): string {
  const collapsed = firstUserMessage.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return DEFAULT_THREAD_TITLE;
  if (collapsed.length <= MAX_TITLE_LEN) return collapsed;
  return collapsed.slice(0, MAX_TITLE_LEN - 1).trimEnd() + "…";
}

// --- IDs --------------------------------------------------------------------

let threadSeq = 0;
function nextThreadId(): string {
  threadSeq += 1;
  return `thread-${Date.now()}-${threadSeq}`;
}

function createEmptyThread(): ChatThread {
  const now = Date.now();
  return {
    id: nextThreadId(),
    title: DEFAULT_THREAD_TITLE,
    transcript: [],
    history: [],
    usage: emptyThreadUsage(),
    createdAt: now,
    updatedAt: now,
  };
}

// --- Persistence (mirrors preferences.ts try/catch + normalize) -------------

interface PersistShape {
  threads: ChatThread[];
  activeThreadId: string | null;
}

/** Cap a single thread's transcript + history to keep storage bounded. */
function trimThread(thread: ChatThread): ChatThread {
  const transcript =
    thread.transcript.length > MAX_TURNS_PER_THREAD
      ? thread.transcript.slice(thread.transcript.length - MAX_TURNS_PER_THREAD)
      : thread.transcript;
  const history =
    thread.history.length > MAX_HISTORY_PER_THREAD
      ? thread.history.slice(thread.history.length - MAX_HISTORY_PER_THREAD)
      : thread.history;
  return { ...thread, transcript, history };
}

/**
 * Reduce the in-memory state to a bounded, serializable snapshot: keep only the
 * MAX_THREADS most-recently-updated threads, trim each thread's transcript +
 * history, and ensure activeThreadId still points at a surviving thread.
 */
export function boundForStorage(state: PersistShape): PersistShape {
  const sorted = [...state.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  const kept = sorted.slice(0, MAX_THREADS).map(trimThread);
  const activeStillExists = kept.some((t) => t.id === state.activeThreadId);
  return {
    threads: kept,
    activeThreadId: activeStillExists
      ? state.activeThreadId
      : (kept[0]?.id ?? null),
  };
}

/**
 * Coerce any assistant turn left in a non-terminal `running` run to a terminal
 * `stopped` state. Persisted state only ever contains a `running` run if the page
 * was refreshed mid-stream (the AbortController died with the page, so the run can
 * never finish); without this it would render "Working…" forever (task 1293).
 * Returns a NEW thread only when something changed (referentially stable otherwise).
 */
function coerceRunningToTerminal(thread: ChatThread): ChatThread {
  let changed = false;
  const transcript = thread.transcript.map((turn) => {
    if (turn.role === "assistant" && turn.run.status === "running") {
      changed = true;
      return { ...turn, run: { ...turn.run, status: "stopped" as const } };
    }
    return turn;
  });
  return changed ? { ...thread, transcript } : thread;
}

/** Validate + coerce a parsed thread into a well-formed ChatThread (or null). */
function normalizeThread(raw: unknown): ChatThread | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  const transcript = Array.isArray(o.transcript)
    ? (o.transcript as Turn[])
    : [];
  const history = Array.isArray(o.history) ? (o.history as ModelMessage[]) : [];
  const now = Date.now();
  const thread: ChatThread = {
    id: o.id,
    title:
      typeof o.title === "string" && o.title.length > 0
        ? o.title
        : DEFAULT_THREAD_TITLE,
    transcript,
    history,
    usage: normalizeUsage(o.usage),
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : now,
  };
  // A persisted `running` run means a mid-stream refresh; the run can never
  // resume, so coerce it to a terminal `stopped` (task 1293).
  return coerceRunningToTerminal(thread);
}

/** Read the persisted thread state from localStorage, defaulting to empty. */
export function loadThreads(): PersistShape {
  if (typeof localStorage === "undefined") {
    return { threads: [], activeThreadId: null };
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { threads: [], activeThreadId: null };
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { threads: [], activeThreadId: null };
    }
    const p = parsed as Record<string, unknown>;
    const rawThreads = Array.isArray(p.threads) ? p.threads : [];
    const threads = rawThreads
      .map(normalizeThread)
      .filter((t): t is ChatThread => t !== null);
    const activeThreadId =
      typeof p.activeThreadId === "string" &&
      threads.some((t) => t.id === p.activeThreadId)
        ? p.activeThreadId
        : (threads[0]?.id ?? null);
    return boundForStorage({ threads, activeThreadId });
  } catch {
    // Malformed JSON / privacy-mode read failure: start fresh.
    return { threads: [], activeThreadId: null };
  }
}

/**
 * Persist the thread state to localStorage. Bounds + trims first so one runaway
 * conversation can't exceed quota; on a quota error, retries with a single most-
 * recent thread before giving up silently (mirrors preferences.ts: never throw).
 */
export function saveThreads(state: PersistShape): void {
  if (typeof localStorage === "undefined") return;
  const bounded = boundForStorage(state);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Likely quota: shed everything but the single most-recent thread and retry.
    try {
      const fallback: PersistShape = {
        threads: bounded.threads.slice(0, 1).map(trimThread),
        activeThreadId: bounded.threads[0]?.id ?? null,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
    } catch {
      // Give up: persistence is best-effort, never fatal to the UI.
    }
  }
}

// --- The store --------------------------------------------------------------

const initial = loadThreads();

export const useThreadStore = create<ThreadState>((set, get) => ({
  threads: initial.threads,
  activeThreadId: initial.activeThreadId,

  newThread: () => {
    const thread = createEmptyThread();
    set((s) => persist({ ...s, threads: [thread, ...s.threads], activeThreadId: thread.id }));
    return thread.id;
  },

  selectThread: (id) => {
    set((s) =>
      s.threads.some((t) => t.id === id) ? persist({ ...s, activeThreadId: id }) : s
    );
  },

  deleteThread: (id) => {
    set((s) => {
      const threads = s.threads.filter((t) => t.id !== id);
      let activeThreadId = s.activeThreadId;
      if (activeThreadId === id) {
        // Fall back to the most-recently-updated remaining thread, else null.
        const next = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        activeThreadId = next?.id ?? null;
      }
      return persist({ ...s, threads, activeThreadId });
    });
  },

  clearActiveThread: () => {
    set((s) => {
      const id = s.activeThreadId;
      if (!id) return s;
      const threads = s.threads.map((t) =>
        t.id === id
          ? {
              ...t,
              transcript: [],
              history: [],
              title: DEFAULT_THREAD_TITLE,
              usage: emptyThreadUsage(),
              updatedAt: Date.now(),
            }
          : t
      );
      return persist({ ...s, threads });
    });
  },

  appendUserAndAssistant: (userTurn, assistantTurn, userMessage) => {
    // Ensure there is an active thread (create one if the store is empty).
    let activeId = get().activeThreadId;
    if (!activeId || !get().threads.some((t) => t.id === activeId)) {
      activeId = get().newThread();
    }
    set((s) => {
      const threads = s.threads.map((t) => {
        if (t.id !== activeId) return t;
        const isFirstUserMessage = !t.transcript.some((x) => x.role === "user");
        return {
          ...t,
          title: isFirstUserMessage ? deriveTitle(userTurn.text) : t.title,
          transcript: [...t.transcript, userTurn, assistantTurn],
          history: [...t.history, userMessage],
          updatedAt: Date.now(),
        };
      });
      return persist({ ...s, threads });
    });
    return assistantTurn.id;
  },

  patchAssistantRun: (threadId, assistantId, run) => {
    set((s) => {
      if (!s.threads.some((t) => t.id === threadId)) return s;
      const threads = s.threads.map((t) => {
        if (t.id !== threadId) return t;
        return {
          ...t,
          transcript: t.transcript.map((x) =>
            x.role === "assistant" && x.id === assistantId ? { ...x, run } : x
          ),
          updatedAt: Date.now(),
        };
      });
      const next = { ...s, threads };
      // PERF (task 1293): live streaming deltas (`running`) update the in-memory
      // UI only — they do NOT persist, so streaming doesn't thrash localStorage.
      // Only a TERMINAL run (done/error/stopped) is persisted, so the finished
      // transcript survives a refresh.
      return isTerminalRunStatus(run.status) ? persist(next) : next;
    });
  },

  appendActiveHistory: (messages) => {
    if (messages.length === 0) return;
    set((s) => {
      const id = s.activeThreadId;
      if (!id) return s;
      const threads = s.threads.map((t) =>
        t.id === id
          ? { ...t, history: [...t.history, ...messages], updatedAt: Date.now() }
          : t
      );
      return persist({ ...s, threads });
    });
  },

  addThreadUsage: (threadId, usage) => {
    set((s) => {
      if (!s.threads.some((t) => t.id === threadId)) return s;
      const threads = s.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              usage: accumulateUsage(t.usage ?? emptyThreadUsage(), usage),
              updatedAt: Date.now(),
            }
          : t
      );
      // A completed turn's totals must persist (survive reload) — always save.
      return persist({ ...s, threads });
    });
  },

  addThreadCost: (threadId, cost, estimated) => {
    if (typeof cost !== "number" || !Number.isFinite(cost)) return;
    set((s) => {
      const target = s.threads.find((t) => t.id === threadId);
      if (!target) return s;
      // Guard against a late deferred estimate landing on a thread that was
      // CLEARED (or never had tokens) between turn-end and pricing resolution:
      // a cleared thread is reset to zero tokens, so adding cost would orphan a
      // cost with no tokens (invisible, and stale once new tokens arrive). The
      // estimate always follows an addThreadUsage that recorded tokens, so a
      // zero-token thread here means it was reset in the interim — drop it.
      if ((target.usage ?? emptyThreadUsage()).totalTokens <= 0) return s;
      const threads = s.threads.map((t) => {
        if (t.id !== threadId) return t;
        const prev = t.usage ?? emptyThreadUsage();
        return {
          ...t,
          usage: {
            ...prev,
            cost: prev.cost + cost,
            costKnown: true,
            costHasEstimate: prev.costHasEstimate || estimated,
          },
          updatedAt: Date.now(),
        };
      });
      return persist({ ...s, threads });
    });
  },
}));

/**
 * Helper used inside every mutating action: persist the new state to
 * localStorage and return it unchanged (so it doubles as the set() return). The
 * persisted snapshot is bounded/trimmed by {@link saveThreads}.
 */
function persist(next: ThreadState): ThreadState {
  saveThreads({ threads: next.threads, activeThreadId: next.activeThreadId });
  return next;
}

/** Threads sorted most-recently-updated first (for the switcher list). */
export function selectThreadsByRecency(s: ThreadState): ChatThread[] {
  return [...s.threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The currently active thread, or undefined when there is none. */
export function selectActiveThread(s: ThreadState): ChatThread | undefined {
  return s.threads.find((t) => t.id === s.activeThreadId);
}
