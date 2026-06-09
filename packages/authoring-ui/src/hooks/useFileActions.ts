import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { createDocument, createBitmap, createSound } from "@flash/core";
import { saveFla, loadFla } from "@flash/core";
import type { BitmapItem, SoundItem, FlashDocument } from "@flash/core";

const FLA_FILTERS = [{ name: "Flash Document", extensions: ["fla"] }];

/**
 * Returns file-menu actions (New, Open, Save, Save As) backed by
 * Tauri native file dialogs and the FLA zip/JSON format.
 *
 * All actions are async and safe to call from click handlers.
 */
export function useFileActions() {
  /**
   * Create a brand-new document with Flash 8 defaults.
   * Returns the new document — the caller is responsible for storing it.
   */
  function newDocument(): FlashDocument {
    return createDocument();
  }

  /**
   * Open a native file-open dialog filtered to `.fla` files.
   * Reads the selected file, deserializes it, and returns the document.
   * Returns `null` if the user cancels the dialog.
   *
   * Throws a user-visible error if Tauri APIs are unavailable (browser mode).
   */
  async function openDocument(): Promise<FlashDocument | null> {
    let selected: string | null;
    try {
      selected = await dialogOpen({
        title: "Open Flash Document",
        filters: FLA_FILTERS,
        multiple: false,
        directory: false,
      });
    } catch (err) {
      const msg =
        "File dialogs require the Tauri desktop app. " +
        "Run `pnpm dev` (not `pnpm dev:browser`) to open files from disk.";
      console.error("[useFileActions] openDocument failed:", err);
      alert(msg);
      return null;
    }

    if (!selected) return null;

    const path = typeof selected === "string" ? selected : selected;
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (err) {
      const msg = `Failed to read file "${path}". Make sure the Tauri app has file-system permissions.`;
      console.error("[useFileActions] readFile failed:", err);
      alert(msg);
      return null;
    }
    try {
      return loadFla(bytes);
    } catch (err) {
      const msg =
        `"${path}" could not be opened: ${err instanceof Error ? err.message : String(err)}\n\n` +
        "Note: only .fla files saved by this app can be opened — " +
        "Macromedia Flash 8 .fla files are not yet supported.";
      console.error("[useFileActions] loadFla failed:", err);
      alert(msg);
      return null;
    }
  }

  /**
   * Save the document to `path` if known, otherwise delegate to saveDocumentAs.
   * Returns the path that was written (useful for tracking the current file path).
   */
  async function saveDocument(
    doc: FlashDocument,
    path?: string
  ): Promise<string | null> {
    if (path) {
      try {
        const bytes = saveFla(doc);
        await writeFile(path, bytes);
        return path;
      } catch (err) {
        const msg = `Failed to save file "${path}". Make sure the Tauri app has file-system permissions.`;
        console.error("[useFileActions] writeFile failed:", err);
        alert(msg);
        return null;
      }
    }
    return saveDocumentAs(doc);
  }

  /**
   * Open a native save dialog filtered to `.fla` files, then write the document.
   * Returns the chosen path, or `null` if the user cancelled.
   *
   * Throws a user-visible error if Tauri APIs are unavailable (browser mode).
   */
  async function saveDocumentAs(doc: FlashDocument): Promise<string | null> {
    let chosen: string | null;
    try {
      chosen = await dialogSave({
        title: "Save Flash Document",
        filters: FLA_FILTERS,
        defaultPath: "untitled.fla",
      });
    } catch (err) {
      const msg =
        "File dialogs require the Tauri desktop app. " +
        "Run `pnpm dev` (not `pnpm dev:browser`) to save files to disk.";
      console.error("[useFileActions] saveDocumentAs dialog failed:", err);
      alert(msg);
      return null;
    }

    if (!chosen) return null;

    // Ensure the path ends with .fla
    const savePath = chosen.endsWith(".fla") ? chosen : `${chosen}.fla`;
    try {
      const bytes = saveFla(doc);
      await writeFile(savePath, bytes);
      return savePath;
    } catch (err) {
      const msg = `Failed to write file "${savePath}". Make sure the Tauri app has file-system permissions.`;
      console.error("[useFileActions] writeFile failed:", err);
      alert(msg);
      return null;
    }
  }

  /**
   * Open a native file-open dialog filtered to image files (PNG/JPEG/GIF/BMP).
   * Reads the selected file, converts to a data URI, and returns a BitmapItem
   * along with the data URI.
   * Returns `null` if the user cancels the dialog.
   *
   * Throws a user-visible error if Tauri APIs are unavailable (browser mode).
   */
  async function importToLibrary(): Promise<{ item: BitmapItem; dataUri: string } | null> {
    let selected: string | null;
    try {
      selected = await dialogOpen({
        title: "Import to Library",
        filters: [{ name: "Image Files", extensions: ["png", "jpg", "jpeg", "gif", "bmp"] }],
        multiple: false,
        directory: false,
      });
    } catch (err) {
      const msg =
        "File dialogs require the Tauri desktop app. " +
        "Run `pnpm dev` (not `pnpm dev:browser`) to import files from disk.";
      console.error("[useFileActions] importToLibrary dialog failed:", err);
      alert(msg);
      return null;
    }

    if (!selected) return null;

    const path = typeof selected === "string" ? selected : selected;
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (err) {
      const msg = `Failed to read file "${path}". Make sure the Tauri app has file-system permissions.`;
      console.error("[useFileActions] readFile failed:", err);
      alert(msg);
      return null;
    }

    // Derive MIME type from extension
    const lowerPath = path.toLowerCase();
    let mime = "image/png";
    if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
      mime = "image/jpeg";
    } else if (lowerPath.endsWith(".gif")) {
      mime = "image/gif";
    } else if (lowerPath.endsWith(".bmp")) {
      mime = "image/bmp";
    }

    // Convert bytes to base64 data URI
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
    }
    const dataUri = `data:${mime};base64,${btoa(binary)}`;

    // Derive name from filename (last path segment, no extension)
    const segments = path.replace(/\\/g, "/").split("/");
    const fileName = segments[segments.length - 1] ?? "bitmap";
    const name = fileName.replace(/\.[^.]+$/, "");

    const item = createBitmap(name, {
      dataUri,
      allowSmoothing: true,
      compressionType: "lossless",
      quality: 90,
    });

    return { item, dataUri };
  }

  /**
   * Open a native file-open dialog filtered to audio files (WAV/MP3/AIFF).
   * Reads the selected file, converts to a data URI, and returns a SoundItem
   * along with the data URI.
   * Returns `null` if the user cancels the dialog.
   *
   * Throws a user-visible error if Tauri APIs are unavailable (browser mode).
   */
  async function importSoundToLibrary(): Promise<{ item: SoundItem; dataUri: string } | null> {
    let selected: string | null;
    try {
      selected = await dialogOpen({
        title: "Import Sound to Library",
        filters: [{ name: "Audio Files", extensions: ["wav", "mp3", "aiff", "aif"] }],
        multiple: false,
        directory: false,
      });
    } catch (err) {
      const msg =
        "File dialogs require the Tauri desktop app. " +
        "Run `pnpm dev` (not `pnpm dev:browser`) to import files from disk.";
      console.error("[useFileActions] importSoundToLibrary dialog failed:", err);
      alert(msg);
      return null;
    }

    if (!selected) return null;

    const path = typeof selected === "string" ? selected : selected;
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (err) {
      const msg = `Failed to read file "${path}". Make sure the Tauri app has file-system permissions.`;
      console.error("[useFileActions] readFile failed:", err);
      alert(msg);
      return null;
    }

    // Derive MIME type from extension
    const lowerPath = path.toLowerCase();
    let mime = "audio/wav";
    if (lowerPath.endsWith(".mp3")) {
      mime = "audio/mpeg";
    } else if (lowerPath.endsWith(".aiff") || lowerPath.endsWith(".aif")) {
      mime = "audio/aiff";
    }

    // Convert bytes to base64 data URI
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
    }
    const dataUri = `data:${mime};base64,${btoa(binary)}`;

    // Derive name from filename (last path segment, no extension)
    const segments = path.replace(/\\/g, "/").split("/");
    const fileName = segments[segments.length - 1] ?? "sound";
    const name = fileName.replace(/\.[^.]+$/, "");

    const item = createSound(name, {
      dataUri,
      sampleRate: 44100,
      sampleSize: 16,
      isStereo: true,
      durationSeconds: 0,
      compressionType: "raw",
    });

    return { item, dataUri };
  }

  return { newDocument, openDocument, saveDocument, saveDocumentAs, importToLibrary, importSoundToLibrary };
}
