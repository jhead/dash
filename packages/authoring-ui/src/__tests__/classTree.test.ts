import { describe, it, expect } from "vitest";
import {
  buildClassTree,
  listTreeFiles,
  classNameToPath,
  classNameFromPath,
  dottedNameFromPath,
  validateClassPath,
  defaultClassSource,
} from "../classTree.js";

describe("buildClassTree", () => {
  it("nests package folders and sorts folders-before-files", () => {
    const tree = buildClassTree([
      "com/example/Foo.as",
      "com/example/Bar.as",
      "Top.as",
      "com/util/Helper.as",
    ]);
    // Top-level: folder "com" first, then file "Top.as".
    expect(tree.children.map((c) => `${c.kind}:${c.name}`)).toEqual([
      "folder:com",
      "file:Top.as",
    ]);
    const com = tree.children.find((c) => c.name === "com");
    expect(com?.kind).toBe("folder");
    if (com?.kind !== "folder") throw new Error("expected folder");
    // com -> example, util (folders, alphabetical)
    expect(com.children.map((c) => c.name)).toEqual(["example", "util"]);
    const example = com.children.find((c) => c.name === "example");
    if (example?.kind !== "folder") throw new Error("expected folder");
    // Files sorted alphabetically within the package.
    expect(example.children.map((c) => c.name)).toEqual(["Bar.as", "Foo.as"]);
  });

  it("ignores non-.as paths and skips unsafe paths", () => {
    const tree = buildClassTree([
      "com/Foo.as",
      "README.md",
      "../escape.as",
      "",
    ]);
    expect(listTreeFiles(tree).map((f) => f.path)).toEqual(["com/Foo.as"]);
  });

  it("listTreeFiles returns leaf files in display order", () => {
    const tree = buildClassTree(["b/Z.as", "a/Y.as", "Root.as"]);
    expect(listTreeFiles(tree).map((f) => f.path)).toEqual([
      "a/Y.as",
      "b/Z.as",
      "Root.as",
    ]);
  });
});

describe("classNameToPath", () => {
  it("converts a dotted AS2 name into a slashed .as path", () => {
    expect(classNameToPath("com.example.Foo")).toBe("com/example/Foo.as");
  });
  it("accepts a slashed path and appends .as", () => {
    expect(classNameToPath("com/example/Foo")).toBe("com/example/Foo.as");
  });
  it("leaves an explicit .as path alone", () => {
    expect(classNameToPath("com/example/Foo.as")).toBe("com/example/Foo.as");
    expect(classNameToPath("Bar.as")).toBe("Bar.as");
  });
  it("handles a bare top-level class", () => {
    expect(classNameToPath("Main")).toBe("Main.as");
  });
  it("throws on empty input", () => {
    expect(() => classNameToPath("   ")).toThrow();
  });
});

describe("classNameFromPath / dottedNameFromPath", () => {
  it("extracts the leaf class name", () => {
    expect(classNameFromPath("com/example/Foo.as")).toBe("Foo");
    expect(classNameFromPath("Main.as")).toBe("Main");
  });
  it("derives the dotted identifier", () => {
    expect(dottedNameFromPath("com/example/Foo.as")).toBe("com.example.Foo");
    expect(dottedNameFromPath("Main.as")).toBe("Main");
  });
});

describe("validateClassPath", () => {
  const existing = new Set(["com/example/Foo.as", "Bar.as"]);

  it("accepts a fresh, valid path", () => {
    expect(validateClassPath("com/example/Baz.as", existing)).toBeNull();
  });
  it("rejects a duplicate", () => {
    expect(validateClassPath("com/example/Foo.as", existing)).toMatch(/already exists/);
  });
  it("allows the unchanged self-path on rename", () => {
    expect(
      validateClassPath("com/example/Foo.as", existing, "com/example/Foo.as")
    ).toBeNull();
  });
  it("rejects a non-.as path", () => {
    expect(validateClassPath("com/example/Foo", existing)).toMatch(/\.as/);
  });
  it("rejects invalid identifier segments", () => {
    expect(validateClassPath("com/9bad/Foo.as", existing)).toMatch(/package segment/);
    expect(validateClassPath("com/example/1Foo.as", existing)).toMatch(/class name/);
  });
  it("rejects traversal", () => {
    expect(validateClassPath("../Foo.as", existing)).toMatch(/Invalid class path/);
  });
});

describe("defaultClassSource", () => {
  it("emits a class + constructor stub with the dotted name", () => {
    const src = defaultClassSource("com/example/Foo.as");
    expect(src).toContain("class com.example.Foo");
    expect(src).toContain("function Foo()");
  });
});
