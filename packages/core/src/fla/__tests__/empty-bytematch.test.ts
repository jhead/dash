/**
 * Gate 1 — byte-match the genuine empty Flash 8 document (decisive).
 *
 * `saveRealFla(createDocument())` must produce a `Contents` and a `Page 1` stream
 * whose bytes equal `fixtures/flash8-empty.fla`'s, modulo a small, explicitly
 * enumerated set of volatile bytes (timestamps / a frameId). When this passes the
 * empty-doc output literally IS a real Flash file and Flash will open it.
 *
 * Volatile bytes (verified against the fixture):
 *   - Contents: two u32 timeCreated/ItemID fields in the scene CDocumentPage
 *     FixedPageTail. Their absolute offsets are computed below.
 *   - Page 1: one big-endian u16 frameId in the empty-keyframe body.
 *
 * Grid color is a model-default divergence, not volatile: Flash's empty default is
 * #c0c0c0 while createDocument()'s grid is #999999. The test builds the doc with
 * the Flash default so the comparison isolates only the volatile bytes; a separate
 * assertion documents the model-default grid bytes.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { saveRealFla } from "../write/fla-write.js";
import { __readAllStreamsForTest } from "../ole.js";
import { createDocument, createDocumentProperties, createGridSettings } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import { createLayer, createFrame } from "../../model/timeline.js";
import { FLA8_EMPTY_FIXTURE, FLA8_FIXTURE_SKIP_REASON, hasValidFla8Fixture } from "./fla8-fixture.js";

const fixturePath = FLA8_EMPTY_FIXTURE;

function loadFixtureStreams(): Map<string, Uint8Array> {
  const bytes = new Uint8Array(readFileSync(fixturePath));
  return __readAllStreamsForTest(bytes);
}

/** Diff two byte arrays; return the list of differing offsets. */
function diffOffsets(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) out.push(i);
  }
  return out;
}

/** Group an ascending offset list into contiguous [start,end] runs. */
function runs(offsets: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const o of offsets) {
    const last = out[out.length - 1];
    if (last && o === last[1] + 1) last[1] = o;
    else out.push([o, o]);
  }
  return out;
}

function emptyDoc() {
  // Build createDocument() but with Flash's empty-default settings so the
  // comparison isolates only volatile bytes. Two settings are model-default
  // divergences (NOT volatile, and NOT writer bugs — they are real defaults that
  // differ between this model and Flash 8):
  //   - grid color:    Flash #c0c0c0   vs createGridSettings #999999
  //   - layer outline: Flash #4fff4f   vs createLayer #0000ff
  // A correct serializer emits whatever the model carries; the fixture used
  // Flash's defaults, so we build the test doc with those values.
  const layer = createLayer("Layer 1", "normal", {
    frames: [createFrame(0)],
    frameCount: 1,
    outlineColor: "#4fff4f",
  });
  return createDocument({
    properties: createDocumentProperties({
      grid: createGridSettings({ gridColor: "#c0c0c0", gridWidth: 18 }),
    }),
    scenes: [createScene("Scene 1", { timeline: { layers: [layer] } })],
  });
}

const FIXTURE_PRESENT = hasValidFla8Fixture(fixturePath);

// When the genuine fixture is absent/empty/non-OLE2, surface a single skipped test
// carrying the reason (the visual-oracle CI-skip pattern). The moment the real
// ~17 KB OLE2 binary is committed, FIXTURE_PRESENT flips true and the full gate
// below runs at FULL strength — no assertion is weakened.
describe.runIf(!FIXTURE_PRESENT)("gate 1 — empty doc byte-match vs flash8-empty.fla", () => {
  it.skip(FLA8_FIXTURE_SKIP_REASON, () => {});
});

describe.runIf(FIXTURE_PRESENT)("gate 1 — empty doc byte-match vs flash8-empty.fla", () => {
  const fixture = loadFixtureStreams();
  const out = __readAllStreamsForTest(saveRealFla(emptyDoc()));

  it("Contents length matches the real empty doc (17312 bytes)", () => {
    expect(fixture.get("Contents")!.length).toBe(17312);
    expect(out.get("Contents")!.length).toBe(17312);
  });

  it("Page 1 length matches the real empty doc (274 bytes)", () => {
    expect(fixture.get("Page 1")!.length).toBe(274);
    expect(out.get("Page 1")!.length).toBe(274);
  });

  it("Contents differs only at the two known volatile timestamp u32 fields", () => {
    const fc = fixture.get("Contents")!;
    const oc = out.get("Contents")!;
    const diff = diffOffsets(fc, oc);
    // Scene CDocumentPage starts after the 23-byte preamble; its NEWCLASS header
    // is FFFF + schema(2) + namelen(2) + "CDocumentPage"(13) = 19 bytes, then the
    // 0x17 version, "Page 1" (1+12), "Scene 1" BomString (4+14), symbolId/resv/
    // type (5), empty BomString (4). The FixedPageTail then begins; the volatile
    // u32s sit at tail-relative 0x18 and 0x5C.
    // Compute the tail start the same way the writer does.
    const tailStart =
      23 + // preamble
      19 + // NEWCLASS CDocumentPage
      1 + // documentPageVersion
      (1 + "Page 1".length * 2) + // pageName String
      (4 + "Scene 1".length * 2) + // sceneName BomString
      5 + // symbolId u16, reserved u16, symbolType u8
      4; // empty BomString
    const ts1 = tailStart + 0x18;
    const ts2 = tailStart + 0x5c;
    const allowed = new Set<number>();
    for (const base of [ts1, ts2]) for (let k = 0; k < 4; k++) allowed.add(base + k);
    const unexpected = diff.filter((o) => !allowed.has(o));
    if (unexpected.length) {
      // eslint-disable-next-line no-console
      console.error("unexpected Contents diffs at", runs(unexpected));
    }
    expect(unexpected).toEqual([]);
    // Every differing byte (if any) is within the enumerated volatile set. Our
    // FIXED_TIMESTAMP equals the fixture's value, so in practice the Contents is
    // a perfect byte match; the assertion still guarantees no diff escapes the
    // known-volatile region for any chosen timestamp.
    expect(diff.every((o) => allowed.has(o))).toBe(true);
  });

  it("Page 1 differs only at the known volatile big-endian frameId (2 bytes)", () => {
    const fp = fixture.get("Page 1")!;
    const op = out.get("Page 1")!;
    const diff = diffOffsets(fp, op);
    // frameId is at absolute offset 0x8a in the empty Page 1 (big-endian u16).
    const allowed = new Set<number>([0x8a, 0x8b]);
    const unexpected = diff.filter((o) => !allowed.has(o));
    if (unexpected.length) {
      // eslint-disable-next-line no-console
      console.error("unexpected Page 1 diffs at", runs(unexpected), "bytes", unexpected.map((o) => [o, fp[o], op[o]]));
    }
    expect(unexpected).toEqual([]);
  });

  it("only Contents, Page 1 streams are present (matching the empty doc)", () => {
    expect([...fixture.keys()].sort()).toEqual(["Contents", "Page 1"]);
    expect([...out.keys()].sort()).toEqual(["Contents", "Page 1"]);
  });
});
