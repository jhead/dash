#!/usr/bin/env node
/**
 * golden-diff — structural diff of our SWF export vs a reference Flash 8 SWF.
 *
 * Task 0698: the golden FLA/SWF pair harness. Given a `.fla` (authored in
 * Flash 8) and its `.swf` (exported by Flash 8's "Publish"), this:
 *
 *   1. Imports the FLA via @flash/core `loadFla()`.
 *   2. Compiles it to a SWF via @flash/swf `compileDocument()`.
 *   3. Normalizes BOTH SWFs to canonical JSON via the `swf-dump` Rust tool.
 *   4. Structurally diffs the two JSON trees with a twip tolerance, printing
 *      a human-readable report and exiting non-zero on mismatch.
 *
 * Usage:
 *   node tools/golden-diff.mjs <golden.fla> <golden.swf> [--tolerance <twips>]
 *
 * Requires `swf-dump` to be built first (tools/golden-diff.sh handles that):
 *   cd tools/swf-dump && cargo build
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

// Import the built workspace packages directly from their dist/ entry points.
// The repo root has no @flash/* symlinks, so a bare specifier won't resolve
// when this script is run via plain `node`. Resolving dist paths avoids
// needing pnpm to wrap the invocation.
const { loadFla } = await import(
  fileURLToPath(new URL(`file://${join(REPO, "packages/core/dist/index.js")}`))
);
const { compileDocument } = await import(
  fileURLToPath(new URL(`file://${join(REPO, "packages/swf/dist/index.js")}`))
);

const SWF_DUMP = join(__dirname, "swf-dump", "target", "debug", "swf-dump");

function usage(msg) {
  if (msg) console.error(`golden-diff: ${msg}`);
  console.error("usage: node tools/golden-diff.mjs <golden.fla> <golden.swf> [--tolerance <twips>]");
  process.exit(2);
}

// ---- parse args -----------------------------------------------------------
const args = process.argv.slice(2);
let flaPath = null;
let swfPath = null;
let tolerance = 1; // twips; absorbs sub-twip rounding differences
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--tolerance") {
    tolerance = Number(args[++i]);
  } else if (!flaPath) {
    flaPath = args[i];
  } else if (!swfPath) {
    swfPath = args[i];
  }
}
if (!flaPath || !swfPath) usage("missing arguments");

// ---- 1. import FLA, 2. compile our SWF ------------------------------------
const flaBytes = new Uint8Array(readFileSync(resolve(flaPath)));
let doc;
try {
  doc = loadFla(flaBytes);
} catch (e) {
  usage(`failed to import FLA: ${e.message}`);
}
const ourSwf = compileDocument(doc);

const work = mkdtempSync(join(tmpdir(), "golden-diff-"));
const ourSwfPath = join(work, "ours.swf");
writeFileSync(ourSwfPath, ourSwf);

// ---- 3. normalize both SWFs to canonical JSON -----------------------------
function dump(p) {
  const out = execFileSync(SWF_DUMP, [p], { encoding: "utf8", maxBuffer: 1 << 28 });
  return JSON.parse(out);
}
let ourJson, goldenJson;
try {
  ourJson = dump(ourSwfPath);
  goldenJson = dump(resolve(swfPath));
} catch (e) {
  console.error("golden-diff: swf-dump failed. Build it first: cd tools/swf-dump && cargo build");
  console.error(e.message);
  process.exit(2);
}

// ---- 4. structural diff with twip tolerance -------------------------------
const diffs = [];

function isNum(v) {
  return typeof v === "number";
}

function diff(path, a, b) {
  if (a === b) return;
  if (isNum(a) && isNum(b)) {
    if (Math.abs(a - b) > tolerance) {
      diffs.push(`${path}: ours=${a} golden=${b} (Δ=${a - b}, tol=${tolerance})`);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${path}.length: ours=${a.length} golden=${b.length}`);
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) diff(`${path}[${i}]`, a[i], b[i]);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a)) { diffs.push(`${path}.${k}: missing in ours (golden=${JSON.stringify(b[k])})`); continue; }
      if (!(k in b)) { diffs.push(`${path}.${k}: extra in ours (ours=${JSON.stringify(a[k])})`); continue; }
      diff(`${path}.${k}`, a[k], b[k]);
    }
    return;
  }
  diffs.push(`${path}: ours=${JSON.stringify(a)} golden=${JSON.stringify(b)}`);
}

diff("$", ourJson, goldenJson);

// ---- report ---------------------------------------------------------------
console.log(`golden-diff: FLA=${flaPath}`);
console.log(`golden-diff: golden SWF=${swfPath}`);
console.log(`golden-diff: our SWF tags=${ourJson.tags.length}, golden tags=${goldenJson.tags.length}, tolerance=${tolerance} twips`);
if (diffs.length === 0) {
  console.log("golden-diff: PASS — structural match within tolerance");
  process.exit(0);
} else {
  console.log(`golden-diff: FAIL — ${diffs.length} difference(s):`);
  for (const d of diffs.slice(0, 200)) console.log("  " + d);
  if (diffs.length > 200) console.log(`  ... and ${diffs.length - 200} more`);
  process.exit(1);
}
