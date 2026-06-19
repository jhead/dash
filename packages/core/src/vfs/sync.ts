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
 * Reconcile `doc.asClasses` from the current VFS contents. Called on save: the
 * VFS (which the panel/editor and — on Tauri — external editors have been
 * mutating) becomes the source of truth and is folded back into the immutable
 * document via the P0 mutations. Only `.as` files are considered.
 *
 * Returns a NEW document; the input is never mutated. A file present in the doc
 * but absent from the VFS is dropped from `asClasses` (it was deleted via the
 * VFS). A file whose source is byte-identical is left as-is (no needless history
 * churn).
 */
export async function syncDocFromVfs(
  doc: FlashDocument,
  vfs: ClassVfs
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
    const existing = (next.asClasses ?? []).find((c) => c.path === path);
    if (existing && existing.source === source) continue; // no change
    next = addAsClass(next, { path, source } satisfies AsClassFile);
    changed.push(path);
  }

  // Drop classes that no longer exist in the VFS.
  const removed: string[] = [];
  for (const cls of next.asClasses ?? []) {
    const path = normalizeClassPath(cls.path);
    if (!vfsPaths.has(path)) {
      removed.push(path);
    }
  }
  if (removed.length > 0) {
    const keep = new Set(vfsPaths);
    next = {
      ...next,
      asClasses: (next.asClasses ?? []).filter((c) =>
        keep.has(normalizeClassPath(c.path))
      ),
    };
  }

  return { doc: next, changed, removed };
}
