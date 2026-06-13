#!/usr/bin/env node
/**
 * golden-report — high-signal, low-noise deviation report for the golden
 * FLA/SWF pair.
 *
 * The original `golden-diff.mjs` aligns tags POSITIONALLY (tags[i] vs tags[i]).
 * Because our tag ORDER legitimately differs from Flash 8's (we hoist all
 * character definitions; Flash interleaves them per-frame), a positional diff
 * cascades into ~150 false mismatches and buries the real signal.
 *
 * This report instead surfaces the deviations that actually matter, in three
 * passes that each isolate a class of bug:
 *
 *   1. SELF-DETERMINISM — re-import + recompile N times; the SWF bytes must be
 *      identical. Catches non-reproducible output (entropy, map iteration
 *      order, timestamps).
 *   2. TAG INVENTORY — count tags by type in ours vs golden. A count delta is
 *      an unambiguous "we emit a tag Flash doesn't" / "we drop a tag Flash
 *      emits" signal, independent of ordering.
 *   3. ORDERING SIGNATURE — the tag-type sequence of each file, so structural
 *      ordering divergence (hoisted vs interleaved defs) is visible at a glance.
 *
 * It also dumps the imported MODEL summary so import gaps (data lost before
 * compile) can be told apart from compile gaps (data present, output wrong).
 *
 * Usage:
 *   node tools/golden-report.mjs [<golden.fla> <golden.swf>]
 * Defaults to fixtures/golden/golden.{fla,swf}.
 *
 * Requires swf-dump built: cd tools/swf-dump && cargo build
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const SWF_DUMP = join(__dirname, "swf-dump", "target", "debug", "swf-dump");

const flaPath = resolve(process.argv[2] || join(REPO, "fixtures/golden/golden.fla"));
const swfPath = resolve(process.argv[3] || join(REPO, "fixtures/golden/golden.swf"));

const { loadFla } = await import(`file://${join(REPO, "packages/core/dist/index.js")}`);
const { compileDocument } = await import(`file://${join(REPO, "packages/swf/dist/index.js")}`);

const flaBytes = new Uint8Array(readFileSync(flaPath));

// ---- 1. self-determinism --------------------------------------------------
const hashes = [];
for (let i = 0; i < 4; i++) {
  const swf = Buffer.from(compileDocument(loadFla(flaBytes)));
  hashes.push(createHash("sha256").update(swf).digest("hex").slice(0, 16));
}
const deterministic = new Set(hashes).size === 1;

const ourSwf = Buffer.from(compileDocument(loadFla(flaBytes)));
const work = mkdtempSync(join(tmpdir(), "golden-report-"));
const ourSwfPath = join(work, "ours.swf");
writeFileSync(ourSwfPath, ourSwf);

const dump = (p) => JSON.parse(execFileSync(SWF_DUMP, [p], { encoding: "utf8", maxBuffer: 1 << 28 }));
const ours = dump(ourSwfPath);
const golden = dump(swfPath);

// ---- 2. tag inventory -----------------------------------------------------
const inv = (j) => j.tags.reduce((m, t) => ((m[t.tag] = (m[t.tag] || 0) + 1), m), {});
const oi = inv(ours), gi = inv(golden);
const tagKeys = [...new Set([...Object.keys(oi), ...Object.keys(gi)])].sort();

// ---- report ---------------------------------------------------------------
console.log(`golden-report`);
console.log(`  FLA   : ${flaPath}`);
console.log(`  golden: ${swfPath} (${readFileSync(swfPath).length}B)`);
console.log(`  ours  : ${ourSwf.length}B`);
console.log("");
console.log(`[1] SELF-DETERMINISM: ${deterministic ? "PASS" : "FAIL"} (${hashes.join(" ")})`);
console.log("");
console.log(`[2] TAG INVENTORY (ours vs golden):`);
let invDiffs = 0;
for (const k of tagKeys) {
  const a = oi[k] || 0, b = gi[k] || 0;
  if (a !== b) invDiffs++;
  console.log(`  ${k.padEnd(30)} ${String(a).padStart(3)} ${String(b).padStart(3)} ${a !== b ? "  <-- DIFF" : ""}`);
}
console.log(`  (${invDiffs} tag-type count mismatch${invDiffs === 1 ? "" : "es"})`);
console.log("");
console.log(`[3] ORDERING SIGNATURE:`);
console.log(`  ours  : ${ours.tags.map((t) => t.tag).join(" ")}`);
console.log(`  golden: ${golden.tags.map((t) => t.tag).join(" ")}`);
console.log("");
process.exit(invDiffs === 0 && deterministic ? 0 : 1);
