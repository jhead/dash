/**
 * SWF DefineButton2 (tag 34) encoding for Button symbols.
 *
 * A button symbol has a timeline with up to 4 frames representing states:
 *   Frame 0 = Up state
 *   Frame 1 = Over state
 *   Frame 2 = Down state
 *   Frame 3 = Hit state  (defines clickable area)
 *
 * DefineButton2 tag body structure:
 *   ButtonId: UI16
 *   ReservedFlags (7) + TrackAsMenu (1): UI8
 *   ActionOffset: UI16  (0 = no button conditions)
 *   ButtonRecords: repeated until null record (all state bits = 0)
 *     each record: 1 byte flags, CharId UI16, Depth UI16, MATRIX, CXFORMWITHALPHA
 *   ButtonConditions (optional, none emitted for MVP)
 */
import type { BitmapItem, FlashDocument, Symbol } from "@flash/core";
import { compileAS2 } from "@flash/core";
import { BitWriter } from "./bits.js";
import { encodeCxformWithAlpha } from "./cxform.js";
import { encodeDefineShape4, encodeBitmapFillShape } from "./shapes.js";
import { encodeDefineEditText } from "./text.js";
import { Tag } from "./tags.js";
import { dataUriToBytes } from "./bitmaps.js";

// ---------------------------------------------------------------------------
// Identity MATRIX helper
// ---------------------------------------------------------------------------

/**
 * Encode a SWF identity MATRIX (no scale, no rotate, translate (0,0)).
 * hasScale=0, hasRotate=0, nTranslateBits=1, translateX=0, translateY=0 → flushed.
 */
function encodeIdentityMatrix(): Uint8Array {
  const bw = new BitWriter();
  // hasScale = 0
  bw.writeBits(0, 1);
  // hasRotate = 0
  bw.writeBits(0, 1);
  // nTranslateBits (UB[5]) = 1 (minimum)
  bw.writeBits(1, 5);
  // translateX = 0 (SB[1])
  bw.writeBits(0, 1);
  // translateY = 0 (SB[1])
  bw.writeBits(0, 1);
  bw.flushBits();
  return bw.getBytes();
}

/**
 * Encode an identity CXFORMWITHALPHA (no mult change, no add change).
 */
function encodeIdentityCxform(): Uint8Array {
  return encodeCxformWithAlpha(256, 256, 256, 256, 0, 0, 0, 0);
}

// ---------------------------------------------------------------------------
// ButtonRecord builder
// ---------------------------------------------------------------------------

/**
 * Build a single ButtonRecord byte array for a given display object in a state.
 *
 * ButtonRecord flags byte layout (SWF spec, bit7..bit0):
 *   bit7-6: ButtonReserved = 0
 *   bit5:   ButtonHasBlendMode = 0
 *   bit4:   ButtonHasFilterList = 0
 *   bit3:   ButtonStateHitTest
 *   bit2:   ButtonStateDown
 *   bit1:   ButtonStateOver
 *   bit0:   ButtonStateUp
 *
 * After flags:
 *   CharacterId: UI16
 *   PlaceDepth: UI16
 *   PlaceMatrix: MATRIX
 *   ColorTransform: CXFORMWITHALPHA  (DefineButton2 only)
 */
function buildButtonRecord(
  stateUp: boolean,
  stateOver: boolean,
  stateDown: boolean,
  stateHit: boolean,
  charId: number,
  depth: number
): Uint8Array {
  const bw = new BitWriter();

  const flags =
    (stateHit ? 0x08 : 0) |
    (stateDown ? 0x04 : 0) |
    (stateOver ? 0x02 : 0) |
    (stateUp ? 0x01 : 0);
  bw.writeUI8(flags);

  bw.writeUI16LE(charId);
  bw.writeUI16LE(depth);
  bw.writeBytes(encodeIdentityMatrix());
  bw.writeBytes(encodeIdentityCxform());

  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a DefineButton2 (tag 34) tag *body* for a button symbol.
 *
 * Follows the same hoisting pattern as encodeDefineSprite: shape/text/bitmap
 * definition tags are pushed into `hoistedDefs` and must be emitted at the
 * SWF top level *before* the DefineButton2 tag.
 *
 * @param buttonCharId  SWF character ID assigned to this button
 * @param symbol        The Symbol with symbolType='button'
 * @param doc           Full FlashDocument (for resolving BitmapItem library items)
 * @param charIdMap     Maps symbolId → SWF charId (for nested symbol instances)
 * @param nextCharId    Allocate new character IDs for shapes inside this button
 * @param hoistedDefs   Out-parameter: definition tags to emit at top level before this button
 * @returns             Raw bytes of the DefineButton2 tag body (without record header).
 */
export function encodeDefineButton2(
  buttonCharId: number,
  symbol: Symbol,
  doc: FlashDocument,
  charIdMap: Map<string, number>,
  nextCharId: () => number,
  hoistedDefs: Array<{ tagType: number; body: Uint8Array }>
): Uint8Array {
  const bw = new BitWriter();

  // ButtonId
  bw.writeUI16LE(buttonCharId);

  // ReservedFlags[7] + TrackAsMenu[1] = 0x00 (normal button)
  bw.writeUI8(0x00);

  const layers = symbol.timeline.layers;

  // ---------------------------------------------------------------------------
  // Pre-pass: assign character IDs for all shapes/text/bitmaps and collect
  // hoisted definition tags (same pattern as encodeDefineSprite).
  // ---------------------------------------------------------------------------
  const objCharIdMap = new Map<string, number>();

  for (const layer of layers) {
    for (const frame of layer.frames) {
      // Do not skip on isEmpty — the flag can be stale; iterate displayObjects directly.
      if (!frame.isKeyframe) continue;
      for (const obj of frame.displayObjects) {
        if (objCharIdMap.has(obj.id)) continue;

        if (obj.type === "shape" || obj.type === "drawing-object") {
          const cid = nextCharId();
          objCharIdMap.set(obj.id, cid);
          hoistedDefs.push({
            tagType: Tag.DefineShape4,
            body: encodeDefineShape4(cid, obj.shape),
          });
        } else if (obj.type === "text") {
          const cid = nextCharId();
          objCharIdMap.set(obj.id, cid);
          hoistedDefs.push({
            tagType: Tag.DefineEditText,
            body: encodeDefineEditText(cid, obj),
          });
        } else if (obj.type === "bitmap") {
          const bitmapItem = doc.library.items.find(
            (item): item is BitmapItem =>
              item.itemType === "bitmap" && item.id === obj.libraryItemId
          );
          if (bitmapItem && bitmapItem.dataUri) {
            const imageBytes = dataUriToBytes(bitmapItem.dataUri);
            if (imageBytes.length > 0) {
              const bitmapCid = nextCharId();
              const imgPayload = new Uint8Array(2 + imageBytes.length);
              imgPayload[0] = bitmapCid & 0xff;
              imgPayload[1] = (bitmapCid >> 8) & 0xff;
              imgPayload.set(imageBytes, 2);
              hoistedDefs.push({ tagType: Tag.DefineBitsJPEG2, body: imgPayload });

              const shapeCid = nextCharId();
              objCharIdMap.set(obj.id, shapeCid);
              hoistedDefs.push({
                tagType: Tag.DefineShape4,
                body: encodeBitmapFillShape(
                  shapeCid,
                  bitmapCid,
                  obj.width,
                  obj.height,
                  bitmapItem.allowSmoothing
                ),
              });
            } else {
              const shapeCid = nextCharId();
              objCharIdMap.set(obj.id, shapeCid);
            }
          } else {
            const shapeCid = nextCharId();
            objCharIdMap.set(obj.id, shapeCid);
          }
        }
        // "instance": uses charIdMap, no definition needed here
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Build ButtonRecords.
  // State frame indices: 0=Up, 1=Over, 2=Down, 3=Hit
  // Each unique display object gets one record; if it appears in multiple states
  // its state bits are OR'd together.
  // ---------------------------------------------------------------------------
  const STATE_UP = 0;
  const STATE_OVER = 1;
  const STATE_DOWN = 2;
  const STATE_HIT = 3;

  interface RecordEntry {
    stateUp: boolean;
    stateOver: boolean;
    stateDown: boolean;
    stateHit: boolean;
    objCharId: number;
    depth: number;
  }

  // Key: `${frameIndex}:${objId}` so the same obj in different states gets
  // separate records (matching Flash Player's approach — each state appearance
  // is a separate ButtonRecord).
  const recordMap = new Map<string, RecordEntry>();

  // Depth assignment: unique per display-object ID (stable across states)
  const objDepthMap = new Map<string, number>();
  let nextDepth = 1;

  function getDepth(objId: string): number {
    let d = objDepthMap.get(objId);
    if (d === undefined) {
      d = nextDepth++;
      objDepthMap.set(objId, d);
    }
    return d;
  }

  for (const layer of layers) {
    for (const frame of layer.frames) {
      // Do not skip on isEmpty — the flag can be stale; iterate displayObjects directly.
      if (!frame.isKeyframe) continue;

      const stateIdx = frame.index;
      if (stateIdx > STATE_HIT) continue; // ignore frames beyond state 3

      for (const obj of frame.displayObjects) {
        let objCid: number | undefined;
        if (obj.type === "instance") {
          objCid = charIdMap.get(obj.symbolId);
        } else {
          objCid = objCharIdMap.get(obj.id);
        }
        if (objCid === undefined) continue;

        const key = `${stateIdx}:${obj.id}`;
        if (!recordMap.has(key)) {
          recordMap.set(key, {
            stateUp: stateIdx === STATE_UP,
            stateOver: stateIdx === STATE_OVER,
            stateDown: stateIdx === STATE_DOWN,
            stateHit: stateIdx === STATE_HIT,
            objCharId: objCid,
            depth: getDepth(obj.id),
          });
        } else {
          const entry = recordMap.get(key)!;
          if (stateIdx === STATE_UP) entry.stateUp = true;
          else if (stateIdx === STATE_OVER) entry.stateOver = true;
          else if (stateIdx === STATE_DOWN) entry.stateDown = true;
          else if (stateIdx === STATE_HIT) entry.stateHit = true;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Build ButtonRecord bytes separately so we know the size before writing
  // ActionOffset.
  // ---------------------------------------------------------------------------
  const recordsBuf = new BitWriter();
  for (const entry of recordMap.values()) {
    recordsBuf.writeBytes(
      buildButtonRecord(
        entry.stateUp,
        entry.stateOver,
        entry.stateDown,
        entry.stateHit,
        entry.objCharId,
        entry.depth
      )
    );
  }
  // Null terminator: ButtonRecord with all state bits = 0
  recordsBuf.writeUI8(0x00);
  const recordsBytes = recordsBuf.getBytes();

  // ---------------------------------------------------------------------------
  // Build BUTTONCONDACTION records for each buttonActions entry.
  //
  // BUTTONCONDACTION layout (SWF spec §12.14):
  //   UI16  CondActionSize  — byte offset from start of this record to the next
  //                           (0 for the last record)
  //   UI16  ConditionBits   — event bitmask
  //   ACTIONRECORD[]        — AVM1 bytecode
  //   UI8   0x00            — EndAction
  //
  // ConditionBits:
  //   bit 0: release          (overDownToIdle)
  //   bit 1: press            (idleToOverDown)
  //   bit 2: dragOut          (overDownToOutDown)
  //   bit 3: dragOver         (outDownToOverDown)
  //   bit 4: releaseOutside   (outDownToIdle)
  //   bit 5: rollOut          (overUpToIdle)
  //   bit 6: rollOver         (overUpToOverDown / idleToOverUp)
  // ---------------------------------------------------------------------------
  const eventBitMap: Record<string, number> = {
    release:        0x0001,
    press:          0x0002,
    dragOut:        0x0004,
    dragOver:       0x0008,
    releaseOutside: 0x0010,
    rollOut:        0x0020,
    rollOver:       0x0040,
  };

  const actions = symbol.buttonActions;
  const hasConditions = actions && actions.length > 0;

  if (hasConditions) {
    // Pre-compile all action bytecodes so we know sizes
    const compiledActions: Array<{ condBits: number; bytecode: Uint8Array }> = [];
    for (const action of actions!) {
      const condBits = eventBitMap[action.event] ?? 0;
      if (condBits === 0) continue; // unknown event — skip
      const bytecode = compileAS2(action.script);
      compiledActions.push({ condBits, bytecode });
    }

    if (compiledActions.length > 0) {
      // Each record:  2 (CondActionSize) + 2 (ConditionBits) + bytecode.length + 1 (EndAction)
      // CondActionSize for all but the last = size of that record; last = 0.

      // Compute total BUTTONCONDACTION block size for ActionOffset calculation.
      // ActionOffset = 2 (the UI16 ActionOffset field itself) + recordsBytes.length
      //   (ButtonRecords + null terminator are counted from the ActionOffset field's
      //    start position, which is 3 bytes into the tag body after ButtonId+TrackAsMenu)
      const actionOffset = 2 + recordsBytes.length;

      // Write ActionOffset
      bw.writeUI16LE(actionOffset);

      // Write ButtonRecords + null terminator
      bw.writeBytes(recordsBytes);

      // Write BUTTONCONDACTION records
      for (let i = 0; i < compiledActions.length; i++) {
        const { condBits, bytecode } = compiledActions[i]!;
        const isLast = i === compiledActions.length - 1;
        const recordSize = isLast ? 0 : (2 + 2 + bytecode.length + 1); // CondActionSize for this record
        bw.writeUI16LE(recordSize);
        bw.writeUI16LE(condBits);
        bw.writeBytes(bytecode);
        bw.writeUI8(0x00); // EndAction
      }
    } else {
      // No valid condition actions — write ActionOffset=0
      bw.writeUI16LE(0);
      bw.writeBytes(recordsBytes);
    }
  } else {
    // No button actions — ActionOffset = 0
    bw.writeUI16LE(0);
    bw.writeBytes(recordsBytes);
  }

  return bw.getBytes();
}
