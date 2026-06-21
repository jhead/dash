/**
 * Inbound CRDT-state validation / normalization (untrusted-peer hardening).
 *
 * THREAT MODEL. The collab trust model is "anyone with the share link is a full
 * read/write collaborator" (Google-Docs-style). A peer's Y.Doc is replicated
 * into the local Y.Doc and `rebuildDoc` turns it back into a FlashDocument that
 * the binding hands to the app (`replaceDoc`). A MALICIOUS or simply BUGGY peer
 * can therefore put arbitrary CRDT state into the shared doc: wrong scalar
 * types, missing required ids, unknown node kinds, NaN/Infinity coordinates, a
 * non-array where the renderer/compiler expects an array, an oversized or
 * deeply-nested payload, or a crafted `asClasses` path designed to traverse out
 * of the class-VFS root when the joiner later syncs classes to disk.
 *
 * Without a check, `rebuildDoc`'s `... as unknown as FlashDocument` cast would
 * propagate that garbage verbatim into the live model — crashing the render loop
 * / SWF compiler (DoS), corrupting the doc for EVERY collaborator, enabling
 * type-confusion, or path-traversal on the next class sync.
 *
 * DEFENCE. `validateInboundDoc` is a TOTAL function: it never throws and always
 * returns a structurally-valid FlashDocument. It does not aim to be a full
 * schema (the model is large and evolving); it enforces the SHAPE INVARIANTS the
 * downstream consumers actually rely on, coercing or DROPPING anything that
 * violates them and logging a one-line warning per dropped piece. One peer's bad
 * state can degrade THAT peer's contribution (a dropped object, a clamped
 * coordinate) but can never break the others or take down the editor.
 *
 * What it guarantees about the result:
 *   - top-level required fields exist with the right kind: `id:string`,
 *     `properties` (a valid DocumentProperties), `scenes` (>=1 valid Scene),
 *     `library:{items:[],folders:[]}`;
 *   - every Scene/Layer/Frame/Timeline is an object with its required structural
 *     children present as arrays;
 *   - every DisplayObject has a known `type`, a string `id`, and finite numeric
 *     `x`/`y` (others coerced); unknown-kind / id-less objects are dropped;
 *   - every LibraryItem has a known `itemType` and a string `id`; symbols get a
 *     valid nested timeline; unknown-kind / id-less items are dropped;
 *   - `asClasses` paths are run through `normalizeClassPath` (path-traversal /
 *     NUL / empty rejected) and `source` is coerced to a string; bad entries are
 *     dropped;
 *   - total node count and nesting depth are bounded, so a cyclic-ish or
 *     oversized payload is truncated rather than exhausting memory / the stack.
 *
 * NOTE on the SCRIPT vector. Peer-supplied AS2 frame `script` text and
 * `asClasses` sources are compiled+run on every collaborator's machine. That is
 * inherent to a doc-sharing model (the same as opening someone's `.fla`) and is
 * NOT something this validator can neutralize without breaking collaboration;
 * see docs/37-collab.md for the trust-model note. We DO sanitize the storage
 * SHAPE of scripts (must be a string) and the asClasses PATH (no traversal).
 */
import {
  createDocument,
  createDocumentProperties,
  normalizeClassPath,
} from "@flash/core";
import type { FlashDocument } from "@flash/core";

// ---------------------------------------------------------------------------
// Resource bounds — defend against oversized / cyclic-ish hostile payloads.
// ---------------------------------------------------------------------------

/** Max display objects per frame / library items kept before truncation. */
const MAX_ARRAY_LEN = 100_000;
/** Max recursion depth for the generic deep-sanitizer of atomic field values. */
const MAX_VALUE_DEPTH = 64;

/** Known display-object discriminants (the `type` field). */
const KNOWN_DISPLAY_OBJECT_TYPES = new Set([
  "shape",
  "instance",
  "drawing-object",
  "text",
  "bitmap",
  "video",
  "group",
]);

/** Known library-item discriminants (the `itemType` field). */
const KNOWN_LIBRARY_ITEM_TYPES = new Set([
  "symbol",
  "bitmap",
  "sound",
  "video",
  "font",
  "component",
]);

/** Item types that carry a nested timeline. */
const TIMELINE_ITEM_TYPES = new Set(["symbol"]);

// ---------------------------------------------------------------------------
// Logging — collab is opt-in; a dropped piece is noteworthy but must NEVER throw.
// ---------------------------------------------------------------------------

let _warned = 0;
const MAX_WARNINGS = 50;

function warn(message: string): void {
  // Cap noise: a hostile peer could otherwise flood the console.
  if (_warned >= MAX_WARNINGS) return;
  _warned++;
  // eslint-disable-next-line no-console
  console.warn(`[collab] inbound state rejected/coerced: ${message}`);
  if (_warned === MAX_WARNINGS) {
    // eslint-disable-next-line no-console
    console.warn("[collab] further inbound-validation warnings suppressed");
  }
}

// ---------------------------------------------------------------------------
// Primitive coercion helpers.
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asBoolean(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** A finite number, or `fallback` for NaN / Infinity / non-number. */
function asFiniteNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** A finite number clamped to [min,max], or `fallback`. */
function asClampedNumber(
  v: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = asFiniteNumber(v, fallback);
  return Math.min(max, Math.max(min, n));
}

/**
 * Deep-sanitize an arbitrary "atomic" field value (a scalar, or a nested
 * plain-JSON object/array stored whole, e.g. `shape` geometry, `filters`,
 * `colorEffect`, `sound`). Defends the SHAPE only — it does not understand the
 * field's semantics; it just guarantees the value is finite, depth-bounded,
 * acyclic plain JSON so a downstream consumer never sees a NaN, an Infinity, or
 * a payload that blows the stack. Anything beyond the depth limit is dropped.
 */
function sanitizeAtomic(value: unknown, depth: number): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "boolean") return value;
  if (t === "number") {
    // NaN / Infinity are not valid JSON and crash several downstream maths;
    // collapse to 0 so a hostile coordinate cannot poison the renderer.
    return Number.isFinite(value as number) ? value : 0;
  }
  if (t !== "object") {
    // function / symbol / bigint / undefined — never valid in our JSON model.
    return undefined;
  }
  if (depth >= MAX_VALUE_DEPTH) {
    warn(`atomic value exceeded max depth ${MAX_VALUE_DEPTH}; dropped`);
    return undefined;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    const len = Math.min(value.length, MAX_ARRAY_LEN);
    for (let i = 0; i < len; i++) {
      const s = sanitizeAtomic(value[i], depth + 1);
      out.push(s === undefined ? null : s);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    const s = sanitizeAtomic((value as Record<string, unknown>)[k], depth + 1);
    if (s !== undefined) out[k] = s; // drop undefined-valued keys (matches json.ts)
  }
  return out;
}

/**
 * Copy the "scalar/atomic" fields of a source object into `out`, deep-sanitizing
 * each value and skipping the given structural keys (handled by the caller) and
 * the keys explicitly enforced by the caller (so we don't overwrite a coerced
 * required field with a raw one).
 */
function copyAtomicFields(
  source: Record<string, unknown>,
  out: Record<string, unknown>,
  skip: ReadonlySet<string>,
): void {
  for (const key of Object.keys(source)) {
    if (skip.has(key)) continue;
    const s = sanitizeAtomic(source[key], 0);
    if (s !== undefined) out[key] = s;
  }
}

// ---------------------------------------------------------------------------
// Node validators. Each takes raw `unknown` and returns a normalized object, or
// `null` when the node is too broken to keep (the caller drops it).
// ---------------------------------------------------------------------------

const DISPLAY_OBJECT_SKIP: ReadonlySet<string> = new Set(["id", "type", "x", "y"]);

function validateDisplayObject(raw: unknown): Record<string, unknown> | null {
  if (!isPlainObject(raw)) {
    warn("display object is not an object; dropped");
    return null;
  }
  const type = raw.type;
  if (typeof type !== "string" || !KNOWN_DISPLAY_OBJECT_TYPES.has(type)) {
    warn(`display object has unknown type ${JSON.stringify(type)}; dropped`);
    return null;
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    warn(`${type} display object missing string id; dropped`);
    return null;
  }
  const out: Record<string, unknown> = {
    id: raw.id,
    type,
    x: asFiniteNumber(raw.x, 0),
    y: asFiniteNumber(raw.y, 0),
  };
  copyAtomicFields(raw, out, DISPLAY_OBJECT_SKIP);
  return out;
}

const FRAME_SKIP: ReadonlySet<string> = new Set(["displayObjects", "script"]);

function validateFrame(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    warn("frame is not an object; replaced with empty keyframe");
    return emptyFrame();
  }
  const out: Record<string, unknown> = {};
  copyAtomicFields(raw, out, FRAME_SKIP);
  // `script` MUST be a string (the AS2 source compiled on every peer's machine).
  out.script = asString(raw.script, "");

  const objs: Record<string, unknown>[] = [];
  const rawObjs = asArray(raw.displayObjects);
  const len = Math.min(rawObjs.length, MAX_ARRAY_LEN);
  if (rawObjs.length > MAX_ARRAY_LEN) {
    warn(`frame has ${rawObjs.length} display objects; truncated to ${MAX_ARRAY_LEN}`);
  }
  for (let i = 0; i < len; i++) {
    const obj = validateDisplayObject(rawObjs[i]);
    if (obj !== null) objs.push(obj);
  }
  out.displayObjects = objs;
  return out;
}

function emptyFrame(): Record<string, unknown> {
  return { displayObjects: [], script: "" };
}

const LAYER_SKIP: ReadonlySet<string> = new Set(["frames"]);

function validateLayer(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    warn("layer is not an object; dropped (replaced with empty)");
    return { frames: [] };
  }
  const out: Record<string, unknown> = {};
  copyAtomicFields(raw, out, LAYER_SKIP);
  const rawFrames = asArray(raw.frames);
  const len = Math.min(rawFrames.length, MAX_ARRAY_LEN);
  const frames: Record<string, unknown>[] = [];
  for (let i = 0; i < len; i++) frames.push(validateFrame(rawFrames[i]));
  out.frames = frames;
  return out;
}

function validateTimeline(raw: unknown): { layers: Record<string, unknown>[] } {
  if (!isPlainObject(raw)) return { layers: [] };
  const rawLayers = asArray(raw.layers);
  const len = Math.min(rawLayers.length, MAX_ARRAY_LEN);
  const layers: Record<string, unknown>[] = [];
  for (let i = 0; i < len; i++) layers.push(validateLayer(rawLayers[i]));
  return { layers };
}

const SCENE_SKIP: ReadonlySet<string> = new Set(["timeline"]);

function validateScene(raw: unknown): Record<string, unknown> | null {
  if (!isPlainObject(raw)) {
    warn("scene is not an object; dropped");
    return null;
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    warn("scene missing string id; dropped");
    return null;
  }
  const out: Record<string, unknown> = { id: raw.id };
  copyAtomicFields(raw, out, SCENE_SKIP);
  out.name = asString(raw.name, raw.id);
  out.timeline = validateTimeline(raw.timeline);
  return out;
}

const LIBRARY_ITEM_SKIP: ReadonlySet<string> = new Set(["timeline"]);

function validateLibraryItem(raw: unknown): Record<string, unknown> | null {
  if (!isPlainObject(raw)) {
    warn("library item is not an object; dropped");
    return null;
  }
  const itemType = raw.itemType;
  if (typeof itemType !== "string" || !KNOWN_LIBRARY_ITEM_TYPES.has(itemType)) {
    warn(`library item has unknown itemType ${JSON.stringify(itemType)}; dropped`);
    return null;
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    warn(`${itemType} library item missing string id; dropped`);
    return null;
  }
  const out: Record<string, unknown> = { id: raw.id, itemType };
  copyAtomicFields(raw, out, LIBRARY_ITEM_SKIP);
  if (TIMELINE_ITEM_TYPES.has(itemType)) {
    out.timeline = validateTimeline(raw.timeline);
  }
  return out;
}

function validateLibrary(raw: unknown): {
  items: Record<string, unknown>[];
  folders: unknown[];
} {
  if (!isPlainObject(raw)) return { items: [], folders: [] };
  const items: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();
  const rawItems = asArray(raw.items);
  const len = Math.min(rawItems.length, MAX_ARRAY_LEN);
  for (let i = 0; i < len; i++) {
    const item = validateLibraryItem(rawItems[i]);
    if (item === null) continue;
    const id = item.id as string;
    if (seenIds.has(id)) {
      warn(`duplicate library item id ${JSON.stringify(id)}; dropped`);
      continue;
    }
    seenIds.add(id);
    items.push(item);
  }
  const folders = (sanitizeAtomic(asArray(raw.folders), 0) as unknown[]) ?? [];
  return { items, folders };
}

function validateProperties(raw: unknown): Record<string, unknown> {
  // Start from the model's defaults so every required sub-field is present, then
  // overlay sanitized values from the peer's data.
  const defaults = createDocumentProperties() as unknown as Record<string, unknown>;
  if (!isPlainObject(raw)) {
    warn("document properties not an object; using defaults");
    return defaults;
  }
  const out: Record<string, unknown> = { ...defaults };
  // Copy every sanitized field the peer supplied (forward-compatible), then pin
  // the load-bearing numeric ones to sane finite/clamped values.
  copyAtomicFields(raw, out, new Set());
  out.width = asClampedNumber(raw.width, 1, 100_000, defaults.width as number);
  out.height = asClampedNumber(raw.height, 1, 100_000, defaults.height as number);
  out.frameRate = asClampedNumber(raw.frameRate, 0.01, 1000, defaults.frameRate as number);
  out.backgroundColor = asString(raw.backgroundColor, defaults.backgroundColor as string);
  if (!Array.isArray(out.guides)) out.guides = [];
  if (!isPlainObject(out.grid)) out.grid = defaults.grid;
  out.snapToObjects = asBoolean(raw.snapToObjects, defaults.snapToObjects as boolean);
  out.snapToPixels = asBoolean(raw.snapToPixels, defaults.snapToPixels as boolean);
  out.snapToGuides = asBoolean(raw.snapToGuides, defaults.snapToGuides as boolean);
  return out;
}

interface AsClassLike {
  path: string;
  source: string;
}

function validateAsClasses(raw: unknown): AsClassLike[] | undefined {
  if (raw === undefined) return undefined;
  const rawArr = asArray(raw);
  const out: AsClassLike[] = [];
  const seen = new Set<string>();
  for (const entry of rawArr) {
    if (!isPlainObject(entry)) {
      warn("asClasses entry not an object; dropped");
      continue;
    }
    const rawPath = entry.path;
    if (typeof rawPath !== "string") {
      warn("asClasses entry missing string path; dropped");
      continue;
    }
    let path: string;
    try {
      // The single existing defense against `..` / NUL / absolute traversal.
      path = normalizeClassPath(rawPath);
    } catch {
      warn(`asClasses path ${JSON.stringify(rawPath)} failed normalization; dropped`);
      continue;
    }
    if (seen.has(path)) {
      warn(`duplicate asClasses path ${JSON.stringify(path)}; dropped`);
      continue;
    }
    seen.add(path);
    out.push({ path, source: asString(entry.source, "") });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Top-level entry point.
// ---------------------------------------------------------------------------

const DOC_SKIP: ReadonlySet<string> = new Set([
  "id",
  "properties",
  "scenes",
  "library",
  "asClasses",
  "classpaths",
  "flaSwfBlobs",
]);

/**
 * Validate + normalize a freshly-rebuilt (untrusted) document into a structurally
 * valid FlashDocument. NEVER throws; drops/coerces anything invalid.
 *
 * `fallback` (default: a fresh `createDocument()`) is used when the input is too
 * broken to be a document at all (e.g. not an object). Pass the LAST-GOOD doc to
 * fail safe to the previous state instead of a blank document.
 */
export function validateInboundDoc(
  raw: unknown,
  fallback?: FlashDocument,
): FlashDocument {
  _warned = 0; // reset per-rebuild so each inbound update gets its own budget
  if (!isPlainObject(raw)) {
    warn("rebuilt document is not an object; keeping last-good / fresh document");
    return fallback ?? createDocument();
  }

  const out: Record<string, unknown> = {};
  // Forward-compatible: carry sanitized unknown top-level scalars so a newer
  // peer's added field is not silently lost, while still pinning the known ones.
  copyAtomicFields(raw, out, DOC_SKIP);

  out.id = asString(raw.id) || (fallback?.id ?? createDocument().id);
  out.properties = validateProperties(raw.properties);

  // scenes: must be a non-empty array of valid scenes (renderer/compiler index
  // scene 0 unconditionally). If none survive, fall back to a single fresh scene.
  const scenes: Record<string, unknown>[] = [];
  const rawScenes = asArray(raw.scenes);
  const sceneLen = Math.min(rawScenes.length, MAX_ARRAY_LEN);
  for (let i = 0; i < sceneLen; i++) {
    const scene = validateScene(rawScenes[i]);
    if (scene !== null) scenes.push(scene);
  }
  if (scenes.length === 0) {
    warn("document has no valid scenes; using a fresh scene");
    out.scenes = createDocument().scenes;
  } else {
    out.scenes = scenes;
  }

  out.library = validateLibrary(raw.library);

  const asClasses = validateAsClasses(raw.asClasses);
  if (asClasses !== undefined) out.asClasses = asClasses;

  if (raw.classpaths !== undefined) {
    out.classpaths = asArray(raw.classpaths).filter(
      (p): p is string => typeof p === "string",
    );
  }

  // flaSwfBlobs is import-only and never produced by a mutation; its entries
  // carry a `bytes: Uint8Array` that `sanitizeAtomic` would mangle (it only
  // understands plain JSON). The schema layer already decoded it from base64, so
  // we only enforce that it is an ARRAY and leave the (typed-array-bearing)
  // entries untouched.
  if (raw.flaSwfBlobs !== undefined) {
    out.flaSwfBlobs = asArray(raw.flaSwfBlobs);
  }

  return out as unknown as FlashDocument;
}
