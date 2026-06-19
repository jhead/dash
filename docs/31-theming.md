# 31 — Theming (swappable light/dark)

Status: **implemented** (task 1265). DEFAULT = light (Flash 8). No UI toggle yet — only the
capability. This doc describes the architecture and the exact bounded steps to fully enable
dark mode later.

The Flash 8 light "Halo" appearance is unchanged by default; see `docs/30-flash8-ui-spec.md`
for the authoritative color spec. This system makes those colors **swappable** without
touching the ~40 components that consume them.

---

## 1. The problem it solves

`packages/authoring-ui/src/theme/flash8Theme.ts` exports semantic design tokens
(`chrome.*`, `halo.*`, `content.*`, `metrics.*`) and helpers (`panelStyle`, `titleBarStyle`,
`buttonStyle`, `inputStyle`, `bevel`, `chromeFont`, `widgetFont`). ~40 components import them
read-only. The hard requirement: re-adding dark mode later must **not** require editing all
those components again.

## 2. Architecture

The module structure under `packages/authoring-ui/src/theme/`:

| File | Role |
|------|------|
| `flash8Theme.ts` | **Frozen public surface.** Same token names + helper signatures as before. Color values are now indirections (see below); metrics are plain literals. |
| `themes.ts` | Typed `Theme` shape + two complete value-sets: `flash8Light` (current values) and `flash8Dark` (reconstructed dark palette). `themes` maps mode → value-set. |
| `themeState.ts` | Runtime swap engine: `activeTheme()`, `activeMode()`, `getThemeColor()`, `setThemeMode()`, `subscribeTheme()`. Holds the single mutable mode (default `light`). |
| `themeStylesheet.ts` | Generates + injects the CSS-variable stylesheet (`:root` light, `[data-theme="dark"]` dark). DOM-guarded + idempotent. |
| `ThemeProvider.tsx` | Optional React glue: `ThemeProvider`, `useTheme()`, `useThemeRedraw()`. |
| `index.ts` | Barrel re-exporting all of the above. Also re-exported from the package root `index.ts`. |

### Three token systems, two swap strategies

The tokens split into three systems (as in the spec) but use **two** distinct swap
mechanisms because DOM and canvas resolve color differently:

**A + B — `chrome.*` / `halo.*` (DOM tokens) → CSS custom properties.**
Each color token's exported string is a `var(--f8-<group>-<key>, <lightHex>)` reference, e.g.
`chrome.panelBg === "var(--f8-chrome-panelBg, #ECECEC)"`. On import, `flash8Theme.ts` injects
a stylesheet:

```css
:root            { --f8-chrome-panelBg: #ECECEC; --f8-halo-haloBlue: #009DFF; /* …light… */ }
[data-theme="dark"] { --f8-chrome-panelBg: #2d2d2d; --f8-halo-haloBlue: #1a6ea8; /* …dark… */ }
```

Because every component references the **same** token constant, the rendered color follows
the cascade: `:root` (light) by default, the `[data-theme="dark"]` override when
`document.documentElement.dataset.theme === "dark"`. The light hex is also the `var()`
**fallback**, so the value is correct even before the stylesheet loads and in non-DOM
(node test) environments — the default appearance is byte-identical to the old hardcoded
tokens. **Flipping `data-theme` swaps the entire DOM UI with zero component edits.**

Gradient/row tuples (`appBgBlueGrad`, `panelHeaderGrad`, `footerGrad`, `alternatingRows`)
become tuples of indexed CSS vars (`--f8-halo-panelHeaderGrad-0`, `-1`).

**C — `content.*` (canvas colors) → theme-aware getters.**
Canvas 2D contexts paint with concrete hex; a `var()` is useless there. So `content.*` color
tokens are **getters** that return `activeTheme().content[key]` — the active theme's concrete
hex (light by default). Components that read `content.playhead` at render time automatically
get the active theme's value. `getThemeColor("content", key)` is the explicit resolver for
non-render-path canvas code. Canvas components subscribe via `subscribeTheme()` /
`useThemeRedraw()` to repaint when the mode changes.

`content.*` **metrics** (`framePitch`, `layerRowHeight`, `rulerHeight`, `defaultDoc`) and all
of `metrics.*`, plus chrome/halo font/size/radius tokens, are theme-invariant literals — only
colors swap.

### Switch API

```ts
import { setThemeMode } from "@flash/authoring-ui"; // or "./theme/flash8Theme.js"

setThemeMode("dark");  // sets data-theme, active JS theme, notifies canvas subscribers
setThemeMode("light"); // back to default (removes data-theme attribute)
```

`setThemeMode` is idempotent (switching to the active mode is a no-op). DEFAULT is `light`;
nothing flips unless `setThemeMode("dark")` is called.

Optional React form:

```tsx
import { ThemeProvider, useTheme } from "@flash/authoring-ui";

<ThemeProvider>{/* app */}</ThemeProvider>;

const { mode, setMode, toggle } = useTheme(); // useTheme works provider-less too
```

Canvas components:

```ts
import { useThemeRedraw } from "@flash/authoring-ui";
useThemeRedraw(redraw); // redraw() runs on every mode change
```

## 3. The dark palette (`flash8Dark`)

Reconstructed from git history (pre-commit `51c5e3b`, the light re-theme). Backgrounds
`#1a1a1a` / `#1e1e1e` / `#2d2d2d` / `#3c3c3c`, `#555` borders, `#1a1a1a` hairlines,
`#e0e0e0` / `#c0c0c0` / `#999` text, accent `#1a6ea8`, selection `#0078d7`. Halo/content
values are darkened-but-coherent analogues that keep the same structural role as their light
counterparts, so flipping the mode is sensible. They are a **sane starting point** to be
tuned, not a pixel-perfect restoration.

## 4. How to fully enable dark mode later (bounded steps)

The plumbing is done. To ship a working dark mode:

1. **Tune `flash8Dark`** in `packages/authoring-ui/src/theme/themes.ts` to taste. The keys
   are fixed (typed parity with `flash8Light` is asserted by `themeSystem.test.ts`); just
   adjust the hex values. No other file changes are required for the DOM to swap.

2. **Wire canvas repaint** (likely already a one-liner each). In `StageArea.tsx` and
   `Timeline.tsx` (and any other `content.*`-painting canvas), call `useThemeRedraw(redraw)`
   with the component's existing redraw function so a mode change repaints the canvas. The
   `content.*` getters already return dark hex once the mode is dark — this only forces the
   repaint. (If a canvas already redraws every frame / on every store change, even this may
   be unnecessary.)

3. **Add a Preferences toggle** that calls `setThemeMode("light" | "dark")` (or use
   `useTheme().setMode`). Persist the choice in the existing preferences store and apply it
   on startup (call `setThemeMode(savedMode)` once during app init). This is the only new UI.

4. **Verify**: confirm light is still `#ECECEC` panels (default), flip to dark, eyeball the
   stage/timeline/panels, and tune `flash8Dark` for contrast. Run
   `pnpm --filter @flash/authoring-ui run test` — `themeSystem.test.ts` guards the surface +
   swap.

That's it: steps 1 + 3 are required; step 2 is required only for canvas surfaces that don't
already repaint on state change.

## 5. Invariants / gotchas

- **Do not change the public export surface of `flash8Theme.ts`.** Token names and helper
  signatures are frozen; ~40 components + sibling agents import them read-only.
- **`chrome.*` / `halo.*` color strings are `var()` references, not raw hex.** Never parse
  them as hex; spread them into `style`. The raw hex lives in `flash8Light` / `flash8Dark`
  and is reachable via `activeTheme()` / `getThemeColor()`.
- **`content.*` colors are getters** — read them at render time (don't cache the value across
  a theme change). They return concrete hex.
- **Light is the `:root` default and the var fallback**, so the node test environment (no
  DOM) and the pre-stylesheet first paint both render correct light values.
- The stylesheet injector is DOM-guarded and idempotent — safe to import anywhere.
