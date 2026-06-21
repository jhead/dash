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

/**
 * Max recursion depth for the deep clone. An atomic field value is plain JSON,
 * which is shallow in practice (geometry / filter lists). The bound exists purely
 * as a hostile-input guard so a pathological / cyclic payload reaching the clone
 * can never blow the JS stack. Kept equal to `validate.ts`'s `MAX_VALUE_DEPTH`
 * (the inbound-validation depth bound from task 1350) so the two limits agree —
 * a value the validator would truncate at depth 64 the clone also stops at 64.
 */
export const MAX_CLONE_DEPTH = 64;

/**
 * Is `value` an ordinary plain-JSON container — a `{}`-style object (prototype is
 * `Object.prototype` or null) — as opposed to a class instance? A Yjs collaborative
 * type (Y.Map / Y.Array / Y.Text), which a hostile/buggy peer can store as the value
 * of an "atomic" field, is a class instance whose internal item graph is CYCLIC, so
 * naively recursing into it stack-overflows. We must NEVER walk one. Arrays are handled
 * by the caller; this is only consulted for non-array objects. Yjs-free by design:
 * `json.ts` carries no `yjs` dependency, so we discriminate structurally rather than
 * with `instanceof Y.AbstractType`.
 */
function isPlainJsonObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Structural deep clone of a plain-JSON value (no Uint8Array / class support).
 *
 * HARDENED against non-plain-JSON values (task 1351): the atomic-field slots this
 * runs over are UNTRUSTED — a peer can store a live Y.Map/Y.Array/Y.Text (or any
 * other class instance) there. Such a value is NOT plain JSON; cloning it would
 * recurse through Yjs's cyclic internal graph and throw "Maximum call stack size
 * exceeded", crashing `rebuildDoc` (and the binding's inbound observer) BEFORE the
 * inbound validator ever runs. We therefore DROP any non-plain-object (return
 * `undefined`, which callers treat as an absent value) and cap recursion depth.
 * A well-formed doc only ever stores plain JSON atomically, so valid-doc behaviour
 * is unchanged (identity).
 */
export function cloneJson<T>(value: T): T {
  return cloneJsonAt(value, 0) as T;
}

function cloneJsonAt(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== "object") {
    // function / symbol / bigint are not valid JSON; drop them so a hostile
    // value of those kinds never reaches the model.
    const t = typeof value;
    if (t === "function" || t === "symbol" || t === "bigint") return undefined;
    return value;
  }
  if (depth >= MAX_CLONE_DEPTH) {
    // Hostile / pathologically nested payload — stop before the stack does.
    return undefined;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const v of value) {
      const c = cloneJsonAt(v, depth + 1);
      out.push(c === undefined ? null : c); // arrays keep length; hole -> null
    }
    return out;
  }
  // A class instance (e.g. a live Yjs type) is NOT plain JSON and must never be
  // walked — its internal graph is cyclic. Drop it.
  if (!isPlainJsonObject(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    const v = (value as Record<string, unknown>)[k];
    if (v === undefined) continue; // never carry `undefined` keys
    const c = cloneJsonAt(v, depth + 1);
    if (c === undefined) continue; // dropped (Y-type / over-depth / non-JSON)
    out[k] = c;
  }
  return out;
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
