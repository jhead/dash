// ---------------------------------------------------------------------------
// Live Preview preferences (task 1308).
//
// Durable preview-tab settings, persisted alongside the editor layout using the
// SAME versioned-localStorage + normalize() hygiene as editorLayout.ts. Kept in
// its own key so the preview feature can evolve its prefs shape without churning
// the editorLayout schema version (and so a corrupt preview payload can never
// drop the user's pane sizes / tabs).
// ---------------------------------------------------------------------------

export type PreviewQuality = "low" | "medium" | "high" | "best";

export interface PreviewPrefs {
  /** Re-compile + hot-reload the preview automatically on document changes. */
  autoReload: boolean;
  /** 0-based scene to begin preview playback at. */
  startScene: number;
  /** 1-based frame within the start scene to begin at. */
  startFrame: number;
  /** Ruffle render quality. */
  quality: PreviewQuality;
  /** Preview zoom factor (1 = 100%). Ignored when scaleToFit is true. */
  zoom: number;
  /** Scale the SWF to fit the available preview area. */
  scaleToFit: boolean;
  /** Mute audio in the preview. */
  muted: boolean;
  /** Loop playback when the movie reaches its last frame. */
  loop: boolean;
  /** Preview backdrop behind the stage ("default" uses the document bg). */
  background: "default" | "white" | "black" | "checker";
}

const STORAGE_KEY = "flash8.previewPrefs";
export const PREVIEW_PREFS_SCHEMA_VERSION = 1;

export const DEFAULT_PREVIEW_PREFS: PreviewPrefs = {
  autoReload: true,
  startScene: 0,
  startFrame: 1,
  quality: "high",
  zoom: 1,
  scaleToFit: true,
  muted: false,
  loop: true,
  background: "default",
};

const QUALITIES: readonly PreviewQuality[] = ["low", "medium", "high", "best"];
const BACKGROUNDS: readonly PreviewPrefs["background"][] = [
  "default",
  "white",
  "black",
  "checker",
];

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function intOr(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}
function numOr(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}
function enumOr<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

export function normalizePreviewPrefs(raw: unknown): PreviewPrefs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREVIEW_PREFS;
  return {
    autoReload: boolOr(o.autoReload, d.autoReload),
    startScene: intOr(o.startScene, d.startScene, 0, 999),
    startFrame: intOr(o.startFrame, d.startFrame, 1, 100000),
    quality: enumOr(o.quality, QUALITIES, d.quality),
    zoom: numOr(o.zoom, d.zoom, 0.1, 8),
    scaleToFit: boolOr(o.scaleToFit, d.scaleToFit),
    muted: boolOr(o.muted, d.muted),
    loop: boolOr(o.loop, d.loop),
    background: enumOr(o.background, BACKGROUNDS, d.background),
  };
}

export function loadPreviewPrefs(): PreviewPrefs {
  if (typeof localStorage === "undefined") return { ...DEFAULT_PREVIEW_PREFS };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_PREVIEW_PREFS };
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PREVIEW_PREFS };
    const p = parsed as Record<string, unknown>;
    if (p.version !== PREVIEW_PREFS_SCHEMA_VERSION) return { ...DEFAULT_PREVIEW_PREFS };
    return normalizePreviewPrefs(p.prefs);
  } catch {
    return { ...DEFAULT_PREVIEW_PREFS };
  }
}

export function savePreviewPrefs(prefs: PreviewPrefs): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: PREVIEW_PREFS_SCHEMA_VERSION,
        prefs: normalizePreviewPrefs(prefs),
      })
    );
  } catch {
    // best-effort; ignore quota/privacy failures
  }
}

/** Map our PreviewQuality enum to Ruffle's quality string. */
export function ruffleQuality(q: PreviewQuality): string {
  switch (q) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "best":
      return "best";
  }
}
