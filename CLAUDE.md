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
- **Embedded font glyphs (task 0702)**: `packages/swf/src/fonts.ts` now emits REAL
  vector glyph outlines (from a built-in 5×7 font in `glyphdata.ts`) so text renders as
  visible pixels in Ruffle. Several non-obvious encoding facts were discovered:
  - **DefineFont3 (tag 75) uses a 20× EM scale** vs DefineFont2 (tag 48): glyph
    coordinates AND layout metrics (ascent/descent/advance) live in a 20480-unit EM
    square, not 1024. `encodeDefineFont2` takes a `coordScale` arg (1 for tag 48, 20 for
    tag 75). Emitting 1024-scale coords into a tag-75 font renders text 20× too small
    (invisible dots). See ruffle `core/src/font.rs` `from_swf_tag`: `scale = version>=3 ?
    20480 : 1024`.
  - **Ruffle wraps each glyph's shape-records in a Shape with a single fill at index 1**
    (`render/src/shape_utils.rs` `swf_glyph_to_shape`). Each glyph contour must reference
    a fill style (we set `fill_style_1 = 1` via a StyleChangeRecord); the actual text
    colour comes from the DefineText/EditText record, not the glyph.
  - **DefineText TEXTRECORD field order**: after the style-change flag byte the fields
    are FontID, Color, **XOffset, YOffset, then TextHeight** — height comes AFTER the
    offsets, not next to FontID. Flag low-nibble bits are font=0b1000, color=0b100,
    yoff=0b10, xoff=0b1. Getting this wrong yields `glyphs=0` / garbage color.
  - **DefineEditText flag bit positions** (per ruffle `EditTextFlag`): HasFont=0,
    HasMaxLength=1, HasTextColor=2, ReadOnly=3, Multiline=5, WordWrap=6, HasText=7,
    UseOutlines=8, WasStatic=10, NoSelect=12, HasLayout=13. The old encoder had these
    scrambled, so dynamic/input text never rendered. Set UseOutlines (bit 8) so the
    embedded glyph outlines are actually used.
  - **Headless Ruffle's lyon tessellator drops wide-short fills**: a glyph made of many
    thin (single-cell-tall) rectangles renders incompletely (vertical strokes survive,
    horizontal bars drop) even though the SWF is spec-correct. Decompose glyphs into
    maximal rectangles and grow thin strokes to ≥2 cells thick. The acceptance oracle is
    `apps/desktop/e2e/text-rendering.spec.ts` (counts dark pixels over white).
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
- **Keyboard DOES reach AVM1 — focus is the gate; use onClipEvent(keyDown), not
  Key.isDown (task 0703)**. Proven end-to-end in `apps/desktop/e2e/keyboard.spec.ts`:
  publishing a SWF with `onClipEvent(keyDown){ _root.gotoAndStop(2); }`, clicking the
  Ruffle player to focus it, then `page.keyboard.press('ArrowRight')` flips the stage
  red→blue (pixelDiff 10000). The prior "headless Ruffle can't drive keyboard" claim was
  false. Hard-won specifics:
  - **FOCUS is load-bearing**: Ruffle registers its keydown handler on `window` but gates
    it on an internal `has_focus` flag set via a `focusin` listener on the
    `<ruffle-player>` host. Without a real `.click()` on the player the keypress reaches
    `window` but is dropped. After a click, `document.hasFocus()` and
    `document.activeElement === host` are both true and the key flows to AVM1.
  - **autoplay gating**: with default `autoplay:'auto'` and no running AudioContext (the
    headless case), Ruffle shows a play button and does NOT call `play()`, so clip ticks
    never start. Pass `autoplay:'on'` (and `unmuteOverlay:'hidden'`) to `ruffle().load()`.
  - **hardware-accel overlay**: headless Chromium has no GPU, so Ruffle injects a
    "hardware acceleration disabled" message overlay with a dimming backdrop that ruins
    screenshots. Recursively `display:none` any shadow-DOM element whose id/class matches
    `modal|overlay|message|splash|play-button|panic` before screenshotting.
  - **Key.isDown / Key.getCode are BROKEN in the bundled Ruffle 0.1.0 headless build**:
    the `keyDown` clip EVENT fires, but `Key.isDown(39)` and `Key.getCode()` return
    false/0 even *inside* the keyDown handler when the key is definitionally down. Do not
    rely on Key-state polling for headless oracles; react to the keyDown event itself.
    (Bundle in `apps/desktop/public/ruffle` is 0.1.0; the source clone is 0.2.0.)
- **AS2 compiler bug — member-target assignment compiles as a READ (found during 0703)**:
  `this._x = v` / `obj.prop = v` / `obj.prop += v` emit ActionGetMember (0x4e, read)
  instead of ActionSetMember (0x4f, write), so the assignment silently does nothing. Bare
  `_x = v` (ActionSetVariable) works. Any movement/property-set AS2 must currently use the
  bare form. (Separate follow-up task territory; not fixed by 0703.)
