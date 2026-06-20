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
`preview/startAt.ts` does the Flash-author trick: it prepends a
`gotoAndPlay(frame)` (or `gotoAndPlay("Scene", frame)` for a later scene) to the
movie's first keyframe on a SHALLOW-CLONED document, then compiles the clone.
The real editor document is never mutated, and any author script on that frame
still runs after the seek. Frame numbers are clamped to the scene length.

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
  restores console interceptors on unmount; `useLivePreview` disposes the
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
