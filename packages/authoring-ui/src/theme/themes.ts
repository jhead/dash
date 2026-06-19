/**
 * themes — typed Theme value-sets for the swappable theme system.
 *
 * A `Theme` is a complete, typed snapshot of every COLOR token the UI consumes,
 * split into the same three systems as `flash8Theme`:
 *   - `chrome.*`   System A — IDE chrome surfaces/text/bevels (DOM-backed via CSS vars).
 *   - `halo.*`     System B — Halo widget skin colors (DOM-backed via CSS vars).
 *   - `content.*`  System C — Flash-drawn document/timeline pixels (concrete hex; canvas).
 *
 * Two complete value-sets ship:
 *   - `flash8Light` — the CURRENT Flash Professional 8 light "Halo" palette (default).
 *   - `flash8Dark`  — the reconstructed pre-re-theme dark palette (see docs/31-theming.md
 *                     for provenance; values mined from git pre-`51c5e3b`).
 *
 * NON-color metrics (font sizes, pitches, radii, dimensions) are theme-INVARIANT and do
 * NOT live here — they stay as plain constants in `flash8Theme.ts`. Only colors swap.
 *
 * IMPORTANT: the KEY SHAPE of `chrome` / `halo` / `content` here is the single source of
 * truth for the CSS-variable names and the canvas resolver; it must mirror the COLOR keys
 * exported by `flash8Theme.ts` exactly.
 */

export type ThemeMode = "light" | "dark";

/** System A — IDE chrome color tokens. */
export interface ChromeColors {
  appBg: string;
  panelBg: string;
  menuBg: string;
  insetFieldStrip: string;
  separator: string;
  textDefault: string;
  textDisabled: string;
  bevelLight: string;
  bevelDark: string;
}

/** System B — Halo widget color tokens. */
export interface HaloColors {
  haloBlue: string;
  selectionColor: string;
  rollOverColor: string;
  inactiveSelection: string;
  selectionDisabled: string;
  error: string;
  text: string;
  disabledText: string;
  textRollOver: string;
  textSelected: string;
  iconColor: string;
  disabledIcon: string;
  buttonColor: string;
  borderColor: string;
  borderCap: string;
  shadow: string;
  headerDivider: string;
  separator: string;
  divider: string;
  appBgBlue: string;
  appBgBlueGrad: readonly [string, string];
  panelContentBg: string;
  panelHeaderGrad: readonly [string, string];
  footerGrad: readonly [string, string];
  gridLineH: string;
  gridLineV: string;
  alternatingRows: readonly [string, string];
  inputBg: string;
  inputBorder: string;
  inputBorderDark: string;
  inputBorderLight: string;
}

/** System C — Flash-drawn content (canvas) color tokens. */
export interface ContentColors {
  motionTween: string;
  shapeTween: string;
  selectedFrame: string;
  playhead: string;
  timelineGridline: string;
  emptyFrame: string;
  keyframeFilled: string;
  keyframeHollow: string;
  pasteboard: string;
  stage: string;
  stageEdgeShadow: string;
  guide: string;
}

/** A complete, typed theme value-set. */
export interface Theme {
  mode: ThemeMode;
  chrome: ChromeColors;
  halo: HaloColors;
  content: ContentColors;
}

// ---------------------------------------------------------------------------
// flash8Light — the CURRENT Flash 8 light "Halo" palette (DEFAULT).
// These values are the canonical light values; the CSS `:root` block and the
// exported token fallbacks are generated from them, so light is byte-identical
// to the pre-theme-system tokens.
// ---------------------------------------------------------------------------

export const flash8Light: Theme = {
  mode: "light",
  chrome: {
    appBg: "#ECECEC",
    panelBg: "#ECECEC",
    menuBg: "#ECECEC",
    insetFieldStrip: "#D4D4D4",
    separator: "#999999",
    textDefault: "#000000",
    // Dimmed-but-legible label text. Darkened from #808080 (only 2.66:1 on the
    // #D4D4D4 inset strip — below even the WCAG 3:1 large-text floor) to #595959,
    // which clears AA (4.73:1 on #D4D4D4, 5.93:1 on #ECECEC, 7.0:1 on #FFFFFF) while
    // staying a clearly-dimmed mid-gray vs the near-black #000000 textDefault. Drives
    // inactive tab labels and unselected event options as well as genuinely-disabled
    // controls. (task 1271)
    textDisabled: "#595959",
    bevelLight: "#FFFFFF",
    bevelDark: "#808080",
  },
  halo: {
    haloBlue: "#009DFF",
    selectionColor: "#7FCEFF",
    rollOverColor: "#B2E1FF",
    inactiveSelection: "#E8E8E8",
    selectionDisabled: "#DDDDDD",
    error: "#FF0000",
    text: "#0B333C",
    disabledText: "#AAB3B3",
    textRollOver: "#2B333C",
    textSelected: "#2B333C",
    iconColor: "#2B333C",
    disabledIcon: "#999999",
    buttonColor: "#6F7777",
    borderColor: "#B7BABC",
    borderCap: "#919999",
    shadow: "#EEEEEE",
    headerDivider: "#AEAEAE",
    separator: "#C4CCCC",
    divider: "#6F7777",
    appBgBlue: "#869CA7",
    appBgBlueGrad: ["#9CB0BA", "#68808C"],
    panelContentBg: "#FFFFFF",
    panelHeaderGrad: ["#E7E7E7", "#D9D9D9"],
    footerGrad: ["#E7E7E7", "#C7C7C7"],
    gridLineH: "#F7F7F7",
    gridLineV: "#D5DDDD",
    alternatingRows: ["#F7F7F7", "#FFFFFF"],
    inputBg: "#FFFFFF",
    inputBorder: "#B7BABC",
    inputBorderDark: "#6D6F70",
    inputBorderLight: "#D3D5D6",
  },
  content: {
    motionTween: "#CCCCFF",
    shapeTween: "#CCFFCC",
    selectedFrame: "#335EA8",
    playhead: "#CC0000",
    timelineGridline: "#EBE9ED",
    emptyFrame: "#FFFFFF",
    keyframeFilled: "#000000",
    keyframeHollow: "#FFFFFF",
    pasteboard: "#D0D0D0",
    stage: "#FFFFFF",
    stageEdgeShadow: "#CDCDCD",
    guide: "#00FFFF",
  },
};

// ---------------------------------------------------------------------------
// flash8Dark — reconstructed pre-re-theme dark palette.
//
// Provenance: the dark scheme that preceded commit 51c5e3b (the Flash 8 light
// re-theme). Backgrounds #1a1a1a / #1e1e1e / #2d2d2d / #3c3c3c, #555 borders,
// #1a1a1a hairlines, #e0e0e0 / #c0c0c0 / #999 text, accent #1a6ea8, selection
// #0078d7. Halo/content values are darkened-but-coherent analogues chosen to
// keep the SAME structural roles as light (so flipping the mode is sensible).
// These are a sane starting point; tune in docs/31-theming.md step 1.
// ---------------------------------------------------------------------------

export const flash8Dark: Theme = {
  mode: "dark",
  chrome: {
    appBg: "#1e1e1e",
    panelBg: "#2d2d2d",
    menuBg: "#1a1a1a",
    insetFieldStrip: "#252525",
    separator: "#1a1a1a",
    textDefault: "#e0e0e0",
    // Dimmed-but-legible label text (dark theme equivalent of the light fix above).
    // #808080 was only 3.88:1 on the #252525 inset strip / 3.49:1 on #2d2d2d panelBg —
    // below AA — so inactive tabs/unselected options read as faint. Lightened to
    // #9a9a9a (5.45:1 on #252525, 4.89:1 on #2d2d2d) while staying clearly dimmed vs
    // the #e0e0e0 textDefault. (task 1271)
    textDisabled: "#9a9a9a",
    bevelLight: "#555555",
    bevelDark: "#111111",
  },
  halo: {
    haloBlue: "#1a6ea8",
    selectionColor: "#0078d7",
    rollOverColor: "#3a5a78",
    inactiveSelection: "#3a3a3a",
    selectionDisabled: "#2a2a2a",
    error: "#e05050",
    text: "#e0e0e0",
    disabledText: "#666666",
    textRollOver: "#ffffff",
    textSelected: "#ffffff",
    iconColor: "#c0c0c0",
    disabledIcon: "#555555",
    buttonColor: "#c0c0c0",
    borderColor: "#555555",
    borderCap: "#444444",
    shadow: "#000000",
    headerDivider: "#1a1a1a",
    separator: "#444444",
    divider: "#555555",
    appBgBlue: "#2a3a44",
    appBgBlueGrad: ["#33454f", "#1e2a30"],
    panelContentBg: "#1e1e1e",
    panelHeaderGrad: ["#3a3a3a", "#2d2d2d"],
    footerGrad: ["#3a3a3a", "#252525"],
    gridLineH: "#2a2a2a",
    gridLineV: "#1f2626",
    alternatingRows: ["#262626", "#2d2d2d"],
    inputBg: "#1a1a1a",
    inputBorder: "#555555",
    inputBorderDark: "#111111",
    inputBorderLight: "#3a3a3a",
  },
  content: {
    motionTween: "#3a3a66",
    shapeTween: "#3a663a",
    selectedFrame: "#1a6ea8",
    playhead: "#ff4444",
    timelineGridline: "#3a3a3a",
    emptyFrame: "#2d2d2d",
    keyframeFilled: "#e0e0e0",
    keyframeHollow: "#2d2d2d",
    pasteboard: "#3c3c3c",
    stage: "#ffffff",
    stageEdgeShadow: "#000000",
    guide: "#00FFFF",
  },
};

/** Lookup table: mode → complete theme value-set. */
export const themes: Record<ThemeMode, Theme> = {
  light: flash8Light,
  dark: flash8Dark,
};
