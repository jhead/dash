/**
 * AS2 class support (Phase 0): document-model + dash `.fla` persistence.
 *
 * Covers:
 *  - asClasses / classpaths zip round-trip via saveFla -> loadFla
 *  - the addAsClass / updateAsClass / removeAsClass mutations
 *  - a document WITHOUT classes serializes byte-identically as before
 *  - the binary Flash 8 FLA export (saveRealFla) is unaffected by asClasses
 */

import { describe, it, expect } from "vitest";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { createDocument } from "../../model/document.js";
import { saveFla, loadFla, saveRealFla } from "../zip.js";
import {
  addAsClass,
  updateAsClass,
  removeAsClass,
} from "../../model/document-mutations.js";
import type { FlashDocument, AsClassFile } from "../../model/types.js";

const FOO: AsClassFile = {
  path: "com/example/Foo.as",
  source: "class com.example.Foo {\n  function Foo() {}\n}\n",
};
const BAR: AsClassFile = {
  path: "Bar.as",
  source: "class Bar {}\n",
};

describe("AS2 classes — zip round-trip", () => {
  it("preserves asClasses through saveFla -> loadFla", () => {
    const doc: FlashDocument = {
      ...createDocument(),
      asClasses: [FOO, BAR],
    };
    const restored = loadFla(saveFla(doc));
    expect(restored.asClasses).toEqual([
      // entries are returned sorted by path: "Bar.as" < "com/example/Foo.as"
      BAR,
      FOO,
    ]);
  });

  it("writes each class as a classes/<path> zip entry AND keeps it inline in document.json", () => {
    const doc: FlashDocument = { ...createDocument(), asClasses: [FOO, BAR] };
    const entries = unzipSync(saveFla(doc));

    // Authoritative zip entries
    expect(entries["classes/com/example/Foo.as"]).toBeDefined();
    expect(strFromU8(entries["classes/com/example/Foo.as"])).toBe(FOO.source);
    expect(strFromU8(entries["classes/Bar.as"])).toBe(BAR.source);

    // Inline copy in document.json (fallback)
    const payload = JSON.parse(strFromU8(entries["document.json"])) as {
      document: FlashDocument;
    };
    expect(payload.document.asClasses).toEqual([FOO, BAR]);
  });

  it("defaults classpaths to ['.'] when a doc has classes but no explicit classpaths", () => {
    const doc: FlashDocument = { ...createDocument(), asClasses: [FOO] };
    const restored = loadFla(saveFla(doc));
    expect(restored.classpaths).toEqual(["."]);
  });

  it("preserves explicit classpaths through round-trip", () => {
    const doc: FlashDocument = {
      ...createDocument(),
      asClasses: [FOO],
      classpaths: [".", "lib", "../shared"],
    };
    const restored = loadFla(saveFla(doc));
    expect(restored.classpaths).toEqual([".", "lib", "../shared"]);
  });

  it("prefers the classes/ zip entries over the inline document.json copy", () => {
    // Hand-craft an archive whose inline asClasses disagrees with the zip entry.
    const doc: FlashDocument = { ...createDocument(), asClasses: [FOO] };
    const bytes = saveFla(doc);
    const entries = unzipSync(bytes);

    // Tamper: zip entry says "ZIP WINS", inline document.json says "INLINE".
    const winning = "// ZIP WINS\n";
    const payload = JSON.parse(strFromU8(entries["document.json"])) as {
      document: FlashDocument;
    };
    (payload.document as { asClasses: AsClassFile[] }).asClasses = [
      { path: FOO.path, source: "// INLINE\n" },
    ];

    const tampered = zipSync({
      "document.json": strToU8(JSON.stringify(payload)),
      [`classes/${FOO.path}`]: strToU8(winning),
    });

    const restored = loadFla(tampered);
    expect(restored.asClasses).toEqual([{ path: FOO.path, source: winning }]);
  });

  it("falls back to inline asClasses when no classes/ entries exist", () => {
    // Archive with inline asClasses but no classes/ entries.
    const doc: FlashDocument = { ...createDocument(), asClasses: [FOO] };
    // Serialize document.json only (no classes/ entries), like a writer that
    // only persisted inline.
    const inlineOnly = zipSync({
      "document.json": strToU8(
        JSON.stringify({
          schemaVersion: 2,
          version: "1",
          flashVersion: "8",
          document: doc,
        }),
      ),
    });
    const restored = loadFla(inlineOnly);
    expect(restored.asClasses).toEqual([FOO]);
    expect(restored.classpaths).toEqual(["."]);
  });

  it("leaves asClasses and classpaths UNSET on a document with no classes", () => {
    const doc = createDocument();
    const restored = loadFla(saveFla(doc));
    expect(restored.asClasses).toBeUndefined();
    expect(restored.classpaths).toBeUndefined();
  });
});

describe("AS2 classes — no-regression for class-free documents", () => {
  it("a doc WITHOUT classes serializes byte-identically before and after the AS2 fields exist", () => {
    // The pre-AS2 archive shape is: only assets/* + document.json, and
    // document.json has no asClasses/classpaths keys. A freshly created doc has
    // neither field set, so saveFla must not introduce any classes/ entry nor
    // any asClasses/classpaths key.
    const doc = createDocument();
    const entries = unzipSync(saveFla(doc));
    const keys = Object.keys(entries);
    expect(keys.some((k) => k.startsWith("classes/"))).toBe(false);

    const json = strFromU8(entries["document.json"]);
    expect(json).not.toContain("asClasses");
    expect(json).not.toContain("classpaths");

    // And the two serializations are byte-identical to each other (determinism).
    const a = saveFla(doc);
    const b = saveFla(doc);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("AS2 classes — binary Flash 8 export unaffected", () => {
  it("saveRealFla output is byte-identical with vs without asClasses", () => {
    const base = createDocument();
    const withClasses: FlashDocument = {
      ...base,
      asClasses: [FOO, BAR],
      classpaths: [".", "lib"],
    };
    const a = saveRealFla(base);
    const b = saveRealFla(withClasses);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("AS2 classes — document mutations", () => {
  it("addAsClass adds a class (immutably) and is history-safe", () => {
    const doc = createDocument();
    const next = addAsClass(doc, FOO);
    expect(next).not.toBe(doc);
    expect(doc.asClasses).toBeUndefined(); // original untouched
    expect(next.asClasses).toEqual([FOO]);
  });

  it("addAsClass appends a second distinct class", () => {
    const doc = addAsClass(createDocument(), FOO);
    const next = addAsClass(doc, BAR);
    expect(next.asClasses).toEqual([FOO, BAR]);
  });

  it("addAsClass on an existing path replaces (upsert) in place", () => {
    const doc = addAsClass(addAsClass(createDocument(), FOO), BAR);
    const replaced = addAsClass(doc, { path: FOO.path, source: "// new\n" });
    expect(replaced.asClasses).toEqual([
      { path: FOO.path, source: "// new\n" },
      BAR,
    ]);
  });

  it("updateAsClass updates the source of an existing class", () => {
    const doc = addAsClass(createDocument(), FOO);
    const next = updateAsClass(doc, FOO.path, "// updated\n");
    expect(next).not.toBe(doc);
    expect(next.asClasses).toEqual([{ path: FOO.path, source: "// updated\n" }]);
  });

  it("updateAsClass is a no-op when the path does not exist", () => {
    const doc = addAsClass(createDocument(), FOO);
    const next = updateAsClass(doc, "does/not/Exist.as", "// x\n");
    expect(next).toBe(doc);
  });

  it("removeAsClass removes a class by path", () => {
    const doc = addAsClass(addAsClass(createDocument(), FOO), BAR);
    const next = removeAsClass(doc, FOO.path);
    expect(next).not.toBe(doc);
    expect(next.asClasses).toEqual([BAR]);
  });

  it("removeAsClass is a no-op when the path does not exist", () => {
    const doc = addAsClass(createDocument(), FOO);
    const next = removeAsClass(doc, "nope.as");
    expect(next).toBe(doc);
  });

  it("mutations survive a save -> load round-trip", () => {
    let doc: FlashDocument = createDocument();
    doc = addAsClass(doc, FOO);
    doc = addAsClass(doc, BAR);
    doc = updateAsClass(doc, BAR.path, "// bar v2\n");
    doc = removeAsClass(doc, FOO.path);
    const restored = loadFla(saveFla(doc));
    expect(restored.asClasses).toEqual([{ path: BAR.path, source: "// bar v2\n" }]);
  });
});
