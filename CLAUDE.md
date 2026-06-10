# CLAUDE.md — Flash 8 clone

## Start here

- Read **AGENTS.md** for task system rules, lock protocol, and CLI reference.
- Read **docs/README.md** and the relevant domain doc before touching any subsystem.
- All task operations go through `./task` — never edit `.tasks/*.json` by hand.
- Use ruffle (cloned locally) for reference material e.g. SWF encoding, runtime, AS, etc.
- Commit and push all changes to git when done

## Controlling the editor (Agent MCP bridge)

Connect Claude Code or any MCP client to the live editor:

```bash
claude mcp add --transport http flash-editor http://localhost:1420/mcp
```

Or use the `flash-agent` CLI (start the dev server first with `pnpm dev:browser`):

```bash
pnpm flash-agent tools                          # list tools with schemas
pnpm flash-agent call editor_status            # check editor is alive
pnpm flash-agent call doc_summary              # orient: scenes/layers/library
pnpm flash-agent screenshot -o stage.png       # write PNG to file
pnpm flash-agent publish -o movie.swf          # compile and write SWF
pnpm flash-agent repl                          # interactive REPL session
```

See `docs/19-agent-interface.md` for the full tool surface.

## Running tests

```bash
# Unit tests (run each package sequentially to avoid esbuild race)
pnpm --filter @flash/swf run test -- --run
pnpm --filter @flash/core run test -- --run
pnpm --filter @flash/authoring-ui run test -- --run

# E2E (Playwright — auto-starts Vite dev server on port 1420)
pnpm --filter @flash/desktop e2e
```

## Learnings

Concise, permanent takeaways from completed work. Update this section when finishing a
task if something non-obvious was discovered. Goal: avoid re-researching the same ground.

### Test harness

- **esbuild parallel-build race**: running all three vitest packages in parallel (`&`)
  occasionally causes a transient esbuild `failureErrorWithLog` in `@flash/core`. Always
  run packages sequentially; flakiness disappears.
- **Playwright port**: the Vite dev server runs on **port 1420** (Tauri default), not
  5173. `playwright.config.ts` and all spec files must use `http://localhost:1420`.
- **Visual oracle — Ruffle must be on-screen**: injecting the Ruffle player at
  `top:-9999px` prevents Chromium from compositing it, producing a blank screenshot.
  Use `top:0; left:0; opacity:1; z-index:99999` (fully visible, on top of UI) and
  remove the element after the screenshot.
- **Visual oracle — DPR**: `StageArea` sizes its canvas backing buffer at
  `stageW * devicePixelRatio`. On a 2× display the canvas PNG is 1100×800 while Ruffle
  renders at 550×400, causing large pixel diffs. Use `deviceScaleFactor:1` in the
  Playwright project config for visual-oracle tests, or provide a
  `__flashTest.screenshotStage()` bridge that renders to a 1:1 offscreen canvas.
- **CI skip guards**: `jsfl.spec.ts` had a stale `test.skip(!!process.env.CI, 'skip
  until fully wired')` guard. Remove it once the feature is wired; stale guards silently
  suppress tests when CI is configured. The visual-oracle CI skip is intentional
  (Ruffle WASM infra not set up in CI yet).
- **Visual oracle — transparent background mismatch**: `screenshotStage()` renders onto
  a transparent canvas (`CanvasRenderer` calls `clearRect`). `pixelmatch` blends
  transparent pixels against white, so any non-white `backgroundColor` causes near-total
  mismatch vs Ruffle (which fills via `SetBackgroundColor`). Fix: after rendering to the
  offscreen canvas, composite onto a second canvas pre-filled with
  `docProperties.backgroundColor` before encoding to PNG. See `Shell.tsx
  screenshotStage()`.

### Verification

- **Byte-presence unit tests are not runtime proof.** Task 0663 emitted plausible-looking
  CLIPACTIONS (HasClipActions flag, AllEventFlags) and all unit tests passed, yet Ruffle
  did not dispatch `onClipEvent(mouseDown)` at runtime (interactivity e2e pixelDiff = 0).
  For any interaction/event/script feature, the Ruffle-based e2e oracles
  (`interactivity.spec.ts`, visual-oracle) are the acceptance truth; unit tests on
  encoded bytes are necessary but never sufficient.

### Binary FLA import (Flash 5–CS4 OLE2 format)

- **Authoritative format references**: JPEXS `flacomdoc` (github.com/jindrapetrik/flacomdoc,
  an XFL→binary-FLA *writer* byte-verified against real Flash output — best source for
  field order/semantics per version) and `eddiemoore/fla-decoder` (Ghidra reverse
  engineering of flash.exe — best source for the MFC CArchive protocol and schema gates).
  Clone these before guessing at bytes.
- **Streams are MFC CArchive serializations** of CPicPage/CPicLayer/CPicFrame/CPicShape...
  Class tags: `FFFF`=new class decl, `0x8000|combinedIdx`=backref (the combined table
  allocates TWO slots per class), `0000`=null/end-of-children. Strings: `FF FE FF len`
  BomString (unicode docs = MX2004+) vs bare `len`+chars.
- **AS2 frame scripts are stored as plain source text** inside each CPicFrame (after
  the frameVersionC block); no decompilation needed for Flash 5+.
- **Shape edge coords are 8.8 fixed-point twips** (1 px = 5120 units), NOT SWF twips.
  Verify any new geometry assumption against the SWF published from the same FLA.
- **Edge style-change order is (stroke, fill0, fill1)** — not fill0/fill1/stroke.
- **Pre-F8 strokes are 10 bytes** (RGBA+width+params); F8 adds caps/joins/miter and a
  trailing full fill style. Gating is by the CPicShape schema byte (>2 = F8).
- **Naive "end-marker" recovery scans are dangerous**: the `00 00 + INT_MIN point`
  signature also appears at the START of sibling records whose registration point is
  uninitialized; scan for the nearest plausible class tag instead.
- **Mini-FAT matters**: OLE2 streams smaller than 4096 bytes (most Page streams) live
  in 64-byte mini sectors inside the root entry's stream; reading them via the main
  FAT yields garbage.
- Versioning: every record starts with a per-version schema byte
  (`FlaFormatVersion.java` in flacomdoc has the full table); gate field reads on it.

### SWF encoding

- **LINESTYLE2 byte order**: `EndCap` bits and miter limit must be written in the exact
  bit order the SWF spec prescribes; swapping them truncates the rest of the record.
- **DefineShape4 vs older tags**: always emit tag 83 (DefineShape4) for Flash 8 targets;
  tags 2 and 32 lack LINESTYLE2 and gradient enhancements.
- **PlaceObject3 required for filters**: filters and blend modes need tag 70
  (PlaceObject3), not tag 26 (PlaceObject2). Emitting PO2 silently drops all filter
  data; Ruffle sees no filter and renders the object unfiltered.
- **Shape origin normalization**: encode shape paths relative to (0,0) in DefineShape,
  and put the full stage offset in PlaceObject2 `tx/ty`. Baking absolute coords into the
  shape record and also translating via PO2 double-offsets the object.
- **DefineMorphShape2 (tag 84)**: use tag 84 (not legacy tag 46) for Flash 8 shape
  tweens so LINESTYLE2 cap/join data is preserved.
- **DefineScalingGrid (tag 78)**: must immediately follow the `DefineSprite` tag for
  any symbol whose model has `scale9Grid != null`; omitting it causes Ruffle to apply
  uniform scaling and distort 9-slice corners.
- **Multi-frame movies**: emit `RemoveObject2` when an object leaves the display list;
  set the `Move` flag on `PlaceObject2` for objects that persist across frames; hoist
  all character definitions before the first `ShowFrame`.
- **Text renders invisibly in Ruffle**: the embedded-font encoder
  (`packages/swf/src/fonts.ts`) emits placeholder EMPTY glyph shapes, so static
  (DefineText) and dynamic (DefineEditText) text contribute zero visible pixels. Never
  base a pixel-diff assertion on text content — put a shape on any frame that must be
  visually distinguishable (see capstone-0519 game-over panel).
- **`isEmpty: true` frames are skipped by the compiler** (`compile.ts`:
  `if (!frame.isKeyframe || frame.isEmpty) continue;`). Display objects listed on a
  frame marked `isEmpty` are silently dropped from the SWF — fixture builders must set
  `isEmpty: false` on any frame that carries displayObjects.
- **Blank-white Ruffle screenshots are ambiguous**: a failed player load and a frame
  with only invisible content both screenshot as pure white. E2E oracles should assert
  every screenshot is non-blank (diff vs a white reference > threshold) in addition to
  comparing screenshots to each other.

### AS2 / AVM1 compiler

- **Shared mutable state causes flaky tests**: module-level counters, label maps, or
  cached symbol tables in `compiler.ts` / `parser.ts` leak between vitest test files.
  Reset all mutable state in `beforeEach` or use factory functions instead of singletons.
- **do-while and static-class tests are the canary**: if AS2 compiler tests are flaky,
  start by checking for module-level mutable state.

### Authoring UI

- **MenuBar mousedown race**: menu items that dispatch actions must not unmount before
  the `click` event fires. Attach the `mousedown` handler to the overlay, not the item,
  or use `onMouseDown` + `e.preventDefault()` to keep focus until `onClick` fires.
- **`canvas.first()` is fragile**: `StageArea` renders two canvases (grid overlay +
  render canvas). Target the render canvas with `data-testid="stage-canvas"` rather than
  a positional Playwright locator.
- **MCP agent stale-closure bug**: callbacks registered via `setAgentCallbacks` in
  Shell.tsx capture React state at registration time. If `getDoc` returns `doc` from the
  closure, it sees the pre-mutation snapshot after `pushDoc`. Fix: keep a `useRef` that is
  updated synchronously inside `pushDoc` before the async React state update, and point
  `getDoc` at the ref.
- **Playwright workers must be 1 for the agent bridge**: the `/__agent` WebSocket bridge
  is a singleton — only one browser page holds the connection at a time. With multiple
  Playwright workers each `page.goto('/')` steals the connection, causing in-flight tool
  calls to fail with "Editor page disconnected". Set `workers: 1` in
  `playwright.config.ts`.

### SWF clip actions

- **Reserved UI16 before AllEventFlags**: `read_clip_actions()` in Ruffle
  (`swf/src/read.rs`) calls `read_u16()` for a reserved field *before* reading
  AllEventFlags. Omitting this 2-byte write shifts every subsequent field by 2 bytes;
  Ruffle sees garbage event flags and silently discards the entire clip-actions block.
- **ActionEnd required in CLIPACTIONRECORD bytecode**: `compileAS2` does not emit
  ActionEnd (0x00). Each CLIPACTIONRECORD's bytecode must terminate with ActionEnd per
  SWF spec §8.4.6.2; without it Ruffle's AVM1 executor walks into garbage bytes. Append
  `new Uint8Array([0x00])` after compiling each clip-action script (same pattern as
  DoAction frame scripts).
- **onClipEvent(mouseDown) does not fire in headless Ruffle**: Ruffle's WASM player in
  headless Playwright does not dispatch global mouse clip events. Use
  `onClipEvent(load)` or `onClipEvent(enterFrame)` in interactivity oracle tests instead.
