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
  Use `top:0; left:0; opacity:1` (fully visible, on top of UI) and remove the element
  after the screenshot.
- **Visual oracle — z-index breaks WebGL capture**: adding `z-index:99999` to the Ruffle
  player element causes `locator().screenshot()` to return a solid-black image for the
  `wgpu-webgl` renderer in headless Chromium. The fix is two-fold: (1) do NOT set
  z-index on the player element; (2) use `page.screenshot({ clip: {x:0,y:0,w:550,h:400} })`
  rather than `locator().screenshot()`. The `page.screenshot` path composites the actual
  WebGL surface correctly; the locator path does not. Discovered by task 0899.
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

### Golden FLA→SWF parity (`fixtures/golden/`)

- **Harness: `node tools/golden-parity.mjs [fla swf]`** (defaults to
  `fixtures/golden/golden.{fla,swf}`). It compiles our SWF, normalizes both via
  `swf-dump`, and scores ORDER-INDEPENDENT semantic dimensions: self-determinism,
  header/stage, tag inventory, PLACEMENTS (per-frame z-order: position+scale+name —
  ignores absolute depth/char-ID renumbering), SHAPE GEOMETRY (match by record
  signature, compare ShapeBounds), and DECOMPRESSED bytes. Exits 0 when all *hard*
  dimensions pass; documented byte-level gaps are reported as `KNOWN-GAP`, not failures.
  The older `golden-report.mjs` only does tag inventory + self-determinism.
- **True byte-for-byte is NOT achievable** for these fixtures and the gaps are
  semantically inert (Ruffle renders identically): (1) we hoist all char definitions;
  Flash interleaves them per-frame and puts DoAction/FrameLabel at frame start; (2)
  char-IDs numbered in library vs usage order; (3) Flash reuses RemoveObject-freed
  depths (d1,d3) while we allocate monotonically (d3,d4); (4) Flash expands one FLA
  gradient into ~17 DefineShape fillStyles at publish (we emit 1, bounds identical);
  (5) zlib CWS deflate is impl-specific. Compare DECOMPRESSED bodies, never the
  compressed file. (Tracked in task 1194.)
- **The CPicObjBase flags byte is NOT per-object visibility** (task 1190 supersedes
  0932): golden has flags=0x0 on 17/19 objects, all visible in golden.swf. Flash has no
  per-display-object hide — visibility is a layer property / runtime `_visible`.
  `visibleFromObjBaseFlags` returns true unconditionally. The old bit0 decode made every
  scene object `visible:false` → compile emitted zero-alpha CXForms → blank white SWF.
- **Do not subtract registrationPoint from an instance's PlaceObject2 x/y** (task 1191):
  import stores `registrationPoint` from the binary's absolute regX/Y, which equals the
  placement position, so subtracting collapsed every instance to (0,0). The placement
  x/y already is the stage position of the registration origin (symbol-internal geometry
  is centered on its own origin at definition time, task 1171).
- **DefineShape4 ShapeBounds includes the stroke extent; EdgeBounds is tight.** Flash
  grows ShapeBounds by half the max stroke width per side (a r=210twip circle with a
  20twip stroke → ±220, not ±210). `shapes.ts` adds `ceil(maxStrokeTwips/2)` to
  ShapeBounds and leaves EdgeBounds at the raw geometry.
- **Static-text fidelity gap (task 1193, OPEN):** the golden title imports left-aligned
  (TextRecord x_offset=0 vs Flash's 3640 that centers it) and we substitute NotoSans
  while REUSING the original Arial glyph indices → wrong glyphs render. The Ruffle render
  (`golden-fla-oracle.spec.ts`) is what surfaced this — the structural harness can't see
  glyph-layout defects, so always eyeball the actual render.

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
- **Symbol AS2 linkage lives in the Contents stream** (task 0863): immediately after the
  typeByte for each symbol entry, the Contents stream carries:
  `BomString(linkageIdentifier)` then 4 UI8 flags: `exportInFirstFrame`, `exportForActionScript`,
  `exportForRuntimeSharing`, `importForRuntimeSharing`. The `className` (AS2 class name) is NOT
  in the Contents stream; it likely lives in the Symbol N CPicPage afterData (not yet decoded).
  Without a fixture FLA that has non-empty linkage, byte-order of the 4 flag bytes is best-effort
  — verified only for the "no linkage" case where all flags read as expected (exportForAS=false).
- **FLA binary layer ordering is BOTTOM-TO-TOP** (task 0903): CPicLayer objects in the
  CPicPage stream are stored background-first, foreground-last (i.e., the bottommost layer
  in the panel is at index 0 in the binary). The Flash 8 clone model convention (and
  `compile.ts`) expects TOP-TO-BOTTOM (li=0 = frontmost/topmost). `flash8-import.ts`
  `convertTimeline()` must `.reverse()` the `t.layers` array after reading from the
  binary — `[...t.layers].reverse().map(...)` — so that li=0 is the foreground layer.
  This applies to BOTH scene timelines (CPicPage) and symbol timelines (Symbol N CPicPage);
  `convertTimeline` is the single function called for both, so the fix is uniform.
  Mask/guide layer type assignments are intrinsic to each CPicLayer record (not index-based),
  so they survive the reversal correctly: a mask at binary-index N is still type "mask"
  after reversal, and the model's "mask is above its masked layers" invariant (`mask at
  li=k`, `masked at li=k+1`) is preserved because the panel order is maintained.

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
  - **UseOutlines=1 makes text look "mangled" (task 0710)**: setting the UseOutlines
    (bit 8) flag in DefineEditText forces Ruffle to render glyph outlines from the
    embedded font — which is our custom 5×7 pixel-art font — instead of system device
    fonts (real Arial etc.). The fix is to set `HasFont=1` (so Ruffle knows the font
    SIZE from the FontHeight field) but leave `UseOutlines=0`. This gives correctly-sized
    device-font rendering for ALL text types (static, dynamic, input) on the main
    timeline, matching MC text behaviour (which never sets UseOutlines). Static text
    now uses DefineEditText (tag 37) instead of DefineText (tag 11); glyph-indexed
    DefineText is still emitted correctly by `encodeDefineText` but is not called from
    the main compile path.
  - **Real TTF-derived outlines (task 0708)**: `glyphdata.ts` is now AUTO-GENERATED by
    `packages/swf/scripts/gen-glyphdata.mjs` from a bundled **NotoSans-Regular** (SIL OFL,
    `packages/swf/assets/NotoSans.ttf`) via `opentype.js` (a devDependency). Regenerate with
    `pnpm --filter @flash/swf gen-glyphdata`. The 5×7 bitmap font is kept as a runtime
    fallback (`glyphCells`) for code points without a real outline. Non-obvious TTF→SWF facts:
    - **NotoSans is a perfect match**: `unitsPerEm = 1024` is exactly the internal EM the
      encoder uses, so glyph coords need NO rescale (the 20× DefineFont3 scale is applied
      downstream in `fonts.ts`). And its ASCII 32–126 glyphs use ONLY M/L/Q commands — no
      cubic Béziers — so each command maps 1:1 to a SWF straight/curved edge.
    - **opentype's `getPath(0,0,em)` already returns SWF font-space coords**: +x right,
      **−y up** (above baseline), +y below baseline. This is the exact SWF glyph convention,
      so contours map directly with NO Y-flip. (Verified: cap 'A' spans y −734..0; '_' sits
      at y +92..+158.)
    - **SWF CurvedEdge stores DELTAS, in (control, anchor) order**: write `control−pen` then
      `anchor−control` (not anchor−pen). A quadratic Q(cx,cy,x,y) → controlDelta=(cx−penX,
      cy−penY), anchorDelta=(x−cx, y−cy).
    - **Each TTF contour starts with a MoveTo** = one StyleChangeRecord; set fill style 1
      only on the FIRST contour of the glyph (it persists). Ruffle's `swf_glyph_to_shape`
      installs a single fill at index 1 and recolors it from the text record.
    - **Advances now come from real per-glyph metrics** (`glyphAdvanceEm`), so spacing is
      proportional ('W' ≫ 'i') instead of the old fixed 660-EM box. The text encoder
      (`text.ts`) uses these for both DefineText glyph advances and width estimates.
    - **Verified end-to-end**: temporarily forcing `UseOutlines=1` and running
      `text-rendering.spec.ts` confirmed the real outlines render as visible pixels in
      Ruffle through the DefineFont3 outline path (then reverted, since the default
      device-font path from 0710 stays UseOutlines=0).
- **`isEmpty: true` frames are skipped by the compiler** (`compile.ts`:
  `if (!frame.isKeyframe || frame.isEmpty) continue;`). Display objects listed on a
  frame marked `isEmpty` are silently dropped from the SWF — fixture builders must set
  `isEmpty: false` on any frame that carries displayObjects.
- **Named text fields need the name in PlaceObject2** (task 0519): for
  `_root.scoreText.text = ...` to resolve, the EditText's PlaceObject2 must carry the
  instance name (`encodePlaceObject2WithName`); DefineEditText's VariableName field is
  not what gives the TextField its AS2 path.
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
- **Verify every opcode against `ruffle/swf/src/avm1/opcode.rs`** — never trust a
  comment. Tasks 0706/0519 found 15 wrong values in the compiler's opcode table,
  including SetMember/GetMember SWAPPED (0x4E/0x4F), Add2 as 0x64 (actually BitRShift),
  Not as 0x14 (actually StringLength), Increment as 0x47 (actually Add2). ~700
  byte-presence test assertions had codified the wrong values, so "all unit tests
  pass" proved nothing. `memberassign.test.ts` now pins the table to spec values.
- **DefineFunction/DefineFunction2/With/Try action lengths exclude trailing bodies.**
  The declared UI16 action length covers ONLY the header; the function body
  (codeSize), with-block body (size), and try/catch/finally bodies follow the record.
  Including them makes Ruffle log "Length mismatch in AVM1 action" and re-sync PAST
  the following actions — e.g. the SetMember of `_root.onEnterFrame = function(){...}`
  was silently skipped, so the game loop never ran. Also: ActionTry field order is
  flags, then the three sizes, THEN the catch name (not name-before-sizes).
- **Ruffle trace() output**: load the player with `logLevel: 'info'` in the load
  config to see AVM1 `trace()` in the browser console — invaluable for runtime
  debugging of published SWFs; the default log level hides traces.
- **`_root.onEnterFrame = function(){...}` DOES run in headless Ruffle.** The earlier
  claim that headless Ruffle "does not drive onEnterFrame game loops" was an artifact
  of the broken SetMember opcode + DefineFunction2 length bug; with both fixed, the
  capstone game loop runs every frame.
- **ActionGotoFrame2 (0x9F) PlayFlag is bit 0 (0x01), NOT bit 1 (0x02).** The flags
  byte layout is: `Reserved(6) | SceneBiasFlag(1) | PlayFlag(1)`. Using 0x02 sets
  SceneBiasFlag which tells Ruffle to read 2 more bytes for scene offset; since those
  bytes aren't there Ruffle logs "Length mismatch in AVM1 action: GotoFrame2" and the
  goto fails. Verified against `ruffle/swf/src/avm1/read.rs` `read_goto_frame_2`.
- **SWF layer depth ordering: li=0 is the TOP (front) layer; it needs the HIGHEST
  depth.** In `compile.ts`, depths must be pre-assigned bottom-to-top: iterate layers
  from `li=n-1` (background, depth 1) to `li=0` (foreground, depth n). The old code
  iterated forward (li=0 → depth 1) which put the background layer on top of everything
  else in Ruffle, hiding all content. A pre-pass in `compile.ts` now seeds
  `getOrAssignDepth` in the correct visual order before the frame loop runs.

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
- **AS2 member assignment is fixed**: `obj.prop = v` and `this._x = v` correctly emit
  ActionSetMember (0x4f). Chained forms like `_root.scoreText.text = "hello"` also work:
  GetMember fetches the intermediate object, SetMember writes the property. Verified by
  opcode inspection (QA loop, 2026-06-10).
