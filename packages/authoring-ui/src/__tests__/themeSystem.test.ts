/**
 * Theme system (task 1265): proves the public export surface is preserved, that LIGHT is
 * unchanged by default, and that the swap mechanism flips DOM (CSS var) + canvas (content)
 * colors when the mode changes.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  chrome,
  halo,
  content,
  metrics,
  panelStyle,
  titleBarStyle,
  buttonStyle,
  inputStyle,
  bevel,
  chromeFont,
  widgetFont,
} from "../theme/flash8Theme.js";
import {
  activeMode,
  activeTheme,
  getThemeColor,
  setThemeMode,
  subscribeTheme,
} from "../theme/themeState.js";
import { flash8Light, flash8Dark } from "../theme/themes.js";
import { buildThemeStylesheet, cssVar } from "../theme/themeStylesheet.js";

afterEach(() => {
  // Always restore the default so test order never matters.
  setThemeMode("light");
});

describe("export surface preservation", () => {
  it("keeps the exact chrome / halo / content / metrics token names", () => {
    // Chrome colors are now var() strings; metrics stay literal.
    expect(Object.keys(chrome).sort()).toEqual(
      [
        "appBg", "panelBg", "menuBg", "insetFieldStrip", "separator",
        "textDefault", "textDisabled", "bevelEdge", "borderThin", "fontFamily",
        "fontSize", "lineHeight", "bevelLight", "bevelDark",
      ].sort(),
    );
    expect(Object.keys(metrics).sort()).toEqual(
      ["titleBarHeight", "gripperPitch", "bevel", "border", "toolsPanelWidth", "toolCell"].sort(),
    );
    // content exposes both color getters AND the metric literals.
    expect(content).toHaveProperty("playhead");
    expect(content).toHaveProperty("framePitch", 8);
    expect(content.defaultDoc).toEqual({ width: 550, height: 400, fps: 12, zoom: 1 });
  });

  it("keeps every helper callable with its original signature", () => {
    expect(typeof panelStyle()).toBe("object");
    expect(typeof titleBarStyle()).toBe("object");
    expect(typeof buttonStyle("over")).toBe("object");
    expect(typeof inputStyle(true)).toBe("object");
    expect(typeof bevel("sunken")).toBe("object");
    expect(typeof chromeFont()).toBe("object");
    expect(typeof widgetFont()).toBe("object");
  });
});

describe("light is unchanged (default)", () => {
  it("defaults to light mode", () => {
    expect(activeMode()).toBe("light");
    expect(activeTheme()).toBe(flash8Light);
  });

  it("resolves DOM tokens to a var() with the exact light hex fallback", () => {
    // panel bg must still resolve to #ECECEC via the CSS-var fallback / :root value.
    expect(chrome.panelBg).toBe(cssVar("chrome", "panelBg", "#ECECEC"));
    expect(chrome.panelBg).toContain("#ECECEC");
    expect(chrome.appBg).toContain("#ECECEC");
    expect(halo.haloBlue).toContain("#009DFF");
    expect(panelStyle().background).toBe(chrome.panelBg);
  });

  it("returns the exact light hex for every canvas content color", () => {
    expect(content.playhead).toBe("#CC0000");
    expect(content.selectedFrame).toBe("#335EA8");
    expect(content.motionTween).toBe("#CCCCFF");
    expect(content.shapeTween).toBe("#CCFFCC");
    expect(content.pasteboard).toBe("#D0D0D0");
    expect(content.stage).toBe("#FFFFFF");
    expect(content.emptyFrame).toBe("#FFFFFF");
  });

  it("the :root stylesheet block carries the light values", () => {
    const css = buildThemeStylesheet();
    expect(css).toContain(":root {");
    expect(css).toContain("--f8-chrome-panelBg: #ECECEC;");
    expect(css).toContain("--f8-halo-haloBlue: #009DFF;");
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain("--f8-chrome-panelBg: #2d2d2d;");
  });
});

describe("swap mechanism", () => {
  it("flips canvas content colors to the dark palette and back", () => {
    expect(content.playhead).toBe(flash8Light.content.playhead);
    setThemeMode("dark");
    expect(activeMode()).toBe("dark");
    expect(activeTheme()).toBe(flash8Dark);
    expect(content.playhead).toBe(flash8Dark.content.playhead);
    expect(content.pasteboard).toBe(flash8Dark.content.pasteboard);
    setThemeMode("light");
    expect(content.playhead).toBe(flash8Light.content.playhead);
  });

  it("DOM token strings are STABLE across a swap (CSS vars do the work)", () => {
    const before = chrome.panelBg;
    setThemeMode("dark");
    // The exported string is a var() reference and never changes — the DOM swaps via CSS.
    expect(chrome.panelBg).toBe(before);
  });

  it("getThemeColor resolves from the active theme", () => {
    expect(getThemeColor("content", "playhead")).toBe(flash8Light.content.playhead);
    expect(getThemeColor("chrome", "panelBg")).toBe(flash8Light.chrome.panelBg);
    setThemeMode("dark");
    expect(getThemeColor("content", "playhead")).toBe(flash8Dark.content.playhead);
  });

  it("notifies canvas subscribers on a real mode change only", () => {
    let calls = 0;
    const unsub = subscribeTheme(() => { calls += 1; });
    setThemeMode("light"); // no-op (already light)
    expect(calls).toBe(0);
    setThemeMode("dark");
    expect(calls).toBe(1);
    setThemeMode("dark"); // no-op (already dark)
    expect(calls).toBe(1);
    setThemeMode("light");
    expect(calls).toBe(2);
    unsub();
    setThemeMode("dark");
    expect(calls).toBe(2);
  });
});

describe("dark palette completeness", () => {
  it("flash8Dark defines every key flash8Light defines (typed parity)", () => {
    expect(Object.keys(flash8Dark.chrome).sort()).toEqual(Object.keys(flash8Light.chrome).sort());
    expect(Object.keys(flash8Dark.halo).sort()).toEqual(Object.keys(flash8Light.halo).sort());
    expect(Object.keys(flash8Dark.content).sort()).toEqual(Object.keys(flash8Light.content).sort());
  });
});
