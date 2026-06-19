/**
 * themeStylesheet — generates & injects the CSS custom-property stylesheet that backs
 * the DOM (chrome/halo) tokens.
 *
 * For every chrome/halo COLOR token we emit a CSS variable:
 *   --f8-chrome-appBg, --f8-halo-haloBlue, --f8-halo-appBgBlueGrad-0, ...
 *
 * Two rule blocks:
 *   :root              { ...light values... }   // DEFAULT — matches flash8Light exactly
 *   [data-theme=dark]  { ...dark values...  }   // overrides under data-theme="dark"
 *
 * The exported chrome/halo token strings in `flash8Theme.ts` are `var(--name, <lightHex>)`.
 * Because the light hex is the fallback AND the `:root` value, the rendered color is
 * IDENTICAL to the old hardcoded tokens by default. Flipping
 * `document.documentElement.dataset.theme = "dark"` switches every DOM surface with
 * zero component edits.
 *
 * The injector is DOM-guarded (no-op under the node test environment) and idempotent
 * (injects at most once per document).
 */

import { flash8Light, flash8Dark } from "./themes.js";
import type { ChromeColors, HaloColors } from "./themes.js";

/** CSS-variable name for a chrome/halo color token, e.g. ("chrome","appBg") → --f8-chrome-appBg. */
export function cssVarName(group: "chrome" | "halo", key: string): string {
  return `--f8-${group}-${key}`;
}

/**
 * The `var()` reference string for a token, with the light hex as fallback so the
 * value is correct even before the stylesheet is injected (and in the node env).
 */
export function cssVar(group: "chrome" | "halo", key: string, lightFallback: string): string {
  return `var(${cssVarName(group, key)}, ${lightFallback})`;
}

const STYLE_ELEMENT_ID = "f8-theme-vars";

/** Emit `--name: value;` declarations for one group's scalar string colors. */
function declarations(group: "chrome" | "halo", colors: ChromeColors | HaloColors): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === "string") {
      out.push(`  ${cssVarName(group, key)}: ${value};`);
    } else if (Array.isArray(value)) {
      // Gradient/row tuples → indexed vars (--f8-halo-appBgBlueGrad-0, -1, ...).
      value.forEach((v, i) => {
        if (typeof v === "string") out.push(`  ${cssVarName(group, key)}-${i}: ${v};`);
      });
    }
  }
  return out;
}

/** Build the full stylesheet text (:root light + [data-theme="dark"] dark). */
export function buildThemeStylesheet(): string {
  const lightDecls = [
    ...declarations("chrome", flash8Light.chrome),
    ...declarations("halo", flash8Light.halo),
  ].join("\n");
  const darkDecls = [
    ...declarations("chrome", flash8Dark.chrome),
    ...declarations("halo", flash8Dark.halo),
  ].join("\n");
  return `:root {\n${lightDecls}\n}\n\n[data-theme="dark"] {\n${darkDecls}\n}\n`;
}

/**
 * Inject the theme stylesheet into <head> once. No-op when there is no DOM (node tests)
 * or when already injected. Safe to call from module top-level and from ThemeProvider.
 */
export function injectThemeStylesheet(): void {
  if (typeof document === "undefined" || !document.head) return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = buildThemeStylesheet();
  document.head.appendChild(style);
}
