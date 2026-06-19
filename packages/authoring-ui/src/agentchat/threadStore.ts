import { create } from "zustand";
import type { ModelMessage } from "ai";
import type { AgentRunState } from "./agentLoop.js";

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
// The IN-FLIGHT run writes into the active thread: AgentChatPanel patches the
// streaming AgentRunState onto the active thread's transcript via
// `patchActiveAssistantRun`, so streaming/thinking/tool chips all persist.
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

/** One conversation thread. */
export interface ChatThread {
  id: string;
  /** Derived from the first user message (truncated); DEFAULT_THREAD_TITLE until then. */
  title: string;
  /** The rendered transcript (user bubbles + assistant runs). */
  transcript: Turn[];
  /** The model-message history (assistant + tool), preserved for multi-turn context. */
  history: ModelMessage[];
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
  /** Patch the streaming AgentRunState onto an assistant turn in the active thread. */
  patchActiveAssistantRun: (assistantId: string, run: AgentRunState) => void;
  /** Append model response messages (assistant + tool) to the active thread's history. */
  appendActiveHistory: (messages: ModelMessage[]) => void;
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
  return {
    id: o.id,
    title:
      typeof o.title === "string" && o.title.length > 0
        ? o.title
        : DEFAULT_THREAD_TITLE,
    transcript,
    history,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : now,
  };
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

  patchActiveAssistantRun: (assistantId, run) => {
    set((s) => {
      const id = s.activeThreadId;
      if (!id) return s;
      const threads = s.threads.map((t) => {
        if (t.id !== id) return t;
        return {
          ...t,
          transcript: t.transcript.map((x) =>
            x.role === "assistant" && x.id === assistantId ? { ...x, run } : x
          ),
          updatedAt: Date.now(),
        };
      });
      return persist({ ...s, threads });
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
