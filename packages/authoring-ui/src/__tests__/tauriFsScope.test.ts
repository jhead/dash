import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the Tauri core `invoke` so we can observe the command call without a
// running desktop shell.
const invokeMock = vi.fn(async (_cmd: string, _args?: unknown) => undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

import { grantRuntimeFsScope } from "../hooks/tauriFsScope.js";

function setTauri(on: boolean): void {
  const w = globalThis as unknown as { window?: Record<string, unknown> };
  if (on) {
    w.window = { __TAURI_INTERNALS__: {} };
  } else {
    w.window = {};
  }
}

describe("grantRuntimeFsScope (task 1416)", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    invokeMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("is a no-op outside a Tauri shell", async () => {
    setTauri(false);
    await grantRuntimeFsScope("/some/path/movie.fla");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("is a no-op for an empty path", async () => {
    setTauri(true);
    await grantRuntimeFsScope("");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes allow_fs_path with the chosen path in Tauri", async () => {
    setTauri(true);
    await grantRuntimeFsScope("/mnt/projects/out-of-scope/movie.fla");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("allow_fs_path", {
      path: "/mnt/projects/out-of-scope/movie.fla",
    });
  });

  it("swallows command errors (best-effort) so the caller's read/write reports the real error", async () => {
    setTauri(true);
    invokeMock.mockRejectedValueOnce(new Error("scope failure"));
    await expect(
      grantRuntimeFsScope("/mnt/projects/movie.fla")
    ).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
