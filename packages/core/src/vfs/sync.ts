import type { FlashDocument, AsClassFile } from "../model/types.js";
import { addAsClass } from "../model/document-mutations.js";
import type { ClassVfs } from "./types.js";
import { normalizeClassPath, isAsFile } from "./path.js";

// ---------------------------------------------------------------------------
// Hydrate / sync helpers — the bridge between the authoritative `.fla`-embedded
// `doc.asClasses` model and a live {@link ClassVfs} backend.
//
// CONTRACT (project lifecycle):
//   * On project OPEN, call `hydrateVfsFromDoc(doc, vfs)` to mirror every
//     embedded class into the editing surface (OPFS / IndexedDB / disk).
//   * While editing, the panel UI writes edits straight into the VFS.
//   * On SAVE (and before publish), call `syncDocFromVfs(doc, vfs)` to pull the
//     VFS contents back into `doc.asClasses` via the P0 mutations, so the
//     `.fla` embed stays authoritative and portable.
//
// These functions are pure (no DOM/Tauri) — they only touch the `ClassVfs`
// interface and the immutable document mutations — so they live in `@flash/core`
// and are unit-testable against `MemoryClassVfs`.
// ---------------------------------------------------------------------------

/** Result of a hydrate operation, for diagnostics/UI. */
export interface HydrateResult {
  /** Classpath-relative paths written into the VFS. */
  readonly written: readonly string[];
}

/** Result of a sync operation, for diagnostics/UI. */
export interface SyncResult {
  /** The new document with `asClasses` reconciled from the VFS. */
  readonly doc: FlashDocument;
  /** Paths added or updated in `doc.asClasses`. */
  readonly changed: readonly string[];
  /** Paths removed from `doc.asClasses` (present in doc, absent from VFS). */
  readonly removed: readonly string[];
}

/**
 * Populate `vfs` from the document's embedded `asClasses`. Called on project
 * open so the VFS reflects the `.fla`-embedded source. Existing VFS files NOT
 * present in the doc are left untouched by default (the doc embed is the source
 * of truth on open, but we don't blindly wipe a backend that may hold a newer
 * external edit); pass `{ prune: true }` to delete VFS files absent from the doc
 * for an exact mirror.
 */
export async function hydrateVfsFromDoc(
  doc: FlashDocument,
  vfs: ClassVfs,
  options?: { readonly prune?: boolean }
): Promise<HydrateResult> {
  const classes = doc.asClasses ?? [];
  const docPaths = new Set<string>();
  const written: string[] = [];
  for (const cls of classes) {
    const path = normalizeClassPath(cls.path);
    docPaths.add(path);
    await vfs.write(path, cls.source);
    written.push(path);
  }
  if (options?.prune) {
    const entries = await vfs.list();
    for (const entry of entries) {
      const path = normalizeClassPath(entry.path);
      if (!docPaths.has(path)) {
        await vfs.remove(path);
      }
    }
  }
  return { written };
}

/**
 * Governs which `doc.asClasses` entries {@link syncDocFromVfs} may DROP when
 * they are present in the document but absent from the VFS.
 *
 * A class in `doc.asClasses` but not in the VFS is ambiguous once collaboration
 * is in play (task 1390):
 *   - it may be a class the LOCAL user just removed via the VFS (a real delete),
 *     or
 *   - it may be a REMOTE peer's class that merged into `doc.asClasses` (per-class
 *     CRDT merge) but has not yet been mirrored into the local VFS.
 * Blindly pruning the second case deletes the peer's class for EVERYONE (the
 * removal round-trips back through the collab binding). The mode lets each caller
 * declare which removals are legitimate:
 *   - `"all"`  (default): drop every doc class absent from the VFS — the
 *     save-time / open-mirror reconcile where the VFS is authoritative and no
 *     remote merges can be racing.
 *   - `"none"`: never drop a doc class — the edit-time (debounced) reconcile,
 *     where a class absent from the VFS is a not-yet-mirrored remote addition,
 *     NOT a deletion.
 *   - a `Set` of paths: drop ONLY these explicitly (locally) removed paths; any
 *     OTHER doc class absent from the VFS is treated as a remote addition and
 *     kept. Paths are compared normalized.
 */
export type SyncRemoveMode = "all" | "none" | ReadonlySet<string>;

/**
 * Reconcile `doc.asClasses` from the current VFS contents. Called on save: the
 * VFS (which the panel/editor and — on Tauri — external editors have been
 * mutating) becomes the source of truth and is folded back into the immutable
 * document via the P0 mutations. Only `.as` files are considered.
 *
 * Returns a NEW document; the input is never mutated. A file whose source is
 * byte-identical is left as-is (no needless history churn). Whether a file
 * present in the doc but absent from the VFS is dropped is controlled by
 * `options.remove` (see {@link SyncRemoveMode}); it defaults to `"all"` (the
 * historical behaviour: any doc class missing from the VFS is dropped).
 */
export async function syncDocFromVfs(
  doc: FlashDocument,
  vfs: ClassVfs,
  options?: { readonly remove?: SyncRemoveMode }
): Promise<SyncResult> {
  const entries = await vfs.list();
  const vfsPaths = new Set<string>();
  const changed: string[] = [];
  let next = doc;

  for (const entry of entries) {
    const path = normalizeClassPath(entry.path);
    if (!isAsFile(path)) continue;
    vfsPaths.add(path);
    const source = await vfs.read(path);
    if (source === null) continue;
    // Match on the NORMALIZED stored path: `path` is already normalized (line
    // above), but doc.asClasses[].path may be raw (`./`, backslash, doubled
    // slash) from a zip key / real-FLA import. Comparing raw `c.path === path`
    // missed the existing entry, so addAsClass appended a stale DUPLICATE and the
    // no-change short-circuit never fired (task 1317 Bug A). Treat it as "no
    // change" only when the source matches AND the stored path is already
    // canonical; otherwise let addAsClass rewrite it to the canonical path
    // (collapsing the duplicate).
    const existing = (next.asClasses ?? []).find(
      (c) => normalizeClassPath(c.path) === path
    );
    if (existing && existing.source === source && existing.path === path) {
      continue; // no change
    }
    next = addAsClass(next, { path, source } satisfies AsClassFile);
    changed.push(path);
  }

  // Drop classes that no longer exist in the VFS, subject to `remove` mode.
  // "none" never drops (a doc-only class is a not-yet-mirrored remote add, not a
  // deletion — task 1390); a Set drops only the explicitly-removed local paths.
  const removeMode: SyncRemoveMode = options?.remove ?? "all";
  const removed: string[] = [];
  if (removeMode !== "none") {
    for (const cls of next.asClasses ?? []) {
      const path = normalizeClassPath(cls.path);
      if (vfsPaths.has(path)) continue;
      if (removeMode === "all" || removeMode.has(path)) {
        removed.push(path);
      }
    }
    if (removed.length > 0) {
      const drop = new Set(removed);
      next = {
        ...next,
        asClasses: (next.asClasses ?? []).filter(
          (c) => !drop.has(normalizeClassPath(c.path))
        ),
      };
    }
  }

  return { doc: next, changed, removed };
}
