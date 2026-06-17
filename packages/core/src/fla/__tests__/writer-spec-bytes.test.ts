/**
 * Spec-exact byte assertions for the binary FLA writer.
 *
 * Unlike the round-trip tests (which only prove writer<->importer consistency),
 * these pin specific byte sequences DERIVED FROM docs/21-fla-binary-format.md
 * and the flacomdoc reference (FlaConverter.writeStage / CDocumentPage / shape
 * records). They are the byte-fidelity guard for the records the spec marks
 * "Verified": the §8.1 preamble, the §8.4 stage block, a §8.2 CDocumentPage
 * scene record, and a simple §12 shape keyframe.
 */

import { describe, it, expect } from "vitest";
import { writeContents } from "../write/contents-write.js";
import { writeTimelineStream, type WriteIndex } from "../write/timeline-write.js";
import { createLayer, createFrame } from "../../model/timeline.js";
import type { Timeline } from "../../model/types.js";
import type { ShapeDisplayObject } from "../../engine/types.js";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

const EMPTY_INDEX: WriteIndex = {
  symbolNumById: new Map(),
  mediaNumById: new Map(),
  symbolTypeById: new Map(),
};

describe("writer spec bytes — Contents §8.1 preamble", () => {
  it("emits the 23-byte Flash 8 preamble: formatVersion, contentsVersionB=1, then 21 zeros", () => {
    const c = writeContents({
      formatVersion: 0x49,
      widthPx: 550,
      heightPx: 400,
      frameRate: 24,
      backgroundHex: "#336699",
      scenes: [],
      symbols: [],
      media: [],
    });
    // §8.1: contentsVersion(0x49) contentsVersionB(1) skip(3) F3-skip(1) F4-skip(1)
    //       + u32 0 x4 (F5/MX/MX2004/F8) = 23 bytes.
    expect(hex(c.slice(0, 23))).toBe(
      "49 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    );
  });
});

describe("writer spec bytes — Contents §8.4 stage block (flacomdoc FlaConverter.writeStage)", () => {
  it("emits the byte-exact stage + document-properties block for a 550x400@24 #336699 doc", () => {
    const c = writeContents({
      formatVersion: 0x49,
      widthPx: 550,
      heightPx: 400,
      frameRate: 24,
      backgroundHex: "#336699",
      scenes: [],
      symbols: [],
      media: [],
    });
    // The stage block begins at @+23 (right after the preamble) and ends at the
    // `00 03 b4 00 00 00` anchor. Derived field-by-field from §8.4 + flacomdoc.
    const block = c.slice(23, 23 + 75);
    expect(hex(block)).toBe(
      [
        "05 00 00 00", //                       rulerUnitType=pixels(5), 00, gridVisible=0, 00
        "00 00 00", //                          skip(3)
        "f8 2a", //                             width*20 = 11000 (0x2af8)
        "00 00 00 00 00 00", //                 skip(6)
        "40 1f", //                             height*20 = 8000 (0x1f40)
        "00 00 00 00", //                       skip(4)
        "c8 00", //                             gridSpacingX*20 = 200 (0x00c8)
        "03 00 00", //                          previewMode=3(anti-alias text), rulerVisible=0, pageTabsVisible=0
        "f5", //                                (playOptions<<4)|viewOptions = (15<<4)|5
        "00 68 01 00 00 68 01 00 00 68 01 00 00 68 01 00 00 01 01 00 00 00 00 01 00 00 00 00 00", // 29-byte const run
        "33 66 99 ff", //                       background #336699 + 0xFF
        "94 94 94 ff", //                       grid color #949494 + 0xFF
        "00", //                                @+64
        "00 18", //                             fps 8.8: frac=0, int=0x18 (24)
        "00 00", //                             @+67
        "00 03 b4 00 00 00", //                 trailing anchor
      ]
        .join(" ")
        .replace(/\s+/g, " "),
    );
  });
});

describe("writer spec bytes — Contents §8.2 CDocumentPage scene record", () => {
  it("emits documentPageVersion 0x17 + 'Page 1' String + 'Scene 1' BomString + scene trailer", () => {
    const c = writeContents({
      formatVersion: 0x49,
      widthPx: 550,
      heightPx: 400,
      frameRate: 24,
      backgroundHex: "#336699",
      scenes: [{ pageStreamName: "Page 1", sceneName: "Scene 1" }],
      symbols: [],
      media: [],
    });
    // The scene record follows the stage anchor (preamble 23 + block 75 = @98).
    const rec = c.slice(98);
    expect(hex(rec.slice(0, 37))).toBe(
      [
        "17", //                                documentPageVersion = 0x17
        "06", //                                String length = 6 ("Page 1")
        "50 00 61 00 67 00 65 00 20 00 31 00", // "Page 1" UTF-16LE
        "ff fe ff", //                          BomString marker
        "07", //                                length = 7 ("Scene 1")
        "53 00 63 00 65 00 6e 00 65 00 20 00 31 00", // "Scene 1" UTF-16LE
        "00 00", //                             symbolId = 0
        "00 00", //                             reserved u16 = 0
        "00", //                                symbolType = 0 (scene)
      ]
        .join(" ")
        .replace(/\s+/g, " "),
    );
  });
});

describe("writer spec bytes — §12 shape keyframe", () => {
  it("emits the timeline root marker + CPicPage class declaration", () => {
    const shape: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      x: 0,
      y: 0,
      shape: {
        id: "g1",
        paths: [
          {
            start: { x: 0, y: 0 },
            segments: [
              { type: "line", to: { x: 10, y: 0 } },
              { type: "line", to: { x: 10, y: 10 } },
              { type: "line", to: { x: 0, y: 0 } },
            ],
            fill: { type: "solid", color: { r: 0x12, g: 0x34, b: 0x56, a: 0xff } },
            closed: true,
          },
        ],
      },
    };
    const timeline: Timeline = {
      layers: [
        createLayer("Layer 1", "normal", {
          frames: [createFrame(0, { isEmpty: false, displayObjects: [shape] })],
          frameCount: 1,
        }),
      ],
    };
    const stream = writeTimelineStream(timeline, EMPTY_INDEX);
    // §9/§10.1: leading 0x01 root marker, then a CArchive new-class tag (0xFFFF),
    // schema u16=4, name length u16=8, "CPicPage" ASCII.
    expect(hex(stream.slice(0, 15))).toBe("01 ff ff 04 00 08 00 43 50 69 63 50 61 67 65");
  });

  it("encodes a solid fill style as RGBA + 0x00 0x00 (discriminator byte clear => solid, §12.1)", () => {
    const shape: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      x: 0,
      y: 0,
      shape: {
        id: "g1",
        paths: [
          {
            start: { x: 0, y: 0 },
            segments: [{ type: "line", to: { x: 10, y: 0 } }],
            fill: { type: "solid", color: { r: 0x12, g: 0x34, b: 0x56, a: 0xff } },
            closed: false,
          },
        ],
      },
    };
    const timeline: Timeline = {
      layers: [
        createLayer("Layer 1", "normal", {
          frames: [createFrame(0, { isEmpty: false, displayObjects: [shape] })],
          frameCount: 1,
        }),
      ],
    };
    const stream = writeTimelineStream(timeline, EMPTY_INDEX);
    // The solid fill RGBA 12 34 56 ff followed by the 0x00 (type/discriminator)
    // and 0x00 must appear verbatim in the shape body.
    const needle = [0x12, 0x34, 0x56, 0xff, 0x00, 0x00];
    let found = false;
    for (let i = 0; i + needle.length <= stream.length; i++) {
      if (needle.every((v, j) => stream[i + j] === v)) {
        found = true;
        // The byte at @+4 (discriminator) is clear of 0x10/0x40 => solid.
        expect(stream[i + 4]! & 0x10).toBe(0);
        expect(stream[i + 4]! & 0x40).toBe(0);
        break;
      }
    }
    expect(found).toBe(true);
  });
});
