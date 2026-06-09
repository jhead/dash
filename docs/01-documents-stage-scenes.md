# 01 — Documents, Stage & Scenes

The container model: how a Flash movie is organized, edited, and navigated.

## Document (.fla)

A Flash document is the editable project. Definitive properties (Document Properties dialog,
`Modify > Document`):

- **Dimensions** — stage width × height in pixels (default 550 × 400).
- **Frame rate** — default 12 fps (movie-wide; see `02`).
- **Background color** — single stage color.
- **Ruler units** — px, inches, points, cm, mm.
- **Match** — to printer / contents / default.
- **Grid, guides, rulers** — spacing, color, snap settings (`View` menu).
- **Make Default** — persist as new-document defaults.

Document-level features:

- **Document tabs** — multiple documents open at once, tabbed.
- **Multiple timelines & levels** — `_levelN` stacking, `_root`, nested clips.
- **Targets** — absolute (`_root.clip.sub`) and relative (`this`, `_parent`) paths.
- **Movie Explorer** — searchable tree of every element (text, symbols, scripts, etc.).
- **Find and Replace** — across text, fonts, colors, symbols, sounds, video, bitmaps.
- **Undo/Redo/Repeat** — document-level *or* object-level undo (preference); History panel.
- **History panel** — replayable step list; save steps as reusable **Commands**.
- **Templates** — new documents from templates (advertising, mobile, quiz, etc.).
- **Publish/optimize/test download** — see `14`.

## Stage

The rectangular drawing/playback surface.

- **Work area / pasteboard** — gray area around the stage; off-stage content is not shown
  at runtime but is retained.
- **Zoom** — 8%–2000%; "Show All", "Show Frame", fit-in-window.
- **View modes** — Outlines, Fast, Anti-alias, Anti-alias Text.
- **Snapping** — to objects, pixels, grid, guides, and align (see `03`).
- **Rulers & guides** — draggable guides, lockable; guide layers.
- **Scene/symbol edit context** — the stage shows the current edit target (scene, symbol,
  or group) with an edit-bar breadcrumb (`Scene 1 > mySymbol`).

## Timelines hierarchy

Every movie has a **main timeline**; every MovieClip/Button/Graphic symbol has its **own
timeline**. Clips nest arbitrarily. Each timeline is independent (its own playhead, frames,
layers) except Graphic symbols, which are locked to the parent's timeline (see `07`).

- **`_root`** — main timeline of the current level.
- **`_levelN`** — separately loaded SWFs stacked by level number.
- **`_parent` / `this`** — relative navigation between nested timelines.

## Scenes

Scenes split the **main timeline** into named, ordered sections that play sequentially.

- **Scene panel** (`Window > Other Panels > Scene`) — add, duplicate, delete, reorder, rename.
- Scenes play in list order unless ActionScript navigation overrides (`gotoAndPlay`,
  `nextScene`, etc.).
- At publish time, scenes are concatenated into one continuous timeline (with
  `DefineSceneAndFrameLabelData` in SWF for scene/label metadata).
- Edit bar shows/selects the current scene.

## Movie Explorer

A panel that displays the document's structure as a filterable tree: text, fonts, symbols
(by type), ActionScript, video, sounds, bitmaps. Supports find, replace, "Find in Library",
copy text/scripts, and printing the tree.

## Accuracy targets

- Default document = 550×400 @ 12 fps, white background.
- Object-level vs document-level undo must both be supported, switchable in preferences.
- Scene concatenation and frame numbering at publish must match Flash 8 exactly.
- Edit-bar breadcrumb and edit-in-place context behavior must match.

## Implementation notes

- The in-memory **document model** is the single source of truth (the "FLA in memory");
  the FLA reader/writer serializes it (`15`).
- Stage rendering is a GPU scene graph; pasteboard is part of the scene but clipped at
  publish/test.
- History panel = command pattern with serializable steps (enables Commands + JSFL-style
  automation later).
