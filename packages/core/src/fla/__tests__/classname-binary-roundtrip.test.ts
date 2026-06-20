/**
 * AS2 classes (Phase 5): binary Flash 8 .fla className linkage round-trip.
 *
 * The compat-critical piece of the binary FLA export is writing the per-symbol
 * "AS 2.0 class" linkage (`SymbolLinkage.className`) into the Contents stream's
 * CDocumentPage symbol record (the writeAsLinkage block) so real Flash 8 reads
 * the class binding back. This suite proves the WRITE path emits a className that
 * the reader decodes back equal, and — crucially — that the change is strictly
 * additive: an empty-linkage symbol's tail and the empty-document Contents are
 * byte-identical to before, preserving the Flash 8 byte-exact oracle
 * (`empty-bytematch.test.ts`).
 *
 * The decoder (`parseFla8Contents` → the writeAsLinkage block at s.end+41) and
 * the byte layout are themselves verified against `fixtures/golden/golden.fla`'s
 * real "Coin" symbol record (a genuine Flash 8 `exportForActionScript` symbol,
 * className empty there). The strict CArchive reader (`validateContentsStream`,
 * the acceptance bar for content docs per CLAUDE.md) accepting our output is the
 * strongest available structural evidence short of a real Flash 8 oracle for a
 * non-empty className (no such fixture exists). See
 * docs/33-as2-classes-vfs.md (export-compat) for the full investigation.
 */

import { describe, it, expect } from "vitest";
import { createDocument } from "../../model/document.js";
import { createSymbol } from "../../model/library.js";
import { saveRealFla } from "../write/fla-write.js";
import { parseFla8Contents } from "../flash8-binary.js";
import { validateContentsStream } from "../write/carchive-validate.js";
import { __readAllStreamsForTest } from "../ole.js";
import type { FlashDocument, Symbol } from "../../model/types.js";

function docWithSymbols(symbols: Symbol[]): FlashDocument {
  const base = createDocument();
  return { ...base, library: { ...base.library, items: [...base.library.items, ...symbols] } };
}

function contentsOf(doc: FlashDocument): Uint8Array {
  return __readAllStreamsForTest(saveRealFla(doc)).get("Contents")!;
}

describe("binary FLA className linkage — write → read round-trip", () => {
  it("a symbol with a fully-qualified className round-trips through the Symbol record", () => {
    const sym = createSymbol("Ball", "movieclip", {
      linkage: {
        exportForActionScript: true,
        exportInFirstFrame: true,
        linkageIdentifier: "BallLinkage",
        className: "com.example.Ball",
        exportForRuntimeSharing: false,
        importForRuntimeSharing: false,
        sharedUrl: "",
      },
    });
    const info = parseFla8Contents(contentsOf(docWithSymbols([sym])));
    const decoded = info.symbols.get(1)!;
    expect(decoded).toBeDefined();
    expect(decoded.name).toBe("Ball");
    expect(decoded.className).toBe("com.example.Ball");
    // exportForActionScript is carried in the writeAsLinkage flags byte.
    expect(decoded.exportForActionScript).toBe(true);
  });

  it("a top-level (undotted) className round-trips", () => {
    const sym = createSymbol("Coin", "movieclip", {
      linkage: {
        exportForActionScript: true,
        exportInFirstFrame: true,
        linkageIdentifier: "Coin",
        className: "Coin",
        exportForRuntimeSharing: false,
        importForRuntimeSharing: false,
        sharedUrl: "",
      },
    });
    const decoded = parseFla8Contents(contentsOf(docWithSymbols([sym]))).symbols.get(1)!;
    expect(decoded.className).toBe("Coin");
  });

  it("the importForRuntimeSharing flag round-trips via the writeAsLinkage flags byte", () => {
    const sym = createSymbol("Shared", "movieclip", {
      linkage: {
        exportForActionScript: false,
        exportInFirstFrame: true,
        linkageIdentifier: "Shared",
        className: "lib.Shared",
        exportForRuntimeSharing: false,
        importForRuntimeSharing: true,
        sharedUrl: "shared.swf",
      },
    });
    const decoded = parseFla8Contents(contentsOf(docWithSymbols([sym]))).symbols.get(1)!;
    expect(decoded.className).toBe("lib.Shared");
    expect(decoded.importForRuntimeSharing).toBe(true);
  });

  it("decodes the correct className for each of several linked symbols", () => {
    const a = createSymbol("A", "movieclip", {
      linkage: {
        exportForActionScript: true, exportInFirstFrame: true, linkageIdentifier: "A",
        className: "pkg.A", exportForRuntimeSharing: false, importForRuntimeSharing: false, sharedUrl: "",
      },
    });
    const b = createSymbol("B", "graphic"); // no className
    const c = createSymbol("C", "movieclip", {
      linkage: {
        exportForActionScript: true, exportInFirstFrame: true, linkageIdentifier: "C",
        className: "pkg.sub.C", exportForRuntimeSharing: false, importForRuntimeSharing: false, sharedUrl: "",
      },
    });
    const info = parseFla8Contents(contentsOf(docWithSymbols([a, b, c])));
    expect(info.symbols.get(1)!.className).toBe("pkg.A");
    expect(info.symbols.get(2)!.className).toBe("");
    expect(info.symbols.get(3)!.className).toBe("pkg.sub.C");
  });

  it("the written Contents stream is accepted by the strict CArchive validator", () => {
    const sym = createSymbol("Ball", "movieclip", {
      linkage: {
        exportForActionScript: true, exportInFirstFrame: true, linkageIdentifier: "BallLinkage",
        className: "com.example.Ball", exportForRuntimeSharing: false, importForRuntimeSharing: false, sharedUrl: "",
      },
    });
    const contents = contentsOf(docWithSymbols([sym]));
    // Throws on any §5.1/§5.2 CArchive invariant violation; the className splice
    // must not corrupt the running class-index allocator.
    const result = validateContentsStream(contents);
    expect(result.classes).toContain("CDocumentPage");
  });
});

describe("binary FLA className linkage — multi-byte length boundaries (task 1311)", () => {
  // The old `bomStringBytes` wrote the BomString length as a single byte
  // (`s.length & 0xff`), so a className of 254 chars survived but 255/256/300
  // truncated (255 & 0xff = 255 = the 0xff escape marker → reader mis-parses;
  // 256 & 0xff = 0 → empty string; 300 & 0xff = 44 → garbage). With the shared
  // `writeBomLength` escalation these all encode/decode correctly.
  function classNameOfLength(n: number): string {
    // Use only ASCII letters so each char is one UTF-16 code unit (length === n).
    return "C".repeat(n);
  }

  function roundTripClassName(className: string): string {
    const sym = createSymbol("Long", "movieclip", {
      linkage: {
        exportForActionScript: true,
        exportInFirstFrame: true,
        linkageIdentifier: "Long",
        className,
        exportForRuntimeSharing: false,
        importForRuntimeSharing: false,
        sharedUrl: "",
      },
    });
    const contents = contentsOf(docWithSymbols([sym]));
    // The strict CArchive validator must still accept the stream (the longer
    // length prefix must not desync the §5.1/§5.2 allocator).
    validateContentsStream(contents);
    return parseFla8Contents(contents).symbols.get(1)!.className;
  }

  for (const n of [254, 255, 256, 300]) {
    it(`a ${n}-char className encodes and decodes back equal`, () => {
      const className = classNameOfLength(n);
      expect(className.length).toBe(n);
      const decoded = roundTripClassName(className);
      expect(decoded.length).toBe(n);
      expect(decoded).toBe(className);
    });
  }

  it("a realistic long fully-qualified className (>254) round-trips", () => {
    // e.g. com.example.deeply.nested.<...>.VeryLongClassName padded past 254.
    const base = "com.example.deeply.nested.";
    const className = base + "C".repeat(255 - base.length); // 255 total
    expect(className.length).toBe(255);
    expect(roundTripClassName(className)).toBe(className);
  });
});

describe("binary FLA className linkage — empty-linkage path is byte-unchanged", () => {
  it("a symbol with NO className emits the empty-linkage tail (className decodes empty)", () => {
    const sym = createSymbol("Plain", "movieclip"); // default linkage: className ""
    const decoded = parseFla8Contents(contentsOf(docWithSymbols([sym]))).symbols.get(1)!;
    expect(decoded.className).toBe("");
  });

  it("the empty-document Contents is byte-identical regardless of the className change", () => {
    // createDocument() has no symbols, so the symbol-linkage write path is never
    // taken — the empty-bytematch oracle (17312 bytes) is preserved by construction.
    const contents = __readAllStreamsForTest(saveRealFla(createDocument())).get("Contents")!;
    expect(contents.length).toBe(17312);
  });

  it("two consecutive saves of a className-bearing doc are byte-identical (deterministic)", () => {
    const sym = createSymbol("Ball", "movieclip", {
      linkage: {
        exportForActionScript: true, exportInFirstFrame: true, linkageIdentifier: "BallLinkage",
        className: "com.example.Ball", exportForRuntimeSharing: false, importForRuntimeSharing: false, sharedUrl: "",
      },
    });
    const doc = docWithSymbols([sym]);
    const a = saveRealFla(doc);
    const b = saveRealFla(doc);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
