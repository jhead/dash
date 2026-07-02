import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Integration proof for task 1416: opening a .fla (and publishing a .swf) at a
// path OUTSIDE the narrowed static fs scope (task 1394) grants a per-file
// runtime scope via `allow_fs_path` BEFORE the fs read/write is attempted.
// ---------------------------------------------------------------------------

const calls: string[] = []; // ordered log of side-effecting operations

const invokeMock = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
  calls.push(`invoke:${cmd}:${String(args.path)}`);
  return undefined;
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => invokeMock(cmd, args),
}));

const OUT_OF_SCOPE = "/mnt/data/projects/out-of-scope/movie.fla";
const OUT_OF_SCOPE_SWF = "/mnt/data/projects/out-of-scope/movie.swf";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => OUT_OF_SCOPE),
  save: vi.fn(async () => OUT_OF_SCOPE_SWF),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(async (path: string) => {
    calls.push(`readFile:${path}`);
    return new Uint8Array([1, 2, 3]);
  }),
  writeFile: vi.fn(async (path: string) => {
    calls.push(`writeFile:${path}`);
  }),
}));

// Minimal @flash/core surface used by the hooks under test. `library.items` is
// present because usePublish's compile pre-pass filters it for bitmaps.
const fakeDoc = { __fake: "doc", library: { items: [] } } as unknown;
vi.mock("@flash/core", () => ({
  createDocument: vi.fn(() => fakeDoc),
  createBitmap: vi.fn(),
  createSound: vi.fn(),
  saveFla: vi.fn(() => new Uint8Array([9])),
  saveRealFla: vi.fn(() => new Uint8Array([9])),
  loadFla: vi.fn(() => fakeDoc),
}));

// usePublish also pulls in @flash/swf; stub the compile surface it imports.
vi.mock("@flash/swf", () => ({
  compileDocument: vi.fn(() => new Uint8Array([7])),
  collectFontFaceRequests: vi.fn(() => []),
  resolveFontGlyphSources: vi.fn(async () => new Map()),
}));

import { useFileActions } from "../hooks/useFileActions.js";
import { usePublish } from "../hooks/usePublish.js";

beforeEach(() => {
  calls.length = 0;
  invokeMock.mockClear();
  (globalThis as unknown as { window?: Record<string, unknown> }).window = {
    __TAURI_INTERNALS__: {},
  };
});
afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("useFileActions.openDocument runtime fs scope (task 1416)", () => {
  it("grants a per-file scope for the chosen path BEFORE reading it", async () => {
    const { openDocument } = useFileActions();
    const doc = await openDocument();

    expect(doc).toBe(fakeDoc);
    expect(invokeMock).toHaveBeenCalledWith("allow_fs_path", { path: OUT_OF_SCOPE });

    const grantIdx = calls.indexOf(`invoke:allow_fs_path:${OUT_OF_SCOPE}`);
    const readIdx = calls.indexOf(`readFile:${OUT_OF_SCOPE}`);
    expect(grantIdx).toBeGreaterThanOrEqual(0);
    expect(readIdx).toBeGreaterThan(grantIdx);
  });
});

describe("usePublish.publishToFile runtime fs scope (task 1416)", () => {
  it("grants a per-file scope for the chosen output path BEFORE writing it", async () => {
    const { publishToFile } = usePublish(fakeDoc as never);
    await publishToFile();

    expect(invokeMock).toHaveBeenCalledWith("allow_fs_path", {
      path: OUT_OF_SCOPE_SWF,
    });

    const grantIdx = calls.indexOf(`invoke:allow_fs_path:${OUT_OF_SCOPE_SWF}`);
    const writeIdx = calls.indexOf(`writeFile:${OUT_OF_SCOPE_SWF}`);
    expect(grantIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(grantIdx);
  });
});
