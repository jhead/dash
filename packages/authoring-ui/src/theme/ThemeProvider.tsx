/**
 * ThemeProvider / useTheme — optional React glue over the theme swap engine.
 *
 * The theme system works WITHOUT this provider (the tokens + `setThemeMode` are global),
 * but `ThemeProvider` gives a React-idiomatic way to read the active mode and flip it, and
 * guarantees the CSS-variable stylesheet is injected on mount.
 *
 * DEFAULT mode is "light" (Flash 8). There is intentionally NO UI toggle here — only the
 * capability. A Preferences toggle can call `setMode` (or the global `setThemeMode`) later;
 * see `docs/31-theming.md`.
 *
 * Canvas components that paint with `content.*` hex should additionally use
 * `useThemeRedraw(redraw)` so a mode change repaints them (DOM tokens swap automatically
 * via CSS vars and need no React involvement).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { ThemeMode } from "./themes.js";
import { activeMode, setThemeMode, subscribeTheme } from "./themeState.js";
import { injectThemeStylesheet } from "./themeStylesheet.js";

export interface ThemeContextValue {
  /** Current theme mode. */
  mode: ThemeMode;
  /** Switch the theme mode (DOM + canvas). */
  setMode: (mode: ThemeMode) => void;
  /** Convenience: flip light↔dark. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  /** Initial mode. Defaults to "light" (Flash 8). */
  initialMode?: ThemeMode;
  children: React.ReactNode;
}

export function ThemeProvider({ initialMode = "light", children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  // Ensure the CSS-var stylesheet exists, and apply the initial mode once on mount.
  useEffect(() => {
    injectThemeStylesheet();
    if (initialMode !== activeMode()) setThemeMode(initialMode);
    // Keep local state in sync with any out-of-band global change.
    const unsub = subscribeTheme(() => setModeState(activeMode()));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setThemeMode(next);
    setModeState(next);
  }, []);

  const toggle = useCallback(() => {
    setMode(activeMode() === "dark" ? "light" : "dark");
  }, [setMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, setMode, toggle }),
    [mode, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Read the active theme mode + setters. Falls back to the global engine when used outside
 * a `ThemeProvider`, so it never throws.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  // Provider-less fallback: drive the global engine directly.
  return {
    mode: activeMode(),
    setMode: setThemeMode,
    toggle: () => setThemeMode(activeMode() === "dark" ? "light" : "dark"),
  };
}

/**
 * Register a canvas redraw to run whenever the theme mode changes. Use this in Stage /
 * Timeline canvas components so `content.*` hex repaints on a swap. DOM (chrome/halo)
 * surfaces need NO such hook — CSS variables flip them automatically.
 */
export function useThemeRedraw(redraw: () => void): void {
  useEffect(() => subscribeTheme(redraw), [redraw]);
}
