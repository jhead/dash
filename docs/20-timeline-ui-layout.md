# 20 — Timeline Panel UI Layout

Pixel-level layout spec for the docked **Timeline panel**, derived from measurements
of a real Macromedia Flash 8 screenshot (captured from a Windows 7 VM, measured
pixel-by-pixel in Preview). This doc defines the *chrome* — sizes, ordering, and
styling of the panel's regions. The behavioral model (frames, layers, tweens) lives
in [02 — Timeline & Animation](./02-timeline-and-animation.md).

> **Authority:** these are literal target pixel values (1:1 logical CSS px), not Retina
> 2× values. They intentionally make the timeline larger than the legacy clone layout,
> which rendered frames too small. The implementation lives in
> `packages/authoring-ui/src/Timeline.tsx`.

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
| `FRAME_W` | frame cell pitch (16) |
| `FRAME_H` | row height (38) |
| `RULER_H` | ruler row height |
| `LAYER_COL_WIDTH` | layer column width |
| `STATUS_BAR_H` | timeline status bar height |
| `DOT_SIZE` / dot offsets | keyframe dot geometry |

Sub-components: `FrameCell` (one cell), the layer-row map, the layer footer, the status
bar, `PlayheadMarker`, `OnionRangeMarker`, `FrameCounterInput`.
