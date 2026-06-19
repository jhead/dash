import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ModelMessage } from "ai";
import { chrome, chromeFont, halo, inputStyle, buttonStyle } from "../theme/flash8Theme.js";
import { usePreferences } from "../preferences.js";
import { AgentSettings } from "./AgentSettings.js";
import { createDashOpenRouter, getModel } from "./openrouterClient.js";
import { buildAgentTools } from "./tools.js";
import { AGENT_SYSTEM_PROMPT } from "./systemPrompt.js";
import {
  runAgentTurn,
  initialAgentRunState,
  classifyAgentError,
  type AgentRunState,
  type AgentEntry,
  type AgentToolEntry,
} from "./agentLoop.js";

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

/** Max model steps for the multi-step tool loop. */
const MAX_STEPS = 24;

/**
 * A sensible default model when the user hasn't picked one yet — a capable,
 * widely-available coding model. Used only as the effective model id when
 * `agentModel` is blank but a key IS present; the Settings selector still owns
 * the persisted choice. (Falls back gracefully if the account lacks access — the
 * error is then surfaced via {@link classifyAgentError}.)
 */
export const DEFAULT_AGENT_MODEL = "anthropic/claude-sonnet-4.5";

/** A user message in the visible transcript. */
interface UserTurn {
  role: "user";
  id: string;
  text: string;
}

/** A completed/live assistant turn in the visible transcript. */
interface AssistantTurn {
  role: "assistant";
  id: string;
  run: AgentRunState;
}

type Turn = UserTurn | AssistantTurn;

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

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => !hasKey);

  // The full model-message history (system is supplied separately), preserved
  // across turns for multi-turn context (includes assistant + tool messages).
  const historyRef = useRef<ModelMessage[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  // The id of the assistant turn currently being streamed (so onState patches
  // the right entry).
  const activeAssistantIdRef = useRef<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  // Auto-scroll to the bottom as content streams in.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const tools = useMemo(() => buildTools(), [buildTools]);

  // Send is enabled once there's text + a key (the model falls back to a
  // default). The missing-key case is handled with a friendly banner, not a
  // silently-dead button.
  const canSend = !running && input.trim().length > 0 && hasKey;

  const patchAssistantRun = useCallback(
    (assistantId: string, run: AgentRunState) => {
      setTurns((prev) =>
        prev.map((t) =>
          t.role === "assistant" && t.id === assistantId ? { ...t, run } : t
        )
      );
    },
    []
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (text.length === 0 || running) return;
    if (!hasKey) {
      // No key — open Settings and surface the actionable hint as a turn so the
      // intent isn't silently dropped.
      setSettingsOpen(true);
      const assistantId = nextTurnId();
      const friendly = classifyAgentError(null, { hasKey: false, hasModel: true });
      setTurns((prev) => [
        ...prev,
        { role: "user", id: nextTurnId(), text },
        {
          role: "assistant",
          id: assistantId,
          run: { entries: [], status: "error", error: friendly.message },
        },
      ]);
      setInput("");
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

    setTurns((prev) => [...prev, userTurn, assistantTurn]);
    setInput("");
    setRunning(true);

    // Append the user message to the persistent history.
    historyRef.current = [
      ...historyRef.current,
      { role: "user", content: text },
    ];

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const provider = createDashOpenRouter(apiKey.trim(), {});
      const languageModel = getModel(provider, effectiveModel);
      const { state, responseMessages } = await runTurn({
        model: languageModel,
        system: AGENT_SYSTEM_PROMPT,
        tools,
        messages: historyRef.current,
        maxSteps: MAX_STEPS,
        abortSignal: controller.signal,
        onState: (run) => patchAssistantRun(assistantId, run),
      });
      // If the turn ended in error, rewrite the raw provider message into a
      // friendly, actionable one (auth / network / model / rate-limit).
      if (state.status === "error") {
        const friendly = classifyAgentError(state.error, {
          hasKey: true,
          hasModel: true,
        });
        if (friendly.openSettings) setSettingsOpen(true);
        patchAssistantRun(assistantId, { ...state, error: friendly.message });
      }
      // Persist the model's assistant + tool messages for the next turn.
      // Defensive: a custom/overridden runTurn (or an abort/error path) may
      // return undefined here instead of an empty array, so guard against it
      // rather than throwing on `.length`.
      if (responseMessages && responseMessages.length > 0) {
        historyRef.current = [...historyRef.current, ...responseMessages];
      }
    } catch (err) {
      // runTurn folds errors into state; this is a final safety net for an
      // unexpected throw (e.g. createDashOpenRouter / getModel).
      const friendly = classifyAgentError(err, { hasKey: true, hasModel: true });
      if (friendly.openSettings) setSettingsOpen(true);
      patchAssistantRun(assistantId, {
        entries: [],
        status: "error",
        error: friendly.message,
      });
    } finally {
      setRunning(false);
      controllerRef.current = null;
      activeAssistantIdRef.current = null;
    }
  }, [
    input,
    running,
    hasKey,
    apiKey,
    effectiveModel,
    tools,
    runTurn,
    patchAssistantRun,
  ]);

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
    historyRef.current = [];
    setTurns([]);
  }, [running]);

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
          />
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
        {turns.map((t) =>
          t.role === "user" ? (
            <UserBubble key={t.id} text={t.text} />
          ) : (
            <AssistantBubble key={t.id} run={t.run} />
          )
        )}
      </div>

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

function AssistantBubble({ run }: { run: AgentRunState }): React.JSX.Element {
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
      return (
        <div style={styles.assistantText} data-testid="agent-text">
          {entry.text}
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
              <pre style={styles.toolPre} data-testid="agent-tool-result">
                {prettyJson(entry.output)}
              </pre>
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
  transcript: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 8,
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
    fontSize: 11,
    color: chrome.textDefault,
    whiteSpace: "pre-wrap",
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
  spinner: {
    width: 9,
    height: 9,
    border: `2px solid ${chrome.separator}`,
    borderTopColor: halo.haloBlue,
    borderRadius: "50%",
    display: "inline-block",
    animation: "agent-spin 0.7s linear infinite",
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
