import type { FlashDocument } from "../model/types.js";

/** Version of our FLA JSON schema. Increment on breaking changes. */
const FORMAT_VERSION = "1";
/** Flash compatibility version this format targets. */
const FLASH_VERSION = "8";
/** Numeric schema version for forward/backward compatibility checks. */
const SCHEMA_VERSION = 1;

/**
 * Serialize a FlashDocument to a JSON string.
 * The returned string is the content of the `document.json` entry
 * inside a `.fla` zip archive.
 */
export function serializeDocument(doc: FlashDocument): string {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    version: FORMAT_VERSION,
    flashVersion: FLASH_VERSION,
    document: doc,
  };
  return JSON.stringify(payload, null, 2);
}
