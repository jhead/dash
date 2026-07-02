/**
 * Shared per-placement color-effect helpers (task 1375).
 *
 * A whole class of "place-vs-move asymmetry" bugs came from the first-placement
 * emit path handling an effect (colorEffect / visible=false / standalone alpha)
 * that the posChanged/Move re-emit path silently dropped. Because a motion tween
 * makes `posChanged` fire on EVERY frame, the effect was lost for the entire
 * tween (e.g. a bitmap filter tween or a shape tint tween reverted after frame 1).
 *
 * Both the scene timeline (`compiler/frames.ts`) and the symbol-internal sprite
 * builder (`sprite.ts`) now compute the CXFORMWITHALPHA a placement needs via the
 * SAME helper here, so first-placement and MOVE re-emit stay symmetric.
 */
import type { ColorEffect } from "@flash/core";
import { colorEffectToCXForm, type CXForm } from "./cxform.js";

/** A fully-transparent color transform (alphaMult=0), used for visible=false. */
function zeroAlphaCXForm(): CXForm {
  return {
    redMult: 256,
    greenMult: 256,
    blueMult: 256,
    alphaMult: 0,
    redAdd: 0,
    greenAdd: 0,
    blueAdd: 0,
    alphaAdd: 0,
  };
}

/** A CXForm that only scales the alpha channel (redMult=... =256, no add terms). */
export function alphaMultCXForm(alpha: number): CXForm {
  return {
    redMult: 256,
    greenMult: 256,
    blueMult: 256,
    alphaMult: Math.round(Math.max(0, Math.min(1, alpha)) * 256),
    redAdd: 0,
    greenAdd: 0,
    blueAdd: 0,
    alphaAdd: 0,
  };
}

/**
 * Compute the CXFORMWITHALPHA a placement needs for its per-placement color
 * effects, applying the standard SWF precedence:
 *
 *   colorEffect  >  visible === false (→ zero alpha)  >  standalone alpha != 1
 *
 * Returns `null` when none apply (the caller emits a plain placement). A
 * `colorEffect` that resolves to identity (`colorEffectToCXForm` → null, e.g. a
 * `type:"none"` effect) falls through to visible/alpha, matching the inline
 * precedence the emit paths previously duplicated.
 */
export function effectCXForm(o: {
  colorEffect?: ColorEffect | null;
  visible?: boolean;
  alpha?: number;
}): CXForm | null {
  if (o.colorEffect) {
    const ce = colorEffectToCXForm(o.colorEffect);
    if (ce !== null) return ce;
  }
  if (o.visible === false) return zeroAlphaCXForm();
  if (o.alpha !== undefined && o.alpha !== 1) return alphaMultCXForm(o.alpha);
  return null;
}
