/**
 * theme — public barrel for the swappable theme system.
 *
 * Re-exports the frozen `flash8Theme` token/helper surface PLUS the new swap API. Existing
 * importers keep using `./theme/flash8Theme` directly; this barrel is for new code that
 * wants the provider/hook or the value-sets.
 */

export * from "./flash8Theme.js";
export {
  activeTheme,
  activeMode,
  getThemeColor,
  setThemeMode,
  subscribeTheme,
} from "./themeState.js";
export { ThemeProvider, useTheme, useThemeRedraw } from "./ThemeProvider.js";
export type { ThemeContextValue, ThemeProviderProps } from "./ThemeProvider.js";
export {
  flash8Light,
  flash8Dark,
  themes,
} from "./themes.js";
export type {
  Theme,
  ThemeMode,
  ChromeColors,
  HaloColors,
  ContentColors,
} from "./themes.js";
export { injectThemeStylesheet, buildThemeStylesheet } from "./themeStylesheet.js";
