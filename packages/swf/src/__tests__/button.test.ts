/**
 * Unit tests for swf/src/button.ts — encodeButton2 function.
 *
 * Tests the low-level standalone encoder that takes pre-resolved character IDs
 * and returns the raw DefineButton2 tag body bytes.
 */

import { describe, it, expect } from "vitest";
import { encodeButton2 } from "../button.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a little-endian UI16 from a Uint8Array at the given offset. */
function readUI16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("encodeButton2", () => {
  it("returns a Uint8Array", () => {
    const result = encodeButton2(1, {});
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("first 2 bytes are the button character ID (little-endian)", () => {
    const result = encodeButton2(42, {});
    expect(readUI16LE(result, 0)).toBe(42);
  });

  it("first 2 bytes encode character ID 1 correctly", () => {
    const result = encodeButton2(1, {});
    expect(result[0]).toBe(0x01);
    expect(result[1]).toBe(0x00);
  });

  it("first 2 bytes encode larger character IDs correctly (little-endian)", () => {
    // buttonId = 0x0102 → bytes [0x02, 0x01]
    const result = encodeButton2(0x0102, {});
    expect(result[0]).toBe(0x02);
    expect(result[1]).toBe(0x01);
  });

  it("byte 2 is 0x00 (trackAsMenu = 0, normal button)", () => {
    const result = encodeButton2(1, {});
    expect(result[2]).toBe(0x00);
  });

  it("bytes 3-4 are ActionOffset = 0 (little-endian, no button conditions)", () => {
    const result = encodeButton2(1, {});
    expect(readUI16LE(result, 3)).toBe(0);
  });

  it("buffer ends with 0x00 (ButtonRecord array null terminator)", () => {
    const result = encodeButton2(1, {});
    expect(result[result.length - 1]).toBe(0x00);
  });

  it("empty states: body is 6 bytes (UI16 + UI8 + UI16 + 0x00 terminator)", () => {
    // 2 (ButtonId) + 1 (trackAsMenu) + 2 (ActionOffset) + 1 (terminator) = 6
    const result = encodeButton2(1, {});
    expect(result.length).toBe(6);
  });

  it("with one up-state character, buffer has a ButtonRecord with flags=0x01", () => {
    // ButtonRecord starts at offset 5
    // flags byte: bit0 = StateUp
    const result = encodeButton2(3, { up: [7] });
    const flagsByte = result[5];
    expect(flagsByte).toBe(0x01); // StateUp bit set only
  });

  it("with one up-state character, ButtonRecord has correct characterId", () => {
    // ButtonRecord at offset 5: flags(1) + charId(2) + depth(2) + matrix + cxform
    const result = encodeButton2(3, { up: [7] });
    const charId = readUI16LE(result, 6); // offset 6 = after flags byte
    expect(charId).toBe(7);
  });

  it("with one over-state character, flags = 0x02 (StateOver)", () => {
    const result = encodeButton2(1, { over: [5] });
    const flagsByte = result[5];
    expect(flagsByte & 0x02).toBe(0x02); // StateOver bit set
    expect(flagsByte & 0x01).toBe(0);    // StateUp not set
  });

  it("with one down-state character, flags = 0x04 (StateDown)", () => {
    const result = encodeButton2(1, { down: [5] });
    const flagsByte = result[5];
    expect(flagsByte & 0x04).toBe(0x04);
    expect(flagsByte & 0x01).toBe(0);
  });

  it("with one hit-state character, flags = 0x08 (StateHitTest)", () => {
    const result = encodeButton2(1, { hit: [5] });
    const flagsByte = result[5];
    expect(flagsByte & 0x08).toBe(0x08);
    expect(flagsByte & 0x01).toBe(0);
  });

  it("body still ends with 0x00 when records are present", () => {
    const result = encodeButton2(1, { up: [3], over: [4] });
    expect(result[result.length - 1]).toBe(0x00);
  });

  it("multiple states with same charId+depth accumulate flags in one record", () => {
    // charId=3 at depth=1 in both Up and Over → one record with flags=0x03
    const result = encodeButton2(1, { up: [3], over: [3] });
    const flagsByte = result[5];
    expect(flagsByte & 0x01).toBe(0x01); // StateUp
    expect(flagsByte & 0x02).toBe(0x02); // StateOver
  });

  it("buttonId = 0 is encoded correctly", () => {
    const result = encodeButton2(0, {});
    expect(readUI16LE(result, 0)).toBe(0);
  });

  it("buttonId = 65535 (max UI16) is encoded correctly", () => {
    const result = encodeButton2(65535, {});
    expect(readUI16LE(result, 0)).toBe(65535);
  });
});
