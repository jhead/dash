/**
 * Simple standalone encoder for DefineButton2 (SWF tag 34).
 *
 * This module provides a low-level `encodeButton2` function that takes pre-
 * resolved character IDs for each button state and produces the raw tag body
 * bytes. It is complementary to the higher-level `encodeDefineButton2` in
 * buttons.ts (which resolves character IDs from a FlashDocument).
 *
 * DefineButton2 body structure:
 *   UI16  ButtonId
 *   UI8   ReservedFlags[7] + TrackAsMenu[1]  (0x00 = normal button)
 *   UI16  ActionOffset  (0 = no button conditions)
 *   ButtonRecord[]  (null-terminated with a 0x00 byte)
 *   UI8   0x00  (end of ButtonRecord array)
 *
 * Each ButtonRecord:
 *   UI8   buttonStates  bitmask: 0x08=hitTest, 0x04=down, 0x02=over, 0x01=up
 *   UI16  characterId
 *   UI16  depth         (1-based placement depth)
 *   MATRIX              (identity — no transform)
 *   CXFORMWITHALPHA     (identity — no color transform)
 */
import { BitWriter } from "./bits.js";
import { encodeCxformWithAlpha } from "./cxform.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Encode a SWF identity MATRIX (no scale, no rotate, translate 0,0). */
function encodeIdentityMatrix(): Uint8Array {
  const bw = new BitWriter();
  // hasScale = 0
  bw.writeBits(0, 1);
  // hasRotate = 0
  bw.writeBits(0, 1);
  // nTranslateBits (UB[5]) = 1 (minimum non-zero)
  bw.writeBits(1, 5);
  // translateX = 0 (SB[1])
  bw.writeBits(0, 1);
  // translateY = 0 (SB[1])
  bw.writeBits(0, 1);
  bw.flushBits();
  return bw.getBytes();
}

/** Encode an identity CXFORMWITHALPHA (no multiply change, no add change). */
function encodeIdentityCxform(): Uint8Array {
  return encodeCxformWithAlpha(256, 256, 256, 256, 0, 0, 0, 0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a DefineButton2 (tag 34) tag *body* from pre-resolved character IDs.
 *
 * Each entry in `states` is an array of SWF character IDs to display in that
 * button state. Characters are placed at sequential depths (1-based), one
 * ButtonRecord per character per state.
 *
 * @param buttonId - SWF character ID to assign to this button (UI16).
 * @param states   - Object with optional arrays of character IDs per state.
 * @returns Raw bytes of the DefineButton2 tag body (without the record header).
 *
 * @example
 * const body = encodeButton2(5, { up: [3], over: [4], down: [4], hit: [3] });
 */
export function encodeButton2(
  buttonId: number,
  states: {
    up?: number[];     // characterIds for Up state   (frame 0)
    over?: number[];   // characterIds for Over state  (frame 1)
    down?: number[];   // characterIds for Down state  (frame 2)
    hit?: number[];    // characterIds for Hit state   (frame 3)
  }
): Uint8Array {
  const bw = new BitWriter();

  // ButtonId
  bw.writeUI16LE(buttonId);

  // ReservedFlags[7] + TrackAsMenu[1] = 0x00 (normal button)
  bw.writeUI8(0x00);

  // ActionOffset: 0 = no button conditions
  bw.writeUI16LE(0);

  // ---------------------------------------------------------------------------
  // Build ButtonRecords.
  // A character may appear in multiple states; we emit one record per
  // (state, characterId, depth) triple, collecting all state bits.
  // ---------------------------------------------------------------------------
  const STATE_UP   = 0x01;
  const STATE_OVER = 0x02;
  const STATE_DOWN = 0x04;
  const STATE_HIT  = 0x08;

  interface RecordKey { charId: number; depth: number }
  // Map from "charId:depth" → accumulated state flags
  const recordMap = new Map<string, RecordKey & { flags: number }>();

  function addState(charIds: number[] | undefined, stateBit: number): void {
    if (!charIds) return;
    charIds.forEach((charId, idx) => {
      const depth = idx + 1; // 1-based depth
      const key = `${charId}:${depth}`;
      const existing = recordMap.get(key);
      if (existing) {
        existing.flags |= stateBit;
      } else {
        recordMap.set(key, { charId, depth, flags: stateBit });
      }
    });
  }

  addState(states.up,   STATE_UP);
  addState(states.over, STATE_OVER);
  addState(states.down, STATE_DOWN);
  addState(states.hit,  STATE_HIT);

  // Emit ButtonRecords
  for (const { charId, depth, flags } of recordMap.values()) {
    bw.writeUI8(flags);
    bw.writeUI16LE(charId);
    bw.writeUI16LE(depth);
    bw.writeBytes(encodeIdentityMatrix());
    bw.writeBytes(encodeIdentityCxform());
  }

  // Null terminator: end of ButtonRecord array
  bw.writeUI8(0x00);

  return bw.getBytes();
}
