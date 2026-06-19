/**
 * End-to-end test for placed v2-component runtime plumbing (task 1229, Part 1).
 *
 * Verifies that a v2 component (e.g. mx.controls.Button) placed on the stage is
 * actually emitted into the published SWF — previously it was SILENTLY DROPPED
 * (compile.ts only mapped itemType === "symbol", so the component's character id
 * never entered charIdMap and the stage instance was omitted).
 *
 * Decodes our OWN compiled SWF (no real-Flash binary) and asserts:
 *   (a) a DefineSprite exists for the component (the synthetic placeholder skin),
 *   (b) ExportAssets lists the fully-qualified mx.controls.* class name,
 *   (c) a DoInitAction registers that class (Object.registerClass bytecode),
 *   (d) the stage PlaceObject references the synthetic sprite's character id.
 *
 * Tag codes:
 *   0  End        1  ShowFrame   26 PlaceObject2   39 DefineSprite
 *  56 ExportAssets   59 DoInitAction
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { authorComboBoxClassBody, ROW_HEIGHT } from "../compiler/components.js";
import type {
  ComponentItem,
  FlashDocument,
  Frame,
  Layer,
  Scene,
  SymbolInstance,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Tag code constants
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_PLACE_OBJECT2 = 26;
const TAG_DEFINE_EDIT_TEXT = 37;
const TAG_DEFINE_SPRITE = 39;
const TAG_EXPORT_ASSETS = 56;
const TAG_DO_INIT_ACTION = 59;
const TAG_DEFINE_SHAPE4 = 83;

/** AVM1 ActionDefineFunction2 opcode — proof a function/class was authored. */
const ACTION_DEFINE_FUNCTION2 = 0x8e;

/**
 * True when an AVM1 bytecode buffer (the body AFTER the 2-byte DoInitAction
 * SpriteID) contains a DefineFunction2 (0x8e) action. We walk the action stream
 * respecting variable-length-action framing so a 0x8e byte inside a push operand
 * is not a false positive.
 */
function bytecodeHasDefineFunction2(body: Uint8Array): boolean {
  let pos = 2; // skip SpriteID
  while (pos < body.length) {
    const op = body[pos];
    if (op === 0x00) break; // ActionEnd
    if (op === ACTION_DEFINE_FUNCTION2) return true;
    if (op < 0x80) {
      pos += 1; // no-operand action
      continue;
    }
    const len = body[pos + 1] | (body[pos + 2] << 8);
    pos += 3 + len; // skip the header; bodies (codeSize) follow but contain their own actions
  }
  return false;
}

/** Tags 39 (DefineSprite) inner control tags — parse the sprite body's tag stream. */
function parseSpriteInnerTags(body: Uint8Array): SWFTag[] {
  // DefineSprite body: UI16 SpriteID, UI16 FrameCount, then a tag stream.
  return parseTags(body, 4);
}

// ---------------------------------------------------------------------------
// SWF binary parser helpers (same minimal reader other swf tests use)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function parseSWFHeader(bytes: Uint8Array): number /* tagsOffset */ {
  let byteOff = 8;
  let bitBuf = 0;
  let bitsLeft = 0;
  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitsLeft === 0) {
        bitBuf = bytes[byteOff++];
        bitsLeft = 8;
      }
      result = (result << 1) | ((bitBuf >> (bitsLeft - 1)) & 1);
      bitsLeft--;
    }
    return result;
  }
  const nBits = readBits(5);
  readBits(nBits); // xMin
  readBits(nBits); // xMax
  readBits(nBits); // yMin
  readBits(nBits); // yMax
  // After RECT: skip FrameRate(2) + FrameCount(2)
  return byteOff + 4;
}

function parseTags(bytes: Uint8Array, offset: number): SWFTag[] {
  const tags: SWFTag[] = [];
  let pos = offset;
  while (pos + 2 <= bytes.length) {
    const recordHdr = bytes[pos] | (bytes[pos + 1] << 8);
    const tagCode = (recordHdr >> 6) & 0x3ff;
    let bodyLength = recordHdr & 0x3f;
    let hdrSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        bytes[pos + 2] |
        (bytes[pos + 3] << 8) |
        (bytes[pos + 4] << 16) |
        (bytes[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({ code: tagCode, body: bytes.slice(bodyStart, bodyStart + bodyLength) });
    pos = bodyStart + bodyLength;
    if (tagCode === TAG_END) break;
  }
  return tags;
}

function parseSWF(bytes: Uint8Array): SWFTag[] {
  return parseTags(bytes, parseSWFHeader(bytes));
}

// ExportAssets (tag 56): UI16 count, then {UI16 charId, STRING name(NUL)}×count.
function parseExportAssets(body: Uint8Array): { charId: number; name: string }[] {
  const entries: { charId: number; name: string }[] = [];
  if (body.length < 2) return entries;
  const count = body[0] | (body[1] << 8);
  let pos = 2;
  for (let i = 0; i < count; i++) {
    if (pos + 2 > body.length) break;
    const charId = body[pos] | (body[pos + 1] << 8);
    pos += 2;
    let nameEnd = pos;
    while (nameEnd < body.length && body[nameEnd] !== 0) nameEnd++;
    const name = new TextDecoder().decode(body.slice(pos, nameEnd));
    pos = nameEnd + 1;
    entries.push({ charId, name });
  }
  return entries;
}

// DefineSprite (tag 39): UI16 SpriteID is the first field of the body.
function defineSpriteId(body: Uint8Array): number {
  return body[0] | (body[1] << 8);
}

// DoInitAction (tag 59): UI16 SpriteID, then AVM1 bytecode.
function doInitActionSpriteId(body: Uint8Array): number {
  return body[0] | (body[1] << 8);
}

// PlaceObject2 (tag 26): flags(UI8), depth(UI16), [charId(UI16) if HasCharacter].
// Returns the placed character id, or null when this placement carries no char
// (a pure Move). HasCharacter is flag bit 1 (0x02).
function placeObject2CharId(body: Uint8Array): number | null {
  if (body.length < 3) return null;
  const flags = body[0];
  const hasChar = (flags & 0x02) !== 0;
  if (!hasChar) return null;
  // flags(1) + depth(2) → charId at offset 3.
  return body[3] | (body[4] << 8);
}

/**
 * Decode the AVM1 push-string operands of a DoInitAction body. We use this to
 * prove the init script calls Object.registerClass(...) for the component class
 * (the encoder pushes "Object", "registerClass", the class name, and the linkage
 * id as ActionPush(string) operands).
 */
function pushedStrings(body: Uint8Array): string[] {
  const strings: string[] = [];
  let pos = 2; // skip SpriteID
  while (pos < body.length) {
    const op = body[pos];
    if (op === 0x00) break; // ActionEnd
    if (op < 0x80) {
      // No-operand action (single byte): ActionGetVariable(0x1c), CallMethod(0x52), Pop(0x17).
      pos += 1;
      continue;
    }
    // Action with a UI16 length operand.
    const len = body[pos + 1] | (body[pos + 2] << 8);
    const operand = body.slice(pos + 3, pos + 3 + len);
    if (op === 0x96 /* ActionPush */ && operand.length >= 1 && operand[0] === 0x00 /* type string */) {
      let end = 1;
      while (end < operand.length && operand[end] !== 0) end++;
      strings.push(new TextDecoder().decode(operand.slice(1, end)));
    }
    pos += 3 + len;
  }
  return strings;
}

const TAG_DO_ACTION = 12;

/**
 * Decode the ActionPush(string) operands of a DoAction body (pure AVM1 bytecode,
 * NO leading SpriteID — unlike DoInitAction). Used to prove the per-instance
 * component-param DoAction pushes the param name + value as it calls
 * setComponentParam(name, value).
 */
function doActionPushedStrings(body: Uint8Array): string[] {
  const strings: string[] = [];
  // The AS2 compiler hoists repeated string literals into an ActionConstantPool
  // (0x88) and ActionPush references them by constant8/16 INDEX, so we resolve
  // both inline string pushes AND constant-pool references.
  let constantPool: string[] = [];
  let pos = 0;
  while (pos < body.length) {
    const op = body[pos];
    if (op === 0x00) break; // ActionEnd
    if (op < 0x80) {
      pos += 1;
      continue;
    }
    const len = body[pos + 1] | (body[pos + 2] << 8);
    if (op === 0x88 /* ActionConstantPool */) {
      const cp: string[] = [];
      let p = pos + 3;
      const count = body[p] | (body[p + 1] << 8);
      p += 2;
      for (let i = 0; i < count; i++) {
        let s = p;
        while (s < body.length && body[s] !== 0) s++;
        cp.push(new TextDecoder().decode(body.slice(p, s)));
        p = s + 1;
      }
      constantPool = cp;
    } else if (op === 0x96 /* ActionPush */) {
      // ActionPush operand is a sequence of typed values; walk them.
      let p = pos + 3;
      const end = pos + 3 + len;
      while (p < end) {
        const valType = body[p++];
        if (valType === 0x00 /* string */) {
          let s = p;
          while (s < end && body[s] !== 0) s++;
          strings.push(new TextDecoder().decode(body.slice(p, s)));
          p = s + 1;
        } else if (valType === 0x01 /* float */) {
          p += 4;
        } else if (valType === 0x02 || valType === 0x03 /* null/undefined */) {
          // no operand
        } else if (valType === 0x04 /* register */) {
          p += 1;
        } else if (valType === 0x05 /* boolean */) {
          p += 1;
        } else if (valType === 0x06 /* double */) {
          p += 8;
        } else if (valType === 0x07 /* integer */) {
          p += 4;
        } else if (valType === 0x08 /* constant8 */) {
          const idx = body[p++];
          if (idx < constantPool.length) strings.push(constantPool[idx]);
        } else if (valType === 0x09 /* constant16 */) {
          const idx = body[p] | (body[p + 1] << 8);
          p += 2;
          if (idx < constantPool.length) strings.push(constantPool[idx]);
        } else {
          break;
        }
      }
    }
    pos += 3 + len;
  }
  return strings;
}

/**
 * Decode the DefineEditText (tag 37) flags + InitialText for a control's skin field.
 *
 * Body layout (matching encodeDefineEditText / Ruffle read.rs):
 *   UI16 charId, RECT bounds (byte-aligned after), UI16 flags, [FontID+FontHeight if
 *   HasFont], RGBA color, [MaxLength if HasMaxLength], HasLayout block (Align UI8 +
 *   4×UI16/SI16 margins/indent/leading), STRING VariableName, [STRING InitialText if
 *   HasText]. We skip the RECT by re-reading its bit-packed NBits header.
 *
 * Flag bits (Ruffle EditTextFlag): HasFont=0, HasMaxLength=1, HasTextColor=2,
 * ReadOnly=3, Password=4, Multiline=5, WordWrap=6, HasText=7, UseOutlines=8, HTML=9,
 * WasStatic=10, Border=11, NoSelect=12, HasLayout=13, AutoSize=14, HasFontClass=15.
 */
interface EditTextDecoded {
  charId: number;
  flags: number;
  readOnly: boolean;
  multiline: boolean;
  wordWrap: boolean;
  noSelect: boolean;
  hasText: boolean;
  hasFont: boolean;
  initialText: string;
}

function decodeEditText(body: Uint8Array): EditTextDecoded {
  const charId = body[0] | (body[1] << 8);
  // RECT starts at byte 2: UB[5] NBits, then 4×SB[NBits]. Read just enough to find the
  // byte-aligned position after the RECT.
  let bitPos = 16; // bits consumed so far (2 bytes for charId)
  const readBits = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = bitPos >> 3;
      const bitIdx = 7 - (bitPos & 7);
      v = (v << 1) | ((body[byteIdx] >> bitIdx) & 1);
      bitPos++;
    }
    return v;
  };
  const nBits = readBits(5);
  readBits(nBits); // xMin
  readBits(nBits); // xMax
  readBits(nBits); // yMin
  readBits(nBits); // yMax
  // Byte-align to the flags UI16.
  let pos = Math.ceil(bitPos / 8);
  const flags = body[pos] | (body[pos + 1] << 8);
  pos += 2;
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  if (has(0)) pos += 4; // FontID(2) + FontHeight(2)
  pos += 4; // RGBA color (HasTextColor always set by our encoder)
  if (has(1)) pos += 2; // MaxLength
  // HasLayout (bit 13) is always set by our encoder: Align(1)+LMargin+RMargin+Indent(3×2)+Leading SI16(2)
  if (has(13)) pos += 1 + 2 + 2 + 2 + 2;
  // VariableName: NUL-terminated.
  let s = pos;
  while (s < body.length && body[s] !== 0) s++;
  pos = s + 1;
  let initialText = "";
  if (has(7)) {
    let t = pos;
    while (t < body.length && body[t] !== 0) t++;
    initialText = new TextDecoder().decode(body.slice(pos, t));
  }
  return {
    charId,
    flags,
    readOnly: has(3),
    multiline: has(5),
    wordWrap: has(6),
    noSelect: has(12),
    hasText: has(7),
    hasFont: has(0),
    initialText,
  };
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: "#ffffff",
  rulerUnits: "px" as const,
  grid: {
    showGrid: false,
    snapToGrid: false,
    gridColor: "#999999",
    gridWidth: 18,
    gridHeight: 18,
  },
  guides: [],
  snapToObjects: false,
  snapToPixels: false,
  snapToGuides: false,
};

function makeFrame(displayObjects: SymbolInstance[]): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: false, // carries display objects — must NOT be marked empty
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionEaseType: "none",
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionSnap: false,
    motionScale: false,
    shapeEase: 0,
    shapeEaseType: "none",
    shapeBlend: "distributive",
    displayObjects,
  };
}

function makeLayer(displayObjects: SymbolInstance[]): Layer {
  return {
    id: "layer-1",
    name: "Layer 1",
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames: [makeFrame(displayObjects)],
    frameCount: 1,
  };
}

function makeScene(displayObjects: SymbolInstance[]): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers: [makeLayer(displayObjects)] },
  };
}

function makeComponent(overrides: Partial<ComponentItem> = {}): ComponentItem {
  return {
    id: "comp-button-1",
    name: "Button",
    itemType: "component",
    componentName: "Button",
    packageName: "mx.controls",
    ...overrides,
  };
}

function makeInstance(symbolId: string): SymbolInstance {
  return {
    type: "instance",
    id: "inst-1",
    symbolId,
    x: 100,
    y: 50,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    instanceName: "myButton",
  };
}

function makeDoc(component: ComponentItem, instance: SymbolInstance): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene([instance])],
    library: { items: [component], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("placed v2 component runtime plumbing (task 1229, Part 1)", () => {
  const CLASS_NAME = "mx.controls.Button";

  it("emits sprite + ExportAssets + DoInitAction + stage placement for a placed Button component", () => {
    const component = makeComponent();
    const instance = makeInstance(component.id);
    const doc = makeDoc(component, instance);

    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    // (b) ExportAssets lists the fully-qualified mx.controls.* class name, and we
    //     recover the synthetic sprite's character id from it.
    const exportTags = tags.filter((t) => t.code === TAG_EXPORT_ASSETS);
    expect(exportTags.length).toBeGreaterThanOrEqual(1);
    const allExports = exportTags.flatMap((t) => parseExportAssets(t.body));
    const buttonExport = allExports.find((e) => e.name === CLASS_NAME);
    expect(buttonExport, `ExportAssets must list ${CLASS_NAME}`).toBeDefined();
    const componentCharId = buttonExport!.charId;
    expect(componentCharId).toBeGreaterThanOrEqual(1);

    // (a) A DefineSprite exists for the component (its char id matches the export).
    const spriteIds = tags
      .filter((t) => t.code === TAG_DEFINE_SPRITE)
      .map((t) => defineSpriteId(t.body));
    expect(spriteIds).toContain(componentCharId);

    // (c) A DoInitAction registers the class for that sprite id, and its bytecode
    //     calls Object.registerClass(linkageId, ClassName). Part 2.1 emits TWO
    //     DoInitActions per component (class-definition then registerClass), both
    //     targeting the sprite id; select the registerClass one by its content.
    const initForComponent = tags.filter(
      (t) => t.code === TAG_DO_INIT_ACTION && doInitActionSpriteId(t.body) === componentCharId
    );
    const registerInit = initForComponent.find((t) =>
      pushedStrings(t.body).includes("registerClass")
    );
    expect(registerInit, "DoInitAction must register the component class").toBeDefined();
    const strings = pushedStrings(registerInit!.body);
    expect(strings).toContain("Object");
    expect(strings).toContain("registerClass");
    expect(strings).toContain(CLASS_NAME); // className passed to registerClass

    // (d) The stage PlaceObject references the synthetic sprite's char id.
    const placedCharIds = tags
      .filter((t) => t.code === TAG_PLACE_OBJECT2)
      .map((t) => placeObject2CharId(t.body))
      .filter((id): id is number => id !== null);
    expect(placedCharIds).toContain(componentCharId);
  });

  it("does NOT emit a sprite for an UNPLACED library component", () => {
    const component = makeComponent();
    // Empty stage (no instance), but the component is in the library.
    const doc: FlashDocument = {
      id: "doc-1",
      properties: BASE_PROPS,
      scenes: [makeScene([])],
      library: { items: [component], folders: [] },
    };
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const exports = tags
      .filter((t) => t.code === TAG_EXPORT_ASSETS)
      .flatMap((t) => parseExportAssets(t.body));
    expect(exports.find((e) => e.name === CLASS_NAME)).toBeUndefined();
    // No DefineSprite/DoInitAction synthesized for an unplaced component.
    expect(tags.filter((t) => t.code === TAG_DEFINE_SPRITE).length).toBe(0);
    expect(tags.filter((t) => t.code === TAG_DO_INIT_ACTION).length).toBe(0);
  });

  it("honours an explicit ComponentLinkage.className override", () => {
    const component = makeComponent({
      linkage: { className: "com.example.MyButton", linkageIdentifier: "MyButtonLinkage" },
    });
    const instance = makeInstance(component.id);
    const doc = makeDoc(component, instance);

    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const exports = tags
      .filter((t) => t.code === TAG_EXPORT_ASSETS)
      .flatMap((t) => parseExportAssets(t.body));
    // ExportAssets uses the linkage identifier; init bytecode pushes the class name.
    expect(exports.find((e) => e.name === "MyButtonLinkage")).toBeDefined();
    const initTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    const strings = initTags.flatMap((t) => pushedStrings(t.body));
    expect(strings).toContain("com.example.MyButton");
  });
});

describe("functional self-authored component class + skin (task 1231, Part 2.1)", () => {
  const CLASS_NAME = "mx.controls.Button";

  it("emits a class-definition DoInitAction (DefineFunction2) ORDERED BEFORE registerClass", () => {
    const component = makeComponent();
    const instance = makeInstance(component.id);
    const doc = makeDoc(component, instance);

    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    // Recover the component sprite char id from the ExportAssets linkage entry.
    const exports = tags
      .filter((t) => t.code === TAG_EXPORT_ASSETS)
      .flatMap((t) => parseExportAssets(t.body));
    const spriteId = exports.find((e) => e.name === CLASS_NAME)!.charId;
    expect(spriteId).toBeGreaterThanOrEqual(1);

    // Walk the tag stream in document order, capturing the index of each
    // DoInitAction targeting the component sprite.
    const initIndices: { idx: number; tag: SWFTag }[] = [];
    tags.forEach((t, idx) => {
      if (t.code === TAG_DO_INIT_ACTION && doInitActionSpriteId(t.body) === spriteId) {
        initIndices.push({ idx, tag: t });
      }
    });
    // Two DoInitActions: the class definition and the registerClass binding.
    expect(initIndices.length).toBe(2);

    const classInit = initIndices.find((e) => bytecodeHasDefineFunction2(e.tag.body));
    const registerInit = initIndices.find((e) =>
      pushedStrings(e.tag.body).includes("registerClass")
    );
    expect(classInit, "a DoInitAction must define the class via DefineFunction2").toBeDefined();
    expect(registerInit, "a DoInitAction must call registerClass").toBeDefined();

    // The class DEFINITION must be emitted BEFORE the registerClass binding so the
    // constructor exists in _global when registerClass resolves the dotted name.
    expect(classInit!.idx).toBeLessThan(registerInit!.idx);

    // The registerClass body should NOT itself contain a DefineFunction2 (it is a
    // pure Object.registerClass call), confirming the two are distinct scripts.
    expect(bytecodeHasDefineFunction2(registerInit!.tag.body)).toBe(false);
  });

  it("emits a real skin sprite containing a DefineShape4 face + a named DefineEditText", () => {
    const component = makeComponent();
    const instance = makeInstance(component.id);
    const doc = makeDoc(component, instance);

    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const exports = tags
      .filter((t) => t.code === TAG_EXPORT_ASSETS)
      .flatMap((t) => parseExportAssets(t.body));
    const spriteId = exports.find((e) => e.name === CLASS_NAME)!.charId;

    // The skin DefineSprite for the component.
    const spriteTag = tags.find(
      (t) => t.code === TAG_DEFINE_SPRITE && defineSpriteId(t.body) === spriteId
    );
    expect(spriteTag, "component skin DefineSprite must exist").toBeDefined();

    // The face shape (DefineShape4) and label EditText (DefineEditText) are hoisted
    // to TOP LEVEL before the sprite (definition tags are forbidden inside sprites).
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    const editTextTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(shapeTags.length).toBeGreaterThanOrEqual(1);
    expect(editTextTags.length).toBeGreaterThanOrEqual(1);

    // Char ids placed INSIDE the skin sprite resolve to a hoisted shape + edit-text.
    const innerTags = parseSpriteInnerTags(spriteTag!.body);
    const innerPlacedIds = innerTags
      .filter((t) => t.code === TAG_PLACE_OBJECT2)
      .map((t) => placeObject2CharId(t.body))
      .filter((id): id is number => id !== null);
    // Two placements: the face shape and the label text field.
    expect(innerPlacedIds.length).toBe(2);

    const shapeCharIds = new Set(shapeTags.map((t) => defineSpriteId(t.body) /* UI16 at offset 0 */));
    const editTextCharIds = new Set(
      editTextTags.map((t) => t.body[0] | (t.body[1] << 8))
    );
    // One placed id is a DefineShape4 char, the other a DefineEditText char.
    const placesShape = innerPlacedIds.some((id) => shapeCharIds.has(id));
    const placesEditText = innerPlacedIds.some((id) => editTextCharIds.has(id));
    expect(placesShape, "skin sprite must place the DefineShape4 face").toBe(true);
    expect(placesEditText, "skin sprite must place the DefineEditText label").toBe(true);
  });

  it("statically seeds the author's label into the EditText initial text", () => {
    const component = makeComponent({ componentName: "Submit", name: "Submit" });
    const instance = makeInstance(component.id);
    const doc = makeDoc(component, instance);

    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    // The seeded label appears as the EditText's NUL-terminated InitialText.
    const editTextTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    const decoded = editTextTags.map((t) => new TextDecoder().decode(t.body));
    expect(decoded.some((s) => s.includes("Submit"))).toBe(true);
  });
});

describe("live component parameter delivery (task 1232, Part 2.2)", () => {
  /** A component instance carrying explicit componentParameters. */
  function makeParamInstance(
    symbolId: string,
    componentParameters: Record<string, string>,
    name = "myButton"
  ): SymbolInstance {
    return {
      type: "instance",
      id: "inst-1",
      symbolId,
      x: 100,
      y: 50,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      instanceName: name,
      componentParameters,
    } as SymbolInstance;
  }

  /** All DoAction (tag 12) bodies in document order. */
  function doActions(tags: SWFTag[]): Uint8Array[] {
    return tags.filter((t) => t.code === TAG_DO_ACTION).map((t) => t.body);
  }

  it("emits a per-instance DoAction delivering a NON-DEFAULT label to the runtime instance", () => {
    const component = makeComponent(); // Button, default label "Button"
    // Author a non-default label + a non-default boolean param.
    const instance = makeParamInstance(component.id, {
      label: "Play Now",
      toggle: "true",
      enabled: "true", // default → must NOT be emitted
    });
    const doc = makeDoc(component, instance);

    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    // Find a DoAction whose pushed strings reference setComponentParam + the
    // author's non-default value.
    const paramAction = doActions(tags).find((b) =>
      doActionPushedStrings(b).includes("setComponentParam")
    );
    expect(paramAction, "a per-instance setComponentParam DoAction must be emitted").toBeDefined();

    const strings = doActionPushedStrings(paramAction!);
    // Targets the instance via _root.<name>.
    expect(strings).toContain("myButton");
    expect(strings).toContain("setComponentParam");
    // The non-default label param + its authored value reach the runtime.
    expect(strings).toContain("label");
    expect(strings).toContain("Play Now");
    // The non-default toggle param name is delivered too.
    expect(strings).toContain("toggle");
    // A param left at its catalog default ("enabled" === "true") is NOT delivered.
    expect(strings).not.toContain("enabled");
  });

  it("does NOT emit a param DoAction when all params are at their catalog defaults", () => {
    const component = makeComponent();
    // Every param at its default value → nothing to deliver.
    const instance = makeParamInstance(component.id, {
      label: "Button",
      labelPlacement: "right",
      selected: "false",
      toggle: "false",
      enabled: "true",
      visible: "true",
    });
    const doc = makeDoc(component, instance);

    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const hasParamAction = doActions(tags).some((b) =>
      doActionPushedStrings(b).includes("setComponentParam")
    );
    expect(hasParamAction).toBe(false);
  });

  it("synthesizes an instance name so an unnamed placed component is still addressable", () => {
    const component = makeComponent();
    // No instanceName authored, but a non-default param is set.
    const instance = {
      type: "instance",
      id: "inst-unnamed",
      symbolId: component.id,
      x: 10,
      y: 10,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      componentParameters: { label: "Anonymous" },
    } as SymbolInstance;
    const doc = makeDoc(component, instance);

    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const paramAction = doActions(tags).find((b) =>
      doActionPushedStrings(b).includes("setComponentParam")
    );
    expect(paramAction, "param delivery must still occur for an unnamed component").toBeDefined();
    const strings = doActionPushedStrings(paramAction!);
    // The synthesized fallback name (prefix `__cmp_`) addresses the instance.
    expect(strings.some((s) => s.startsWith("__cmp_"))).toBe(true);
    expect(strings).toContain("Anonymous");
  });

  it("delivers a non-default 'text' param for a text-bearing control (Label)", () => {
    // Generic over the catalog: Label's `text` param is delivered just like Button.label.
    const component = makeComponent({
      componentName: "Label",
      name: "Label",
      packageName: "mx.controls",
    });
    const instance = makeParamInstance(component.id, { text: "Hello World" }, "myLabel");
    const doc = makeDoc(component, instance);

    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const paramAction = doActions(tags).find((b) =>
      doActionPushedStrings(b).includes("setComponentParam")
    );
    expect(paramAction).toBeDefined();
    const strings = doActionPushedStrings(paramAction!);
    expect(strings).toContain("myLabel");
    expect(strings).toContain("text");
    expect(strings).toContain("Hello World");
  });
});

describe("functional CheckBox + RadioButton controls (task 1233, Part 2.3)", () => {
  /**
   * Compile a single-instance doc for the named control and recover its skin sprite
   * char id + the structural tags around it. Shared across the CheckBox/RadioButton
   * assertions below.
   */
  function compileControl(componentName: string, className: string, instanceName = "ctrl") {
    const component = makeComponent({ componentName, name: componentName, packageName: "mx.controls" });
    const instance: SymbolInstance = { ...makeInstance(component.id), instanceName };
    const doc = makeDoc(component, instance);
    const tags = parseSWF(compileDocument(doc));

    const exports = tags
      .filter((t) => t.code === TAG_EXPORT_ASSETS)
      .flatMap((t) => parseExportAssets(t.body));
    const exportEntry = exports.find((e) => e.name === className);
    return { tags, exports, exportEntry };
  }

  for (const ctrl of [
    { componentName: "CheckBox", className: "mx.controls.CheckBox", mark: "check_mk" },
    { componentName: "RadioButton", className: "mx.controls.RadioButton", mark: "dot_mk" },
  ]) {
    describe(ctrl.componentName, () => {
      it(`emits ExportAssets + a registerClass DoInitAction for ${ctrl.className}`, () => {
        const { tags, exportEntry } = compileControl(ctrl.componentName, ctrl.className);
        expect(exportEntry, `ExportAssets must list ${ctrl.className}`).toBeDefined();
        const spriteId = exportEntry!.charId;

        const initForComponent = tags.filter(
          (t) => t.code === TAG_DO_INIT_ACTION && doInitActionSpriteId(t.body) === spriteId
        );
        const registerInit = initForComponent.find((t) =>
          pushedStrings(t.body).includes("registerClass")
        );
        expect(registerInit, "a DoInitAction must register the class").toBeDefined();
        const strings = pushedStrings(registerInit!.body);
        expect(strings).toContain("Object");
        expect(strings).toContain("registerClass");
        expect(strings).toContain(ctrl.className);
      });

      it("emits the class-definition DoInitAction (DefineFunction2) BEFORE registerClass", () => {
        const { tags, exportEntry } = compileControl(ctrl.componentName, ctrl.className);
        const spriteId = exportEntry!.charId;

        const initIndices: { idx: number; tag: SWFTag }[] = [];
        tags.forEach((t, idx) => {
          if (t.code === TAG_DO_INIT_ACTION && doInitActionSpriteId(t.body) === spriteId) {
            initIndices.push({ idx, tag: t });
          }
        });
        expect(initIndices.length).toBe(2);

        const classInit = initIndices.find((e) => bytecodeHasDefineFunction2(e.tag.body));
        const registerInit = initIndices.find((e) =>
          pushedStrings(e.tag.body).includes("registerClass")
        );
        expect(classInit, "class DoInitAction must define functions via DefineFunction2").toBeDefined();
        expect(registerInit, "registerClass DoInitAction must exist").toBeDefined();
        // Class definition is ordered before registerClass.
        expect(classInit!.idx).toBeLessThan(registerInit!.idx);
      });

      it(`emits a skin sprite with a DefineShape4 face, a named EditText, and the ${ctrl.mark} mark`, () => {
        const { tags, exportEntry } = compileControl(ctrl.componentName, ctrl.className);
        const spriteId = exportEntry!.charId;

        const spriteTag = tags.find(
          (t) => t.code === TAG_DEFINE_SPRITE && defineSpriteId(t.body) === spriteId
        );
        expect(spriteTag, "control skin DefineSprite must exist").toBeDefined();

        // The face + mark are DefineShape4; the label is a DefineEditText (all hoisted).
        const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
        const editTextTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
        // Two DefineShape4s for a toggle control: the indicator face + the tick/dot mark.
        expect(shapeTags.length).toBeGreaterThanOrEqual(2);
        expect(editTextTags.length).toBeGreaterThanOrEqual(1);

        // The skin sprite places THREE named/positioned children: face, label, mark.
        const innerTags = parseSpriteInnerTags(spriteTag!.body);
        const innerPlaced = innerTags
          .filter((t) => t.code === TAG_PLACE_OBJECT2)
          .map((t) => placeObject2CharId(t.body))
          .filter((id): id is number => id !== null);
        expect(innerPlaced.length).toBe(3);

        const shapeCharIds = new Set(shapeTags.map((t) => defineSpriteId(t.body)));
        const editTextCharIds = new Set(editTextTags.map((t) => t.body[0] | (t.body[1] << 8)));
        // Two of the three placements are DefineShape4 (face + mark); one is the EditText.
        const placedShapes = innerPlaced.filter((id) => shapeCharIds.has(id));
        const placedTexts = innerPlaced.filter((id) => editTextCharIds.has(id));
        expect(placedShapes.length).toBe(2);
        expect(placedTexts.length).toBe(1);
      });
    });
  }

  it("a CheckBox toggle clicks deliver no extra param when 'selected' is default-false", () => {
    // Sanity: the default-deselected CheckBox emits no param DoAction (toggle is runtime-only).
    const component = makeComponent({ componentName: "CheckBox", name: "CheckBox", packageName: "mx.controls" });
    const instance: SymbolInstance = { ...makeInstance(component.id), instanceName: "cb" };
    const tags = parseSWF(compileDocument(makeDoc(component, instance)));
    const hasParam = tags
      .filter((t) => t.code === TAG_DO_ACTION)
      .some((t) => doActionPushedStrings(t.body).includes("setComponentParam"));
    expect(hasParam).toBe(false);
  });

  it("delivers a non-default author 'selected' param to a CheckBox via setComponentParam", () => {
    const component = makeComponent({ componentName: "CheckBox", name: "CheckBox", packageName: "mx.controls" });
    const instance: SymbolInstance = {
      ...makeInstance(component.id),
      instanceName: "cb",
      componentParameters: { selected: "true" },
    } as SymbolInstance;
    const tags = parseSWF(compileDocument(makeDoc(component, instance)));
    const paramAction = tags
      .filter((t) => t.code === TAG_DO_ACTION)
      .map((t) => t.body)
      .find((b) => doActionPushedStrings(b).includes("setComponentParam"));
    expect(paramAction, "a non-default 'selected' must be delivered").toBeDefined();
    const strings = doActionPushedStrings(paramAction!);
    expect(strings).toContain("cb");
    expect(strings).toContain("selected");
  });

  it("delivers a RadioButton's non-default groupName param", () => {
    const component = makeComponent({ componentName: "RadioButton", name: "RadioButton", packageName: "mx.controls" });
    const instance: SymbolInstance = {
      ...makeInstance(component.id),
      instanceName: "rb",
      componentParameters: { groupName: "colors", data: "blue" },
    } as SymbolInstance;
    const tags = parseSWF(compileDocument(makeDoc(component, instance)));
    const paramAction = tags
      .filter((t) => t.code === TAG_DO_ACTION)
      .map((t) => t.body)
      .find((b) => doActionPushedStrings(b).includes("setComponentParam"));
    expect(paramAction).toBeDefined();
    const strings = doActionPushedStrings(paramAction!);
    expect(strings).toContain("rb");
    expect(strings).toContain("groupName");
    expect(strings).toContain("colors");
    expect(strings).toContain("data");
    expect(strings).toContain("blue");
  });
});

describe("functional text controls: Label + TextInput + TextArea (task 1234, Part 2.4)", () => {
  /**
   * Compile a single-instance doc for the named text control. Returns the parsed tags
   * and the control's skin sprite char id + the EditText decoded from inside the sprite.
   */
  function compileTextControl(
    componentName: string,
    className: string,
    params?: Record<string, string>,
    instanceName = "ctrl"
  ) {
    const component = makeComponent({ componentName, name: componentName, packageName: "mx.controls" });
    const base = makeInstance(component.id);
    const instance: SymbolInstance = params
      ? ({ ...base, instanceName, componentParameters: params } as SymbolInstance)
      : { ...base, instanceName };
    const doc = makeDoc(component, instance);
    const tags = parseSWF(compileDocument(doc));

    const exports = tags
      .filter((t) => t.code === TAG_EXPORT_ASSETS)
      .flatMap((t) => parseExportAssets(t.body));
    const exportEntry = exports.find((e) => e.name === className);

    // The EditText placed INSIDE the control's skin sprite (the field that IS the control).
    let skinEditText: EditTextDecoded | undefined;
    if (exportEntry) {
      const spriteTag = tags.find(
        (t) => t.code === TAG_DEFINE_SPRITE && defineSpriteId(t.body) === exportEntry.charId
      );
      const allEditTexts = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT).map((t) => decodeEditText(t.body));
      if (spriteTag) {
        const innerPlacedIds = new Set(
          parseSpriteInnerTags(spriteTag.body)
            .filter((t) => t.code === TAG_PLACE_OBJECT2)
            .map((t) => placeObject2CharId(t.body))
            .filter((id): id is number => id !== null)
        );
        skinEditText = allEditTexts.find((et) => innerPlacedIds.has(et.charId));
      }
    }
    return { tags, exportEntry, skinEditText };
  }

  for (const ctrl of [
    { componentName: "Label", className: "mx.controls.Label" },
    { componentName: "TextInput", className: "mx.controls.TextInput" },
    { componentName: "TextArea", className: "mx.controls.TextArea" },
  ]) {
    describe(ctrl.componentName, () => {
      it(`emits ExportAssets + a registerClass DoInitAction for ${ctrl.className}`, () => {
        const { tags, exportEntry } = compileTextControl(ctrl.componentName, ctrl.className);
        expect(exportEntry, `ExportAssets must list ${ctrl.className}`).toBeDefined();
        const spriteId = exportEntry!.charId;

        const initForComponent = tags.filter(
          (t) => t.code === TAG_DO_INIT_ACTION && doInitActionSpriteId(t.body) === spriteId
        );
        const registerInit = initForComponent.find((t) => pushedStrings(t.body).includes("registerClass"));
        expect(registerInit, "a DoInitAction must register the class").toBeDefined();
        const strings = pushedStrings(registerInit!.body);
        expect(strings).toContain("Object");
        expect(strings).toContain("registerClass");
        expect(strings).toContain(ctrl.className);
      });

      it("emits the class-definition DoInitAction (DefineFunction2) BEFORE registerClass", () => {
        const { tags, exportEntry } = compileTextControl(ctrl.componentName, ctrl.className);
        const spriteId = exportEntry!.charId;

        const initIndices: { idx: number; tag: SWFTag }[] = [];
        tags.forEach((t, idx) => {
          if (t.code === TAG_DO_INIT_ACTION && doInitActionSpriteId(t.body) === spriteId) {
            initIndices.push({ idx, tag: t });
          }
        });
        expect(initIndices.length).toBe(2);

        const classInit = initIndices.find((e) => bytecodeHasDefineFunction2(e.tag.body));
        const registerInit = initIndices.find((e) => pushedStrings(e.tag.body).includes("registerClass"));
        expect(classInit, "class DoInitAction must define functions via DefineFunction2").toBeDefined();
        expect(registerInit, "registerClass DoInitAction must exist").toBeDefined();
        expect(classInit!.idx).toBeLessThan(registerInit!.idx);
      });

      it("statically seeds the skin EditText with text and sets HasText", () => {
        // The DefineEditText InitialText is statically seeded from the catalog default
        // text (or the class-name fallback when the default is empty). The AUTHOR's live
        // `text` param is delivered separately via a per-instance DoAction (asserted by
        // the setComponentParam test below), not baked into the DefineEditText.
        const { skinEditText } = compileTextControl(ctrl.componentName, ctrl.className);
        expect(skinEditText, "the skin must place an EditText").toBeDefined();
        expect(skinEditText!.hasText).toBe(true);
        expect(skinEditText!.initialText.length).toBeGreaterThan(0);
      });
    });
  }

  it("Label's skin EditText is READ-ONLY (dynamic), single-line", () => {
    const { skinEditText } = compileTextControl("Label", "mx.controls.Label");
    expect(skinEditText).toBeDefined();
    // Dynamic display text → ReadOnly set, NoSelect NOT forced editable, single-line.
    expect(skinEditText!.readOnly, "Label is read-only display text").toBe(true);
    expect(skinEditText!.multiline).toBe(false);
    expect(skinEditText!.wordWrap).toBe(false);
  });

  it("Label draws NO face shape (the EditText is its only skin child)", () => {
    const { tags, exportEntry } = compileTextControl("Label", "mx.controls.Label");
    const spriteTag = tags.find(
      (t) => t.code === TAG_DEFINE_SPRITE && defineSpriteId(t.body) === exportEntry!.charId
    );
    const innerPlaced = parseSpriteInnerTags(spriteTag!.body)
      .filter((t) => t.code === TAG_PLACE_OBJECT2)
      .map((t) => placeObject2CharId(t.body))
      .filter((id): id is number => id !== null);
    // Only ONE placement (the EditText) — no face shape, no marks.
    expect(innerPlaced.length).toBe(1);
    const editTextCharIds = new Set(
      tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT).map((t) => t.body[0] | (t.body[1] << 8))
    );
    expect(editTextCharIds.has(innerPlaced[0])).toBe(true);
  });

  it("TextInput's skin EditText is EDITABLE (input), single-line", () => {
    const { skinEditText } = compileTextControl("TextInput", "mx.controls.TextInput");
    expect(skinEditText).toBeDefined();
    // Input text → NOT read-only (editable), single-line, no word-wrap.
    expect(skinEditText!.readOnly, "TextInput is editable (input text)").toBe(false);
    expect(skinEditText!.multiline).toBe(false);
    expect(skinEditText!.wordWrap).toBe(false);
  });

  it("TextArea's skin EditText is EDITABLE (input), MULTILINE + WORDWRAP", () => {
    const { skinEditText } = compileTextControl("TextArea", "mx.controls.TextArea");
    expect(skinEditText).toBeDefined();
    expect(skinEditText!.readOnly, "TextArea is editable (input text)").toBe(false);
    expect(skinEditText!.multiline, "TextArea is multi-line").toBe(true);
    expect(skinEditText!.wordWrap, "TextArea word-wraps").toBe(true);
  });

  it("TextInput/TextArea draw a bordered input-box face + the editable field", () => {
    for (const ctrl of [
      { componentName: "TextInput", className: "mx.controls.TextInput" },
      { componentName: "TextArea", className: "mx.controls.TextArea" },
    ]) {
      const { tags, exportEntry } = compileTextControl(ctrl.componentName, ctrl.className);
      const spriteTag = tags.find(
        (t) => t.code === TAG_DEFINE_SPRITE && defineSpriteId(t.body) === exportEntry!.charId
      );
      const innerPlaced = parseSpriteInnerTags(spriteTag!.body)
        .filter((t) => t.code === TAG_PLACE_OBJECT2)
        .map((t) => placeObject2CharId(t.body))
        .filter((id): id is number => id !== null);
      // TWO placements: the bordered face shape + the editable EditText.
      expect(innerPlaced.length, `${ctrl.componentName} places face + field`).toBe(2);
      const shapeCharIds = new Set(
        tags.filter((t) => t.code === TAG_DEFINE_SHAPE4).map((t) => t.body[0] | (t.body[1] << 8))
      );
      const editTextCharIds = new Set(
        tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT).map((t) => t.body[0] | (t.body[1] << 8))
      );
      expect(innerPlaced.some((id) => shapeCharIds.has(id)), "places the bordered face").toBe(true);
      expect(innerPlaced.some((id) => editTextCharIds.has(id)), "places the editable field").toBe(true);
    }
  });

  it("delivers a non-default author 'text' param to a TextInput via setComponentParam", () => {
    const component = makeComponent({ componentName: "TextInput", name: "TextInput", packageName: "mx.controls" });
    const instance: SymbolInstance = {
      ...makeInstance(component.id),
      instanceName: "ti",
      componentParameters: { text: "user typed" },
    } as SymbolInstance;
    const tags = parseSWF(compileDocument(makeDoc(component, instance)));
    const paramAction = tags
      .filter((t) => t.code === TAG_DO_ACTION)
      .map((t) => t.body)
      .find((b) => doActionPushedStrings(b).includes("setComponentParam"));
    expect(paramAction, "a non-default 'text' must be delivered").toBeDefined();
    const strings = doActionPushedStrings(paramAction!);
    expect(strings).toContain("ti");
    expect(strings).toContain("text");
    expect(strings).toContain("user typed");
  });
});

describe("functional selection controls: List + ComboBox (task 1235, Part 2.5)", () => {
  /** The fixed row-pool size emitted in the List/ComboBox skin (LIST_ROW_POOL). */
  const ROW_POOL = 8;

  /**
   * Compile a single-instance doc for the named selection control. Returns parsed tags,
   * the control's skin sprite char id, and the char ids placed inside that sprite.
   */
  function compileSelectionControl(
    componentName: string,
    className: string,
    params?: Record<string, string>,
    instanceName = "ctrl"
  ) {
    const component = makeComponent({ componentName, name: componentName, packageName: "mx.controls" });
    const base = makeInstance(component.id);
    const instance: SymbolInstance = params
      ? ({ ...base, instanceName, componentParameters: params } as SymbolInstance)
      : { ...base, instanceName };
    const doc = makeDoc(component, instance);
    const tags = parseSWF(compileDocument(doc));

    const exports = tags
      .filter((t) => t.code === TAG_EXPORT_ASSETS)
      .flatMap((t) => parseExportAssets(t.body));
    const exportEntry = exports.find((e) => e.name === className);

    let innerPlacedIds: number[] = [];
    if (exportEntry) {
      const spriteTag = tags.find(
        (t) => t.code === TAG_DEFINE_SPRITE && defineSpriteId(t.body) === exportEntry.charId
      );
      if (spriteTag) {
        innerPlacedIds = parseSpriteInnerTags(spriteTag.body)
          .filter((t) => t.code === TAG_PLACE_OBJECT2)
          .map((t) => placeObject2CharId(t.body))
          .filter((id): id is number => id !== null);
      }
    }
    return { tags, exportEntry, innerPlacedIds };
  }

  for (const ctrl of [
    { componentName: "List", className: "mx.controls.List" },
    { componentName: "ComboBox", className: "mx.controls.ComboBox" },
  ]) {
    describe(ctrl.componentName, () => {
      it(`emits ExportAssets + a registerClass DoInitAction for ${ctrl.className}`, () => {
        const { tags, exportEntry } = compileSelectionControl(ctrl.componentName, ctrl.className);
        expect(exportEntry, `ExportAssets must list ${ctrl.className}`).toBeDefined();
        const spriteId = exportEntry!.charId;

        const initForComponent = tags.filter(
          (t) => t.code === TAG_DO_INIT_ACTION && doInitActionSpriteId(t.body) === spriteId
        );
        const registerInit = initForComponent.find((t) => pushedStrings(t.body).includes("registerClass"));
        expect(registerInit, "a DoInitAction must register the class").toBeDefined();
        const strings = pushedStrings(registerInit!.body);
        expect(strings).toContain("Object");
        expect(strings).toContain("registerClass");
        expect(strings).toContain(ctrl.className);
      });

      it("emits the class-definition DoInitAction (DefineFunction2) BEFORE registerClass", () => {
        const { tags, exportEntry } = compileSelectionControl(ctrl.componentName, ctrl.className);
        const spriteId = exportEntry!.charId;

        const initIndices: { idx: number; tag: SWFTag }[] = [];
        tags.forEach((t, idx) => {
          if (t.code === TAG_DO_INIT_ACTION && doInitActionSpriteId(t.body) === spriteId) {
            initIndices.push({ idx, tag: t });
          }
        });
        expect(initIndices.length).toBe(2);

        const classInit = initIndices.find((e) => bytecodeHasDefineFunction2(e.tag.body));
        const registerInit = initIndices.find((e) => pushedStrings(e.tag.body).includes("registerClass"));
        expect(classInit, "class DoInitAction must define functions via DefineFunction2").toBeDefined();
        expect(registerInit, "registerClass DoInitAction must exist").toBeDefined();
        expect(classInit!.idx).toBeLessThan(registerInit!.idx);
      });

      it("emits the fixed row-pool of named EditText children + a highlight shape", () => {
        const { tags, exportEntry, innerPlacedIds } = compileSelectionControl(
          ctrl.componentName,
          ctrl.className
        );
        expect(exportEntry).toBeDefined();

        const editTextCharIds = new Set(
          tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT).map((t) => t.body[0] | (t.body[1] << 8))
        );
        const shapeCharIds = new Set(
          tags.filter((t) => t.code === TAG_DEFINE_SHAPE4).map((t) => t.body[0] | (t.body[1] << 8))
        );

        // The skin places: face shape + highlight shape (+ combo arrow), label_txt, and
        // the fixed row pool of EditTexts. Count the placed EditTexts: label_txt + ROW_POOL.
        const placedTexts = innerPlacedIds.filter((id) => editTextCharIds.has(id));
        const placedShapes = innerPlacedIds.filter((id) => shapeCharIds.has(id));
        expect(placedTexts.length, "label_txt + the fixed row pool").toBe(1 + ROW_POOL);
        // Face + highlight (List); face + highlight + arrow (ComboBox).
        const expectedShapes = ctrl.componentName === "ComboBox" ? 3 : 2;
        expect(placedShapes.length, "face + highlight (+ arrow for ComboBox)").toBe(expectedShapes);
      });
    });
  }

  it("List delivers the author's items via setComponentParam(labels, ...)", () => {
    const component = makeComponent({ componentName: "List", name: "List", packageName: "mx.controls" });
    const instance: SymbolInstance = {
      ...makeInstance(component.id),
      instanceName: "myList",
      componentParameters: { labels: "Red,Green,Blue" },
    } as SymbolInstance;
    const tags = parseSWF(compileDocument(makeDoc(component, instance)));

    const paramAction = tags
      .filter((t) => t.code === 12 /* DoAction */)
      .map((t) => t.body)
      .find((b) => doActionPushedStrings(b).includes("setComponentParam"));
    expect(paramAction, "a non-default 'labels' must be delivered").toBeDefined();
    const strings = doActionPushedStrings(paramAction!);
    expect(strings).toContain("myList");
    expect(strings).toContain("labels");
    expect(strings).toContain("Red,Green,Blue");
  });

  it("ComboBox delivers the author's items + the dropdown row pool is hidden initially in source", () => {
    const component = makeComponent({ componentName: "ComboBox", name: "ComboBox", packageName: "mx.controls" });
    const instance: SymbolInstance = {
      ...makeInstance(component.id),
      instanceName: "myCombo",
      componentParameters: { labels: "One,Two,Three" },
    } as SymbolInstance;
    const tags = parseSWF(compileDocument(makeDoc(component, instance)));

    const paramAction = tags
      .filter((t) => t.code === 12 /* DoAction */)
      .map((t) => t.body)
      .find((b) => doActionPushedStrings(b).includes("setComponentParam"));
    expect(paramAction, "a non-default 'labels' must be delivered").toBeDefined();
    const strings = doActionPushedStrings(paramAction!);
    expect(strings).toContain("myCombo");
    expect(strings).toContain("labels");
    expect(strings).toContain("One,Two,Three");
  });

  // -------------------------------------------------------------------------
  // Corrected ComboBox hit-test boundary (task 1237).
  //
  // A precise Ruffle hit oracle is impractical: per docs/13 + the project
  // learnings, headless Ruffle does NOT dispatch global mouse clip events
  // (onMouseDown), so a click-to-open/select cannot be exercised at runtime in
  // the e2e harness. We therefore assert the corrected boundary STRUCTURALLY by
  // (a) pinning the authored onMouseDown gate (no trailing phantom row) and
  // (b) simulating the exact runtime arithmetic for both collapsed and open
  // states, proving the clickable area now matches the VISIBLE rows.
  // -------------------------------------------------------------------------
  describe("corrected hit-test boundary (task 1237)", () => {
    /**
     * Replicates the authored onMouseDown gate's vertical hit test:
     *   bottom = _y + __rowTop + (open ? items*__rowHeight : 0)
     *   inside = my >= _y && my <= bottom
     * __rowTop for the ComboBox is ROW_HEIGHT (the collapsed row sits on top).
     */
    function inside(my: number, opts: { y: number; open: boolean; items: number }): boolean {
      const rowTop = ROW_HEIGHT; // ComboBox: collapsed label occupies row 0
      const bottom = opts.y + rowTop + (opts.open ? opts.items * ROW_HEIGHT : 0);
      return my >= opts.y && my <= bottom;
    }

    it("the authored gate drops the phantom trailing row (no '+ this.__rowHeight')", () => {
      const src = authorComboBoxClassBody("_global.Foo");
      // The corrected gate compares to `bottom` exactly...
      expect(src).toContain("my <= bottom)");
      // ...and must NOT re-add a row to the boundary.
      expect(src).not.toContain("my <= bottom + this.__rowHeight");
    });

    it("a click just below the COLLAPSED row is OUTSIDE (does not open)", () => {
      const y = 100;
      // The collapsed box is the single top row: y .. y+ROW_HEIGHT.
      expect(inside(y + ROW_HEIGHT, { y, open: false, items: 3 })).toBe(true); // bottom edge
      // One pixel past the collapsed row must be outside (previously a phantom row).
      expect(inside(y + ROW_HEIGHT + 1, { y, open: false, items: 3 })).toBe(false);
      // The old off-by-one accepted clicks ~2 rows down — now firmly outside.
      expect(inside(y + 2 * ROW_HEIGHT - 1, { y, open: false, items: 3 })).toBe(false);
    });

    it("with the dropdown OPEN, a click below the last item is OUTSIDE (no phantom select)", () => {
      const y = 100;
      const items = 3;
      // Visible area = collapsed row + N item rows = y .. y + (1+N)*ROW_HEIGHT.
      const visibleBottom = y + (1 + items) * ROW_HEIGHT;
      expect(inside(visibleBottom, { y, open: true, items })).toBe(true); // last item's bottom edge
      // One pixel below the last item must be outside (was the phantom row).
      expect(inside(visibleBottom + 1, { y, open: true, items })).toBe(false);
      // A full phantom row below the last item is firmly outside.
      expect(inside(visibleBottom + ROW_HEIGHT, { y, open: true, items })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Arrow overlay toggle (task 1237): __setOpen flips arrow_mk visibility,
  // guarded for undefined.
  // -------------------------------------------------------------------------
  it("ComboBox __setOpen toggles arrow_mk visibility (guarded for undefined)", () => {
    const src = authorComboBoxClassBody("_global.Foo");
    expect(src).toContain("if (this.arrow_mk != undefined)");
    expect(src).toContain("this.arrow_mk._visible = !this.__open;");
  });
});
