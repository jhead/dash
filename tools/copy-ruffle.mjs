#!/usr/bin/env node
/**
 * Materialize the self-hosted Ruffle bundle into apps/desktop/public/ruffle/.
 *
 * The Ruffle bundle (ruffle.js + its sibling WASM/chunk files) is the contents
 * of the `@ruffle-rs/ruffle` npm package (its `main` is `ruffle.js`, and the
 * dist files sit at the package root). `apps/desktop/public/ruffle/` is
 * GITIGNORED (.gitignore: `apps/desktop/public/ruffle/`) because the bundle is
 * ~27 MB of generated assets, so it is NOT committed and must be copied in from
 * `node_modules` after `pnpm install`.
 *
 * This is REQUIRED for the GitHub Pages deploy: Vite copies `public/` into
 * `dist/` at the configured base (`/dash/`), so without this step the deployed
 * artifact has an EMPTY `dist/ruffle/` and `/dash/ruffle/ruffle.js` 404s — which
 * breaks all Ruffle-based runtime playback (Live Preview, Test Movie) on the
 * deployed site. It also lets a fresh worktree run the Ruffle e2e without
 * manually symlinking the bundle.
 *
 * Idempotent: re-running overwrites the destination.
 */
import { createRequire } from "node:module";
import { cpSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Destination: apps/desktop/public/ruffle/, resolved relative to this script so
// it works from any cwd (repo root in CI, worktree, etc.).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// @ruffle-rs/ruffle is a dependency of @flash/player (not the workspace root),
// and under pnpm it is NOT hoisted to the top-level node_modules. Resolve it
// from the player package's directory so Node's resolution finds the symlinked
// dependency. Its `main` (ruffle.js) sits at the package root alongside the
// WASM/chunk siblings, so the package directory IS the bundle root.
const playerRequire = createRequire(
  pathToFileURL(resolve(repoRoot, "packages/player/package.json"))
);

let ruffleMain;
try {
  ruffleMain = playerRequire.resolve("@ruffle-rs/ruffle");
} catch (err) {
  console.error(
    "[copy-ruffle] Could not resolve @ruffle-rs/ruffle from @flash/player. " +
      "Run `pnpm install` first."
  );
  console.error(String(err));
  process.exit(1);
}

// The bundle root holds all dist files (ruffle.js, wasm, core chunks, etc.).
const srcDir = dirname(ruffleMain);

const destDir = resolve(repoRoot, "apps/desktop/public/ruffle");

// Clean a stale copy so a Ruffle version bump never leaves orphaned old chunks.
if (existsSync(destDir)) {
  rmSync(destDir, { recursive: true, force: true });
}
mkdirSync(destDir, { recursive: true });

// Copy the whole package directory (ruffle.js + siblings). ruffle.js locates its
// WASM/chunk siblings via document.currentScript.src, so they must sit together.
cpSync(srcDir, destDir, { recursive: true });

console.log(`[copy-ruffle] Copied Ruffle bundle from ${srcDir} -> ${destDir}`);
