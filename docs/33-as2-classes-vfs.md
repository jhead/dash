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

## Classes panel UI (P4)

The Classes panel (`packages/authoring-ui/src/ClassesPanel.tsx`) is a NEW
bottom-dock tab — **Classes**, alongside Actions / Sound / Output (and the
right-pane Library) — for authoring external `.as` class files by hand.

Layout — two panes:

- **Left: a file TREE** of package folders + `.as` files (`buildClassTree` in
  `classTree.ts` nests the slashed classpaths into folders-first, alphabetical
  nodes). Toolbar `＋ New` adds a class; each file row has a delete (`✕`) action;
  double-click a file to rename it inline. A sensible empty state prompts the
  user to create the first class (e.g. `com.example.Main`).
- **Right: the REUSED `ScriptEditor`** from `ActionsPanel.tsx` (now exported),
  so every `.as` file gets AS2 syntax highlighting + the live parse-error gutter
  for free. The editor is keyed on the selected path so switching files resets
  cleanly.

Data flow — the `.fla` embed (`doc.asClasses`) stays authoritative; the VFS is
only the editing surface:

```
mount/open : createClassVfs({ flaPath })   // platform-correct backend
             hydrateVfsFromDoc(doc, vfs, { prune:true })   // exact mirror
edit       : vfs.write(path, source)  --(debounced ~600ms)--> syncDocFromVfs -> pushDoc
add (New)  : vfs.write(newPath, defaultClassSource) -> syncDocFromVfs -> pushDoc
remove (✕) : vfs.remove(path)                       -> syncDocFromVfs -> pushDoc
rename     : vfs.write(new, body) + vfs.remove(old) -> syncDocFromVfs -> pushDoc
```

`syncDocFromVfs` returns the SAME doc reference when nothing changed, so
`pushDoc` (history-safe) is only called on a real mutation — no history churn on
no-op saves. The panel re-creates + re-hydrates the VFS only when `flaPath`
changes; in-session doc edits flow through the editor write path, not a
re-hydrate (which would clobber unsaved edits). Pure helpers
(`classTree.ts`: tree building, `classNameToPath`, `validateClassPath`,
`defaultClassSource`) keep the testable logic DOM-free.

The dock wiring lives in `Shell.tsx`: `"classes"` is added to the `BottomTab`
union (`store/uiStore.ts`), the persisted `BOTTOM_TABS` allowlist
(`editorLayout.ts`), the `BOTTOM_TABS` tab-bar list, and the bottom-dock content
switch mounts `<ClassesPanel doc pushDoc flaPath onClose />`. Desktop + narrow
responsive behavior (task 1280) is unchanged — Classes is just another dock tab.

## Agent chat tools (P3)

The agent (MCP + in-browser chat) authors classes through five commands that read
and mutate `doc.asClasses` directly via the P0 mutations (`addAsClass`,
`updateAsClass`, `removeAsClass`) and `cb.getDoc()`/`cb.pushDoc()` (history-safe).
They operate on the same classpath-relative paths as the VFS. The chat tool bridge
(`packages/authoring-ui/src/agentchat/tools.ts`) auto-generates these from
`COMMAND_SCHEMAS`/`COMMAND_DESCRIPTIONS`, so they reach the chat with no per-tool
code.

| Command | Behavior |
|---------|----------|
| `class_list` | `[{ path, className }]` derived from `doc.asClasses` (`className` from the parsed `class`/`interface` decl, else the dotted path) |
| `class_get {path}` | `{ source }` (not-found error) |
| `class_set {path, source}` | parse-checks (parser only — see below), upserts via `addAsClass`/`updateAsClass` + `pushDoc`, returns `{ ok, rev, diagnostics }` |
| `class_remove {path}` | `removeAsClass` + `pushDoc` (not-found error) |
| `class_check {source}` | parse-only diagnostics, no write |

Parse-only diagnostics: `class_set`/`class_check` run **only** the AS2 parser
(`@flash/core` `parse`), not the AVM1 bytecode compiler — class files declare
`class`/`interface` constructs the frame-script compiler does not emit. Like
`script_set`, a class is saved even when it has parse errors (Flash 8 parity);
callers inspect `diagnostics`. The parser accepts fully-qualified packaged class
names (`class com.example.Enemy`), matching real AS2.

To bind a symbol to a class, `library_set_linkage` accepts a `className` (alongside
`linkageId` and the export flags), wired through `setSymbolLinkage`
(`SymbolLinkage.className`).

## Binary Flash 8 `.fla` export compatibility (P5)

A `dash` project with AS2 classes can be exported to a **genuine binary Flash 8
`.fla`** (`saveRealFla`, the OLE2/CArchive writer — distinct from the portable
`.fla` zip) that opens in real Macromedia Flash 8. Two pieces matter for class
support, and they are handled very differently:

### 1. The `.as` class files are EXTERNAL classpath files — not embedded

Real Flash 8 does **not** store `.as` source inside the binary `.fla`. It keeps
classes as external files on the classpath (typically a `classes/` directory
beside the `.fla`, the same package-directory convention `doc.classpaths` /
`deriveClassesRoot` model). The binary writer therefore **does not** embed
`doc.asClasses` into the binary `.fla`. The classpath expectation on export:

- On **desktop (Tauri)** the classes already live as real files under
  `<flaDir>/classes/` (the disk mirror), so a binary `.fla` exported next to them
  finds them on the default classpath `.` — exactly how Flash 8 resolves classes.
- For the **portable** workflow keep using the `.fla` **zip** (which embeds the
  classes); the binary `.fla` is the interchange-with-real-Flash artifact and
  assumes the classpath files are present beside it.

### 2. The per-symbol `AS 2.0 class` linkage (`className`) IS written into the Symbol record

The compat-critical field is the per-symbol **AS 2.0 class** binding
(`SymbolLinkage.className`) that Flash 8 stores in the Contents-stream
`CDocumentPage` record for each symbol (the *writeAsLinkage* block). The writer
(`packages/core/src/fla/write/contents-write.ts`, `writeSymbolTail`) encodes it:

- **Empty-linkage symbols** emit the exact constant `FixedPageTail`
  byte-for-byte, so the **byte-exact Flash 8 oracle** (`empty-bytematch.test.ts`,
  a class-free empty doc) is preserved by construction (the symbol-linkage write
  path is never taken for a class-free document).
- **Symbols with a className** get the className spliced into the empty className
  `BomString` slot of the writeAsLinkage block (offset `tail+0x31`), and the
  flags byte (offset `tail+0x25`) set (`bit0`=exportForActionScript,
  `bit1`=importForRuntimeSharing). The block's length field (`tail+0x1C`) counts
  only the linkageIdentifier+URL BomStrings (both kept empty here), so it is
  unchanged — the change is strictly additive.

The reader (`flash8-binary.ts parseFla8Contents`) decodes className back from the
same block. Round-trip is gated by
`packages/core/src/fla/__tests__/classname-binary-roundtrip.test.ts`
(set className → write → read back → equal; plus deterministic re-save and the
strict `validateContentsStream` CArchive acceptance check).

### Verification scope / known limit

The writeAsLinkage byte layout (zero-prefix → version `0x07` → flags →
linkageIdentifier/URL/className BomStrings) is **verified against a real Flash 8
fixture** — `fixtures/golden/golden.fla`'s "Coin" symbol (a genuine
`exportForActionScript` symbol), whose `className` happens to be empty there. No
available real fixture carries a **non-empty** className, so the non-empty
className splice is validated by (a) our own decoder round-trip and (b) the strict
sequential CArchive reader accepting the stream — the strongest evidence short of
a real Flash 8 oracle. The conservative encoding (only the className BomString is
filled; identifier/URL stay empty; the length field is unchanged; empty-linkage
symbols are byte-identical) was chosen specifically so that the change **cannot**
corrupt the byte-exact oracle or the empty-document export. The fuller Flash 8
linkage tail (the post-className `version + UI32 + sourceFlaPath + fullLibraryPath`
sub-record and the variable length field that golden's "Coin" carries) was
investigated but **not** reproduced byte-for-byte, because its length-field
semantics could not be generalized from a single empty-className fixture and a
wrong value risks an export real Flash 8 would reject. The runtime class binding
(className → SWF `Object.registerClass` DoInitAction → `attachMovie`) is
independent of the binary `.fla` and is proven end-to-end by
`apps/desktop/e2e/as2-class-attach.spec.ts` and the P5 capstone
`apps/desktop/e2e/as2-class-capstone.spec.ts`.

### Linkage dialog autocomplete (P5)

The Symbol Linkage dialog's **AS2 Class** field offers autocomplete suggestions
(a native `<datalist>`) sourced from `doc.asClasses`: `deriveAsClassNames`
(`LibraryPanel.tsx`) maps each classpath-relative `.as` path to its dotted
fully-qualified class name (`com/example/Foo.as` → `com.example.Foo`),
de-duplicated and sorted. So after authoring a class in the Classes panel you can
pick it by name when linking a library symbol.

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
  - `classTree.test.ts` — pure Classes-panel helpers: tree nesting/sorting,
    `classNameToPath` (dotted/slashed), `validateClassPath` (dupes, bad
    identifiers, traversal), `defaultClassSource`.
  - `classesPanel.test.ts` — the Classes panel mounted with an injected
    `MemoryClassVfs`: empty state, hydrate+select, and tree add/remove/rename +
    editor load/save all update BOTH the VFS and `doc.asClasses` via `pushDoc`.
  - `editorLayout.test.ts` — the `"classes"` bottom-dock tab round-trips through
    layout persistence.
  - `symbolLinkageClassAutocomplete.test.ts` — `deriveAsClassNames`: `.as` path →
    dotted class name, de-dup + sort, non-`.as` ignored, empty when no classes.
- `@flash/core` `src/fla/__tests__/classname-binary-roundtrip.test.ts` — binary
  Flash 8 `.fla` className linkage: write `SymbolLinkage.className` → read back
  equal (dotted + bare names, importForRuntimeSharing flag, multiple symbols),
  strict-CArchive acceptance, empty-linkage byte-unchanged, deterministic re-save.
- `apps/desktop/e2e/as2-class-capstone.spec.ts` — the P5 capstone: author a `.as`
  class through the Classes panel UI, link it to a library MovieClip via the
  Symbol Linkage dialog (export + identifier + className autocomplete), publish,
  and assert the attached instance's `speak()` `trace()` arrives in real Ruffle.
