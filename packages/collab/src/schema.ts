/**
 * FlashDocument <-> Y.Doc type mapping (the derived projection).
 *
 * Direction A (materialize): build a full Y.Doc tree from a FlashDocument.
 * Direction B (diff):        reconcile an existing Y.Doc tree to a new
 *                            FlashDocument, descending only where object
 *                            references differ (structural sharing) and writing
 *                            the minimal CRDT delta.
 * Direction C (rebuild):     read a Y.Doc tree back into a fresh FlashDocument.
 *
 * The mapping (see docs/37-collab.md for the full table):
 *   root Y.Map "doc"
 *     id, accessibility, activePublishProfileId                 (atomic fields)
 *     properties    -> Y.Map (per-field entries; concurrent field edits merge)
 *     scenes        -> Y.Array<Y.Map(scene)>                    (positional)
 *     library       -> Y.Map(library)
 *     asClasses     -> Y.Map<path, Y.Text>                      (char-level)
 *     classpaths    -> Y.Array<string>
 *     publishProfiles -> Y.Array<atomic profile>
 *     flaSwfBlobs   -> Y.Array<atomic blob>  (import-only; bytes base64)
 *   scene Y.Map: id, name, flaItemId (atomic); timeline -> Y.Map
 *   timeline Y.Map: layers -> Y.Array<Y.Map(layer)>             (positional)
 *   layer Y.Map: scalars (atomic); frames -> Y.Array<Y.Map(frame)> (positional)
 *   frame Y.Map: scalars (atomic);
 *     displayObjects -> Y.Map<id, Y.Map(object)> + __order Y.Array<id>
 *   displayObject Y.Map: scalars per-field; shape/filters/colorEffect/warp/...
 *     stored ATOMICALLY (whole-value last-writer-wins).
 *   library Y.Map: items -> Y.Map<id, Y.Map(item)> + __order Y.Array<id>;
 *     folders -> Y.Array<atomic folder>
 *   library item Y.Map: scalars per-field; a Symbol's `timeline` -> Y.Map.
 */
import * as Y from "yjs";
import type { FlashDocument } from "@flash/core";
import { cloneJson, type Json } from "./json.js";
import { materializeFields, diffFields, rebuildFields } from "./ymap-fields.js";

// ---------------------------------------------------------------------------
// Structural-key sets — fields that are NOT stored as atomic Y.Map entries.
// ---------------------------------------------------------------------------

const DOC_STRUCTURAL = new Set([
  // `properties` is projected as its OWN nested Y.Map (per-field entries) so two
  // peers concurrently editing DIFFERENT doc properties (stage width vs frameRate,
  // snap toggle vs backgroundColor) merge per-field instead of clobbering the whole
  // object via a single whole-value LWW register (task 1392; docs/37 §2 table). It
  // is therefore structural at the root: the atomic field reader/writer skips it and
  // materializeDoc/diffDoc/rebuildDoc handle the nested map explicitly.
  "properties",
  "scenes",
  "library",
  "asClasses",
  "classpaths",
  "publishProfiles",
  "flaSwfBlobs",
  // Presence companion keys for the optional Y.Array root containers (task 1360).
  // Treated as structural so the atomic field reader/writer never materializes,
  // diffs, or rebuilds them as model fields — they are pure CRDT bookkeeping.
  "classpaths__present",
  "publishProfiles__present",
  "flaSwfBlobs__present",
]);
// `properties` is projected as a nested Y.Map whose OWN fields are all atomic
// per-field entries. A field whose value is itself an object/array (`grid`,
// `guides`) is one deep-cloned whole-value register (whole-value LWW) exactly as
// the per-field rule prescribes; scalar fields (`width`/`height`/`frameRate`/
// `backgroundColor`/`snapTo*`/…) each get their own entry, so concurrent edits to
// distinct fields converge with no loss.
const PROPERTIES_STRUCTURAL = new Set<string>();
const SCENE_STRUCTURAL = new Set(["timeline"]);
const LAYER_STRUCTURAL = new Set(["frames"]);
const FRAME_STRUCTURAL = new Set(["displayObjects"]);
const DISPLAY_OBJECT_STRUCTURAL = new Set<string>(); // all fields atomic per spec
const SYMBOL_STRUCTURAL = new Set(["timeline"]);
const EMPTY_STRUCTURAL = new Set<string>();

/** Key under which a keyed Y.Map's deterministic order array lives. */
const ORDER_KEY = "__order";

/**
 * Presence sentinel inside an EAGERLY pre-created optional root container.
 *
 * == Why this exists (task 1360 — concurrent-genesis root-key LWW) ==
 * An optional root container (`asClasses`, `classpaths`, `publishProfiles`,
 * `flaSwfBlobs`) starts UNDEFINED on a fresh `createDocument()`. If the binding
 * created the container lazily on first use — `root.set("asClasses", new Y.Map())`
 * — two peers that FIRST-CREATE the same absent root key concurrently each mint
 * their own container and Yjs resolves the conflicting ROOT-MAP-KEY writes by
 * LAST-WRITER-WINS: the loser's whole container (the class they just added) is
 * silently discarded. The race is the container INSTANTIATION on a root key, not
 * member adds once the container exists (those merge — the always-present
 * `library` regime).
 *
 * FIX: the container is created ONCE, deterministically, at genesis/materialize
 * (`ensureOptionalContainer`) so the root key exists from the first synced state
 * BEFORE any peer edits. Subsequent first-adds are then sub-key writes
 * (`container.set(path, …)` / `yarr.insert(…)`) which merge, never a root-key
 * LWW. The container is NEVER deleted (deleting the key would re-open the same
 * race on a later re-add); to represent an absent OR present-empty model field we
 * instead toggle this sentinel:
 *   - `__present` absent / not `true`  => the model field is ABSENT (rebuild ->
 *     `undefined`), even though the empty container exists in Y. This preserves
 *     the P0 round-trip identity: a doc with no `asClasses` rebuilds with no
 *     `asClasses`, not a spurious `[]`.
 *   - `__present === true`              => the model field is PRESENT (rebuild ->
 *     its entries, possibly `[]` after removing the last class).
 * The sentinel is an idempotent boolean LWW on the SAME container that exists
 * from genesis, so two peers both turning it `true` converge with no loss.
 */
const PRESENT_KEY = "__present";

/** The single root key on the Y.Doc holding the projected document. */
export const ROOT_KEY = "doc";

/**
 * Get-or-create an optional root CONTAINER (a Y.Map or Y.Array) under `key`,
 * WITHOUT a root-key LWW on a concurrent first-creation. Idempotent: if a peer
 * (or our own genesis) already created it, the existing instance is returned
 * untouched, so two peers calling this in concurrent transactions both observe a
 * single converged container. The container is created with NO `__present`
 * sentinel, i.e. it reads back as an absent model field until a real value marks
 * it present (see {@link PRESENT_KEY}).
 */
function ensureOptionalMap(root: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const existing = root.get(key);
  if (existing instanceof Y.Map) return existing;
  const container = new Y.Map();
  root.set(key, container);
  return container;
}
function ensureOptionalArray(root: Y.Map<unknown>, key: string): Y.Array<unknown> {
  const existing = root.get(key);
  if (existing instanceof Y.Array) return existing;
  const container = new Y.Array();
  root.set(key, container);
  return container;
}

/**
 * Mark a Y.Map optional container present/absent via an INTERNAL `__present` key.
 * Idempotent LWW: two peers both setting it `true` write the same value on the
 * SAME shared container key, so they converge with no loss or duplication.
 */
function setMapPresence(container: Y.Map<unknown>, present: boolean): void {
  if (present) {
    if (container.get(PRESENT_KEY) !== true) container.set(PRESENT_KEY, true);
  } else if (container.has(PRESENT_KEY)) {
    container.delete(PRESENT_KEY);
  }
}

/**
 * Presence companion ROOT key for an optional Y.Array container. A Y.Array has no
 * place for an internal sentinel: a marker element at index 0 is NOT idempotent —
 * two peers concurrently inserting their own marker both land (the index-0 insert
 * does not deduplicate), so the marker would double. A SCALAR boolean root key is
 * idempotent LWW (both peers set the same value), so it converges cleanly.
 */
function arrayPresenceKey(key: string): string {
  return `${key}${PRESENT_KEY}`;
}
function setArrayPresence(root: Y.Map<unknown>, key: string, present: boolean): void {
  const pKey = arrayPresenceKey(key);
  if (present) {
    if (root.get(pKey) !== true) root.set(pKey, true);
  } else if (root.has(pKey)) {
    root.delete(pKey);
  }
}

/** Is an eagerly-created Y container marked present (model field non-undefined)? */
function isMapPresent(container: Y.Map<unknown>): boolean {
  return container.get(PRESENT_KEY) === true;
}
function isArrayPresent(root: Y.Map<unknown>, key: string): boolean {
  return root.get(arrayPresenceKey(key)) === true;
}

// ---------------------------------------------------------------------------
// flaSwfBlobs — the one non-JSON field (Uint8Array bytes). Import-only; never
// produced by a mutation. Encoded atomically so a round-trip still holds if it
// is ever present.
// ---------------------------------------------------------------------------

interface RawBlob {
  bytes: Uint8Array;
  [k: string]: unknown;
}

function blobToJson(blob: RawBlob): Json {
  const { bytes, ...rest } = blob;
  return {
    ...(cloneJson(rest) as Record<string, Json>),
    bytes: bytesToBase64(bytes),
  };
}

function jsonToBlob(value: Json): RawBlob {
  const obj = value as Record<string, Json>;
  const { bytes, ...rest } = obj;
  return {
    ...(cloneJson(rest) as Record<string, unknown>),
    bytes: base64ToBytes(bytes as string),
  } as RawBlob;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa is available in browser/Tauri; Buffer fallback for Node.
  return typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(bytes).toString("base64");
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// ---------------------------------------------------------------------------
// Positional Y.Array<Y.Map> reconcile (scenes / layers / frames).
// ---------------------------------------------------------------------------
//
// Identity is positional (the spec keeps these arrays id-less at the Y level).
// We reconcile by index so the existing Y.Map child is reused where possible —
// this preserves per-field CRDT state for an in-place edit and writes the
// minimal delta. Length growth pushes new children; shrink deletes the tail.

type Materializer<T> = (ymap: Y.Map<unknown>, value: T) => void;
type Differ<T> = (ymap: Y.Map<unknown>, prev: T | undefined, next: T) => void;
type Rebuilder<T> = (ymap: Y.Map<unknown>) => T;

function reconcilePositional<T>(
  yarr: Y.Array<Y.Map<unknown>>,
  prev: readonly T[] | undefined,
  next: readonly T[],
  materialize: Materializer<T>,
  diff: Differ<T>,
): void {
  // In-place per-index reconcile for the overlapping range.
  const overlap = Math.min(yarr.length, next.length);
  for (let i = 0; i < overlap; i++) {
    const prevItem = prev?.[i];
    const nextItem = next[i];
    if (prevItem !== undefined && prevItem === nextItem) continue; // unchanged ref
    diff(yarr.get(i), prevItem, nextItem);
  }
  // Grow: append fresh children, integrating each BEFORE materializing into it.
  if (next.length > yarr.length) {
    const startLen = yarr.length;
    const fresh: Y.Map<unknown>[] = [];
    for (let i = startLen; i < next.length; i++) fresh.push(new Y.Map());
    yarr.push(fresh); // integrate all
    for (let i = startLen; i < next.length; i++) materialize(yarr.get(i), next[i]);
  } else if (next.length < yarr.length) {
    // Shrink: drop the tail.
    yarr.delete(next.length, yarr.length - next.length);
  }
}

function rebuildPositional<T>(
  yarr: Y.Array<Y.Map<unknown>>,
  rebuild: Rebuilder<T>,
): T[] {
  const out: T[] = [];
  for (let i = 0; i < yarr.length; i++) out.push(rebuild(yarr.get(i)));
  return out;
}

// ---------------------------------------------------------------------------
// Keyed Y.Map<id, Y.Map> + order array reconcile (displayObjects / library items)
// ---------------------------------------------------------------------------

function reconcileKeyed<T extends { id: string }>(
  parent: Y.Map<unknown>,
  containerKey: string,
  prev: readonly T[] | undefined,
  next: readonly T[],
  materialize: Materializer<T>,
  diff: Differ<T>,
): void {
  let container = parent.get(containerKey) as Y.Map<unknown> | undefined;
  if (!(container instanceof Y.Map)) {
    container = new Y.Map();
    parent.set(containerKey, container);
  }
  let order = container.get(ORDER_KEY) as Y.Array<string> | undefined;
  if (!(order instanceof Y.Array)) {
    order = new Y.Array<string>();
    container.set(ORDER_KEY, order);
  }

  const prevById = new Map<string, T>();
  for (const item of prev ?? []) prevById.set(item.id, item);
  const nextById = new Map<string, T>();
  for (const item of next) nextById.set(item.id, item);

  // Upsert each next item.
  for (const item of next) {
    const existing = container.get(item.id) as Y.Map<unknown> | undefined;
    const prevItem = prevById.get(item.id);
    if (existing instanceof Y.Map) {
      if (prevItem !== undefined && prevItem === item) continue; // unchanged ref
      diff(existing, prevItem, item);
    } else {
      const child = new Y.Map();
      container.set(item.id, child); // integrate BEFORE materializing into it
      materialize(child, item);
    }
  }

  // Remove items no longer present.
  for (const key of [...container.keys()]) {
    if (key === ORDER_KEY) continue;
    if (!nextById.has(key)) container.delete(key);
  }

  // Reconcile the order array to the next id sequence with a MINIMAL,
  // position-stable CRDT splice (see reconcileOrderArray). A whole-array
  // delete-all+insert-all is destructive: two peers doing it concurrently each
  // delete only the ids THEY observed and both re-insert, so a pre-existing id
  // is duplicated and a concurrently-added id can be dropped. An incremental
  // splice touches only the ids that actually changed, so concurrent appends/
  // reorders/deletes commute and converge with no loss or duplication.
  reconcileOrderArray(order, next.map((i) => i.id));
}

/**
 * Reconcile a `Y.Array<string>` of ids to `desired` using the MINIMAL set of
 * insert/delete CRDT ops, leaving every unchanged id untouched (never
 * delete+re-insert). This is the key to convergence under concurrent edits:
 *
 *  - A concurrent APPEND inserts only the peer's OWN new id at the tail; the
 *    other peer's delete pass never removes it (it's not in either's "stale"
 *    set), so both ids survive exactly once.
 *  - A concurrent REORDER moves only the ids that actually moved; an id common
 *    to both current and desired keeps its CRDT identity (no destructive churn),
 *    so Yjs merges the two splices deterministically with no duplication.
 *
 * Strategy: compute the Longest Common Subsequence (LCS) of `current` and
 * `desired`. The LCS ids stay in place. Delete every `current` id NOT in the
 * LCS (right-to-left so indices stay valid). Then insert every `desired` id NOT
 * in the LCS at its correct position (left-to-right). For a single peer this
 * yields exactly `desired`; the property-test identity is preserved.
 *
 * `desired` is assumed deduplicated (it comes from a keyed map's id list), but
 * `current` may already be corrupt (a duplicate from an earlier destructive
 * rewrite): any extra/duplicate `current` id not matched into the LCS is simply
 * deleted, so this reconcile also REPAIRS a previously-corrupted order array.
 */
function reconcileOrderArray(order: Y.Array<string>, desired: readonly string[]): void {
  const current = order.toArray();
  if (arraysEqual(current, desired)) return;

  // Mark which current/desired positions are part of the LCS (kept in place).
  const { keepCurrent, keepDesired } = lcsKeepMasks(current, desired);

  // Delete unkept current ids, right-to-left so earlier indices stay valid.
  for (let i = current.length - 1; i >= 0; i--) {
    if (!keepCurrent[i]) order.delete(i, 1);
  }

  // Insert unkept desired ids left-to-right at their target positions. After the
  // deletions the array holds exactly the LCS in order, so walking `desired` and
  // inserting each non-kept id at its running index lands every id correctly.
  let pos = 0;
  for (let j = 0; j < desired.length; j++) {
    if (keepDesired[j]) {
      pos++; // a kept id already occupies this slot
    } else {
      order.insert(pos, [desired[j]]);
      pos++;
    }
  }
}

/**
 * Longest-common-subsequence keep-masks: returns boolean arrays the length of
 * `a`/`b` marking which elements belong to one chosen LCS alignment. Classic
 * O(n·m) DP; the id arrays here are short (objects per keyframe / items per
 * library), so this is not a hotspot.
 */
function lcsKeepMasks(
  a: readonly string[],
  b: readonly string[],
): { keepCurrent: boolean[]; keepDesired: boolean[] } {
  const n = a.length;
  const m = b.length;
  const keepCurrent = new Array<boolean>(n).fill(false);
  const keepDesired = new Array<boolean>(m).fill(false);
  if (n === 0 || m === 0) return { keepCurrent, keepDesired };

  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Walk the DP to recover one alignment, marking matched positions.
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keepCurrent[i] = true;
      keepDesired[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return { keepCurrent, keepDesired };
}

/**
 * Read an `__order` id sequence defensively: drop ids that appear twice and ids
 * with no live entry in the container, and APPEND any container key missing from
 * `__order` (so a concurrently-added child whose order-insert was lost is never
 * dropped from the rebuilt document). Defense-in-depth: even if a destructive
 * rewrite ever corrupts `__order`, rebuild can neither duplicate nor lose an
 * object.
 */
function orderedKeys(container: Y.Map<unknown>, order: Y.Array<string> | undefined): string[] {
  const live = new Set<string>();
  for (const k of container.keys()) if (k !== ORDER_KEY && k !== PRESENT_KEY) live.add(k);

  const out: string[] = [];
  const seen = new Set<string>();
  if (order instanceof Y.Array) {
    for (const id of order.toArray()) {
      if (typeof id !== "string") continue;
      if (seen.has(id)) continue; // dedupe a doubled id
      if (!live.has(id)) continue; // drop an id with no live entry
      seen.add(id);
      out.push(id);
    }
  }
  // Append any live entry the order array omitted (preserve container key order
  // for determinism), so a present object is never silently absent.
  for (const id of live) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function rebuildKeyed<T>(
  parent: Y.Map<unknown>,
  containerKey: string,
  rebuild: Rebuilder<T>,
): T[] {
  const container = parent.get(containerKey) as Y.Map<unknown> | undefined;
  if (!(container instanceof Y.Map)) return [];
  const order = container.get(ORDER_KEY) as Y.Array<string> | undefined;
  const ids = orderedKeys(container, order);
  const out: T[] = [];
  for (const id of ids) {
    const child = container.get(id) as Y.Map<unknown> | undefined;
    if (child instanceof Y.Map) out.push(rebuild(child));
  }
  return out;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Plain Y.Array<atomic> reconcile (classpaths / publishProfiles / folders / blobs)
// ---------------------------------------------------------------------------

function setPlainArray(
  parent: Y.Map<unknown>,
  key: string,
  next: readonly unknown[] | undefined,
  encode: (v: unknown) => Json = (v) => cloneJson(v as Json),
): void {
  if (next === undefined) {
    if (parent.has(key)) parent.delete(key);
    return;
  }
  let yarr = parent.get(key) as Y.Array<unknown> | undefined;
  if (!(yarr instanceof Y.Array)) {
    yarr = new Y.Array();
    parent.set(key, yarr);
  }
  const encoded = next.map(encode);
  // Reconcile with a MINIMAL, position-stable splice (same CRDT rationale as the
  // keyed __order array): a whole-array delete-all+insert-all is destructive and
  // two concurrent rewrites interleave into duplicates. These arrays
  // (classpaths/publishProfiles/folders) change rarely and are usually edited by
  // one peer, but the incremental splice removes that latent corruption too.
  reconcileJsonArray(yarr, encoded);
}

/**
 * Reconcile an OPTIONAL root Y.Array container (`classpaths` / `publishProfiles`
 * / `flaSwfBlobs`) that may be ABSENT on the model. Unlike {@link setPlainArray},
 * an absent (`undefined`) field does NOT delete the root key — the eagerly
 * pre-created container is kept and merely marked not-present (see
 * {@link PRESENT_KEY} for the concurrent-genesis-LWW rationale, task 1360). The
 * presence marker occupies element 0; the real values follow it, reconciled by
 * the same minimal splice.
 */
function setOptionalPlainArray(
  root: Y.Map<unknown>,
  key: string,
  next: readonly unknown[] | undefined,
  encode: (v: unknown) => Json = (v) => cloneJson(v as Json),
): void {
  const yarr = ensureOptionalArray(root, key);
  if (next === undefined) {
    setArrayPresence(root, key, false);
    // Drop any leftover real values (an absent field has no contents).
    if (yarr.length > 0) yarr.delete(0, yarr.length);
    return;
  }
  setArrayPresence(root, key, true);
  // Reconcile the values with the same minimal, position-stable splice as
  // setPlainArray; presence is tracked on the sibling scalar key, not in-band.
  const encoded = next.map(encode);
  reconcileJsonArray(yarr, encoded);
}

/**
 * The {@link reconcileOrderArray} algorithm generalized to arbitrary JSON
 * elements compared structurally (via stable JSON stringify). Elements common to
 * `current` and `desired` keep their CRDT identity; only genuinely added/removed
 * elements are spliced. Single-peer result equals `desired` exactly.
 */
function reconcileJsonArray(yarr: Y.Array<unknown>, desired: readonly unknown[]): void {
  const currentRaw = yarr.toArray();
  if (jsonArrayEqual(currentRaw, desired)) return;

  const current = currentRaw.map((v) => JSON.stringify(v));
  const want = desired.map((v) => JSON.stringify(v));
  const { keepCurrent, keepDesired } = lcsKeepMasks(current, want);

  for (let i = currentRaw.length - 1; i >= 0; i--) {
    if (!keepCurrent[i]) yarr.delete(i, 1);
  }
  let pos = 0;
  for (let j = 0; j < desired.length; j++) {
    if (keepDesired[j]) {
      pos++;
    } else {
      yarr.insert(pos, [desired[j]]);
      pos++;
    }
  }
}

function rebuildPlainArray<T>(
  parent: Y.Map<unknown>,
  key: string,
  decode: (v: Json) => T = (v) => cloneJson(v) as T,
): T[] | undefined {
  const yarr = parent.get(key) as Y.Array<unknown> | undefined;
  if (!(yarr instanceof Y.Array)) return undefined;
  return yarr.toArray().map((v) => decode(v as Json));
}

/**
 * Rebuild an OPTIONAL root Y.Array container, honoring its presence companion
 * key: an eagerly pre-created but not-present container rebuilds to `undefined`
 * (the model field was absent), while a present container rebuilds its values,
 * possibly `[]`.
 */
function rebuildOptionalPlainArray<T>(
  root: Y.Map<unknown>,
  key: string,
  decode: (v: Json) => T = (v) => cloneJson(v) as T,
): T[] | undefined {
  const yarr = root.get(key) as Y.Array<unknown> | undefined;
  if (!(yarr instanceof Y.Array)) return undefined;
  if (!isArrayPresent(root, key)) return undefined;
  return yarr.toArray().map((v) => decode(v as Json));
}

function jsonArrayEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Node materialize / diff / rebuild — one trio per node type.
// ---------------------------------------------------------------------------

// --- displayObject (leaf with all-atomic fields) ---

function materializeDisplayObject(ymap: Y.Map<unknown>, obj: Record<string, unknown>): void {
  materializeFields(ymap, obj, DISPLAY_OBJECT_STRUCTURAL);
}
function diffDisplayObject(
  ymap: Y.Map<unknown>,
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): void {
  diffFields(ymap, prev, next, DISPLAY_OBJECT_STRUCTURAL);
}
function rebuildDisplayObject(ymap: Y.Map<unknown>): Record<string, unknown> {
  return rebuildFields(ymap, DISPLAY_OBJECT_STRUCTURAL);
}

// --- frame ---

interface FrameLike { displayObjects: readonly { id: string }[]; [k: string]: unknown }

function materializeFrame(ymap: Y.Map<unknown>, frame: FrameLike): void {
  materializeFields(ymap, frame, FRAME_STRUCTURAL);
  reconcileKeyed(
    ymap,
    "displayObjects",
    undefined,
    frame.displayObjects,
    materializeDisplayObject as Materializer<{ id: string }>,
    diffDisplayObject as Differ<{ id: string }>,
  );
}
function diffFrame(ymap: Y.Map<unknown>, prev: FrameLike | undefined, next: FrameLike): void {
  diffFields(ymap, prev, next, FRAME_STRUCTURAL);
  if (prev?.displayObjects !== next.displayObjects) {
    reconcileKeyed(
      ymap,
      "displayObjects",
      prev?.displayObjects,
      next.displayObjects,
      materializeDisplayObject as Materializer<{ id: string }>,
      diffDisplayObject as Differ<{ id: string }>,
    );
  }
}
function rebuildFrame(ymap: Y.Map<unknown>): Record<string, unknown> {
  const out = rebuildFields(ymap, FRAME_STRUCTURAL);
  out.displayObjects = rebuildKeyed(ymap, "displayObjects", rebuildDisplayObject);
  return out;
}

// --- layer ---

interface LayerLike { frames: readonly FrameLike[]; [k: string]: unknown }

function materializeLayer(ymap: Y.Map<unknown>, layer: LayerLike): void {
  materializeFields(ymap, layer, LAYER_STRUCTURAL);
  const yframes = new Y.Array<Y.Map<unknown>>();
  ymap.set("frames", yframes);
  reconcilePositional(yframes, undefined, layer.frames, materializeFrame, diffFrame);
}
function diffLayer(ymap: Y.Map<unknown>, prev: LayerLike | undefined, next: LayerLike): void {
  diffFields(ymap, prev, next, LAYER_STRUCTURAL);
  if (prev?.frames !== next.frames) {
    let yframes = ymap.get("frames") as Y.Array<Y.Map<unknown>> | undefined;
    if (!(yframes instanceof Y.Array)) {
      yframes = new Y.Array<Y.Map<unknown>>();
      ymap.set("frames", yframes);
    }
    reconcilePositional(yframes, prev?.frames, next.frames, materializeFrame, diffFrame);
  }
}
function rebuildLayer(ymap: Y.Map<unknown>): Record<string, unknown> {
  const out = rebuildFields(ymap, LAYER_STRUCTURAL);
  const yframes = ymap.get("frames") as Y.Array<Y.Map<unknown>> | undefined;
  out.frames = yframes instanceof Y.Array ? rebuildPositional(yframes, rebuildFrame) : [];
  return out;
}

// --- timeline ---

interface TimelineLike { layers: readonly LayerLike[] }

function materializeTimeline(ymap: Y.Map<unknown>, timeline: TimelineLike): void {
  const ylayers = new Y.Array<Y.Map<unknown>>();
  ymap.set("layers", ylayers);
  reconcilePositional(ylayers, undefined, timeline.layers, materializeLayer, diffLayer);
}
function diffTimeline(
  ymap: Y.Map<unknown>,
  prev: TimelineLike | undefined,
  next: TimelineLike,
): void {
  if (prev?.layers === next.layers) return;
  let ylayers = ymap.get("layers") as Y.Array<Y.Map<unknown>> | undefined;
  if (!(ylayers instanceof Y.Array)) {
    ylayers = new Y.Array<Y.Map<unknown>>();
    ymap.set("layers", ylayers);
  }
  reconcilePositional(ylayers, prev?.layers, next.layers, materializeLayer, diffLayer);
}
function rebuildTimeline(ymap: Y.Map<unknown>): TimelineLike {
  const ylayers = ymap.get("layers") as Y.Array<Y.Map<unknown>> | undefined;
  return {
    layers:
      ylayers instanceof Y.Array
        ? (rebuildPositional(ylayers, rebuildLayer) as unknown as LayerLike[])
        : [],
  };
}

// --- scene ---

interface SceneLike { timeline: TimelineLike; [k: string]: unknown }

function materializeScene(ymap: Y.Map<unknown>, scene: SceneLike): void {
  materializeFields(ymap, scene, SCENE_STRUCTURAL);
  const ytl = new Y.Map();
  ymap.set("timeline", ytl);
  materializeTimeline(ytl, scene.timeline);
}
function diffScene(ymap: Y.Map<unknown>, prev: SceneLike | undefined, next: SceneLike): void {
  diffFields(ymap, prev, next, SCENE_STRUCTURAL);
  if (prev?.timeline !== next.timeline) {
    let ytl = ymap.get("timeline") as Y.Map<unknown> | undefined;
    if (!(ytl instanceof Y.Map)) {
      ytl = new Y.Map();
      ymap.set("timeline", ytl);
    }
    diffTimeline(ytl, prev?.timeline, next.timeline);
  }
}
function rebuildScene(ymap: Y.Map<unknown>): Record<string, unknown> {
  const out = rebuildFields(ymap, SCENE_STRUCTURAL);
  const ytl = ymap.get("timeline") as Y.Map<unknown> | undefined;
  out.timeline = ytl instanceof Y.Map ? rebuildTimeline(ytl) : { layers: [] };
  return out;
}

// --- library item (symbols carry a nested timeline) ---

interface ItemLike { id: string; itemType: string; timeline?: TimelineLike; [k: string]: unknown }

function materializeItem(ymap: Y.Map<unknown>, item: ItemLike): void {
  const structural = item.itemType === "symbol" ? SYMBOL_STRUCTURAL : EMPTY_STRUCTURAL;
  materializeFields(ymap, item, structural);
  if (item.itemType === "symbol" && item.timeline) {
    const ytl = new Y.Map();
    ymap.set("timeline", ytl);
    materializeTimeline(ytl, item.timeline);
  }
}
function diffItem(ymap: Y.Map<unknown>, prev: ItemLike | undefined, next: ItemLike): void {
  const structural = next.itemType === "symbol" ? SYMBOL_STRUCTURAL : EMPTY_STRUCTURAL;
  diffFields(ymap, prev, next, structural);
  if (next.itemType === "symbol" && next.timeline) {
    if (prev?.timeline !== next.timeline) {
      let ytl = ymap.get("timeline") as Y.Map<unknown> | undefined;
      if (!(ytl instanceof Y.Map)) {
        ytl = new Y.Map();
        ymap.set("timeline", ytl);
      }
      diffTimeline(ytl, prev?.timeline, next.timeline);
    }
  } else if (ymap.has("timeline")) {
    ymap.delete("timeline");
  }
}
function rebuildItem(ymap: Y.Map<unknown>): Record<string, unknown> {
  const isSymbol = ymap.get("itemType") === "symbol";
  const structural = isSymbol ? SYMBOL_STRUCTURAL : EMPTY_STRUCTURAL;
  const out = rebuildFields(ymap, structural);
  if (isSymbol) {
    const ytl = ymap.get("timeline") as Y.Map<unknown> | undefined;
    out.timeline = ytl instanceof Y.Map ? rebuildTimeline(ytl) : { layers: [] };
  }
  return out;
}

// --- library ---

interface LibraryLike { items: readonly ItemLike[]; folders: readonly unknown[] }

function materializeLibrary(ymap: Y.Map<unknown>, lib: LibraryLike): void {
  reconcileKeyed(
    ymap,
    "items",
    undefined,
    lib.items,
    materializeItem as Materializer<ItemLike>,
    diffItem as Differ<ItemLike>,
  );
  setPlainArray(ymap, "folders", lib.folders);
}
function diffLibrary(ymap: Y.Map<unknown>, prev: LibraryLike | undefined, next: LibraryLike): void {
  if (prev?.items !== next.items) {
    reconcileKeyed(
      ymap,
      "items",
      prev?.items,
      next.items,
      materializeItem as Materializer<ItemLike>,
      diffItem as Differ<ItemLike>,
    );
  }
  if (prev?.folders !== next.folders) setPlainArray(ymap, "folders", next.folders);
}
function rebuildLibrary(ymap: Y.Map<unknown>): LibraryLike {
  return {
    items: rebuildKeyed(ymap, "items", rebuildItem) as ItemLike[],
    folders: rebuildPlainArray(ymap, "folders") ?? [],
  };
}

// --- asClasses: Y.Map<path, Y.Text> ---

interface AsClassLike { path: string; source: string }

function reconcileAsClasses(
  root: Y.Map<unknown>,
  prev: readonly AsClassLike[] | undefined,
  next: readonly AsClassLike[] | undefined,
): void {
  // EAGER + STABLE: the container is always created (genesis or here) and NEVER
  // deleted, so a concurrent first-`addAsClass` is a sub-key write on a shared
  // container, not a root-key LWW (task 1360). An absent model field is recorded
  // by clearing the presence sentinel, not by removing the root key.
  const container = ensureOptionalMap(root, "asClasses");
  if (next === undefined) {
    setMapPresence(container, false);
    // An absent field carries no classes: drop any leftover entries + order.
    for (const key of [...container.keys()]) {
      if (key === PRESENT_KEY) continue;
      container.delete(key);
    }
    return;
  }
  setMapPresence(container, true);
  // Preserve authored order via a sibling order array.
  let order = container.get(ORDER_KEY) as Y.Array<string> | undefined;
  if (!(order instanceof Y.Array)) {
    order = new Y.Array<string>();
    container.set(ORDER_KEY, order);
  }

  const prevByPath = new Map<string, AsClassLike>();
  for (const c of prev ?? []) prevByPath.set(c.path, c);
  const nextByPath = new Map<string, AsClassLike>();
  for (const c of next) nextByPath.set(c.path, c);

  for (const cls of next) {
    let ytext = container.get(cls.path) as Y.Text | undefined;
    if (!(ytext instanceof Y.Text)) {
      ytext = new Y.Text();
      container.set(cls.path, ytext);
      if (cls.source.length > 0) ytext.insert(0, cls.source);
    } else {
      const prevSource = prevByPath.get(cls.path)?.source;
      if (prevSource !== cls.source) applyTextEdit(ytext, cls.source);
    }
  }
  for (const key of [...container.keys()]) {
    if (key === ORDER_KEY || key === PRESENT_KEY) continue;
    if (!nextByPath.has(key)) container.delete(key);
  }
  // CRDT-safe incremental order reconcile (see reconcileOrderArray) — concurrent
  // class adds/removes/reorders converge without a duplicated or dropped path.
  reconcileOrderArray(order, next.map((c) => c.path));
}

/**
 * Replace a Y.Text's content with `nextSource` using a minimal common-prefix /
 * common-suffix splice so concurrent character-level edits in disjoint regions
 * still merge (the whole point of using Y.Text for class source).
 */
function applyTextEdit(ytext: Y.Text, nextSource: string): void {
  const cur = ytext.toString();
  if (cur === nextSource) return;
  let start = 0;
  const maxStart = Math.min(cur.length, nextSource.length);
  while (start < maxStart && cur[start] === nextSource[start]) start++;
  let endCur = cur.length;
  let endNext = nextSource.length;
  while (endCur > start && endNext > start && cur[endCur - 1] === nextSource[endNext - 1]) {
    endCur--;
    endNext--;
  }
  const deleteLen = endCur - start;
  if (deleteLen > 0) ytext.delete(start, deleteLen);
  const insertStr = nextSource.slice(start, endNext);
  if (insertStr.length > 0) ytext.insert(start, insertStr);
}

function rebuildAsClasses(root: Y.Map<unknown>): AsClassLike[] | undefined {
  const container = root.get("asClasses") as Y.Map<unknown> | undefined;
  if (!(container instanceof Y.Map)) return undefined;
  // An eagerly pre-created container with no presence sentinel means the model
  // field was ABSENT — rebuild it as `undefined`, preserving round-trip identity.
  if (!isMapPresent(container)) return undefined;
  const order = container.get(ORDER_KEY) as Y.Array<string> | undefined;
  // Defensive read: dedupe doubled paths, drop paths with no live Y.Text, and
  // append any class missing from __order so a concurrently-added class is never
  // lost (symmetric with rebuildKeyed's orderedKeys).
  const paths = orderedKeys(container, order);
  const out: AsClassLike[] = [];
  for (const path of paths) {
    const ytext = container.get(path) as Y.Text | undefined;
    if (ytext instanceof Y.Text) out.push({ path, source: ytext.toString() });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Top-level document.
// ---------------------------------------------------------------------------

interface DocLike {
  id: string;
  properties: Record<string, unknown>;
  scenes: readonly SceneLike[];
  library: LibraryLike;
  asClasses?: readonly AsClassLike[];
  classpaths?: readonly string[];
  publishProfiles?: readonly unknown[];
  flaSwfBlobs?: readonly RawBlob[];
  [k: string]: unknown;
}

/** Get (or lazily create) the root Y.Map on a Y.Doc. */
export function getRoot(ydoc: Y.Doc): Y.Map<unknown> {
  return ydoc.getMap(ROOT_KEY);
}

/** Materialize a full FlashDocument into the Y.Doc's root map. */
export function materializeDoc(ydoc: Y.Doc, doc: FlashDocument): void {
  const root = getRoot(ydoc);
  const d = doc as unknown as DocLike;
  materializeFields(root, d as Record<string, unknown>, DOC_STRUCTURAL);

  // `properties` -> a nested Y.Map with per-field entries (task 1392). It is
  // ALWAYS present on a valid document (`createDocument` sets it) and the map is
  // created once here at genesis, so concurrent field edits are sub-key writes on
  // the shared map that merge — never a root-key or whole-value LWW.
  const yprops = new Y.Map();
  root.set("properties", yprops);
  materializeFields(yprops, d.properties, PROPERTIES_STRUCTURAL);

  const yscenes = new Y.Array<Y.Map<unknown>>();
  root.set("scenes", yscenes);
  reconcilePositional(yscenes, undefined, d.scenes, materializeScene, diffScene);

  const ylib = new Y.Map();
  root.set("library", ylib);
  materializeLibrary(ylib, d.library);

  // Optional root containers are EAGERLY created here (even when the model field
  // is undefined) so the root key exists from genesis on every peer, making a
  // concurrent first-add a converging sub-key write rather than a root-key LWW
  // that loses one peer's contents (task 1360).
  reconcileAsClasses(root, undefined, d.asClasses);
  setOptionalPlainArray(root, "classpaths", d.classpaths);
  setOptionalPlainArray(root, "publishProfiles", d.publishProfiles);
  setOptionalPlainArray(
    root,
    "flaSwfBlobs",
    d.flaSwfBlobs,
    (v) => blobToJson(v as RawBlob),
  );
}

/** Reconcile the Y.Doc root map from `prev` to `next` (structural-sharing diff). */
export function diffDoc(ydoc: Y.Doc, prev: FlashDocument | undefined, next: FlashDocument): void {
  const root = getRoot(ydoc);
  const p = prev as unknown as DocLike | undefined;
  const n = next as unknown as DocLike;

  diffFields(root, p as Record<string, unknown> | undefined, n as Record<string, unknown>, DOC_STRUCTURAL);

  // `properties` per-field reconcile into its nested Y.Map (task 1392). Only the
  // fields that actually changed are written, so a concurrent edit to a different
  // property field on another peer is untouched and both survive on merge.
  if (p?.properties !== n.properties) {
    let yprops = root.get("properties") as Y.Map<unknown> | undefined;
    if (!(yprops instanceof Y.Map)) {
      yprops = new Y.Map();
      root.set("properties", yprops);
    }
    diffFields(yprops, p?.properties, n.properties, PROPERTIES_STRUCTURAL);
  }

  if (p?.scenes !== n.scenes) {
    let yscenes = root.get("scenes") as Y.Array<Y.Map<unknown>> | undefined;
    if (!(yscenes instanceof Y.Array)) {
      yscenes = new Y.Array<Y.Map<unknown>>();
      root.set("scenes", yscenes);
    }
    reconcilePositional(yscenes, p?.scenes, n.scenes, materializeScene, diffScene);
  }

  if (p?.library !== n.library) {
    let ylib = root.get("library") as Y.Map<unknown> | undefined;
    if (!(ylib instanceof Y.Map)) {
      ylib = new Y.Map();
      root.set("library", ylib);
    }
    diffLibrary(ylib, p?.library, n.library);
  }

  if (p?.asClasses !== n.asClasses) reconcileAsClasses(root, p?.asClasses, n.asClasses);
  if (p?.classpaths !== n.classpaths) setOptionalPlainArray(root, "classpaths", n.classpaths);
  if (p?.publishProfiles !== n.publishProfiles) {
    setOptionalPlainArray(root, "publishProfiles", n.publishProfiles);
  }
  if (p?.flaSwfBlobs !== n.flaSwfBlobs) {
    setOptionalPlainArray(root, "flaSwfBlobs", n.flaSwfBlobs, (v) => blobToJson(v as RawBlob));
  }
}

/** Rebuild a fresh FlashDocument from the Y.Doc's root map. */
export function rebuildDoc(ydoc: Y.Doc): FlashDocument {
  const root = getRoot(ydoc);
  const out = rebuildFields(root, DOC_STRUCTURAL);

  // `properties` from its nested Y.Map (task 1392). A missing/garbage container
  // (only reachable via a hostile peer — a valid doc always carries it) leaves
  // `properties` absent, which `validateInboundDoc` re-defaults; a normal doc
  // rebuilds the object field-for-field, preserving the round-trip identity.
  const yprops = root.get("properties") as Y.Map<unknown> | undefined;
  if (yprops instanceof Y.Map) {
    out.properties = rebuildFields(yprops, PROPERTIES_STRUCTURAL);
  }

  const yscenes = root.get("scenes") as Y.Array<Y.Map<unknown>> | undefined;
  out.scenes = yscenes instanceof Y.Array ? rebuildPositional(yscenes, rebuildScene) : [];

  const ylib = root.get("library") as Y.Map<unknown> | undefined;
  out.library = ylib instanceof Y.Map ? rebuildLibrary(ylib) : { items: [], folders: [] };

  const asClasses = rebuildAsClasses(root);
  if (asClasses !== undefined) out.asClasses = asClasses;

  const classpaths = rebuildOptionalPlainArray<string>(root, "classpaths");
  if (classpaths !== undefined) out.classpaths = classpaths;

  const publishProfiles = rebuildOptionalPlainArray(root, "publishProfiles");
  if (publishProfiles !== undefined) out.publishProfiles = publishProfiles;

  const flaSwfBlobs = rebuildOptionalPlainArray<RawBlob>(root, "flaSwfBlobs", (v) => jsonToBlob(v));
  if (flaSwfBlobs !== undefined) out.flaSwfBlobs = flaSwfBlobs;

  return out as unknown as FlashDocument;
}
