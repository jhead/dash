# 07 — Symbols, Instances & Library

Reusable assets are the backbone of Flash. A **symbol** is defined once and placed as many
**instances**; the **Library** stores all assets.

## Symbol types

### MovieClip
- Self-contained timeline that plays **independently** of the parent.
- Fully scriptable (`MovieClip` class): properties, methods, events, nesting.
- Can host filters, blend modes, 9-slice scaling, bitmap caching, masks.
- Exported as **`DefineSprite`** in SWF.

### Button
- Special 4-frame timeline: **Up, Over, Down, Hit** states (Hit defines the clickable area).
- Responds to pointer/keyboard events; can contain MovieClips and sounds.
- "Enable Simple Buttons" to test on stage.
- Exported as **`DefineButton2`** in SWF.

### Graphic
- Reusable artwork/animation **locked to the parent timeline** (its playhead = parent's).
- Not scriptable, no instance name. Play modes: **Loop**, **Play Once**, **Single Frame**
  (with a first-frame offset).

### Font symbols
- Embedded fonts as Library assets (see `06`); exportable for sharing/runtime loading.

## Instances

A placed copy of a symbol. Per-instance, independent of the master symbol:

- **Instance name** (for ActionScript targeting; MovieClips/Buttons).
- **Symbol type swap** (Graphic ⇄ MovieClip ⇄ Button) and **Swap Symbol** (point to a
  different master while keeping transform).
- **Color effect** — brightness/tint/alpha/advanced (see `05`).
- **Blend mode** + **Filters** (Pro) — MovieClips (filters also on buttons/text).
- **9-slice scaling** assignment (MovieClips).
- Transform (position/scale/rotation/skew) independent of the symbol.

Editing the master symbol updates **all** instances (except per-instance overrides above).

## Library panel

`Window > Library` (Ctrl/Cmd+L):

- Lists all assets: symbols, bitmaps, sounds, video, fonts, components, compiled clips.
- Columns: name, type, use count, linkage, modified date.
- **Folders** for organization; sort, search, preview (with play for clips/sound/video).
- **Library options**: New Symbol, New Folder, Duplicate, **Properties**, **Linkage**,
  Edit, Rename, Delete, Update (re-import), Select Unused Items.
- Multiple document libraries open simultaneously; drag assets between documents.

### Linkage & shared libraries
- **Export for ActionScript** — give a symbol a **linkage identifier** + AS2 class to
  instantiate at runtime (`attachMovie`, `new`); optional **Export in first frame**.
- **Export for runtime sharing** — share assets from a separate SWF by URL.
- **Import for runtime sharing** — pull shared assets into another movie.
- **Author-time sharing** — update assets from a source FLA.

## Flash 8 instance enhancements

### Runtime bitmap caching
- `Use runtime bitmap caching` (Property inspector) or `MovieClip.cacheAsBitmap = true`.
- Renders a complex static clip to an offscreen bitmap and moves *that* (pixel-aligned)
  rather than re-rasterizing vectors each frame — big perf win for non-deforming clips.
- Required for filters to apply.

### 9-slice scaling (Scale-9)
- Define a 9-slice **guide grid** in symbol editing so corners stay fixed while edges/center
  stretch — ideal for resizable UI (buttons, panels).
- `MovieClip.scale9Grid` (a Rectangle). Exported via **`DefineScalingGrid`**.

## Behaviors

Pre-built ActionScript snippets attached via the **Behaviors** panel (no hand-coding):
load/unload movie, goto frame/scene, control MovieClip (play/stop/visibility/depth), drag,
load graphic, sound/video control, web link, etc. Behaviors generate editable AS.

## Accuracy targets

- Button Up/Over/Down/Hit semantics + Hit-area-only-defines-click behavior.
- Graphic symbol timeline-lock + Loop/Play Once/Single Frame offset must match.
- `cacheAsBitmap` pixel-snapping behavior and the filters-require-caching rule.
- `scale9Grid` stretch math must match Flash 8 / `DefineScalingGrid`.
- Linkage/export-in-first-frame timing and runtime-shared-asset resolution.

## Implementation notes

- Symbols are timeline-bearing definitions in the document model; instances are scene nodes
  referencing a definition + per-instance overrides.
- Bitmap caching = render-to-texture cached until the clip's local content/transform-class
  changes; transform applied on GPU.
- 9-slice implemented as a 9-patch mesh in the renderer.
