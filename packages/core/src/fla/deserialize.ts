import type { FlashDocument } from "../model/types.js";

interface FlaPayload {
  schemaVersion?: number;
  version: string;
  flashVersion: string;
  document: FlashDocument;
}

const CURRENT_SCHEMA_VERSION = 2;

/**
 * Deserialize a FlashDocument from a JSON string produced by `serializeDocument`.
 * Throws if the JSON is malformed or missing required fields.
 */
export function deserializeDocument(json: string): FlashDocument {
  let payload: unknown;
  try {
    payload = JSON.parse(json) as unknown;
  } catch (err) {
    throw new Error(`FLA parse error: invalid JSON — ${String(err)}`);
  }

  if (typeof payload !== "object" || payload === null) {
    throw new Error("FLA parse error: root value is not an object");
  }

  const p = payload as Record<string, unknown>;

  const schemaVersion = p["schemaVersion"] !== undefined ? (p["schemaVersion"] as number) : 0;
  if (schemaVersion === 0) {
    console.warn("FLA schema version missing, treating as version 0 (legacy document)");
  } else if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    console.warn(`FLA schema version ${schemaVersion} is newer than supported ${CURRENT_SCHEMA_VERSION}`);
  }

  if (typeof p["version"] !== "string") {
    throw new Error('FLA parse error: missing "version" field');
  }
  if (typeof p["flashVersion"] !== "string") {
    throw new Error('FLA parse error: missing "flashVersion" field');
  }
  if (typeof p["document"] !== "object" || p["document"] === null) {
    throw new Error('FLA parse error: missing "document" field');
  }

  const { document } = payload as FlaPayload;

  // Basic structural validation — we trust the shape since we wrote it.
  if (typeof document.id !== "string") {
    throw new Error('FLA parse error: document.id is not a string');
  }
  if (!Array.isArray(document.scenes)) {
    throw new Error('FLA parse error: document.scenes is not an array');
  }

  return document;
}
