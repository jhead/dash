/**
 * Gate 2 — strict CArchive validator.
 *
 * Proves the validator is faithful by cleanly parsing the REAL fixtures
 * (flash8-empty.fla, evaporatingdrip.fla) and rejecting corrupt input, then
 * requires that it cleanly parses `saveRealFla(doc)` for: empty, 1 scene + 1 layer
 * + a solid-fill rectangle, a movieclip symbol + instance, and a 2-scene doc.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  validateTimelineStream,
  validateContentsStream,
  ArchiveError,
} from "../write/carchive-validate.js";
import { saveRealFla } from "../write/fla-write.js";
import { __readAllStreamsForTest } from "../ole.js";
import { createDocument, createDocumentProperties } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import { createLayer, createFrame } from "../../model/timeline.js";
import { createSymbol } from "../../model/library.js";
import type { FlashDocument } from "../../model/types.js";
import type { ShapeDisplayObject, SymbolInstance } from "../../engine/types.js";
import { FLA8_FIXTURE_SKIP_REASON, hasValidFla8Fixture } from "./fla8-fixture.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../../../../../fixtures");

const FLA8_PRESENT = hasValidFla8Fixture();

function streamsOf(path: string): Map<string, Uint8Array> {
  return __readAllStreamsForTest(new Uint8Array(readFileSync(path)));
}

describe("gate 2 — validator faithfulness against real fixtures", () => {
  // Guarded on a VALID flash8-empty.fla. Restoring the real binary re-enables this
  // at full strength (skip reason: FLA8_FIXTURE_SKIP_REASON).
  (FLA8_PRESENT ? it : it.skip)(
    FLA8_PRESENT ? "parses flash8-empty.fla Contents + Page 1 cleanly" : FLA8_FIXTURE_SKIP_REASON,
    () => {
      const s = streamsOf(resolve(fixtures, "flash8-empty.fla"));
      const c = validateContentsStream(s.get("Contents")!);
      expect(c.documentPages).toBe(1); // one scene
      const t = validateTimelineStream(s.get("Page 1")!);
      expect(t.classes).toContain("CPicPage");
      expect(t.classes).toContain("CPicLayer");
      expect(t.layerCount).toBeGreaterThanOrEqual(1);
    },
  );

  it("parses evaporatingdrip.fla Contents + timeline streams cleanly", () => {
    const s = streamsOf(resolve(fixtures, "evaporatingdrip.fla"));
    const c = validateContentsStream(s.get("Contents")!);
    expect(c.documentPages).toBeGreaterThanOrEqual(1);
    for (const name of ["Page 1", "Symbol 1", "Symbol 4"]) {
      const t = validateTimelineStream(s.get(name)!);
      expect(t.classes).toContain("CPicPage");
    }
  });

  it("rejects a stream with a bad root marker", () => {
    expect(() => validateTimelineStream(new Uint8Array([0x99, 0xff, 0xff]))).toThrow(ArchiveError);
  });

  it("rejects a stream whose first tag is not a class declaration", () => {
    // root 0x01, then an invalid tag word 0x0005 at the object boundary.
    expect(() => validateTimelineStream(new Uint8Array([0x01, 0x05, 0x00]))).toThrow(ArchiveError);
  });

  it("rejects a backref to an undeclared class index", () => {
    // root 0x01, then a backref tag 0x8005 with no class declared.
    expect(() => validateTimelineStream(new Uint8Array([0x01, 0x05, 0x80]))).toThrow(ArchiveError);
  });

  it("rejects Contents with a wrong contentsVersion", () => {
    const bad = new Uint8Array(40);
    bad[0] = 0x49; // wrong (stub) version
    bad[1] = 0x01;
    expect(() => validateContentsStream(bad)).toThrow(ArchiveError);
  });
});

// ---------------------------------------------------------------------------
// Generated documents
// ---------------------------------------------------------------------------

function validateAllStreams(doc: FlashDocument): { contents: ReturnType<typeof validateContentsStream> } {
  const streams = __readAllStreamsForTest(saveRealFla(doc));
  const contents = validateContentsStream(streams.get("Contents")!);
  for (const [name, bytes] of streams) {
    if (name.startsWith("Page ") || name.startsWith("Symbol ")) {
      validateTimelineStream(bytes);
    }
  }
  return { contents };
}

describe("gate 2 — validator parses saveRealFla(doc) for content cases", () => {
  it("empty doc", () => {
    const { contents } = validateAllStreams(createDocument());
    expect(contents.documentPages).toBe(1);
  });

  it("1 scene + 1 layer + a solid-fill rectangle", () => {
    const rect: ShapeDisplayObject = {
      type: "shape",
      id: "rect",
      x: 100,
      y: 50,
      shape: {
        id: "g",
        paths: [
          {
            start: { x: 0, y: 0 },
            segments: [
              { type: "line", to: { x: 80, y: 0 } },
              { type: "line", to: { x: 80, y: 60 } },
              { type: "line", to: { x: 0, y: 60 } },
              { type: "line", to: { x: 0, y: 0 } },
            ],
            fill: { type: "solid", color: { r: 0xff, g: 0x00, b: 0x00, a: 0xff } },
            closed: true,
          },
        ],
      },
    };
    const layer = createLayer("Layer 1", "normal", {
      frames: [createFrame(0, { isEmpty: false, displayObjects: [rect] })],
      frameCount: 1,
    });
    const doc = createDocument({ scenes: [createScene("Scene 1", { timeline: { layers: [layer] } })] });
    const { contents } = validateAllStreams(doc);
    expect(contents.documentPages).toBe(1);
  });

  it("a movieclip symbol + instance", () => {
    const sym = createSymbol("MC", "movieclip");
    const instance: SymbolInstance = {
      type: "instance",
      id: "i1",
      symbolId: sym.id,
      x: 10,
      y: 20,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      instanceName: "mc1",
      loopMode: "loop",
      firstFrame: 0,
      blendMode: "normal",
    } as SymbolInstance;
    const layer = createLayer("Layer 1", "normal", {
      frames: [createFrame(0, { isEmpty: false, displayObjects: [instance] })],
      frameCount: 1,
    });
    const doc = createDocument({
      scenes: [createScene("Scene 1", { timeline: { layers: [layer] } })],
      library: { items: [sym], folders: [] },
    });
    const { contents } = validateAllStreams(doc);
    expect(contents.documentPages).toBe(2); // 1 scene + 1 symbol
  });

  it("a 2-scene doc", () => {
    const doc = createDocument({
      properties: createDocumentProperties(),
      scenes: [createScene("Scene 1"), createScene("Scene 2")],
    });
    const { contents } = validateAllStreams(doc);
    expect(contents.documentPages).toBe(2);
  });
});
