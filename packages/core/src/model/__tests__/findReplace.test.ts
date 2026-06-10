/**
 * Unit tests for model/findReplace.ts — document-wide find and replace.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  findInDocument,
  replaceInDocument,
  replaceAllInDocument,
} from "../findReplace.js";
import type { FindReplaceCriteria, FindReplaceReplacement } from "../findReplace.js";
import { createDocument } from "../document.js";
import type { FlashDocument, Frame, Layer } from "../types.js";
import type {
  TextDisplayObject,
  SymbolInstance,
  ShapeDisplayObject,
} from "../../engine/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTextObj(
  id: string,
  text: string,
  fontFamily = "Arial",
  color = { r: 0, g: 0, b: 0, a: 255 }
): TextDisplayObject {
  return {
    type: "text",
    id,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    text,
    textType: "static",
    fontFamily,
    fontSize: 12,
    bold: false,
    italic: false,
    color,
    align: "left",
    multiline: false,
    wordWrap: false,
  };
}

function makeSymbolInst(id: string, symbolId: string): SymbolInstance {
  return {
    type: "instance",
    id,
    symbolId,
    x: 0,
    y: 0,
  };
}

function makeShapeObj(
  id: string,
  fillColor = { r: 255, g: 0, b: 0, a: 255 }
): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    x: 0,
    y: 0,
    shape: {
      id: `${id}-shape`,
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [],
          fill: { type: "solid", color: fillColor },
          closed: true,
        },
      ],
    },
  };
}

/** Build a minimal FlashDocument with display objects on frame 0 of layer 0, scene 0. */
function makeDoc(
  ...displayObjects: Array<
    TextDisplayObject | SymbolInstance | ShapeDisplayObject
  >
): FlashDocument {
  const doc = createDocument();
  const layer = doc.scenes[0]!.timeline.layers[0]!;
  const frame0: Frame = {
    ...layer.frames[0]!,
    isEmpty: false,
    displayObjects,
  };
  const newLayer: Layer = { ...layer, frames: [frame0] };
  return {
    ...doc,
    scenes: [
      {
        ...doc.scenes[0]!,
        timeline: {
          ...doc.scenes[0]!.timeline,
          layers: [newLayer],
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// findInDocument — text
// ---------------------------------------------------------------------------

describe("findInDocument — text", () => {
  it("finds a text object whose content includes the search string", () => {
    const doc = makeDoc(makeTextObj("t1", "Hello World"));
    const criteria: FindReplaceCriteria = { type: "text", searchText: "Hello" };
    const matches = findInDocument(doc, criteria);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.objectId).toBe("t1");
  });

  it("does not match when text content doesn't include search string", () => {
    const doc = makeDoc(makeTextObj("t1", "Goodbye"));
    const criteria: FindReplaceCriteria = { type: "text", searchText: "Hello" };
    expect(findInDocument(doc, criteria)).toHaveLength(0);
  });

  it("finds multiple matching text objects", () => {
    const doc = makeDoc(
      makeTextObj("t1", "Hello World"),
      makeTextObj("t2", "Say hello again"),
      makeTextObj("t3", "Goodbye")
    );
    const criteria: FindReplaceCriteria = {
      type: "text",
      searchText: "hello",
      caseSensitive: false,
    };
    const matches = findInDocument(doc, criteria);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.objectId)).toContain("t1");
    expect(matches.map((m) => m.objectId)).toContain("t2");
  });

  it("respects caseSensitive=true", () => {
    const doc = makeDoc(
      makeTextObj("t1", "Hello World"),
      makeTextObj("t2", "hello world")
    );
    const criteria: FindReplaceCriteria = {
      type: "text",
      searchText: "Hello",
      caseSensitive: true,
    };
    const matches = findInDocument(doc, criteria);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.objectId).toBe("t1");
  });

  it("respects wholeWord=true", () => {
    const doc = makeDoc(
      makeTextObj("t1", "Hello World"),
      makeTextObj("t2", "Helloween")
    );
    const criteria: FindReplaceCriteria = {
      type: "text",
      searchText: "Hello",
      wholeWord: true,
      caseSensitive: false,
    };
    const matches = findInDocument(doc, criteria);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.objectId).toBe("t1");
  });

  it("returns an empty array when there are no text objects", () => {
    const doc = makeDoc(makeShapeObj("s1"));
    const criteria: FindReplaceCriteria = { type: "text", searchText: "Hello" };
    expect(findInDocument(doc, criteria)).toHaveLength(0);
  });

  it("returns an empty array when searchText is empty string", () => {
    const doc = makeDoc(makeTextObj("t1", "Hello"));
    const criteria: FindReplaceCriteria = { type: "text", searchText: "" };
    expect(findInDocument(doc, criteria)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findInDocument — font
// ---------------------------------------------------------------------------

describe("findInDocument — font", () => {
  it("finds text objects using the specified font", () => {
    const doc = makeDoc(
      makeTextObj("t1", "Aa", "Times New Roman"),
      makeTextObj("t2", "Bb", "Arial")
    );
    const criteria: FindReplaceCriteria = {
      type: "font",
      searchFont: "Times New Roman",
    };
    const matches = findInDocument(doc, criteria);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.objectId).toBe("t1");
  });

  it("is case-insensitive for font name comparison", () => {
    const doc = makeDoc(makeTextObj("t1", "Aa", "Arial"));
    const criteria: FindReplaceCriteria = { type: "font", searchFont: "arial" };
    expect(findInDocument(doc, criteria)).toHaveLength(1);
  });

  it("returns empty when no text object uses the font", () => {
    const doc = makeDoc(makeTextObj("t1", "Aa", "Arial"));
    const criteria: FindReplaceCriteria = {
      type: "font",
      searchFont: "Helvetica",
    };
    expect(findInDocument(doc, criteria)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findInDocument — color
// ---------------------------------------------------------------------------

describe("findInDocument — color", () => {
  it("finds a shape with a matching fill color", () => {
    const doc = makeDoc(makeShapeObj("s1", { r: 255, g: 0, b: 0, a: 255 }));
    const criteria: FindReplaceCriteria = {
      type: "color",
      searchColor: "#ff0000",
    };
    const matches = findInDocument(doc, criteria);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.objectId).toBe("s1");
  });

  it("does not match shapes with a different fill color", () => {
    const doc = makeDoc(makeShapeObj("s1", { r: 0, g: 255, b: 0, a: 255 }));
    const criteria: FindReplaceCriteria = {
      type: "color",
      searchColor: "#ff0000",
    };
    expect(findInDocument(doc, criteria)).toHaveLength(0);
  });

  it("finds text objects matching the text color", () => {
    const doc = makeDoc(
      makeTextObj("t1", "Red", "Arial", { r: 255, g: 0, b: 0, a: 255 })
    );
    const criteria: FindReplaceCriteria = {
      type: "color",
      searchColor: "#ff0000",
    };
    const matches = findInDocument(doc, criteria);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.objectId).toBe("t1");
  });
});

// ---------------------------------------------------------------------------
// findInDocument — symbol
// ---------------------------------------------------------------------------

describe("findInDocument — symbol", () => {
  it("finds instances of the specified symbol", () => {
    const doc = makeDoc(
      makeSymbolInst("inst1", "sym-hero"),
      makeSymbolInst("inst2", "sym-enemy"),
      makeSymbolInst("inst3", "sym-hero")
    );
    const criteria: FindReplaceCriteria = {
      type: "symbol",
      searchSymbolId: "sym-hero",
    };
    const matches = findInDocument(doc, criteria);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.objectId)).toContain("inst1");
    expect(matches.map((m) => m.objectId)).toContain("inst3");
  });

  it("returns empty when no instance uses the symbol", () => {
    const doc = makeDoc(makeSymbolInst("inst1", "sym-other"));
    const criteria: FindReplaceCriteria = {
      type: "symbol",
      searchSymbolId: "sym-hero",
    };
    expect(findInDocument(doc, criteria)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// replaceInDocument
// ---------------------------------------------------------------------------

describe("replaceInDocument", () => {
  it("replaces text content in a single match", () => {
    const doc = makeDoc(makeTextObj("t1", "Hello World"));
    const criteria: FindReplaceCriteria = { type: "text", searchText: "Hello" };
    const matches = findInDocument(doc, criteria);
    expect(matches).toHaveLength(1);
    const replacement: FindReplaceReplacement = { replaceText: "Hi" };
    const newDoc = replaceInDocument(doc, matches[0]!, replacement, criteria);
    // Locate the updated object
    const obj = newDoc.scenes[0]!.timeline.layers[0]!.frames[0]!
      .displayObjects[0]! as TextDisplayObject;
    expect(obj.text).toBe("Hi World");
  });

  it("replaces font family in a single match", () => {
    const doc = makeDoc(makeTextObj("t1", "Aa", "Arial"));
    const criteria: FindReplaceCriteria = { type: "font", searchFont: "Arial" };
    const matches = findInDocument(doc, criteria);
    const replacement: FindReplaceReplacement = { replaceFont: "Helvetica" };
    const newDoc = replaceInDocument(doc, matches[0]!, replacement, criteria);
    const obj = newDoc.scenes[0]!.timeline.layers[0]!.frames[0]!
      .displayObjects[0]! as TextDisplayObject;
    expect(obj.fontFamily).toBe("Helvetica");
  });

  it("replaces symbol id in a single match", () => {
    const doc = makeDoc(makeSymbolInst("inst1", "sym-old"));
    const criteria: FindReplaceCriteria = {
      type: "symbol",
      searchSymbolId: "sym-old",
    };
    const matches = findInDocument(doc, criteria);
    const replacement: FindReplaceReplacement = { replaceSymbolId: "sym-new" };
    const newDoc = replaceInDocument(doc, matches[0]!, replacement, criteria);
    const obj = newDoc.scenes[0]!.timeline.layers[0]!.frames[0]!
      .displayObjects[0]! as SymbolInstance;
    expect(obj.symbolId).toBe("sym-new");
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc(makeTextObj("t1", "Hello"));
    const criteria: FindReplaceCriteria = { type: "text", searchText: "Hello" };
    const matches = findInDocument(doc, criteria);
    const replacement: FindReplaceReplacement = { replaceText: "Hi" };
    replaceInDocument(doc, matches[0]!, replacement, criteria);
    const obj = doc.scenes[0]!.timeline.layers[0]!.frames[0]!
      .displayObjects[0]! as TextDisplayObject;
    expect(obj.text).toBe("Hello");
  });
});

// ---------------------------------------------------------------------------
// replaceAllInDocument
// ---------------------------------------------------------------------------

describe("replaceAllInDocument", () => {
  it("replaces font across all matching text objects", () => {
    const doc = makeDoc(
      makeTextObj("t1", "Aa", "Arial"),
      makeTextObj("t2", "Bb", "Arial"),
      makeTextObj("t3", "Cc", "Times New Roman")
    );
    const criteria: FindReplaceCriteria = { type: "font", searchFont: "Arial" };
    const replacement: FindReplaceReplacement = { replaceFont: "Verdana" };
    const newDoc = replaceAllInDocument(doc, criteria, replacement);
    const objects = newDoc.scenes[0]!.timeline.layers[0]!.frames[0]!
      .displayObjects as TextDisplayObject[];
    expect(objects[0]!.fontFamily).toBe("Verdana");
    expect(objects[1]!.fontFamily).toBe("Verdana");
    expect(objects[2]!.fontFamily).toBe("Times New Roman");
  });

  it("replaces all text occurrences across multiple objects", () => {
    const doc = makeDoc(
      makeTextObj("t1", "Score: 0"),
      makeTextObj("t2", "Score: 0")
    );
    const criteria: FindReplaceCriteria = {
      type: "text",
      searchText: "0",
      caseSensitive: false,
    };
    const replacement: FindReplaceReplacement = { replaceText: "100" };
    const newDoc = replaceAllInDocument(doc, criteria, replacement);
    const objects = newDoc.scenes[0]!.timeline.layers[0]!.frames[0]!
      .displayObjects as TextDisplayObject[];
    expect(objects[0]!.text).toBe("Score: 100");
    expect(objects[1]!.text).toBe("Score: 100");
  });

  it("replaces all symbol references", () => {
    const doc = makeDoc(
      makeSymbolInst("inst1", "sym-hero"),
      makeSymbolInst("inst2", "sym-hero"),
      makeSymbolInst("inst3", "sym-other")
    );
    const criteria: FindReplaceCriteria = {
      type: "symbol",
      searchSymbolId: "sym-hero",
    };
    const replacement: FindReplaceReplacement = { replaceSymbolId: "sym-new" };
    const newDoc = replaceAllInDocument(doc, criteria, replacement);
    const objects = newDoc.scenes[0]!.timeline.layers[0]!.frames[0]!
      .displayObjects as SymbolInstance[];
    expect(objects[0]!.symbolId).toBe("sym-new");
    expect(objects[1]!.symbolId).toBe("sym-new");
    expect(objects[2]!.symbolId).toBe("sym-other");
  });

  it("returns the same doc when nothing matches", () => {
    const doc = makeDoc(makeTextObj("t1", "Hello"));
    const criteria: FindReplaceCriteria = {
      type: "text",
      searchText: "Zzz",
    };
    const replacement: FindReplaceReplacement = { replaceText: "Yyy" };
    const newDoc = replaceAllInDocument(doc, criteria, replacement);
    // The document structure should be equivalent
    const obj = newDoc.scenes[0]!.timeline.layers[0]!.frames[0]!
      .displayObjects[0]! as TextDisplayObject;
    expect(obj.text).toBe("Hello");
  });

  it("replaces fill color in all matching shapes", () => {
    const doc = makeDoc(
      makeShapeObj("s1", { r: 255, g: 0, b: 0, a: 255 }),
      makeShapeObj("s2", { r: 255, g: 0, b: 0, a: 255 }),
      makeShapeObj("s3", { r: 0, g: 255, b: 0, a: 255 })
    );
    const criteria: FindReplaceCriteria = {
      type: "color",
      searchColor: "#ff0000",
    };
    const replacement: FindReplaceReplacement = { replaceColor: "#0000ff" };
    const newDoc = replaceAllInDocument(doc, criteria, replacement);
    const objects = newDoc.scenes[0]!.timeline.layers[0]!.frames[0]!
      .displayObjects as ShapeDisplayObject[];
    const fill0 = objects[0]!.shape.paths[0]!.fill;
    const fill1 = objects[1]!.shape.paths[0]!.fill;
    const fill2 = objects[2]!.shape.paths[0]!.fill;
    expect(fill0?.type === "solid" ? fill0.color.b : -1).toBe(255);
    expect(fill1?.type === "solid" ? fill1.color.b : -1).toBe(255);
    expect(fill2?.type === "solid" ? fill2.color.g : -1).toBe(255);
  });
});

// ---------------------------------------------------------------------------
// description format
// ---------------------------------------------------------------------------

describe("MatchLocation description", () => {
  it("includes scene number, layer name, and frame number", () => {
    const doc = makeDoc(makeTextObj("t1", "Hello"));
    const criteria: FindReplaceCriteria = { type: "text", searchText: "Hello" };
    const matches = findInDocument(doc, criteria);
    expect(matches[0]!.description).toMatch(/Scene 1/);
    expect(matches[0]!.description).toMatch(/Frame 1/);
  });
});
