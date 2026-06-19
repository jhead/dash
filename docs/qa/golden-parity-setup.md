# golden-parity setup (one-time)

`tools/golden-parity.mjs` is the structural parity scorecard for the golden FLA→SWF pair
(`fixtures/golden/golden.{fla,swf}`). It recompiles our SWF in JS each run and diffs it
against the canonical Flash 8 `.swf` using `tools/swf-dump` (a small Rust binary that
normalizes an SWF to stable JSON). See the script header and the CLAUDE.md "Golden
FLA→SWF parity" learnings for what each dimension means.

This file documents the one-time toolchain setup so any future sweep — or a human on a
fresh checkout — can reproduce a run. **Neither the Rust toolchain, the `ruffle/` clone,
nor any `target/` build output survives a clean checkout: `ruffle/` and `target/` are
gitignored** (`.gitignore` lines `ruffle/` and `target/`). You must redo this setup on a
fresh machine/checkout before `node tools/golden-parity.mjs` will run.

## Prerequisites

- Node + pnpm (already required by the repo) with the workspace built:
  `pnpm --filter @flash/core build && pnpm --filter @flash/swf build`
  (golden-parity imports the `dist/` of `@flash/core` and `@flash/swf`).
- A Rust toolchain (for `tools/swf-dump`).

## Steps

### 1. Install Rust (rustup)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
export PATH="$HOME/.cargo/bin:$PATH"   # rustup installs cargo/rustc here
rustc --version   # verified working with rustc 1.96.0
```

### 2. Clone Ruffle (provides the `swf` crate that swf-dump links against)

`tools/swf-dump/Cargo.toml` has a **path dependency** `swf = { path = "../../ruffle/swf" }`,
so the `ruffle/` clone must exist at the repo root. The pinned crate is **swf 0.2.2**
(see `tools/swf-dump/Cargo.lock` — `name = "swf" / version = "0.2.2"`); check out a Ruffle
revision whose `swf/Cargo.toml` is at `0.2.2` so the path dep matches the lockfile and the
parser API used by `swf-dump/src/main.rs` resolves.

```bash
git clone https://github.com/ruffle-rs/ruffle.git ruffle
# pin to the revision whose swf crate is 0.2.2 (matches tools/swf-dump/Cargo.lock):
grep -A2 '^name = "swf"' ruffle/swf/Cargo.toml   # expect version = "0.2.2"
```

(`ruffle/` is gitignored, so it is never committed.)

### 3. Build swf-dump

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --manifest-path tools/swf-dump/Cargo.toml
# produces tools/swf-dump/target/debug/swf-dump  (target/ is gitignored)
```

golden-parity.mjs expects the debug binary at
`tools/swf-dump/target/debug/swf-dump`.

## Run

```bash
export PATH="$HOME/.cargo/bin:$PATH"
node tools/golden-parity.mjs
# optional: a second fixture pair
node tools/golden-parity.mjs fixtures/golden/golden-v2.fla fixtures/golden/golden-v2.swf
```

Exit 0 = all HARD dimensions pass (SELF-DETERMINISM, HEADER/STAGE, TAG INVENTORY,
PLACEMENTS, SHAPE GEOMETRY); documented byte-level gaps (TEXT PARITY font-substitution,
DECOMPRESSED BYTES, the gradient fill-count expansion) report as `KNOWN-GAP`, not
failures. Exit 1 = at least one HARD dimension is a `DIFF` — a real parity defect.

## Gotchas

- **golden-parity.mjs imports the COMPILED `packages/swf/dist`, not the TypeScript
  source.** A stale or desynced `dist/` produces FALSE exit-1 `SHAPE GEOMETRY` failures
  (the harness scores an old build of the encoder against the current golden SWF), which
  is easy to mis-file as a phantom regression. **Always rebuild the dist BEFORE trusting a
  golden-parity result:**

  ```bash
  pnpm --filter @flash/swf build
  ```

  If a `git checkout`/`git bisect` (or a worktree switch) shuffled the working tree, the
  incremental build may not pick up every change — do a clean rebuild:

  ```bash
  rm -rf packages/swf/dist && pnpm --filter @flash/swf build
  ```

  (`@flash/core`'s dist is also imported — rebuild it too if you touched core:
  `pnpm --filter @flash/core build`.) Skipping this step is the most likely cause of a
  sweep mis-filing a SHAPE GEOMETRY "regression" that vanishes after a rebuild.

## Notes

- Per CLAUDE.md, run vitest packages **sequentially**, not in parallel, to avoid the
  esbuild parallel-build race. The dist build above is a prerequisite for golden-parity.
- The Ruffle render oracle (`apps/desktop/e2e/golden-fla-oracle.spec.ts`) is a separate,
  WASM-based acceptance path and is NOT exercised by this harness.
