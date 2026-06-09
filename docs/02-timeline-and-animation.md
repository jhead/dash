# 02 — Timeline & Animation

The Timeline drives time. It is a grid of **frames** (columns) across **layers** (rows),
with a **playhead** indicating the current frame.

## Frames

- **Keyframe** — a frame where content is explicitly defined (solid dot = content,
  hollow dot = empty keyframe).
- **Regular frame** — extends the previous keyframe's content.
- **Frame span** — run of frames belonging to a keyframe.
- **Blank keyframe** — empty keyframe (no content).
- **Frame labels** — named frames (`FrameLabel`); targetable by `gotoAndPlay("label")`.
- **Frame comments** — `// text` labels for authoring notes (not exported).
- **Named anchors** — anchor labels for browser back/forward navigation.
- **Frame actions** — ActionScript attached to a keyframe (`a` marker).
- Frame operations: insert frame (F5), insert keyframe (F6), insert blank keyframe (F7),
  remove frame (Shift+F5), clear keyframe (Shift+F6), convert to keyframe, cut/copy/paste
  frames, reverse frames.

## Layers

- **Layer types**: Normal, **Guide**, **Guided** (motion guide target), **Mask**,
  **Masked**, **Folder**.
- **Layer folders** — group/organize layers; collapse/expand.
- Per-layer: show/hide, lock/unlock, outline view + outline color, layer height.
- Stacking order = z-order within a timeline (top layer renders on top).
- **Mask layers** — the mask layer's filled shapes reveal the masked layer(s) beneath.
- **Motion guide layers** — a path layer that one or more guided layers follow.
- **Distribute to Layers** — auto-split selected objects onto separate layers.

## Animation types

### Motion tween
Interpolates an **instance/group/text block's** properties between two keyframes:
position, scale, rotation, skew, color effect (alpha/tint/brightness/advanced), and (Pro)
**filters**. Requirements: a single tweenable object per layer span.

- **Tween properties** (Property inspector): Ease (−100…100), Rotate (none/auto/CW/CCW + count),
  Orient to path, Sync, Snap (to guide), Scale.
- **Motion guides** — tween position along an arbitrary path; orient-to-path rotates the
  object to follow tangent.
- **Custom ease in/ease out (Pro)** — per-property easing via the Custom Ease graph editor;
  separate curves for position, rotation, scale, color, filters.

### Shape tween
Interpolates raw **shapes** (not symbols) — morphing geometry, fills, and strokes.

- **Shape hints** (`a`–`z`) — map points between start/end shapes for predictable morphs.
- Ease and Blend (Distributive / Angular) options.
- Exported as `DefineMorphShape` / `DefineMorphShape2` in SWF.

### Frame-by-frame
Distinct content on consecutive keyframes (traditional cel animation).

## Onion skinning

- **Onion Skin** — see faded surrounding frames.
- **Onion Skin Outlines** — outlines only.
- **Edit Multiple Frames** — edit content across the onion range.
- Adjustable onion markers; "Onion All".

## Timeline Effects

Pre-built, parameterized animations applied to objects (and re-editable):

- **Transform** / **Transition** (fade, wipe).
- **Assistants**: Copy to Grid, Distributed Duplicate.
- **Effects**: Blur, Drop Shadow, Expand, Explode.

Timeline Effects generate symbols/tweens automatically and remain editable via their dialog.

## Frame rate & timing

- Movie-wide **frames per second** (default 12). Real playback may drop below target under
  load; SWF stores a target rate.
- Playhead controls: play/stop, step, loop, go to frame/label.

## Accuracy targets

- F5/F6/F7 and all frame edit semantics must match exactly (including span behavior).
- Motion tween color/filter interpolation and easing must match Flash 8 numerically.
- Shape tween morph output must match Flash's `DefineMorphShape` interpolation.
- Custom ease curves must map to the same runtime motion as Flash 8 (Pro).
- Mask/guide layer rendering and runtime behavior must match.

## Implementation notes

- Tween engine evaluates property tracks per frame; motion-guide sampling matches Flash's
  path-length parameterization.
- Shape tweening requires point-correspondence solving honoring shape hints, then emitting
  morph data for SWF and interpolated geometry for the live stage.
- Timeline Effects are macros that expand into the document model (symbols + tweens) so they
  round-trip and remain re-editable.
