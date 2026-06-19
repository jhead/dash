/**
 * themeState — the runtime swap engine for the theme system.
 *
 * Holds the single mutable "active theme mode" and exposes:
 *   - `activeTheme()`     → the current `Theme` value-set (default `flash8Light`).
 *   - `activeMode()`      → "light" | "dark".
 *   - `getThemeColor(g,k)`→ resolve ONE concrete hex from the active theme (canvas use).
 *   - `setThemeMode(mode)`→ flip DOM (`data-theme`), active JS theme, and notify canvas.
 *   - `subscribeTheme(cb)`→ register a canvas redraw callback; returns an unsubscribe fn.
 *
 * DOM tokens (chrome/halo) swap automatically via CSS variables (see themeStylesheet.ts),
 * so they need NO notification. `subscribeTheme` exists for the CANVAS consumers (Stage,
 * Timeline) which paint with concrete hex and must repaint on a theme change.
 *
 * DEFAULT is "light" (Flash 8). Nothing flips unless `setThemeMode("dark")` is called.
 */

import { themes, flash8Light } from "./themes.js";
import type { Theme, ThemeMode, ChromeColors, HaloColors, ContentColors } from "./themes.js";

let currentMode: ThemeMode = "light";

type ThemeListener = (theme: Theme) => void;
const listeners = new Set<ThemeListener>();

/** The active theme value-set. Defaults to the light Flash 8 palette. */
export function activeTheme(): Theme {
  return themes[currentMode] ?? flash8Light;
}

/** The active theme mode. */
export function activeMode(): ThemeMode {
  return currentMode;
}

/**
 * Resolve a single concrete color from the ACTIVE theme — for canvas code that
 * cannot use a CSS `var()` (it paints into a 2D context with real hex).
 *
 * @example getThemeColor("content", "playhead") // "#CC0000" in light
 */
export function getThemeColor(group: "chrome", key: keyof ChromeColors): string;
export function getThemeColor(group: "halo", key: keyof HaloColors): string;
export function getThemeColor(group: "content", key: keyof ContentColors): string;
export function getThemeColor(
  group: "chrome" | "halo" | "content",
  key: string,
): unknown {
  const t = activeTheme();
  return (t[group] as unknown as Record<string, unknown>)[key];
}

/**
 * Subscribe to theme changes. The callback fires with the new active theme after
 * every `setThemeMode` that actually changes the mode. Returns an unsubscribe fn.
 * Canvas components call this in an effect and trigger a redraw in the callback.
 */
export function subscribeTheme(cb: ThemeListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notify(): void {
  const t = activeTheme();
  for (const cb of listeners) {
    try {
      cb(t);
    } catch {
      // A misbehaving listener must not break the swap for the others.
    }
  }
}

/**
 * Switch the theme mode. Performs the full swap:
 *   1. updates the active JS theme (so `activeTheme()` / `getThemeColor` / canvas see it),
 *   2. sets `document.documentElement.dataset.theme` (so CSS-var DOM tokens flip), and
 *   3. notifies canvas subscribers to repaint.
 *
 * Idempotent: switching to the already-active mode is a no-op (no notify).
 * DEFAULT remains "light"; callers opt in to "dark".
 */
export function setThemeMode(mode: ThemeMode): void {
  if (mode === currentMode) return;
  currentMode = mode;

  if (typeof document !== "undefined" && document.documentElement) {
    if (mode === "light") {
      // Light is the :root default — remove the attribute so nothing is overridden.
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = mode;
    }
  }

  notify();
}
