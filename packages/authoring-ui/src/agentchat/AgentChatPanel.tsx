import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ModelMessage } from "ai";
import { useShallow } from "zustand/react/shallow";
import { chrome, chromeFont, halo, inputStyle, buttonStyle } from "../theme/flash8Theme.js";
import { usePreferences } from "../preferences.js";
import { AgentSettings } from "./AgentSettings.js";
import {
  createDashOpenRouter,
  getModel,
  fetchOpenRouterModels,
  parseModelPricing,
  computeCostFromPricing,
  type OpenRouterModelPricing,
} from "./openrouterClient.js";
import { buildAgentTools } from "./tools.js";
import { AGENT_SYSTEM_PROMPT } from "./systemPrompt.js";
import {
  runAgentTurn,
  initialAgentRunState,
  classifyAgentError,
  clampMaxSteps,
  DEFAULT_MAX_STEPS,
  type AgentRunState,
  type AgentEntry,
  type AgentToolEntry,
  type AgentTurnUsage,
} from "./agentLoop.js";
import { AgentMarkdown } from "./AgentMarkdown.js";
import {
  useThreadStore,
  selectThreadsByRecency,
  selectActiveThread,
  DEFAULT_THREAD_TITLE,
  emptyThreadUsage,
  type Turn as StoredTurn,
  type UserTurn as StoredUserTurn,
  type AssistantTurn as StoredAssistantTurn,
  type ThreadUsage,
} from "./threadStore.js";

// ---------------------------------------------------------------------------
// AgentChatPanel — the client-side Agent Chat docked in the RIGHT pane (P3).
//
// Layout (top → bottom):
//   - A collapsible Settings section (the P1 AgentSettings: API key + model),
//     persisted via usePreferences (openrouterApiKey, agentModel).
//   - The chat transcript: user bubbles + assistant turns. Each assistant turn
//     renders streamed text, a THINKING indicator (reasoning), TOOL-CALL chips
//     (name -> args -> result/error), and step boundaries.
//   - The composer: a textarea + Send. While a run is live, Send becomes Stop
//     (controller.abort()).
//
// The agent loop itself lives in ./agentLoop (runAgentTurn / reduceAgentEvent);
// this component owns conversation history + UI state and renders the run.
// ---------------------------------------------------------------------------

// The max model steps for the multi-step tool loop is no longer a hardcoded
// constant: it defaults to DEFAULT_MAX_STEPS (a generous backstop, raised from
// the old 24 that cut long tasks off mid-work) and is user-configurable via the
// `agentMaxSteps` preference, clamped to a sane range by `clampMaxSteps`.

/**
 * A sensible default model when the user hasn't picked one yet — a capable,
 * widely-available coding model. Used only as the effective model id when
 * `agentModel` is blank but a key IS present; the Settings selector still owns
 * the persisted choice. (Falls back gracefully if the account lacks access — the
 * error is then surfaced via {@link classifyAgentError}.)
 */
export const DEFAULT_AGENT_MODEL = "anthropic/claude-sonnet-4.5";

// The transcript model (UserTurn/AssistantTurn/Turn) now lives in ./threadStore
// so the persisted store and this panel share one definition. Re-aliased here
// for readability in the render code below.
type UserTurn = StoredUserTurn;
type AssistantTurn = StoredAssistantTurn;
type Turn = StoredTurn;

export interface AgentChatPanelProps {
  /**
   * Injectable turn runner (defaults to {@link runAgentTurn}); tests pass a
   * mock so no real API key / network is needed.
   */
  runTurn?: typeof runAgentTurn;
  /**
   * Injectable tool-set builder (defaults to {@link buildAgentTools}); tests
   * override so dispatch never touches the live editor.
   */
  buildTools?: typeof buildAgentTools;
}

let turnSeq = 0;
function nextTurnId(): string {
  turnSeq += 1;
  return `turn-${turnSeq}-${Date.now()}`;
}

/**
 * Test seam (e2e oracle): when a Playwright/browser test installs
 * `window.__agentChatTestHook`, the panel routes turns through the hook's
 * `runTurn` instead of the real OpenRouter-backed loop — so the chat can be
 * exercised end-to-end with a STUBBED model that emits a tool call, with NO real
 * API key or network. The hook is never set in production (only by the test
 * harness), so this is inert at runtime. The hook deliberately reuses the SAME
 * default `buildAgentTools()` so a stubbed model's tool call still flows through
 * `dispatchAgentCommand` into the live document — proving the chat drives
 * authoring.
 */
export interface AgentChatTestHook {
  runTurn: typeof runAgentTurn;
  buildTools?: typeof buildAgentTools;
}

function readTestHook(): AgentChatTestHook | undefined {
  if (typeof window === "undefined") return undefined;
  const hook = (window as unknown as Record<string, unknown>)
    .__agentChatTestHook;
  if (hook && typeof (hook as AgentChatTestHook).runTurn === "function") {
    return hook as AgentChatTestHook;
  }
  return undefined;
}

export function AgentChatPanel(
  props: AgentChatPanelProps = {}
): React.JSX.Element {
  const testHook = readTestHook();
  const runTurn = props.runTurn ?? testHook?.runTurn ?? runAgentTurn;
  const buildTools =
    props.buildTools ?? testHook?.buildTools ?? buildAgentTools;
  const { preferences, updatePreferences } = usePreferences();
  const apiKey = preferences.openrouterApiKey ?? "";
  const model = preferences.agentModel ?? "";
  const hasKey = apiKey.trim().length > 0;
  // The model actually sent to the loop: the user's pick, or a sensible default
  // once a key is present (so a user with a key but no explicit model can still
  // chat instead of being hard-blocked).
  const effectiveModel = model.trim().length > 0 ? model.trim() : DEFAULT_AGENT_MODEL;
  // The effective step-loop backstop: the user's configured cap (clamped to a
  // sane range), or the generous default when unset. Never the old hard 24.
  const maxSteps =
    preferences.agentMaxSteps != null
      ? clampMaxSteps(preferences.agentMaxSteps)
      : DEFAULT_MAX_STEPS;

  // Conversation state lives in the PERSISTED thread store (task 1291), so it
  // survives leaving/returning to the Agent tab (unmount/remount) AND a full
  // page refresh. The active thread's transcript is what we render; its
  // `history` (ModelMessage[]) is the multi-turn context the loop receives.
  // selectThreadsByRecency returns a freshly-sorted array on every call, so it
  // MUST be wrapped in useShallow under zustand v5 — otherwise useSyncExternalStore
  // sees a new snapshot reference each render and React loops ("getSnapshot should
  // be cached" → "Maximum update depth exceeded"), which blanks the whole panel.
  const threads = useThreadStore(useShallow(selectThreadsByRecency));
  const activeThread = useThreadStore(selectActiveThread);
  const activeThreadId = useThreadStore((s) => s.activeThreadId);
  const newThread = useThreadStore((s) => s.newThread);
  const selectThread = useThreadStore((s) => s.selectThread);
  const deleteThread = useThreadStore((s) => s.deleteThread);
  const clearActiveThread = useThreadStore((s) => s.clearActiveThread);
  const appendUserAndAssistant = useThreadStore((s) => s.appendUserAndAssistant);
  const patchAssistantRun = useThreadStore((s) => s.patchAssistantRun);
  const appendActiveHistory = useThreadStore((s) => s.appendActiveHistory);
  const addThreadUsage = useThreadStore((s) => s.addThreadUsage);
  const addThreadCost = useThreadStore((s) => s.addThreadCost);

  const turns: Turn[] = activeThread?.transcript ?? [];
  // Running per-thread token + cost totals (task 1337). Defaults to all-zero for
  // a thread without a stored usage blob (e.g. one created before this feature).
  const threadUsage: ThreadUsage = activeThread?.usage ?? emptyThreadUsage();

  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => !hasKey);
  const [threadMenuOpen, setThreadMenuOpen] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);

  // Per-model pricing cache for the COMPUTED cost fallback (task 1337). The
  // primary cost path is OpenRouter's REPORTED cost (no fetch needed); we only
  // fetch the catalog lazily — and once — when a completed turn had NO reported
  // cost, so the common case adds zero network. Maps model id -> pricing (or
  // null when the model has no pricing / the catalog couldn't be loaded).
  const pricingCacheRef = useRef<Map<string, OpenRouterModelPricing | null>>(
    new Map()
  );

  // The id of the assistant turn currently being streamed (so onState patches
  // the right entry).
  const activeAssistantIdRef = useRef<string | null>(null);

  // The thread the in-flight run was STARTED on (task 1293). Streaming patches
  // are scoped to THIS thread, not whatever is active when a delta arrives, so a
  // mid-run thread switch can't land patches in the wrong thread. Null when idle.
  const runThreadIdRef = useRef<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  // Auto-scroll to the bottom as content streams in.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  // Safety net (task 1293): if the active thread changes while a run is in
  // flight, abort the run. Streaming patches are already scoped to the origin
  // thread (runThreadIdRef), so they can never mutate the wrong thread; aborting
  // on switch is the belt-and-braces guarantee that an in-flight stream only ever
  // touches its origin thread. (The if(running) UI guards already block the
  // common switch paths; this also covers programmatic / race switches.)
  useEffect(() => {
    if (
      running &&
      runThreadIdRef.current !== null &&
      activeThreadId !== runThreadIdRef.current
    ) {
      controllerRef.current?.abort();
    }
  }, [running, activeThreadId]);

  const tools = useMemo(() => buildTools(), [buildTools]);

  // Send is enabled once there's text + a key (the model falls back to a
  // default). The missing-key case is handled with a friendly banner, not a
  // silently-dead button.
  const canSend = !running && input.trim().length > 0 && hasKey;

  // Resolve the selected model's per-token pricing for the COMPUTED-cost
  // fallback (task 1337). Lazily fetches + caches the OpenRouter catalog the
  // first time a turn lacks a reported cost; subsequent calls hit the cache.
  // Returns undefined on any failure (missing key, network, no pricing) so the
  // caller degrades to "tokens only, cost unknown".
  const resolveModelPricing = useCallback(
    async (modelId: string): Promise<OpenRouterModelPricing | undefined> => {
      const cache = pricingCacheRef.current;
      if (cache.has(modelId)) return cache.get(modelId) ?? undefined;
      if (!hasKey) return undefined;
      try {
        const models = await fetchOpenRouterModels(apiKey.trim());
        for (const m of models) {
          cache.set(m.id, parseModelPricing(m.raw) ?? null);
        }
        // Mark unseen ids as null so we don't refetch for a missing model.
        if (!cache.has(modelId)) cache.set(modelId, null);
        return cache.get(modelId) ?? undefined;
      } catch {
        // Don't poison the cache on a transient failure — leave it unset so a
        // later turn can retry once.
        return undefined;
      }
    },
    [hasKey, apiKey]
  );

  // Finalize a completed turn's usage and fold it into the thread total
  // (task 1337). Tokens (+ OpenRouter's REPORTED cost, when present) are
  // accumulated SYNCHRONOUSLY so the footer updates the instant the turn ends.
  // When NO cost was reported, a COMPUTED estimate is filled in afterwards via a
  // deferred, fire-and-forget pricing lookup (`addThreadCost`) — so a slow/failed
  // catalog fetch never blocks the run from settling, and the tokens still show.
  const recordTurnUsage = useCallback(
    (threadId: string, modelId: string, turnUsage: AgentTurnUsage) => {
      // 1) Tokens + any reported cost, immediately.
      addThreadUsage(threadId, turnUsage);
      // 2) If cost is still unknown, compute an estimate from the pricing of the
      //    model THIS turn ran on (modelId — captured at send time, NOT the
      //    current selector, which the user may have changed since). Deferred +
      //    fire-and-forget; never throws (resolveModelPricing swallows failures).
      //    `addThreadCost` itself is a no-op if the thread was cleared/deleted in
      //    the meantime, so a late estimate can't orphan cost onto a reset thread.
      if (turnUsage.cost === undefined) {
        void resolveModelPricing(modelId).then((pricing) => {
          const computed = computeCostFromPricing(
            pricing,
            turnUsage.inputTokens,
            turnUsage.outputTokens
          );
          if (computed !== undefined) addThreadCost(threadId, computed, true);
        });
      }
    },
    [resolveModelPricing, addThreadUsage, addThreadCost]
  );

  // The core run: append the user+assistant turns and drive one agent turn to a
  // terminal state. Shared by Send (composer text) and Continue (resume after a
  // `max-steps` backstop), so both go through the exact same persistence + abort
  // wiring. `text` is the already-trimmed message to send.
  const submitMessage = useCallback(
    async (text: string) => {
    if (text.length === 0 || running) return;
    if (!hasKey) {
      // No key — open Settings and surface the actionable hint as a turn so the
      // intent isn't silently dropped. Still recorded in the active thread so it
      // persists like any other turn.
      setSettingsOpen(true);
      const assistantId = nextTurnId();
      const friendly = classifyAgentError(null, { hasKey: false, hasModel: true });
      appendUserAndAssistant(
        { role: "user", id: nextTurnId(), text },
        {
          role: "assistant",
          id: assistantId,
          run: { entries: [], status: "error", error: friendly.message },
        },
        { role: "user", content: text }
      );
      return;
    }

    const userTurn: UserTurn = { role: "user", id: nextTurnId(), text };
    const assistantId = nextTurnId();
    const assistantTurn: AssistantTurn = {
      role: "assistant",
      id: assistantId,
      run: initialAgentRunState(),
    };
    activeAssistantIdRef.current = assistantId;

    // Snapshot the active thread's history BEFORE appending the new user
    // message, then build the messages the loop will see (prior history + this
    // user turn). The store records the same user message + the live assistant
    // turn into the active thread (creating one if none exists), so the in-flight
    // run writes into — and persists against — the active thread.
    const priorHistory = selectActiveThread(useThreadStore.getState())?.history ?? [];
    const userMessage: ModelMessage = { role: "user", content: text };
    const messages: ModelMessage[] = [...priorHistory, userMessage];

    appendUserAndAssistant(userTurn, assistantTurn, userMessage);
    // Capture the ORIGIN thread the run is started on (appendUserAndAssistant
    // creates one if the store was empty). All streaming patches target THIS
    // thread explicitly, not the live activeThreadId, so a mid-run thread switch
    // can never land patches in the wrong thread (task 1293).
    const originThreadId = useThreadStore.getState().activeThreadId;
    runThreadIdRef.current = originThreadId;
    setRunning(true);

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const provider = createDashOpenRouter(apiKey.trim(), {});
      const languageModel = getModel(provider, effectiveModel);
      const { state, responseMessages, usage } = await runTurn({
        model: languageModel,
        system: AGENT_SYSTEM_PROMPT,
        tools,
        messages,
        maxSteps,
        abortSignal: controller.signal,
        onState: (run) =>
          originThreadId &&
          patchAssistantRun(originThreadId, assistantId, run),
      });
      // If the turn ended in error, rewrite the raw provider message into a
      // friendly, actionable one (auth / network / model / rate-limit).
      if (state.status === "error") {
        const friendly = classifyAgentError(state.error, {
          hasKey: true,
          hasModel: true,
        });
        if (friendly.openSettings) setSettingsOpen(true);
        if (originThreadId) {
          patchAssistantRun(originThreadId, assistantId, {
            ...state,
            error: friendly.message,
          });
        }
      }
      // Persist the model's assistant + tool messages for the next turn.
      // Defensive: a custom/overridden runTurn (or an abort/error path) may
      // return undefined here instead of an empty array, so guard against it
      // rather than throwing on `.length`. History is appended to the ORIGIN
      // thread only when it is still active — if the user switched away (which
      // also aborts the run, task 1293), the active thread is a different
      // conversation and must not receive this run's history.
      if (
        responseMessages &&
        responseMessages.length > 0 &&
        useThreadStore.getState().activeThreadId === originThreadId
      ) {
        appendActiveHistory(responseMessages);
      }
      // Fold this turn's token + cost usage into the ORIGIN thread's running
      // total (task 1337). Always targets the origin thread (even if the user
      // switched away), so the per-thread counter is correct regardless of the
      // active thread. Only when the turn actually consumed tokens.
      if (usage && originThreadId && usage.totalTokens > 0) {
        // `effectiveModel` here is the model THIS turn ran on (the same value
        // passed to getModel above), so a deferred pricing estimate uses the
        // right model even if the user switches the selector before it resolves.
        recordTurnUsage(originThreadId, effectiveModel, usage);
      }
    } catch (err) {
      // runTurn folds errors into state; this is a final safety net for an
      // unexpected throw (e.g. createDashOpenRouter / getModel).
      const friendly = classifyAgentError(err, { hasKey: true, hasModel: true });
      if (friendly.openSettings) setSettingsOpen(true);
      if (originThreadId) {
        patchAssistantRun(originThreadId, assistantId, {
          entries: [],
          status: "error",
          error: friendly.message,
        });
      }
    } finally {
      setRunning(false);
      controllerRef.current = null;
      activeAssistantIdRef.current = null;
      runThreadIdRef.current = null;
    }
    },
    [
      running,
      hasKey,
      apiKey,
      effectiveModel,
      maxSteps,
      tools,
      runTurn,
      patchAssistantRun,
      appendUserAndAssistant,
      appendActiveHistory,
      recordTurnUsage,
    ]
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (text.length === 0 || running) return;
    // Clear the composer optimistically; submitMessage records the turn. (The
    // missing-key branch inside submitMessage still records the dropped intent.)
    setInput("");
    await submitMessage(text);
  }, [input, running, submitMessage]);

  // Continue after the step-limit backstop (task 1305): resume the SAME thread
  // with a short nudge so the agent picks up where the cap cut it off. The prior
  // run's assistant + tool history is already persisted, so the model has full
  // context; this just grants it another `maxSteps` budget. Disabled while a run
  // is live.
  const handleContinue = useCallback(() => {
    if (running) return;
    void submitMessage("Continue.");
  }, [running, submitMessage]);

  const handleStop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter inserts a newline.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleClear = useCallback(() => {
    if (running) return;
    clearActiveThread();
  }, [running, clearActiveThread]);

  const handleNewThread = useCallback(() => {
    if (running) return;
    newThread();
    setThreadMenuOpen(false);
  }, [running, newThread]);

  const handleSelectThread = useCallback(
    (id: string) => {
      if (running) return;
      selectThread(id);
      setThreadMenuOpen(false);
    },
    [running, selectThread]
  );

  const handleDeleteThread = useCallback(
    (id: string) => {
      // Deleting a non-active thread is safe mid-run; deleting the active thread
      // while a run is in flight would orphan the streaming patches, so block it.
      if (running && id === activeThreadId) return;
      deleteThread(id);
    },
    [running, activeThreadId, deleteThread]
  );

  return (
    <div data-testid="agent-chat-panel" style={styles.root}>
      {/* --- Settings (collapsible) --- */}
      <div style={styles.settingsBar}>
        <button
          type="button"
          data-testid="agent-settings-toggle"
          onClick={() => setSettingsOpen((v) => !v)}
          style={styles.settingsToggle}
        >
          {settingsOpen ? "▾" : "▸"} Settings
        </button>
        <span style={styles.modelHint} data-testid="agent-model-hint">
          {model ? model : `${DEFAULT_AGENT_MODEL} (default)`}
        </span>
        <button
          type="button"
          data-testid="agent-clear"
          onClick={handleClear}
          disabled={running || turns.length === 0}
          style={buttonStyle(running || turns.length === 0 ? "disabled" : "up")}
        >
          Clear
        </button>
      </div>
      {settingsOpen && (
        <div style={styles.settingsBody} data-testid="agent-settings-body">
          <AgentSettings
            apiKey={apiKey}
            onApiKeyChange={(k) => updatePreferences({ openrouterApiKey: k })}
            model={model}
            onModelChange={(m) => updatePreferences({ agentModel: m })}
            maxSteps={maxSteps}
            maxStepsIsDefault={preferences.agentMaxSteps == null}
            onMaxStepsChange={(n) => updatePreferences({ agentMaxSteps: n })}
          />
        </div>
      )}

      {/* --- Thread switcher (task 1291) --- */}
      <div style={styles.threadBar} data-testid="agent-thread-bar">
        <button
          type="button"
          data-testid="agent-thread-switcher"
          onClick={() => setThreadMenuOpen((v) => !v)}
          style={styles.threadSwitcher}
          title="Switch conversation"
        >
          <span style={styles.threadSwitcherTitle}>
            {activeThread?.title ?? DEFAULT_THREAD_TITLE}
          </span>
          <span style={styles.threadCaret}>{threadMenuOpen ? "▾" : "▸"}</span>
        </button>
        <button
          type="button"
          data-testid="agent-new-thread"
          onClick={handleNewThread}
          disabled={running}
          style={buttonStyle(running ? "disabled" : "up")}
          title="Start a new chat"
        >
          New chat
        </button>
      </div>
      {threadMenuOpen && (
        <div style={styles.threadMenu} data-testid="agent-thread-menu">
          {threads.length === 0 && (
            <div style={styles.threadMenuEmpty} data-testid="agent-thread-empty">
              No conversations yet.
            </div>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              style={{
                ...styles.threadMenuItem,
                ...(t.id === activeThreadId
                  ? styles.threadMenuItemActive
                  : null),
              }}
              data-testid="agent-thread-item"
              data-active={t.id === activeThreadId ? "true" : "false"}
            >
              <button
                type="button"
                data-testid="agent-thread-select"
                onClick={() => handleSelectThread(t.id)}
                disabled={running}
                style={styles.threadMenuSelect}
                title={t.title}
              >
                <span style={styles.threadMenuItemTitle}>{t.title}</span>
                <span style={styles.threadMenuItemTime}>
                  {formatThreadTime(t.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                data-testid="agent-thread-delete"
                onClick={() => handleDeleteThread(t.id)}
                disabled={running && t.id === activeThreadId}
                style={styles.threadMenuDelete}
                title="Delete this conversation"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* --- Missing-key banner --- */}
      {!hasKey && (
        <button
          type="button"
          data-testid="agent-key-banner"
          onClick={() => setSettingsOpen(true)}
          style={styles.keyBanner}
        >
          ⚠ Add an OpenRouter API key in Settings to start chatting. Your key
          stays in this browser (localStorage) and is sent only to openrouter.ai.
        </button>
      )}

      {/* --- Transcript --- */}
      <div
        style={styles.transcript}
        data-testid="agent-transcript"
        ref={transcriptRef}
      >
        {turns.length === 0 && (
          <div style={styles.empty} data-testid="agent-empty">
            Ask the Dash Agent to build or edit your movie. It can read the
            document and drive the editor through tools — e.g. “draw a red
            rectangle in the middle of the stage” or “add a layer named UI”.
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <UserBubble key={t.id} text={t.text} />
          ) : (
            <AssistantBubble
              key={t.id}
              run={t.run}
              // The Continue button only applies to the LAST turn (resuming the
              // tail of the conversation), and only when no run is in flight.
              onContinue={
                i === turns.length - 1 && !running ? handleContinue : undefined
              }
            />
          )
        )}
      </div>

      {/* --- Usage footer (per-thread token + cost total, task 1337) --- */}
      {(() => {
        const line = formatUsageLine(threadUsage);
        if (!line) return null;
        return (
          <div
            style={styles.usageBar}
            data-testid="agent-usage"
            title="Total tokens and cost for this conversation"
          >
            {line}
          </div>
        );
      })()}

      {/* --- Composer --- */}
      <div style={styles.composer}>
        <textarea
          data-testid="agent-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            apiKey.trim().length === 0
              ? "Add an OpenRouter API key in Settings to begin…"
              : "Message the Dash Agent…  (Enter to send, Shift+Enter for newline)"
          }
          rows={3}
          spellCheck
          style={styles.textarea}
        />
        <div style={styles.composerActions}>
          {running ? (
            <button
              type="button"
              data-testid="agent-stop"
              onClick={handleStop}
              style={{ ...buttonStyle("up"), ...styles.stopButton }}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              data-testid="agent-send"
              onClick={() => void handleSend()}
              disabled={!canSend}
              style={buttonStyle(canSend ? "up" : "disabled")}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ----------------------------------------------------------

function UserBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div style={styles.userRow} data-testid="agent-user-message">
      <div style={styles.userBubble}>{text}</div>
    </div>
  );
}

function AssistantBubble({
  run,
  onContinue,
}: {
  run: AgentRunState;
  /** When present (last turn, idle), render a Continue button on max-steps. */
  onContinue?: () => void;
}): React.JSX.Element {
  const hasContent = run.entries.length > 0;
  const pending = run.status === "running" && !hasContent;
  return (
    <div style={styles.assistantRow} data-testid="agent-assistant-message">
      {pending && (
        <div style={styles.thinking} data-testid="agent-pending">
          <Spinner /> Thinking…
        </div>
      )}
      {run.entries.map((e, i) => (
        <EntryView key={entryKey(e, i)} entry={e} />
      ))}
      {run.status === "running" && hasContent && (
        <div style={styles.statusLine} data-testid="agent-status-running">
          <Spinner /> Working…
        </div>
      )}
      {run.status === "stopped" && (
        <div
          style={{ ...styles.statusLine, color: halo.disabledText }}
          data-testid="agent-status-stopped"
        >
          ■ Stopped
        </div>
      )}
      {run.status === "max-steps" && (
        // The step-limit backstop fired while the agent still wanted to call
        // tools — the task is unfinished, not done. Surface it clearly and
        // offer to keep going (a fresh step budget on the same thread) rather
        // than leaving the user staring at a silent, confusing stop (task 1305).
        <div style={styles.maxSteps} data-testid="agent-status-max-steps">
          <div style={styles.statusLine}>
            ⚠ Reached the step limit before finishing. The agent paused as a
            safety backstop — your task may not be complete.
          </div>
          {onContinue && (
            <button
              type="button"
              data-testid="agent-continue"
              onClick={onContinue}
              style={{ ...buttonStyle("up"), ...styles.continueButton }}
            >
              Continue
            </button>
          )}
        </div>
      )}
      {run.status === "error" && (
        <div
          style={{ ...styles.statusLine, ...styles.errorLine }}
          data-testid="agent-status-error"
        >
          ⚠ {run.error ?? "Error"}
        </div>
      )}
    </div>
  );
}

function entryKey(e: AgentEntry, i: number): string {
  if (e.kind === "tool") return `tool-${e.toolCallId}`;
  if (e.kind === "text" || e.kind === "reasoning") return `${e.kind}-${e.id}`;
  return `step-${e.step}-${i}`;
}

function EntryView({ entry }: { entry: AgentEntry }): React.JSX.Element | null {
  switch (entry.kind) {
    case "text":
      // Assistant text bodies render as themed, XSS-safe Markdown (task 1290):
      // react-markdown re-parses on every streaming delta and degrades
      // gracefully on partial/unclosed markdown. User messages + tool chips stay
      // plain. The container keeps the transcript's user-select:text (task 1285).
      return (
        <div style={styles.assistantText} data-testid="agent-text">
          <AgentMarkdown>{entry.text}</AgentMarkdown>
        </div>
      );
    case "reasoning":
      return (
        <div style={styles.reasoning} data-testid="agent-reasoning">
          <span style={styles.reasoningLabel}>thinking</span>
          {entry.text}
        </div>
      );
    case "step":
      return (
        <div style={styles.stepDivider} data-testid="agent-step">
          step {entry.step}
        </div>
      );
    case "tool":
      return <ToolChip entry={entry} />;
    default:
      return null;
  }
}

function ToolChip({ entry }: { entry: AgentToolEntry }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const color =
    entry.status === "error"
      ? "#e05050"
      : entry.status === "result"
        ? "#4a9e4a"
        : halo.haloBlue;
  return (
    <div style={styles.toolChip} data-testid="agent-tool-chip">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={styles.toolChipHeader}
        data-testid="agent-tool-header"
      >
        <span style={{ ...styles.toolStatusDot, background: color }} />
        <span style={styles.toolName} data-testid="agent-tool-name">
          {entry.toolName}
        </span>
        <span style={styles.toolStatus} data-testid="agent-tool-status">
          {entry.status === "running"
            ? "running…"
            : entry.status === "error"
              ? "error"
              : "done"}
        </span>
        <span style={styles.toolCaret}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={styles.toolBody}>
          <div style={styles.toolSectionLabel}>args</div>
          <pre style={styles.toolPre} data-testid="agent-tool-args">
            {prettyJson(entry.input)}
          </pre>
          {entry.status === "error" ? (
            <>
              <div style={styles.toolSectionLabel}>error</div>
              <pre
                style={{ ...styles.toolPre, color: "#e05050" }}
                data-testid="agent-tool-error"
              >
                {entry.error}
              </pre>
            </>
          ) : entry.status === "result" ? (
            <>
              <div style={styles.toolSectionLabel}>result</div>
              {isImageToolOutput(entry.output) ? (
                <ScreenshotResult output={entry.output} />
              ) : isPublishSwfToolOutput(entry.output) ? (
                <PublishSwfResult output={entry.output} />
              ) : (
                <pre style={styles.toolPre} data-testid="agent-tool-result">
                  {prettyJson(entry.output)}
                </pre>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Spinner(): React.JSX.Element {
  return <span style={styles.spinner} aria-hidden="true" />;
}

/**
 * Format a thread's updatedAt timestamp compactly for the switcher: a relative
 * label for recent times ("just now", "5m", "3h"), falling back to a short
 * locale date for older threads. Dependency-free + deterministic given `now`.
 */
export function formatThreadTime(ts: number, now: number = Date.now()): string {
  const diffMs = now - ts;
  if (diffMs < 0) return "just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return `${day}d`;
  }
}

/**
 * Format a thread's running token + cost total into a compact one-line summary
 * for the Agent pane footer (task 1337), e.g. `12,345 tokens · $0.0123` or, when
 * the cost was computed from pricing, `12,345 tokens · ~$0.0123 est.`. When no
 * cost is known the cost segment is dropped: `12,345 tokens`. Returns null for a
 * truly empty thread (no tokens consumed) so the footer is hidden.
 */
export function formatUsageLine(usage: ThreadUsage): string | null {
  if (!usage || usage.totalTokens <= 0) return null;
  const tokens = `${usage.totalTokens.toLocaleString("en-US")} tokens`;
  if (!usage.costKnown) return tokens;
  return `${tokens} · ${formatCost(usage.cost, usage.costHasEstimate)}`;
}

/**
 * Format a USD cost. Tiny non-zero costs (< $0.0001) show as `<$0.0001` so a
 * real-but-small cost never collapses to a misleading `$0.0000`. Estimated
 * costs get a leading `~` and a trailing ` est.` label.
 */
export function formatCost(cost: number, estimated: boolean): string {
  const prefix = estimated ? "~" : "";
  const suffix = estimated ? " est." : "";
  let body: string;
  if (cost > 0 && cost < 0.0001) {
    body = "<$0.0001";
  } else {
    // 4 dp is enough to show sub-cent agent turns without noise.
    body = `$${cost.toFixed(4)}`;
  }
  return `${prefix}${body}${suffix}`;
}

/** A tool result that carries a rendered image as a base64 PNG (stage_screenshot). */
interface ImageToolOutput {
  pngBase64: string;
  width: number;
  height: number;
}

/**
 * Detect a screenshot-style tool result so the chip can show a compact
 * `screenshot (WxH)` summary + thumbnail instead of dumping tens-of-KB of
 * base64 into the chip body.
 */
function isImageToolOutput(value: unknown): value is ImageToolOutput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.pngBase64 === "string" &&
    typeof v.width === "number" &&
    typeof v.height === "number"
  );
}

/**
 * Render a screenshot tool result as a label + small thumbnail. The base64 PNG
 * is shown as an <img>, never as raw text — the giant base64 string stays out
 * of the chip body.
 */
function ScreenshotResult({
  output,
}: {
  output: ImageToolOutput;
}): React.JSX.Element {
  return (
    <div data-testid="agent-tool-result">
      <div style={styles.toolPre}>
        screenshot ({output.width}×{output.height})
      </div>
      <img
        src={`data:image/png;base64,${output.pngBase64}`}
        alt={`Stage screenshot ${output.width}×${output.height}`}
        style={styles.toolScreenshot}
      />
    </div>
  );
}

/**
 * A publish_swf tool result. The raw result still carries the full `swfBase64`
 * (the app/UI side uses it), so the chip must summarize it rather than dump the
 * base64 blob into the chip body (task 1306).
 */
interface PublishSwfToolOutput {
  byteLength: number;
  width: number;
  height: number;
  swfBase64: string;
}

/** Detect a publish_swf tool result so the chip can show a compact summary. */
function isPublishSwfToolOutput(value: unknown): value is PublishSwfToolOutput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.swfBase64 === "string" &&
    typeof v.byteLength === "number" &&
    typeof v.width === "number" &&
    typeof v.height === "number"
  );
}

/** Format a byte count compactly (e.g. 5.7 KB) for the publish chip. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Render a publish_swf tool result as a one-line summary. The `swfBase64` blob
 * is NEVER shown — only ok/size/dimensions, matching what the model receives.
 */
function PublishSwfResult({
  output,
}: {
  output: PublishSwfToolOutput;
}): React.JSX.Element {
  return (
    <pre style={styles.toolPre} data-testid="agent-tool-result">
      {`compiled SWF — ${formatBytes(output.byteLength)} (${output.byteLength} bytes), ${output.width}×${output.height}`}
    </pre>
  );
}

function prettyJson(value: unknown): string {
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// --- Styles -----------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    background: chrome.panelBg,
    ...chromeFont(),
  },
  settingsBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 6px",
    borderBottom: `1px solid ${chrome.separator}`,
    flex: "0 0 auto",
  },
  settingsToggle: {
    background: "transparent",
    border: "none",
    color: chrome.textDefault,
    cursor: "pointer",
    fontSize: 11,
    padding: "2px 4px",
  },
  modelHint: {
    flex: 1,
    fontSize: 10,
    color: halo.disabledText,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  settingsBody: {
    flex: "0 0 auto",
    maxHeight: "40%",
    overflowY: "auto",
    borderBottom: `1px solid ${chrome.separator}`,
  },
  threadBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 6px",
    borderBottom: `1px solid ${chrome.separator}`,
    flex: "0 0 auto",
  },
  threadSwitcher: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flex: 1,
    minWidth: 0,
    background: "transparent",
    border: "none",
    color: chrome.textDefault,
    cursor: "pointer",
    fontSize: 11,
    padding: "2px 4px",
    textAlign: "left",
  },
  threadSwitcherTitle: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  threadCaret: {
    fontSize: 9,
    color: halo.disabledText,
    flex: "0 0 auto",
  },
  threadMenu: {
    flex: "0 0 auto",
    maxHeight: "40%",
    overflowY: "auto",
    borderBottom: `1px solid ${chrome.separator}`,
    background: chrome.insetFieldStrip,
  },
  threadMenuEmpty: {
    color: halo.disabledText,
    fontSize: 10,
    padding: "6px 8px",
  },
  threadMenuItem: {
    display: "flex",
    alignItems: "center",
    borderBottom: `1px solid ${chrome.separator}`,
  },
  threadMenuItemActive: {
    background: "rgba(80,140,224,0.18)",
  },
  threadMenuSelect: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
    background: "transparent",
    border: "none",
    color: chrome.textDefault,
    cursor: "pointer",
    fontSize: 11,
    padding: "5px 6px",
    textAlign: "left",
  },
  threadMenuItemTitle: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  threadMenuItemTime: {
    fontSize: 9,
    color: halo.disabledText,
    flex: "0 0 auto",
  },
  threadMenuDelete: {
    background: "transparent",
    border: "none",
    color: halo.disabledText,
    cursor: "pointer",
    fontSize: 11,
    padding: "5px 8px",
    flex: "0 0 auto",
  },
  transcript: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    // task 1285: rendered chat message text (assistant/user bodies, reasoning,
    // tool args/results) is plain non-input markup, so it inherited the global
    // body `user-select:none` from task 1276 and could not be selected/copied.
    // Opt the transcript region (and its descendant message bubbles) back into
    // selectable text; styles.css mirrors this for the -webkit- variants. The
    // surrounding chat chrome stays non-selectable (1276 mobile fix intact).
    userSelect: "text",
    WebkitUserSelect: "text",
  },
  empty: {
    color: halo.disabledText,
    fontSize: 11,
    lineHeight: 1.5,
    padding: 8,
  },
  keyBanner: {
    flex: "0 0 auto",
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "none",
    borderBottom: `1px solid ${chrome.separator}`,
    background: "rgba(224,80,80,0.12)",
    color: "#e05050",
    fontSize: 10,
    lineHeight: 1.4,
    padding: "6px 8px",
    cursor: "pointer",
    ...chromeFont(),
  },
  userRow: {
    display: "flex",
    justifyContent: "flex-end",
  },
  userBubble: {
    maxWidth: "85%",
    background: halo.haloBlue,
    color: "#fff",
    borderRadius: 6,
    padding: "5px 8px",
    fontSize: 11,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  assistantRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxWidth: "100%",
  },
  assistantText: {
    // Markdown body wrapper (task 1290). AgentMarkdown owns the per-element
    // typography/color; this div just scopes the entry. No `pre-wrap` here —
    // markdown manages its own block whitespace (a `pre-wrap` here would add
    // stray blank lines between rendered block elements).
    fontSize: 11,
    color: chrome.textDefault,
    wordBreak: "break-word",
    lineHeight: 1.45,
  },
  reasoning: {
    fontSize: 10,
    color: halo.disabledText,
    fontStyle: "italic",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    borderLeft: `2px solid ${chrome.separator}`,
    paddingLeft: 6,
  },
  reasoningLabel: {
    display: "block",
    fontStyle: "normal",
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: halo.disabledText,
    marginBottom: 1,
  },
  stepDivider: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: halo.disabledText,
    borderTop: `1px dashed ${chrome.separator}`,
    paddingTop: 3,
    marginTop: 2,
  },
  toolChip: {
    border: `1px solid ${chrome.separator}`,
    borderRadius: 4,
    background: chrome.insetFieldStrip,
    overflow: "hidden",
  },
  toolChipHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "4px 6px",
    textAlign: "left",
  },
  toolStatusDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flex: "0 0 auto",
  },
  toolName: {
    fontFamily: "monospace",
    fontSize: 11,
    color: chrome.textDefault,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  toolStatus: {
    fontSize: 9,
    color: halo.disabledText,
  },
  toolCaret: {
    fontSize: 9,
    color: halo.disabledText,
  },
  toolBody: {
    padding: "4px 6px 6px",
    borderTop: `1px solid ${chrome.separator}`,
  },
  toolSectionLabel: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: halo.disabledText,
    marginTop: 4,
    marginBottom: 1,
  },
  toolPre: {
    margin: 0,
    fontFamily: "monospace",
    fontSize: 10,
    color: chrome.textDefault,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 160,
    overflowY: "auto",
  },
  toolScreenshot: {
    display: "block",
    marginTop: 4,
    maxWidth: "100%",
    maxHeight: 160,
    border: `1px solid ${chrome.separator}`,
    objectFit: "contain",
  },
  statusLine: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 10,
    color: halo.disabledText,
  },
  thinking: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    color: halo.disabledText,
    fontStyle: "italic",
  },
  errorLine: {
    color: "#e05050",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  maxSteps: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    fontSize: 10,
    color: "#c79a3a",
    borderTop: `1px dashed ${chrome.separator}`,
    paddingTop: 4,
    marginTop: 2,
  },
  continueButton: {
    fontSize: 11,
  },
  spinner: {
    width: 9,
    height: 9,
    border: `2px solid ${chrome.separator}`,
    borderTopColor: halo.haloBlue,
    borderRadius: "50%",
    display: "inline-block",
    animation: "agent-spin 0.7s linear infinite",
  },
  usageBar: {
    flex: "0 0 auto",
    borderTop: `1px solid ${chrome.separator}`,
    background: chrome.insetFieldStrip,
    padding: "3px 8px",
    fontSize: 10,
    color: halo.disabledText,
    textAlign: "right",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontVariantNumeric: "tabular-nums",
  },
  composer: {
    flex: "0 0 auto",
    borderTop: `1px solid ${chrome.separator}`,
    padding: 6,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  textarea: {
    ...inputStyle(false),
    width: "100%",
    resize: "none",
    fontFamily: chrome.fontFamily,
    fontSize: 11,
    boxSizing: "border-box",
  },
  composerActions: {
    display: "flex",
    justifyContent: "flex-end",
  },
  stopButton: {
    color: "#e05050",
  },
};

// Inject the keyframes for the spinner once (module-level, idempotent).
if (typeof document !== "undefined") {
  const STYLE_ID = "agent-chat-spinner-keyframes";
  if (!document.getElementById(STYLE_ID)) {
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent =
      "@keyframes agent-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(el);
  }
}
