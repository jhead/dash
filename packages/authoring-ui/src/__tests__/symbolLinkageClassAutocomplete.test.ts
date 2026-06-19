/**
 * AS2 classes (Phase 5): Symbol Linkage dialog "AS2 Class" autocomplete source.
 *
 * The dialog offers fully-qualified class names from `doc.asClasses` as
 * datalist suggestions for the AS2 Class field. The list is derived by
 * `deriveAsClassNames` (LibraryPanel): classpath-relative `.as` paths map to
 * dotted class names, de-duplicated and sorted.
 */

import { describe, it, expect } from "vitest";
import { createDocument } from "@flash/core";
import type { FlashDocument, AsClassFile } from "@flash/core";
import { deriveAsClassNames } from "../LibraryPanel";

function docWith(asClasses: AsClassFile[] | undefined): FlashDocument {
  return { ...createDocument(), asClasses } as FlashDocument;
}

describe("deriveAsClassNames — AS2 Class autocomplete source", () => {
  it("maps a packaged .as path to a dotted fully-qualified class name", () => {
    const doc = docWith([{ path: "com/example/Ball.as", source: "" }]);
    expect(deriveAsClassNames(doc)).toEqual(["com.example.Ball"]);
  });

  it("maps a top-level .as path to a bare class name", () => {
    const doc = docWith([{ path: "Coin.as", source: "" }]);
    expect(deriveAsClassNames(doc)).toEqual(["Coin"]);
  });

  it("returns a sorted, de-duplicated list across many classes", () => {
    const doc = docWith([
      { path: "com/example/Zed.as", source: "" },
      { path: "com/example/Ball.as", source: "" },
      { path: "Coin.as", source: "" },
      { path: "com/example/Ball.as", source: "// dup path" },
    ]);
    expect(deriveAsClassNames(doc)).toEqual([
      "Coin",
      "com.example.Ball",
      "com.example.Zed",
    ]);
  });

  it("ignores non-.as files and leading slashes / backslashes", () => {
    const doc = docWith([
      { path: "/com/example/Foo.as", source: "" },
      { path: "lib\\sub\\Bar.as", source: "" },
      { path: "notes.txt", source: "" },
    ]);
    expect(deriveAsClassNames(doc)).toEqual(["com.example.Foo", "lib.sub.Bar"]);
  });

  it("returns an empty list when the doc has no asClasses", () => {
    expect(deriveAsClassNames(docWith(undefined))).toEqual([]);
    expect(deriveAsClassNames(docWith([]))).toEqual([]);
    expect(deriveAsClassNames(undefined)).toEqual([]);
  });
});
