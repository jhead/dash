/**
 * Unit tests for library folder CRUD operations:
 * addLibraryFolder, removeLibraryFolder, renameLibraryFolder,
 * getFoldersInFolder, createLibraryFolder, createLibrary.
 */

import { describe, it, expect } from "vitest";
import {
  createLibrary,
  createLibraryFolder,
  addLibraryFolder,
  removeLibraryFolder,
  renameLibraryFolder,
  getFoldersInFolder,
} from "../library.js";
import type { Library } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLibraryWithFolder(name = "Assets"): {
  library: Library;
  folderId: string;
} {
  const folder = createLibraryFolder(name);
  const library = addLibraryFolder(createLibrary(), folder);
  return { library, folderId: folder.id };
}

// ---------------------------------------------------------------------------
// createLibrary — initial state
// ---------------------------------------------------------------------------

describe("createLibrary", () => {
  it("has empty folders array initially", () => {
    const library = createLibrary();
    expect(library.folders).toHaveLength(0);
  });

  it("has empty items array initially", () => {
    const library = createLibrary();
    expect(library.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addLibraryFolder
// ---------------------------------------------------------------------------

describe("addLibraryFolder", () => {
  it("adds a folder to the library", () => {
    const { library } = makeLibraryWithFolder("Sprites");
    expect(library.folders).toHaveLength(1);
  });

  it("increases folder count by 1", () => {
    const base = createLibrary();
    const folder1 = createLibraryFolder("A");
    const lib1 = addLibraryFolder(base, folder1);
    const folder2 = createLibraryFolder("B");
    const lib2 = addLibraryFolder(lib1, folder2);
    expect(lib2.folders).toHaveLength(2);
  });

  it("does not mutate the original library", () => {
    const base = createLibrary();
    const folder = createLibraryFolder("Effects");
    addLibraryFolder(base, folder);
    expect(base.folders).toHaveLength(0);
  });

  it("sets the correct name on the added folder", () => {
    const { library } = makeLibraryWithFolder("Backgrounds");
    expect(library.folders[0]!.name).toBe("Backgrounds");
  });

  it("creates a nested folder with the correct parentFolderId", () => {
    const parent = createLibraryFolder("Parent");
    const lib1 = addLibraryFolder(createLibrary(), parent);
    const child = createLibraryFolder("Child", parent.id);
    const lib2 = addLibraryFolder(lib1, child);
    const childFolder = lib2.folders.find((f) => f.id === child.id)!;
    expect(childFolder.parentFolderId).toBe(parent.id);
  });

  it("preserves existing folders when adding a new one", () => {
    const { library, folderId } = makeLibraryWithFolder("First");
    const second = createLibraryFolder("Second");
    const result = addLibraryFolder(library, second);
    expect(result.folders.some((f) => f.id === folderId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeLibraryFolder
// ---------------------------------------------------------------------------

describe("removeLibraryFolder", () => {
  it("removes the folder by id", () => {
    const { library, folderId } = makeLibraryWithFolder("ToRemove");
    const result = removeLibraryFolder(library, folderId);
    expect(result.folders.some((f) => f.id === folderId)).toBe(false);
  });

  it("does not mutate the original library", () => {
    const { library, folderId } = makeLibraryWithFolder("Original");
    removeLibraryFolder(library, folderId);
    expect(library.folders).toHaveLength(1);
  });

  it("is a no-op for a non-existent id", () => {
    const { library } = makeLibraryWithFolder("Keep");
    const result = removeLibraryFolder(library, "nonexistent-id");
    expect(result.folders).toHaveLength(1);
  });

  it("only removes the targeted folder, leaving others intact", () => {
    const folder1 = createLibraryFolder("Keep");
    const folder2 = createLibraryFolder("Remove");
    const library = addLibraryFolder(
      addLibraryFolder(createLibrary(), folder1),
      folder2
    );
    const result = removeLibraryFolder(library, folder2.id);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0]!.id).toBe(folder1.id);
  });
});

// ---------------------------------------------------------------------------
// renameLibraryFolder
// ---------------------------------------------------------------------------

describe("renameLibraryFolder", () => {
  it("updates the folder name", () => {
    const { library, folderId } = makeLibraryWithFolder("OldName");
    const result = renameLibraryFolder(library, folderId, "NewName");
    const folder = result.folders.find((f) => f.id === folderId)!;
    expect(folder.name).toBe("NewName");
  });

  it("does not mutate the original library", () => {
    const { library, folderId } = makeLibraryWithFolder("Original");
    renameLibraryFolder(library, folderId, "Renamed");
    expect(library.folders[0]!.name).toBe("Original");
  });

  it("only affects the targeted folder", () => {
    const folder1 = createLibraryFolder("Alpha");
    const folder2 = createLibraryFolder("Beta");
    const library = addLibraryFolder(
      addLibraryFolder(createLibrary(), folder1),
      folder2
    );
    const result = renameLibraryFolder(library, folder1.id, "AlphaRenamed");
    const f2 = result.folders.find((f) => f.id === folder2.id)!;
    expect(f2.name).toBe("Beta");
  });

  it("returns library unchanged when id not found", () => {
    const { library } = makeLibraryWithFolder("Folder");
    const result = renameLibraryFolder(library, "nonexistent-id", "NewName");
    expect(result).toBe(library);
  });
});

// ---------------------------------------------------------------------------
// getFoldersInFolder
// ---------------------------------------------------------------------------

describe("getFoldersInFolder", () => {
  it("returns top-level folders when parentFolderId is null", () => {
    const top1 = createLibraryFolder("Top1", null);
    const top2 = createLibraryFolder("Top2", null);
    const library = addLibraryFolder(
      addLibraryFolder(createLibrary(), top1),
      top2
    );
    const results = getFoldersInFolder(library, null);
    expect(results).toHaveLength(2);
  });

  it("returns child folders for a given parentFolderId", () => {
    const parent = createLibraryFolder("Parent", null);
    const child = createLibraryFolder("Child", parent.id);
    const library = addLibraryFolder(
      addLibraryFolder(createLibrary(), parent),
      child
    );
    const results = getFoldersInFolder(library, parent.id);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(child.id);
  });

  it("returns empty array when no children exist", () => {
    const { library, folderId } = makeLibraryWithFolder("Lonely");
    const results = getFoldersInFolder(library, folderId);
    expect(results).toHaveLength(0);
  });
});
