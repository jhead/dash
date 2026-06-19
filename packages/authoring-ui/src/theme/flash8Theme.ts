/**
 * flash8Theme — the single source of truth for the Flash Professional 8 re-theme.
 *
 * Flash 8 is a LIGHT-gray "Halo" UI on Windows-XP (Luna) chrome — NOT dark. The full
 * spec, provenance, and known gaps live in `docs/30-flash8-ui-spec.md`. This module
 * exports the spec's exact values as grouped, named design tokens plus a small set of
 * composable `React.CSSProperties` helpers.
 *
 * Three systems, never conflated:
 *   - `chrome.*`   System A — IDE chrome (light gray, Tahoma 11px). Best-estimate; see gap.
 *   - `halo.*`     System B — Halo widget skin (Verdana 10px, #009DFF accent). Confirmed.
 *   - `content.*`  System C — Flash-drawn document/timeline pixels. Confirmed.
 *
 * Panels MUST import from here — never hardcode hex. `Shell.tsx` is the reference
 * conversion; later panel waves mirror its idiom.
 *
 * ── SWAPPABLE THEME SYSTEM (task 1265) ──────────────────────────────────────────────
 * The PUBLIC EXPORT SURFACE of this module is FROZEN: the same token names
 * (`chrome.*` / `halo.*` / `content.*` / `metrics.*`), the same helper signatures
 * (`panelStyle`, `titleBarStyle`, `buttonStyle`, `inputStyle`, `bevel`, `chromeFont`,
 * `widgetFont`). ~40 components import these read-only and must keep compiling unchanged.
 *
 * Under the hood the COLOR values are now theme-aware (see `docs/31-theming.md`):
 *   - DOM tokens (`chrome.*` / `halo.*` colors) resolve to CSS `var(--f8-…, <lightHex>)`.
 *     A stylesheet defines light values on `:root` and dark values under
 *     `[data-theme="dark"]`; flipping `document.documentElement.dataset.theme` swaps the
 *     whole DOM UI with ZERO component edits. The light hex is the var fallback, so the
 *     default appearance is byte-identical to before.
 *   - Canvas tokens (`content.*` colors) are GETTERS that return the ACTIVE theme's
 *     concrete hex (a `var()` is useless inside a 2D canvas context). They return the
 *     light hex by default; after `setThemeMode("dark")` a canvas redraw reads dark hex.
 *   - Non-color metrics (sizes, pitches, fonts, dimensions) are theme-invariant literals.
 *
 * Switch API lives in `./themeState` (`setThemeMode`, `activeTheme`, `getThemeColor`,
 * `subscribeTheme`) and `./ThemeProvider` (`ThemeProvider`, `useTheme`). DEFAULT = light.
 */

import type { CSSProperties } from "react";

import { flash8Light } from "./themes.js";
import { activeTheme } from "./themeState.js";
import { cssVar, injectThemeStylesheet } from "./themeStylesheet.js";

// Inject the light/dark CSS-variable stylesheet as a side-effect of importing the theme.
// DOM-guarded + idempotent, so it is a no-op in the node test environment.
injectThemeStylesheet();

// `L` = the canonical light value-set; its hexes are the CSS-var fallbacks below, which
// keeps the default appearance identical to the pre-theme-system hardcoded tokens.
const L = flash8Light;

// ---------------------------------------------------------------------------
// System A — IDE chrome (light XP/Luna furniture). Best-estimate; see known gap.
//
// Color tokens resolve to CSS vars (light hex fallback) so they swap via `data-theme`.
// Metric tokens (sizes/fonts) are theme-invariant literals.
// ---------------------------------------------------------------------------

export const chrome = {
  /** Application background / behind panels. */
  appBg: cssVar("chrome", "appBg", L.chrome.appBg),
  /** Default panel background. */
  panelBg: cssVar("chrome", "panelBg", L.chrome.panelBg),
  /** Menu bar background. */
  menuBg: cssVar("chrome", "menuBg", L.chrome.menuBg),
  /** Slightly darker recessed strip (tool wells, gutters). */
  insetFieldStrip: cssVar("chrome", "insetFieldStrip", L.chrome.insetFieldStrip),
  /** 1px panel/region separators (splitters, region borders). */
  separator: cssVar("chrome", "separator", L.chrome.separator),
  /** Near-black default text. */
  textDefault: cssVar("chrome", "textDefault", L.chrome.textDefault),
  /** Disabled / dimmed label text. */
  textDisabled: cssVar("chrome", "textDisabled", L.chrome.textDisabled),
  /** Etched bevel thickness. */
  bevelEdge: 2,
  /** Thin border thickness. */
  borderThin: 1,
  /** Chrome font stack (Tahoma). */
  fontFamily: 'Tahoma, "MS Shell Dlg", sans-serif',
  /** Chrome font size. */
  fontSize: 11,
  /** Chrome line height. */
  lineHeight: 13,
  /** Light bevel highlight edge. */
  bevelLight: cssVar("chrome", "bevelLight", L.chrome.bevelLight),
  /** Dark bevel shadow edge. */
  bevelDark: cssVar("chrome", "bevelDark", L.chrome.bevelDark),
} as const;

// ---------------------------------------------------------------------------
// System B — Halo widgets (confirmed from flex-sdk halo/defaults.css).
//
// Color tokens resolve to CSS vars (light hex fallback). Gradient/row tuples resolve to
// tuples of CSS vars. Metric tokens are theme-invariant literals.
// ---------------------------------------------------------------------------

export const halo = {
  // Accent / state
  /** themeColor — Halo accent / focus. */
  haloBlue: cssVar("halo", "haloBlue", L.halo.haloBlue),
  /** Selected list/data row. */
  selectionColor: cssVar("halo", "selectionColor", L.halo.selectionColor),
  /** Hover row. */
  rollOverColor: cssVar("halo", "rollOverColor", L.halo.rollOverColor),
  /** Selection when control not focused. */
  inactiveSelection: cssVar("halo", "inactiveSelection", L.halo.inactiveSelection),
  /** Disabled selection. */
  selectionDisabled: cssVar("halo", "selectionDisabled", L.halo.selectionDisabled),
  /** Error highlight. */
  error: cssVar("halo", "error", L.halo.error),

  // Text / icon
  /** Halo widget text (dark teal-black). */
  text: cssVar("halo", "text", L.halo.text),
  /** Disabled widget text. */
  disabledText: cssVar("halo", "disabledText", L.halo.disabledText),
  /** Hover/selected text. */
  textRollOver: cssVar("halo", "textRollOver", L.halo.textRollOver),
  textSelected: cssVar("halo", "textSelected", L.halo.textSelected),
  /** Icon glyph colour. */
  iconColor: cssVar("halo", "iconColor", L.halo.iconColor),
  /** Disabled icon. */
  disabledIcon: cssVar("halo", "disabledIcon", L.halo.disabledIcon),
  /** Button label colour. */
  buttonColor: cssVar("halo", "buttonColor", L.halo.buttonColor),

  // Borders / structure
  /** Default control border. */
  borderColor: cssVar("halo", "borderColor", L.halo.borderColor),
  /** Border cap / corner. */
  borderCap: cssVar("halo", "borderCap", L.halo.borderCap),
  /** Drop/inset shadow tint. */
  shadow: cssVar("halo", "shadow", L.halo.shadow),
  /** Panel header divider line. */
  headerDivider: cssVar("halo", "headerDivider", L.halo.headerDivider),
  /** Halo separator. */
  separator: cssVar("halo", "separator", L.halo.separator),
  /** Strong divider. */
  divider: cssVar("halo", "divider", L.halo.divider),

  // Backgrounds / gradients
  /** App background blue (flat). */
  appBgBlue: cssVar("halo", "appBgBlue", L.halo.appBgBlue),
  /** App background blue gradient stops (top → bottom). */
  appBgBlueGrad: [
    cssVar("halo", "appBgBlueGrad-0", L.halo.appBgBlueGrad[0]),
    cssVar("halo", "appBgBlueGrad-1", L.halo.appBgBlueGrad[1]),
  ] as const,
  /** Panel content background. */
  panelContentBg: cssVar("halo", "panelContentBg", L.halo.panelContentBg),
  /** Panel header gradient stops (top → bottom). */
  panelHeaderGrad: [
    cssVar("halo", "panelHeaderGrad-0", L.halo.panelHeaderGrad[0]),
    cssVar("halo", "panelHeaderGrad-1", L.halo.panelHeaderGrad[1]),
  ] as const,
  /** Footer gradient stops (top → bottom). */
  footerGrad: [
    cssVar("halo", "footerGrad-0", L.halo.footerGrad[0]),
    cssVar("halo", "footerGrad-1", L.halo.footerGrad[1]),
  ] as const,
  /** Horizontal grid line. */
  gridLineH: cssVar("halo", "gridLineH", L.halo.gridLineH),
  /** Vertical grid line. */
  gridLineV: cssVar("halo", "gridLineV", L.halo.gridLineV),
  /** Alternating data rows (even / odd). */
  alternatingRows: [
    cssVar("halo", "alternatingRows-0", L.halo.alternatingRows[0]),
    cssVar("halo", "alternatingRows-1", L.halo.alternatingRows[1]),
  ] as const,

  // Text input
  /** Text input background. */
  inputBg: cssVar("halo", "inputBg", L.halo.inputBg),
  /** Text input border. */
  inputBorder: cssVar("halo", "inputBorder", L.halo.inputBorder),
  /** Text input inset dark edge. */
  inputBorderDark: cssVar("halo", "inputBorderDark", L.halo.inputBorderDark),
  /** Text input inset light edge. */
  inputBorderLight: cssVar("halo", "inputBorderLight", L.halo.inputBorderLight),

  // Metrics
  /** Halo corner radius. */
  cornerRadius: 4,
  /** Focus ring width. */
  focusRingWidth: 2,
  /** Checkbox / radio size. */
  controlSize: 14,
  /** Widget font stack (Verdana). */
  fontFamily: "Verdana, sans-serif",
  /** Widget font size. */
  fontSize: 10,
} as const;

// ---------------------------------------------------------------------------
// System C — Flash-drawn content (confirmed).
//
// Color tokens are GETTERS returning the ACTIVE theme's concrete hex (canvas code paints
// with real hex, never a CSS var). They return light hex by default; after
// `setThemeMode("dark")`, the next canvas redraw reads the dark hex. Metric tokens are
// theme-invariant literals. The object SHAPE (keys) is unchanged, so importers that read
// `content.playhead`, `content.framePitch`, etc. compile and behave identically.
// ---------------------------------------------------------------------------

export const content = {
  /** Motion (classic) tween span tint. */
  get motionTween(): string { return activeTheme().content.motionTween; },
  /** Shape tween span tint. */
  get shapeTween(): string { return activeTheme().content.shapeTween; },
  /** Selected frame highlight. */
  get selectedFrame(): string { return activeTheme().content.selectedFrame; },
  /** Playhead line / marker. */
  get playhead(): string { return activeTheme().content.playhead; },
  /** Timeline cell gridlines. */
  get timelineGridline(): string { return activeTheme().content.timelineGridline; },
  /** Empty frame cell. */
  get emptyFrame(): string { return activeTheme().content.emptyFrame; },
  /** Filled keyframe dot. */
  get keyframeFilled(): string { return activeTheme().content.keyframeFilled; },
  /** Hollow (empty) keyframe dot. */
  get keyframeHollow(): string { return activeTheme().content.keyframeHollow; },
  /** Work area around the stage. */
  get pasteboard(): string { return activeTheme().content.pasteboard; },
  /** Stage background. */
  get stage(): string { return activeTheme().content.stage; },
  /** ~1px stage edge shadow. */
  get stageEdgeShadow(): string { return activeTheme().content.stageEdgeShadow; },
  /** Guide lines (cyan). */
  get guide(): string { return activeTheme().content.guide; },

  // Metrics (theme-invariant)
  /** Timeline frame pitch (px). */
  framePitch: 8,
  /** Timeline layer row height (px). */
  layerRowHeight: 18,
  /** Timeline ruler header height (px). */
  rulerHeight: 23,
  /** Default document dimensions / fps / zoom. */
  defaultDoc: { width: 550, height: 400, fps: 12, zoom: 1 } as const,
} as const;

// ---------------------------------------------------------------------------
// Chrome metrics (used by helpers + panels). Theme-invariant.
// ---------------------------------------------------------------------------

export const metrics = {
  /** Panel title bar height. */
  titleBarHeight: 16,
  /** Gripper dot pitch. */
  gripperPitch: 2,
  /** Bevel thickness. */
  bevel: 2,
  /** Border thickness. */
  border: 1,
  /** Tools panel width. */
  toolsPanelWidth: 67,
  /** Tool cell size. */
  toolCell: 22,
} as const;

// ---------------------------------------------------------------------------
// Style helpers — return React.CSSProperties so panels can spread them.
// Signatures are unchanged; they compose the (now theme-aware) tokens above.
// ---------------------------------------------------------------------------

/**
 * Chrome typography: Tahoma 11px / 13px line-height, antialiased (NOT subpixel).
 * Spread onto any text-bearing chrome element.
 */
export function chromeFont(): CSSProperties {
  return {
    fontFamily: chrome.fontFamily,
    fontSize: chrome.fontSize,
    lineHeight: `${chrome.lineHeight}px`,
    color: chrome.textDefault,
    // Flash 8 chrome text is aliased/antialiased, never LCD-subpixel.
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  };
}

/** Halo widget typography: Verdana 10px. */
export function widgetFont(): CSSProperties {
  return {
    fontFamily: halo.fontFamily,
    fontSize: halo.fontSize,
    color: halo.text,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  };
}

/**
 * Default panel surface: light-gray chrome background, near-black Tahoma text,
 * 1px chrome border.
 */
export function panelStyle(): CSSProperties {
  return {
    background: chrome.panelBg,
    border: `${chrome.borderThin}px solid ${chrome.separator}`,
    ...chromeFont(),
  };
}

/**
 * 2px etched bevel. `kind: "raised"` (default) light-on-top/dark-on-bottom;
 * `kind: "sunken"` inverts (recessed wells/inputs).
 */
export function bevel(kind: "raised" | "sunken" = "raised"): CSSProperties {
  const light = chrome.bevelLight;
  const dark = chrome.bevelDark;
  const top = kind === "raised" ? light : dark;
  const bottom = kind === "raised" ? dark : light;
  return {
    borderTop: `1px solid ${top}`,
    borderLeft: `1px solid ${top}`,
    borderRight: `1px solid ${bottom}`,
    borderBottom: `1px solid ${bottom}`,
  };
}

/**
 * Panel title bar: ~16px tall, the #E7E7E7→#D9D9D9 header gradient, with two rows of
 * gripper dots (1px dots @ 2px pitch) rendered via background layers.
 */
export function titleBarStyle(): CSSProperties {
  const [g0, g1] = halo.panelHeaderGrad;
  // Two rows of 1px gripper dots at 2px pitch, drawn as a tiny repeating radial gradient.
  const dot = `radial-gradient(${halo.borderCap} 0.5px, transparent 0.5px)`;
  return {
    display: "flex",
    alignItems: "center",
    height: metrics.titleBarHeight,
    flexShrink: 0,
    padding: "0 4px",
    background: `${dot} 0 0 / ${metrics.gripperPitch}px ${metrics.gripperPitch}px, linear-gradient(${g0}, ${g1})`,
    backgroundRepeat: "repeat, no-repeat",
    borderBottom: `1px solid ${halo.headerDivider}`,
    ...chromeFont(),
    color: chrome.textDefault,
    fontWeight: "bold" as const,
  };
}

export type ButtonState = "up" | "over" | "down" | "disabled";

/**
 * Halo button: state-driven gradient fill + border, 4px corner radius, Verdana label.
 */
export function buttonStyle(state: ButtonState = "up"): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: halo.cornerRadius,
    borderStyle: "solid",
    borderWidth: 1,
    padding: "2px 8px",
    ...widgetFont(),
    color: halo.buttonColor,
    cursor: "pointer",
  };
  switch (state) {
    case "over":
      return {
        ...base,
        background: "linear-gradient(rgba(255,255,255,0.75), rgba(238,238,238,0.65))",
        borderColor: halo.haloBlue,
      };
    case "down":
      return {
        ...base,
        background: "linear-gradient(#D8F0FF, #99D7FF)",
        borderColor: halo.haloBlue,
      };
    case "disabled":
      return {
        ...base,
        background: "linear-gradient(rgba(255,255,255,0.6), rgba(204,204,204,0.4))",
        borderColor: halo.borderColor,
        color: halo.disabledText,
        cursor: "default",
      };
    case "up":
    default:
      return {
        ...base,
        background: "linear-gradient(rgba(255,255,255,0.6), rgba(204,204,204,0.4))",
        borderColor: halo.borderColor,
      };
  }
}

/**
 * Halo text input: white background, 2px sunken inset border, optional focus ring.
 */
export function inputStyle(focused = false): CSSProperties {
  return {
    background: halo.inputBg,
    color: halo.text,
    borderStyle: "solid",
    borderWidth: 1,
    borderTopColor: halo.inputBorderDark,
    borderLeftColor: halo.inputBorderDark,
    borderRightColor: halo.inputBorderLight,
    borderBottomColor: halo.inputBorderLight,
    padding: "1px 3px",
    ...widgetFont(),
    ...(focused
      ? {
          outline: `${halo.focusRingWidth}px solid ${halo.haloBlue}`,
          outlineOffset: 0,
        }
      : {}),
  };
}

/** Aggregate export for ergonomic single-import access. */
export const flash8Theme = {
  chrome,
  halo,
  content,
  metrics,
  chromeFont,
  widgetFont,
  panelStyle,
  bevel,
  titleBarStyle,
  buttonStyle,
  inputStyle,
} as const;

export default flash8Theme;

// ---------------------------------------------------------------------------
// Re-export the swap API so existing `./theme/flash8Theme` importers can reach the
// theme system through the same module if convenient. These are ADDITIVE — they do
// not alter any pre-existing export.
// ---------------------------------------------------------------------------

export {
  activeTheme,
  activeMode,
  getThemeColor,
  setThemeMode,
  subscribeTheme,
} from "./themeState.js";
export type { Theme, ThemeMode } from "./themes.js";
export { flash8Light, flash8Dark, themes } from "./themes.js";
