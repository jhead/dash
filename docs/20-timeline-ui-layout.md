# 20 — Timeline Panel UI Layout

Pixel-level layout spec for the docked **Timeline panel**, derived from measurements
of a real Macromedia Flash 8 screenshot (captured from a Windows 7 VM, measured
pixel-by-pixel in Preview). This doc defines the *chrome* — sizes, ordering, and
styling of the panel's regions. The behavioral model (frames, layers, tweens) lives
in [02 — Timeline & Animation](./02-timeline-and-animation.md).

> **Authority:** the values below are the raw Windows-measured pixels at **UI scale 1.0**.
> They are device pixels from a 1× Windows VM. On a 2× Retina display the app renders each
> CSS px at 2 device px, so the raw values appear physically doubled — that's why the
> default **UI Scale is 0.5** (see below), which cancels the 2× DPR and reproduces Flash 8's
> on-screen size. The implementation lives in `packages/authoring-ui/src/Timeline.tsx`.

## UI Scale preference

The timeline's frame-cell geometry is multiplied by a **UI Scale** factor, a persisted
application preference:

- Stored in **localStorage** under `flash8.preferences` as `{ "uiScale": number }`,
  managed by `usePreferences()` in `preferences.ts` (default **0.5**, clamped to 0.25–2).
- Edited via **Edit → Preferences…** (`PreferencesDialog.tsx`) — a category sidebar plus
  a UI-Scale slider / % field / 50·75·100 presets, applied live and persisted on change.
- `Shell.tsx` passes `preferences.uiScale` to `<Timeline uiScale=…>`.
- **What scales:** only the frame-cell geometry — `FRAME_W`, `FRAME_H` (row height for both
  frame and layer rows), and the keyframe dot (`DOT_SIZE`/`DOT_BOTTOM`). Chrome that carries
  text (ruler height, layer column width, status bar, fonts) stays fixed so it remains
  legible at small scales. The Stage is unaffected — it has its own zoom control.
- All metric tables below are the **scale-1.0** base values (`BASE_FRAME_W`, `BASE_FRAME_H`,
  `BASE_DOT_SIZE`, `BASE_DOT_BOTTOM` in code); the component rounds `base × uiScale`.

## Panel anatomy

```
┌───────────────────────────────────────────────────────────────────────┐
│ Title bar:  "Timeline"                                                  │  header
├───────────────┬───────────────────────────────────────────────────────┤
│ Layer column  │ Frame ruler (numbered every 5 frames)        ⋮ view ▾  │  ruler row
│  headers:     ├───────────────────────────────────────────────────────┤
│  👁  🔒  ☐    │                                                       │
├───────────────┤  Frame grid (16px cells × 38px rows)                   │  SCROLLS
│ ▦ Layer name …│  ● keyframe dots, tween spans, labels, playhead        │  (layers +
│ ▦ Layer name …│                                                       │   frames
│      …        │                                                       │   together)
├───────────────┼───────────────────────────────────────────────────────┤
│ ⊕ ⤳ ⊞    🗑   │ status bar: onion/EMF · readouts · H-scrollbar         │  PINNED
└───────────────┴───────────────────────────────────────────────────────┘
        ▲ layer footer (pinned)              ▲ timeline status bar (pinned)
```

The panel is **vertically resizable** via a splitter on its top edge. When resized,
the **layer footer** and **status bar** stay pinned to the bottom; only the middle
region (layer rows + frame grid) scrolls. Horizontal scrolling of the frame grid is
driven by the H-scrollbar in the status bar and stays in sync with the ruler.

The **divider between the LAYERS column and the FRAMES grid is draggable** (task
1366): grab it (col-resize cursor) and drag to set the layers-column width; the frame
grid reflows into the remaining space. It reuses the Shell's shared `useResize` hook —
the same one that drives the right-pane / timeline / bottom-dock dividers — so it has
the identical pointer-capture drag + min/max clamp + persist-on-release behaviour, and
is keyboard-accessible (`role="separator"`, ArrowLeft/Right to nudge ±1px, Shift for
±10px, Home/End to jump to the bounds). The chosen width is persisted across reloads as
`layerColumnWidth` in `editorLayout` (localStorage; clamped to
`PANE_BOUNDS.layerColumnWidth` = [90, 400], default 130).

## Frame grid metrics

| Element | Value | Notes |
|---|---|---|
| Frame cell width | **16px** | border-to-border. 15px cell + 1px right gridline. |
| First cell left edge | (no own border) | The grid's outer border supplies the left edge; the first cell omits a left border so two adjacent cells share a single 1px gridline. |
| Row height | **38px** | inside borders; applies to both frame rows and layer rows (they align 1:1). |
| Ruler | numbered every **5 frames** | tick labels at 1, 5, 10, 15, … |

### Keyframe dot

| Property | Value |
|---|---|
| Size | **10 × 10px** circle |
| Offset from cell **top** | 24px |
| Offset from cell **bottom** | 4px |
| Offset from cell **sides** | ~3px each (`(16 − 10) / 2`) |

The dot sits low in the cell (24px down from the top, 4px from the bottom), leaving the
upper portion of the cell for the keyframe span / tween fill. Solid fill = keyframe with
content; hollow (outline only) = blank keyframe.

## Layer rows

Left-to-right ordering within each layer row:

1. **Layer type icon** (normal / guide / mask / masked / folder)
2. **Layer name** (rename on double-click)
3. **Flexible padding**
4. **Edit pencil** — shown on the active layer (editable indicator)
5. **Show / Hide** dot (eye column)
6. **Lock** dot (padlock column)
7. **Outline color chip** (square; doubles as the outline-view color)

The Show/Hide, Lock, and Outline columns are **right-aligned** and line up vertically
under their corresponding **column headers** (eye / padlock / square) at the top of the
layer column, exactly as in Flash 8.

### Layer footer (pinned, bottom of the layer column)

Left-aligned: **Insert Layer · Add Motion Guide · Insert Layer Folder**.
Right-aligned: **Delete Layer (trash)**.

## Timeline status bar (pinned, bottom of the frame area)

Left-to-right, grouped:

1. **Center Frame** — scroll the grid so the playhead is centered
2. **Onion Skin** toggle
3. **Onion Skin Outlines** toggle
4. **Edit Multiple Frames** toggle
5. **Modify Onion Markers** menu
6. — readouts —
7. **Current Frame** number
8. **Frame Rate** (fps)
9. **Elapsed Time** (seconds)
10. **Horizontal Scrollbar** (drives the frame grid + ruler)

The three numeric readouts (Current Frame, Frame Rate, Elapsed Time) use an **inset /
sunken** style (recessed border) to match Flash 8.

> **No playback transport here.** Flash 8's timeline status bar does *not* contain
> play/stop/step/loop buttons — those lived in a separate **Controller** toolbar. The
> clone follows suit: transport is not part of the Timeline panel.

## Mapping to code

All metrics are constants at the top of `packages/authoring-ui/src/Timeline.tsx`:

| Constant | Meaning |
|---|---|
| `BASE_FRAME_W` | frame cell pitch at scale 1 (16); component uses `round(BASE_FRAME_W × uiScale)` |
| `BASE_FRAME_H` | row height at scale 1 (38); scaled by `uiScale` |
| `BASE_DOT_SIZE` / `BASE_DOT_BOTTOM` | keyframe dot geometry at scale 1; scaled by `uiScale` |
| `RULER_H` | ruler row height (fixed, not scaled) |
| `LAYER_COL_WIDTH` | layer column DEFAULT width (130); now user-resizable via the layers/frames divider and persisted as `layerColumnWidth` in `editorLayout`. The live value is passed in as the `layerColumnWidth` prop (clamped to `LAYER_COL_MIN_WIDTH`..`LAYER_COL_MAX_WIDTH`). |
| `STATUS_BAR_H` | timeline status bar height (fixed) |

Sub-components: `FrameCell` (one cell), the layer-row map, the layer footer, the status
bar, `PlayheadMarker`, `OnionRangeMarker`, `FrameCounterInput`.
