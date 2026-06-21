/**
 * Generic per-field projection of a plain object onto a Y.Map.
 *
 * "Scalar/atomic" fields (everything that is not an explicit structural child
 * such as `scenes`/`layers`/`frames`/`displayObjects`/`timeline`/`library`) are
 * stored one Y.Map entry per field. The VALUE of each entry is a deep-cloned
 * plain-JSON value, so:
 *   - two peers editing DIFFERENT fields of the same node merge cleanly
 *     (per-field last-writer-wins), and
 *   - a field whose value is itself an object/array (e.g. `shape`, `filters`,
 *     `colorEffect`, `flaItemId`, `sound`) is ATOMIC: a whole-value
 *     last-writer-wins, which is exactly the spec's requirement for geometry and
 *     other id-less aggregates.
 *
 * `undefined`/absent fields are represented by the ABSENCE of the key. The diff
 * deletes a key when the field disappears and (re)sets it when it changes,
 * comparing with structural JSON equality so an unchanged atomic value never
 * churns the CRDT.
 */
import * as Y from "yjs";
import { cloneJson, jsonEqual, type Json } from "./json.js";

/** Materialize an object's atomic fields (excluding `structuralKeys`) into `ymap`. */
export function materializeFields(
  ymap: Y.Map<unknown>,
  source: Record<string, unknown>,
  structuralKeys: ReadonlySet<string>,
): void {
  for (const key of Object.keys(source)) {
    if (structuralKeys.has(key)) continue;
    const value = source[key];
    if (value === undefined) continue;
    ymap.set(key, cloneJson(value as Json));
  }
}

/**
 * Diff the atomic fields of `next` against `prev` and apply the minimal set of
 * `ymap.set` / `ymap.delete` calls. `prev` may be `undefined` (treated as "no
 * prior fields"). Structural keys are skipped — the caller handles those.
 *
 * Returns true if any change was applied.
 */
export function diffFields(
  ymap: Y.Map<unknown>,
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
  structuralKeys: ReadonlySet<string>,
): boolean {
  let changed = false;

  // Upsert present fields.
  for (const key of Object.keys(next)) {
    if (structuralKeys.has(key)) continue;
    const value = next[key];
    if (value === undefined) {
      if (ymap.has(key)) {
        ymap.delete(key);
        changed = true;
      }
      continue;
    }
    const prevValue = prev?.[key];
    // Fast path: identical reference AND already present in Y => skip. When prev
    // is undefined or the reference differs we fall through to a value compare so
    // we never write an equal value (avoids CRDT churn / spurious updates).
    if (prevValue === value && ymap.has(key)) continue;
    if (ymap.has(key) && jsonEqual(ymap.get(key), value)) continue;
    ymap.set(key, cloneJson(value as Json));
    changed = true;
  }

  // Delete fields that vanished.
  for (const key of [...ymap.keys()]) {
    if (structuralKeys.has(key)) continue;
    if (!(key in next) || next[key] === undefined) {
      ymap.delete(key);
      changed = true;
    }
  }

  return changed;
}

/**
 * Rebuild the atomic (non-structural) fields of a node from `ymap` into a plain
 * object. Structural keys are skipped — the caller fills those in. Values are
 * deep-cloned so the rebuilt document shares no reference with Yjs storage.
 */
export function rebuildFields(
  ymap: Y.Map<unknown>,
  structuralKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ymap.keys()) {
    if (structuralKeys.has(key)) continue;
    // `cloneJson` returns `undefined` for a malformed (e.g. live Yjs-type) value
    // that a hostile peer stored in this atomic slot — drop the key entirely so
    // an absent/garbage field rebuilds as ABSENT, never as `undefined`.
    const cloned = cloneJson(ymap.get(key) as Json);
    if (cloned !== undefined) out[key] = cloned;
  }
  return out;
}
