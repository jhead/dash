import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @tauri-apps/plugin-fs with an in-memory POSIX-ish filesystem so the
// TauriClassVfs disk-mirror logic (path joining, recursive mkdir, recursive
// readDir walk, exists/read/write/remove) is exercised under Node.
// ---------------------------------------------------------------------------

const files = new Map<string, string>(); // abs path -> content
const dirs = new Set<string>(); // abs dir paths

function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn((path: string, opts?: { recursive?: boolean }) => {
    const p = norm(path);
    const segs = p.split("/");
    // Register the dir and (if recursive) every ancestor.
    for (let i = 1; i <= segs.length; i++) {
      dirs.add(segs.slice(0, i).join("/"));
      if (!opts?.recursive) break;
    }
    dirs.add(p);
    return Promise.resolve();
  }),
  exists: vi.fn((path: string) => {
    const p = norm(path);
    return Promise.resolve(files.has(p) || dirs.has(p));
  }),
  readTextFile: vi.fn((path: string) => {
    const p = norm(path);
    if (!files.has(p)) return Promise.reject(new Error("ENOENT"));
    return Promise.resolve(files.get(p)!);
  }),
  writeTextFile: vi.fn((path: string, data: string) => {
    files.set(norm(path), data);
    return Promise.resolve();
  }),
  remove: vi.fn((path: string) => {
    const p = norm(path);
    if (files.delete(p) || dirs.delete(p)) return Promise.resolve();
    return Promise.reject(new Error("ENOENT"));
  }),
  readDir: vi.fn((path: string) => {
    const p = norm(path);
    const prefix = p + "/";
    const names = new Map<string, { isDirectory: boolean; isFile: boolean }>();
    for (const f of files.keys()) {
      if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length);
        const first = rest.split("/")[0]!;
        const isLeaf = rest === first;
        names.set(first, {
          isDirectory: !isLeaf,
          isFile: isLeaf,
        });
      }
    }
    for (const d of dirs) {
      if (d.startsWith(prefix)) {
        const rest = d.slice(prefix.length);
        const first = rest.split("/")[0]!;
        if (first && !names.has(first)) {
          names.set(first, { isDirectory: true, isFile: false });
        }
      }
    }
    return Promise.resolve(
      [...names.entries()].map(([name, meta]) => ({ name, ...meta }))
    );
  }),
}));

import {
  TauriClassVfs,
  deriveClassesRoot,
  isTauri,
} from "../vfs/tauri.js";

const ROOT = "/Users/me/game/classes";

describe("deriveClassesRoot", () => {
  it("derives classes/ beside the .fla path", () => {
    expect(deriveClassesRoot("/Users/me/game/movie.fla")).toBe(
      "/Users/me/game/classes"
    );
  });
  it("handles Windows backslash paths", () => {
    expect(deriveClassesRoot("C:\\proj\\movie.fla")).toBe("C:/proj/classes");
  });
  it("returns null for a bare filename", () => {
    expect(deriveClassesRoot("movie.fla")).toBeNull();
  });
});

describe("isTauri", () => {
  it("is false in the test (no __TAURI_INTERNALS__)", () => {
    expect(isTauri()).toBe(false);
  });
});

describe("TauriClassVfs (native FS disk mirror)", () => {
  beforeEach(() => {
    files.clear();
    dirs.clear();
  });

  it("reports kind tauri", () => {
    expect(new TauriClassVfs({ classesRoot: ROOT }).kind).toBe("tauri");
  });

  it("write creates nested package dirs as REAL files under classes/", async () => {
    const vfs = new TauriClassVfs({ classesRoot: ROOT });
    await vfs.write("com/example/Foo.as", "class Foo {}");
    // The actual on-disk path mirrors the classpath under the root.
    expect(files.get(`${ROOT}/com/example/Foo.as`)).toBe("class Foo {}");
    expect(await vfs.read("com/example/Foo.as")).toBe("class Foo {}");
    expect(await vfs.exists("com/example/Foo.as")).toBe(true);
  });

  it("read of a missing file returns null", async () => {
    const vfs = new TauriClassVfs({ classesRoot: ROOT });
    expect(await vfs.read("nope/Missing.as")).toBeNull();
    expect(await vfs.exists("nope/Missing.as")).toBe(false);
  });

  it("list on a non-existent root returns []", async () => {
    const vfs = new TauriClassVfs({ classesRoot: ROOT });
    expect(await vfs.list()).toEqual([]);
  });

  it("list walks the tree and returns classpath-relative .as paths only", async () => {
    const vfs = new TauriClassVfs({ classesRoot: ROOT });
    await vfs.write("com/example/Foo.as", "a");
    await vfs.write("com/Bar.as", "b");
    await vfs.write("Top.as", "c");
    // a stray non-.as file should be ignored
    files.set(`${ROOT}/README.txt`, "ignore");
    const paths = (await vfs.list()).map((e) => e.path).sort();
    expect(paths).toEqual(["Top.as", "com/Bar.as", "com/example/Foo.as"]);
  });

  it("remove deletes a file; remove of a missing file is a no-op", async () => {
    const vfs = new TauriClassVfs({ classesRoot: ROOT });
    await vfs.write("Foo.as", "x");
    await vfs.remove("Foo.as");
    expect(await vfs.exists("Foo.as")).toBe(false);
    await expect(vfs.remove("Foo.as")).resolves.toBeUndefined();
  });

  it("tolerates a trailing slash on the classes root", async () => {
    const vfs = new TauriClassVfs({ classesRoot: `${ROOT}/` });
    await vfs.write("Foo.as", "x");
    expect(files.get(`${ROOT}/Foo.as`)).toBe("x");
  });
});
