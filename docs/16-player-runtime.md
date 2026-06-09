# 16 — Player Runtime

How compiled content plays back — the model the authoring stage and the test player both
follow. Target behavior = **Flash Player 8**.

## Display model

- **Display list** — the ordered set of objects currently on screen, keyed by **depth**.
  Higher depth renders on top. Depths are per-timeline.
- **Characters & dictionary** — definitions (shapes, sprites, buttons, bitmaps, fonts) are
  instantiated onto the display list by control tags / ActionScript.
- **Timelines & playhead** — main timeline + each MovieClip's timeline advance per frame;
  Graphic symbols are slaved to the parent playhead.
- **Levels** — `_levelN` stacked documents; `_root` per level.
- **Coordinate space** — twips internally; per-object transform matrix (translate/scale/
  rotate/skew) + color transform; nested concatenation.

## Frame lifecycle (per tick)

Match Flash Player 8 ordering precisely:

1. Advance playheads / enter new frames as scheduled by frame rate.
2. Execute frame actions and run clip events (`enterFrame`, etc.) in Flash's order.
3. Process timers/intervals, input events, and listeners.
4. Apply tweens/animation state.
5. Render the display list (with filters, blends, masks, caching).

- **Frame rate** is a target; under load, frames may be skipped but timeline logic stays
  consistent with Flash's catch-up rules.

## Rendering

- Vector rasterization with anti-aliasing; strokes (caps/joins/scaling); gradients; bitmap
  fills with smoothing; **masks** (clip depth); **filters** + **blend modes** (`08`);
  **runtime bitmap caching** (`07`); color transforms; `scrollRect`; 9-slice.
- Quality settings: Low / Medium / High / Best (affect AA / bitmap smoothing).

## Interactivity & input

- Mouse + keyboard routed to buttons/MovieClips per hit-testing (button **Hit** state,
  `MovieClip` mouse events), focus management, `Selection`, context menu, `Mouse`/`Key`.
- Drag (`startDrag`/`stopDrag`), `hitTest`, tab order.

## Security & I/O

- Flash Player 8 **local-file security sandbox** (local-with-filesystem vs
  local-with-network vs trusted); cross-domain policy for network loads.
- Local storage via **`SharedObject`**; networking via `LoadVars`/`XML`/`XMLSocket`/
  `NetConnection`; `ExternalInterface`/`fscommand` to the host.

## Our runtime strategy

- **Test/playback engine**: embed **Ruffle** (wasm) as the proven AVM1 player for
  `Test Movie` and final SWF verification.
- **Authoring live preview**: our own scene graph + AVM1 interpreter renders/animates while
  editing (so scripts and tweens run on the editable model without a publish step).
- Both paths are validated against **Flash Player 8 reference captures** (golden frames).

## Accuracy targets

- Depth/display-list semantics, `swapDepths`/`getNextHighestDepth`, clip-depth masking.
- Frame execution order and timing (the source of most playback bugs in clones).
- Hit-testing, event propagation, focus, and drag behavior.
- Security sandbox classifications and cross-domain rules (where applicable on web/desktop).

## Implementation notes

- The render engine is shared between authoring stage and live preview; GPU passes per `00`.
- Ruffle integration: load published SWF bytes into the Ruffle player instance for Test Movie;
  surface its logs/errors in the Output panel.
- Maintain a compatibility test matrix: our renderer vs Ruffle vs (archived) Flash Player 8.
