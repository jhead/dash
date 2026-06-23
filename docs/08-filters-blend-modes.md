# 08 — Filters & Blend Modes (Flash Professional 8)

Real-time visual effects introduced in Flash 8 Pro. Applied to **MovieClips**, **Buttons**,
and **text** (filters); **blend modes** apply to MovieClips (and buttons). Both render at
runtime in Flash Player 8.

## Filters

Applied/stacked via the **Filters** tab in the Property inspector. Multiple filters per
object, reorderable; each can be enabled/disabled, copied/pasted, and saved as a **preset**.
Filters require the object to be cached as a bitmap (auto-enabled).

The seven filters and their parameters:

| Filter | Key parameters |
|--------|----------------|
| **Drop Shadow** | blur X/Y, strength, quality, angle, distance, color, **Knockout**, **Inner shadow**, **Hide object** |
| **Blur** | blur X/Y, quality (low/medium/high) |
| **Glow** | blur X/Y, strength, quality, color, **Knockout**, **Inner glow** |
| **Bevel** | blur X/Y, strength, quality, shadow & highlight color, angle, distance, knockout, type (inner/outer/full) |
| **Gradient Glow** | blur X/Y, strength, quality, angle, distance, **gradient** (multi-stop), knockout, type |
| **Gradient Bevel** | blur X/Y, strength, quality, angle, distance, **gradient**, knockout, type |
| **Adjust Color** | **Brightness, Contrast, Saturation, Hue** |

- **Quality** affects render passes (more passes = smoother, slower).
- Filters map to the SWF filter list on `PlaceObject` (e.g. DropShadowFilter, BlurFilter,
  GlowFilter, BevelFilter, GradientGlowFilter, ConvolutionFilter, ColorMatrixFilter,
  GradientBevelFilter) and the ActionScript `flash.filters.*` classes.

### Animating filters
- Filters can be **motion-tweened** (Pro); parameters interpolate across the tween.
- If a filter exists on one keyframe but not the other, Flash adds a matching disabled filter
  so the tween is well-defined. This matching behavior must be reproduced.

## Blend modes

Applied to a MovieClip/button via the Property inspector. The 14 author-exposed modes:

`Normal, Layer, Darken, Multiply, Lighten, Screen, Overlay, Hardlight, Add, Subtract,
Difference, Invert, Alpha, Erase`

Notes on the special modes:

- **Layer** — composites the clip's children together before blending (needed for Alpha/Erase
  to act on a group).
- **Alpha** — applies the clip's alpha as a mask to the parent (requires parent set to Layer).
- **Erase** — removes the parent's pixels where the clip is opaque (requires parent Layer).
- Others (Multiply/Screen/Overlay/etc.) match Photoshop/Fireworks compositing math.

Blend modes map to the SWF `PlaceObject3` blend-mode field and `MovieClip.blendMode`.

## Importing from Fireworks
- Importing Fireworks PNG can bring filters (effects) and blend modes in editable form.

## Performance
- Filters/caching are GPU-friendly but costly at high quality; Flash 8 warns about overuse.
  Our renderer should expose the same quality levels and keep cached results until inputs
  change.

## Accuracy targets

- All 7 filters with exact parameter ranges, knockout/inner/hide-object behaviors.
- Filter motion-tween interpolation and the missing-filter matching rule.
- All 14 blend modes producing pixel-matched output vs Player 8 (esp. Layer/Alpha/Erase
  grouping semantics).
- SWF filter/blend serialization round-trips.

## Implementation notes

- Each filter = one or more **render-to-texture shader passes** over the clip's cached
  bitmap: separable Gaussian blur for blur/shadow/glow; gradient ramps for gradient
  glow/bevel; a 4×5 **color matrix** for Adjust Color; bevel via blurred height/edge masks.
- **Gradient Glow / Gradient Bevel** carry a multi-stop gradient (per stop: color +
  alpha + ratio 0–255). The authoring **FiltersPanel** exposes an inline stop editor
  (add/remove stops, edit color/alpha/ratio per stop) alongside blurX/blurY/strength/
  quality/angle/distance/knockout/type. The Canvas-2D **stage preview** approximates the
  gradient by blending ACROSS every stop, not just the brightest one: Gradient Glow draws
  one glow shadow pass per stop with the blur radius scaled by the stop's ratio (low ratio
  = tight inner halo, high ratio = wide outer halo, widest painted first); Gradient Bevel
  splits the stops at the 0.5 ratio midpoint — stops below drive the shadow side, stops at
  or above drive the highlight side — and layers each side's stops from the edge inward.
  Fully transparent stops (alpha 0) contribute no pass. The exact (GPU render-to-texture)
  gradient ramp remains the stretch goal; the SWF encoder is exact.
- **SWF serialization** writes GRADIENTGLOWFILTER (FilterID 4) and GRADIENTBEVELFILTER
  (FilterID 7) through **PlaceObject3** (tag 70): `numColors`, then all RGBA stop colors,
  then all ratio bytes, then blurX/blurY/angle/distance (FIXED16) + strength (FIXED8) +
  a flags byte (inner=bit7, knockout=bit6, compositeSource=bit5, onTop=bit4 for the
  "full"/ON_TOP bevel, passes/quality=bits 0-3). Round-tripped by `filters.test.ts`.
- **PlaceObject3 flag word is a single LITTLE-ENDIAN u16** (`flags1` = low byte, `flags2`
  = high byte); flags2 bit N is combined PlaceFlag bit (8+N). Per Ruffle's swf crate
  (`swf/src/types.rs PlaceFlag`): **HasFilterList = 1<<8 = flags2 bit 0 (0x01)**,
  HasBlendMode = 1<<9 (0x02), HasCacheAsBitmap = 1<<10 (0x04), HasClassName = 1<<11
  (0x08), **HasImage = 1<<12 = flags2 bit 4 (0x10)**. HasFilterList is therefore 0x01, NOT
  0x10 — emitting 0x10 sets HasImage instead, and the swf crate (= the runtime) decodes
  `filters=None` and silently drops the entire FILTERLIST (task 1238). The encoders live in
  `packages/swf/src/filters.ts` (`encodePlaceObject3WithFilters` /
  `…WithBlendMode`); the Ruffle-faithful u16 decode is asserted in `filters.test.ts`.
- **DisplacementMapFilter is NOT a SWF PlaceObject filter, and is never emitted (task
  1239)**: the SWF FILTERLIST defines filter IDs 0–7 only (0 DropShadow / 1 Blur / 2 Glow /
  3 Bevel / 4 GradientGlow / 5 Convolution / 6 ColorMatrix / 7 GradientBevel).
  `DisplacementMapFilter` is an AS3 / Flash Player 9+ *runtime-only* filter
  (`flash.filters.DisplacementMapFilter`) with no Flash 8 SWF tag form and no FilterID. The
  encoder used to emit it as **FilterID=8**, which Ruffle's `swf` crate rejects as "Invalid
  filter type" — and crucially that rejection makes the swf crate decode `filters = None`
  for the **entire** PlaceObject3, silently dropping *every* (otherwise valid) filter on
  that instance, not just the displacement one. So a blur + displacement stack lost the blur
  too. **Fix:** `packages/swf/src/filters.ts` now skips any filter that has no valid
  FILTERLIST id when building the list (`isSwfEncodableFilter` / `encodableFilters`), with a
  dev-facing `console.warn`. Only encodable filters count toward `FilterCount`, the
  `HasFilterList` flag, and the PlaceObject2-vs-PlaceObject3 routing (`hasEnabledFilters`),
  so a lone displacement emits no FILTERLIST at all and a displacement-mixed-with-blur emits
  just the blur (count = 1, FilterID = 1) and parses cleanly at runtime. The vestigial
  FilterID=8 encode path (`writeDisplacementMapFilter`) was removed — displacementMap is also
  unreachable from the authoring model/UI (no FiltersPanel entry, no FLA-import decoder, no
  tween interpolation), so nothing constructs one in practice. Gate:
  `__tests__/displacement-filter.test.ts`.
- **A shape carrying BOTH a filter and a non-normal blendMode must emit ONE PlaceObject3
  with HasFilterList AND HasBlendMode (task 1240, follow-up to 1238).** A
  `ShapeDisplayObject` has independent optional `blendMode` and `filters` fields, so a raw
  shape can have both set. The `compiler/frames.ts` initial-placement branch used to test
  `hasEnabledFilters()` FIRST and emit a filters-only PlaceObject3
  (`encodePlaceObject3WithFilters`, which writes no blend byte); the shape blend-mode branch
  was `else if`, only reachable with no filters — so a shape with both silently DROPPED the
  blend (byte-confirmed: shape PO3 had `filters:[…]` and no `blendMode`, vs the instance PO3
  which had both). `encodePlaceObject3WithBlendMode` already accepts an optional `filters`
  arg and writes the **FILTERLIST then the blend-mode byte** (SWF PlaceObject3 field order:
  filters precede blend mode), so the fix is purely call-site routing: the two shape branches
  were unified into one (gated on `hasEnabledFilters || non-normal blendMode`) that, when a
  blend is present, calls `encodePlaceObject3WithBlendMode(charId, depth, x, y, blendMode,
  filters, …)` to carry both — mirroring the already-correct instance path in the same file.
  Filters-only and blend-only fall through to the matching single-feature encoder. The
  frames.ts shape MOVE branch was already correct (it checks `hasBlend` first and passes the
  filter list). Gates: `__tests__/blendmode.test.ts` tests 7–9 (shape filter+blend → one PO3
  with both flags + correct blend byte + intact FILTERLIST; filters-only and blend-only stay
  correct; encoder writes filters before the blend byte).
- **Ruffle-pinned multi-flag PlaceObject combos (task 1372).** Field-order/flag-co-occurrence
  on PlaceObject2/3 has regressed before (1238 dropped HasFilterList; 1240 dropped HasBlendMode
  on the scene shape path; 1349 dropped HasName/HasClipActions), and per CLAUDE.md the Ruffle
  oracle — not byte-presence — is the acceptance truth. `apps/desktop/e2e/multiflag-placeobject-1372.spec.ts`
  now pins these combinations in REAL bundled Ruffle:
  - **(a) SCENE shape with blendMode≠normal + enabled filters + cacheAsBitmap** → one
    PlaceObject3 with HasBlendMode+HasFilterList+HasCacheAsBitmap. Asserted structurally
    (decoded in encoder field order FILTERLIST→BlendMode→is_bitmap_cached, via the
    multi-flag-aware decoder in `apps/desktop/e2e/helpers/swf-parse.ts`) AND by a pixel oracle
    (glow halo renders, no Ruffle parse error). **PASSING / pinned.**
  - **(b) INSTANCE MOVE carrying blend+filters on its PlaceObject3 alongside a SEPARATE clip
    whose Move keeps clipActions** → the onClipEvent(enterFrame) fires after the move (trace)
    AND the moved blend+filter clip renders its glow halo (pixel). **PASSING / pinned.**
  - **(c) SYMBOL-INTERNAL (sprite.ts) shape with blend+filters+cacheAsBitmap** — mirrors (a)
    at the DefineSprite level. **OPEN BUG, see below.**
- **OPEN BUG (filed by task 1372, oracle-confirmed, NOT yet fixed): the SPRITE-INTERNAL shape
  FIRST-PLACEMENT path drops HasBlendMode when filters are present.** This is the exact 1240
  defect, never fixed in `packages/swf/src/sprite.ts`. The sprite shape first-placement branch
  (`sprite.ts` ~line 752) tests `hasEnabledFilters()` FIRST and emits a filters-only
  `encodePlaceObject3WithFilters` (no blend byte); the blend branch is the unreachable `else if`
  — so a symbol-internal shape with BOTH a non-normal blendMode AND filters silently DROPS the
  blend. It is runtime-observable in Ruffle: a red shape + `multiply` blend + glow over a cyan
  backdrop renders BLACK via the scene path (correct) but plain RED via the sprite path (blend
  dropped). The sprite shape MOVE branch (`sprite.ts` ~line 995) is already correct (it checks
  `hasShapeBlend` first and passes the filter list) — so the fix mirrors that branch and the
  scene path: reorder the sprite first-placement branch to call
  `encodePlaceObject3WithBlendMode(charId, depth, x, y, blendMode, filters, …)` when a
  non-normal blend is present. Pinned by `multiflag-placeobject-1372.spec.ts`: test `(c)` is
  `test.fixme` (the regression oracle that goes green on fix — remove `.fixme` then), and test
  `(c-bug)` is ACTIVE and asserts the CURRENT wrong behaviour (sprite PO3 lacks HasBlendMode;
  interior renders red not multiplied) so the open defect stays audited until fixed (invert it
  on fix). Per task 1372/CLAUDE.md the byte logic was NOT patched without a separate triaged
  task. Follow-up task: `1373-*` (sprite-internal blend+filters PlaceObject3 blend drop).
- Blend modes = GPU blend-state + custom fragment composites; Layer forces an offscreen group
  buffer so Alpha/Erase operate on the composited group.
- Keep a filter/blend pipeline cache keyed on parameters + source bitmap hash.
