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
- **DisplacementMapFilter is NOT a SWF PlaceObject filter**: the SWF FILTERLIST defines
  filter IDs 0–7 only (DropShadow/Blur/Glow/Bevel/GradientGlow/Convolution/ColorMatrix/
  GradientBevel). DisplacementMap is an AS3-runtime-only filter; emitting it into a SWF
  FILTERLIST (our encoder uses FilterID=8) produces bytes the swf crate rejects as
  "Invalid filter type". Tracked separately from the HasFilterList bit fix.
- Blend modes = GPU blend-state + custom fragment composites; Layer forces an offscreen group
  buffer so Alpha/Erase operate on the composited group.
- Keep a filter/blend pipeline cache keyed on parameters + source bitmap hash.
