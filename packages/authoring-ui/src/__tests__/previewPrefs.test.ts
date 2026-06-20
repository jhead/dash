import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_PREVIEW_PREFS,
  normalizePreviewPrefs,
  loadPreviewPrefs,
  savePreviewPrefs,
  ruffleQuality,
  PREVIEW_PREFS_SCHEMA_VERSION,
} from "../preview/previewPrefs.js";

/** Minimal in-memory localStorage for the node test env. */
function installLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: ls,
    writable: true,
    configurable: true,
  });
  return store;
}

describe("previewPrefs — normalize", () => {
  it("fills defaults from empty input", () => {
    expect(normalizePreviewPrefs({})).toEqual(DEFAULT_PREVIEW_PREFS);
  });

  it("clamps numeric fields into range", () => {
    const p = normalizePreviewPrefs({ startScene: -5, startFrame: 0, zoom: 99 });
    expect(p.startScene).toBe(0);
    expect(p.startFrame).toBe(1);
    expect(p.zoom).toBe(8);
  });

  it("coerces an unknown enum back to default", () => {
    const p = normalizePreviewPrefs({ quality: "ultra", background: "rainbow" });
    expect(p.quality).toBe(DEFAULT_PREVIEW_PREFS.quality);
    expect(p.background).toBe(DEFAULT_PREVIEW_PREFS.background);
  });
});

describe("previewPrefs — persistence", () => {
  beforeEach(() => installLocalStorage());

  it("round-trips through save/load", () => {
    savePreviewPrefs({ ...DEFAULT_PREVIEW_PREFS, autoReload: false, startFrame: 7, quality: "best" });
    const loaded = loadPreviewPrefs();
    expect(loaded.autoReload).toBe(false);
    expect(loaded.startFrame).toBe(7);
    expect(loaded.quality).toBe("best");
  });

  it("drops a payload with a mismatched schema version", () => {
    localStorage.setItem(
      "flash8.previewPrefs",
      JSON.stringify({ version: PREVIEW_PREFS_SCHEMA_VERSION + 99, prefs: { autoReload: false } })
    );
    expect(loadPreviewPrefs()).toEqual(DEFAULT_PREVIEW_PREFS);
  });

  it("returns defaults on corrupt JSON", () => {
    localStorage.setItem("flash8.previewPrefs", "{not json");
    expect(loadPreviewPrefs()).toEqual(DEFAULT_PREVIEW_PREFS);
  });
});

describe("previewPrefs — ruffleQuality", () => {
  it("maps every quality to a ruffle string", () => {
    expect(ruffleQuality("low")).toBe("low");
    expect(ruffleQuality("best")).toBe("best");
  });
});
