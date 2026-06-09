import type { FlashDocument, DocumentProperties } from "../model/types.js";

/**
 * Return a new FlashDocument with the given property overrides applied.
 * The original document is not modified (immutable update).
 *
 * @example
 * const updated = withProperties(doc, { frameRate: 24, backgroundColor: '#000000' });
 */
export function withProperties(
  doc: FlashDocument,
  partial: Partial<DocumentProperties>
): FlashDocument {
  return { ...doc, properties: { ...doc.properties, ...partial } };
}
