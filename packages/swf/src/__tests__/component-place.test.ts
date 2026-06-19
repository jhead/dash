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
