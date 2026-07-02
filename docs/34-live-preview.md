# Live Preview tab (task 1308)

A modern, frontend-style DX surface on top of the existing publish + Ruffle
paths: a **Live Preview** tab docked at the TOP alongside the Timeline that
re-compiles the document to SWF on every change (debounced) and hot-reloads an
embedded Ruffle player — like React fast-refresh, but for a Flash movie.

This is an *additive* DX feature. It is NOT a fidelity requirement and does not
change the compiler or the published SWF; it only orchestrates the existing
`compileDocument` + `RufflePlayer` paths.

## Where it lives in the UI

The top dock (the region beside the stage that holds the Timeline) is now a
two-tab strip: **Timeline | Live Preview**. Clicking a tab switches the dock
content; clicking the active tab collapses the dock (same affordance the
single Timeline toggle had). The active top tab persists across reloads.

- `uiStore.topTab: "timeline" | "preview"` — active top-dock tab.
- Wiring in `Shell.tsx` top-dock block (search `top-tab-preview`).

## The hot-reload loop

```
documentStore change ──▶ debounce(~350ms) ──▶ compile (background, async)
        │                       │                      │
   (auto-reload on)        coalesce rapid          supersede in-flight:
                            edits to one           only the NEWEST compile
                                                   may publish bytes
                                                          │
                       success ──▶ swap SWF into Ruffle, status = up-to-date
                       error   ──▶ KEEP last-good SWF, status = error + banner
```

The loop is split into a **pure controller** and a **thin React adapter** so the
core semantics are unit-tested with no DOM:

- `preview/livePreviewController.ts` — `LivePreviewController`: debounce +
  supersede (a monotonic generation counter is the supersession authority, so an
  out-of-order resolution of a stale compile can never overwrite a newer one) +
  last-good retention. Injectable timers/clock for deterministic tests.
- `preview/useLivePreview.ts` — subscribes to the documentStore, applies the
  start-from-scene/frame seek, and calls the existing publish path; disposes the
  controller on unmount / tab-switch so no pending compile or Ruffle reload leaks.
- `preview/LivePreviewPanel.tsx` — the panel UI (status pill, controls, error
  overlay) hosting `@flash/player`'s `RufflePlayer`.

### Reusing the compiler (no duplication)

`usePublish` gained `compileDocToBytes(targetDoc, { skipSystemFontPrompt })`,
which runs the FULL publish pipeline (bitmap pixel decode + embedded-font
resolution + `compileDocument`) on any document. The preview passes a derived
doc and `skipSystemFontPrompt: true` so a background hot-reload never triggers
the Local Font Access permission prompt (that path is reserved for the
user-initiated Publish / Test Movie). `publishToBytes()` now delegates to it.

### Start-from-scene / frame

SWF has no start-frame field and the bundled Ruffle API has no pre-tick seek, so
`preview/startAt.ts` does the Flash-author trick: it prepends a `gotoAndPlay` /
`gotoAndStop` to the movie's first keyframe on a SHALLOW-CLONED document, then
compiles the clone. The real editor document is never mutated, and any author
script on that frame still runs after the seek. Frame numbers are clamped to the
scene length.

The seek always targets an **absolute frame number** on the compiled main
timeline — `gotoAndPlay(absFrame)`, never the two-argument scene-NAME form. The
compiled timeline is the concatenation of every scene's frames, so a target
"scene S, frame F" maps to `absFrame = (sum of frameCount of scenes 0..S-1) + F`
(the per-scene length uses the same `layerFrameCount` the SWF compiler uses, so
the offset lands exactly where the compiler placed that scene). This matters
(task 1339): the AS2 compiler's `gotoAndPlay`/`gotoAndStop` builtins only support
the single-arg NUMERIC form — they compile `args[0]` and emit
`ActionGotoFrame2`, dropping any second argument and never resolving a scene
name. The old `gotoAndPlay("Scene", frame)` form pushed the scene name as a
FRAME LABEL (scenes are not frame labels), so the goto found nothing and the
preview silently stayed on frame 1; the start-scene override appeared ignored.

## Error handling

A compile error (e.g. a malformed AS2 frame script makes `compileDocument`
throw) does NOT blank the preview. The controller keeps the last successfully
compiled SWF on screen, sets status to `error`, and the panel shows a
non-blocking, dismissable-looking error banner (React-error-overlay style) with
the compiler message. The next successful compile clears it.

## Live-dev controls

The panel's control bar exposes:

- **Status pill** — Up-to-date / Compiling… / Error (with the message as title).
- **Auto-reload** toggle — recompile on document changes (persisted).
- **Reload** — force an immediate recompile (bypasses the debounce).
- **Restart** — reload the current SWF from frame 1.
- **Play / Pause** — via the `<ruffle-player>` element's playback API.
- **Start scene / Start frame** — begin playback at a scene/frame (persisted).
- **Mute**, **Loop**, **Quality** (low/medium/high/best), **Background**
  (document/white/black/checker), **Scale-to-fit** + **Zoom**.
- **Stats** — last SWF size + last compile time (ms).

## trace() / runtime output → Output panel (task 1312)

The SWF running in the Live Preview tab routes its AS2 `trace()` lines (and
Ruffle's own ERROR/WARN runtime diagnostics) to the SAME **Output panel** the
Test Movie flow uses — so debugging a movie while you author it works without
leaving the editor.

How it is wired:

- `RufflePlayer` already captures `trace()` via Ruffle's dedicated trace observer
  (`<ruffle-player>.traceObserver` → `set_trace_observer`; see task 1259) and
  surfaces each line through its `onTrace` prop. The bug was simply that the
  Live Preview's `<RufflePlayer>` was rendered WITHOUT an `onTrace`, so the
  captured lines had nowhere to go.
- `LivePreviewPanel` now takes an `onTrace` prop, wired in `Shell.tsx` to the
  **same `handleTrace`** that Test Movie uses (`useExportHandlers.handleTrace` →
  `uiStore.setOutputMessages`). Both routes therefore feed one Output store; the
  lines appear in `OutputPanel` (`data-testid="output-panel-messages"`).

Unlike Test Movie, the preview does NOT clear the Output panel or force-switch
the bottom dock to the Output tab on each hot-reload (that would be intrusive
during continuous editing). Trace lines accumulate in the store and are visible
whenever the Output tab is open.

### No duplicate / no leak across the hot-reload loop

- `RufflePlayer` registers exactly ONE trace observer per `load()` so a
  debounced hot-reload never stacks duplicate observers. A changing `onTrace`
  callback identity does not reload Ruffle (it is read through a ref).
- The console.log/console.warn scrape (Ruffle diagnostics → Output panel) is
  patched through a REF-COUNTED module-level interceptor
  (`consoleIntercept.ts` `installConsoleSink`), NOT a per-instance swap. It
  captures the pristine console methods exactly once (first sink) and restores
  them exactly once (last sink); a single shared wrapper fans out to every
  registered sink. Each `RufflePlayer` registers one sink on first load and
  removes it on unmount. This is required because BOTH the Test Movie modal and
  the Live Preview tab embed `RufflePlayer`, so two instances can be mounted at
  once — the old per-instance swap let instance B capture A's wrapper as its
  "original", and an interleaved unmount (A restores the real console, then B
  restores A's wrapper) left `console.log` permanently pointing at a stale
  wrapper (task 1402). Ref-counting makes any mount/unmount interleaving safe.
- `LivePreviewPanel` wraps `onTrace` so each NEW compiled SWF (a fresh
  `swfBytes` identity) emits a subtle `─── reload ───` separator on its first
  trace, lazily — a reload that produces no trace adds no separator. Lines keep
  appending across reloads (history is preserved); they are never silently
  cleared.

## Preferences persistence

`preview/previewPrefs.ts` persists the durable preview prefs (auto-reload, start
scene/frame, quality, zoom, scale-to-fit, mute, loop, background) to a versioned
localStorage key with the same normalize/clamp hygiene as `editorLayout.ts`. The
active top tab is persisted via `editorLayout`.

## Performance / lifecycle

- The UI thread never blocks on compile: `compileDocToBytes` is async; the
  controller debounces and supersedes so a fast typist never queues a stack of
  compiles.
- No leaked Ruffle instances: `RufflePlayer` removes its `<ruffle-player>` and
  unregisters its console sink on unmount (the shared module-level interceptor
  restores the pristine console methods only when the LAST player unmounts, so a
  still-mounted sibling player keeps working); `useLivePreview` disposes the
  controller on tab-switch/unmount.

## Tests

- `__tests__/livePreviewController.test.ts` — debounce coalescing, in-flight
  supersession (stale result discarded), error-keeps-last-good + recovery,
  size/time capture, dispose cancellation.
- `__tests__/livePreviewStartAt.test.ts` — seek-script generation + clone-apply.
- `__tests__/previewPrefs.test.ts` — normalize/clamp + persistence round-trip.
- `apps/desktop/e2e/live-preview.spec.ts` — Playwright oracle: open the tab,
  edit the doc → preview SWF updates; introduce a compile error → preview stays
  + error overlay shown; fix → recover. (Runs against the bundled Ruffle; like
  the other Ruffle oracles it is skipped in CI until WASM infra is set up.)
- `apps/desktop/e2e/live-preview-trace.spec.ts` (task 1312) — Playwright oracle
  mirroring `trace-output.spec.ts` but via the Live Preview tab: a doc whose
  frame 1 calls `trace()` runs in Live Preview and the message appears in the
  Output panel; a hot-reload appends the next run's trace WITHOUT duplicating
  either run's line (the no-duplicate-listener guarantee) and inserts a reload
  separator between runs.
