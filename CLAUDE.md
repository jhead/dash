# CLAUDE.md — Flash 8 clone

## Start here

- Read **AGENTS.md** for task system rules, lock protocol, and CLI reference.
- Read **docs/README.md** and the relevant domain doc before touching any subsystem.
- All task operations go through `./task` — never edit `.tasks/*.json` by hand.
- Use ruffle (cloned locally) for reference material e.g. SWF encoding, runtime, AS, etc.
- Commit and push all changes to git when done

## Controlling the editor (Agent MCP bridge)

Connect over MCP (`claude mcp add --transport http flash-editor http://localhost:1420/mcp`)
or drive the `flash-agent` CLI after `pnpm dev:browser` (`pnpm flash-agent
tools|call|screenshot|publish|repl`). Full command list + tool surface: **AGENTS.md** and
`docs/19-agent-interface.md`.

## Running tests

```bash
# Build workspace packages FIRST. Each @flash/* package resolves its "." export to
# ./dist/index.js, so on a fresh checkout cross-package @flash/* imports (e.g. @flash/swf
# importing @flash/core) fail in tests until dist/ exists.
pnpm --filter './packages/**' build

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

### Task system

- **Duplicate task ids came from PER-WORKTREE counters, not a broken in-process lock (task
  1206).** The `./task` CLI already serialized `create` with an `fcntl.flock` on
  `.tasks/.mutex`, so intra-worktree creates never collided. But each git worktree has its
  OWN `.tasks/.counter` + `.mutex`; two worktrees read the same committed counter and minted
  the same `NNNN` (e.g. 1213/1217), which only collided when they merged to `main`. A shared
  lock is impossible across worktrees at create time (they converge only at git-merge), so a
  pure counter can never be collision-free. Fix: ids are now `NNNN-TOKEN-slug`, where `TOKEN`
  is a 6-char base36 timestamp+random token (always digit-leading). `NNNN` stays a sortable,
  citable hint; `TOKEN` is the uniqueness authority — same-`NNNN` creates get distinct ids/
  filenames and merge with no conflict. Lookups resolve exact id first, then a unique prefix;
  an ambiguous bare prefix fails loudly listing matches. `./task migrate` is idempotent
  (already-tokenized ids untouched; legacy/colliding tokens derived deterministically). The
  digit-leading token is what lets migrate tell a real token from a slug word like `golden`
  (which has no leading digit). Gate: `tools/task-concurrency.test.py` (`pnpm test:task`).

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
- **Structural SWF oracles MUST decompress CWS before walking tags (task 1214).**
  `__flashTest.publish()` returns a COMPRESSED **CWS** SWF by default
  (`publishSettings.compress = true` in `Shell.tsx`). Three e2e oracles walked the tag
  stream from raw byte 8 — which for a CWS is the start of the zlib-compressed body — so
  they read garbage tag types (811, 16, 369, 401…; none valid) and never found the real
  tags: they FAILED while giving ZERO real coverage. The fix is harness-only: a shared
  `apps/desktop/e2e/helpers/swf-parse.ts` whose `decompressSwf()` detects the signature
  (`CWS`→`inflateSync(bytes[8:])`, FWS→passthrough, ZWS/LZMA→throw) and `parseSwfTags()`
  inflates then walks. `shape-morph`/`motion-guide`/`fla-roundtrip` now call it.
  `decompressSwf` rewrites the 8-byte header's signature to `FWS` so the inflated buffer
  walks uniformly at offset 8. The SWF header (signature+version+FileLength) is always 8
  bytes UNCOMPRESSED; only the body is zlib'd. NOT a product defect — Ruffle decompresses
  CWS fine and the visual oracles in the same specs render correctly. Separately,
  `__flashTest.publish()` is **async** (returns `Promise<string>`); the `FlashTestBridge`
  type that declared it `string` hid a missing `await` in fla-roundtrip's structure test
  (`swf.length` on a Promise = `undefined`) — the type now says `Promise<string>` and the
  call site awaits it.

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
- **The encoder coalesces a fill-only + coincident stroke-only path pair into ONE
  DefineShape loop (task 1213).** The FLA importer reconstructs a filled-and-stroked
  region as TWO separate closed paths (one fill, one identical stroke — correct for the
  editor stage and traced-bitmap fill stacks), but real Flash 8 encodes such a region as
  a SINGLE edge loop whose StyleChangeRecord carries both a fill and a line style and
  traverses the outline once (golden stroked oval = 5 records, not 10). Without merging,
  every imported stroked fill emitted double the edge records and broke golden-parity
  SHAPE GEOMETRY. `coalesceFillStrokePairs()` in `shapes.ts` merges only an adjacent
  (fill-only, stroke-only) pair with byte-identical geometry; lone fills/strokes, already-
  combined paths, and traced-bitmap fill stacks pass through untouched. Ruffle renders
  both forms identically — this only closes the gap to Flash's own output. Regression
  introduced by `035796d` (fill0/fill1 loop reconstruction), NOT the gradient work that
  was the initial suspect. Gate: `shapes.test.ts` "DefineShape4 fill+stroke coalescing".
- **golden's gradient button face is a bounds-match KNOWN-GAP, not a record-match (task
  1213).** Flash re-encodes a single FLA linear-gradient fill into a non-minimal stack of
  ~17 solid+gradient fillStyles AND re-winds the loop, so that one shape can never
  record-signature-match (we emit 1 gradient fill, identical bounds). `golden-parity.mjs`
  SHAPE GEOMETRY falls back to a ShapeBounds match for a shape with no signature match
  ONLY when one side carries a gradient fill and the fill counts differ — the documented
  gradient-fill expansion — and reports it as KNOWN-GAP. Any other no-signature-match is
  still a hard DIFF.
- **Static-text fidelity gap (task 1193, OPEN):** the golden title imports left-aligned
  (TextRecord x_offset=0 vs Flash's 3640 that centers it) and we substitute NotoSans
  while REUSING the original Arial glyph indices → wrong glyphs render. The Ruffle render
  (`golden-fla-oracle.spec.ts`) is what surfaced this — the structural harness can't see
  glyph-layout defects, so always eyeball the actual render.

### Binary FLA writer (real Flash 8 byte-compatibility)

- **The writer's ONLY contract is byte-compatibility with real Flash 8, NOT importer
  round-tripping.** The keystone is `fixtures/flash8-empty.fla` (genuine empty doc, WIN
  8,0,0,478): its `Contents` is **17312 B** and `Page 1` is **274 B**. `saveRealFla(
  createDocument())` now produces a **byte-perfect** Contents (modulo 2 volatile u32
  timestamps which equal the fixture's value, so 0 diffs in practice) and a Page 1 that
  differs only at the 2-byte big-endian frameId (absolute offset 0x8a). Gate test:
  `empty-bytematch.test.ts`.
- **contentsVersion is 0x3F, not 0x49.** The old stub used 0x49 (a Flash-9/CS3-ish value)
  and Flash aborted. Real Flash 8 stamps `contentsVersion=0x3F, contentsVersionB=1` (§8.1).
- **Contents object-by-object (empty doc)**: (1) §8.1 preamble 23 B; (2) one CDocumentPage
  per SCENE — NEWCLASS CDocumentPage schema 1 / `0x17` version / "Page N" String (no BOM) /
  sceneName BomString / symbolId u16 + reserved u16 + symbolType u8 / empty BomString / a
  **317-byte FixedPageTail** const run (§8.7) with two volatile u32 timeCreated/ItemID at
  tail-relative 0x18 and 0x5C; (3) one CDocumentPage per SYMBOL (same shape, real symbolId/
  type); (4) §8.4 stage block (model-derived W*20/H*20/gridSpacing*20/bg/grid/fps-8.8); (5) a
  **16837-byte post-stage default template** — property maps, the `CColorDef` palette,
  `CQTAudioSettings`, publish/print/font defaults, and the `mobileSettings` XML/version
  trailer. The whole Contents has exactly **3 NEWCLASS decls**: CDocumentPage, CColorDef,
  CQTAudioSettings; scenes/symbols after the first reuse CDocumentPage by **backref** (§5.2).
- **The post-stage template is position-independent**: it self-declares CColorDef/
  CQTAudioSettings via NEWCLASS and contains no backrefs to CDocumentPage, so prepending
  extra scene/symbol records (which advance the §5.2 counter) never invalidates it.
- **The model-vs-Flash default divergences (NOT volatile, NOT bugs)**: grid color (Flash
  `#c0c0c0` vs `createGridSettings` `#999999`) and new-layer outline color (Flash `#4fff4f`
  vs `createLayer` `#0000ff`). A correct serializer emits whatever the model carries; the
  byte-match test builds the doc with Flash's defaults to isolate volatile bytes.
- **Timeline records use VERSION-byte lead-ins, not an ObjBase header.** After the class
  tag, CPicPage is `04 00` (pageVersion=4,0), CPicLayer is `04 00`, CPicFrame is `04 00`
  (§10.1/§10.2/§11) — NOT the stub's `01 00` (schema=1,flags=0). CPicPage/CPicLayer/CPicFrame
  NEWCLASS schema is **1** (stub used 4). An empty keyframe body (143 B) + the layer
  post-frames lead-in + CPicPage tail are constant templates in `empty-templates.ts`.
- **`carchive-validate.ts` is a STRICT sequential CArchive reader** (modeled on fla-decoder's
  ArchiveReader, not the lenient importer): enforces the §5.1 tag invariant + §5.2 running
  index allocator, throws on invalid tag words / undeclared backrefs / implausible class
  decls. Proven faithful by cleanly parsing the real fixtures and rejecting corruption; it is
  the acceptance bar for content docs (the lenient importer is NOT). Templates were extracted
  with `tools/flashdrv/fla_cfb.py` + `__readAllStreamsForTest` in `ole.ts`.
- **The §11 frame-record sound sub-block is now WRITTEN, not zeroed (task 1205).** The CPicFrame
  serializer (`timeline-write.ts`) used to hardcode the whole sound block —
  `soundId, pointCount, soundLoop, soundSync, inPoint, outPoint, soundZoom` — to zero, silently
  dropping every frame sound attachment on save even though the model carries `Frame.sound`
  (`SoundLinkage`) and the binary reader (`flash8-binary.ts parseFrame`) decodes it. `writeFrameSound()`
  now emits the real fields: `soundId = mediaNumById.get(sound.libraryItemId)`, the custom-envelope
  point list (`{u32 pos; u16 left; u16 right}`), `soundLoop = repeatCount`, the soundSync byte
  (event/start/stop/stream = 0/1/2/3, inverse of import's `SOUND_SYNC_MODES`), and `inPoint`/`outPoint`.
  The exact byte layout is verified by round-tripping the written `Page N` stream back through the
  importer's own reader (`parseFla8Timeline`) in `real-fla-write.test.ts`. Two coupled rules:
  (1) `isEmptyKeyframe()` returns false when `frame.sound` is set, so a sound-on-an-otherwise-empty
  keyframe takes the full-serialization path (the empty-keyframe `PAGE_FRAME_BODY` template hardcodes
  the zero sound block); `createDocument`'s frames have `sound:null` so `empty-bytematch` is unaffected.
  (2) Full importer round-trip (`tryLoadRealFla`) needs the Contents `CMediaSound` catalog record
  (the importer resolves `soundId → libraryItemId` via a `Media N` catalog scan); the writer does
  NOT yet emit that catalog (the `media` field passed to `writeContents` is currently unused), so a
  saved frame sound is byte-correct but its library link is not yet rebuilt on a full re-import. That
  Contents media-catalog (CMediaSound/CMediaBits NEWCLASS objects) is the remaining gap — tracked as a
  follow-up task; it is byte-unverified against a real oracle and must not be guessed.

### Binary FLA import (Flash 5–CS4 OLE2 format)

- **CFB writer DIFAT bug (`cfb-write.ts`): a FLA needing > 109 FAT sectors lost its
  overflow FAT-sector pointers.** The CFB header has only 109 in-line DIFAT slots; when the
  body exceeds ~7.6 MB (e.g. a doc with embedded media) the FAT needs > 109 sectors and the
  surplus pointers MUST spill into a chain of DIFAT sectors (127 pointers + 1 next-pointer
  each, header `firstDifat`@68 / `difatCount`@72 set, sectors marked `DIFSECT=0xFFFFFFFC` in
  the FAT). The original writer silently dropped the overflow, so FAT sectors past the 109th
  — and every stream whose data they index — were unreachable; the importer read zeros and
  threw "unexpected root marker 0x0 (expected 0x01)". Smaller files (Magnet re-save ≈6 MB)
  never tripped it, which is why round-trip tests with empty/tiny timelines passed. Fixed by
  emitting DIFAT sectors and growing the FAT/DIFAT counts to a fixed point. Guarded by
  `cfb-write-difat.test.ts` (>109-FAT-sector round-trip) and cross-checked byte-for-byte with
  `tools/flashdrv/fla_cfb.py`. The container writer is otherwise byte-correct across all
  64-byte / 4096-cutoff / multi-sector-mini-FAT boundaries (400-trial fuzz, all readers agree).
- **The writer's Contents catalog is now spec-faithful enough for `flaparse.py`.** Scenes and
  symbols are emitted as real `CDocumentPage` records (`documentPageVersion 0x17` + String
  "Page N"/"Symbol N" + BomString display name + `u16 symbolId, u16 0, u8 symbolType`), and
  the §8.1 preamble (23 bytes) + §8.4 stage/document-properties block are byte-exact to
  flacomdoc `FlaConverter.writeStage` (rulerUnits, w*20, h*20, gridSpacing*20, previewMode,
  playOptions<<4|viewOptions, the 29-byte const run, bg+FF, grid+FF, fps 8.8 frac-then-int,
  `00 03 b4 00 00 00` anchor). Before this, the writer emitted no `0x17` and no symbolId
  trailer, so `flaparse.py catalog` found 0 records even though the importer's pattern-scan
  read it. Adding the `0x17`/trailer keeps the importer's forward scan working (it anchors on
  the UTF-16 stream-name string, not the version byte). Pinned by `writer-spec-bytes.test.ts`.
- **Writer↔importer share an edge/instance-header model that is NOT byte-identical to real
  Flash 8, only numerically/round-trip equivalent.** The importer reads shape-edge coordinate
  deltas as raw `s16`/`s32`/`s16<<7` at the 5120-units-per-px scale (`readCoordDelta`), and the
  writer emits the `s32` ("type 2") form to match — but docs/21 §12.3 says real Flash uses
  Point8_8 / short(×2) / fraction+s24 float forms. Likewise the placement/`CPicObjBase` header
  (schema, flags, child-list, regpoint tail) differs in framing from spec §5.3's stateFlags /
  transform-point / cacheAsBitmap layout. These are inverse-oracle-consistent (the importer
  reads real Magnet.fla/evaporatingdrip.fla correctly and round-trips the writer) but the exact
  on-wire encoding of edges and the instance-header interleaving remain UNVERIFIED against a
  real Flash 8 oracle. Rewriting the edge codec to emit Point8_8/short forms would require
  changing the importer's reader too and re-validating the traced-bitmap shape tests — out of
  scope until a Win7 Flash-8 oracle confirms the byte forms.
- **Scene PLAY ORDER is the Contents-stream order, NOT the "Page N" stream number.**
  The OLE2 "Page N" suffix is creation/storage order (the first scene authored is "Page 1"
  and keeps that stream name even when dragged elsewhere in the Scenes panel). The authored
  play order is the order the CDocumentPage records appear in the Contents stream, which
  `parseFla8Contents` preserves as `sceneNames` Map key order. `buildFla8Document`
  (`flash8-import.ts`) orders scenes by that Map, appending any page missing a name in
  page-number order. Sorting scenes by `pages.sort((a,b)=>a.num-b.num)` made Magnet.fla
  start on "AA" instead of the authored "Scene 2 → Scene 5 → AA …". (Same
  storage-vs-authored distinction as the layer-ordering bullet above.)
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
- **Motion/shape tween flag in CPicFrame.keyMode is bit 0x0001 / 0x0002** (NOT 0x4001).
  Real Flash 8 FLAs store a motion (classic) tween keyframe as `keyMode=0x601` (base 0x600
  = 0x400|0x200 plus the 0x0001 tween bit); a shape tween adds 0x0002. The old import
  required `(keyMode & 0x4000) && (keyMode & 0x0001)`, but 0x4000 is never set, so EVERY
  motion tween imported as `tweenType:"none"` — Magnet.fla's sliding menu buttons (Symbol 6)
  held their start keyframe and "jumped" instead of interpolating. Detect motion via
  `(keyMode & 0x0001)`, shape via `(keyMode & 0x0002)` (`flash8-import.ts`). The other
  keyMode bits (0x400 motionTweenScale-disabled, 0x800 motionSync) are unrelated state and
  must not gate tween detection.
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
- **Marching-squares contour tracing needs CONSISTENT HANDEDNESS, not a pure per-case
  lookup (task 1227).** `engine/bitmapTrace.ts marchingSquaresContour()` (the Trace Bitmap
  raster→vector tracer) walks grid vertices choosing the next direction from the 2×2 cell
  config. The original table set the direction almost entirely from the case and only
  consulted the entry direction for the two literal saddles — and it had two wrong cells:
  case 14 (TL+TR+BR filled / BL empty) and the case-10 saddle. The effect: on any region
  with both right- and left-leaning diagonal edges (every circle/diamond/ellipse, the
  Magnet.fla traced logos) the walker traced one side, reached the far tip, then climbed the
  interior line-of-symmetry chord and terminated near the start — enclosing only ~HALF the
  true area (a 40×40 R=18 disk traced as its right half: bbox x=20..39 instead of ~2..38).
  Fix: make it a clockwise loop keeping fill on the RIGHT of travel — for edge dir d the
  right-hand cell must be filled, the left empty (UP→cells TL/TR, RIGHT→TR/BR, DOWN→BR/BL,
  LEFT→BL/TL); the two saddles pick by entry direction; seed the entry dir as RIGHT (the
  start corner is the TL of the topmost-leftmost filled cell = BR-only, first move RIGHT).
  Closure (polygonToShapePath always re-appends start + Douglas-Peucker) was never the bug —
  the geometry was just half-missing. The unit tests missed it because they only asserted
  axis-aligned rectangles + a 3×3 L (whose boundaries lack an up-left diagonal); regression
  cases now assert shoelace area ≈ filled-cell count AND traced bbox == region bbox for a
  diamond, disk, and plus/cross (`bitmapTrace.test.ts`).
- **Shape fills use the SWF fill0/fill1 (left/right) edge model; `convertShape` must
  reconstruct CLOSED loops, not emit per-style-run ribbons.** Each `Fla8Edge` records the
  fill on its LEFT (`fill0`) and RIGHT (`fill1`) side. A single filled region is bounded by
  edges scattered through the stream, and an edge bordering region R on its `fill0` side
  runs OPPOSITE to R's outline. To rebuild a region: accumulate a per-fill-style pending
  path, add `fill1` runs forward and `fill0` runs REVERSED (flipped), then link runs
  end-to-start into closed loops (a faithful port of Ruffle's `ShapeConverter` in
  `render/src/shape_utils.rs`). The old converter chopped the edge stream into one OPEN
  ribbon per style-run. This was invisible for simple authored shapes (single fill on
  `fill1`, contiguous edges) but catastrophic for **traced bitmaps** — `Magnet.fla`'s
  "images" (Bowl/Mag/Magnetism logo/balls) are NOT bitmaps on stage: they were
  `Trace Bitmap`-converted into vector shapes with hundreds–thousands of solid fills each
  (top shape: 1078 fills). The naive converter produced ~3000 open filled slivers → mangled
  on the editor stage and dropped/blank in the SWF. After reconstruction every path is a
  closed loop and both paths render. The library still holds the source bitmaps (Trace
  Bitmap is non-destructive), which is why "the Library has images but the stage is shapes
  you can select parts of". Fills/strokes are now emitted as SEPARATE closed paths (fills
  first by ascending style id, then strokes), matching the SWF shape model — the renderer's
  two-pass (fills then strokes) draws them correctly. `convertShape` shares ONE `Fill`
  object reference across all loops of a given style id; `renderShape` exploits this to
  batch consecutive same-reference SOLID fills into a single non-zero `fill()` so inner
  "hole" loops cut against their outer loop on the stage (editor shapes use distinct Fill
  objects per path, so the batching is a no-op for them). The SWF is correct for the same
  reason on the encoder side: it dedups fills by colour and Ruffle re-groups all loops of a
  fill and applies winding.
- **Bitmap display objects store UNSCALED `width`/`height` + separate `scaleX`/`scaleY`;
  the stage renderer must apply the scale** (`renderer.ts` `renderBitmapObject`). The FLA
  importer (and `libraryplace.ts`) set `width = originalWidth` and carry the display scale
  in `scaleX`/`scaleY` (decomposed from the placement matrix). The renderer's `bitmap` case
  previously drew at `obj.width`/`obj.height` and ignored scale, so e.g. a 1152px photo
  placed at `scaleX≈0.48` rendered 2× too large. Apply `translate(x,y)→rotate→skew→scale`
  around the registration origin (NOT the bitmap center — the old center-pivot rotation
  also disagreed with the SWF, whose PlaceObject matrix pivots at the origin). The SWF
  compile path was already correct (`bmpTransform` in PlaceObject2/3); only the stage was
  wrong.

### SWF encoding

- **`compileDocument` is a thin orchestrator; the pipeline lives in `packages/swf/src/compiler/`.**
  The former 3200-line `compile.ts` was decomposed into one cohesive module per pass, each
  consumed in order by the ~230-line orchestrator: `header.ts` (FileAttributes…SetBackgroundColor),
  `fonts.ts` (`runFontPass` — DefineFont3/AlignZones + glyph subsetting), `media.ts`
  (`runMediaPass` — DefineSound/DefineVideoStream), `symbols.ts` (`runSymbolPass` —
  DefineSprite/DefineButton2 + linkage), `characters.ts` (`runCharacterPass` — per-object
  DefineShape4/Text/EditText/MorphShape/bitmap defs), `depth.ts` (`createDepthAllocator` +
  `runDepthPrepass`), `frames.ts` (`runFrameLoop` — the per-scene/frame display-list diff +
  PlaceObject2/3 routing dispatcher), `sound-stream.ts`, `assemble.ts`, plus `options.ts`
  (`CompileOptions`) and `display.ts` (`flattenDisplayObjects`). Each pass takes `writer`/`doc`
  and returns the lookups (charId maps, etc.) the next passes consume — the only shared coupling
  is the explicit pass inputs/outputs, not a god-context. `compile.ts` re-exports `CompileOptions`
  /`collectFontFaceRequests` so the public API and the ~80 `../compile.js` test imports are
  unchanged. The decomposition was behavior-preserving: golden-parity self-determinism hash
  `57db995821e170ee` and all unit tests held byte-for-byte across every step. To change a stage,
  edit its module; to change pass ORDER, edit the orchestrator.
- **Static-text alignment XOffset must be applied in ALL THREE emit paths** (task 1199):
  scene/main-timeline (`compile.ts`), button labels (`buttons.ts`), and movieclip/graphic-
  internal text (`sprite.ts`). The centered/right-aligned start offset is computed by the
  shared `alignXOffsetTwips()` helper in `text.ts` ((boxWidth−textWidth)/2 for center, full
  free space for right). The symbol-internal paths used to hardcode XOffset=0, so labels
  rendered left-of-center (golden 'Click to Play' button: 0 vs golden 280). Per-glyph
  advance + y_offset deltas vs golden are an inert NotoSans↔Arial font-metric pivot.
- **LINESTYLE2 byte order**: `EndCap` bits and miter limit must be written in the exact
  bit order the SWF spec prescribes; swapping them truncates the rest of the record.
- **DefineShape4 vs older tags**: always emit tag 83 (DefineShape4) for Flash 8 targets;
  tags 2 and 32 lack LINESTYLE2 and gradient enhancements.
- **PlaceObject3 required for filters**: filters and blend modes need tag 70
  (PlaceObject3), not tag 26 (PlaceObject2). Emitting PO2 silently drops all filter
  data; Ruffle sees no filter and renders the object unfiltered.
- **Filter TWEENS need a `filtersKey` in the frame-diff change detection (task 1210)**:
  `frames.ts` decides whether to re-emit a placement on a move by comparing the prev
  per-depth state (`posChanged`). It keyed on x/y/scale/rotation/colorEffect/clipActions
  but NOT the filter list, so a tween that changes ONLY the filter (e.g. the Blur timeline
  effect ramping a BlurFilter 0→max→0 with the object fixed at one position) suppressed the
  move entirely and the blur froze at its first-frame value. Fix: `filtersKey(displayObj)`
  serializes the enabled filters; it is added to `posChanged` and to every `depthState.set`.
  The per-frame interpolated filter (from `getTweenedFrame` → `interpolateFilters`) now
  emits a fresh PlaceObject3 each frame. Acceptance: `blur-tween.test.ts` (blurX ramps
  0→peak→0 across the span). The interpolation engine + PO3 filter emit already existed;
  the only gap was this change-detection key. Blur timeline-effect synthesis lives in
  `useTimelineEffectHandlers.ts` (3 keyframes: start/mid-peak/end, motion-tweened).
- **Shape origin normalization**: encode shape paths relative to (0,0) in DefineShape,
  and put the full stage offset in PlaceObject2 `tx/ty`. Baking absolute coords into the
  shape record and also translating via PO2 double-offsets the object.
- **Free Transform Distort/Envelope warp is BAKED into DefineShape geometry at publish
  (task 1228).** A PlaceObject2/3 matrix is affine and cannot represent a non-affine distort
  (perspective quad) or envelope (Coons/bezier mesh), so real Flash 8 — and now the compiler
  — bake the warp into the actual DefineShape edge coordinates. The character pass
  (`compiler/characters.ts bakeWarpIntoShape`) reuses the SAME `engine/warp.ts warpShape` the
  stage renderer uses (do NOT duplicate the mesh math), then translates the warped ABSOLUTE
  stage geometry back by the object's `(x,y)` so the DefineShape stays origin-relative and
  PlaceObject2 tx/ty=(x,y) restores position (shape-origin-normalization rule). `warpShape`'s
  corners live in STAGE space, so it maps local→absolute; the renderer draws that at (0,0),
  the SWF subtracts the offset. Applies to `ShapeDisplayObject`, `DrawingObject`, and
  shape-tween (morph) start/end keyframes. `warpShape` already subdivides quadratics to
  chords; the envelope Coons patch is sampled per vertex, so a warped edge only bends where
  the shape has vertices ALONG that edge (a 4-vertex square's bottom edge won't show a
  mid-edge bow unless a midpoint vertex exists). Before this fix the published movie showed
  the pristine un-distorted shape (`grep -rniw warp packages/swf/src` returned nothing).
  Gate: `warp-bake.test.ts` (compiles a warped shape, decodes the emitted DefineShape4
  ShapeBounds from our own SWF, asserts the warp is in the geometry).
- **A warped shape must emit an IDENTITY PlaceObject2 matrix — warp supersedes affine
  (task 1230).** The 1228 bake writes the warp into ABSOLUTE-stage DefineShape geometry
  (then subtracts the placement offset), so the baked edges ALREADY encode the full
  scale/rotation effect — the warp corners are captured from the already scaled/rotated
  AABB and live in stage space. But the frame loop (`compiler/frames.ts`) still built
  `objTransform={scaleX,scaleY,rotation}` for every shape, so a shape with BOTH a warp AND
  non-identity scale/rotation got transformed TWICE in the SWF (baked warp + PlaceObject2
  affine) while the editor renderer (`engine/renderer.ts`) draws ONLY the warp (the `if
  (obj.warp)` branch supersedes the affine `else if` branch). Fix: gate the `objTransform`
  construction on `displayObj.type === "shape" && !displayObj.warp` in BOTH emit branches
  (first-placement ~467 and move ~1058); a warped shape gets `objTransform=undefined`
  (identity scale/rotate, translate-only) so the baked warp is the sole geometry transform,
  matching the stage exactly. PlaceObject2 tx/ty=(x,y) still positions it. Pure-warp
  (identity affine) and pure-affine (no warp) are unchanged; `DrawingObject` already used
  `objTransform=undefined`, so it was never affected. Gate:
  `warp-affine-double-transform.test.ts` decodes the PlaceObject2 MATRIX from our own SWF
  (warp+scaleX=2 / warp+rotation=30 → hasScale=hasRotate=false, un-doubled bounds;
  pure-affine still sets hasScale/hasRotate). Decoding the SHAPE bounds alone would NOT
  have caught this — the bug is in the placement matrix, not the baked geometry.
- **The 1228/1230 warp bake ALSO applies to SYMBOL-INTERNAL shapes (the sprite path,
  task 1232).** Tasks 1228/1230 fixed only the SCENE timeline (`compiler/characters.ts` +
  `compiler/frames.ts`). The DefineSprite builder (`sprite.ts`) has its OWN shape-encode
  pre-pass and its own PlaceObject2 emit paths, and they ignored `obj.warp` entirely: the
  pre-pass (~338) called `shiftShapePaths(obj.shape, ox, oy)` and the two emit branches
  (~705 first-placement, ~936 move) always built an affine `objTransform`. So a Distort/
  Envelope warp authored on a shape INSIDE a movieclip/graphic symbol (reachable via
  symbol-edit / edit-in-place; `handleShapeWarp` → `withSymbolTimeline` writes the warp onto
  a ShapeDisplayObject inside the symbol's timeline) was DROPPED — the published DefineShape4
  inside the DefineSprite was the pristine un-warped square (stage/SWF divergence). Fix
  mirrors the scene path: when `obj.warp` is set, bake it via the SHARED `bakeWarpIntoShape`
  (do not duplicate mesh math) and gate the sprite-internal `objTransform` to identity
  (`displayObj.type === "shape" && !displayObj.warp`) in BOTH emit branches. Coordinate-convention
  caveat: the sprite path normally bakes the (+x,+y) offset INTO the geometry (normOrigin=(x,y),
  residual PO2=0 → un-warped bounds are 1000..3000 twips for a 100px square at (50,50)), whereas
  `bakeWarpIntoShape` returns ORIGIN-RELATIVE geometry (absolute−x,y). So for warped shapes set
  `shapeNormOrigin=(0,0)` → residual PO2=(x,y) carries the offset, matching the scene path's
  shape-origin-normalization. Gate: `warp-sprite-bake.test.ts` (compiles a real movieclip-symbol
  doc via `compileDocument`, decodes the DefineShape4 hoisted above the DefineSprite AND the
  sprite-internal PlaceObject2 matrix — warp baked to 5000/4000 twips, no double-transform;
  un-warped + pure-affine symbol-internal cases unchanged).
- **DefineMorphShape2 (tag 84)**: use tag 84 (not legacy tag 46) for Flash 8 shape
  tweens so LINESTYLE2 cap/join data is preserved.
- **DefineScalingGrid (tag 78)**: must immediately follow the `DefineSprite` tag for
  any symbol whose model has `scale9Grid != null`; omitting it causes Ruffle to apply
  uniform scaling and distort 9-slice corners.
- **Runtime-sharing / Scale9 tag bodies are byte-verified (task 1226)**: the three
  linkage/grid encoders in `compiler/symbols.ts` are emitted by the orchestrator
  (`compiler/frames.ts` emits ExportAssets→ImportAssets2→DoInitAction in scene-0 frame-0;
  the symbol pass emits DefineScalingGrid right after each DefineSprite) and their exact
  bodies are now pinned by hard byte-level assertions (`importassets.test.ts`,
  `scalinggrid.test.ts` — no more `.todo`/`.expect.soft`/non-emission fallbacks). Layouts,
  all UI16 little-endian, STRING = NUL-terminated UTF-8:
  - **ExportAssets (56)** `exportForActionScript || exportForRuntimeSharing` (needs a
    `linkageIdentifier`): `UI16 count` then `{UI16 charId, STRING name}×count`.
  - **ImportAssets2 (71)** one tag per distinct `sharedUrl`, for
    `importForRuntimeSharing && sharedUrl && linkageIdentifier`: `STRING url`, `UI8 1`,
    `UI8 0` (the two reserved bytes), `UI16 count`, then `{UI16 charId, STRING name}×count`.
  - **DefineScalingGrid (78)**: `UI16 spriteId` then a byte-aligned `RECT` of the grid in
    twips (xMin=`x*20`, xMax=`(x+width)*20`, yMin=`y*20`, yMax=`(y+height)*20`); the RECT
    consumes the entire remainder of the body. Verified structurally by decoding our own
    compiled SWF — no external Flash binary required.
- **Multi-frame movies**: emit `RemoveObject2` when an object leaves the display list;
  set the `Move` flag on `PlaceObject2` for objects that persist across frames; hoist
  all character definitions before the first `ShowFrame`.
- **Embedded font glyphs (tasks 0702/0708)**: `packages/swf/src/fonts.ts` emits REAL
  vector glyph outlines from `glyphdata.ts` (auto-generated from NotoSans — see the 0708
  bullet below; a 5×7 bitmap is the per-glyph fallback) so text renders as visible pixels
  in Ruffle. Non-obvious encoding facts:
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
    scrambled, so dynamic/input text never rendered. (Whether to SET UseOutlines is
    settled by the 0710 bullet below — leave it 0 for correct device-font sizing.)
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
  - **Glyph MoveTo coordinates are ABSOLUTE, not pen-relative (task 1193)**: every
    OTHER coordinate in a SWF shape record is a delta (StraightEdge/CurvedEdge), but the
    StyleChangeRecord MoveTo is the one exception — it sets the pen to an absolute (x,y).
    Ruffle proves it: `shape_utils.rs` does `self.cursor = *move_to;` (assignment, not
    `+=`). `fonts.ts writeGlyphMoveTo` used to write `x - penX` (a delta), which works by
    accident ONLY for the first contour (pen starts at 0,0 so delta == absolute). Every
    subsequent contour — the counter of a/e/o, the dot of 'i' — landed at the wrong
    absolute position (a tiny blob near the origin / below the baseline), so single-contour
    glyphs looked fine while multi-contour glyphs collapsed. Fix: emit absolute x,y in
    MoveTo. The geometry/winding/fill-style/contour-order were all red herrings — the
    glyphs parse correctly and Ruffle's NON_ZERO winding cuts holes regardless of order;
    the ONLY bug was the relative-vs-absolute MoveTo. Debug method: a Rust dumper using the
    `swf` crate (`swf::parse_swf`) that reconstructs absolute coords treating MoveTo as
    absolute vs delta immediately reveals which one the encoder assumed.
  - **Static-text horizontal alignment is baked into the TEXTRECORD XOffset (task 1193)**:
    Flash centers/right-aligns static text by starting the glyph run at a non-zero XOffset
    (centered = `(boxWidthTwips - textWidthTwips)/2`, right = the full free width), not via
    any alignment flag in DefineText. `compile.ts` computes this from `obj.align` +
    `obj.width` using `measureTextWidthTwips` (same per-glyph advances + baked kerning as
    `encodeDefineText`). Left stays 0. (Exact byte-parity vs golden still differs slightly
    because our NotoSans advances ≠ Flash's Arial, and the authored baseline YOffset is not
    a simple fontSize fraction — golden title YOffset 660 for a 720-twip font — so y_offset
    and a few advances remain documented golden-parity gaps, not render defects.)
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
- **Publish-time system-font embedding (task 1200)**: Flash embedded the author's REAL
  system-font outlines into DefineFont2; we now do the same via the browser **Local Font
  Access API** (`window.queryLocalFonts()`) — pure browser, no Rust. Architecture: the
  font encoder (`fonts.ts` `encodeDefineFont2`) takes an optional `GlyphSource`
  (em/ascent/descent + `path(code)`/`advance(code)`); `font-extract.ts` builds one from
  the matched installed face's TTF bytes (`fd.blob() → opentype.parse → getPath`,
  cubic→quad split, scaled into the encoder's 1024 EM via `getPath`'s size arg). The
  publish flow (`usePublish.ts`) runs an ASYNC pre-pass `resolveFontGlyphSources(...)`
  BEFORE the sync `compileDocument` (mirroring the bitmap-pixel pre-decode) and passes
  the result via `CompileOptions.fontGlyphSources` (keyed by `fontKey`). `compileDocument`
  STAYS SYNCHRONOUS — golden-parity and unit tests call it directly with no map, getting
  the bundled fallback. Hard-won specifics:
  - **`queryLocalFonts()` needs a user gesture + permission** and CANNOT be granted in
    headless Chromium, so the LIVE path is unit-test-only (mock the API, inject a known
    TTF's bytes as the "system font"); structural swf-dump confirms the DefineFont2 is
    built from injected outlines. Only the bundled FALLBACK is observable in Ruffle e2e.
  - **opentype.js is CommonJS** — a named ESM import (`import { parse }`) throws under
    raw Node ESM (`golden-parity.mjs`) even though vitest/esbuild tolerate it. Use
    `import opentype from "opentype.js"; const parseFont = opentype.parse;`. No `@types`
    ship; add a local `opentype.d.ts` ambient module shim.
  - **Bundled fallback is now weight/style-aware**: `gen-glyphdata.mjs` emits FOUR
    variant tables (regular/bold/italic/boldItalic) from bundled Noto Sans TTFs (OFL).
    The canonical static bold/italic are EM=1000 while the pre-existing regular subset is
    EM=1024 — `getPath(0,0,1024)` normalizes every variant into the same 1024 EM box, and
    advances are scaled by `1024/unitsPerEm`. Regenerating keeps the REGULAR table
    byte-identical to the old single-variant data (verified), so golden-parity does not
    regress; bold golden title now embeds bold Noto (e.g. 'T' advance 11860 vs regular
    11380 at the 20× DefineFont3 scale).

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
- **The editor Output panel must capture trace() via Ruffle's DEDICATED
  `traceObserver`, NOT by scraping console.log (task 1259).** `RufflePlayer.tsx`
  used to intercept console.log/console.warn and forward lines through
  `shouldSuppressRuffleLog`, on the assumption (codified in a now-fixed
  `ruffleLogFilter.test.ts` case) that AS2 `trace()` arrives as a PLAIN
  console.log line. It does not. Ruffle emits `trace()` as a tracing **INFO**
  event on the `avm_trace` target (web/src/log_adapter.rs `avm_trace`), which the
  WASMLayer renders to the console as a styled `"%cINFO%c ... avm_trace ... <msg>"`
  line. After CSS stripping that text starts with `"INFO"`, which matched the
  `RUFFLE_SUPPRESSED_PREFIXES` `"info"`/`"avm"` entries → every trace line was
  dropped before reaching `onTrace`/`handleTrace`, so the Output panel stayed
  empty (only the placeholder). This NEVER worked (present since feat(0738)). Fix:
  register Ruffle's dedicated trace observer — `player.traceObserver = (msg) =>
  onTrace(msg)` (the `<ruffle-player>` element exposes a `traceObserver` setter
  that forwards to the WASM `set_trace_observer`; bundled build supports it). The
  observer fires ONLY for real avm_trace and bypasses the INFO console filter
  entirely. **Timing gotcha (load-bearing):** the bundled setter is
  `set traceObserver(e){ this.instance?.set_trace_observer(e) }` — `this.instance`
  is null until `load()` creates it, so a pre-`load()` assignment is a SILENT
  no-op. The binding that takes effect is the one set AFTER `load()` resolves;
  RufflePlayer sets it both before (future-proofing) and after load. The
  first-frame DoAction runs on the tick after load() resolves, so the post-load
  set is in time to catch frame-1 trace(). console.warn ERROR/WARN scraping is
  kept for diagnostics; avm_trace must NOT also be routed through the
  INFO-suppressing console path (no double-delivery). The trace-routing helper is
  `makeTraceObserver(getOnTrace)` in `ruffleLogFilter.ts` (lazy ref read so a
  changing callback identity is always current). Distinct from task 1120 (JSFL
  `fl.trace()`, a different source: `jsfl/runtime.ts state.traces`). Gates:
  `ruffleLogFilter.test.ts` (observer forwards unfiltered; styled-INFO avm_trace
  console line stays suppressed) + `apps/desktop/e2e/trace-output.spec.ts`
  (publishes a SWF with `trace("hello")` on frame 1, runs it in the real bundled
  Ruffle via the observer, AND drives the in-app Test Movie flow asserting the
  line appears in OutputPanel `data-testid="output-panel-messages"`).
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
- **AS2 class INSTANCE field initializers are HOISTED into the constructor, not the
  prototype (task 1314).** `compileClassDecl` (`as2/compiler.ts`) used to emit a class
  instance field with an initializer — `var n:Number = 7;` / `private var vy = 0;` — as
  `ClassName.prototype.n = 7` (a SHARED prototype assignment). That value did NOT take
  effect for an instance created when a library MovieClip is linked to the class via
  `className` linkage and placed/`attachMovie`d: Ruffle sets that instance's `__proto__`
  to `ClassName.prototype` and runs the class constructor, and the field read `undefined`
  (cascading to `NaN`). Real Flash 8 / MTASC compile each instance field initializer to a
  `this.<name> = <init>;` assignment at the START of the constructor body (BEFORE the
  authored ctor statements). Fix: `compileClassDecl` step 1b synthesizes those `this.x =
  init` ExprStmts (from `Identifier "this"` + `MemberExpr` + `AssignExpr`, `pos/line=0`)
  and prepends them to the ctor body; if the class has no explicit constructor it
  synthesizes one holding only the initializers. Step 5 now emits ONLY **static** fields
  on the class object (`ClassName.n = …`); instance fields produce no prototype
  assignment. An instance field with NO initializer emits nothing (an unset field is
  `undefined`, matching Flash). Methods + statics are unchanged; `extends`/`super` are
  unaffected because `ActionExtends` links the prototype chain at class-definition time,
  so the own-property writes are valid before `super()` runs (Flash also initializes field
  defaults before the authored body). The string-collection pass (`collectStrings` →
  `scanClassDecl`) was updated to match: instance-field-with-init adds `"this"` + scans
  the init (no `"prototype"`), and the CONSTRUCTOR FunctionDecl (name === class leaf) is
  excluded from the instance-method `"prototype"` pool-add (it becomes the class function,
  not a prototype method). `pushString` falls back to an inline string when a constant is
  absent from the pool, so the pool change is an optimization, not a correctness
  dependency. Acceptance is the Ruffle e2e (byte tests insufficient, per the Verification
  learning): `apps/desktop/e2e/as2-class-field-init.spec.ts` links a field-init class to a
  MovieClip, attaches it, and asserts the field reads the INITIALIZED value at runtime —
  `7` with NO explicit constructor, `15` (=5+10) WITH an explicit constructor (proving the
  initializer ran first, THEN the ctor body). `classes.test.ts` test 6 (which previously
  asserted the prototype assignment) was rewritten; `as2-class-attach`/`as2-class-capstone`
  still pass.

### Authoring UI

- **Timeline panel layout spec lives in `docs/20-timeline-ui-layout.md`** — pixel-level
  Flash 8 chrome (16px frame cells, 38px rows, 10px keyframe dot 24px-from-top, layer-row
  column order, status-bar contents, inset readouts). Update it alongside `Timeline.tsx`.
- **The Timeline panel does NOT own its outer height.** `Timeline.tsx` fills its parent
  (`height:100%`); the visible height = `Shell.tsx` `timelineResize.size` (a `useResize`)
  minus the 24px dock-tab bar (`bottomContent` is `flex:1`). To change default/min/max
  timeline height, edit the `useResize(...)` call in Shell, not a constant in Timeline.
  Drag-to-resize already exists via the Shell `hResizeHandle` between the dock and stage;
  don't add a second splitter inside the panel. The Shell dock-tab already labels the
  panel "Timeline", so the panel has no internal title bar (would double up).
- **HMR preserves `useState` initial values**: changing a `useState(default)` won't take
  effect on an already-mounted component via hot reload — do a full page reload to see a
  new default. (Bit me verifying a new timeline default height.)
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
- **The `ScriptEditor` (AS2 highlight + live parse-error gutter) is now EXPORTED
  from `ActionsPanel.tsx` and reused by the Classes panel (task 1302 P4).** It is
  fully self-contained — props are just `script`/`onScriptChange`/`onCursorChange`
  — so the Classes panel gets syntax highlighting + the error gutter for free by
  keying one `<ScriptEditor key={selectedPath} />` on the selected `.as` file.
  Don't fork it; if frame and class editing need to diverge, add props.
- **A new bottom-dock tab is a 4-touchpoint change, no exhaustive switch to chase
  (task 1302).** To add a tab (e.g. `Classes`): (1) extend the `BottomTab` union
  in `store/uiStore.ts`; (2) add it to the persisted `BOTTOM_TABS` allowlist in
  `editorLayout.ts` (else `normalize()` coerces a persisted value back to default
  and the tab won't restore on reload); (3) add `{ id, label }` to `BOTTOM_TABS`
  in `Shell.tsx`; (4) add a `{bottomTab === "x" && <Panel/>}` branch in the
  bottom-dock content. The dock renders independent `&&` branches (not a switch),
  so nothing else breaks, and the responsive (task 1280) wiring is tab-agnostic.
- **The TOP dock is now tabbed too: Timeline | Live Preview (task 1308).** The
  top dock (beside the stage) used to be a single Timeline toggle; it is now a
  two-tab strip driven by `uiStore.topTab: "timeline" | "preview"` (persisted via
  `editorLayout` — same 5-touchpoint pattern as a bottom tab: union + default +
  `TOP_TABS` allowlist + `layoutToUiInit`/`uiStateToLayout` + Shell wiring).
  Clicking the active top tab collapses the dock (reuses `timelineCollapsed`).
- **Live Preview = pure controller + thin React adapter (task 1308).** The
  debounced/superseding/error-resilient hot-reload loop is a framework-free class
  `preview/livePreviewController.ts` (node-unit-tested with injected timers/clock;
  a monotonic generation counter is the supersession authority so a stale
  in-flight compile can never overwrite a newer result), wrapped by
  `preview/useLivePreview.ts`. It REUSES the compiler via a new
  `usePublish().compileDocToBytes(targetDoc, {skipSystemFontPrompt})` —
  `publishToBytes()` now delegates to it; the preview passes `skipSystemFontPrompt:
  true` so a background recompile never fires the Local Font Access prompt.
  Start-from-scene/frame is done by prepending a `gotoAndPlay` to a SHALLOW-CLONED
  doc's first keyframe (`preview/startAt.ts`) — the compiler is never duplicated.
  On COMPILE ERROR the last-good SWF stays mounted (preview not blanked) + a
  non-blocking banner shows the message. `RufflePlayer` gained optional
  `loadOptions` (quality/scale/letterbox/bg/mute) + an `onControls`
  (play/pause/restart) handle. Gate: `live-preview.spec.ts` (edit→reload;
  compile-error→last-good+overlay; fix→recover) + the 3 preview unit specs. The
  Ruffle bundle (`apps/desktop/public/ruffle/`) is GITIGNORED, so a fresh worktree
  must materialize it to run the e2e. Run `node tools/copy-ruffle.mjs` (copies the
  bundle from the installed `@ruffle-rs/ruffle` package — resolved from
  `@flash/player`, where it's a dep — into `apps/desktop/public/ruffle/`); or
  symlink it from the main checkout. (Note: the worktree has no
  `apps/desktop/public/` at all until copy-ruffle / `mkdir -p` creates it.)
- **The Ruffle asset URL MUST be base-relative, not root-absolute (task 1362 — GH
  Pages 404).** Two independent defects broke ALL Ruffle playback on the
  `jhead.github.io/dash/` deploy: (a) `RufflePlayer.tsx` defaulted `ruffleBaseUrl`
  to a ROOT-ABSOLUTE `"/ruffle"`, so under the production Vite base `/dash/` the
  script URL `/ruffle/ruffle.js` resolved to `jhead.github.io/ruffle/ruffle.js`
  (404) instead of `.../dash/ruffle/ruffle.js` — the URL never consulted the base.
  (b) the gitignored bundle was never copied into the Pages artifact, so even the
  correct `/dash/ruffle/` path had no files. Fixes: (a) the default now derives
  from `import.meta.env.BASE_URL` via the pure `resolveRuffleBaseUrl(viteBaseUrl())`
  helper (`packages/player/src/ruffleAssetUrl.ts`) → `/dash/ruffle` in prod,
  `/ruffle` in dev/Tauri (BASE_URL is `/dash/` only when `NODE_ENV=production`; dev
  and Tauri both use `/`). `@flash/player` is path-aliased into the app's Vite
  build, so `import.meta.env.BASE_URL` is statically substituted there. An explicit
  `ruffleBaseUrl` prop still wins. Watch BASE_URL's trailing slash when
  concatenating (helper handles it). (b) `pages.yml` runs `node tools/copy-ruffle.mjs`
  BEFORE `vite build` so `public/ruffle/` exists and Vite copies it to
  `dist/ruffle/` at the `/dash/` base. Verify by building with `NODE_ENV=production`
  and grepping the emitted bundle: the loader builds `` `${l}/ruffle.js` `` where
  `l = ruffleBaseUrl ?? resolveRuffleBaseUrl(viteBaseUrl())` and `index.html`
  references `/dash/assets/...` (proving the base is applied). Gate:
  `packages/player/src/__tests__/ruffleAssetUrl.test.ts` (resolves `/dash/` →
  `/dash/ruffle`, `/` → `/ruffle`, trailing-slash + empty-base edge cases).
- **Keypresses inside a Ruffle player must NOT leak to the authoring app — use a
  containment check, never `stopPropagation` (task 1324).** Many editor shortcuts
  are GLOBAL (`window`/`document` keydown listeners): tool hotkeys (`ToolsPanel.tsx`),
  arrow-key nudge + tool/clipboard/arrange/F8/Delete/Enter (`dispatch/keyboard.ts`
  + SEVEN listeners in `StageArea.tsx`), Test Movie / zoom / panel toggles
  (`Shell.tsx`), undo/redo (`hooks/useHistory.ts`). When the user interacts with a
  running SWF in the Test Movie modal OR the Live Preview tab, those keys belong to
  the SWF — arrow keys must drive the game, not nudge a selected shape; letters must
  reach AVM1, not switch the tool. Fix: every global authoring keydown handler now
  early-returns on `isWithinRufflePlayer(e)` (`dispatch/playerFocus.ts`), a shared
  containment check — `e.target.closest('[data-ruffle-host]')`, falling back to
  `document.activeElement` (Ruffle registers on `window`, so the event `target` is
  often `window`, but FOCUS is genuinely inside the player). The marker
  `data-ruffle-host="true"` is on the RufflePlayer container (`@flash/player`),
  which BOTH the Test Movie modal and Live Preview embed — one check covers both.
  Critical: do NOT `stopPropagation()` on the player container — Ruffle's OWN keydown
  listener is also on `window`, so stopping propagation to window would block the SWF
  too. The containment check leaves Ruffle's window listener untouched, so the SWF
  keeps receiving keys (`keyboard.spec.ts` still passes: ArrowRight fires
  onClipEvent(keyDown), pixelDiff 10000, with the player focused). `Timeline.tsx`'s
  listener was already safe — it's panel-scoped (`panelRef.contains(activeElement)`),
  and the player is never inside the timeline panel. Test Movie's Escape-to-close
  (`PlayerWindow.tsx`) is NOT guarded (it's the player's own behaviour) so Escape
  still closes the modal. The legacy `Shell.tsx playerOpenRef` Test-Movie guard is
  kept as belt-and-suspenders. Gates: `dispatch/__tests__/playerFocus.test.ts`
  (6 unit cases incl. the activeElement fallback) + `preview-key-isolation.spec.ts`
  (e2e: control proves "t" switches tool when editor focused; then with the Live
  Preview ruffle-player focused, "t"/arrows/"p" leave the tool unchanged).
- **Browser-persistent projects = IndexedDB bytes + localStorage metadata, split
  by SIZE (task 1310).** A project is a serialized `.fla` (`saveFla → Uint8Array`,
  multi-MB with embedded media) so the BYTES live in IndexedDB (`dash-projects`
  DB, one `projects` store keyPath:"name", mirrors `vfs/indexeddb.ts`: injectable
  `IDBFactory` for fake-indexeddb, awaited txn completion). The TINY metadata —
  active project name + the Open Recent list (capped 15, dedup) — lives in
  localStorage (`flash8.recentProjects`, preferences.ts hygiene: versioned
  envelope + normalize + try/catch) because it must be read SYNCHRONOUSLY on first
  render to drive restore-on-load before the async IndexedDB read resolves.
  AUTOSAVE is a framework-free `autosaveController.ts` (same shape as
  `livePreviewController.ts`: injected timers, monotonic generation = supersession
  authority) debouncing ~1.5 s; it writes a reserved CURRENT-WORKING slot
  (`__dash_current__`, excluded from `list()`) so F5 restores in-progress work
  even for an UNNAMED doc, plus the active named slot when one exists. Save As
  writes BOTH the named slot and the working slot (so a reload reopens the named
  project) and sets the title-bar name (`EditBar.documentName ← activeName`).
  `ProjectQuotaError` wraps a QuotaExceededError so autosave degrades silently
  (in-memory doc is the source of truth). On TAURI the IndexedDB path is skipped
  (`isTauri()`); the same recent list tracks file PATHS via `noteOpenedPath`.
  Restore + actions run from `useProjectActions.ts` mounted once in Shell;
  parse/quota failures return null and fall through to a fresh `createDocument()`,
  never throw. Gates: 4 node unit specs (`projectStore`/`autosaveController`/
  `recentProjects`/`projectSession`) + `persistent-projects.spec.ts` (edit→reload→
  restored; Save As→reload→reopens named; plain Save updates active slot). The DEV
  `__flashTest` bridge gained `saveProjectAs`/`saveProject`/`flushAutosave`/
  `getActiveProjectName`/`getRecentProjects` for the e2e.

### Vector merge model — Flash 8 "shape soup" (docs/36)

- **Merge drawing is the DEFAULT vector model as of the P5 cutover (task 1323) — no
  feature flag.** Committing a `type:"shape"` display object folds it into the active
  layer's planar arrangement (same-color UNION / different-color CUT / line-splits-fill
  / true-subtract eraser, all curve-preserving) via `planarMergeCommit`
  (`engine/planar/merge.ts`) → read back to per-path closed loops by `planarShapeToShape`
  (`engine/planar/query.ts`). The gate is now ONLY `obj.type === "shape"` in
  `Shell.tsx handleShapeCreated` / `commitMergeShapeDirect`. **Object Drawing mode emits
  `type:"drawing-object"`, which bypasses the fold** — that is the discrete-object
  alternative, unchanged. The `planarMergeOnCommit` flag, the whole `engine/featureFlags.ts`
  module (it held only that flag), the dead MVP `engine/merge-drawing.ts` (AABB merge
  approximation, superseded by the kernel in P1), and the no-op `engine/shape-boolean.ts`
  stub were all DELETED. `engine/eraser.ts` is NOT dead — it is the legacy per-object
  curve-flattening eraser, still used for the cases that never enter the merge map: Object
  Drawing shapes, non-identity-transform shapes, gradient/bitmap fills (`isMergeableShape`
  rejects non-solid fills). The planar vs legacy eraser is now chosen purely by geometry
  (merged mergeable shape at identity transform / origin), not a flag.
- **The planar↔per-path interchange is SUFFICIENT for SWF/FLA — `FillStyle1` does NOT
  need populating.** The merged artwork reads back as per-path closed loops (one solid
  fill per loop; holes share the same `Fill` reference, cut by non-zero winding). The SWF
  encoder emits that single-fill-per-loop form (`stateFillStyle1=0` in
  `packages/swf/src/shapes.ts`) and Ruffle renders it identically — proven by all 8
  `merge-drawing-oracle.spec.ts` cases publishing SWF that pixelmatches the stage at
  diff=0/220000. Populating `FillStyle1` (the dual-fill edge model) would only reduce the
  DefineShape edge-record count (closer byte-match to Flash's own loops) — an
  optimization, not correctness. A merged shape also saves/loads as an ordinary per-path
  `Shape` (the LIVE planar map is re-derived on demand via `livePlanarShape`), so FLA
  needs no merge-map record. Don't treat the "P5 interchange gaps" (FillStyle1 / FLA
  merge-map / topology-morph) as blockers — they're optional follow-ups.
- **Merge fold is bbox-CULLED, not a whole-layer rebuild (task 1327 — was the dense-art
  perf cost).** `planarMergeCommit` used to call `buildArrangementFromShapes` over EVERY
  mergeable shape on the layer per commit, so one stroke "rebuilt the world" — `insertEdge`
  scans all half-edges (~`O(E²)`), so 100/400/800 disjoint fills cost ~35/61/176 ms and a
  1000+-fill traced bitmap hitched ~239 ms PER STROKE. Fix: `foldShapeIntoLayerCulled`
  (`engine/planar/merge.ts`) folds ONLY the mergeable shapes whose stage-space bbox overlaps
  (within a 1 px tolerance) the incoming stroke's bbox through the kernel; **disjoint shapes
  are kept UNTOUCHED** and re-emitted as their own display objects, so a layer may now hold
  several merged shapes instead of always collapsing to one. Correctness is EXACT: a disjoint
  shape contributes no edges that cross the stroke (no union/cut/split possible), and a
  non-interacting shape is an identity through the kernel — the merged artwork equals the full
  rebuild, just bounded to the shapes that actually interact. Touching-edge shapes are kept IN
  by the tolerance so coincident-edge unions still see both sides. Result: per-stroke fold on
  a 1000-fill layer dropped ~239 ms → ~2 ms (a stroke that genuinely spans the whole layer
  still does the full ~216 ms fold — that work is real). All 8 oracles still diff=0/220000;
  the curve-aware `shapeStageBBox` reuses the existing `edgeBBox`. Gate: `planar-merge.test.ts`
  "spatial-cull incremental fold" (untouched-disjoint / culled==full-rebuild / touching-edge /
  PERF 500-fill bounded). `foldShapeIntoLayer` (whole-layer) is kept for tests/explicit callers.
  Note: the merge wiring in `Shell.tsx` is unchanged — `planarMergeCommit`'s signature/result
  contract is identical, the culling is internal.
- **Whole-shape drag in merge mode = split-on-move (geometry translates, NOT the object
  offset).** A drawn shape commits as one merged shape at (0,0) with geometry in stage
  space. The selection tool's `partialSelectEnabled` path (active whenever the selection
  tool is active) picks the clicked face and, on drag, EXTRACTS + translates that geometry
  via `splitOnMove` — the display-object `x/y` stays at the origin. Any test/assertion that
  expected `obj.x` to change on a selection drag must instead observe the artwork's
  stage-space geometry move (e.g. `pointer-stage-1275.spec.ts` 1264 now tracks the shape
  centroid). This is the authentic Flash 8 outcome (you move the artwork, not a container).
- **The split-on-move drag now has a LIVE preview; commit is still one mouse-up step
  (task 1331).** Originally `splitOnMove` ran ONLY on pointerup, so a partial move showed
  NO live render — the artwork sat at its origin and jumped to the final spot on release
  (the whole-object `selectionDragRef` live path was no longer reached once
  `partialSelectEnabled` became always-on for the Selection tool in the P5 cutover). Fix is
  render-only in `StageArea.tsx`: on the first pointermove past the 3px threshold, run
  `splitOnMove(ps, keys, 0, 0, …)` ONCE to extract `{remainder, extracted}` (cached in a
  ref), then EACH move just TRANSLATES the extracted geometry by the live offset (swap the
  target shape in the rendered scene graph for remainder@base + extracted@(base+dx,dy); the
  halo follows). No per-move planar recompute — relies on the invariant
  *split-at-0-then-translate(dx,dy) == split-with-delta(dx,dy)* (extracted is
  `translateShape(extracted, dx, dy)`, remainder is delta-independent — see `split.ts`). The
  doc is NOT mutated during the drag; `Shell.handleSubSplitMove` still commits the
  authoritative split once on mouse-up (one `pushDoc`/undo, geometry identical). A
  sub-threshold click only selects. **Stroked-curve pick caveat (latent, NOT this task):** a
  stroked ellipse commits as ~25 fragmented merge fill-loops whose CENTRE face `pickAt`
  returns null, so a stroked-oval whole-fill drag can't be picked at its centre; a
  stroke-NONE oval commits as one clean loop and picks/drags fine. The e2e
  (`drag-live-preview-1331.spec.ts`) draws stroke-free + matches the exact fill colour
  (`__flashTest.setFillColor`/`setStrokeNone`) and screenshots the LIVE canvas mid-drag (the
  doc is unchanged mid-drag, so `getDocument()` can't see the preview — must screenshot).

### Collaboration — Yjs derived-binding (docs/37, task 1343 P0)

- **The `@flash/collab` binding is a DERIVED projection — the immutable
  `FlashDocument` stays source of truth; Yjs only merges.** New package
  `packages/collab` (`@flash/collab`) keeps Yjs OUT of `@flash/core` (which must
  import cleanly in Node/browser/Tauri); collab depends on core for TYPES only.
  The authoring-ui adapter (`store/collabAdapter.ts`) is the only editor touch
  point and runs ONLY when `attachCollab(store, ydoc)` is explicitly called —
  default OFF, solo unchanged. There is NO networking at P0 (tests wire two
  in-process `Y.Doc`s).
- **The single hook point is the zustand store's `apply()`** (`set({ history:
  historyReducer(...) })` in `store/documentStore.ts`): `pushDoc`/`replaceDoc`/
  `commitDrag`/`undo`/`redo` all route through it and a full bypass audit found
  NO other writer of `history.present`. So one `store.subscribe` captures every
  edit. Adapter maps `getDoc→history.present`, `applyRemote→replaceDoc` (NOT
  pushDoc — remote edits must not create local undo entries), `subscribe→subscribe`.
- **Outbound is a structural-sharing diff, not a re-materialize.** The model's
  pure mutations preserve sibling references (no global deep rebuilds), so
  `diffDoc(prev,next)` descends ONLY where object refs differ and writes the
  minimal delta in ONE `ydoc.transact(localOrigin)`. `prev===next` is a valid
  skip. A single scalar edit emits <½ the bytes of a full materialize (gated).
- **Mapping granularity (the spec's core call):** displayObject SCALARS are
  per-field `Y.Map` entries (two peers editing x vs y merge); `shape` geometry +
  `filters`/`colorEffect`/`warp` are stored ATOMICALLY (whole-value LWW — segments
  have no stable id, finer merge needs a forbidden custom merge). `displayObjects`
  + `library.items` are `Y.Map<id, child>` + a sibling `__order: Y.Array<id>`
  (per-object merge with deterministic z-order). `asClasses` is
  `Y.Map<path, Y.Text>` (char-level merge via min prefix/suffix splice). scenes/
  layers/frames are positional `Y.Array`s. Inbound origin-filters on `localOrigin`.
- **Round-trip fidelity hinges on NEVER storing `undefined` in a Y container** —
  an absent optional field (`scaleX?`, `alpha?`, …) must rebuild as ABSENT, so the
  binding drops `undefined` keys, deletes vanished keys, and compares with a JSON
  equality treating `{a:1}`≡`{a:1,b:undefined}`. Without this, deepEqual fails on
  every object with optional fields.
- **Integrate a fresh Y type into its parent BEFORE materializing into it.**
  Creating `new Y.Map()`, filling it, THEN `parent.set(...)` triggers Yjs's
  "Invalid access: Add Yjs type to a document before reading data" on any read of
  its detached sub-types. Fix: `parent.set(key, child)` first, then materialize
  into the now-integrated `child` (same for `Y.Array.push` then write-by-index).
- **Acceptance = a property test as the gate** (`packages/collab/.../property.test.ts`):
  120 seeds × 60 steps = 7,200 random mutations through the REAL `@flash/core`
  functions, synced via the binding to a SECOND Y.Doc, rebuilt, deepEqual to
  source AFTER EVERY step (+ 200-step local round-trip + min-delta proof).
  `binding.test.ts` proves per-field merge, atomic-geometry LWW, char-level
  asClasses merge, origin filtering / no-echo, and late-join adoption. 9/9 pass.
  Known limits: positional-array concurrent same-index insert can interleave;
  atomic geometry is one-artist-per-shape; `flaSwfBlobs` (Uint8Array, import-only,
  never produced by a mutation) is mapped atomically as base64 outside the test
  surface; bitmap/sound/video bytes intentionally NOT in Y (out-of-band in P4).
- **Inbound CRDT state is UNTRUSTED — validate/normalize before replaceDoc (task
  1350).** The trust model is "anyone with the link is a full collaborator", so a
  peer's Y.Doc is untrusted input. `rebuildDoc` ends in a CAST (`... as unknown as
  FlashDocument`), not a check, so a malicious/buggy peer could push garbage that
  the renderer/SWF compiler index structurally → crash/DoS, doc corruption for
  everyone, or `asClasses` path traversal on a later class sync. Fix:
  `validateInboundDoc` (`packages/collab/src/validate.ts`), a TOTAL function (never
  throws) run on every inbound rebuild BEFORE `applyRemote`/`replaceDoc` — in the
  binding's deep observer, the late-join constructor adoption, AND the one-shot
  `yDocToFlashDoc`. It DROPS display objects/library items with unknown
  `type`/`itemType` or missing string `id`, COERCES `NaN`/`Infinity` coords to
  finite, forces structural children to arrays, clamps document properties to sane
  finite values, runs every `asClasses.path` through `normalizeClassPath`
  (traversal/NUL/empty rejected; absolute trimmed to relative), and bounds array
  length + value depth (cyclic-ish/oversized payloads truncated, not OOM). FAIL
  SAFE: non-object input keeps the last-good doc (binding passes `lastSynced` as
  fallback). It is IDENTITY on a valid doc (`validateInboundDoc(valid) ≡ valid`),
  so the P0 property/round-trip gates (which call `rebuildDoc` directly) are
  untouched — `validateProperties` overlays `createDocumentProperties()` defaults
  but a valid doc already carries all those fields, so the overlay is idempotent.
  NOT covered: the AS2 `script`/`asClasses`-source EXECUTION vector (peer code runs
  in your Ruffle sandbox) — inherent to doc-sharing, same as opening someone's
  `.fla`; only the storage SHAPE (script must be string) + class PATH are
  sanitized. Gate: `validate.test.ts` (13 cases incl. a peer injecting raw hostile
  Y.Doc state directly). Distinct from P5 transport/encryption (1348).
- **P5 hardening = expectations + surfacing + measurement, NOT new product
  surface (task 1348, FINAL collab phase; docs/37 §13).** Six items: (1)
  **Peer-count realism** — y-webrtc is a FULL MESH (O(N²) connections, per-peer
  fan-out ~linear in N); correctness is N-independent (Yjs converges; the 6-peer
  mesh test proves it) but PERFORMANCE degrades past a handful. No artificial
  cap; `peerCountAdvice(peers)` (`collab/peerCount.ts`) warns past
  `PEER_COUNT_WARN_THRESHOLD`=15 participants, surfaced as an amber pill ⚠ +
  Share-dialog banner. (2) **Reconnection** — Yjs re-syncs the DOCUMENT free via
  the state-vector protocol; what's NOT free is AWARENESS (non-persistent, 30 s
  TTL) so `attachReconnect` (`collab/reconnect.ts`) re-`flush()`es presence on
  every provider `peers` event that ADDS a peer (join/churn/reconnect). (3)
  **Large-doc perf** (`collab/perf.test.ts`): a 4000-mutation doc (~268 KiB,
  41 scenes, 244 lib items) first-syncs in ~163 ms total (materialize ~86 +
  encode ~20 + apply ~25 + rebuild ~32); a single scalar edit diffs to **31
  bytes = 0.011%** of the full doc in ~3.4 ms — the minimal-delta property holds
  on big docs, no hotspot to optimize. (4) **y-indexeddb DEFERRED** — would
  compete with the authoritative persistent-projects autosave snapshot (task
  1310): two IndexedDB representations of the same state that can diverge + a
  trust-model wrinkle (persisted untrusted CRDT survives reload). Autosave stays
  the single source of truth; rejoin re-syncs from peers. (5) **Signaling-down
  fallback** — `provider.connected`/`status` event → `session.signalingConnected`
  + `reconnect.onSignalingChange`; Share dialog shows a red "unreachable" banner +
  an editable multi-URL signaling field (`SignalingSettings`, persisted in
  localStorage, takes effect next start/join). (6) **E2E-encryption verification**
  (`collab/encryption.test.ts`) — uses the REAL `y-webrtc/src/crypto.js`
  deriveKey/encrypt/decrypt (imported by resolved file URL because y-webrtc's
  `exports` map doesn't expose the `src/` subpath — `createRequire.resolve` +
  `pathToFileURL`) on a real doc update AND a real awareness update: correct key
  round-trips, WRONG password / wrong room-salt CANNOT decrypt (AES-GCM auth-tag
  fail), plaintext never in ciphertext. Node 22 has WebCrypto global. Multi-peer
  + reconnection gate: `collab/multipeer.test.ts` (a full-mesh loopback bus over
  6 peers; drop/reconnect with state-vector catch-up both ways; churn).
- **The address bar reflects the live session — URL fragment write on Start/Join,
  clear on Leave (task 1354, Figma/Docs model).** Originally "Start collaborating"
  minted the share link but surfaced it ONLY in the Share dialog's read-only input
  + Copy button; `window.location` was never touched (no `history.*`/`location.*`
  write anywhere in the collab path). Fix: `collab/collabUrl.ts` — a tiny PURE
  module (injectable `Window` for tests) with `writeCollabFragment(link)` (set the
  `#room=…&k=…` fragment via **`history.replaceState`**, preserving origin+path+
  query) and `clearCollabFragment()` (strip it, but ONLY if the current hash parses
  as a collab link, so an unrelated router hash is left alone). Wired in
  `CollabContext.tsx` start/join/leave + the unmount teardown — the single session
  touch point — keeping `collabSession.ts`/`collabLink.ts` DOM-free. **replaceState
  not pushState** is load-bearing twice: the session is page state not a navigation
  (no back/forward entry), AND pushing would leak the secret-bearing fragment into
  more history entries. Auto-join-on-load stays deliberately OFF (`parseCollabLink`
  is invoked only from the dialog's explicit Join; nothing reads `location.hash` at
  mount), so writing our own fragment never double-handles / silently re-joins.
  Gotcha: **jsdom's `history.replaceState` throws `SecurityError` on a cross-origin
  URL** — an integration test must reset the URL with a same-origin path (e.g.
  `replaceState(null,"","/editor?proj=42")`), not a fabricated `https://app.test/…`.
  Gate: `collab/__tests__/collabUrl.test.ts` (5 pure-helper cases incl. single-`#`
  replace + non-collab-hash left untouched, plus 1 jsdom integration through the
  real `CollabProvider`+`CollabControls`: Start sets `location.hash`, Leave clears).

- **A navigated `#room=…&k=…` collab link is CONSENT-gated, never a silent auto-join
  (task 1357 — joiner complement to 1354).** 1354 wrote the session fragment to the
  address bar but deliberately read NOTHING at mount, so a freshly-navigated share link
  was inert (user opened it, nothing happened). 1357 makes the joiner half act on the
  link — but joining connects you to untrusted peers, exposes your IP/presence, and
  merges a remote doc over your local one, so it raises an explicit CONSENT modal and
  only constructs the y-webrtc provider AFTER the user confirms. Pure decision layer:
  `collab/collabAutoJoin.ts detectIncomingCollabLink({win?, sessionLive, collabEnabled?})`
  parses `location.href` and returns the link IFF it's a genuine invitation — `null` when
  a session is already LIVE (the fragment is OURS: 1354 writes it via `replaceState` AFTER
  `session` is set, so guarding on `sessionLive` breaks the self-join loop), when collab is
  flag-disabled, or when the hash isn't a collab link. `CollabControls` runs the detection
  ONCE at mount (a `useRef` guards re-runs) and renders `CollabJoinPrompt` (reuses the
  Share dialog's `HonestNote`, now extracted to `collab/HonestNote.tsx` and shared by both).
  Confirm → `CollabContext.join(link)` (constructs the provider, adopts on sync, re-writes
  the canonical fragment). Decline → no provider is EVER constructed (so `joinCollab`/
  `replaceDoc` never run, local doc untouched) + `clearCollabFragment()` so a reload won't
  re-prompt. A navigated link is itself an explicit opt-in, so `CollabControls` passes
  `collabEnabled: true` even though `COLLAB_ENABLED_DEFAULT` is false (that flag gates the
  binding default, not this UI). Gate: `collab/__tests__/collabAutoJoin.test.ts` (4 pure
  detection cases + 3 jsdom integration through CollabProvider+CollabControls: incoming link
  prompts but does NOT construct a provider; Confirm → exactly 1 provider + status pill +
  room link stays in the bar; Decline → 0 providers, fragment cleared, SAME doc reference).
  Test gotcha: `joinCollab` awaits a provider "synced" event (or an 8 s timeout), so the
  mock provider must emit `synced` on a microtask for a join to resolve promptly in tests.

### AS2 external classes / Class VFS (task 1300 P2)

- **The ClassVfs INTERFACE + path helpers + hydrate/sync bridge are PURE and live in
  `@flash/core/vfs`; the platform backends live in `@flash/authoring-ui/vfs`.** `@flash/core`
  must import cleanly in Node/browser/Tauri-webview, so nothing in it may touch `navigator`,
  the OPFS handle API, or `@tauri-apps/plugin-fs`. Core ships `ClassVfs`
  (list/read/write/remove/exists over classpath-relative paths like `com/example/Foo.as`),
  `normalizeClassPath` (the one gate — throws `InvalidClassPathError` on `..`/empty/NUL,
  defending OPFS+Tauri roots from traversal), `MemoryClassVfs` (reference + headless
  fallback), and `hydrateVfsFromDoc`/`syncDocFromVfs`. authoring-ui adds `WebClassVfs`
  (OPFS), `IndexedDbClassVfs` (fallback), `TauriClassVfs` (disk mirror) + `createClassVfs`.
- **`.fla` embed (`doc.asClasses`) stays authoritative; the VFS is only the editing
  surface.** Open: `hydrateVfsFromDoc` copies embed -> VFS. Save: `syncDocFromVfs` reads VFS
  -> doc via the P0 `addAsClass` mutation. `syncDocFromVfs` returns the SAME doc reference
  when nothing changed (no history churn), drops classes deleted via the VFS, and ignores
  non-`.as` files. `hydrateVfsFromDoc` does NOT prune extra VFS files by default (so a newer
  external desktop edit survives a re-open) — pass `{prune:true}` for an exact mirror.
- **OPFS maps a classpath 1:1 onto nested dirs** (getDirectoryHandle per package segment,
  getFileHandle leaf, createWritable); `IndexedDbClassVfs` has NO dir tree — it keys ONE
  object store by the slashed classpath string (the path IS the key). Factory order:
  Tauri+known-path -> OPFS -> IndexedDB -> Memory; a pathless desktop doc falls through to
  the web backend until saved.
- **Desktop disk mirror**: on Tauri, classes are REAL files under `<flaDir>/classes/`
  (`deriveClassesRoot`), editable in external editors / git, reconciled on save. `isTauri()`
  is duplicated from `hooks/useFileActions.ts` (`"__TAURI_INTERNALS__" in window`).
- **Test env is node, not jsdom**: OPFS handles `entries()`/`keys()` are NOT in TS's DOM lib
  (structural-cast them); `navigator` is a getter-only global in Node so tests must override
  it via `Object.defineProperty(globalThis,"navigator",{value,writable:true,configurable:true})`,
  not assignment. The IndexedDB fallback is tested with `fake-indexeddb` (devDep) via the
  backend's injectable `indexedDB` option; the OPFS backend with an in-memory fake handle
  tree; the Tauri backend with a `vi.mock("@tauri-apps/plugin-fs")` in-memory FS. Design:
  `docs/33-as2-classes-vfs.md`.
- **`doc.asClasses` must be CURRENT before any compile/save, and stored paths must be
  CANONICAL (task 1317).** Two distinct data-loss bugs at the ClassesPanel VFS<->doc seam:
  (1) the panel wrote edits to the VFS immediately but only reconciled into `doc.asClasses`
  on a 600 ms debounce, while EVERYTHING that compiles/persists reads `doc.asClasses`
  directly — Test Movie (`useExportHandlers`), Publish (`usePublish.compileDocToBytes`), Live
  Preview recompile (`useLivePreview`), autosave (`autosaveController`), Save (`saveFla`).
  `syncDocFromVfs` had EXACTLY ONE caller (the debounced `syncToDoc`); nothing flushed it
  before a compile. So a Test Movie / Publish / autosave / tab-close within 600 ms of a
  keystroke used STALE class source. Fix: `ClassesPanel.handleScriptChange` folds each edit
  into `doc.asClasses` SYNCHRONOUSLY (`addAsClass` + `pushDoc`, with a byte-identical
  short-circuit so no-op keystrokes don't churn history); the 600 ms timer is now ONLY a
  deferred full `syncDocFromVfs` (history coalescing + out-of-band/disk-edit reconcile) and
  is FLUSHED on unmount. A dedicated effect re-hydrates the VFS when `doc.asClasses`
  *identity* changes from outside after mount (project restore / undo / MCP swap), guarded by
  `lastSyncedAsClassesRef` (ignore the panel's own synchronous push), `pendingEditRef` (don't
  clobber typing), and a `vfsOpInFlightRef` counter (don't `prune`-mirror over an in-flight
  create/remove/rename). (2) **Path-normalization mismatch (Bug A):** `syncDocFromVfs` and
  `addAsClass`/`updateAsClass`/`removeAsClass` matched RAW `c.path === path` against a
  NORMALIZED VFS path, while the VFS stores/mirrors under `normalizeClassPath`. A non-
  normalized stored path (zip-entry key with `./`/backslash/doubled-slash, real-FLA import)
  failed the match, so an edit APPENDED a duplicate (stale + edited) and the removal pass kept
  the stale one — the compiler then emitted the class's `DoInitAction` TWICE and the `.fla`
  embed persisted the stale dup forever. Fix: those four functions now match on the CANONICAL
  (normalized) path, and `addAsClass` + `loadFla` STORE the canonical form (a `canonicalClassPath`
  helper falls back to raw if `normalizeClassPath` throws, so a `..` path never crashes a
  mutation). Gates: `classesPanel.test.ts` (a/b/c/d regressions) +
  `sync-normalize-proof.test.ts` (1-entry post-fix).

### SWF clip actions

- **loopMode / firstFrame synthesis is GRAPHIC-ONLY** (`compile.ts` + `sprite.ts`,
  task 1124): Loop / Play Once / Single Frame are properties of GRAPHIC symbol instances;
  movieclips and buttons play their own timeline independently and have no such property.
  The compiler synthesizes loop-control clip actions for these modes (single-frame →
  `onClipEvent(load){ gotoAndStop(N) }`, play-once → enterFrame stop, firstFrame>0 → load
  seek). This synthesis MUST be gated on the referenced symbol's `symbolType === "graphic"`.
  Binary FLAs carry a loop-mode byte on EVERY instance, so movieclip placements routinely
  import with `loopMode="single-frame"`; without the gate, every nested movieclip got a
  synthesized `gotoAndStop(1)` and froze on frame 0 (Magnet.fla's Preloader never advanced,
  so its bytes-loaded check + `_root.play()` never ran and the movie hung on the loading
  screen — 1432/1434 MC instances were affected). The gate lives in 3 spots per file:
  `computeClipActionsKey`/`thisClipActionsKey` (change detection) and the place + move
  emit paths. Explicit `clipActions` (real `onClipEvent` handlers) are still honoured on
  movieclips. Acceptance: `loopmode.test.ts` "movieclip instances ignore loopMode".
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
- **The interactivity oracle's local `injectRufflePlayer` needed BOTH autoplay AND
  overlay-hiding (task 1215).** `interactivity.spec.ts` had its OWN copy of
  `injectRufflePlayer` (separate from the autoplay-correct button-roundtrip/keyboard
  helpers) that loaded with neither `autoplay:'on'`/`unmuteOverlay:'hidden'` NOR a
  `hideRuffleOverlays` call — so the 3 frame-advance click tests (button release/press,
  dot-catcher capstone) saw `diffPixels=0` (Expected >100). Two coupled root causes, both
  harness-only: (1) without `autoplay:'on'` the suspended-AudioContext play-button overlay
  keeps the timeline from ever calling `play()` (the standard autoplay-gating bullet
  above); (2) even with autoplay forcing playback, the play-button / hardware-accel panic
  overlay elements in the player's shadow DOM still **intercept the synthesized `.click()`**
  so it never reaches the SWF button's hit area — the on(release)/press BUTTONCONDACTION
  never fires. Fix mirrors the passing helpers: add the two load opts AND a
  `hideRuffleOverlays()` (recursive shadow-DOM `display:none !important` on any
  id/class matching `modal|overlay|message|splash|play-button|panic`) after load and after
  the click, before each screenshot. Proven: button-roundtrip's identical on(release)
  fixture already PASSED (pixelDiff 10000) because it called `hideRuffleOverlays`. NOT a
  product defect — same SWF, same Ruffle. Acceptance: all 6
  `apps/desktop/e2e/interactivity.spec.ts` tests pass.
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
