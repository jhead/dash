import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { serializeDocument } from "./serialize.js";
import { deserializeDocument } from "./deserialize.js";
import { isOle2, tryLoadRealFla } from "./ole.js";
import { saveRealFla as saveRealFlaImpl } from "./write/fla-write.js";
import type { FlashDocument } from "../model/types.js";

/**
 * Serialize a FlashDocument to a genuine Macromedia Flash 8 binary `.fla`
 * (OLE2/CFB container). This is a separate export from the default `saveFla`
 * (which writes this clone's zip/JSON format); the default round-trip behavior
 * of saveFla/loadFla is unchanged.
 */
export function saveRealFla(doc: FlashDocument): Uint8Array {
  return saveRealFlaImpl(doc);
}

const ENTRY_NAME = "document.json";

/** Zip-entry prefix under which AS2 class source files are stored. */
const CLASSES_PREFIX = "classes/";

/** Default AS2 classpath when a document carries none. */
const DEFAULT_CLASSPATHS: readonly string[] = ["."];

/** Map from MIME type to file extension (used when saving). */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
};

/** Map from file extension to MIME type (used when loading). */
const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

/**
 * Extract the MIME type from a data URI header.
 * Returns "application/octet-stream" if the header is missing or unrecognised.
 */
function mimeFromDataUri(dataUri: string): string {
  const match = /^data:([^;,]+)/.exec(dataUri);
  return match?.[1] ?? "application/octet-stream";
}

/**
 * Return the file extension (including leading dot) that corresponds to a MIME
 * type.  Falls back to ".bin" for unknown types.
 */
function extForMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? ".bin";
}

/**
 * Return the MIME type that corresponds to a file extension.
 * Falls back to "application/octet-stream" for unknown extensions.
 */
function mimeForExt(ext: string): string {
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

/**
 * Decode a data URI to raw bytes.
 */
function dataUriToBytes(dataUri: string): Uint8Array {
  const base64 = dataUri.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encode raw bytes to a base64 string.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Serialize a FlashDocument to a `.fla` zip archive (as raw bytes).
 *
 * BitmapItem and SoundItem asset data is stored as separate binary entries:
 *   assets/bitmaps/<id>  — raw bytes for each BitmapItem
 *   assets/sounds/<id>   — raw bytes for each SoundItem
 * The dataUri fields in document.json are replaced with "asset:bitmaps/<id>"
 * or "asset:sounds/<id>" references to keep document.json small.
 */
export function saveFla(doc: FlashDocument): Uint8Array {
  const files: Parameters<typeof zipSync>[0] = {};

  // Strip dataUris from library items and write them as separate zip entries
  const strippedDoc: FlashDocument = {
    ...doc,
    library: {
      ...doc.library,
      items: doc.library.items.map(item => {
        if (
          (item.itemType === 'bitmap' || item.itemType === 'sound') &&
          item.dataUri &&
          !item.dataUri.startsWith('asset:')
        ) {
          const mime = mimeFromDataUri(item.dataUri);
          const ext = extForMime(mime);
          const assetPath = `${item.itemType}s/${item.id}${ext}`;
          files[`assets/${assetPath}`] = [dataUriToBytes(item.dataUri), { level: 0 }];
          return { ...item, dataUri: `asset:${assetPath}` };
        }
        return item;
      }),
    },
  };

  // Write each AS2 class as its own `classes/<path>` zip entry. The source
  // also stays inline in document.json (see serializeDocument): the zip entries
  // are the authoritative copy on load, the inline copy is the fallback. When a
  // document has no classes, no `classes/` entries are written and asClasses /
  // classpaths are absent from document.json, so the archive is byte-identical
  // to the pre-AS2 format.
  for (const cls of strippedDoc.asClasses ?? []) {
    files[`${CLASSES_PREFIX}${cls.path}`] = [strToU8(cls.source), { level: 6 }];
  }

  const json = serializeDocument(strippedDoc);
  files[ENTRY_NAME] = strToU8(json);

  return zipSync(files, { level: 6 });
}

/**
 * Deserialize a FlashDocument from `.fla` zip archive bytes.
 *
 * If the bytes begin with the OLE2/CFB magic (D0 CF 11 E0), this is a genuine
 * Macromedia Flash 8 .fla file.  The function delegates to `tryLoadRealFla`
 * which performs best-effort extraction of stage properties and basic timeline
 * structure from the undocumented binary format.
 *
 * Otherwise the bytes are expected to be this clone's zip/JSON format.
 * Throws if the archive is malformed or does not contain `document.json`.
 *
 * Asset entries (assets/bitmaps/<id>, assets/sounds/<id>) are read back and
 * used to reconstitute the dataUri fields on BitmapItem and SoundItem.
 */
export function loadFla(bytes: Uint8Array): FlashDocument {
  // Detect genuine Macromedia Flash 8 .fla (OLE2/CFB container)
  if (isOle2(bytes)) {
    const doc = tryLoadRealFla(bytes);
    if (doc) return doc;
    throw new Error(
      'FLA open error: OLE2/CFB format detected but could not parse. ' +
      'This is a real Macromedia Flash 8 .fla file; only basic properties ' +
      'are extracted in this version.'
    );
  }

  let entries: ReturnType<typeof unzipSync>;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    throw new Error(`FLA open error: could not unzip — ${String(err)}`);
  }

  const raw = entries[ENTRY_NAME];
  if (!raw) {
    throw new Error(`FLA open error: archive does not contain "${ENTRY_NAME}"`);
  }

  const json = strFromU8(raw);
  const doc = deserializeDocument(json);

  // Restore dataUri fields from separate asset entries
  const restoredItems = doc.library.items.map(item => {
    if (
      (item.itemType === 'bitmap' || item.itemType === 'sound') &&
      typeof item.dataUri === 'string' &&
      item.dataUri.startsWith('asset:')
    ) {
      const path = item.dataUri.slice('asset:'.length); // "bitmaps/<id>.ext" or "sounds/<id>.ext"
      const entryKey = `assets/${path}`;
      const assetBytes = entries[entryKey];
      if (!assetBytes) {
        throw new Error(`FLA open error: missing asset entry "${entryKey}"`);
      }
      const dotIndex = path.lastIndexOf('.');
      const ext = dotIndex !== -1 ? path.slice(dotIndex) : '';
      const mimeType = mimeForExt(ext);
      const base64 = bytesToBase64(assetBytes);
      return { ...item, dataUri: `data:${mimeType};base64,${base64}` };
    }
    return item;
  });

  // Reconcile AS2 classes. The `classes/<path>` zip entries are authoritative
  // (they are the user-editable on-disk copy); fall back to the inline
  // `asClasses` from document.json when no zip entries are present (e.g. a doc
  // serialized by a path that did not split out the entries). Default
  // classpaths to ['.'] when absent. Leave asClasses/classpaths UNSET when the
  // document has neither, so non-AS2 docs round-trip unchanged.
  const zipClasses = Object.keys(entries)
    .filter((k) => k.startsWith(CLASSES_PREFIX) && k.length > CLASSES_PREFIX.length)
    .sort()
    .map((k) => ({
      path: k.slice(CLASSES_PREFIX.length),
      source: strFromU8(entries[k]),
    }));

  const asClasses =
    zipClasses.length > 0
      ? zipClasses
      : doc.asClasses && doc.asClasses.length > 0
        ? doc.asClasses
        : undefined;

  const classpaths =
    asClasses !== undefined
      ? doc.classpaths && doc.classpaths.length > 0
        ? doc.classpaths
        : DEFAULT_CLASSPATHS
      : doc.classpaths;

  return {
    ...doc,
    library: {
      ...doc.library,
      items: restoredItems,
    },
    ...(asClasses !== undefined ? { asClasses } : {}),
    ...(classpaths !== undefined ? { classpaths } : {}),
  };
}
