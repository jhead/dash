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

### Implementation (Insert > Timeline Effects)

`Insert > Timeline Effects > {Transform|Blur|…}` opens `TimelineEffectDialog`
(`packages/authoring-ui`). The selected shape(s)/symbol(s) on the active keyframe are
wrapped in a new MovieClip symbol (named `Transform N`, `Blur N`, …) and the effect's
keyframes are synthesized on the object's timeline by `useTimelineEffectHandlers`. The
result interpolates on stage (via `getTweenedFrame`) and compiles to a smooth SWF tween.

- **Transform** (duration, scale X/Y, rotation, alpha, ease): a single motion tween from
  the start keyframe to an end keyframe `duration-1` frames later, with the end instance
  carrying the target scale/rotation/alpha. Ease is stored as the keyframe `motionEase`.
- **Blur** (duration, blur X/Y, ease): a **blur-filter tween 0 → max → 0** across three
  keyframes — start (blur 0), midpoint (the requested peak blur), end (blur 0) — each
  motion-tweened. A `flash.filters.BlurFilter` is set on every keyframe; the tween engine
  interpolates the filter per frame and the SWF compiler emits a per-frame PlaceObject3
  (tag 70) FILTERLIST, so the object visibly blurs and re-sharpens. (Spans shorter than 3
  frames degrade to a single 0 → max ramp.) The peak blur reaches exactly the dialog
  value at the middle keyframe.

> **Filter tweens require per-frame PlaceObject3 re-emit.** The compiler's frame-diff
> change detection (`packages/swf/src/compiler/frames.ts`) keys on position, color
> effect, AND the serialized filter list (`filtersKey`). Without the filter key a tween
> that changes only the filter (position fixed) would suppress the move and freeze the
> blur at its first-frame value.

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
- **Motion tweens fold each keyframe's shape geometric origin into the interpolated
  position (task 1216).** A classic tween's on-stage position is `transform.x + geometryOrigin`;
  when the movement is encoded in the path coordinates (both keyframes share `transform.x/y`
  but the shape sits at a different place) `getTweenedFrame` adds the start/end geometry origin
  into the tween target, interpolates the true on-stage position, then subtracts the START
  origin back out (the in-between frames reuse the start character, whose origin is baked in).
  Without this the matrix `tx` stayed constant and the compiler emitted no HasMove
  `PlaceObject2` on the in-between frames, so the object never moved. No-op for the common
  transform-based tween (and for symbol/text instances, whose origin is the registration point).
- **Frame scripts emit a `DoAction` regardless of `isKeyframe` (task 1216).** The SWF runtime
  executes a `DoAction` on whatever frame it sits, and a tween in-between frame can legitimately
  carry a script (e.g. a `stop()` parked mid-tween). The compiler (`frames.ts`, `sprite.ts`)
  emits the script for any frame whose `script` is non-empty; gating on `isKeyframe` silently
  dropped these and the movie never stopped on that frame. Gate: `ruffle-oracle-defects.test.ts`.
- Shape tweening requires point-correspondence solving honoring shape hints, then emitting
  morph data for SWF and interpolated geometry for the live stage.
- **Tint color-effect interpolation must not fade through black when one keyframe has no
  color effect (task 1397).** In `tween/interpolate.ts` `interpolateColorEffect`, a `'none'`
  side carries no `tintColor` of its own, so the missing endpoint HOLDS the other side's
  color and only `tintAmount` ramps. Lerping the color black→target instead (the old default
  of `{0,0,0}`) gave a `'none'`→red tween a mid-point of `(128,0,0)` @ 50% amount — a ~63/255
  color error — instead of red @ 50%. Both sides being tint still lerps both colors.
- **Shape hints must preserve curve control points, not facet the morph into a polyline
  (task 1397).** `reorderPathByAnchor` (`tween/interpolate.ts`) rotates a closed path so the
  hint-anchored vertex is index 0. It now treats the path as a cyclic list of edges and
  rotates the edge payloads (line/curve, control points intact) instead of rebuilding every
  edge as a straight `line`. DefineMorphShape2 (tag 84) emits real curve records, so the old
  "morphshape uses line segments anyway" flattening silently faceted both shapes whenever a
  shape hint was enabled on a curved morph. Gate: `shapehint-interpolation.test.ts`
  ("preserve curves").
- Timeline Effects are macros that expand into the document model (symbols + tweens) so they
  round-trip and remain re-editable.
