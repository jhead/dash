import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { createDocument, createBitmap, createSound } from "@flash/core";
import { saveFla, saveRealFla, loadFla } from "@flash/core";
import type { BitmapItem, SoundItem, FlashDocument } from "@flash/core";
import type { VideoProbe } from "@flash/swf";
import type { PendingVideoImport } from "../store/uiStore.js";

const FLA_FILTERS = [{ name: "Dash Document", extensions: ["fla"] }];

/** Returns true when running inside a Tauri desktop app. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Trigger a browser download of the given bytes. */
function downloadFla(bytes: Uint8Array, filename: string): void {
  // Copy into a plain ArrayBuffer to satisfy strict Blob typing (avoids SharedArrayBuffer ambiguity)
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Derive a friendly .fla filename from a Tauri file path, or use the fallback.
 * e.g. "/Users/foo/bar/my-movie.fla" → "my-movie.fla"
 */
function basenameOf(path: string | undefined, fallback = "untitled.fla"): string {
  if (!path) return fallback;
  const segments = path.replace(/\\/g, "/").split("/");
  const last = segments[segments.length - 1] ?? fallback;
  return last || fallback;
}

/**
 * Load an .fla document from raw bytes, with user-visible error handling.
 * Returns the parsed FlashDocument, or null if parsing failed.
 * @param bytes - The raw bytes of the .fla file.
 * @param name - Filename used in error messages.
 */
export async function loadFlaFromBytes(
  bytes: Uint8Array,
  name: string
): Promise<FlashDocument | null> {
  try {
    return loadFla(bytes);
  } catch (err) {
    const msg =
      `"${name}" could not be opened: ${err instanceof Error ? err.message : String(err)}\n\n` +
      "Note: only .fla files saved by this app can be opened — " +
      "Macromedia Flash 8 .fla files are not yet supported.";
    console.error("[useFileActions] loadFla failed:", err);
    alert(msg);
    return null;
  }
}

/**
 * Open a browser <input type="file"> picker restricted to .fla files.
 * Returns the parsed document and original filename, or null if the user cancelled.
 */
export function openFlaViaBrowserPicker(): Promise<{ doc: FlashDocument; name: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".fla";
    input.addEventListener("cancel", () => resolve(null));
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const buffer = await file.arrayBuffer();
      const doc = await loadFlaFromBytes(new Uint8Array(buffer), file.name);
      resolve(doc ? { doc, name: file.name } : null);
    };
    input.click();
  });
}

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
   * Open a file-open dialog filtered to `.fla` files.
   * In the Tauri desktop app, uses the native system dialog.
   * In the browser (pnpm dev:browser), uses an <input type="file"> picker.
   * Returns the document, or null if the user cancels.
   */
  async function openDocument(): Promise<FlashDocument | null> {
    if (!isTauri()) {
      const result = await openFlaViaBrowserPicker();
      return result ? result.doc : null;
    }

    let selected: string | null;
    try {
      selected = await dialogOpen({
        title: "Open Flash Document",
        filters: FLA_FILTERS,
        multiple: false,
        directory: false,
      });
    } catch (err) {
      console.error("[useFileActions] openDocument (Tauri) failed:", err);
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
    return loadFlaFromBytes(bytes, basenameOf(path));
  }

  /**
   * Save the document to `path` if known, otherwise delegate to saveDocumentAs.
   * In browser mode (non-Tauri), triggers a download using the basename of `path`
   * (or "untitled.fla" if no path is set).
   * Returns the path that was written (useful for tracking the current file path).
   */
  async function saveDocument(
    doc: FlashDocument,
    path?: string
  ): Promise<string | null> {
    if (!isTauri()) {
      // Browser fallback: download the file directly
      const bytes = saveFla(doc);
      const filename = basenameOf(path);
      downloadFla(bytes, filename);
      return path ?? filename;
    }
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
   * In browser mode (non-Tauri), prompts for a filename and triggers a download.
   * Returns the chosen path/name, or `null` if the user cancelled.
   */
  async function saveDocumentAs(
    doc: FlashDocument,
    currentPath?: string
  ): Promise<string | null> {
    if (!isTauri()) {
      // Browser fallback: ask for a name, then trigger download
      const currentName = basenameOf(currentPath);
      const answer = window.prompt("Save As:", currentName);
      if (answer === null) return null; // user cancelled
      const filename = answer.trim() || currentName;
      const filenameWithExt = filename.endsWith(".fla") ? filename : `${filename}.fla`;
      const bytes = saveFla(doc);
      downloadFla(bytes, filenameWithExt);
      return filenameWithExt;
    }

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
   * Export the document as a genuine Macromedia Flash 8 BINARY .fla
   * (OLE2 / MFC-CArchive format) that real Flash / Animate can open — as
   * opposed to Save / Save As, which write this app's own lossless ZIP+JSON
   * .fla format.
   *
   * EXPERIMENTAL: the binary writer is spec-faithful for the container,
   * Contents catalog and stage block, but its shape-edge and instance-header
   * encodings are not yet byte-verified against real Flash 8. Treat the output
   * as a test artifact, not a production save.
   *
   * In the Tauri desktop app this uses the native save dialog; in browser mode
   * (pnpm dev:browser) it triggers a download. Returns the chosen path/name, or
   * null if the user cancelled.
   */
  async function exportBinaryFla(
    doc: FlashDocument,
    currentPath?: string
  ): Promise<string | null> {
    const base = basenameOf(currentPath, "untitled.fla").replace(/\.fla$/i, "");
    const suggested = `${base}-flash8.fla`;

    if (!isTauri()) {
      const answer = window.prompt("Export Flash 8 binary .fla as:", suggested);
      if (answer === null) return null; // user cancelled
      const name = answer.trim() || suggested;
      const filename = name.endsWith(".fla") ? name : `${name}.fla`;
      const bytes = saveRealFla(doc);
      downloadFla(bytes, filename);
      return filename;
    }

    let chosen: string | null;
    try {
      chosen = await dialogSave({
        title: "Export Flash 8 Binary Document",
        filters: FLA_FILTERS,
        defaultPath: suggested,
      });
    } catch (err) {
      const msg =
        "File dialogs require the Tauri desktop app. " +
        "Run `pnpm dev` (not `pnpm dev:browser`) to save files to disk.";
      console.error("[useFileActions] exportBinaryFla dialog failed:", err);
      alert(msg);
      return null;
    }

    if (!chosen) return null;

    const savePath = chosen.endsWith(".fla") ? chosen : `${chosen}.fla`;
    try {
      const bytes = saveRealFla(doc);
      await writeFile(savePath, bytes);
      return savePath;
    } catch (err) {
      const msg = `Failed to write file "${savePath}". Make sure the Tauri app has file-system permissions.`;
      console.error("[useFileActions] exportBinaryFla writeFile failed:", err);
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

    // Derive MIME type and compression type from extension
    const lowerPath = path.toLowerCase();
    let mime = "audio/wav";
    let compressionType: "mp3" | "raw" | "adpcm" | "speech" = "raw";
    if (lowerPath.endsWith(".mp3")) {
      mime = "audio/mpeg";
      compressionType = "mp3";
    } else if (lowerPath.endsWith(".aiff") || lowerPath.endsWith(".aif")) {
      mime = "audio/aiff";
      compressionType = "raw";
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
      compressionType,
    });

    return { item, dataUri };
  }

  /**
   * Open a native file-open dialog filtered to video files (FLV/MP4/AVI),
   * read the selected file, convert it to a data URI, and probe its
   * codec/dimensions/frame metadata (FLV only).
   *
   * Returns a {@link PendingVideoImport} for the VideoImportDialog wizard to
   * present, or `null` if the user cancels or the file can't be read. Does NOT
   * create a library item — that happens when the wizard is confirmed.
   *
   * Throws a user-visible error if Tauri APIs are unavailable (browser mode).
   */
  async function probeVideoFile(): Promise<PendingVideoImport | null> {
    let selected: string | null;
    try {
      selected = await dialogOpen({
        title: "Import Video",
        filters: [{ name: "Video Files", extensions: ["flv", "mp4", "avi"] }],
        multiple: false,
        directory: false,
      });
    } catch (err) {
      const msg =
        "File dialogs require the Tauri desktop app. " +
        "Run `pnpm dev` (not `pnpm dev:browser`) to import files from disk.";
      console.error("[useFileActions] probeVideoFile dialog failed:", err);
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
    let mime = "video/x-flv";
    if (lowerPath.endsWith(".mp4")) {
      mime = "video/mp4";
    } else if (lowerPath.endsWith(".avi")) {
      mime = "video/x-msvideo";
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
    const fileName = segments[segments.length - 1] ?? "video";
    const suggestedName = fileName.replace(/\.[^.]+$/, "");

    // Probe the container for codec/dimensions/frame metadata (FLV only).
    let probe: VideoProbe | null = null;
    try {
      const { probeFlv } = await import("@flash/swf");
      probe = probeFlv(bytes);
    } catch {
      // Non-critical: a non-FLV container yields null and the wizard falls
      // back to user-editable defaults.
    }

    return { dataUri, probe, suggestedName, fileName };
  }

  return { newDocument, openDocument, saveDocument, saveDocumentAs, exportBinaryFla, importToLibrary, importSoundToLibrary, probeVideoFile };
}
