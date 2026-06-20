import React, { useCallback, useEffect, useRef, useState } from "react";
import { chrome, halo, chromeFont, inputStyle, buttonStyle } from "../theme/flash8Theme.js";
import {
  fetchOpenRouterModels,
  type OpenRouterModel,
} from "./openrouterClient.js";
import { clampMaxSteps } from "./agentLoop.js";

// ---------------------------------------------------------------------------
// AgentSettings — reusable settings panel for the client-side Agent Chat.
//
// Two controls:
//   1. OpenRouter API-key input (with a clear/remove button and a "stored
//      locally in this browser" notice — there is no Dash server).
//   2. Model selector populated live from fetchOpenRouterModels; if the catalog
//      can't load (no/invalid key, offline) it falls back to a manual id input.
//
// It is a CONTROLLED component: the parent owns `apiKey` / `model` (wired to
// preferences in P3) and passes change handlers. Standalone for now.
// ---------------------------------------------------------------------------

export interface AgentSettingsProps {
  /** Current OpenRouter API key ("" when unset). */
  apiKey: string;
  /** Persist a new API key (or "" to clear). */
  onApiKeyChange: (apiKey: string) => void;
  /** Currently selected model id ("" when unset). */
  model: string;
  /** Persist a newly selected/typed model id. */
  onModelChange: (modelId: string) => void;
  /**
   * The effective max-steps backstop currently in use (the configured value or
   * the default). Shown in the control; an empty input means "use the default".
   */
  maxSteps: number;
  /** True when `maxSteps` is the default (no explicit user value persisted). */
  maxStepsIsDefault: boolean;
  /** Persist a new max-steps value (or `undefined` to reset to the default). */
  onMaxStepsChange: (maxSteps: number | undefined) => void;
  /**
   * Injectable fetcher (defaults to {@link fetchOpenRouterModels}); overridable
   * for tests / custom transports.
   */
  fetchModels?: typeof fetchOpenRouterModels;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; models: OpenRouterModel[] }
  | { status: "error"; message: string };

const labelStyle: React.CSSProperties = {
  ...chromeFont(),
  color: chrome.textDefault,
  display: "block",
  marginBottom: 2,
};

const noticeStyle: React.CSSProperties = {
  ...chromeFont(),
  color: halo.disabledText,
  fontSize: 10,
  marginTop: 2,
};

const rowStyle: React.CSSProperties = {
  marginBottom: 10,
};

export function AgentSettings({
  apiKey,
  onApiKeyChange,
  model,
  onModelChange,
  maxSteps,
  maxStepsIsDefault,
  onMaxStepsChange,
  fetchModels = fetchOpenRouterModels,
}: AgentSettingsProps): React.JSX.Element {
  const [keyDraft, setKeyDraft] = useState(apiKey);
  const [keyFocused, setKeyFocused] = useState(false);
  const [modelFocused, setModelFocused] = useState(false);
  const [stepsFocused, setStepsFocused] = useState(false);
  // The steps input is a free-text draft so the user can clear it (= default)
  // or type a number; it commits on blur/Enter. Blank when at the default.
  const [stepsDraft, setStepsDraft] = useState(
    maxStepsIsDefault ? "" : String(maxSteps)
  );
  const [load, setLoad] = useState<LoadState>({ status: "idle" });

  // Keep the local draft in sync when the persisted key changes externally.
  useEffect(() => {
    setKeyDraft(apiKey);
  }, [apiKey]);

  // Keep the steps draft in sync when the persisted value changes externally
  // (e.g. reset). Blank when on the default so the placeholder shows.
  useEffect(() => {
    setStepsDraft(maxStepsIsDefault ? "" : String(maxSteps));
  }, [maxSteps, maxStepsIsDefault]);

  // (Re)load the model catalog whenever the persisted key changes & is present.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    abortRef.current?.abort();
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
      setLoad({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoad({ status: "loading" });
    fetchModels(trimmed, { signal: controller.signal })
      .then((models) => {
        if (!controller.signal.aborted) setLoad({ status: "loaded", models });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => controller.abort();
  }, [apiKey, fetchModels]);

  const commitKey = useCallback(() => {
    const next = keyDraft.trim();
    if (next !== apiKey) onApiKeyChange(next);
  }, [keyDraft, apiKey, onApiKeyChange]);

  const clearKey = useCallback(() => {
    setKeyDraft("");
    onApiKeyChange("");
  }, [onApiKeyChange]);

  // Commit the steps draft: blank/0/junk resets to the default (undefined);
  // a positive integer persists it. The parent clamps to the valid range.
  const commitSteps = useCallback(() => {
    const trimmed = stepsDraft.trim();
    if (trimmed.length === 0) {
      onMaxStepsChange(undefined);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 1) {
      onMaxStepsChange(undefined);
      return;
    }
    // Persist the CLAMPED value so the stored, displayed, and effective caps
    // stay consistent: clampMaxSteps is also applied at the use site, so an
    // unclamped 5000 would persist as 5000 but run as 1000 (the display would
    // permanently disagree with the enforced cap). Clamp here too.
    onMaxStepsChange(clampMaxSteps(Math.floor(n)));
  }, [stepsDraft, onMaxStepsChange]);

  const showManualModelInput =
    load.status === "error" || load.status === "idle";

  return (
    <div data-testid="agent-settings" style={{ padding: 8 }}>
      {/* --- API key --- */}
      <div style={rowStyle}>
        <label htmlFor="agent-api-key" style={labelStyle}>
          OpenRouter API key
        </label>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            id="agent-api-key"
            data-testid="agent-api-key-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-or-..."
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onFocus={() => setKeyFocused(true)}
            onBlur={() => {
              setKeyFocused(false);
              commitKey();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitKey();
            }}
            style={{ ...inputStyle(keyFocused), flex: 1 }}
          />
          <button
            type="button"
            data-testid="agent-api-key-clear"
            disabled={apiKey.length === 0 && keyDraft.length === 0}
            onClick={clearKey}
            style={buttonStyle(
              apiKey.length === 0 && keyDraft.length === 0 ? "disabled" : "up"
            )}
          >
            Clear
          </button>
        </div>
        <div style={noticeStyle} data-testid="agent-api-key-notice">
          Stored locally in this browser only. The key is sent directly to
          openrouter.ai — never to a Dash server.
        </div>
      </div>

      {/* --- Model selector --- */}
      <div style={rowStyle}>
        <label htmlFor="agent-model" style={labelStyle}>
          Model
        </label>
        {load.status === "loading" && (
          <div style={noticeStyle} data-testid="agent-model-loading">
            Loading models…
          </div>
        )}
        {load.status === "loaded" && (
          <select
            id="agent-model"
            data-testid="agent-model-select"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            onFocus={() => setModelFocused(true)}
            onBlur={() => setModelFocused(false)}
            style={{ ...inputStyle(modelFocused), width: "100%" }}
          >
            <option value="">— select a model —</option>
            {load.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.context_length
                  ? ` (${m.context_length.toLocaleString()} ctx)`
                  : ""}
              </option>
            ))}
          </select>
        )}
        {showManualModelInput && (
          <>
            <input
              id="agent-model"
              data-testid="agent-model-input"
              type="text"
              spellCheck={false}
              placeholder="e.g. anthropic/claude-sonnet-4.5"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              onFocus={() => setModelFocused(true)}
              onBlur={() => setModelFocused(false)}
              style={{ ...inputStyle(modelFocused), width: "100%" }}
            />
            {load.status === "error" && (
              <div style={noticeStyle} data-testid="agent-model-error">
                Couldn’t load the model list ({load.message}). Enter a model id
                manually.
              </div>
            )}
            {load.status === "idle" && (
              <div style={noticeStyle}>
                Add an API key to load the model list, or type a model id.
              </div>
            )}
          </>
        )}
      </div>

      {/* --- Max steps (safety backstop) --- */}
      <div style={rowStyle}>
        <label htmlFor="agent-max-steps" style={labelStyle}>
          Max steps
        </label>
        <input
          id="agent-max-steps"
          data-testid="agent-max-steps-input"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          placeholder={`${maxSteps} (default)`}
          value={stepsDraft}
          onChange={(e) => setStepsDraft(e.target.value)}
          onFocus={() => setStepsFocused(true)}
          onBlur={() => {
            setStepsFocused(false);
            commitSteps();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitSteps();
          }}
          style={{ ...inputStyle(stepsFocused), width: "100%" }}
        />
        <div style={noticeStyle} data-testid="agent-max-steps-notice">
          The most tool steps the agent runs before pausing as a safety backstop.
          The agent stops on its own when a task is done; this only bounds a
          runaway loop. Leave blank for the default. Effective: {maxSteps}.
        </div>
      </div>
    </div>
  );
}
