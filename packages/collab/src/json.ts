/**
 * Plain-JSON value helpers shared by the Yjs binding.
 *
 * The FlashDocument model is (with the single documented exception of the
 * import-only `flaSwfBlobs[].bytes` Uint8Array) entirely plain-JSON: objects,
 * arrays, strings, numbers, booleans and `null`. The binding stores "atomic"
 * sub-values (geometry, filter lists, color effects, …) as ordinary JS values
 * inside Y.Map entries; Yjs serializes them verbatim and returns them by value.
 *
 * Two invariants the binding relies on:
 *   1. We never store `undefined` in a Y container — an absent optional field is
 *      represented by the ABSENCE of its key, not a key holding `undefined`.
 *      This is what makes the round-trip deep-equal: `{x:1}` must rebuild to
 *      `{x:1}`, never `{x:1, y:undefined}`.
 *   2. Atomic values are deep-cloned on the way in and on the way out so the
 *      rebuilt document never shares a mutable reference with the source doc or
 *      with Yjs's internal storage.
 */

/** A value that can be stored atomically inside a Y.Map entry. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json };

/** Structural deep clone of a plain-JSON value (no Uint8Array / class support). */
export function cloneJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => cloneJson(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    const v = (value as Record<string, unknown>)[k];
    if (v === undefined) continue; // never carry `undefined` keys
    out[k] = cloneJson(v);
  }
  return out as unknown as T;
}

/**
 * Strict structural equality for plain-JSON values. Treats a key holding
 * `undefined` as absent (so `{a:1}` deep-equals `{a:1, b:undefined}`), matching
 * how the binding drops `undefined` fields. Order of object keys is irrelevant;
 * array order is significant.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return a === b;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!jsonEqual(ao[k], bo[k])) return false;
  }
  return true;
}
