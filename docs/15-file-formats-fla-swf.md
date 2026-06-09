# 15 — File Formats: FLA & SWF

Two formats matter: **FLA** (editable project / our save format) and **SWF** (compiled output).

## FLA — project file

- In Flash 8, **FLA is a proprietary binary** document format (the human-readable **XFL**
  zip/XML format only arrived in CS5). It stores everything the authoring tool needs:
  stage/document settings, scenes, timelines, layers, frames, the **entire Library**
  (symbols, bitmaps, sounds, video, fonts, components), ActionScript, publish profiles,
  history/metadata, and editor state.
- Goal: **lossless round-trip** of our document model.

### Our FLA strategy
- We are not bound to Macromedia's exact binary layout (it's undocumented). Recommended:
  - **Primary save format**: our own well-specified container (a zip of JSON/binary parts,
    XFL-inspired) carrying the full document model — versioned and stable.
  - Use the `.fla` extension for user familiarity (our format), and clearly version it.
- **Interop (stretch goal)**: best-effort **import of real Flash 8 `.fla`** via
  reverse-engineered parsing, and/or **XFL (CS5+) import/export** as a documented bridge.
  Track as a separate compatibility milestone; do not block core work on it.

### What the project format must capture
- Document properties; scenes (order, names); per-timeline layers (type, state, folders);
  frames (keyframes, tweens, labels, scripts, sounds); the Library tree with asset binaries
  + linkage; AS2 classes/`.as` files; publish profiles; guides/grid/snapping; symbol edit
  metadata (9-slice grids, etc.).

## SWF — compiled output (target: version 8)

SWF is a tag-based binary. Reference: the SWF File Format Specification.

### Header
- Signature: **`FWS`** (uncompressed) or **`CWS`** (zlib-compressed; Player 6+).
  (`ZWS`/LZMA is Player 11+, out of scope.)
- **Version** byte = **8**.
- File length; **stage RECT** (twips); **frame rate**; **frame count**.

### Structure
- **Definition tags** assign a **character ID** into the dictionary; **control tags** place/
  modify/remove characters on the **display list** by **depth**; **`ShowFrame`** renders a
  frame; **`End`** terminates.
- **Tag ordering rules**: for SWF 8+, **`FileAttributes` must be the first tag**; a tag may
  only depend on earlier tags; definitions precede their use; streaming sound stays in order;
  `End` is last.
- Coordinates are in **twips** (1/20 px); matrices/color transforms use fixed-point encodings.

### Key tags we must emit/parse (SWF ≤ 8)
- **Shapes**: `DefineShape`, `DefineShape2`, `DefineShape3` (RGBA), **`DefineShape4`**
  (enhanced strokes: caps/joins/miter, scaling-stroke flags, focal gradients).
- **Morph**: `DefineMorphShape`, **`DefineMorphShape2`** (shape tweens).
- **Sprites/instances**: **`DefineSprite`**; **`PlaceObject`/`PlaceObject2`/`PlaceObject3`**
  (matrix, color transform, ratio, name, clip depth, **blend mode**, **filter list**,
  bitmap-cache flag), `RemoveObject`/`RemoveObject2`.
- **Buttons**: `DefineButton`, **`DefineButton2`**, `DefineButtonSound`, `DefineButtonCxform`.
- **Bitmaps**: `DefineBits`/`JPEGTables`, `DefineBitsJPEG2`, **`DefineBitsJPEG3`** (alpha),
  `DefineBitsLossless`, **`DefineBitsLossless2`** (alpha PNG/GIF-style).
- **Text/fonts**: `DefineFont`, **`DefineFont2`**, **`DefineFont3`**, `DefineFontInfo(2)`,
  **`DefineFontAlignZones`**, `DefineText`, `DefineText2`, **`DefineEditText`**,
  **`CSMTextSettings`** (FlashType anti-alias params).
- **Sound**: `DefineSound`, `StartSound`, `SoundStreamHead(2)`, `SoundStreamBlock`.
- **Video**: `DefineVideoStream`, `VideoFrame`.
- **Control/meta**: `ShowFrame`, `SetBackgroundColor`, **`FrameLabel`**, `Protect`,
  `EnableDebugger(2)`, `ScriptLimits`, **`FileAttributes`**, **`Metadata`**,
  **`DefineScalingGrid`** (9-slice), **`DefineSceneAndFrameLabelData`**, `ExportAssets`,
  `ImportAssets(2)`, `SymbolClass`(AS3-only, skip), `End`.
- **ActionScript (AVM1)**: **`DoAction`**, `DoInitAction` — AVM1 action bytecode.
  (`DoABC`/AVM2 is SWF 9+ / AS3 — **out of scope** for Flash 8 fidelity.)

## Accuracy targets

- Emit minimal, valid, Player-8-compatible SWFs; verify in Flash Player 8 and Ruffle.
- Correct twips/fixed-point encoding; correct tag ordering (FileAttributes first for v8).
- Shape records (edges, fill/line style arrays, style-change records) byte-correct;
  `DefineShape4` stroke/gradient features preserved.
- AVM1 `DoAction` bytecode matches the AS2 compiler output (`12`).

## Implementation notes

- Reuse **Ruffle's `swf` crate** semantics as the parsing/encoding reference; our writer is a
  faithful tag emitter from the document model.
- Build a **round-trip test**: model → SWF → parse → compare; plus golden-file renders.
- Keep the project (FLA) writer and the SWF writer separate: FLA preserves editability; SWF
  is the flattened runtime form.
