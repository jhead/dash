/**
 * High-level SWF export helpers.
 */
import { compileDocument } from './compile.js';
import type { FlashDocument } from '@flash/core';
import type { CompileOptions } from './compile.js';

/** Compile a document to SWF bytes. */
export function exportSWF(doc: FlashDocument, options?: CompileOptions): Uint8Array {
  return compileDocument(doc, options);
}

/**
 * Trigger a browser file download for the given bytes.
 * No-op in Node.js environments.
 */
export function triggerDownload(bytes: Uint8Array, filename: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/x-shockwave-flash' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
