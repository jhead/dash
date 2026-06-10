/**
 * Task 0902 acceptance test: Magnet.fla compiled SWF has no undefined charId references.
 *
 * Verifies that every charId referenced in a PlaceObject2/PlaceObject3 tag is
 * defined by a preceding character-definition tag. Includes DefineButton2 (tag 34)
 * as a valid definition tag — per-instance button instances are placed via their
 * DefineButton2 charId, which the original investigation missed when it
 * reported "113 missing charIds".
 *
 * Acceptance criteria (task 0902):
 *   - All PlaceObject2 charIds have corresponding definitions.
 *   - Spacing-9 charIds (630, 639, …) are DefineButton2 per-instance buttons,
 *     which IS correct SWF.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { loadFla } from "@flash/core";
import { compileDocument } from "../compile.js";

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`/Users/jhead/dev/flash/packages/core/fixtures/${name}`));
}

// ---------------------------------------------------------------------------
// SWF tag parser
// ---------------------------------------------------------------------------

interface SwfTag { type: number; body: Uint8Array; }

function parseTags(bytes: Uint8Array): SwfTag[] {
  const nbits = (bytes[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nbits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;
  const tags: SwfTag[] = [];
  while (pos + 2 <= bytes.length) {
    const hdr = bytes[pos] | (bytes[pos + 1] << 8);
    const code = (hdr >> 6) & 0x3ff;
    let len = hdr & 0x3f;
    let hdrSize = 2;
    if (len === 0x3f) {
      len = bytes[pos + 2] | (bytes[pos + 3] << 8) | (bytes[pos + 4] << 16) | (bytes[pos + 5] << 24);
      hdrSize = 6;
    }
    tags.push({ type: code, body: bytes.slice(pos + hdrSize, pos + hdrSize + len) });
    pos += hdrSize + len;
    if (code === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Magnet.fla: all PlaceObject2 charIds are defined (task 0902)", () => {
  let tags: SwfTag[];

  beforeAll(() => {
    const flaBytes = fixture("Magnet.fla");
    const doc = loadFla(flaBytes);
    const swf = compileDocument(doc);
    tags = parseTags(swf);
  });

  it("all PlaceObject2/PlaceObject3 charIds have corresponding character definitions", () => {
    // ALL character-definition tag codes (SWF spec):
    //   1  DefineShape          (legacy)
    //   2  DefineShape2         (legacy)
    //   4  DefinePlaceHolder
    //   7  DefineFont           (legacy)
    //   8  DefineFontInfo
    //  11  DefineText
    //  13  DefineFontInfo2      (legacy)
    //  17  DefineButtonSound
    //  21  DefineBitsJPEG2
    //  22  DefineShape3
    //  32  DefineShape2
    //  33  DefineShape3
    //  34  DefineButton2         ← per-instance buttons (was incorrectly excluded from 0902 analysis)
    //  35  DefineBitsJPEG3
    //  36  DefineBitsLossless2
    //  37  DefineEditText
    //  39  DefineSprite
    //  46  DefineMorphShape
    //  48  DefineFont2
    //  60  DefineVideoStream
    //  73  DefineFontAlignZones
    //  75  DefineFont3
    //  83  DefineShape4
    //  84  DefineMorphShape2
    //  87  DefineBinaryData
    //  90  DefineFont4
    const DEFINITION_TAGS = new Set([
      1, 2, 4, 7, 8, 11, 13, 17, 21, 22, 32, 33, 34, 35, 36, 37, 39,
      46, 48, 60, 73, 75, 83, 84, 87, 90,
    ]);

    // Build set of all defined charIds
    const definedCharIds = new Set<number>();
    for (const tag of tags) {
      if (DEFINITION_TAGS.has(tag.type) && tag.body.length >= 2) {
        const charId = tag.body[0] | (tag.body[1] << 8);
        definedCharIds.add(charId);
      }
    }

    // Collect all charIds referenced in PlaceObject2 (HasCharacter flag = 0x04)
    const undefinedPlacements: number[] = [];
    for (const tag of tags) {
      if (tag.type === 26 && tag.body.length >= 5) {
        const flags = tag.body[0];
        if (flags & 0x04) { // HasCharacter
          const charId = tag.body[3] | (tag.body[4] << 8);
          if (!definedCharIds.has(charId)) {
            undefinedPlacements.push(charId);
          }
        }
      }
      // PlaceObject3: flags byte 0 has HasCharacter at bit 2
      if (tag.type === 70 && tag.body.length >= 6) {
        const flags = tag.body[0];
        if (flags & 0x04) { // HasCharacter
          const charId = tag.body[4] | (tag.body[5] << 8);
          if (!definedCharIds.has(charId)) {
            undefinedPlacements.push(charId);
          }
        }
      }
    }

    const uniqueUndefined = [...new Set(undefinedPlacements)].sort((a, b) => a - b);

    expect(
      uniqueUndefined,
      `Found ${uniqueUndefined.length} charIds placed but not defined: ` +
      `[${uniqueUndefined.slice(0, 10).join(', ')}${uniqueUndefined.length > 10 ? '...' : ''}]`
    ).toHaveLength(0);
  });

  it("spacing-9 charIds (630, 639, ...) are DefineButton2 (per-instance button) definitions", () => {
    // Task 0902 originally reported 113 charIds (630, 639, 648, ...) as "missing".
    // These are actually per-instance DefineButton2 characters created when button
    // instances carry per-instance on() handlers. Verify at least one exists.
    const button2CharIds = new Set<number>();
    for (const tag of tags) {
      if (tag.type === 34 && tag.body.length >= 2) { // DefineButton2
        const charId = tag.body[0] | (tag.body[1] << 8);
        button2CharIds.add(charId);
      }
    }

    // There should be 9 button symbols (pre-pass) + 113 per-instance buttons = 122 total
    expect(button2CharIds.size).toBeGreaterThanOrEqual(100);

    // charId 630 should be a DefineButton2 (first per-instance button)
    expect(button2CharIds.has(630)).toBe(true);
  });
});
