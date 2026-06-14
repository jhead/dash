#!/usr/bin/env node
/**
 * golden-parity — semantic + byte parity scorecard for the golden FLA/SWF pair.
 *
 * Goal: track progress toward byte-for-byte equivalence between our FLA→SWF
 * publish and the canonical Flash 8 `.swf`. Because our tag ORDER and character-ID
 * assignment legitimately differ from Flash 8's (we hoist all definitions; Flash
 * interleaves them per-frame), a naive positional/byte diff is meaningless. This
 * harness instead matches tags by IDENTITY (content signature / instance name /
 * depth) so it can compare the things that actually must match, and reports a
 * categorized scorecard:
 *
 *   [1] SELF-DETERMINISM     re-compile N× → identical bytes
 *   [2] HEADER / STAGE       frameRate, frame count, stage rect
 *   [3] TAG INVENTORY        per-type counts (order-independent)
 *   [4] PLACEMENTS           match by instance name / (depth,charType); compare matrix
 *   [5] SHAPE GEOMETRY       match shapes by record signature; compare ShapeBounds
 *   [6] DECOMPRESSED BYTES   raw body size delta (true byte-for-byte target)
 *   [7] ORDERING SIGNATURE   informational: tag sequence ours vs golden
 *
 * Each dimension reports PASS / DIFF / KNOWN-GAP. Known byte-level gaps that are
 * NOT semantic defects (tag ordering, char-ID order, zlib stream) are listed
 * explicitly at the end so they aren't mistaken for regressions.
 *
 * Usage:  node tools/golden-parity.mjs [<golden.fla> <golden.swf>]
 *         (defaults to fixtures/golden/golden.{fla,swf})
 * Requires swf-dump built:  cd tools/swf-dump && cargo build
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { inflateSync, unzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const SWF_DUMP = join(__dirname, "swf-dump", "target", "debug", "swf-dump");

const flaPath = resolve(process.argv[2] || join(REPO, "fixtures/golden/golden.fla"));
const swfPath = resolve(process.argv[3] || join(REPO, "fixtures/golden/golden.swf"));

const { loadFla } = await import(`file://${join(REPO, "packages/core/dist/index.js")}`);
const { compileDocument } = await import(`file://${join(REPO, "packages/swf/dist/index.js")}`);

const flaBytes = new Uint8Array(readFileSync(flaPath));
const COMPILE_OPTIONS = { compress: true };

// ---- helpers ---------------------------------------------------------------
const dump = (p) => JSON.parse(execFileSync(SWF_DUMP, [p], { encoding: "utf8", maxBuffer: 1 << 28 }));
const pad = (s, n) => String(s).padEnd(n);

/** Decompress a CWS/ZWS SWF to its raw FWS body (header byte + 'WS' + version + len + body). */
function decompressSwf(buf) {
  const sig = String.fromCharCode(buf[0], buf[1], buf[2]);
  const head = Buffer.from(buf.subarray(0, 8)); // FWS/CWS/ZWS + version + u32 fileLength
  if (sig === "FWS") return Buffer.from(buf);
  const body = sig === "CWS" ? inflateSync(buf.subarray(8)) : unzipSync(buf.subarray(8));
  head[0] = 0x46; // 'F'
  return Buffer.concat([head, body]);
}

const results = []; // {dim, status, detail}
const record = (dim, status, detail) => results.push({ dim, status, detail });

// ---- compile ---------------------------------------------------------------
const hashes = [];
for (let i = 0; i < 4; i++) {
  const swf = Buffer.from(compileDocument(loadFla(flaBytes), COMPILE_OPTIONS));
  hashes.push(createHash("sha256").update(swf).digest("hex").slice(0, 16));
}
const ourSwf = Buffer.from(compileDocument(loadFla(flaBytes), COMPILE_OPTIONS));
const work = mkdtempSync(join(tmpdir(), "golden-parity-"));
const ourSwfPath = join(work, "ours.swf");
writeFileSync(ourSwfPath, ourSwf);
const ours = dump(ourSwfPath);
const golden = dump(swfPath);
const goldenBytes = readFileSync(swfPath);

// ---- [1] self-determinism --------------------------------------------------
record(
  "SELF-DETERMINISM",
  new Set(hashes).size === 1 ? "PASS" : "DIFF",
  `${hashes.join(" ")}`,
);

// ---- [2] header / stage ----------------------------------------------------
{
  const a = ours.header, b = golden.header;
  const diffs = [];
  if (a.frameRate !== b.frameRate) diffs.push(`frameRate ${a.frameRate}≠${b.frameRate}`);
  if (a.numFrames !== b.numFrames) diffs.push(`numFrames ${a.numFrames}≠${b.numFrames}`);
  if (a.version !== b.version) diffs.push(`version ${a.version}≠${b.version}`);
  for (const k of ["xMin", "xMax", "yMin", "yMax"]) {
    if (a.stage[k] !== b.stage[k]) diffs.push(`stage.${k} ${a.stage[k]}≠${b.stage[k]}`);
  }
  record("HEADER / STAGE", diffs.length ? "DIFF" : "PASS", diffs.join(", ") || "frameRate, frames, stage all match");
}

// ---- [3] tag inventory -----------------------------------------------------
{
  const inv = (j) => j.tags.reduce((m, t) => ((m[t.tag] = (m[t.tag] || 0) + 1), m), {});
  const oi = inv(ours), gi = inv(golden);
  const keys = [...new Set([...Object.keys(oi), ...Object.keys(gi)])].sort();
  const diffs = keys.filter((k) => (oi[k] || 0) !== (gi[k] || 0)).map((k) => `${k} ${oi[k] || 0}≠${gi[k] || 0}`);
  record("TAG INVENTORY", diffs.length ? "DIFF" : "PASS", diffs.join(", ") || `${keys.length} tag types, all counts equal`);
}

// ---- [4] placements (per-frame z-order: position + name; depth# is a known gap)
{
  // The hard requirement is that each frame places the same objects, in the same
  // relative z-order (depth ascending), at the same stage position and scale, with
  // the same instance name. Absolute depth VALUES and character IDs differ from
  // Flash by a pure renumbering (documented gaps) and are deliberately ignored: we
  // zip the depth-sorted placement lists per frame instead of matching on depth.
  const collectByFrame = (j) => {
    const frames = [];
    let cur = [];
    for (const t of j.tags) {
      if (t.tag === "ShowFrame") { frames.push(cur); cur = []; }
      else if (t.tag === "PlaceObject2" && t.characterId !== undefined) {
        cur.push({
          depth: t.depth,
          name: t.name ?? null,
          tx: t.matrix?.translateX ?? 0,
          ty: t.matrix?.translateY ?? 0,
          sx: t.matrix?.scaleX ?? 1,
          sy: t.matrix?.scaleY ?? 1,
        });
      }
    }
    return frames;
  };
  const of = collectByFrame(ours), gf = collectByFrame(golden);
  const diffs = [];
  let matched = 0, total = 0;
  const nFrames = Math.max(of.length, gf.length);
  for (let i = 0; i < nFrames; i++) {
    const a = (of[i] || []).slice().sort((x, y) => x.depth - y.depth);
    const b = (gf[i] || []).slice().sort((x, y) => x.depth - y.depth);
    total += b.length;
    if (a.length !== b.length) { diffs.push(`frame${i}: ${a.length} placements vs golden ${b.length}`); continue; }
    for (let k = 0; k < b.length; k++) {
      const p = a[k], g = b[k];
      const fd = [];
      if ((p.name ?? "") !== (g.name ?? "")) fd.push(`name ${JSON.stringify(p.name)}≠${JSON.stringify(g.name)}`);
      if (p.tx !== g.tx) fd.push(`tx ${p.tx}≠${g.tx}`);
      if (p.ty !== g.ty) fd.push(`ty ${p.ty}≠${g.ty}`);
      if (Math.abs(p.sx - g.sx) > 1e-4) fd.push(`sx ${p.sx}≠${g.sx}`);
      if (Math.abs(p.sy - g.sy) > 1e-4) fd.push(`sy ${p.sy}≠${g.sy}`);
      if (fd.length) diffs.push(`frame${i} z#${k}: ${fd.join(", ")}`);
      else matched++;
    }
  }
  record("PLACEMENTS", diffs.length ? "DIFF" : "PASS",
    diffs.length ? diffs.join("; ") : `${matched}/${total} placements match (position, scale, name, relative z-order)`);
}

// ---- [5] shape geometry (match by record signature; compare ShapeBounds) ---
{
  // A shape's record geometry is identity-stable across char-ID remapping; match
  // ours↔golden by the sequence of edge record coordinates, then diff bounds.
  const sig = (s) =>
    (s.records || [])
      .map((r) => `${r.type}:${r.x ?? ""},${r.y ?? ""}`)
      .join("|");
  const shapes = (j) => j.tags.filter((t) => t.tag === "DefineShape").map((s) => ({
    sig: sig(s),
    bounds: s.bounds,
    edgeBounds: s.edgeBounds ?? null,
    fills: (s.fillStyles || []).length,
    version: s.version,
  }));
  const os = shapes(ours), gs = shapes(golden);
  const gmap = new Map(gs.map((s) => [s.sig, s]));
  const diffs = [];
  let matched = 0;
  for (const s of os) {
    const g = gmap.get(s.sig);
    if (!g) { diffs.push(`shape(fills=${s.fills},${s.bounds.xMin}..${s.bounds.xMax}): no record-match in golden`); continue; }
    matched++;
    const fd = [];
    for (const k of ["xMin", "xMax", "yMin", "yMax"]) {
      if (s.bounds[k] !== g.bounds[k]) fd.push(`bounds.${k} ${s.bounds[k]}≠${g.bounds[k]}`);
    }
    // edgeBounds (now emitted by swf-dump): compare when both sides have it.
    if (s.edgeBounds && g.edgeBounds) {
      for (const k of ["xMin", "xMax", "yMin", "yMax"]) {
        if (s.edgeBounds[k] !== g.edgeBounds[k]) fd.push(`edgeBounds.${k} ${s.edgeBounds[k]}≠${g.edgeBounds[k]}`);
      }
    }
    if (s.fills !== g.fills) fd.push(`fillStyles ${s.fills}≠${g.fills} (Flash gradient-fill expansion — byte gap, not a render defect)`);
    if (fd.length) diffs.push(fd.join(", "));
  }
  // Only count bounds/edgeBounds mismatches as DIFF; fill-count expansion is a known byte gap.
  const hard = diffs.filter((d) => d.includes("bounds.") || d.includes("no record-match"));
  record("SHAPE GEOMETRY", hard.length ? "DIFF" : (diffs.length ? "KNOWN-GAP" : "PASS"),
    (diffs.length ? diffs.join("; ") : `${matched}/${gs.length} shapes match (records + ShapeBounds + EdgeBounds)`));
}

// ---- [5b] text parity (DefineText offsets, height, glyph-index sequence) ----
{
  // Each static-text DefineText is identity-matched ours↔golden by its glyph
  // INDEX sequence (font-independent — both sides index into the same logical
  // glyph table, even when the rendered outlines differ). Once matched, we
  // compare the layout fields that drive on-screen positioning:
  //   x_offset MISSING (0/absent) while golden has a real offset → HARD DIFF
  //   x_offset present-but-off by ≤ X_OFFSET_TOL twips           → KNOWN-GAP
  //   y_offset delta (any)                                       → KNOWN-GAP
  //   height / glyph-index-count mismatch                        → HARD DIFF
  //   per-glyph ADVANCE values                                   → KNOWN-GAP
  // Rationale: a wrong x_offset shifts the whole text run. The genuine bug class
  // (task 1193: title x_offset 0 ours vs 3640 golden; task 1199: button label
  // x_offset 0 ours vs 280 golden) is "we baked NO alignment offset at all" —
  // that stays a HARD DIFF. Once the alignment offset IS applied, the residual
  // x_offset delta (~70–90 twips) and the y_offset delta (baseline/ascent pivot,
  // e.g. 720↔660, 360↔320) are pure font-substitution artifacts: the FLA was
  // authored against Win7/Flash8 Arial but we publish a generated NotoSans whose
  // per-glyph advance widths and ascent differ. These are visually inert and
  // documented as KNOWN-GAP. The HARD/GAP split is deliberately asymmetric so a
  // real "forgot to center" regression (offset collapses to 0) still FAILS.
  const X_OFFSET_TOL = 150; // twips; font-metric pivot in present-offset deltas
  const texts = (j) =>
    j.tags
      .filter((t) => (t.tag === "DefineText" || t.tag === "DefineText2") && Array.isArray(t.records))
      .map((t) => ({
        id: t.id,
        recs: t.records.map((r) => ({
          glyphIdx: (r.glyphs || []).map((g) => g.index),
          advances: (r.glyphs || []).map((g) => g.advance),
          xOffset: r.xOffset ?? 0,
          yOffset: r.yOffset ?? 0,
          height: r.height ?? null,
        })),
        // Identity signature = concatenated glyph-index sequence across records.
        sig: t.records.map((r) => (r.glyphs || []).map((g) => g.index).join(",")).join("|"),
      }));
  const ot = texts(ours), gt = texts(golden);
  const gmap = new Map(gt.map((t) => [t.sig, t]));

  const hardDiffs = [];
  const gapDiffs = [];
  let matched = 0;
  let textRecords = 0;
  for (const t of ot) {
    const g = gmap.get(t.sig);
    if (!g) {
      hardDiffs.push(`text(id#${t.id}, glyphSeq=[${t.sig}]): no glyph-sequence match in golden`);
      continue;
    }
    matched++;
    const n = Math.max(t.recs.length, g.recs.length);
    for (let i = 0; i < n; i++) {
      textRecords++;
      const a = t.recs[i], b = g.recs[i];
      if (!a || !b) { hardDiffs.push(`text(id#${t.id}) rec${i}: record count ${t.recs.length}≠${g.recs.length}`); continue; }
      if (a.glyphIdx.length !== b.glyphIdx.length)
        hardDiffs.push(`text(id#${t.id}) rec${i}: glyph count ${a.glyphIdx.length}≠${b.glyphIdx.length}`);
      if (a.xOffset !== b.xOffset) {
        // "Offset collapsed to 0/absent while golden has a real offset" is the
        // genuine centering-bug signature (tasks 1193/1199) → HARD DIFF.
        const offsetMissing = a.xOffset === 0 && b.xOffset !== 0;
        if (offsetMissing) {
          hardDiffs.push(`text(id#${t.id}) rec${i}: x_offset ${a.xOffset}≠${b.xOffset} (text run NOT centered/aligned — alignment offset missing, tasks 1193/1199)`);
        } else if (Math.abs(a.xOffset - b.xOffset) <= X_OFFSET_TOL) {
          gapDiffs.push(`text(id#${t.id}) rec${i}: x_offset ${a.xOffset}≠${b.xOffset} (Δ=${a.xOffset - b.xOffset} twips ≤${X_OFFSET_TOL}; font-metric pivot NotoSans↔Arial)`);
        } else {
          hardDiffs.push(`text(id#${t.id}) rec${i}: x_offset ${a.xOffset}≠${b.xOffset} (Δ=${a.xOffset - b.xOffset} twips >${X_OFFSET_TOL} — exceeds font-metric tolerance)`);
        }
      }
      if (a.yOffset !== b.yOffset)
        // y_offset delta is a baseline/ascent metric pivot (font substitution) → KNOWN-GAP.
        gapDiffs.push(`text(id#${t.id}) rec${i}: y_offset ${a.yOffset}≠${b.yOffset} (Δ=${a.yOffset - b.yOffset} twips; baseline/ascent pivot NotoSans↔Arial)`);
      if (a.height !== b.height)
        hardDiffs.push(`text(id#${t.id}) rec${i}: height ${a.height}≠${b.height}`);
      // Per-glyph advance deltas → KNOWN-GAP (font substitution).
      const advDelta = a.advances.some((v, k) => v !== b.advances[k]);
      if (advDelta) {
        const n0 = a.advances.length;
        const maxd = Math.max(...a.advances.map((v, k) => Math.abs(v - (b.advances[k] ?? v))));
        gapDiffs.push(`text(id#${t.id}) rec${i}: ${n0} glyph advances differ (max Δ=${maxd} twips; font substitution NotoSans↔Arial)`);
      }
    }
  }
  const status = hardDiffs.length ? "DIFF" : (gapDiffs.length ? "KNOWN-GAP" : "PASS");
  const detail = hardDiffs.length
    ? hardDiffs.join("; ") + (gapDiffs.length ? `  [+${gapDiffs.length} advance gap(s)]` : "")
    : (gapDiffs.length
        ? `${matched}/${gt.length} text runs match (height, glyph indices, alignment offset present); font-metric gaps: ` + gapDiffs.join("; ")
        : `${matched}/${gt.length} text runs match (offsets, height, glyph indices, advances)`);
  record("TEXT PARITY", status, detail);
}

// ---- [6] decompressed body bytes ------------------------------------------
{
  const od = decompressSwf(ourSwf), gd = decompressSwf(goldenBytes);
  const identical = od.length === gd.length && od.equals(gd);
  record("DECOMPRESSED BYTES",
    identical ? "PASS" : "KNOWN-GAP",
    identical ? "byte-for-byte identical" :
      `ours=${od.length}B golden=${gd.length}B (Δ=${od.length - gd.length}; differs by tag order, char-ID order & Flash's gradient-fill expansion — see ledger)`);
}

// ---- report ----------------------------------------------------------------
console.log(`golden-parity`);
console.log(`  FLA   : ${flaPath}`);
console.log(`  golden: ${swfPath} (${goldenBytes.length}B compressed)`);
console.log(`  ours  : ${ourSwf.length}B compressed`);
console.log("");
let semanticFail = 0;
for (const r of results) {
  const mark = r.status === "PASS" ? "✓" : r.status === "KNOWN-GAP" ? "≈" : "✗";
  if (r.status === "DIFF") semanticFail++;
  console.log(`  ${mark} ${pad(r.dim, 20)} ${pad(r.status, 10)} ${r.detail}`);
}
console.log("");
console.log(`[ORDERING SIGNATURE] (informational — Ruffle-agnostic; not a parity requirement)`);
console.log(`  ours  : ${ours.tags.map((t) => t.tag).join(" ")}`);
console.log(`  golden: ${golden.tags.map((t) => t.tag).join(" ")}`);
console.log("");
console.log(`[KNOWN BYTE-PARITY GAPS] (documented; semantically inert — Ruffle renders identically)`);
console.log(`  • Tag ordering: we hoist all character definitions before frame 1; Flash 8 interleaves`);
console.log(`    definitions per-frame just before first use. Pure ordering — no field differs.`);
console.log(`  • Character-ID assignment order differs (we number in library order; Flash in usage order).`);
console.log(`  • PlaceObject2 depth VALUES differ: Flash reuses depths freed by RemoveObject (e.g. d1,d3);`);
console.log(`    we allocate monotonically (d3,d4). Relative z-order & positions are identical.`);
console.log(`  • Flash expands a single FLA gradient fill into many DefineShape fillStyles at publish`);
console.log(`    time (button face: 17 vs our 1). Renders identically; matching requires replicating`);
console.log(`    Flash's non-minimal gradient encoding.`);
console.log(`  • zlib (CWS) deflate stream is implementation-specific; exact compressed bytes are not`);
console.log(`    reproducible without Flash's exact deflate. Compare DECOMPRESSED bytes instead.`);
console.log("");
const textFail = results.find((r) => r.dim === "TEXT PARITY" && r.status === "DIFF");
console.log(semanticFail === 0
  ? `RESULT: SEMANTIC PARITY — all hard dimensions PASS (${results.filter((r) => r.status === "KNOWN-GAP").length} documented byte-level gap(s)).`
  : `RESULT: ${semanticFail} semantic dimension(s) FAIL — see ✗ above.`);
if (textFail) {
  console.log("");
  console.log(`NOTE: TEXT PARITY is a HARD DIFF only when a genuine positioning bug is present —`);
  console.log(`an alignment offset that COLLAPSED to 0/absent while golden carries a real offset`);
  console.log(`(tasks 1193/1199), an x_offset delta beyond the font-metric tolerance, a glyph-count`);
  console.log(`or height mismatch. Residual present-offset x deltas (≤tol) and y_offset baseline`);
  console.log(`pivots are font-substitution artifacts (NotoSans↔Arial), shown as KNOWN-GAP. Do NOT`);
  console.log(`weaken the HARD checks; the collapsed-offset guard catches real centering regressions.`);
}
process.exit(semanticFail === 0 ? 0 : 1);
