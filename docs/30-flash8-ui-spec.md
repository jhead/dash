# Flash 8 UI Spec — the single source of truth for the re-theme

This document is the definitive specification for making the `dash` authoring UI match
**Macromedia Flash Professional 8** exactly. Flash 8 ships the **Halo** look-and-feel on a
**light gray** Windows-XP (Luna) chrome — the current dash UI is *dark*, which is wrong.

The spec is organised into three colour/metric systems, which must not be conflated:

- **System A — IDE chrome.** The native (XP/Luna) window furniture Flash draws: panel
  backgrounds, menu bar, title bars, tool wells, splitters, scrollbars. Light gray,
  Tahoma 11px.
- **System B — Halo widgets.** The Flex/Halo widget skin Flash uses for controls inside
  panels: buttons, combo boxes, text inputs, list/data rows, checkboxes, radios. Verdana
  10px, blue accent (`#009DFF`). Values here are **confirmed** from the Flex-SDK Halo
  theme (`frameworks/projects/framework/.../halo/defaults.css` and the Halo skin sources).
- **System C — Flash-drawn content.** Pixels Flash itself paints into the document: the
  stage, pasteboard, timeline frame cells, playhead, tween tinting, keyframe dots.

The companion implementation is `packages/authoring-ui/src/theme/flash8Theme.ts`, which
exports these values as grouped, named tokens (`chrome.*`, `halo.*`, `content.*`) plus a
small set of composable `React.CSSProperties` style helpers. **Panels must import tokens
from that module — never hardcode hex.**

---

## A. IDE chrome (System A)

Light Windows-XP/Luna furniture. These are **best-estimate** values (see *Known gaps*).

| Token | Value | Notes |
|---|---|---|
| `appBg` | `#ECECEC` | Application background / behind panels |
| `panelBg` | `#ECECEC` | Default panel background |
| `menuBg` | `#ECECEC` | Menu bar background |
| `insetFieldStrip` | `#D4D4D4` | Slightly darker recessed strip (tool wells, gutters) |
| `separator` | `#999999` | 1px panel/region separators |
| `textDefault` | `#000000` | Near-black default text |
| `textDisabled` | `#595959` | Dimmed / inactive label text (inactive tabs, unselected event options, genuinely-disabled controls). Darkened from `#808080` in task 1271 for WCAG AA legibility on the `#D4D4D4` inset strip (`#808080`→`#595959` lifts contrast 2.66:1→4.73:1) while staying clearly dimmed vs `#000000` `textDefault`. Dark-theme equivalent is `#9a9a9a`. |
| `bevelEdge` | `2px` | Etched bevel thickness |
| `borderThin` | `1px` | Thin border thickness |

**Typography (chrome):** font stack `Tahoma, "MS Shell Dlg", sans-serif`, size **11px**,
line-height **13px**. Font smoothing must **not** be subpixel — Flash 8's chrome text is
aliased/antialiased, never LCD-subpixel. Use `-webkit-font-smoothing: antialiased` (or
`none`); never `subpixel-antialiased`.

---

## B. Halo widgets (System B) — confirmed from flex-sdk halo/defaults.css

Blue-accent Halo control skin. Values confirmed against the Flex SDK Halo theme.

### Accent / state colours

| Token | Value | Role |
|---|---|---|
| `haloBlue` (themeColor) | `#009DFF` | Halo accent / focus |
| `selectionColor` | `#7FCEFF` | Selected list/data row |
| `rollOverColor` | `#B2E1FF` | Hover row |
| `inactiveSelection` | `#E8E8E8` | Selection when control not focused |
| `selectionDisabled` | `#DDDDDD` | Disabled selection |
| `error` | `#FF0000` | Error highlight |

### Text / icon colours

| Token | Value | Role |
|---|---|---|
| `text` | `#0B333C` | Halo widget text (dark teal-black) |
| `disabledText` | `#AAB3B3` | Disabled widget text |
| `textRollOver` / `textSelected` | `#2B333C` | Hover/selected text |
| `iconColor` | `#2B333C` | Icon glyph colour |
| `disabledIcon` | `#999999` | Disabled icon |
| `buttonColor` | `#6F7777` | Button label colour |

### Borders / structure

| Token | Value | Role |
|---|---|---|
| `borderColor` | `#B7BABC` | Default control border |
| `borderCap` | `#919999` | Border cap / corner |
| `shadow` | `#EEEEEE` | Drop/inset shadow tint |
| `headerDivider` | `#AEAEAE` | Panel header divider line |
| `separatorHalo` | `#C4CCCC` | Halo separator |
| `divider` | `#6F7777` | Strong divider |

### Backgrounds / gradients

| Token | Value |
|---|---|
| `appBgBlue` | `#869CA7` (gradient `#9CB0BA` → `#68808C`) |
| `panelContentBg` | `#FFFFFF` |
| `panelHeaderGrad` | `#E7E7E7` → `#D9D9D9` |
| `footerGrad` | `#E7E7E7` → `#C7C7C7` |
| `gridLineH` | `#F7F7F7` |
| `gridLineV` | `#D5DDDD` |
| `alternatingRows` | `#F7F7F7` / `#FFFFFF` |

### Buttons (Halo fills + borders)

| State | Fill (top → bottom, alpha) | Border |
|---|---|---|
| up | `#FFFFFF` → `#CCCCCC` (α 0.6 / 0.4) | `#B7BABC` → `#5B5D5E` |
| over | `#FFFFFF` → `#EEEEEE` (α 0.75 / 0.65) | `#009DFF` → `#0075BF` |
| down | `#D8F0FF` → `#99D7FF` | `#009DFF` → `#0075BF` |

`cornerRadius` = **4**.

### Text input

- background `#FFFFFF`
- inset border `#B7BABC` (dark edge `#6D6F70`, light edge `#D3D5D6`)
- focus ring `#009DFF`, **2px**, α 0.5

### Form controls

- checkbox / radio: **14×14**
- widget font: `Verdana`, **10px**

---

## C. Flash-drawn content (System C) — confirmed

Pixels Flash paints into the document and timeline.

| Token | Value | Role |
|---|---|---|
| `motionTween` | `#CCCCFF` | Motion (classic) tween span tint |
| `shapeTween` | `#CCFFCC` | Shape tween span tint |
| `brokenTween` | dashed | Broken-tween indicator (dashed line) |
| `selectedFrame` | `#335EA8` | Selected frame highlight |
| `playhead` | `#CC0000` | Playhead line / marker |
| `timelineGridline` | `#EBE9ED` | Timeline cell gridlines |
| `emptyFrame` | `#FFFFFF` | Empty frame cell |
| `keyframeFilled` | `#000000` | Filled keyframe dot |
| `keyframeHollow` | `#FFFFFF` | Hollow (empty) keyframe dot |
| `pasteboard` | `#D0D0D0` | Work area around the stage |
| `stage` | `#FFFFFF` | Stage background |
| `stageEdgeShadow` | `#CDCDCD` | ~1px stage edge shadow |
| `guide` | cyan (`~#00FFFF`) | Guide lines |

### Timeline / content metrics

- frame pitch: **8px**
- layer row height: **~18px**
- ruler header height: **~23px**
- default document: **550×400**, **12fps**, **100%** zoom

---

## Metrics (chrome)

| Metric | Value |
|---|---|
| panel title bar height | ~16px |
| gripper dots | 1px dots @ 2px pitch, 2 rows |
| bevel | 2px |
| border | 1px |
| tools panel width | ~67px |
| tool cell | ~22px |

---

## Library panel — item-preview pane (task 1338)

Flash 8's Library panel shows a **preview box at the top** of the panel — directly under
the title bar and **above** the search strip / column headers / item list. Selecting an
item updates the box with a preview keyed off the item type. This is implemented as
`<LibraryPreview>` (`packages/authoring-ui/src/LibraryPreview.tsx`), inserted at the top of
the `!collapsed` fragment in `LibraryPanel.tsx`, keyed on the existing `selectedItemId`
prop (no new selection plumbing).

**Layout / appearance.** Fixed-height strip (96px), `content.pasteboard` background with a
1px `chrome.separator` bottom border — visually the same "work area" surround Flash uses
behind the preview. Content is fit-and-centered within the box.

**Per item type:**

| Item type | Preview | Controls |
|---|---|---|
| Bitmap | the image (`<img src=dataUri>`, `pixelated` when smoothing off) | — |
| Movie Clip | first frame rendered to a `<canvas>` | ▶ Play / ■ Stop (timeline tick) |
| Graphic | first frame rendered to a `<canvas>` | ▶ Play / ■ Stop (timeline tick) |
| Button | up-state (first frame) rendered to a `<canvas>` | none (static) |
| Sound | waveform (peak bins) drawn to a `<canvas>` | ▶ Play / ■ Stop (`<audio>`) |
| Font | sample line "AaBbYyZz 123" in the named face/weight/style | — |
| Video / Component | labelled placeholder fallback | — |

**How symbols render.** The pane **reuses the stage machinery** rather than reinventing it:
it builds a `SceneGraph` for a single timeline frame via `getTweenedFrame` (the same pattern
as `Shell.tsx screenshotStage` / `engine/snapshot.ts snapshotFrame`) and draws it with
`CanvasRenderer.render(sceneGraph, viewport, library)`. The viewport zoom/pan is computed to
fit the frame's content bounds into the preview box. Bitmaps referenced anywhere in the doc
are preloaded (`renderer.loadImage`) and their decode awaited before drawing, so nested
bitmaps appear rather than placeholders. Play/Stop advances `frameIndex` on a `setInterval`
at the document frame rate, re-rendering each tick.

**Sound waveform.** Decoded on selection via Web Audio (`AudioContext.decodeAudioData` →
abs-peak bins) and drawn as centered bars; playback feeds the sound `dataUri` to an
`<audio>` element. Decode failures fall back to just the midline (still shows Play/Stop).

---

## Known gaps

- **Exact XP/Luna IDE panel gray is a best-estimate `#ECECEC`.** The real Flash 8 chrome
  gray is whatever Windows XP's "Luna" / classic theme rendered behind the app; the exact
  value depends on the OS theme Flash inherited. `#ECECEC` is a close best-estimate and is
  used throughout System A (`appBg`/`panelBg`/`menuBg`). **Flagged for a one-time
  screenshot-sampling refinement**: sample a genuine Flash 8 screenshot's panel gray and,
  if it differs, update the chrome tokens in one place (`flash8Theme.ts chrome`) — every
  panel that imports the token inherits the fix.
- Some chrome tones (`insetFieldStrip`, `separator`) are estimated alongside `panelBg` and
  should be re-sampled in the same pass.

---

## Conversion protocol (for per-panel waves)

1. Import the needed tokens / helpers from `theme/flash8Theme.ts`.
2. Replace every hardcoded hex with the matching token.
3. Use the helpers (`panelStyle`, `titleBarStyle`, `buttonStyle(state)`, `inputStyle`,
   `bevel`, `chromeFont`) rather than re-deriving gradients/borders inline.
4. `Shell.tsx` is the **reference conversion** — mirror its idiom for panel chrome.
