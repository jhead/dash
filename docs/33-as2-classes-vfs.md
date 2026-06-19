# AS2 External Classes & the Cross-Platform Class VFS

How `dash` stores, edits, and reconciles external AS2 `.as` class files across
both the web build and the Tauri desktop app. This document covers Phase 2 of
AS2 class support: the **virtual filesystem (VFS)** layer. (Phase 0 added the
`doc.asClasses` model + `.fla` persistence; the Classes-panel UI and the compile
pipeline are later phases.)

## Goals

Flash 8 lets you keep AS2 classes as `.as` files on an external **classpath**
(e.g. `classes/com/example/Foo.as` for class `com.example.Foo`). `dash` supports
the same package-directory convention while staying portable:

- **One portable artifact.** The `.fla` zip is always authoritative: every class
  is embedded both as a `classes/<path>` zip entry and inline in `document.json`
  (`doc.asClasses`). A `.fla` you email opens with its classes intact on any
  platform — no external files required.
- **A real editing surface on every platform.** While a project is open, classes
  live in a writable VFS so the editor (and, on desktop, external editors) can
  mutate them efficiently without rewriting the whole `.fla` on every keystroke.
- **Desktop disk mirror.** On Tauri the VFS is **real files on disk** under a
  `classes/` directory beside the `.fla` (Flash 8 external-classpath style), so
  you can edit them in VS Code, diff them in git, etc. On save the on-disk edits
  are reconciled back into the embedded copy.

## Layering

```
@flash/core/vfs                 (PURE — no DOM, no Tauri)
  ClassVfs interface            list / read / write / remove / exists
  path helpers                  normalizeClassPath / splitClassPath / join / isAsFile
  MemoryClassVfs                reference + headless/SSR fallback backend
  hydrateVfsFromDoc             doc.asClasses -> VFS   (on project open)
  syncDocFromVfs                VFS -> doc.asClasses   (on save; uses P0 mutations)

@flash/authoring-ui/vfs         (platform backends — DOM / Tauri)
  WebClassVfs        (kind "opfs")        OPFS nested dirs
  IndexedDbClassVfs  (kind "indexeddb")   OPFS fallback, single keyed store
  TauriClassVfs      (kind "tauri")       native FS disk mirror under classes/
  createClassVfs                          platform factory (isTauri / OPFS / IDB probes)
```

`@flash/core` deliberately owns only the **pure** layer so the package keeps
importing cleanly in Node, the browser, and the Tauri webview. Anything that
touches `navigator`, the OPFS handle API, or `@tauri-apps/plugin-fs` lives in
`@flash/authoring-ui/vfs`.

## Paths

Every VFS path is **classpath-relative** with forward slashes and no leading
slash: `com/example/Foo.as`. This is identical to `AsClassFile.path` and to the
`classes/<path>` zip-entry suffix, so the model, the `.fla`, and the VFS all
speak one path language.

`normalizeClassPath` is the single gate: it converts backslashes, collapses
repeated slashes, trims a leading `./`/`/` and trailing `/`, and **throws
`InvalidClassPathError`** on `..` traversal, an empty result, or a NUL byte —
defending the OPFS and Tauri backends from escaping their roots. Every backend
normalizes on every operation.

## Backends

### WebClassVfs — OPFS (preferred on web)

Uses `navigator.storage.getDirectory()` to get the per-origin root, then scopes
everything under a named subdirectory (default `dash-classes`). A classpath maps
**1:1 onto nested OPFS directories**: each package segment is a
`getDirectoryHandle(seg, {create})` and the leaf `.as` is a
`getFileHandle(file, {create})` written via `createWritable()`. `list()` walks
the tree with the handle `entries()` async-iterator; `remove()` deletes the file
and best-effort prunes now-empty package directories.

Availability probe: `isOpfsAvailable()` (true iff
`navigator.storage?.getDirectory` is a function).

### IndexedDbClassVfs — fallback (web without OPFS)

For browsers/webviews lacking OPFS. One object store (`files`) keyed by the
normalized classpath string; value = source text. There is no real directory
tree (IndexedDB has none) — the nested-package structure is implicit in the
slashed key, which is exactly the classpath the contract already uses. `list()`
enumerates keys. The `IDBFactory` is injectable for tests (`fake-indexeddb`).

### TauriClassVfs — native FS disk mirror (desktop)

Rooted at an absolute `classes/` directory (derived from the `.fla` path via
`deriveClassesRoot`, e.g. `/proj/movie.fla` -> `/proj/classes`). Writes are
**real files** at `<root>/com/example/Foo.as`, with `mkdir({recursive:true})`
creating intermediate package directories and `readDir` walked recursively for
`list()`. Built on `@tauri-apps/plugin-fs` (`mkdir/readDir/readTextFile/
writeTextFile/remove/exists`). Detection mirrors `hooks/useFileActions.ts`'s
`isTauri()` (`"__TAURI_INTERNALS__" in window`).

### MemoryClassVfs — pure fallback

In `@flash/core`. Used headlessly (Node/SSR) and as the reference implementation
the contract tests pin. Also the factory's last resort when no storage exists.

### Factory

`createClassVfs(options?)` picks the backend:

1. **Tauri + known path** (`flaPath` or explicit `classesRoot`) -> `TauriClassVfs`.
2. **OPFS available** -> `WebClassVfs`.
3. **IndexedDB available** -> `IndexedDbClassVfs`.
4. else -> `MemoryClassVfs`.

A pathless desktop document (untitled, not yet saved) falls through to the web
backend so it still has a working VFS until it is saved to a path.

## Lifecycle: hydrate & sync

The `.fla` embed is the source of truth for portability; the VFS is the editing
surface. Two pure helpers bridge them:

- **On project open:** `hydrateVfsFromDoc(doc, vfs, { prune? })` mirrors every
  `doc.asClasses` entry into the VFS. Without `prune` it leaves extra VFS files
  untouched (so a newer external desktop edit is not clobbered); with `prune` it
  deletes VFS files absent from the doc for an exact mirror.
- **On save (and before publish):** `syncDocFromVfs(doc, vfs)` reads the VFS back
  and folds it into a **new** document via the P0 mutations (`addAsClass`), so the
  `.fla` embed re-captures all edits. Byte-identical files cause **no** history
  churn (returns the same doc reference when nothing changed); files deleted via
  the VFS are dropped from `asClasses`; non-`.as` files are ignored.

```
open:  loadFla -> doc.asClasses --hydrateVfsFromDoc--> VFS  (edited live)
save:  VFS --syncDocFromVfs--> doc.asClasses -> saveFla (.fla embed authoritative)
       (Tauri: VFS already on disk under classes/ — the mirror IS the edit surface)
```

## Exported API (for the P4 Classes panel)

From `@flash/core` (pure):

- Types: `ClassVfs`, `ClassVfsEntry`, `ClassVfsKind`, `IdentifiedClassVfs`,
  `HydrateResult`, `SyncResult`.
- Path helpers: `normalizeClassPath`, `splitClassPath`, `joinClassPath`,
  `isAsFile`, `InvalidClassPathError`.
- Backend + bridge: `MemoryClassVfs`, `createMemoryClassVfs`,
  `hydrateVfsFromDoc`, `syncDocFromVfs`.

From `@flash/authoring-ui` (platform):

- Backends: `WebClassVfs`/`createWebClassVfs`/`isOpfsAvailable`,
  `IndexedDbClassVfs`/`createIndexedDbClassVfs`/`isIndexedDbAvailable`,
  `TauriClassVfs`/`createTauriClassVfs`/`isTauri`/`deriveClassesRoot`.
- Factory: `createClassVfs(options?)` -> `IdentifiedClassVfs`.
- Option types: `WebClassVfsOptions`, `IndexedDbClassVfsOptions`,
  `TauriClassVfsOptions`, `CreateClassVfsOptions`.
- (The full core surface above is also re-exported from `@flash/authoring-ui` so
  the panel can import everything from one module.)

Typical panel usage:

```ts
import {
  createClassVfs, hydrateVfsFromDoc, syncDocFromVfs,
} from "@flash/authoring-ui";

const vfs = createClassVfs({ flaPath });          // platform-correct backend
await hydrateVfsFromDoc(doc, vfs);                // on open
// ... user edits go through vfs.write(path, source) / vfs.remove(path) ...
const { doc: nextDoc } = await syncDocFromVfs(doc, vfs); // on save
```

## Tests

- `@flash/core` `src/vfs/__tests__/vfs-core.test.ts` — path normalization +
  traversal rejection, `MemoryClassVfs` round-trip, and the hydrate/sync
  doc<->VFS round-trip (edit, add, delete, no-churn, prune).
- `@flash/authoring-ui` `src/__tests__/`:
  - `vfsOpfs.test.ts` — `WebClassVfs` against an in-memory fake OPFS handle tree.
  - `vfsIndexedDb.test.ts` — `IndexedDbClassVfs` against `fake-indexeddb`.
  - `vfsTauri.test.ts` — `TauriClassVfs` against a mocked `@tauri-apps/plugin-fs`.
  - `vfsFactorySync.test.ts` — factory backend selection + a hydrate/sync
    round-trip against the real IndexedDB fallback backend.
