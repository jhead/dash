import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { compileDocument } from "@flash/swf";
import type { FlashDocument } from "@flash/core";
import type { CompileOptions } from "@flash/swf";

export type { CompileOptions };

const SWF_FILTERS = [{ name: "Dash Movie", extensions: ["swf"] }];

/**
 * Publish actions: compile the document to SWF and optionally save to disk.
 *
 * publishToBytes()  — compile to bytes in memory (no I/O)
 * publishToFile()   — open a native save dialog then write .swf to disk
 * testMovie()       — compile for in-app Ruffle preview (returns bytes)
 */
export function usePublish(doc: FlashDocument, compileOptions?: CompileOptions) {
  /** Compile the document to raw SWF bytes. */
  function publishToBytes(): Uint8Array {
    return compileDocument(doc, compileOptions);
  }

  /**
   * Show a native save dialog then write the compiled SWF to the chosen path.
   * Resolves when the file has been written, or if the user cancels.
   *
   * Shows a user-visible error if Tauri APIs are unavailable (browser mode).
   */
  async function publishToFile(): Promise<void> {
    let chosen: string | null;
    try {
      chosen = await dialogSave({
        title: "Publish SWF",
        filters: SWF_FILTERS,
        defaultPath: "movie.swf",
      });
    } catch (err) {
      const msg =
        "File dialogs require the Tauri desktop app. " +
        "Run `pnpm dev` (not `pnpm dev:browser`) to publish SWF files to disk.";
      console.error("[usePublish] publishToFile dialog failed:", err);
      alert(msg);
      return;
    }

    if (!chosen) return;

    const savePath = chosen.endsWith(".swf") ? chosen : `${chosen}.swf`;
    try {
      const bytes = publishToBytes();
      await writeFile(savePath, bytes);
    } catch (err) {
      const msg = `Failed to write file "${savePath}". Make sure the Tauri app has file-system permissions.`;
      console.error("[usePublish] writeFile failed:", err);
      alert(msg);
    }
  }

  /**
   * Compile the document for in-app player preview.
   * Returns the raw SWF bytes so the caller can pass them to Ruffle.
   */
  async function testMovie(): Promise<Uint8Array> {
    return publishToBytes();
  }

  return { publishToBytes, publishToFile, testMovie };
}
