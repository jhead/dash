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
 *     id, properties.*, accessibility, activePublishProfileId   (atomic fields)
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
  "scenes",
  "library",
  "asClasses",
  "classpaths",
  "publishProfiles",
  "flaSwfBlobs",
]);
const SCENE_STRUCTURAL = new Set(["timeline"]);
const LAYER_STRUCTURAL = new Set(["frames"]);
const FRAME_STRUCTURAL = new Set(["displayObjects"]);
const DISPLAY_OBJECT_STRUCTURAL = new Set<string>(); // all fields atomic per spec
const SYMBOL_STRUCTURAL = new Set(["timeline"]);
const EMPTY_STRUCTURAL = new Set<string>();

/** Key under which a keyed Y.Map's deterministic order array lives. */
const ORDER_KEY = "__order";

/** The single root key on the Y.Doc holding the projected document. */
export const ROOT_KEY = "doc";

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

  // Reconcile the order array to exactly the next id sequence.
  const desired = next.map((i) => i.id);
  const current = order.toArray();
  if (!arraysEqual(current, desired)) {
    if (current.length > 0) order.delete(0, current.length);
    if (desired.length > 0) order.insert(0, desired);
  }
}

function rebuildKeyed<T>(
  parent: Y.Map<unknown>,
  containerKey: string,
  rebuild: Rebuilder<T>,
): T[] {
  const container = parent.get(containerKey) as Y.Map<unknown> | undefined;
  if (!(container instanceof Y.Map)) return [];
  const order = container.get(ORDER_KEY) as Y.Array<string> | undefined;
  const ids =
    order instanceof Y.Array
      ? order.toArray()
      : [...container.keys()].filter((k) => k !== ORDER_KEY);
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
  // Replace wholesale only when content differs (atomic array semantics).
  const current = yarr.toArray();
  if (!jsonArrayEqual(current, encoded)) {
    if (current.length > 0) yarr.delete(0, current.length);
    if (encoded.length > 0) yarr.insert(0, encoded);
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
  if (next === undefined) {
    if (root.has("asClasses")) root.delete("asClasses");
    return;
  }
  let container = root.get("asClasses") as Y.Map<unknown> | undefined;
  if (!(container instanceof Y.Map)) {
    container = new Y.Map();
    root.set("asClasses", container);
  }
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
    if (key === ORDER_KEY) continue;
    if (!nextByPath.has(key)) container.delete(key);
  }
  const desired = next.map((c) => c.path);
  const current = order.toArray();
  if (!arraysEqual(current, desired)) {
    if (current.length > 0) order.delete(0, current.length);
    if (desired.length > 0) order.insert(0, desired);
  }
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
  const order = container.get(ORDER_KEY) as Y.Array<string> | undefined;
  const paths =
    order instanceof Y.Array
      ? order.toArray()
      : [...container.keys()].filter((k) => k !== ORDER_KEY);
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

  const yscenes = new Y.Array<Y.Map<unknown>>();
  root.set("scenes", yscenes);
  reconcilePositional(yscenes, undefined, d.scenes, materializeScene, diffScene);

  const ylib = new Y.Map();
  root.set("library", ylib);
  materializeLibrary(ylib, d.library);

  reconcileAsClasses(root, undefined, d.asClasses);
  setPlainArray(root, "classpaths", d.classpaths);
  setPlainArray(root, "publishProfiles", d.publishProfiles);
  setPlainArray(
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
  if (p?.classpaths !== n.classpaths) setPlainArray(root, "classpaths", n.classpaths);
  if (p?.publishProfiles !== n.publishProfiles) {
    setPlainArray(root, "publishProfiles", n.publishProfiles);
  }
  if (p?.flaSwfBlobs !== n.flaSwfBlobs) {
    setPlainArray(root, "flaSwfBlobs", n.flaSwfBlobs, (v) => blobToJson(v as RawBlob));
  }
}

/** Rebuild a fresh FlashDocument from the Y.Doc's root map. */
export function rebuildDoc(ydoc: Y.Doc): FlashDocument {
  const root = getRoot(ydoc);
  const out = rebuildFields(root, DOC_STRUCTURAL);

  const yscenes = root.get("scenes") as Y.Array<Y.Map<unknown>> | undefined;
  out.scenes = yscenes instanceof Y.Array ? rebuildPositional(yscenes, rebuildScene) : [];

  const ylib = root.get("library") as Y.Map<unknown> | undefined;
  out.library = ylib instanceof Y.Map ? rebuildLibrary(ylib) : { items: [], folders: [] };

  const asClasses = rebuildAsClasses(root);
  if (asClasses !== undefined) out.asClasses = asClasses;

  const classpaths = rebuildPlainArray<string>(root, "classpaths");
  if (classpaths !== undefined) out.classpaths = classpaths;

  const publishProfiles = rebuildPlainArray(root, "publishProfiles");
  if (publishProfiles !== undefined) out.publishProfiles = publishProfiles;

  const flaSwfBlobs = rebuildPlainArray<RawBlob>(root, "flaSwfBlobs", (v) => jsonToBlob(v));
  if (flaSwfBlobs !== undefined) out.flaSwfBlobs = flaSwfBlobs;

  return out as unknown as FlashDocument;
}
