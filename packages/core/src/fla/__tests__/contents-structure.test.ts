/**
 * Gate 3 — structural match for content.
 *
 * Asserts the writer's Contents catalog framing matches the genuine fixtures'
 * structure: the §8.2 CDocumentPage scene/symbol records, the embedded CColorDef
 * palette and CQTAudioSettings objects, and the scene/symbol ordering. These are
 * structural (class framing + counts + ordering), not importer round-trips.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { saveRealFla } from "../write/fla-write.js";
import { validateContentsStream, validateTimelineStream } from "../write/carchive-validate.js";
import { __readAllStreamsForTest } from "../ole.js";
import { createDocument } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import { createSymbol } from "../../model/library.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../../../../../fixtures");

function streamsOf(path: string): Map<string, Uint8Array> {
  return __readAllStreamsForTest(new Uint8Array(readFileSync(path)));
}

function utf16(name: string): Uint8Array {
  const out = new Uint8Array(name.length * 2);
  for (let i = 0; i < name.length; i++) {
    out[i * 2] = name.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = (name.charCodeAt(i) >> 8) & 0xff;
  }
  return out;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function countClassDecls(data: Uint8Array, name: string): number {
  const ascii = new Uint8Array(name.length);
  for (let i = 0; i < name.length; i++) ascii[i] = name.charCodeAt(i);
  let n = 0;
  for (let i = 0; i + 6 + name.length <= data.length; i++) {
    if (data[i] === 0xff && data[i + 1] === 0xff) {
      const len = data[i + 4]! | (data[i + 5]! << 8);
      if (len === name.length && indexOf(data.subarray(i + 6, i + 6 + name.length), ascii) === 0) n++;
    }
  }
  return n;
}

describe("gate 3 — Contents structure vs real fixtures", () => {
  it("the real empty fixture has exactly: 1 CDocumentPage, 1 CColorDef, 1 CQTAudioSettings", () => {
    const c = streamsOf(resolve(fixtures, "flash8-empty.fla")).get("Contents")!;
    expect(countClassDecls(c, "CDocumentPage")).toBe(1);
    expect(countClassDecls(c, "CColorDef")).toBe(1);
    expect(countClassDecls(c, "CQTAudioSettings")).toBe(1);
  });

  it("our writer reproduces the same embedded-object framing for an empty doc", () => {
    const c = __readAllStreamsForTest(saveRealFla(createDocument())).get("Contents")!;
    expect(countClassDecls(c, "CDocumentPage")).toBe(1);
    expect(countClassDecls(c, "CColorDef")).toBe(1);
    expect(countClassDecls(c, "CQTAudioSettings")).toBe(1);
  });
});

describe("gate 3 — scene / symbol catalog structure", () => {
  it("emits one CDocumentPage per scene, in play order, each NEWCLASS-or-backref framed", () => {
    const doc = createDocument({
      scenes: [createScene("Intro"), createScene("Main"), createScene("Outro")],
    });
    const c = __readAllStreamsForTest(saveRealFla(doc)).get("Contents")!;
    const cat = validateContentsStream(c);
    expect(cat.documentPages).toBe(3);
    // Scene display names appear in authored play order before the stage block.
    const iIntro = indexOf(c, utf16("Intro"));
    const iMain = indexOf(c, utf16("Main"));
    const iOutro = indexOf(c, utf16("Outro"));
    expect(iIntro).toBeGreaterThan(0);
    expect(iIntro).toBeLessThan(iMain);
    expect(iMain).toBeLessThan(iOutro);
    // The CColorDef palette still follows the catalog (one declaration).
    expect(countClassDecls(c, "CColorDef")).toBe(1);
  });

  it("emits scene CDocumentPages followed by symbol CDocumentPages, with timeline streams", () => {
    const mc = createSymbol("Clip", "movieclip");
    const gfx = createSymbol("Gfx", "graphic");
    const doc = createDocument({
      scenes: [createScene("Scene 1")],
      library: { items: [mc, gfx], folders: [] },
    });
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    const cat = validateContentsStream(streams.get("Contents")!);
    expect(cat.documentPages).toBe(3); // 1 scene + 2 symbols
    // Each symbol has its own timeline stream that parses as a CPicPage graph.
    expect(streams.has("Symbol 1")).toBe(true);
    expect(streams.has("Symbol 2")).toBe(true);
    for (const n of ["Page 1", "Symbol 1", "Symbol 2"]) {
      const t = validateTimelineStream(streams.get(n)!);
      expect(t.classes).toContain("CPicPage");
    }
    // Symbol type bytes are carried in the catalog: "Symbol 1"/"Symbol 2" page names
    // exist as UTF-16 strings in the Contents.
    expect(indexOf(streams.get("Contents")!, utf16("Symbol 1"))).toBeGreaterThan(0);
    expect(indexOf(streams.get("Contents")!, utf16("Symbol 2"))).toBeGreaterThan(0);
  });
});

describe("gate 3 — evaporatingdrip library structure parses", () => {
  it("its Contents catalog + symbol/media streams validate", () => {
    const s = streamsOf(resolve(fixtures, "evaporatingdrip.fla"));
    const cat = validateContentsStream(s.get("Contents")!);
    // evaporatingdrip: 1 scene + 2 symbols => exactly 3 CDocumentPage records
    // (1 NEWCLASS declaration + 2 backref reuses, per §5.2).
    expect(cat.documentPages).toBe(3);
    expect(cat.classes).toContain("CColorDef");
    expect(cat.classes).toContain("CQTAudioSettings");
  });
});
