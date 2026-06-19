import { describe, it, expect, beforeEach } from "vitest";
import { WebClassVfs, isOpfsAvailable } from "../vfs/opfs.js";

// ---------------------------------------------------------------------------
// A minimal in-memory fake of the OPFS FileSystem*Handle API surface that
// WebClassVfs touches: getDirectoryHandle, getFileHandle, createWritable,
// getFile().text(), entries(), keys(), removeEntry. Lets us exercise the OPFS
// backend under Node/vitest (no real OPFS in the test env).
// ---------------------------------------------------------------------------

class FakeFile {
  constructor(public data: string) {}
  text(): Promise<string> {
    return Promise.resolve(this.data);
  }
}

class FakeWritable {
  constructor(private file: FakeFile) {}
  write(s: string): Promise<void> {
    this.file.data = s;
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeFileHandle {
  readonly kind = "file" as const;
  constructor(public file: FakeFile) {}
  getFile(): Promise<FakeFile> {
    return Promise.resolve(this.file);
  }
  createWritable(): Promise<FakeWritable> {
    return Promise.resolve(new FakeWritable(this.file));
  }
}

class FakeDirHandle {
  readonly kind = "directory" as const;
  dirs = new Map<string, FakeDirHandle>();
  files = new Map<string, FakeFileHandle>();

  getDirectoryHandle(
    name: string,
    opts?: { create?: boolean }
  ): Promise<FakeDirHandle> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) {
        return Promise.reject(new DOMException("NotFound", "NotFoundError"));
      }
      d = new FakeDirHandle();
      this.dirs.set(name, d);
    }
    return Promise.resolve(d);
  }

  getFileHandle(
    name: string,
    opts?: { create?: boolean }
  ): Promise<FakeFileHandle> {
    let f = this.files.get(name);
    if (!f) {
      if (!opts?.create) {
        return Promise.reject(new DOMException("NotFound", "NotFoundError"));
      }
      f = new FakeFileHandle(new FakeFile(""));
      this.files.set(name, f);
    }
    return Promise.resolve(f);
  }

  removeEntry(name: string): Promise<void> {
    if (this.files.delete(name) || this.dirs.delete(name)) {
      return Promise.resolve();
    }
    return Promise.reject(new DOMException("NotFound", "NotFoundError"));
  }

  async *entries(): AsyncGenerator<[string, FakeDirHandle | FakeFileHandle]> {
    for (const [name, d] of this.dirs) yield [name, d];
    for (const [name, f] of this.files) yield [name, f];
  }

  async *keys(): AsyncGenerator<string> {
    for (const name of this.dirs.keys()) yield name;
    for (const name of this.files.keys()) yield name;
  }
}

/** Override the (getter-only in Node) global `navigator` via defineProperty. */
function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, "navigator", {
    value,
    writable: true,
    configurable: true,
  });
}

function installFakeOpfs(): FakeDirHandle {
  const origin = new FakeDirHandle();
  setNavigator({
    storage: {
      getDirectory: () =>
        Promise.resolve(origin as unknown as FileSystemDirectoryHandle),
    },
  });
  return origin;
}

describe("isOpfsAvailable", () => {
  it("is false without navigator.storage.getDirectory", () => {
    setNavigator({});
    expect(isOpfsAvailable()).toBe(false);
  });

  it("is true once navigator.storage.getDirectory exists", () => {
    installFakeOpfs();
    expect(isOpfsAvailable()).toBe(true);
  });
});

describe("WebClassVfs (OPFS backend)", () => {
  beforeEach(() => {
    installFakeOpfs();
  });

  it("reports kind opfs", () => {
    expect(new WebClassVfs().kind).toBe("opfs");
  });

  it("write maps packages to nested directories and read returns source", async () => {
    const vfs = new WebClassVfs();
    await vfs.write("com/example/Foo.as", "class Foo {}");
    expect(await vfs.read("com/example/Foo.as")).toBe("class Foo {}");
    expect(await vfs.exists("com/example/Foo.as")).toBe(true);
  });

  it("read of a missing file returns null (not throw)", async () => {
    const vfs = new WebClassVfs();
    expect(await vfs.read("nope/Missing.as")).toBeNull();
    expect(await vfs.exists("nope/Missing.as")).toBe(false);
  });

  it("list returns every file as a classpath-relative path", async () => {
    const vfs = new WebClassVfs();
    await vfs.write("com/example/Foo.as", "a");
    await vfs.write("com/example/Bar.as", "b");
    await vfs.write("Top.as", "c");
    const paths = (await vfs.list()).map((e) => e.path).sort();
    expect(paths).toEqual(["Top.as", "com/example/Bar.as", "com/example/Foo.as"]);
  });

  it("list on an empty (never-created) store returns []", async () => {
    const vfs = new WebClassVfs();
    expect(await vfs.list()).toEqual([]);
  });

  it("overwrites an existing file", async () => {
    const vfs = new WebClassVfs();
    await vfs.write("Foo.as", "v1");
    await vfs.write("Foo.as", "v2");
    expect(await vfs.read("Foo.as")).toBe("v2");
  });

  it("remove deletes the file and prunes empty package dirs", async () => {
    const vfs = new WebClassVfs();
    await vfs.write("com/example/Foo.as", "x");
    await vfs.remove("com/example/Foo.as");
    expect(await vfs.exists("com/example/Foo.as")).toBe(false);
    expect(await vfs.list()).toEqual([]);
  });

  it("remove keeps sibling files in a shared package dir", async () => {
    const vfs = new WebClassVfs();
    await vfs.write("com/Foo.as", "x");
    await vfs.write("com/Bar.as", "y");
    await vfs.remove("com/Foo.as");
    expect((await vfs.list()).map((e) => e.path)).toEqual(["com/Bar.as"]);
  });

  it("remove of a missing file is a no-op", async () => {
    const vfs = new WebClassVfs();
    await expect(vfs.remove("gone.as")).resolves.toBeUndefined();
  });

  it("scopes under the configured root dir name", async () => {
    const origin = installFakeOpfs();
    const vfs = new WebClassVfs({ rootDirName: "proj-42" });
    await vfs.write("Foo.as", "x");
    expect(origin.dirs.has("proj-42")).toBe(true);
  });
});
