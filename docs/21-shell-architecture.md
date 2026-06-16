# Shell architecture — Document/View + Commands

`packages/authoring-ui/src/Shell.tsx` was a ~6700-line god component that owned
all state, all handlers, command dispatch, and the full layout. It is being
refactored into the Document/View + Command architecture that native creative
apps (Flash 8 itself was MFC Document/View) use. This doc describes the target
structure and the conventions to follow when extending it.

## Layers

```
packages/authoring-ui/src/
  store/
    history.ts        pure history reducer (reused by the store; React-free)
    documentStore.ts  Zustand store: HistoryState + pushDoc/replaceDoc/commitDrag/
                      undo/redo; with{Scene,Symbol}Timeline/withLibrary/withProperties
                      helpers; selectDoc/selectCanUndo/... selectors
    uiStore.ts        Zustand store: ~60 ephemeral UI fields in slices, each with a
                      setState-compatible setter (value | (prev=>next)); owns
                      EditContext/BottomTab/... types + DEFAULT_TOOL_STATE
    createStores.ts   factory → { documentStore, uiStore } (per-instance, NOT singletons)
    StoreProvider.tsx React context + useStores/useDocumentStore/useUiStore hooks
  selectors/
    derived.ts        pure (doc) derivations: per-layer display-object collections,
                      library filters, instanceNamesOf
    active.ts         resolveActiveTimeline / withActiveTimeline / activeLayerId
                      (mirror Shell's context-aware timeline resolution)
  commands/
    types.ts          EditorCommand { id, label, shortcut?, isEnabled?, run } + CommandContext
    registry.ts       createCommandRegistry: register / dispatch / isEnabled
    history|timeline|edit|view|playback.ts  command modules
    index.ts          createPopulatedRegistry()
  layout/
    ShellDialogs / ShellPanels / ManageCommandsDialog / ShellOverlays
                      JSX sections; subscribe to store slices, take handlers as props
  Shell.tsx           owns the stores + command registry, wires the core layout
```

## Conventions

- **Stores are per-instance, created by `createStores()` and provided via
  `StoreProvider`.** Never module singletons — that leaks state between test
  renders (see CLAUDE.md test-harness notes). Non-React callers (agent/JSFL/test
  bridges) read live state via `store.getState()` — this is why the old
  `latestDocRef` stale-closure workaround is gone.
- **UI-state setters mimic React's `useState` setter** (`value | (prev => next)`),
  so migrating a `useState` into `uiStore` requires no call-site changes — Shell
  binds the same identifiers via one `useStore(uiStore)` destructure.
- **Commands orchestrate; they do not re-implement model logic.** The actual
  mutations stay in `@flash/core` pure functions. A command reads live state from
  the stores and mutates via `services.pushDoc` (the rev-bumping path) or a store
  action. Component-coupled behaviour (playback RAF, publish, screenshot) is
  reached through `CommandServices`.
- **One registry, many dispatchers.** Menu and keyboard already dispatch commands
  by id (`dispatch("timeline.insertKeyframe")`) with centralized `isEnabled`.
  Agent/JSFL still converge at the store level; routing them through the registry
  is the remaining Phase 5 work.
- **Section components read their own UI state from the store** (via `useUiStore`)
  and take only document data + action handlers as props. Derive handler prop
  types from the child component with `React.ComponentProps<typeof X>["onY"]` so
  they stay compatible by construction.

## Status / remaining

Done: store + selectors + command registry (history/timeline/edit/view/playback)
+ JSX sections (dialogs, panels, manage-commands, overlays). Remaining: broaden
command coverage (arrange/group/clipboard/transform/scene/tool/text), unify the
agent/JSFL dispatchers and drive keyboard from `command.shortcut` metadata, and
extract the bottom-dock/right-panel wiring if it proves worthwhile (those are
already thin prop-wiring around StageArea/Timeline/PropertiesPanel).
