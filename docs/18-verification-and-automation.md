# 18 — Verification & Agent Automation

How functionality in this clone is verified end-to-end, and how LLM agents author and
run those verifications autonomously. This doc makes concrete the "regression harness"
called for in `00-overview-and-architecture.md` §Accuracy strategy (5).

## Why this exists

Most work here is done by agents that cannot manually click around the app. History has
shown the failure mode: every MVP story 0001–0036 was marked *done* while none of the
end-to-end pipelines (publish → playback, save → open, undo, tweens) actually worked.
Unit tests inside one package cannot catch cross-package drift; only end-to-end oracles
can. The design goal everywhere is therefore:

> **Every behavior must be assertable as text or structure first** — JSON document
> state, decoded tag trees, trace logs — **with pixels as a supplement, not the
> primary oracle.** LLMs act reliably on textual diffs; they act poorly on "the
> screenshot looks wrong."

Four layers, ordered by value-per-effort and by how deterministic they are:

| Layer | What it verifies | Oracle type | Flakiness |
|-------|------------------|-------------|-----------|
| 1. SWF verification harness | Encoder correctness, runtime semantics | Decoded structure + trace text | None (pure Node + headless Ruffle) |
| 2. Authoring automation bridge | UI flows mutate the document correctly | Document-model JSON | Low (real browser, text assertions) |
| 3. Visual cross-check oracle | Pixel fidelity: stage renderer vs player | Perceptual image diff | Medium (mitigated, see below) |
| 4. JSFL scripting surface | Everything above, via Flash's own automation API | Script return values + doc state | Low |

---

## Layer 1 — SWF verification harness (`packages/swf-verify`)

Pure-Node verification of published SWF bytes. Two independent oracles:

### 1a. Parse-back oracle (independent decoder)

Never test the encoder only against itself. A third-party SWF decoder parses every
published file back into a structural tag tree; tests assert on that tree.

- **Decoder:** the `swf-parser` npm package (open-rs/swf ecosystem) as the primary
  oracle. Optionally cross-check with JPEXS FFDec's CLI (`ffdec -dumpSWF`) in CI for a
  second opinion; do not make local dev depend on a Java toolchain.
- **Shape of a test:** build a `FlashDocument` programmatically with `@flash/core`,
  run `compileDocument`, decode, and assert on the decoded structure:

  ```ts
  const doc = docWith(rect({ x: 10, y: 10, w: 100, h: 50, fill: red(),
                             stroke: solid({ caps: "none", joints: "miter" }) }));
  const tags = decodeSwf(compileDocument(doc));
  const shape = tags.find(isDefineShape4);
  expect(shape.lineStyles[0]).toMatchObject({ startCap: "none", joinStyle: "miter",
                                              miterLimit: 3 });
  expect(tags.filter(isShowFrame)).toHaveLength(doc frameCount);   // span semantics
  expect(placesAndRemoves(tags)).toBalanceDepths();                // display-list sanity
  ```

- **Failure output is a structural diff** — exactly what an agent needs to fix an
  encoder bug. A decode *error* (e.g. "failed to fill whole buffer", as seen live with
  the LINESTYLE2 byte-order bug, task 0067) fails the test with the byte offset.
- **Fixture corpus:** `fixtures/docs/*.json` — small serialized FlashDocuments, one per
  feature axis (each fill type, each stroke cap/join, gradients, text, bitmap, sound,
  sprite, tween span, multi-layer, mask). Every encoder story MUST add fixtures for the
  feature it touches. If reference SWFs produced by real Flash 8 are ever available,
  store them under `fixtures/golden-swf/` and add byte/structure comparisons.

### 1b. Trace-based runtime tests (Ruffle as referee)

Ruffle's own regression suite is `test.swf` + `expected_output.txt` of `trace()` lines.
We adopt the same pattern to verify *runtime semantics* — timeline control, AVM1
bytecode (0055/0066), display-list behavior:

- A test authors a document whose frame scripts trace assertions:

  ```actionscript
  // frame 1
  trace("frame=" + _currentframe);  stop();
  ```

- The runner publishes it, loads the SWF into the **web Ruffle build we already vendor**
  (`@ruffle-rs/ruffle`) inside a headless Playwright page, captures trace output (Ruffle
  emits traces to the console / log callback), runs N frames, and compares against an
  `expected.txt` next to the test. Text in, text out.
- The Ruffle native `exporter` binary is an optional alternative runner (no browser),
  but it adds a Rust/binary download to the toolchain — keep it out of the default path.

**Commands:** `pnpm verify:swf` runs 1a (vitest, fast, no browser); `pnpm verify:runtime`
runs 1b. Both are part of root `pnpm verify`.

---

## Layer 2 — Authoring automation bridge + e2e suite

Verifies the *authoring UI*: that gestures and commands mutate the document model the
way Flash 8 specifies. Real browser, real event handlers — but assertions read the
model, not pixels.

### The bridge: `window.__flashTest`

A dev/test-only API installed by the Shell when `import.meta.env.DEV` or
`VITE_FLASH_TEST=1`:

```ts
interface FlashTestBridge {
  // ---- read (the assertion surface) ----
  getDocument(): FlashDocument;          // deep-cloned current document
  getSelection(): SelectionState;
  getEditContext(): EditContext;         // document vs symbol being edited
  getViewState(): { zoom; panX; panY; activeLayerId; currentFrame };
  getHistoryDepth(): { undo: number; redo: number };

  // ---- act (deterministic, bypasses pixel-hunting) ----
  selectTool(toolId: ToolId): void;
  setColors(opts: { fill?: FillSpec | null; stroke?: StrokeSpec | null }): void;
  stageGesture(points: StagePoint[], opts?: { modifiers?: Modifiers }): Promise<void>;
      // synthesizes pointerdown/move/up on the stage canvas, converting STAGE
      // coordinates → screen via the live zoom/pan transform
  menu(path: string): Promise<void>;     // e.g. "Modify/Convert to Symbol…"
  timeline(cmd: TimelineCmd): void;      // selectLayer, gotoFrame, F5/F6/F7, createTween
  publish(): Promise<Uint8Array>;        // bytes, no file dialog
  screenshotStage(): Promise<string>;    // dataURL, for layer 3 / agent eyeballing
}
```

Rules:
- The bridge **only calls the same code paths the UI calls** (same handlers/mutations).
  `stageGesture` dispatches real PointerEvents; `menu`/`timeline` invoke the real
  command handlers. It must never reach into the model directly, or it stops testing
  the UI.
- `getDocument()` is the primary oracle. A spec reads like: *draw rect from (100,100)
  to (200,150) → active layer keyframe 0 contains one shape, closed 4-segment path,
  fill #FF0000* — a precise JSON assertion no screenshot can match.

### File dialogs / Tauri

Native dialogs are not automatable. All `@tauri-apps/plugin-dialog` / `plugin-fs` use
goes behind a small `FileIO` interface (already implied by 0063's error-surfacing work);
test mode swaps in an in-memory implementation (`openFla(bytes)`, `savedFiles` map). The
e2e suite runs against **browser-mode Vite** (`localhost:1420`) with that mock — no
Tauri runtime needed in CI.

### The suite: `apps/desktop/e2e/`

Playwright specs covering the canonical Flash 8 authoring flows, each asserting through
the bridge:

1. Draw each primitive → document contains the expected shape (per-tool specs).
2. Select/move/scale/rotate → display-object transform matches expected matrix.
3. F5/F6/F7 spans, layer add/reorder/lock/hide → timeline model matches `docs/02`.
4. Draw → F8 Convert to Symbol → edit-in-place → place second instance → instances and
   symbol timeline correct (`docs/07`).
5. Motion + shape tween end-to-end: create span, set tween, scrub → interpolated state;
   publish → layer-1 decode shows per-frame matrix updates.
6. Undo/redo across every mutation class: `getHistoryDepth()` + document equality
   round-trip (catches "mutation bypassed history" bugs like 0051 found).
7. Save → New → Open round-trip through the FileIO mock → document deep-equals.
8. Publish → run layer-1 decode + a trace assertion (full author→play loop).

**Command:** `pnpm e2e` (starts Vite, runs Playwright headless). Specs are checked in
and run in CI — repeatable, not ad-hoc agent driving.

### How agents use it interactively

Beyond CI specs, an agent with Playwright (e.g. the MCP browser tools) can drive the
live app ad hoc: call bridge methods via `evaluate`, take `screenshotStage()` to *look*
at the result, and read `getDocument()` to *assert* it. New feature work should land
with a spec; exploratory verification can stay ad hoc.

---

## Layer 3 — Visual cross-check oracle (stage renderer vs Ruffle)

We have two independent renderers of the same document: the authoring `CanvasRenderer`
and Ruffle playing the published SWF. Agreement between them is an oracle that needs
**no hand-maintained golden images**:

```
FlashDocument ──CanvasRenderer──► PNG(frame N) ──┐
       │                                         ├─► perceptual diff ≤ threshold?
       └──compileDocument──► SWF ──Ruffle──► PNG(frame N) ──┘
```

A disagreement means the stage lied or the export lied — both are bugs we care about
(this is exactly the "Test Movie doesn't match the stage" class). Determinism measures:

- Software rendering in CI (`--use-gl=swiftshader` / disable wgpu nondeterminism via
  Ruffle's canvas renderer if needed), fixed viewport and `devicePixelRatio: 1`.
- Perceptual diff (`pixelmatch`/`odiff`) with a tuned threshold, not byte equality;
  report % mismatched pixels.
- Scope initially to **shapes, gradients, transforms, tween frames**. Exclude text
  (font rasterization will legitimately differ until FlashType work) and filters
  (different blur kernels) via per-fixture ignore regions/flags.
- On failure, write `actual-stage.png`, `actual-ruffle.png`, `diff.png` as artifacts —
  agents can read images and localize the divergence.

Reuses layer 1's fixture corpus. **Command:** `pnpm verify:visual`.

---

## Layer 4 — JSFL scripting surface (long-term, on-theme)

Flash 8's real automation API was **JSFL** (`fl.getDocumentDOM().addNewOval(...)`,
`document.convertToSymbol(...)`, History panel "save as JSFL"). Implementing a JSFL
subset is simultaneously a fidelity feature (`17-advanced-specialized.md`) and the ideal
agent surface: test scenarios become human-readable, replayable, version-controlled
scripts instead of coordinate sequences.

- Start with the read/mutation core: `fl.getDocumentDOM()`, `document.addNewRectangle/
  addNewOval/addNewText`, `selectAll/selection`, `convertToSymbol`, `timeline.insertFrames/
  convertToKeyframes/createMotionTween`, `document.publish()`, `fl.trace()`.
- Implement as a thin adapter over the same command layer the UI and `__flashTest` use;
  expose `runJSFL(source)` on the bridge so Playwright specs and agents can execute it.
- Grow toward Flash 8's documented JSFL DOM as authoring features mature; `__flashTest`
  remains the low-level escape hatch.

> **Out-of-process access:** layers 2 and 4 are in-page APIs reachable only via a
> browser harness. `19-agent-interface.md` defines the `flash-agent` CLI and JSON-RPC
> WebSocket bridge that expose the same command layer to agents over a socket — the
> default surface for LLM agents doing live authoring work.

---

## Workflow & CI

- Root commands: `pnpm verify` = `verify:swf` + `verify:runtime` + `e2e`;
  `verify:visual` runs in CI and on demand (slower).
- **Definition of done for any story that touches model → render → publish:** add or
  extend a fixture + the relevant layer's assertion. A story whose feature cannot be
  verified by layers 1–3 should say why in its task description.
- Agents' loop: implement → write/extend spec or fixture → `pnpm verify` → read the
  textual failure → iterate. Tasks should reference the fixture/spec they add.

## Build order

1. **Layer 1** — pure Node, zero flakiness, immediately covers the encoder/runtime bug
   class that has been burning us (0047/0067/0048/0055). Includes the fixture corpus.
2. **Layer 2** — the bridge + the eight canonical specs; requires the FileIO seam.
3. **Layer 3** — once layers 1–2 are green and the renderers are mature enough that
   diffs are signal.
4. **Layer 4** — after the symbol/timeline command layer settles (post 0053/0056).
