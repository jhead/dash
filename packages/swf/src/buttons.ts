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
import type { BitmapItem, ButtonHandler, ButtonSounds, ColorEffect, FlashDocument, Symbol } from "@flash/core";
import { compileAS2, composeMatrix, toSWFMatrix } from "@flash/core";
import { BitWriter } from "./bits.js";
import { encodeCxformWithAlpha, colorEffectToCXForm, encodeCXFormWithAlpha } from "./cxform.js";
import { edgeNumBits } from "./helpers.js";
import { fontKey } from "./fonts.js";
import { encodeDefineShape4, encodeBitmapFillShape } from "./shapes.js";
import { encodeDefineEditText, encodeDefineText, encodeCSMTextSettings } from "./text.js";
import { Tag } from "./tags.js";
import { dataUriToBytes, ensureJpegEOI } from "./bitmaps.js";

// ---------------------------------------------------------------------------
// Identity MATRIX helper
// ---------------------------------------------------------------------------

/**
 * Encode a SWF MATRIX for a button state display object.
 * Uses the same composeMatrix/toSWFMatrix encoding as PlaceObject2 in shapes.ts.
 */
function encodeButtonMatrix(
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
  rotation: number,
  skewX: number,
  skewY: number
): Uint8Array {
  const m = composeMatrix({ tx: x, ty: y, scaleX, scaleY, rotation, skewX, skewY });
  const swfM = toSWFMatrix(m);
  const { hasScale, scaleX: sx, scaleY: sy, hasRotate, rotateSkew0, rotateSkew1, translateX, translateY } = swfM;

  const bw = new BitWriter();

  bw.writeBits(hasScale ? 1 : 0, 1);
  if (hasScale) {
    const nBits = Math.max(edgeNumBits([sx, sy]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(sx, nBits);
    bw.writeBits(sy, nBits);
  }

  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const nBits = Math.max(edgeNumBits([rotateSkew0, rotateSkew1]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(rotateSkew0, nBits);
    bw.writeBits(rotateSkew1, nBits);
  }

  {
    const nBits = Math.max(edgeNumBits([translateX, translateY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(translateX, nBits);
    bw.writeBits(translateY, nBits);
  }

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
  depth: number,
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
  rotation: number,
  skewX: number,
  skewY: number,
  colorEffect?: ColorEffect
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
  bw.writeBytes(encodeButtonMatrix(x, y, scaleX, scaleY, rotation, skewX, skewY));

  // Encode CXFORMWITHALPHA: use colorEffect if present, otherwise identity
  const cx = colorEffect ? colorEffectToCXForm(colorEffect) : null;
  bw.writeBytes(cx !== null ? encodeCXFormWithAlpha(cx) : encodeIdentityCxform());

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
 * @param fontCharIdMap Maps fontKey(name, bold, italic) → SWF character ID for embedded fonts
 * @returns             Raw bytes of the DefineButton2 tag body (without record header).
 */
export function encodeDefineButton2(
  buttonCharId: number,
  symbol: Symbol,
  doc: FlashDocument,
  charIdMap: Map<string, number>,
  nextCharId: () => number,
  hoistedDefs: Array<{ tagType: number; body: Uint8Array }>,
  /** When set, replaces the symbol's own buttonActions with these instance-level on() handlers. */
  actionOverrides?: readonly ButtonHandler[],
  /** When set, overrides the symbol's trackAsMenu flag for per-instance button definitions. */
  trackAsMenuOverride?: boolean,
  /** Maps fontKey(name, bold, italic) → SWF character ID; passed to encodeDefineEditText for button state text. */
  fontCharIdMap?: Map<string, number>
): Uint8Array {
  const bw = new BitWriter();

  // ButtonId
  bw.writeUI16LE(buttonCharId);

  // ReservedFlags[7] + TrackAsMenu[1]
  // TrackAsMenu bit (0x01): when set the button tracks as a menu item (press+drag activates)
  const trackAsMenu = trackAsMenuOverride ?? symbol.trackAsMenu ?? false;
  bw.writeUI8(trackAsMenu ? 0x01 : 0x00);

  const layers = symbol.timeline.layers;

  // ---------------------------------------------------------------------------
  // Pre-pass: assign character IDs for all shapes/text/bitmaps and collect
  // hoisted definition tags (same pattern as encodeDefineSprite).
  // ---------------------------------------------------------------------------
  const objCharIdMap = new Map<string, number>();

  for (const layer of layers) {
    if (layer.type === 'guide') continue;
    if (layer.type === 'folder') continue;
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
          const embeddedFontId = fontCharIdMap?.get(fontKey(obj.fontFamily, obj.bold, obj.italic));
          if (obj.textType === "static" && embeddedFontId !== undefined) {
            const fontSizeTwips = Math.round(obj.fontSize * 20);
            hoistedDefs.push({
              tagType: Tag.DefineText,
              body: encodeDefineText(
                cid,
                obj.text,
                embeddedFontId,
                fontSizeTwips,
                `#${obj.color.r.toString(16).padStart(2, "0")}${obj.color.g.toString(16).padStart(2, "0")}${obj.color.b.toString(16).padStart(2, "0")}`,
                0,
                fontSizeTwips,
              ),
            });
          } else {
            hoistedDefs.push({
              tagType: Tag.DefineEditText,
              body: encodeDefineEditText(cid, obj, embeddedFontId),
            });
          }
          const aa = obj.antiAlias;
          hoistedDefs.push({
            tagType: Tag.CSMTextSettings,
            body: (aa === "custom" && obj.csm)
              ? encodeCSMTextSettings(cid, obj.csm.thickness, obj.csm.sharpness)
              : encodeCSMTextSettings(cid, 0, 0),
          });
        } else if (obj.type === "bitmap") {
          const bitmapItem = doc.library.items.find(
            (item): item is BitmapItem =>
              item.itemType === "bitmap" && item.id === obj.libraryItemId
          );
          if (bitmapItem && bitmapItem.dataUri) {
            const imageBytes = ensureJpegEOI(dataUriToBytes(bitmapItem.dataUri));
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
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    skewX: number;
    skewY: number;
    colorEffect?: ColorEffect;
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
    if (layer.type === 'guide') continue;
    if (layer.type === 'folder') continue;
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

        // Extract transform and colorEffect from the display object
        const x = obj.x;
        const y = obj.y;
        const scaleX = (obj as { scaleX?: number }).scaleX ?? 1;
        const scaleY = (obj as { scaleY?: number }).scaleY ?? 1;
        const rotation = (obj as { rotation?: number }).rotation ?? 0;
        const skewX = (obj as { skewX?: number }).skewX ?? 0;
        const skewY = (obj as { skewY?: number }).skewY ?? 0;
        const colorEffect = (obj.type === "instance" || obj.type === "text")
          ? obj.colorEffect
          : undefined;

        const key = `${stateIdx}:${obj.id}`;
        if (!recordMap.has(key)) {
          recordMap.set(key, {
            stateUp: stateIdx === STATE_UP,
            stateOver: stateIdx === STATE_OVER,
            stateDown: stateIdx === STATE_DOWN,
            stateHit: stateIdx === STATE_HIT,
            objCharId: objCid,
            depth: getDepth(obj.id),
            x,
            y,
            scaleX,
            scaleY,
            rotation,
            skewX,
            skewY,
            colorEffect,
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
        entry.depth,
        entry.x,
        entry.y,
        entry.scaleX,
        entry.scaleY,
        entry.rotation,
        entry.skewX,
        entry.skewY,
        entry.colorEffect
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
  // ConditionBits (authoritative: ruffle/swf/src/types.rs ButtonActionCondition):
  //   bit 0: rollOver         (idleToOverUp)
  //   bit 1: rollOut          (overUpToIdle)
  //   bit 2: press            (overUpToOverDown)
  //   bit 3: release          (overDownToOverUp)
  //   bit 4: dragOut          (overDownToOutDown)
  //   bit 5: dragOver         (outDownToOverDown)
  //   bit 6: releaseOutside   (outDownToIdle)
  //   bit 7: idleToOverDown   (direct drag from idle to pressed)
  //   bit 8: overDownToIdle   (drag from pressed back to idle)
  //   bits 9-15: keyPress key code (0 = no key press condition)
  //
  // Key codes for named keys (matches Ruffle ButtonKeyCode enum):
  //   Left=1, Right=2, Home=3, End=4, Insert=5, Delete=6, Backspace=8,
  //   Return/Enter=13, Up=14, Down=15, PgUp=16, PgDown=17, Tab=18, Escape=19
  //   Regular printable ASCII characters use their ASCII code (Space=32..~=126)
  // ---------------------------------------------------------------------------
  const eventBitMap: Record<string, number> = {
    rollOver:       0x0001,
    rollOut:        0x0002,
    press:          0x0004,
    release:        0x0008,
    dragOut:        0x0010,
    dragOver:       0x0020,
    releaseOutside: 0x0040,
    idleToOverDown: 0x0080,
    overDownToIdle: 0x0100,
  };

  /** Named key → SWF key code for on(keyPress '<Name>') handlers. */
  const namedKeyCode: Record<string, number> = {
    Left:      1,
    Right:     2,
    Home:      3,
    End:       4,
    Insert:    5,
    Delete:    6,
    Backspace: 8,
    Enter:     13,
    Return:    13,
    Up:        14,
    Down:      15,
    PgUp:      16,
    PageUp:    16,
    PgDown:    17,
    PageDown:  17,
    Tab:       18,
    Escape:    19,
    Esc:       19,
    Space:     32,
  };

  /**
   * Convert a keyPress key string to the SWF ButtonKeyCode byte.
   * Named keys are wrapped in angle brackets, e.g. '<Left>', '<Enter>'.
   * Regular chars use their ASCII code directly.
   * Returns 0 for unrecognized keys.
   */
  function keyPressKeyCode(key: string): number {
    // Named key: '<Left>', '<Enter>', etc.
    const namedMatch = key.match(/^<([^>]+)>$/);
    if (namedMatch) {
      return namedKeyCode[namedMatch[1]!] ?? 0;
    }
    // Single printable character
    if (key.length === 1) {
      const code = key.charCodeAt(0);
      if (code >= 32 && code <= 126) return code;
    }
    return 0;
  }

  /**
   * Compute the ConditionBits UI16 for a button handler event.
   * For keyPress events, bits 9-15 hold the key code.
   */
  function conditionBitsForEvent(event: ButtonHandler["event"]): number {
    if (typeof event === "object" && "keyPress" in event) {
      const kc = keyPressKeyCode(event.keyPress);
      if (kc === 0) return 0; // unrecognized key — skip
      // Per SWF spec, keyPress condition fires with OVER_DOWN_TO_OVER_UP (bit 3) set
      // plus the key code in bits 9-15. Ruffle checks: (kc << 9).
      return (kc & 0x7f) << 9;
    }
    return eventBitMap[event as string] ?? 0;
  }

  // Use instance-level overrides if provided, otherwise fall back to symbol-level actions.
  const actions = actionOverrides ?? symbol.buttonActions;
  const hasConditions = actions && actions.length > 0;

  if (hasConditions) {
    // Pre-compile all action bytecodes so we know sizes
    const compiledActions: Array<{ condBits: number; bytecode: Uint8Array }> = [];
    for (const action of actions!) {
      const condBits = conditionBitsForEvent(action.event);
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

// ---------------------------------------------------------------------------
// DefineButtonSound (tag 17)
// ---------------------------------------------------------------------------

/**
 * Encode a DefineButtonSound (tag 17) tag body.
 *
 * Associates sound effects with button state transitions. Must immediately
 * follow the corresponding DefineButton2 tag in the SWF.
 *
 * Tag 17 body structure (SWF spec §12.12):
 *   UI16  ButtonId
 *   For each of 4 state slots (order: overToUp, upToOver, overToDown, downToOver):
 *     UI16  SoundId (0 = no sound for this state)
 *     if SoundId != 0:
 *       SOUNDINFO flags byte:
 *         bit 0: HasInPoint
 *         bit 1: HasOutPoint
 *         bit 2: HasLoops
 *         bit 3: HasEnvelope
 *         bit 4: NoMultiple
 *         bit 5: Stop
 *       if HasLoops: UI16 LoopCount
 *
 * @param buttonId  SWF character ID of the DefineButton2 tag
 * @param sounds    Per-state sound assignments from the button symbol model
 * @param soundIdMap  Maps library SoundItem.id → SWF character ID
 * @returns         Raw bytes of the DefineButtonSound tag body
 */
export function encodeDefineButtonSound(
  buttonId: number,
  sounds: ButtonSounds,
  soundIdMap: Map<string, number>
): Uint8Array {
  const bw = new BitWriter();

  // ButtonId
  bw.writeUI16LE(buttonId);

  // 4 state slots in SWF spec order
  const slots = [
    sounds.overToUp,
    sounds.upToOver,
    sounds.overToDown,
    sounds.downToOver,
  ] as const;

  for (const slot of slots) {
    if (!slot) {
      // No sound for this state: write SoundId = 0
      bw.writeUI16LE(0);
    } else {
      const swfSoundId = soundIdMap.get(slot.soundId);
      if (swfSoundId === undefined || swfSoundId === 0) {
        // Sound not found or id 0 (treat as no sound)
        bw.writeUI16LE(0);
      } else {
        bw.writeUI16LE(swfSoundId);
        // SOUNDINFO flags byte
        const hasLoops = slot.loops !== undefined && slot.loops > 0;
        const flags = hasLoops ? 0x04 : 0x00; // bit 2 = HasLoops
        bw.writeUI8(flags);
        if (hasLoops) {
          bw.writeUI16LE(slot.loops!);
        }
      }
    }
  }

  return bw.getBytes();
}
