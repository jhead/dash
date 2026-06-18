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
</content>
</invoke>
