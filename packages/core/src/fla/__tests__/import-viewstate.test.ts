/**
 * Task 1411 — binary FLA import must recover the document/view state the model
 * carries but the reader previously dropped:
 *   - ruler guides in the CPicPage tail (docs/21 §10.1),
 *   - grid settings + ruler units from the §8.4 stage block,
 *   - per-layer heightMultiplier (docs/21 §10.2).
 *
 * These are READ-side (importer) assertions. The grid color/spacing + layer
 * height are already emitted by the writer, so they close a full
 * saveRealFla -> tryLoadRealFla round-trip here. Ruler guides are still
 * write-side WIP (task 1386), so the guide read is proven against a synthesised
 * CPicPage tail and the full-importer union path via buildFla8Document; once the
 * writer emits guideCount>0 the plain saveRealFla round-trip closes too.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { saveRealFla } from "../write/fla-write.js";
import { tryLoadRealFla, __readAllStreamsForTest } from "../ole.js";
import { parseFla8Timeline, parseFla8Contents } from "../flash8-binary.js";
import { buildFla8Document } from "../flash8-import.js";
import { createDocument, createDocumentProperties, createGridSettings } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import { createLayer, createFrame } from "../../model/timeline.js";
import type { FlashDocument, Layer, Scene } from "../../model/types.js";

const MAGNET_FLA = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/Magnet.fla");

function sceneWith(name: string, layers: Layer[]): Scene {
  return createScene(name, { timeline: { layers } });
}

function baseDoc(scenes: Scene[], extra?: Partial<FlashDocument>): FlashDocument {
  return createDocument({
    properties: createDocumentProperties({ width: 640, height: 480, frameRate: 24 }),
    scenes,
    library: { items: [], folders: [] },
    ...extra,
  });
}

/**
 * Append a guide array to a writer-produced Page stream. The CPicPage tail ends
 * with `u32 guideCount` (0 for the current writer), so we overwrite that trailing
 * count and append `{u32 direction; u32 valueTwips}` records (docs/21 §10.1).
 */
function spliceGuides(page: Uint8Array, guides: { dir: number; twips: number }[]): Uint8Array {
  const out = new Uint8Array(page.length + guides.length * 8);
  out.set(page);
  const dv = new DataView(out.buffer);
  dv.setUint32(page.length - 4, guides.length, true); // overwrite guideCount=0
  let off = page.length;
  for (const g of guides) {
    dv.setUint32(off, g.dir, true);
    dv.setUint32(off + 4, g.twips, true);
    off += 8;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grid + ruler units
// ---------------------------------------------------------------------------

describe("FLA import — grid settings + ruler units (§8.4 stage block)", () => {
  it("round-trips grid color and grid spacing via saveRealFla -> tryLoadRealFla", () => {
    const doc = baseDoc([sceneWith("Scene 1", [createLayer("Layer 1", "normal")])], {
      properties: createDocumentProperties({
        width: 640,
        height: 480,
        frameRate: 24,
        grid: createGridSettings({ gridColor: "#abcdef", gridWidth: 32, gridHeight: 32 }),
      }),
    });
    const out = tryLoadRealFla(saveRealFla(doc));
    expect(out).not.toBeNull();
    expect(out!.properties.grid.gridColor.toLowerCase()).toBe("#abcdef");
    expect(out!.properties.grid.gridWidth).toBe(32);
    expect(out!.properties.grid.gridHeight).toBe(32);
    // The writer hardcodes rulerUnitType=pixels(5) until the write side lands,
    // so the imported units are px (not the createDocumentProperties default
    // by accident — the reader actually decoded byte 5).
    expect(out!.properties.rulerUnits).toBe("px");
  });

  it("decodes grid color/spacing + ruler units from the real Magnet.fla stage block", () => {
    const bytes = new Uint8Array(readFileSync(MAGNET_FLA));
    const contents = __readAllStreamsForTest(bytes).get("Contents")!;
    const info = parseFla8Contents(contents);
    expect(info.rulerUnitType).toBe(5); // pixels
    expect(info.gridVisible).toBe(false);
    expect(info.gridSpacingPx).toBe(20);
    expect(info.gridColor).not.toBeNull();
    const c = info.gridColor!;
    expect([c.r, c.g, c.b]).toEqual([0xc0, 0xc0, 0xc0]);
  });

  it("threads the decoded grid/ruler through the full importer (Magnet.fla)", () => {
    const bytes = new Uint8Array(readFileSync(MAGNET_FLA));
    const doc = tryLoadRealFla(bytes);
    expect(doc).not.toBeNull();
    expect(doc!.properties.rulerUnits).toBe("px");
    expect(doc!.properties.grid.gridColor.toLowerCase()).toBe("#c0c0c0");
    expect(doc!.properties.grid.gridWidth).toBe(20);
    expect(doc!.properties.grid.showGrid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer heightMultiplier
// ---------------------------------------------------------------------------

describe("FLA import — layer heightMultiplier (§10.2)", () => {
  it("round-trips a non-default row height via saveRealFla -> tryLoadRealFla", () => {
    const layers = [
      createLayer("Tall", "normal", { height: 60, frames: [createFrame(0)], frameCount: 1 }),
      createLayer("Base", "normal", { frames: [createFrame(0)], frameCount: 1 }), // default 20
    ];
    const out = tryLoadRealFla(saveRealFla(baseDoc([sceneWith("Scene 1", layers)])));
    expect(out).not.toBeNull();
    const byName = new Map(out!.scenes[0]!.timeline.layers.map((l) => [l.name, l.height]));
    expect(byName.get("Tall")).toBe(60); // heightMultiplier 3 -> 60 px
    expect(byName.get("Base")).toBe(20); // heightMultiplier 1 -> 20 px
  });

  it("parseFla8Timeline exposes heightMultiplier on the raw layer", () => {
    const doc = baseDoc([
      sceneWith("Scene 1", [
        createLayer("Tall", "normal", { height: 40, frames: [createFrame(0)], frameCount: 1 }),
      ]),
    ]);
    const page = __readAllStreamsForTest(saveRealFla(doc)).get("Page 1")!;
    const tl = parseFla8Timeline(page);
    expect(tl.layers[0]!.heightMultiplier).toBe(2); // 40 px / 20
  });
});

// ---------------------------------------------------------------------------
// Ruler guides (CPicPage tail)
// ---------------------------------------------------------------------------

describe("FLA import — ruler guides (§10.1 CPicPage tail)", () => {
  it("parseFla8Timeline reads the guide array from the page tail", () => {
    const doc = baseDoc([sceneWith("Scene 1", [createLayer("Layer 1", "normal")])]);
    const page = __readAllStreamsForTest(saveRealFla(doc)).get("Page 1")!;
    // No guides written by the current writer.
    expect(parseFla8Timeline(page).guides).toEqual([]);

    const spliced = spliceGuides(page, [
      { dir: 0, twips: 2000 }, // horizontal guide at y=100 px
      { dir: 1, twips: 5000 }, // vertical guide at x=250 px
    ]);
    const guides = parseFla8Timeline(spliced).guides;
    expect(guides).toEqual([
      { direction: 0, valueTwips: 2000 },
      { direction: 1, valueTwips: 5000 },
    ]);
  });

  it("buildFla8Document unions per-scene guides into doc.properties.guides", () => {
    const doc = baseDoc([sceneWith("Scene 1", [createLayer("Layer 1", "normal")])]);
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    const page = streams.get("Page 1")!;
    streams.set(
      "Page 1",
      spliceGuides(page, [
        { dir: 0, twips: 2000 }, // y=100 px horizontal
        { dir: 1, twips: 5000 }, // x=250 px vertical
      ]),
    );
    const rebuilt = buildFla8Document(streams);
    expect(rebuilt).not.toBeNull();
    const guides = rebuilt!.properties.guides;
    expect(guides.map((g) => ({ orientation: g.orientation, position: g.position }))).toEqual([
      { orientation: "horizontal", position: 100 },
      { orientation: "vertical", position: 250 },
    ]);
    // Each guide has a stable, unique id.
    expect(new Set(guides.map((g) => g.id)).size).toBe(guides.length);
  });

  it("de-duplicates identical guides shared across multiple scenes", () => {
    const doc = baseDoc([
      sceneWith("Scene 1", [createLayer("Layer 1", "normal")]),
      sceneWith("Scene 2", [createLayer("Layer 1", "normal")]),
    ]);
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    for (const key of streams.keys()) {
      if (/Page \d+$/.test(key)) {
        streams.set(key, spliceGuides(streams.get(key)!, [{ dir: 0, twips: 2000 }]));
      }
    }
    const rebuilt = buildFla8Document(streams);
    expect(rebuilt).not.toBeNull();
    // Both scenes carry the same y=100 guide; the union keeps a single copy.
    expect(rebuilt!.properties.guides.length).toBe(1);
    expect(rebuilt!.properties.guides[0]!.orientation).toBe("horizontal");
    expect(rebuilt!.properties.guides[0]!.position).toBe(100);
  });
});
