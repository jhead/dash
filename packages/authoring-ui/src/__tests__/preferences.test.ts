import { afterAll, beforeEach, describe, expect, it } from "vitest";

const STORAGE_KEY = "flash8.preferences";

// The authoring-ui vitest environment is "node" (no DOM), so install a minimal
// in-memory localStorage before importing the module under test.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
const hadLocalStorage = "localStorage" in globalThis;
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const {
  DEFAULT_PREFERENCES,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  loadPreferences,
  savePreferences,
} = await import("../preferences");

afterAll(() => {
  if (!hadLocalStorage) {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  }
});

describe("preferences persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults (uiScale 0.5) when nothing is stored", () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES.uiScale).toBe(0.5);
  });

  it("round-trips a saved value through localStorage", () => {
    savePreferences({ uiScale: 0.75 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ uiScale: 0.75 });
    expect(loadPreferences().uiScale).toBe(0.75);
  });

  it("clamps an out-of-range stored uiScale on load", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiScale: 99 }));
    expect(loadPreferences().uiScale).toBe(UI_SCALE_MAX);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiScale: 0.01 }));
    expect(loadPreferences().uiScale).toBe(UI_SCALE_MIN);
  });

  it("falls back to defaults on malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("fills missing fields and ignores non-numeric uiScale", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiScale: "big" }));
    expect(loadPreferences().uiScale).toBe(DEFAULT_PREFERENCES.uiScale);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    expect(loadPreferences().uiScale).toBe(DEFAULT_PREFERENCES.uiScale);
  });
});
