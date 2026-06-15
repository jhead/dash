/**
 * Character-definition helpers for bitmap fills.
 *
 * (The full per-display-object character-definition pass is threaded through
 * CompileContext by the orchestrator; this module currently owns the standalone
 * bitmap-fill emission used by that pass.)
 */
import type { BitmapFill, BitmapItem, FlashDocument, Shape } from "@flash/core";
import { Tag } from "../tags.js";
import { SwfWriter } from "../writer.js";
import { dataUriToBytes, encodeDefineBitsLossless2, encodeDefineBitsJpeg3, ensureJpegEOI } from "../bitmaps.js";
import type { CompileOptions } from "./options.js";

/**
 * Collect all unique BitmapFill.bitmapId values referenced in a shape's paths.
 */
export function collectBitmapFillIds(shape: Shape): string[] {
  const ids = new Set<string>();
  for (const path of shape.paths) {
    if (path.fill?.type === "bitmap") {
      ids.add((path.fill as BitmapFill).bitmapId);
    }
  }
  return Array.from(ids);
}

/**
 * For a shape that may contain BitmapFill paths, emit DefineBits tags for any
 * referenced bitmaps not yet emitted, and return a map from library item id
 * to SWF character ID.  Returns undefined if the shape has no bitmap fills.
 */
export function emitBitmapFillTags(
  shape: Shape,
  doc: FlashDocument,
  writer: SwfWriter,
  emittedBitmapCharIds: Map<string, number>,
  options?: CompileOptions
): Map<string, number> | undefined {
  const ids = collectBitmapFillIds(shape);
  if (ids.length === 0) return undefined;

  for (const bitmapId of ids) {
    if (emittedBitmapCharIds.has(bitmapId)) continue;
    const bitmapItem = doc.library.items.find(
      (item): item is BitmapItem =>
        item.itemType === "bitmap" && item.id === bitmapId
    );
    if (!bitmapItem) continue;

    const pixelData = options?.bitmapPixels?.get(bitmapItem.id);
    if (pixelData && bitmapItem.compressionType === "lossless") {
      const charId = writer.nextCharId();
      const losslessTag = encodeDefineBitsLossless2(
        charId,
        pixelData.width,
        pixelData.height,
        pixelData.pixels
      );
      writer.writeRaw(losslessTag);
      emittedBitmapCharIds.set(bitmapId, charId);
    } else if (bitmapItem.dataUri) {
      const rawBytes = dataUriToBytes(bitmapItem.dataUri);
      const imageBytes = ensureJpegEOI(rawBytes);
      if (imageBytes.length > 0) {
        const charId = writer.nextCharId();
        const pixelDataForAlpha = options?.bitmapPixels?.get(bitmapItem.id);
        const hasTransparency =
          bitmapItem.compressionType === "photo" &&
          pixelDataForAlpha !== undefined &&
          pixelDataForAlpha.pixels.some((_, i) => i % 4 === 0 && pixelDataForAlpha.pixels[i] < 255);

        if (hasTransparency && pixelDataForAlpha) {
          const pixelCount = pixelDataForAlpha.width * pixelDataForAlpha.height;
          const alphaBytes = new Uint8Array(pixelCount);
          for (let i = 0; i < pixelCount; i++) {
            alphaBytes[i] = pixelDataForAlpha.pixels[i * 4];
          }
          const jpeg3Tag = encodeDefineBitsJpeg3(charId, imageBytes, alphaBytes);
          writer.writeRaw(jpeg3Tag);
        } else {
          const imgPayload = new Uint8Array(2 + imageBytes.length);
          imgPayload[0] = charId & 0xff;
          imgPayload[1] = (charId >> 8) & 0xff;
          imgPayload.set(imageBytes, 2);
          writer.writeTag(Tag.DefineBitsJPEG2, imgPayload);
        }
        emittedBitmapCharIds.set(bitmapId, charId);
      }
    }
  }

  return emittedBitmapCharIds;
}
