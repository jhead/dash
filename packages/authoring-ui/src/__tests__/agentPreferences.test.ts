/**
 * Unit tests for the Agent Chat preferences (task 1276 P1):
 * openrouterApiKey + agentModel localStorage round-trip via preferences.ts.
 *
 * Verifies:
 *   1. round-trip: saved key + model survive load.
 *   2. defaults: a fresh store yields no key/model (undefined).
 *   3. blank values normalize to undefined (never persist an empty key).
 *   4. whitespace is trimmed on the way in.
 *   5. corrupt JSON falls back to defaults without throwing.
 *   6. existing uiScale is preserved alongside the new fields.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadPreferences,
  savePreferences,
  DEFAULT_PREFERENCES,
  type Preferences,
} from "../preferences.js";

function makeLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

const STORAGE_KEY = "flash8.preferences";

let mockStorage: Storage;

beforeEach(() => {
  mockStorage = makeLocalStorageMock();
  vi.stubGlobal("localStorage", mockStorage);
});

describe("agent chat preferences round-trip", () => {
  it("round-trips openrouterApiKey + agentModel through save/load", () => {
    const prefs: Preferences = {
      uiScale: 0.5,
      openrouterApiKey: "sk-or-test-12345",
      agentModel: "anthropic/claude-sonnet-4.5",
    };
    savePreferences(prefs);
    const loaded = loadPreferences();
    expect(loaded.openrouterApiKey).toBe("sk-or-test-12345");
    expect(loaded.agentModel).toBe("anthropic/claude-sonnet-4.5");
  });

  it("defaults to no key/model on a fresh store", () => {
    const loaded = loadPreferences();
    expect(loaded.openrouterApiKey).toBeUndefined();
    expect(loaded.agentModel).toBeUndefined();
    expect(loaded.uiScale).toBe(DEFAULT_PREFERENCES.uiScale);
  });

  it("normalizes blank key/model to undefined (never persists empty)", () => {
    savePreferences({ uiScale: 0.5, openrouterApiKey: "", agentModel: "   " });
    const loaded = loadPreferences();
    expect(loaded.openrouterApiKey).toBeUndefined();
    expect(loaded.agentModel).toBeUndefined();
    // The serialized blob must not carry the empty fields.
    const raw = mockStorage.getItem(STORAGE_KEY);
    expect(raw).not.toContain("openrouterApiKey");
    expect(raw).not.toContain("agentModel");
  });

  it("trims surrounding whitespace from key + model", () => {
    savePreferences({
      uiScale: 0.5,
      openrouterApiKey: "  sk-or-pad  ",
      agentModel: "\topenai/gpt-4o\n",
    });
    const loaded = loadPreferences();
    expect(loaded.openrouterApiKey).toBe("sk-or-pad");
    expect(loaded.agentModel).toBe("openai/gpt-4o");
  });

  it("falls back to defaults on corrupt JSON without throwing", () => {
    mockStorage.setItem(STORAGE_KEY, "{not valid json");
    const loaded = loadPreferences();
    expect(loaded).toEqual(DEFAULT_PREFERENCES);
  });

  it("preserves uiScale alongside the agent fields", () => {
    savePreferences({ uiScale: 1.0, openrouterApiKey: "sk-or-x" });
    const loaded = loadPreferences();
    expect(loaded.uiScale).toBe(1.0);
    expect(loaded.openrouterApiKey).toBe("sk-or-x");
    expect(loaded.agentModel).toBeUndefined();
  });
});
