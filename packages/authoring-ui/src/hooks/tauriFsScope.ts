import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Runtime filesystem-scope granting for dialog-chosen paths (task 1416).
//
// Task 1394 narrowed the desktop app's STATIC fs capability
// (apps/desktop/src-tauri/capabilities/default.json) from the whole home
// directory to the user content dirs (Documents/Downloads/Desktop + media
// folders). As a result, a `.fla` — or any file the user picks via a native
// open/save dialog — located outside those dirs is no longer readable/writable
// by the webview's fs plugin.
//
// This helper bridges the native dialog result back to the Rust `allow_fs_path`
// command (src-tauri/src/lib.rs), which grants a PER-FILE runtime scope for the
// exact path the user chose. The static capability stays narrow; only files the
// user explicitly selects become accessible, and only for the app session.
// ---------------------------------------------------------------------------

/** True when running inside a Tauri desktop app (mirrors useFileActions). */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Grant the webview runtime read/write filesystem scope for a single
 * user-chosen `path` returned by a native dialog. Best-effort: outside Tauri it
 * is a no-op, and any failure is logged (not thrown) so the subsequent
 * read/write surfaces the real, actionable error to the caller.
 *
 * @param path - Absolute path the user selected in an open/save dialog.
 */
export async function grantRuntimeFsScope(path: string): Promise<void> {
  if (!isTauri() || !path) return;
  try {
    await invoke("allow_fs_path", { path });
  } catch (err) {
    // Non-fatal: an older shell without the command, or a scope error, will be
    // reported by the following readFile/writeFile with a user-visible message.
    console.error("[tauriFsScope] allow_fs_path failed:", err);
  }
}
