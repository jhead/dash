/**
 * Structural tests for the AS2 user-class compilation pass (task 1299).
 *
 * These decode our OWN compiled SWF (no real-Flash binary) to prove the
 * pass-ordering contract that the Ruffle e2e oracle then confirms at runtime
 * (byte-presence tests are necessary but not sufficient — see CLAUDE.md):
 *
 *   1. A library symbol linked to an external `.as` class compiles the class
 *      DEFINITION (an ActionDefineFunction2-bearing DoInitAction) and emits it
 *      BEFORE the symbol-pass `Object.registerClass(...)` binding, so the
 *      constructor exists in _global when registerClass resolves it.
 *   2. When two user classes have an `extends` relationship, the SUPERCLASS
 *      definition DoInitAction is emitted before the subclass's (ActionExtends
 *      in the subclass dereferences the superclass constructor).
 *   3. A fully-qualified class name (`com.example.Foo`) registers at its dotted
 *      path: the class-definition bytecode pushes both the namespace package
 *      segments and the full dotted name, and registerClass references the
 *      dotted name.
 *
 * Tag codes:  59 DoInitAction
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Symbol as SymbolItem, AsClassFile } from "@flash/core";

// ---------------------------------------------------------------------------
// Minimal SWF tag reader (same shape as other swf tests)
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_DO_INIT_ACTION = 59;
const ACTION_DEFINE_FUNCTION2 = 0x8e;

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function parseSWFHeader(bytes: Uint8Array): number {
  let byteOff = 8;
  let bitBuf = 0;
  let bitsLeft = 0;
  const readBits = (n: number): number => {
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
  };
  const nBits = readBits(5);
  readBits(nBits);
  readBits(nBits);
  readBits(nBits);
  readBits(nBits);
  return byteOff + 4; // skip FrameRate(2) + FrameCount(2)
}

function parseSWF(bytes: Uint8Array): SWFTag[] {
  const tags: SWFTag[] = [];
  let pos = parseSWFHeader(bytes);
  while (pos + 2 <= bytes.length) {
    const recordHdr = bytes[pos] | (bytes[pos + 1] << 8);
    const tagCode = (recordHdr >> 6) & 0x3ff;
    let bodyLength = recordHdr & 0x3f;
    let hdrSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        bytes[pos + 2] | (bytes[pos + 3] << 8) | (bytes[pos + 4] << 16) | (bytes[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({ code: tagCode, body: bytes.slice(bodyStart, bodyStart + bodyLength) });
    pos = bodyStart + bodyLength;
    if (tagCode === TAG_END) break;
  }
  return tags;
}

/** DoInitAction body contains a DefineFunction2 action (a class definition). */
function bytecodeHasDefineFunction2(body: Uint8Array): boolean {
  let pos = 2; // skip SpriteID
  while (pos < body.length) {
    const op = body[pos];
    if (op === 0x00) break; // ActionEnd
    if (op === ACTION_DEFINE_FUNCTION2) return true;
    if (op < 0x80) {
      pos += 1;
      continue;
    }
    const len = body[pos + 1] | (body[pos + 2] << 8);
    pos += 3 + len;
  }
  return false;
}

/**
 * Decode every string the DoInitAction bytecode pushes — both INLINE
 * ActionPush(string) operands AND ActionConstantPool (0x88) references
 * (constant8/16). compileAS2 hoists repeated string literals (e.g. the dotted
 * class name) into a constant pool, so an inline-only scan misses them. Skips
 * the 2-byte DoInitAction SpriteID.
 */
function pushedStrings(body: Uint8Array): string[] {
  const strings: string[] = [];
  let constantPool: string[] = [];
  let pos = 2; // skip SpriteID
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

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: "#ffffff",
  rulerUnits: "px" as const,
  grid: { showGrid: false, snapToGrid: false, gridColor: "#999999", gridWidth: 18, gridHeight: 18 },
  guides: [],
  snapToObjects: false,
  snapToPixels: false,
  snapToGuides: false,
};

/** A minimal empty-timeline MovieClip symbol linked to an AS2 class. */
function makeLinkedSymbol(
  id: string,
  linkageIdentifier: string,
  className: string
): SymbolItem {
  return {
    id,
    name: id,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: {
      layers: [
        {
          id: `${id}-layer`,
          name: "Layer 1",
          type: "normal",
          visible: true,
          locked: false,
          outlineMode: false,
          outlineColor: "#ff0000",
          height: 20,
          parentFolderId: null,
          frameCount: 1,
          frames: [
            {
              index: 0,
              isKeyframe: true,
              isEmpty: true,
              tweenType: "none",
              label: "",
              labelType: "name",
              script: "",
              sound: null,
              motionEase: 0,
              motionRotate: "none",
              motionRotateCount: 0,
              motionOrientToPath: false,
              motionSync: false,
              motionScale: false,
              shapeEase: 0,
              shapeBlend: "distributive",
              displayObjects: [],
            },
          ],
        },
      ],
    },
    linkage: {
      exportForActionScript: true,
      exportForRuntimeSharing: false,
      linkageIdentifier,
      className,
      importForRuntimeSharing: false,
      sharedUrl: "",
      exportInFirstFrame: true,
    },
    scale9Grid: null,
  } as unknown as SymbolItem;
}

function makeDoc(symbols: SymbolItem[], asClasses: AsClassFile[]): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [
      {
        id: "scene-1",
        name: "Scene 1",
        timeline: {
          layers: [
            {
              id: "scene-layer",
              name: "Layer 1",
              type: "normal",
              visible: true,
              locked: false,
              outlineMode: false,
              outlineColor: "#ff0000",
              height: 20,
              parentFolderId: null,
              frameCount: 1,
              frames: [
                {
                  index: 0,
                  isKeyframe: true,
                  isEmpty: false,
                  tweenType: "none",
                  label: "",
                  labelType: "name",
                  script: "",
                  sound: null,
                  motionEase: 0,
                  motionRotate: "none",
                  motionRotateCount: 0,
                  motionOrientToPath: false,
                  motionSync: false,
                  motionScale: false,
                  shapeEase: 0,
                  shapeBlend: "distributive",
                  displayObjects: [],
                },
              ],
            },
          ],
        },
      },
    ],
    library: { items: symbols, folders: [] },
    asClasses,
  } as unknown as FlashDocument;
}

/** All DoInitAction tags in document order, paired with their stream index. */
function initTags(tags: SWFTag[]): { idx: number; tag: SWFTag }[] {
  const out: { idx: number; tag: SWFTag }[] = [];
  tags.forEach((t, idx) => {
    if (t.code === TAG_DO_INIT_ACTION) out.push({ idx, tag: t });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 user-class compilation pass (task 1299)", () => {
  it("emits the class-DEFINITION DoInitAction BEFORE the registerClass binding", () => {
    const sym = makeLinkedSymbol("sym-ball", "BallLinkage", "Ball");
    const cls: AsClassFile = {
      path: "Ball.as",
      source: "class Ball { function Ball() {} function speak():Void { trace(\"hi\"); } }",
    };
    const tags = parseSWF(compileDocument(makeDoc([sym], [cls])));

    const inits = initTags(tags);
    // One class definition + one registerClass binding.
    const classDef = inits.find((e) => bytecodeHasDefineFunction2(e.tag.body));
    const registerInit = inits.find((e) => pushedStrings(e.tag.body).includes("registerClass"));

    expect(classDef, "a DoInitAction must define the class (DefineFunction2)").toBeDefined();
    expect(registerInit, "a DoInitAction must call Object.registerClass").toBeDefined();

    // ORDERING: the class definition runs first so the constructor exists when
    // registerClass resolves the class name.
    expect(classDef!.idx).toBeLessThan(registerInit!.idx);

    // The registerClass body references the class name + Object.registerClass.
    const regStrings = pushedStrings(registerInit!.tag.body);
    expect(regStrings).toContain("Object");
    expect(regStrings).toContain("registerClass");
    expect(regStrings).toContain("Ball");
  });

  it("orders class definitions by `extends` — superclass DoInitAction before subclass", () => {
    // Two linked symbols: Animal (base) and Dog extends Animal. The asClasses
    // are intentionally provided subclass-FIRST and named so a naive path sort
    // (Dog.as < Zanimal.as) would put the subclass first; the topo-sort must
    // still emit the superclass definition first.
    const dogSym = makeLinkedSymbol("sym-dog", "DogLinkage", "Dog");
    const animalSym = makeLinkedSymbol("sym-animal", "AnimalLinkage", "Zanimal");
    const dogCls: AsClassFile = {
      path: "Dog.as",
      source: "class Dog extends Zanimal { function Dog() {} function bark():Void { trace(\"woof\"); } }",
    };
    const animalCls: AsClassFile = {
      path: "Zanimal.as",
      source: "class Zanimal { function Zanimal() {} function speak():Void { trace(\"...\"); } }",
    };

    const tags = parseSWF(compileDocument(makeDoc([dogSym, animalSym], [dogCls, animalCls])));
    const inits = initTags(tags);

    // Find each class's DEFINITION DoInitAction by the class name it sets.
    const animalDef = inits.find(
      (e) => bytecodeHasDefineFunction2(e.tag.body) && pushedStrings(e.tag.body).includes("Zanimal")
    );
    const dogDef = inits.find(
      (e) =>
        bytecodeHasDefineFunction2(e.tag.body) &&
        pushedStrings(e.tag.body).includes("Dog") &&
        !pushedStrings(e.tag.body).includes("registerClass")
    );

    expect(animalDef, "superclass definition DoInitAction must exist").toBeDefined();
    expect(dogDef, "subclass definition DoInitAction must exist").toBeDefined();
    // SUPERCLASS definition is emitted before the subclass definition.
    expect(animalDef!.idx).toBeLessThan(dogDef!.idx);
  });

  it("registers a fully-qualified class at its dotted _global path", () => {
    const sym = makeLinkedSymbol("sym-foo", "FooLinkage", "com.example.Foo");
    const cls: AsClassFile = {
      path: "com/example/Foo.as",
      source:
        "class com.example.Foo { function Foo() {} function greet():Void { trace(\"hello\"); } }",
    };
    const tags = parseSWF(compileDocument(makeDoc([sym], [cls])));
    const inits = initTags(tags);

    const classDef = inits.find((e) => bytecodeHasDefineFunction2(e.tag.body));
    expect(classDef, "the class definition DoInitAction must exist").toBeDefined();
    const defStrings = pushedStrings(classDef!.tag.body);
    // The namespace package segments and the full dotted name are all pushed:
    // package guards create _global.com / _global.com.example, then the class
    // registers at com.example.Foo.
    expect(defStrings).toContain("_global");
    expect(defStrings).toContain("com");
    expect(defStrings).toContain("example");
    expect(defStrings).toContain("com.example.Foo");

    // registerClass references the dotted class name.
    const registerInit = inits.find((e) => pushedStrings(e.tag.body).includes("registerClass"));
    expect(registerInit).toBeDefined();
    expect(pushedStrings(registerInit!.tag.body)).toContain("com.example.Foo");

    // Ordering still holds: definition before registerClass.
    expect(classDef!.idx).toBeLessThan(registerInit!.idx);
  });

  it("is a no-op when the document has no asClasses (existing docs unaffected)", () => {
    const doc = makeDoc([], []);
    delete (doc as unknown as { asClasses?: unknown }).asClasses;
    const tags = parseSWF(compileDocument(doc));
    // No DoInitAction emitted at all for a doc with no linked classes.
    expect(tags.filter((t) => t.code === TAG_DO_INIT_ACTION).length).toBe(0);
  });
});
