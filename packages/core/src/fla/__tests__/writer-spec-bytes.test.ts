/**
 * Spec-exact byte assertions for the binary FLA writer, pinned to the REAL Flash 8
 * on-disk form (docs/21-fla-binary-format.md §8/§10, verified against
 * fixtures/flash8-empty.fla). These guard the records the spec marks "Verified":
 * the §8.1 preamble (contentsVersion 0x3F), the §8.4 stage block, a §8.2
 * CDocumentPage scene record, and the §10.1 timeline root + CPicPage declaration.
 *
 * (These replace the prior assertions, which codified the old stub's wrong bytes:
 * contentsVersion 0x49, grid #949494, CPicPage schema 4, gridSpacing 200.)
 */

import { describe, it, expect } from "vitest";
import { writeContents } from "../write/contents-write.js";
import { writeTimelineStream, type WriteIndex } from "../write/timeline-write.js";
import { createLayer, createFrame } from "../../model/timeline.js";
import type { Timeline } from "../../model/types.js";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

const EMPTY_INDEX: WriteIndex = {
  symbolNumById: new Map(),
  mediaNumById: new Map(),
  symbolTypeById: new Map(),
};

const baseInput = {
  formatVersion: 0x49, // ignored by the writer; real contentsVersion 0x3F is emitted
  widthPx: 550,
  heightPx: 400,
  frameRate: 24,
  backgroundHex: "#336699",
  gridHex: "#c0c0c0",
  gridSpacingPx: 18,
  symbols: [],
  media: [],
};

describe("writer spec bytes — Contents §8.1 preamble", () => {
  it("emits the 23-byte Flash 8 preamble: contentsVersion 0x3F, contentsVersionB 1, then 21 zeros", () => {
    const c = writeContents({ ...baseInput, scenes: [] });
    expect(hex(c.slice(0, 23))).toBe(
      "3f 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    );
  });
});

describe("writer spec bytes — Contents §8.2 CDocumentPage scene record", () => {
  it("emits NEWCLASS CDocumentPage (schema 1) + version 0x17 + 'Page 1' String + 'Scene 1' BomString + trailer", () => {
    const c = writeContents({
      ...baseInput,
      scenes: [{ pageStreamName: "Page 1", sceneName: "Scene 1" }],
    });
    // The scene record immediately follows the 23-byte preamble.
    const rec = c.slice(23);
    expect(hex(rec.slice(0, 19 + 1 + 13 + 18 + 5 + 4))).toBe(
      [
        "ff ff 01 00 0d 00", //                 NEWCLASS, schema 1, namelen 13
        "43 44 6f 63 75 6d 65 6e 74 50 61 67 65", // "CDocumentPage"
        "17", //                                documentPageVersion
        "06", //                                pageName String length 6
        "50 00 61 00 67 00 65 00 20 00 31 00", // "Page 1" UTF-16LE
        "ff fe ff 07", //                       BomString marker + length 7
        "53 00 63 00 65 00 6e 00 65 00 20 00 31 00", // "Scene 1" UTF-16LE
        "00 00 00 00 00", //                    symbolId u16, reserved u16, symbolType u8
        "ff fe ff 00", //                       empty BomString
      ]
        .join(" ")
        .replace(/\s+/g, " "),
    );
  });
});

describe("writer spec bytes — Contents §8.4 stage block", () => {
  it("emits the byte-exact stage block for a 550x400@24 #336699 doc (grid #c0c0c0)", () => {
    const c = writeContents({ ...baseInput, scenes: [] });
    // With no scenes, the stage block begins right after the 23-byte preamble.
    const block = c.slice(23, 23 + 75);
    expect(hex(block)).toBe(
      [
        "05 00 00 00", //                       rulerUnitType=pixels(5), 00, gridVisible=0, 00
        "00 00 00", //                          skip(3)
        "f8 2a", //                             width*20 = 11000
        "00 00 00 00 00 00", //                 skip(6)
        "40 1f", //                             height*20 = 8000
        "00 00 00 00", //                       skip(4)
        "68 01", //                             gridSpacingX*20 = 360 (18 px)
        "03 00 00", //                          previewMode=3, rulerVisible=0, pageTabs=0
        "8d", //                                playOptions<<4|viewOptions (Flash 8 default)
        "00 68 01 00 00 68 01 00 00 68 01 00 00 68 01 00 00 01 01 00 00 00 00 01 00 00 00 00 00",
        "33 66 99 ff", //                       background #336699 + 0xFF
        "c0 c0 c0", //                          grid color #c0c0c0
        "ff", //                                @+63
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

describe("writer spec bytes — §10.1 timeline root + CPicPage", () => {
  it("emits root marker 0x01 + NEWCLASS CPicPage (schema 1) + pageVersion 0x04 0x00", () => {
    const timeline: Timeline = {
      layers: [
        createLayer("Layer 1", "normal", {
          frames: [createFrame(0)],
          frameCount: 1,
        }),
      ],
    };
    const stream = writeTimelineStream(timeline, EMPTY_INDEX);
    // 0x01 root, FFFF, schema u16=1, namelen u16=8, "CPicPage", then 04 00.
    expect(hex(stream.slice(0, 17))).toBe(
      "01 ff ff 01 00 08 00 43 50 69 63 50 61 67 65 04 00",
    );
  });
});
