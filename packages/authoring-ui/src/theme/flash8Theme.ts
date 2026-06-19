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
 */

import type { CSSProperties } from "react";

// ---------------------------------------------------------------------------
// System A — IDE chrome (light XP/Luna furniture). Best-estimate; see known gap.
// ---------------------------------------------------------------------------

export const chrome = {
  /** Application background / behind panels. */
  appBg: "#ECECEC",
  /** Default panel background. */
  panelBg: "#ECECEC",
  /** Menu bar background. */
  menuBg: "#ECECEC",
  /** Slightly darker recessed strip (tool wells, gutters). */
  insetFieldStrip: "#D4D4D4",
  /** 1px panel/region separators (splitters, region borders). */
  separator: "#999999",
  /** Near-black default text. */
  textDefault: "#000000",
  /** Disabled / dimmed label text. */
  textDisabled: "#808080",
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
  bevelLight: "#FFFFFF",
  /** Dark bevel shadow edge. */
  bevelDark: "#808080",
} as const;

// ---------------------------------------------------------------------------
// System B — Halo widgets (confirmed from flex-sdk halo/defaults.css).
// ---------------------------------------------------------------------------

export const halo = {
  // Accent / state
  /** themeColor — Halo accent / focus. */
  haloBlue: "#009DFF",
  /** Selected list/data row. */
  selectionColor: "#7FCEFF",
  /** Hover row. */
  rollOverColor: "#B2E1FF",
  /** Selection when control not focused. */
  inactiveSelection: "#E8E8E8",
  /** Disabled selection. */
  selectionDisabled: "#DDDDDD",
  /** Error highlight. */
  error: "#FF0000",

  // Text / icon
  /** Halo widget text (dark teal-black). */
  text: "#0B333C",
  /** Disabled widget text. */
  disabledText: "#AAB3B3",
  /** Hover/selected text. */
  textRollOver: "#2B333C",
  textSelected: "#2B333C",
  /** Icon glyph colour. */
  iconColor: "#2B333C",
  /** Disabled icon. */
  disabledIcon: "#999999",
  /** Button label colour. */
  buttonColor: "#6F7777",

  // Borders / structure
  /** Default control border. */
  borderColor: "#B7BABC",
  /** Border cap / corner. */
  borderCap: "#919999",
  /** Drop/inset shadow tint. */
  shadow: "#EEEEEE",
  /** Panel header divider line. */
  headerDivider: "#AEAEAE",
  /** Halo separator. */
  separator: "#C4CCCC",
  /** Strong divider. */
  divider: "#6F7777",

  // Backgrounds / gradients
  /** App background blue (flat). */
  appBgBlue: "#869CA7",
  /** App background blue gradient stops (top → bottom). */
  appBgBlueGrad: ["#9CB0BA", "#68808C"] as const,
  /** Panel content background. */
  panelContentBg: "#FFFFFF",
  /** Panel header gradient stops (top → bottom). */
  panelHeaderGrad: ["#E7E7E7", "#D9D9D9"] as const,
  /** Footer gradient stops (top → bottom). */
  footerGrad: ["#E7E7E7", "#C7C7C7"] as const,
  /** Horizontal grid line. */
  gridLineH: "#F7F7F7",
  /** Vertical grid line. */
  gridLineV: "#D5DDDD",
  /** Alternating data rows (even / odd). */
  alternatingRows: ["#F7F7F7", "#FFFFFF"] as const,

  // Text input
  /** Text input background. */
  inputBg: "#FFFFFF",
  /** Text input border. */
  inputBorder: "#B7BABC",
  /** Text input inset dark edge. */
  inputBorderDark: "#6D6F70",
  /** Text input inset light edge. */
  inputBorderLight: "#D3D5D6",

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
// ---------------------------------------------------------------------------

export const content = {
  /** Motion (classic) tween span tint. */
  motionTween: "#CCCCFF",
  /** Shape tween span tint. */
  shapeTween: "#CCFFCC",
  /** Selected frame highlight. */
  selectedFrame: "#335EA8",
  /** Playhead line / marker. */
  playhead: "#CC0000",
  /** Timeline cell gridlines. */
  timelineGridline: "#EBE9ED",
  /** Empty frame cell. */
  emptyFrame: "#FFFFFF",
  /** Filled keyframe dot. */
  keyframeFilled: "#000000",
  /** Hollow (empty) keyframe dot. */
  keyframeHollow: "#FFFFFF",
  /** Work area around the stage. */
  pasteboard: "#D0D0D0",
  /** Stage background. */
  stage: "#FFFFFF",
  /** ~1px stage edge shadow. */
  stageEdgeShadow: "#CDCDCD",
  /** Guide lines (cyan). */
  guide: "#00FFFF",

  // Metrics
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
// Chrome metrics (used by helpers + panels).
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
