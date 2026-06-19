import type { FlashDocument } from "../model/types.js";

/** Version of our FLA JSON schema. Increment on breaking changes. */
const FORMAT_VERSION = "1";
/** Flash compatibility version this format targets. */
const FLASH_VERSION = "8";
/**
 * Numeric schema version for forward/backward compatibility checks.
 * v2 adds optional `asClasses` / `classpaths` (AS2 class support). The loader
 * (deserialize.ts) only warns on NEWER versions and tolerates absent fields, so
 * v1 documents load unchanged and v2 documents load in older builds with the
 * AS2 fields ignored.
 */
const SCHEMA_VERSION = 2;

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
