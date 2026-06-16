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
- **One registry for the UI dispatchers; the model layer for the programmatic
  ones.** Menu and keyboard — the dispatchers that genuinely duplicated handler
  logic — both dispatch commands by id (`dispatch("timeline.insertKeyframe")`)
  through the registry, with one shared `isEnabled`. The keyboard is driven by
  `dispatch/keyboard.ts` (`resolveKeyBinding`), replacing the old
  `useKeyboardShortcuts`. The **agent and JSFL are parameterized programmatic
  APIs** (`stage_add_shape` targets an explicit `layerId`/`frameIndex`; UI
  commands act on the *active* layer/frame), so they intentionally converge one
  level lower — they call the same `@flash/core` functions and store actions the
  commands do, rather than re-implementing model logic. That shared-model
  convergence is the actual anti-duplication win for them; routing them through
  the active-state UI commands would break their parameterization.
- **Section components read their own UI state from the store** (via `useUiStore`)
  and take only document data + action handlers as props. Derive handler prop
  types from the child component with `React.ComponentProps<typeof X>["onY"]` so
  they stay compatible by construction.

## Status

Complete: the per-instance stores (document + UI), pure selectors, the command
registry (41 commands across history/timeline/edit/editor/view/playback with
`isEnabled`), the unified **keyboard + menu** dispatch onto the registry, and the
JSX decomposition into `layout/` sections (dialogs, panels, manage-commands,
overlays). Agent/JSFL converge at the shared model layer by design (see above).

Optional future polish (not load-bearing for the architecture): migrate the
remaining delegating `commands/editor.ts` bodies off Shell into command modules;
drive MenuBar greyed-out enabled-state from the registry across all items (today
it's wired for undo/redo); extract the bottom-dock/right-panel wiring (already
thin prop-wiring around StageArea/Timeline/PropertiesPanel, so low value).
