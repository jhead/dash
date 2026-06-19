import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Application preferences (persisted to localStorage)
//
// This is intentionally generic so additional preferences can be added over
// time. Today it carries a single UI-scale factor that (for now) scales the
// Timeline panel's metrics; later it can drive other panels too.
// ---------------------------------------------------------------------------

export interface Preferences {
  /**
   * Timeline UI scale factor. 1.0 = the raw Flash-8-measured size (16px frame
   * cells, 38px rows); 0.5 renders the timeline at half that. Clamped to
   * [UI_SCALE_MIN, UI_SCALE_MAX].
   */
  uiScale: number;

  /**
   * OpenRouter API key for the (fully client-side) Agent Chat pane. Stored ONLY
   * in this browser's localStorage — there is no Dash server; the key travels
   * directly from the browser to openrouter.ai. Absent until the user sets one.
   */
  openrouterApiKey?: string;

  /**
   * OpenRouter model id selected for the Agent Chat (e.g.
   * "anthropic/claude-sonnet-4.5"). Absent until the user picks one; the agent
   * loop (later phase) chooses a default when unset.
   */
  agentModel?: string;
}

export const UI_SCALE_MIN = 0.25;
export const UI_SCALE_MAX = 2;

export const DEFAULT_PREFERENCES: Preferences = {
  uiScale: 0.5,
};

const STORAGE_KEY = "flash8.preferences";

function clampUiScale(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PREFERENCES.uiScale;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, n));
}

/**
 * Coerce a stored value into an optional non-empty trimmed string. Blank/
 * whitespace-only values normalize to `undefined` so an empty key/model never
 * persists (and `updatePreferences({ openrouterApiKey: "" })` clears it).
 */
function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Normalize an arbitrary parsed object into a complete Preferences value. */
function normalize(raw: unknown): Preferences {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Partial<Preferences>;
  const prefs: Preferences = {
    uiScale: clampUiScale(
      typeof obj.uiScale === "number" ? obj.uiScale : DEFAULT_PREFERENCES.uiScale
    ),
  };
  const openrouterApiKey = normalizeOptionalString(obj.openrouterApiKey);
  if (openrouterApiKey !== undefined) prefs.openrouterApiKey = openrouterApiKey;
  const agentModel = normalizeOptionalString(obj.agentModel);
  if (agentModel !== undefined) prefs.agentModel = agentModel;
  return prefs;
}

/** Read preferences from localStorage, falling back to defaults. */
export function loadPreferences(): Preferences {
  if (typeof localStorage === "undefined") return { ...DEFAULT_PREFERENCES };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_PREFERENCES };
    return normalize(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Persist preferences to localStorage (no-op when storage is unavailable).
 * Normalizes first so blank/whitespace key/model values are dropped rather than
 * written (an empty OpenRouter key must never be persisted).
 */
export function savePreferences(prefs: Preferences): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(prefs)));
  } catch {
    // Ignore quota / privacy-mode write failures.
  }
}

export interface UsePreferences {
  preferences: Preferences;
  /** Merge a partial update, normalize, persist, and re-render. */
  updatePreferences: (patch: Partial<Preferences>) => void;
  /** Restore all preferences to their defaults. */
  resetPreferences: () => void;
}

/**
 * React hook owning the preferences value, hydrated from localStorage on first
 * render and written back on every change.
 */
export function usePreferences(): UsePreferences {
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);

  const updatePreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferences((prev) => {
      const next = normalize({ ...prev, ...patch });
      savePreferences(next);
      return next;
    });
  }, []);

  const resetPreferences = useCallback(() => {
    const next = { ...DEFAULT_PREFERENCES };
    savePreferences(next);
    setPreferences(next);
  }, []);

  return { preferences, updatePreferences, resetPreferences };
}
