import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { compileDocument } from "@flash/swf";
import type { FlashDocument, BitmapItem } from "@flash/core";
import type { CompileOptions } from "@flash/swf";

export type { CompileOptions };

const SWF_FILTERS = [{ name: "Dash Movie", extensions: ["swf"] }];

/**
 * Convert an RGBA Uint8Array (from canvas getImageData) to ARGB Uint8Array.
 * DefineBitsLossless2 (tag 36) BitmapFormat 5 expects 32-bit ARGB (A, R, G, B).
 * Canvas ImageData is always RGBA (R, G, B, A).
 */
function rgbaToArgb(rgba: Uint8Array): Uint8Array {
  const argb = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    argb[i]     = rgba[i + 3]; // A
    argb[i + 1] = rgba[i];     // R
    argb[i + 2] = rgba[i + 1]; // G
    argb[i + 3] = rgba[i + 2]; // B
  }
  return argb;
}

/**
 * Decode all lossless bitmap items in the library into raw ARGB pixel data.
 *
 * Lossless bitmaps (PNG) carry their pixel data as a `data:image/png;base64,…`
 * URI.  `encodeDefineBitsLossless2` in compile.ts needs raw 32-bit ARGB bytes
 * (BitmapFormat 5), but those are not available synchronously — we must draw
 * through an OffscreenCanvas (or a regular HTMLCanvasElement in environments that
 * lack OffscreenCanvas) to get them.  Canvas ImageData is RGBA, so we convert.
 *
 * The returned map key is the BitmapItem.id.
 * The pixel array is ARGB (4 bytes per pixel, row-major).
 */
export async function buildBitmapPixels(
  items: BitmapItem[]
): Promise<Map<string, { width: number; height: number; pixels: Uint8Array }>> {
  const result = new Map<string, { width: number; height: number; pixels: Uint8Array }>();

  // Only process lossless (PNG) bitmaps that actually have data.
  const losslessItems = items.filter(
    (item) => item.compressionType === "lossless" && item.dataUri
  );

  if (losslessItems.length === 0) return result;

  await Promise.all(
    losslessItems.map(async (item) => {
      try {
        let width: number;
        let height: number;
        let pixels: Uint8Array;

        if (typeof OffscreenCanvas !== "undefined") {
          // Preferred path: OffscreenCanvas (available in modern browsers + workers)
          const blob = await (await fetch(item.dataUri)).blob();
          const bitmap = await createImageBitmap(blob);
          width = bitmap.width;
          height = bitmap.height;
          const canvas = new OffscreenCanvas(width, height);
          const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
          ctx.drawImage(bitmap, 0, 0);
          const imageData = ctx.getImageData(0, 0, width, height);
          // Canvas returns RGBA; SWF DefineBitsLossless2 needs ARGB.
          pixels = rgbaToArgb(new Uint8Array(imageData.data.buffer));
          bitmap.close();
        } else {
          // Fallback: regular HTMLCanvasElement (legacy environments)
          await new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              width = img.naturalWidth;
              height = img.naturalHeight;
              const canvas = document.createElement("canvas");
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d")!;
              ctx.drawImage(img, 0, 0);
              const imageData = ctx.getImageData(0, 0, width, height);
              // Canvas returns RGBA; SWF DefineBitsLossless2 needs ARGB.
              pixels = rgbaToArgb(new Uint8Array(imageData.data.buffer));
              resolve();
            };
            img.onerror = reject;
            img.src = item.dataUri;
          });
        }

        result.set(item.id, { width: width!, height: height!, pixels: pixels! });
      } catch (err) {
        // Non-fatal: fall back to JPEG path for this bitmap.
        console.warn(`[usePublish] Failed to decode bitmap "${item.name}" (${item.id}):`, err);
      }
    })
  );

  return result;
}

/**
 * Publish actions: compile the document to SWF and optionally save to disk.
 *
 * publishToBytes()  — compile to bytes in memory (no I/O); async to allow
 *                     bitmap pixel decoding before compression
 * publishToFile()   — open a native save dialog then write .swf to disk
 * testMovie()       — compile for in-app Ruffle preview (returns bytes)
 */
export function usePublish(doc: FlashDocument, compileOptions?: Omit<CompileOptions, "bitmapPixels">) {
  /**
   * Compile the document to raw SWF bytes.
   *
   * Lossless (PNG) bitmaps in the library are decoded to raw ARGB pixel data
   * via an OffscreenCanvas before compiling so that DefineBitsLossless2 tags
   * are emitted with correct alpha channel data.
   */
  async function publishToBytes(): Promise<Uint8Array> {
    const bitmapItems = doc.library.items.filter(
      (item): item is BitmapItem => item.itemType === "bitmap"
    );
    const bitmapPixels = await buildBitmapPixels(bitmapItems);
    return compileDocument(doc, { ...compileOptions, bitmapPixels });
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
      const bytes = await publishToBytes();
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
