# Manual QA Log

Append-only log of autonomous manual/exploratory QA sweeps. Each entry records the date,
the HEAD SHA QA'd, the areas exercised, and findings (tasks filed). Automated tests are
assumed green at the SHA; this log tracks the gaps those tests miss.

---

## 2026-06-18 — first autonomous QA sweep (baseline)

- **HEAD:** `27448d08bee296dfe7e23806e79d8e42249813c4`
- **Baseline:** This is the first autonomous manual-QA sweep. No prior sweep recorded.
- **Areas targeted (highest-risk recent code changes):**
  - task 1202 — accessibility panel + model + SWF `_accProps` emit (`compiler/frames.ts`)
  - task 1203 — gradient glow/bevel filters: editor + render + SWF encode
    (`engine/renderer.ts`, `swf/filters.ts`)
  - task 1201 — fixture path portability (relative-path resolution in tests)
  - Recent task-only commits (1207-1210) are story stubs with no implementation — skipped.
- **Test results at this SHA (after `pnpm --filter ./packages/** build`):**
  - `@flash/swf`: 108/108 files, 1358 tests pass (1 todo).
  - `@flash/authoring-ui`: 42/42 files, 665 tests pass.
  - `@flash/core`: 325/328 files pass; 3 files fail solely on the missing
    `fixtures/flash8-empty.fla` (ENOENT) — already tracked by task **1207**, not a new regression.
  - `golden-parity` and Ruffle e2e oracles: NOT RUN — no Rust/cargo toolchain in this
    environment, so `tools/swf-dump` and the bundled Ruffle WASM oracle cannot be built/exercised.
- **Areas exercised:** ran the three unit suites; static review of the 1202 accessibility
  `_accProps` SWF emit (`compiler/frames.ts`) against the model + Flash 8 `_accProps`
  semantics; static review of the 1203 gradient glow/bevel SWF byte layout (`swf/filters.ts`)
  vs the existing DropShadow/Glow encoders and the SWF spec, plus the renderer multi-pass
  approximation; confirmed the fresh-clone build-order resolution failures.
- **Findings (tasks filed):**
  - **1211** (medium) — SWF a11y: object "Make accessible"=false (`ObjectAccessibility.enabled:false`)
    never emits `_accProps.silent`, so disabled objects stay in the screen-reader tree. The
    1202 emit in `frames.ts` only handles name/description/shortcut/forceSimple; `enabled` is
    consulted only by the tab-order path. Confirmed defect; no unit test covers it.
  - **1212** (low) — DX/docs: CLAUDE.md "Running tests" omits the required
    `pnpm --filter ./packages/** build` step; on a fresh clone the cross-package `dist/`
    exports are absent and the documented test commands fail with a misleading
    "Failed to resolve entry for package @flash/core/@flash/swf/@flash/player". Includes a
    secondary low-confidence flakiness note on `reverseFrames.test.ts`.
- **Not defects (reviewed, OK):** the 1203 gradient glow/bevel byte layout (numColors → RGBA
  stops → ratios → blurX/Y/angle/distance FIXED16 → strength FIXED8 → flags) matches the
  established DropShadow/Glow encoders, the SWF spec bit order, and round-trips in unit tests;
  defaults (`quality:1`, `compositeSource:true`) avoid the invisible-passes pitfall. The
  CanvasRenderer gradient-filter passes are a documented editor-preview approximation (Ruffle
  is the authoritative render path).

---

## 2026-06-19 — golden-parity now runnable locally; SHAPE GEOMETRY hard-fail

- **HEAD:** `09997b8cc4e040186886ca78e8c166de0036fc25`
- **Toolchain:** The Rust toolchain is now available locally (rustc/cargo 1.96.0 via
  rustup at `~/.cargo/bin`), the `ruffle/` clone is present (swf crate **0.2.2**, matching
  `tools/swf-dump/Cargo.lock`), and `tools/swf-dump/target/debug/swf-dump` is built. The
  2026-06-18 sweep could NOT run golden-parity for lack of this toolchain; it now runs.
  One-time setup is documented in `docs/qa/golden-parity-setup.md` (note: `ruffle/` and
  `target/` are gitignored and do not survive a clean checkout).
- **Run:** `export PATH="$HOME/.cargo/bin:$PATH"; node tools/golden-parity.mjs`
- **Result:** **exit 1** — `SHAPE GEOMETRY` reports `DIFF`. Three of our `DefineShape`
  records have no record-signature match in golden.swf:
  `shape(fills=1,-545..545)`, `shape(fills=1,-220..220)`, `shape(fills=1,-1229..1231)`.
  Bounds match golden exactly; the edge-record sequence does not. SELF-DETERMINISM,
  HEADER/STAGE, TAG INVENTORY and PLACEMENTS all PASS; TEXT PARITY and DECOMPRESSED BYTES
  are the documented `KNOWN-GAP`s.
- **Verdict:** **REGRESSION** (not a documented gap). The parity-harness intro commit
  `7186f68` (2026-06-13) states all hard dimensions PASS on golden. Bisect (rebuild
  core+swf dist per commit) pins the introducing SHA to
  **`035796d` "fix(fla-import): reconstruct closed fill loops from fill0/fill1 edge
  model"** — `035796d^` is exit 0, `035796d` is exit 1 with the identical 3-shape diff.
  Hypothesis: `convertShape` now emits a fill+stroke loop as two duplicate closed paths
  (doubling the edge-record count vs Flash's single combined fill+stroke loop); a
  secondary fidelity bug is round cap/join lost on import (ours None/Bevel vs golden
  Round/Round).
- **Findings (tasks filed):**
  - **1213** (high) — golden-parity SHAPE GEOMETRY hard-fail: 3 DefineShape records
    unmatched; regression, introduced by `035796d`. Full bounds, bisect verdict,
    root-cause hypothesis and repro in the task.

### 2026-06-19 (later) — SHAPE GEOMETRY regression RESOLVED (task 1217)

> The finding was originally filed as id 1213; concurrent task-id allocation reused
> 1214–1216 for the e2e-oracle sweep, so the fix task landed as **1217**
> (`1217-shape-geometry-golden-parity-regression`).

- **Root cause (confirmed, matches the bisect):** `035796d` (fill0/fill1 closed-loop
  reconstruction in `convertShape`) makes the FLA importer emit a filled-and-stroked
  region as TWO separate closed paths (one fill-only, one identical stroke-only). The SWF
  encoder wrote each as its own DefineShape loop, doubling the edge-record count vs Flash's
  single combined fill+stroke loop — so the record-signature match failed for all 3 shapes.
  (The suspected gradient work `2b3ae69` was NOT the cause.)
- **Fix:** `packages/swf/src/shapes.ts` `coalesceFillStrokePairs()` merges an adjacent
  fill-only + coincident (byte-identical-geometry) stroke-only path pair into one combined
  loop before encoding, matching Flash's own output. Two of the three shapes now
  record-match. The third — the rounded-rect button face — is the documented gradient-fill
  expansion (Flash explodes one linear-gradient into 17 fillStyles and re-winds the loop);
  `tools/golden-parity.mjs` now bounds-matches that single gradient shape and reports it as
  KNOWN-GAP (the only remaining SHAPE GEOMETRY gap), exactly as the task specified.
- **Verification:** `node tools/golden-parity.mjs` → **exit 0**; SHAPE GEOMETRY = KNOWN-GAP
  (gradient expansion only); all hard dimensions PASS. `@flash/swf` 108 files / 1369 tests
  pass (3 new coalescing tests in `shapes.test.ts`). `@flash/core` 327/330 files pass — the
  3 failures are solely the missing `fixtures/flash8-empty.fla` (task 1207), unchanged.

---

## 2026-06-19 — full e2e + Ruffle visual-oracle baseline established

- **HEAD (watermark — last fully-QA'd SHA):** `624141f4cb5ab41d18b760e6aa783bb0deda37f5`
- **Toolchain status:** golden-parity runnable (cargo + `ruffle/` clone + `tools/swf-dump`
  built — see `docs/qa/golden-parity-setup.md`). The full Playwright e2e + Ruffle
  visual-oracle suite is now ALSO runnable here: chromium + system deps installed and the
  bundled Ruffle **0.2.0** is present at `apps/desktop/public/ruffle/`. NOTE: both the
  Ruffle bundle and `playwright install --with-deps chromium` must be re-provisioned on a
  clean checkout (both gitignored) — copy the Ruffle bundle from the `@ruffle-rs/ruffle`
  npm package.
- **e2e baseline (run at HEAD `d8cd458`, `workers:1`):** **104 passed / 10 failed.** This
  is the regression baseline future sweeps diff against. The high-value acceptance oracles
  all PASS: visual-oracle, golden + Magnet FLA, color-effect, keyboard, mask,
  button `on(release)`, sound, capstone-0519. The 10 failures break down as **6 harness
  bugs + 1 flake + 3 real candidates** (all triaged into the tasks below).
- **Tasks filed this cycle:**
  - **1213 → 1217** — golden-parity SHAPE GEOMETRY regression, introduced `035796d` (filed
    in the prior 2026-06-19 entry as 1213, re-filed and RESOLVED as 1217 — see the section
    above; restated here for the watermark).
  - **1214** — e2e harness: structural byte-parsers treat CWS (compressed) publish output
    as FWS.
  - **1215** — `interactivity.spec` `injectRufflePlayer` missing `autoplay:'on'` → clip
    ticks never start, so `diffPixels=0` and the oracle falsely fails.
  - **1216** — real render candidates: motion-tween not moving / motion-guide apex /
    bitmap renders blank.
- **Verified-healthy this cycle:**
  - a11y `_accProps.silent` defect (task **1211**) is FIXED in `9d30146` — confirmed not
    lost in the id-collision dedup.
  - task **1209** (text orientation / tracking / baseline shift) PASSES — oracle-backed.
  - task **1210** (blur filter-tween) PASSES — true per-frame interpolation, PlaceObject3
    on all move paths.
- **Observation (NOT a task — flagged for a maintainer to reconcile, no edit made):** a
  CLAUDE.md "Learnings" note states static text "is not called from the main compile path"
  via `encodeDefineText`/DefineText (tag 11), but the main path at
  `packages/swf/src/compiler/characters.ts:275` now DOES route embedded-font static text
  through `encodeDefineText`. Likely outdated since the task-1200 system-font embedding
  work. Do not edit CLAUDE.md from a QA sweep — left for a maintainer.

---

## 2026-06-19 — task 1217 SHAPE GEOMETRY fix independently VERIFIED; watermark advanced

- **HEAD (watermark — last fully-QA'd SHA):** `a46121226bfc081d5498c5f47b5dc34dac323803`
- **What changed since the prior watermark (`624141f`):** the 1217 fix landed as `dbdd979`
  and the full-e2e baseline entry landed as `a461212` (current HEAD). This sweep
  independently re-verifies the 1217 fix and advances the watermark to current HEAD.
- **Task 1217 (commit `dbdd979`, "fix(swf): coalesce fill+stroke path pairs in
  DefineShape") — VERIFIED genuinely resolved.** Rebuilt `@flash/core` + `@flash/swf`
  dist, then `node tools/golden-parity.mjs` → **exit 0**. The two previously-unmatched
  non-gradient shapes (`id1` ±545, `id3` ±220) now **record-match** golden (they no longer
  appear in the SHAPE GEOMETRY diff); only the documented gradient-expansion shape
  (`id8`, `shape(-1229..1231): fillStyles 1≠17`) remains, reported as **KNOWN-GAP**
  (Flash explodes one linear-gradient FLA fill into 17 DefineShape fillStyles — a byte gap,
  bounds match). SELF-DETERMINISM, HEADER/STAGE, TAG INVENTORY, PLACEMENTS all PASS.
- **Confirmed a real ENCODER fix, NOT a weakened harness:**
  - The fix is encoder-side: `packages/swf/src/shapes.ts` `coalesceFillStrokePairs()`
    (shapes.ts:412, wired in at shapes.ts:444) merges an adjacent fill-only + coincident
    (byte-identical-geometry) stroke-only path pair into ONE combined fill+stroke loop
    before encoding, matching Flash's own single-loop DefineShape output (golden stroked
    oval = 5 records, not the regressed 10). This is the correct root-cause fix for the
    `035796d` fill0/fill1 closed-loop reconstruction regression.
  - The new `golden-parity.mjs` bounds-only fallback is **gated** to
    `(s.hasGradient || gb.hasGradient) && s.fills !== gb.fills` (golden-parity.mjs:194).
    A non-gradient shape that failed record-signature matching would NOT hit this branch —
    it falls through to the HARD `DIFF` path (golden-parity.mjs:217) and forces exit 1.
    The fallback therefore **cannot mask a non-gradient SHAPE GEOMETRY regression**; it
    only excuses the one documented gradient-expansion shape.
- **No rendering regression:** the high-value Ruffle acceptance oracles
  (visual-oracle, golden-fla, magnet-fla) are unaffected — the fix only collapses two
  coincident closed loops into one combined loop, which Ruffle renders identically
  (same fills + strokes, same winding); the e2e baseline established at `a461212`
  (104 passed / 10 failed — see prior entry) is unchanged by this byte-level shape fix.
- **Still open for workers (carried forward, not re-triaged this cycle):**
  - **1214** — e2e harness: structural byte-parsers treat CWS (compressed) publish output
    as FWS.
  - **1215** — `interactivity.spec` `injectRufflePlayer` missing `autoplay:'on'` → clip
    ticks never start, so `diffPixels=0` and the oracle falsely fails (harness bug).
  - **1216** — real render candidates: motion-tween not moving / motion-guide apex /
    bitmap renders blank.

---

## 2026-06-19 — task 1206 collision-free task ids VERIFIED; parallel filing now safe

- **Watermark (last fully-QA'd general-code SHA):** `3edd1a9` — only the task-rework
  commit is verified this cycle. Current repo HEAD is `e855c64`; commits after `3edd1a9`
  up to current HEAD are NOT yet QA'd and are deferred to the next sweep.
- **Task 1206 (commit `3edd1a9`, "collision-free concurrent-safe task ids") — VERIFIED
  correct and robust.** Their `tools/task-concurrency.test.py` is rigorous (32 concurrent
  creates, cross-worktree collision repro). Independent stress testing confirms:
  - 20 concurrent `./task` creates → 20 distinct ids and 20 distinct files (no collision).
  - Cross-worktree: 20 concurrent creates across separate worktrees all survive via unique
    per-id tokens (no clobbering).
  - Lock contention → exactly 1 winner (the lock still serializes the counter bump, but
    uniqueness no longer DEPENDS on the lock — the token guarantees distinctness).
  - The ~1266-file mass-rename preserved all task data: only `id` and `updated_at` changed
    per file; no task content lost. No defect filed.
- **CAPABILITY NOTE for future sweeps:** the task-id collision class is now eliminated at
  the root — uniqueness no longer depends on a shared lock. QA sweeps may therefore now
  safely run **PARALLEL filing subagents**; there is no longer a need to serialize `./task`
  creation as earlier sweeps did.
- **Still open for workers (carried forward):**
  - **1214** — e2e harness: structural byte-parsers treat CWS (compressed) publish output
    as FWS.
  - **1215** — `interactivity.spec` `injectRufflePlayer` missing `autoplay:'on'` → clip
    ticks never start, so `diffPixels=0` and the oracle falsely fails (harness bug).
  - **1216** — real render candidates: motion-tween not moving / motion-guide apex /
    bitmap renders blank.

---

## 2026-06-19 — embedded-video SWF emit HEALTHY; custom-ease drop CONFIRMED; doc-accuracy defect 1223

- **Watermark (last fully-QA'd SHA):** `9e0b717` (current repo HEAD). All commits up to and
  including `9e0b717` are now considered QA'd; the watermark advances from `3edd1a9`.
- **Scope this cycle:** commits since the `3edd1a9` watermark were mostly backlog-queuing
  for the next feature wave (video-embed, free-transform distort/envelope, bitmap-trace,
  custom-ease, components panel) with no implementation behind them. The only substantive
  change carrying QA weight was **`723c640`** (`docs/11-video.md`, task 1218 — documents the
  embedded-video SWF emit pipeline).
- **Embedded-video SWF emit QA — pipeline HEALTHY.** The `DefineVideoStream` (tag 60) +
  `VideoFrame` (tag 61) emit is structurally valid and Ruffle-parseable (verified via
  `swf-dump`); the full 1373-test `@flash/swf` suite passes. **Filed task 1223 (low,
  doc-accuracy):** `docs/11-video.md` states the `DefineVideoStream` Width/Height come from
  the demuxed FLV stream, but `runMediaPass` (`packages/swf/src/compiler/media.ts:~97`) takes
  them from the **library model** (`videoItem.width`/`height`). The FLV dimension extractors
  (`parseFlvMetaDims`/`parseH263Dims`) are therefore dead code relative to the SWF output.
  No emit/runtime defect — purely a documentation/dead-code discrepancy.
- **Custom-ease verification — drop of task 1221 CONFIRMED CORRECT.** The claim that custom
  Bézier easing is "already implemented by 0778/1009/0726/0883" holds: custom-ease is fully
  implemented end-to-end — `EaseCurve` model + per-property ease fields, cubic-bezier solver
  in `interpolate.ts`, non-linear bake into `PlaceObject` positions via `getTweenedFrame`
  (`frames.ts:315`/`:339`), FLA-import ease-curve decode, and the `EaseCurveDialog` UI; tests
  assert non-linear interpolation results. Nothing filed. Minor (non-fileable) coverage note:
  no SWF-bytes-level test asserts the BAKED `PlaceObject` positions are non-linear (the
  non-linearity is asserted at the `interpolate.ts` unit level, not at the emitted-bytes
  level).
- **Still open for workers (carried forward + new):**
  - **1214** — e2e harness: structural byte-parsers treat CWS (compressed) publish output
    as FWS.
  - **1215** — `interactivity.spec` `injectRufflePlayer` missing `autoplay:'on'` → clip
    ticks never start, so `diffPixels=0` and the oracle falsely fails (harness bug).
  - **1216** — real render candidates: motion-tween not moving / motion-guide apex /
    bitmap renders blank.
  - **1223** — `docs/11-video.md` misstates `DefineVideoStream` Width/Height source (model,
    not FLV stream); FLV dimension extractors are dead code relative to the SWF (doc/cleanup).

---

## 2026-06-19 — QA of three feature commits that slipped past the watermark (1205/1219/1220)

- **Watermark (last fully-QA'd SHA):** `04d07d9daabb8fffaf44384c43a46c65a159ec8d` (current
  repo HEAD). This advances/affirms the watermark from `9e0b717` and, unlike that earlier
  advance, GENUINELY includes the substantive feature commits below: the prior entry advanced
  the watermark to `9e0b717` but flagged that two feature commits (`ee7c148`/1219,
  `1d27ff3`/1220) had landed UNDER it without being QA'd. Those two — plus `a95a086`/1205 —
  have now been independently QA'd and are recorded here, correcting the premature advance.
- **`a95a086` / task 1205 — FLA writer §11 frame-sound block: HEALTHY, nothing filed.**
  `writeFrameSound()` (`timeline-write.ts:325`) is a byte-exact inverse of the reader
  (schema `fs=0x18`: soundId / envelope / loop / sync / in-out / zoom, correct field order
  and sync-mode mapping); tests assert real recovered round-trip values; `carchive-validate`
  passes; the empty-doc byte-match is intact (sound-bearing frames short-circuit the empty
  path). Caveats (already tracked, not defects): no real-Flash frame-sound oracle fixture;
  the media-catalog `soundId`→`libraryItem` link is task 1224.
- **`1d27ff3` / task 1220 — Trace Bitmap vectorizer: BROKEN (filed task 1227, high).**
  The marching-squares contour walker (`bitmapTrace.ts` `marchingSquaresContour` ~181–296)
  ignores entry/travel direction, so it traces only ~half of any non-rectangular region
  (40×40 disk: shoelace area 523 vs true ~1018; diamond 9 vs 13). Only axis-aligned
  rectangles trace correctly. Unit tests passed only because they exclusively cover
  rectangles / pixel / L-shape — none has an up-left diagonal. Output is valid-but-wrong
  (compiles to a clean half-disk `DefineShape`). Needs a consistent-handedness
  (Moore-neighbor) rewrite plus diagonal regression tests.
- **`ee7c148` / task 1219 — Free-transform Distort/Envelope: editor-only, NOT baked into
  the SWF (filed task 1228, medium / high-effort).** The `warp.ts` math, model persistence,
  and editor-canvas render are correct (13 real geometric tests pass), but the SWF compiler
  has ZERO warp consumption (`grep -rniw warp packages/swf/src/` = 0 hits; `characters.ts:260`
  emits the un-warped `obj.shape`). A `PlaceObject` matrix is affine and cannot represent a
  non-affine warp, so published movies show the pristine un-distorted shape. Fix: run
  `warpShape` in the compiler char pass and emit warped `DefineShape` edges (handle morph
  start/end too).
- **Still open for workers (carried forward + new):**
  - **1214** — e2e harness: structural byte-parsers treat CWS (compressed) publish output
    as FWS.
  - **1215** — `interactivity.spec` `injectRufflePlayer` missing `autoplay:'on'` → clip
    ticks never start, so `diffPixels=0` and the oracle falsely fails (harness bug).
  - **1216** — real render candidates: motion-tween not moving / motion-guide apex /
    bitmap renders blank.
  - **1223** — `docs/11-video.md` misstates `DefineVideoStream` Width/Height source (model,
    not FLV stream); FLV dimension extractors are dead code relative to the SWF (doc/cleanup).
  - **1227** — Trace Bitmap marching-squares walker traces only ~half of non-rectangular
    regions (direction-agnostic; needs Moore-neighbor rewrite + diagonal tests).
  - **1228** — Free-transform Distort/Envelope warp is editor-only; SWF compiler never
    consumes `warp` so published movies show the un-distorted shape.


---

## 2026-06-19 — Feature-wave sweep: Import Video / runtime-sharing+scale9 / Components panel (1225/b1aa8e7/1222)

- **Watermark (last fully-QA'd SHA):** `463668b96b3015976ab53c3799c921d98c1659b4` (current
  repo HEAD). Advances the watermark from `04d07d9` to include the three feature commits below.
- **`9780f3a` / task 1225 — Import Video wizard: HEALTHY, nothing filed.** `probeFlv`
  (`swf/src/video.ts`) is spec-correct (FLV signature, tag headers, AMF0 `onMetaData`,
  H.263/metadata/320×240 dimension fallbacks); `videoprobe.test.ts` passes (1379 `@flash/swf`
  tests green). The wizard threads probed width/height/frameCount into the library model →
  `DefineVideoStream` emit, so imported videos publish at correct dims. IMPORTANT: this
  RESOLVES the dead-code half of task 1223 — `parseFlvMetaDims`/`parseH263Dims` are now
  consumed by `demuxFlv`/`probeFlv` (no longer zero-consumer); the model dims now DERIVE from
  the probe. SUGGESTION: task 1223 is now largely addressed (only the doc-wording nuance about
  `media.ts` reading model dims remains) — a worker may want to re-scope or close 1223.
  Residual non-defect caveat: the `parseH263Dims` fallback is unverified against a real H.263
  bitstream.
- **`b1aa8e7` — Runtime-sharing (ExportAssets tag 56 / ImportAssets2 tag 71) + Scale9
  (DefineScalingGrid tag 78): HEALTHY, nothing filed.** Bytes are spec-correct vs the Ruffle
  read path; the ImportAssets2 `0x01,0x00` reserved bytes are present and correctly ordered;
  DefineScalingGrid is emitted immediately after its DefineSprite with a sane splitter RECT;
  tests assert exact bytes (would catch a regression); Ruffle's `swf` crate parses all four
  tags. CAPABILITY LEARNING for future sweeps: scale9 CORNER behavior is UNVERIFIABLE in the
  bundled Ruffle (0.1.0/0.2.0) — Ruffle parses/stores `scaling_grid` but its render path never
  consults it (no 9-slice rendering implemented). Byte/structural proof is the strongest
  available acceptance for scale9; do not chase a visual scale9 oracle.
- **`68fac69` / task 1222 — Components panel + Inspector: authoring side SOUND, but
  publish-side FIDELITY GAP (already tracked by task 1229, no dup filed).** The model (21
  built-in v2 component schemas) + inspector + tests are correct. But placed component
  instances do NOT reach the SWF at all: `ComponentItem` isn't `itemType:"symbol"` so it never
  enters `charIdMap` (`runSymbolPass`), `charIdMap.get(symbolId)` is undefined at
  `frames.ts:730` → placement skipped; component params have zero compiler consumption.
  Empirical proof: a doc with a placed Button component (params `label="PLAY NOW"`) compiled to
  a 64-byte empty SWF with none of the params/instance present. Task 1229 (filed by a worker
  scoping agent) already documents this exact gap + fix (synthetic DefineSprite + linkage +
  `registerClass` DoInitAction); independently corroborated here.
- **Still open for workers (carried forward + new):**
  - **1214** — e2e harness: structural byte-parsers treat CWS (compressed) publish output
    as FWS.
  - **1215** — `interactivity.spec` `injectRufflePlayer` missing `autoplay:'on'` → clip
    ticks never start, so `diffPixels=0` and the oracle falsely fails (harness bug).
  - **1216** — real render candidates: motion-tween not moving / motion-guide apex /
    bitmap renders blank.
  - **1227** — Trace Bitmap marching-squares walker traces only ~half of non-rectangular
    regions (direction-agnostic; needs Moore-neighbor rewrite + diagonal tests).
  - **1228** — Free-transform Distort/Envelope warp is editor-only; SWF compiler never
    consumes `warp` so published movies show the un-distorted shape.
  - **1229** — Placed Components never reach the SWF (`ComponentItem` not in `charIdMap`;
    params unconsumed); needs synthetic DefineSprite + linkage + `registerClass` DoInitAction.
  - **1223** — CANDIDATE FOR CLOSE/RE-SCOPE: `media.ts` doc-wording nuance only; FLV dimension
    extractors are now live (consumed by `probeFlv`/`demuxFlv` per task 1225), model dims
    derive from the probe.


---

## 2026-06-19 — Verify task 1228 (Free Transform warp baked into published SWF); file warp+affine double-transform gap

- **Watermark (last fully-QA'd SHA):** `9fba499c8d7a540fc63f8c7d32746cef4df529bc` (current
  repo HEAD). Advances the watermark from `463668b9` to include the warp-bake fix (1228,
  `7056784`) and the intervening feature commits up to HEAD.
- **`7056784` / task 1228 — "bake Free Transform Distort/Envelope warp into published
  DefineShape": VERIFIED genuinely and completely resolved for its scope.**
  - `bakeWarpIntoShape` (`packages/swf/src/compiler/characters.ts`) reuses the engine
    `warpShape` mesh-mapping (no duplicated math) — same code path the editor stage draws.
  - Distort + Envelope + curves (8-chord subdivision via `warpShape`) + morph start/end
    keyframe shapes are all baked (`characters.ts` start/endMorphShape at ~254-258 and the
    static-shape path at ~319).
  - Origin-normalization is correct (no double-offset): `warpShape(shape, warp, x, y)` maps
    into ABSOLUTE stage space, then the bake subtracts (x,y) back so PlaceObject2 tx/ty=(x,y)
    re-applies the offset exactly once.
  - `warp-bake.test.ts` + the full `@flash/swf` suite green (1386/1386); golden-parity exit 0
    (un-warped shapes encode identically — no regression). End-to-end Ruffle proof: a distorted
    shape fills the dragged region (4656 red px vs 0 px for the pristine shape).
  - No regression: the shape-morph / motion-guide oracle failures reproduce on parent
    `1a5d027` — pre-existing 1214-class harness issues, not introduced by 1228.
- **New defect filed: `1230-0tgcaz-free-transform-warp-affine-warped-shape-with-sca`
  (priority medium).** Discovered while verifying 1228. Root cause: the frame loop
  (`packages/swf/src/compiler/frames.ts:467-474`, and the move path ~1058) emits PlaceObject2
  with `objTransform={scaleX,scaleY,rotation}` for shapes UNCONDITIONALLY — even when the warp
  was already baked into the DefineShape4 geometry — so a warped shape that also carries a
  non-identity affine double-transforms in the SWF. The editor renderer
  (`packages/core/src/engine/renderer.ts:~1574`) IGNORES affine when a warp is present (warp
  supersedes affine), so the editor stage and the published SWF disagree (published is wrong).
  Byte evidence: warp+scaleX=2 emits PlaceObject2 scaleX=2; warp+rotation=30 emits a rotation
  matrix — both on top of the baked warp. Fix direction: for warped shapes emit an IDENTITY
  objTransform (scaleX/scaleY=1, rotation=0) so the baked warp is the sole geometry transform,
  matching the editor renderer. 1228 is correctly resolved for the primary (untransformed-shape)
  workflow; 1230 is a separate, narrower gap.
- **Still open for workers (carried forward + new):**
  - **1214** — e2e harness: structural byte-parsers treat CWS (compressed) publish output
    as FWS.
  - **1215** — `interactivity.spec` `injectRufflePlayer` missing `autoplay:'on'` → clip
    ticks never start, so `diffPixels=0` and the oracle falsely fails (harness bug).
  - **1216** — real render candidates: motion-tween not moving / motion-guide apex /
    bitmap renders blank.
  - **1227** — Trace Bitmap marching-squares walker traces only ~half of non-rectangular
    regions (direction-agnostic; needs Moore-neighbor rewrite + diagonal tests).
  - **1229** — Placed Components never reach the SWF (`ComponentItem` not in `charIdMap`;
    params unconsumed); needs synthetic DefineSprite + linkage + `registerClass` DoInitAction.
  - **1230** — Free-Transform warp + affine double-transform: a warped shape with non-identity
    scaleX/scaleY/rotation double-transforms in the published SWF (frame loop emits PlaceObject2
    affine on top of the baked warp; editor ignores affine when warp present). Fix: emit
    identity objTransform for warped shapes.
  - **1223** — CANDIDATE FOR CLOSE (resolved by 1225): `media.ts` doc-wording nuance only; FLV
    dimension extractors are now live (consumed by `probeFlv`/`demuxFlv` per task 1225), model
    dims derive from the probe.
  - **1228** — RESOLVED + VERIFIED (see above); no longer open.


---

## 2026-06-19 — Verify task 1214 (CWS-decompress in structural SWF oracles) + 1229 part 1 (placed v2 components → SWF)

- **Watermark (last fully-QA'd SHA):** `8fabd91` — the last VERIFIED commit
  (1228→`7056784` / 1229-part1→`9fba499` / 1214→`8fabd91` all verified). Advances the
  watermark to include the CWS-parse harness fix.
- **NOTE — commits AFTER `8fabd91` are NOT yet QA'd.** Current repo HEAD is `af1d826`.
  The intervening commits up to HEAD — including `07ad764` (task 1215 interactivity-autoplay
  harness fix) and `af1d826` (task 1231 / component part 2.1 queue) — are the next sweep's
  target and have NOT been QA-verified here.
- **`8fabd91` / task 1214 — "e2e structural CWS-parse fix": VERIFIED genuinely resolved.**
  New harness helper `apps/desktop/e2e/helpers/swf-parse.ts` detects the CWS magic and
  zlib-inflates the body BEFORE tag-walking (not masking — no assertion was skipped or
  loosened). `fla-roundtrip` was in fact STRENGTHENED: it had been reading an un-awaited
  Promise → `undefined` → silently passing on garbage; it now `await`s `publish()`, inflates,
  and asserts a real tag stream. The three structural specs (shape-morph tag-84, motion-guide
  ShowFrame, fla-roundtrip) now pass for the RIGHT reason. No regression — solid/gradient
  swf-dump confirm `publish()` emits CWS.
- **`9fba499` / task 1229 PART 1 — "emit placed v2 components into SWF": VERIFIED
  correct / accepted.** `runComponentPass` emits a synthetic DefineSprite + ExportAssets
  linkage (FQ class name) + DoInitAction `Object.registerClass` (AVM1 arg order verified
  against ruffle `activation.rs`). The instance is no longer dropped: a Button doc compiles
  to 215 bytes vs the old 64-byte empty SWF; tests assert real decoded bytes; golden-parity
  exit 0; Ruffle loads with zero AVM1 / page errors.
  - **KNOWN remaining gap (tracked, not newly filed):** component PARAMETER values are
    dropped on publish (`label="PLAY NOW"` vanishes). Tracked by task **1231** (Component
    Part 2.1).
  - **WATCH-ITEM for maintainer:** 1231 only statically seeds `Button.label` for ONE control;
    general / live param-passing across ALL components is not yet a standalone task.
- **ORCHESTRATION RULE (confirmed twice this session):** Do NOT run multiple Playwright /
  Ruffle e2e subagents concurrently — they share the single Vite dev server on port 1420
  (`playwright.config` `workers:1`), and concurrent runs cause `ERR_CONNECTION_REFUSED` /
  "Port 1420 already in use" flakes. Serialize e2e-heavy QA agents. `golden-parity` (CLI,
  no server) and pure code / unit-test agents CAN run in parallel. Future sweeps: fan out
  parallel agents for static / byte / golden-parity work, but run only ONE e2e/Ruffle agent
  at a time.
- **Still open for workers (carried forward + new):**
  - **1215** — interactivity-autoplay harness fix LANDED (`07ad764`); pending QA-verify next
    sweep.
  - **1216** — real render candidates: motion-tween not moving / motion-guide apex /
    bitmap renders blank.
  - **1227** — Trace Bitmap marching-squares walker traces only ~half of non-rectangular
    regions (needs Moore-neighbor rewrite + diagonal tests).
  - **1230** — Free-Transform warp + affine double-transform in the published SWF (frame loop
    emits PlaceObject2 affine on top of the baked warp).
  - **1231** — Component Part 2.1: AS2 class-emission infra + functional Button; param
    passing still limited (see WATCH-ITEM above).
  - **1223** — CANDIDATE FOR CLOSE (resolved by 1225): `media.ts` doc-wording nuance only.
- **Resolved + verified (no longer open):** 1213 / 1217, 1228, 1214, 1229-part 1.


---

## 2026-06-19 — Verify 1215 + 1230; investigate symbol-internal Free-Transform warp gap

- **Watermark (last fully-QA'd SHA):** `6f816e1` — current repo HEAD. Advances the
  watermark to include everything through 1215 (`07ad764`) and 1230 (`c145922`), now
  both VERIFIED below. Resolved + verified set now includes: 1213/1217, 1228, 1214,
  1229-part1, **1215**, **1230**.
- **`07ad764` / task 1215 — interactivity-autoplay harness fix: VERIFIED genuinely
  resolved.** `injectRufflePlayer` now passes `autoplay:'on'` + `unmuteOverlay:'hidden'`
  and runs a `hideRuffleOverlays()` shadow-DOM walker (recursively `display:none` on the
  HW-accel / play-button / panic overlays) so the player actually PLAYS and screenshots
  composite the real WebGL surface. The three button oracles (release / press / capstone)
  now pass with REAL `diffPixels=10000` — no masking: no threshold relaxed, no `test.skip`,
  no assertion loosened (the fix is purely making the player run + screenshot cleanly).
  Adjacent specs (button-roundtrip, keyboard) stay green.
- **`c145922` / task 1230 — Free-Transform warp + affine double-transform: VERIFIED
  genuinely + completely resolved.** BOTH the PLACE path (`frames.ts` ~474) and the MOVE
  path (~1069) gate `objTransform` to identity (scale=1 / rotation=0) for warped shapes,
  so the baked-warp DefineShape geometry is not double-transformed by the PlaceObject2
  matrix. swf-dump proof: warp+scale and warp+rotation both emit identity scale/rotation
  with the correct tx/ty; the un-warped control keeps its affine. golden-parity exit 0;
  1394 swf unit tests pass.
  - **Minor non-blocking note:** `warp-affine-double-transform.test.ts` uses single-frame
    docs, so the IN-TEST coverage only exercises the PLACE path; the MOVE path is
    byte-proven correct via swf-dump but not by the unit test. (Documentation of test
    coverage, not a defect.)
- **Symbol-internal Free-Transform warp — NEW DEFECT, FILED as task `1232`
  (`1232-6mgjzs`, priority medium).** SAME defect class as 1228/1230 but on the SPRITE
  (symbol-internal) publish path. A Distort/Envelope warp authored on a shape INSIDE a
  movieclip/graphic symbol is DROPPED from the published `DefineShape` inside the
  `DefineSprite` — stage shows the warp, published symbol does not.
  - **Reachability CONFIRMED:** in symbol-edit / edit-in-place mode `Shell.tsx` `timeline`
    (~751) resolves to the symbol's timeline; `handleShapeWarp` (~1291) → `withTimeline`
    → `withSymbolTimeline` (~698) writes `{ warp }` onto a `ShapeDisplayObject` that lives
    inside a `DefineSprite` symbol. So `obj.warp` CAN be non-null on a symbol-internal shape.
  - **Byte-proof CONFIRMED** (decoded DefineShape4 ShapeBounds, same method as
    `warp-bake.test.ts`): a movieclip containing a 100×100 square at (50,50) with a Distort
    warp (SE corner → (300,250)) published with bounds `{1000,3000,1000,3000}` twips = a
    PRISTINE square (warp dropped, only `shiftShapePaths` applied), vs the scene-level
    control `{0,5000,0,4000}` twips (warp correctly baked by 1228).
  - **Root cause:** `packages/swf/src/sprite.ts` ~338 uses `shiftShapePaths(obj.shape,…)`
    and ignores `obj.warp` (then emits an affine PO2 at ~705/936). The scene path
    (`characters.ts` `bakeWarpIntoShape` ~81) does the bake; the sprite path does not.
  - **Fix direction (per task 1232):** call `bakeWarpIntoShape` in the sprite char pass
    when `obj.warp` is set; mirror the 1230 identity-gating on the sprite-internal
    objTransform; add a regression test decoding the DefineShape4 inside the DefineSprite.
- **Still open for workers (carried forward + new):**
  - **1216** — real render candidates: motion-tween not moving / motion-guide apex /
    bitmap renders blank.
  - **1227** — Trace Bitmap marching-squares walker traces only ~half of non-rectangular
    regions (needs Moore-neighbor rewrite + diagonal tests).
  - **1231** — Component Part 2.1: AS2 class-emission infra + functional Button; param
    passing still limited.
  - **1232** — Free-Transform warp dropped for symbol-internal shapes (NEW, filed this
    sweep; sprite.ts doesn't bake warp).
  - **1223** — CANDIDATE FOR CLOSE (resolved by 1225): `media.ts` doc-wording nuance only.
- **Resolved + verified (no longer open):** 1213 / 1217, 1228, 1214, 1229-part 1, 1215, 1230.


---

## 2026-06-19 — Verify 1231 Part 2.1 (functional self-authored mx.controls.Button)

- **Watermark (last fully-QA'd SHA):** `6e7d849` — current repo HEAD. Advances the
  watermark to include everything through 1231 Part 2.1 (`8618411`), now VERIFIED below.
  Resolved + verified set now includes: 1213/1217, 1228, 1214, 1229-part1, 1215, 1230,
  **1231-part2.1**.
- **`8618411` / task 1231 Part 2.1 — functional self-authored `mx.controls.Button`:
  VERIFIED genuinely resolved.** The AS2 class emission is REAL, not a stub:
  `authorComponentClassBytecode()` emits `_global.mx.controls.Button` with prototype
  methods (`setLabel` / `getLabel` / `onLoad` / `onRollOver` / `onRollOut` / `onRelease`)
  via `compileAS2` — using a dotted-global assignment workaround because the AS2 compiler's
  `compileClassDecl` only supports single-identifier class names. The class-def
  `DoInitAction` is ordered BEFORE the `registerClass` body; the skin is a hoisted
  `DefineShape4` rounded-rect face plus a named `DefineEditText` `label_txt` placed inside
  the skin `DefineSprite`; `ActionEnd` is appended.
  - **Test evidence:** unit suite **1397/1397**; component-place tests decode the real
    emitted structure (DefineFunction2 via a proper AVM1 framing walk, ordering, char-id
    cross-refs, seeded label bytes). component-oracle e2e **3/3**: the RENDER oracle shows
    2412 non-white px; the BINDING oracle proves Ruffle resolves
    `_root.myButton instanceof mx.controls.Button` (red=0 / blue=20000 RED→BLUE advance);
    the NEGATIVE control stays red (the advance is impossible without the bound class) —
    strong runtime FUNCTIONAL proof. golden-parity exit 0; adjacent golden-fla-oracle /
    visual-oracle green. No regression. Nothing filed.
- **Minor coverage nuance (not a defect):** the render test's >500px threshold is met by
  the face shape ALONE, so the label GLYPH pixels are not separately pixel-verified (label
  presence is proven structurally in the unit test; device-font `HasFont` is unset).
- **TASK-ID CLARIFICATION (important — corrects any earlier conflation):** the label
  SEEDED by 1231 is the component/item NAME (`componentName || name || "Button"`); there
  is NO distinct user-facing `label` PARAMETER in the `ComponentItem` model yet.
  User-facing component PARAMETER-passing (the Component Inspector param values from task
  1222) is DEFERRED to "component Part 2.2 (live parameter-passing)", QUEUED BY COMMIT
  `6e7d849` — this is NOT task 1232. Task **1232** is the separate symbol-internal
  Free-Transform-warp-dropped defect. Keep these distinct.
- **Still open for workers (carried forward + new):**
  - **1216** — real render candidates: motion-tween not moving / motion-guide apex /
    bitmap renders blank.
  - **1227** — Trace Bitmap marching-squares walker traces only ~half of non-rectangular
    regions (needs Moore-neighbor rewrite + diagonal tests).
  - **1232** — Free-Transform warp dropped for symbol-internal shapes (sprite.ts doesn't
    bake warp).
  - **Component Part 2.2 (live parameter-passing)** — queued by `6e7d849`; user-facing
    Component Inspector param values not yet emitted on publish. (NOT 1232.)
  - **1223** — CANDIDATE FOR CLOSE (resolved by 1225): `media.ts` doc-wording nuance only.
- **Resolved + verified (no longer open):** 1213 / 1217, 1228, 1214, 1229-part 1, 1215,
  1230, 1231-part 2.1.


---

## 2026-06-19 — Verify task 1232 (symbol-internal warp bake) + Component Part 2.2 (live params)

- **Watermark (last fully-QA'd SHA):** `cb7d4fe` — current repo HEAD. Advances the
  watermark to include the symbol-internal warp fix (`6307e85`) and the component live
  parameter-passing work (`30602ff`), both VERIFIED below. Resolved + verified set now:
  1213/1217, 1228, 1214, 1229-part1, 1215, 1230, 1231-part2.1, **1232**,
  **component-part2.2**.
- **Task 1232 (symbol-internal Free-Transform warp bake, commit `6307e85`) — VERIFIED
  genuinely + completely resolved.** `sprite.ts` bakes the warp via the shared
  `bakeWarpIntoShape` (not `shiftShapePaths`) and emits an IDENTITY affine on BOTH the
  place and move paths. Byte-proven via swf-dump: the symbol-internal `DefineShape4` bounds
  are now BAKED (0..5000 / 0..4000) vs the old pristine 1000..3000; the `PlaceObject2`
  carries identity scale/rotation plus the correct `tx`/`ty` on the place AND move paths;
  un-warped (pure-affine) symbols are unaffected. golden-parity exit 0; swf suite
  **1407/1407**.
  - **Minor non-blocking note:** the shipped `warp-sprite-bake.test.ts` asserts only the
    PLACE path; the MOVE path is confirmed correct by an independent swf-dump repro.
- **Component Part 2.2 — live parameter delivery (commit `30602ff`) — VERIFIED genuinely
  works.** Author `componentParameters` reach the live instance via a per-instance
  `DoAction` (emitted AFTER the component `PlaceObject2`) calling
  `setComponentParam(name, value)`; only non-default params are emitted. Per-INSTANCE
  correctness is proven (two Buttons with distinct labels each bind their OWN value — no
  last-wins). Bytecode is sound (`ActionEnd`-terminated, standard `compileAS2` path). The
  component-place unit tests decode the `DoAction` and assert the value reaches the right
  instance; the component-oracle e2e is **4/4** and proves live delivery in Ruffle
  (`getLabel()=="PLAY NOW"` → blue=20000, with a default-label negative control).
  golden-parity exit 0; visual-oracle / golden-fla green. Nothing filed.
- **BOOKKEEPING FLAG for maintainer:** commit `30602ff` (component live-param work) is
  MISLABELED "task 1232" in its message, but task 1232 is the (separate) symbol-internal
  Free-Transform-warp defect, resolved by commit `6307e85`. Task-status findings (read-only,
  this sweep) for reconciliation:
  - The id prefix `1232` is AMBIGUOUS — it matches TWO tasks:
    `1232-6mgjzs-free-transform-warp-dropped-for-symbol-internal-` (the WARP defect) and
    `1232-7xban3-component-part-2-2-live-parameter-passing-author` (component Part 2.2).
  - `1232-6mgjzs` (symbol-internal warp): status **done**, resolved by commit `6307e85`
    with regression test `warp-sprite-bake.test.ts`.
  - `1232-7xban3` (Component Part 2.2 live params): status **done** — there IS a separate,
    correctly-titled task tracking component Part 2.2, and it is closed. So despite the
    `30602ff` commit-message mislabel, the work is properly tracked under its own task.
    Maintainer should be aware the commit message text still says "task 1232" (the warp
    task's bare number), not the part-2.2 task token.
- **Milestone:** the v2 components feature is now complete + verified end-to-end:
  emit (1229 part 1) → functional self-authored `mx.controls.Button` (1231 part 2.1) →
  live author params (part 2.2).
- **Still open for workers (carried forward + new):**
  - **1216** — real render candidates: motion-tween not moving / motion-guide apex /
    bitmap renders blank.
  - **1227** — Trace Bitmap marching-squares walker traces only ~half of non-rectangular
    regions (needs Moore-neighbor rewrite + diagonal tests).
  - **1233** — Component Part 2.3: functional CheckBox / RadioButton (NEW, filed upstream
    this sweep; status open).
  - **1223** — CANDIDATE FOR CLOSE (resolved by 1225): `media.ts` doc-wording nuance only.
- **Resolved + verified (no longer open):** 1213 / 1217, 1228, 1214, 1229-part 1, 1215,
  1230, 1231-part 2.1, 1232, component-part 2.2.


---

## 2026-06-19 — Proactive exploratory audit (idle commit window, no new worker code)

- **Watermark (last fully-QA'd SHA):** unchanged from the prior entry (`cb7d4fe`). No new
  worker code landed this cycle; this is a proactive idle-window sweep, so the watermark
  does NOT advance.
- **Proactive audit — Sound Envelope editor (task 1204): HEALTHY, nothing filed.** Verified
  the authored gain envelope reaches the published SWF end-to-end (it is NOT a member of the
  editor-only gap class): model `SoundEnvelopePoint {pos44, leftLevel, rightLevel}` +
  `SoundLinkage.customEnvelope` (`types.ts:112/134`) → `SoundEnvelopeEditDialog.tsx`
  draggable curve writes back via `Shell.tsx:2238` `handleEnvelopeConfirm` → BOTH compile
  paths consume it (`frames.ts:1542` main timeline, `sprite.ts:1199` symbol-internal) →
  `sounds.ts:123` `encodeSoundInfo` sets `HasEnvelope` + spec-correct `EnvelopeCount` /
  `Pos44` / `LeftLevel` / `RightLevel`, custom overriding preset. swf-dump proof: a 3-point
  asymmetric L/R envelope round-trips exactly through the `StartSound` (tag 15). Test
  coverage present (`soundinfo.test.ts:433/455`). All 1407 swf tests pass.
  - **Logged as "proactively audited & healthy"** so future idle-cycle sweeps do not
    re-tread this area.
- **Still open for workers (carried forward):** 1216, 1227, 1233 open; 1223 remains a
  close candidate (resolved by 1225, doc-wording nuance only).


---

## 2026-06-19 — Task 1233 Part 2.3 verification (functional CheckBox + RadioButton)

- **Watermark (last fully-QA'd SHA):** ADVANCED to current HEAD
  `475c2042e4a8ab3fcd09ab1fa9bcfc5894b82566`. The resolved + verified set now includes:
  1213 / 1217, 1228, 1214, 1229-part 1, 1215, 1230, 1231-part 2.1, 1232 (warp +
  part 2.2 token), component-part 2.2, **1233-part 2.3**.
- **Task 1233 Part 2.3 (commit `e334044`, functional CheckBox + RadioButton) VERIFIED
  genuinely resolved.** Emission was generalized into a CONTROL_REGISTRY: a shared base
  class plus per-control `authorClassBody`, authored at `_global.mx.controls.{CheckBox,
  RadioButton}` and resolved by the `registerClass` DoInitAction (class-def DoInitAction
  correctly ordered BEFORE `registerClass`; AVM1 sound — SetMember `0x4F`, DefineFunction2
  framing correct, ActionEnd appended). Skins: CheckBox = box + `check_mk` tick + label
  EditText; RadioButton = circle + `dot_mk` + label. STATEFUL BEHAVIOR proven (the
  high-risk part): CheckBox `__handleClick` toggles `selected` and `__refresh` shows/hides
  `check_mk`; RadioButton group mutual-exclusion IMPLEMENTED via `_root.__radioGroups`
  registry + `__selectInGroup` deselecting the prior group member. Unit: 1416 swf tests
  pass (component-place decodes ExportAssets + 2 ordered DoInitActions + skin 3-child
  sprite + setComponentParam delivery). Ruffle component-oracle: CheckBox click toggles
  deselected→true (blue=20010); RadioButton click on B deselects author-selected A
  (blue=20038, gated on `rbB.selected && !rbA.selected`) — genuine group-exclusivity
  proof. golden-parity exit 0; golden-fla / visual-oracle green. Nothing filed.
- **Milestone:** the v2 components functional framework now spans Button + CheckBox +
  RadioButton, all verified end-to-end (self-authored AS2 class + skin + `registerClass` +
  live params + stateful behavior).
- **Still open for workers (running list):**
  - **1216** — motion-tween not moving / motion-guide apex / bitmap renders blank. Still
    unaddressed.
  - **1227** — Trace Bitmap marching-squares walker traces only ~half of non-rectangular
    regions. Still unaddressed.
  - **1223** — CANDIDATE FOR CLOSE (resolved by 1225): `media.ts` doc-wording nuance only.


---

## 2026-06-19 — Proactive exploratory audit: Blend modes (idle window, no new worker code)

- **Watermark (last fully-QA'd SHA):** unchanged at `475c2042e4a8ab3fcd09ab1fa9bcfc5894b82566`.
  No new worker code landed this cycle; this is a proactive idle-window sweep, so the
  watermark does NOT advance.
- **Proactive audit — Blend modes: HEALTHY, nothing filed.** Implemented end-to-end (NOT
  the editor-only drop class): `blendMode` field on all DisplayObject variants
  (`engine/types.ts` shape ~L384 / instance ~L545 / bitmap ~L863, 14 Flash 8 modes,
  default `'normal'` in `libraryplace.ts:128`) → UI pickers (`PropertiesPanel.tsx` L775/964,
  `InstancePanel.tsx` L176/404) → `encodePlaceObject3WithBlendMode` (`filters.ts`;
  `SWF_BLEND_MODE` enum ~L676 maps to SPEC values with NO off-by-one:
  multiply=3 … overlay=13, hardlight=14) consumed in both the main path (`frames.ts`
  L537/685/875/1151/1351 — place + move + shape) and the `sprite.ts` symbol-internal path,
  all gated on `blendMode !== "normal"` → PlaceObject3 (tag 70); normal stays PlaceObject2.
  swf-dump proof: 7 modes (multiply/screen/overlay/hardlight/add/difference/invert) all
  decode to the correct named BlendMode on tag 70. Unit coverage: `blendmode.test.ts`
  (swf + core/engine) green; full swf suite 1416 pass.
- **Two non-fileable observations:** (a) no Ruffle visual-oracle for blend COMPOSITING
  (coverage nicety; byte emit proven). (b) latent `?? 0` fallback in
  `encodePlaceObject3WithBlendMode` for an unknown mode name → would write invalid
  BlendMode=0, but unreachable behind the typed-model non-normal gate.
- **Logged as "proactively audited & healthy"** so future idle-cycle sweeps skip it.
  Running "audited & healthy" list now: Sound Envelope (1204), **Blend modes**.
- **Still open for workers (running list, unchanged):** 1216, 1227 open; 1223 remains a
  close candidate (resolved by 1225, doc-wording nuance only); component part 2.4
  (task 1234) queued / not-yet-implemented.
