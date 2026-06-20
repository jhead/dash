# Persistent Projects (browser) — autosave, Save As slots, Open Recent

**Task 1310.** On the web, a page refresh (F5) must not lose work. This feature
persists the active document to the browser so a reload restores the exact
in-progress state, names projects in storage via **Save As**, and surfaces an
**Open Recent** list. On Tauri (desktop) projects remain real `.fla` files on
disk; the web IndexedDB mechanism is not used there (see [Tauri](#tauri) below).

## Why this exists

`.fla` save/open already works (download/upload in the browser,
`@tauri-apps/plugin-fs` on desktop). But in the browser a refresh threw away
everything since the last manual download. This adds an automatic, transparent
persistence layer **on top of** the existing save/open — Save/Open still produce
real `.fla` files; persistence is the new safety net + named-slot convenience.

## Storage design

A Dash project is a serialized `.fla` (`saveFla(doc) → Uint8Array`) that can be
multi-MB once it embeds bitmaps/sounds. That rules out `localStorage` (≈5 MB,
strings only). So:

| Data | Where | Why |
|------|-------|-----|
| Serialized `.fla` bytes + metadata | **IndexedDB** (`dash-projects` DB, one `projects` object store keyed by name) | Binary, large quota |
| Active project name + Open Recent list | **localStorage** (`flash8.recentProjects`) | Tiny, must be read synchronously on first render, survives an IndexedDB wipe |

### IndexedDB project store — `projects/projectStore.ts`

One object store (`projects`), `keyPath: "name"`. Each record:

```ts
{ schemaVersion, name, bytes: Uint8Array, updatedAt, sizeBytes, thumbnail? }
```

Mirrors the established `vfs/indexeddb.ts` pattern: injectable `IDBFactory` (so
`fake-indexeddb` works in node unit tests), promisified requests, awaited
transaction completion for durability. `PROJECT_SCHEMA_VERSION` gates migration;
`normalizeRecord()` tolerates a missing/old schema and rejects junk so one
corrupt record never bricks restore-on-load. Quota-exceeded writes are wrapped
in `ProjectQuotaError` so the autosave caller degrades gracefully (the in-memory
document is untouched; only persistence is skipped).

The **current-working** autosave slot is a reserved name (`CURRENT_WORKING_KEY =
"__dash_current__"`), excluded from `list()`, so F5 restores in-progress work
even for a project that has never been named.

### Recent list + active name — `projects/recentProjects.ts`

`localStorage`-backed, with the same hygiene as `preferences.ts`/`editorLayout.ts`:
a versioned envelope (`{ version, state }`), a `normalize()` guard that
de-duplicates by id and **caps at 15** (`RECENT_PROJECTS_CAP`), and try/catch
around every access (quota / privacy-mode safe). An entry is
`{ id, label, updatedAt }`; on the web `id` is the project name, on Tauri it is
the file path.

## Autosave + restore-on-load

### Debounced autosave — `projects/autosaveController.ts`

A framework-free, fully node-testable engine (mirrors
`preview/livePreviewController.ts`): timers and the clock are injected. On every
document mutation `schedule(doc)` re-arms a single ~1.5 s debounce capturing only
the **latest** doc; after the quiet period it serializes once and persists to the
current-working slot **and** (if a named project is active) the named slot. A
monotonic **generation** counter is the supersession authority — a stale
in-flight persist can never overwrite newer bytes. `flush()` forces an immediate
save (used by the `pagehide`/`visibilitychange` listeners and explicit Save).

### Restore-on-load — `projects/projectSession.ts` + `useProjectActions.ts`

Once on mount (web only), `restoreOnLoad()`:

1. If the **current-working** slot exists → restore it (exact in-progress state).
   Its active name is the last-active project name, when that named project still
   exists.
2. Else if there is a remembered active named project → load it.
3. Else → return null; the app starts a fresh `createDocument()` as before.

Unparseable bytes return null (never throw), so a corrupt slot falls through to a
fresh doc.

## Save As naming & plain Save

`projectSession.saveNamed()` writes the document under a sanitized name
(`sanitizeProjectName` trims, strips `.fla`, rejects empties + the reserved key)
**and** mirrors it into the current-working slot, then touches the recent list so
the project becomes most-recent + active. The active name is reflected in the
**title bar** (the `EditBar` `documentName`).

- **Save As** (File menu, web): prompts for a name → `saveNamed` → also triggers a
  downloadable `.fla` copy so the user keeps an on-disk file.
- **Save** (web): writes the active named slot via `saveProject`. If there is no
  active named project yet, it falls through to Save As (prompt).

## Open Recent

The File menu renders the recent list inline (the dropdown is single-level), most
-recent-first, capped to 15, with a **Clear Recent** entry (delete-from-recent).
Selecting one loads the project (`openNamed`) and makes it active; a stale entry
(project since deleted) is dropped automatically.

## Tauri

On desktop, projects are real `.fla` files. The IndexedDB autosave/restore path
is skipped (`isTauri()` branch). Instead the same recent list tracks recent file
**paths**: a desktop Save records its path via `noteOpenedPath`, so the recent
list reflects on-disk files and the last path can be reopened on launch. Desktop
Save/Open behaviour is otherwise unchanged.

## Files

| File | Role |
|------|------|
| `packages/authoring-ui/src/projects/projectStore.ts` | IndexedDB store (bytes + metadata, quota mapping, schema version) |
| `packages/authoring-ui/src/projects/recentProjects.ts` | localStorage active-name + recent list (hygiene, cap, dedup) |
| `packages/authoring-ui/src/projects/autosaveController.ts` | Debounced/superseding autosave engine (injectable timers) |
| `packages/authoring-ui/src/projects/projectSession.ts` | Save As / Save / Open / restore-on-load orchestration |
| `packages/authoring-ui/src/projects/useProjectActions.ts` | React adapter wiring it to the document store + Shell |
| `packages/authoring-ui/src/MenuBar.tsx` | File menu: Open Recent, web Save/Save As routing |
| `packages/authoring-ui/src/Shell.tsx` | Mounts `useProjectActions`; title-bar name; DEV test bridge |

## Tests

- Unit (`fake-indexeddb`, node): `projectStore.test.ts` (round-trip, list order,
  delete, current-working slot, quota fallback), `autosaveController.test.ts`
  (debounce, latest-wins, flush, cancel, error/saved callbacks),
  `recentProjects.test.ts` (persist, touch/dedup/cap, remove, parse fallback),
  `projectSession.test.ts` (Save-As naming, restore-on-load incl. F5 recovery +
  fallback + unparseable, open-named).
- E2E (`apps/desktop/e2e/persistent-projects.spec.ts`): edit → reload → restored;
  Save As `<name>` → title bar + recent list → reload → reopens the named project;
  plain Save updates the active slot.
