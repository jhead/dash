// ---------------------------------------------------------------------------
// ClassVfs quota handling (task 1404).
//
// OPFS / IndexedDB class writes can reject with a `QuotaExceededError` when the
// origin's storage budget is exhausted. Left unhandled the write() rejection is
// swallowed by the microtask (`void vfs.write(...)`) and the class edit silently
// fails to persist while `doc.asClasses` was already updated synchronously — on
// Tauri/OPFS the on-disk mirror then diverges from the doc.
//
// This module mirrors `projects/projectStore.ts`'s `ProjectQuotaError` pattern:
// the backend detects a quota rejection and rethrows it as a typed
// `ClassVfsQuotaError` so the caller can surface a one-time, non-fatal warning
// (the in-memory `doc.asClasses` remains the source of truth) instead of losing
// the failure.
// ---------------------------------------------------------------------------

/**
 * Thrown by a {@link ClassVfs} backend when a write fails because the browser
 * storage quota is exceeded. Non-fatal: `doc.asClasses` already holds the edit,
 * so the caller should warn (once) rather than treat this as data loss.
 */
export class ClassVfsQuotaError extends Error {
  readonly cause?: unknown;
  readonly path?: string;
  constructor(message: string, options?: { cause?: unknown; path?: string }) {
    super(message);
    this.name = "ClassVfsQuotaError";
    this.cause = options?.cause;
    this.path = options?.path;
  }
}

/** True if `err` is a storage-quota-exceeded error across browsers/backends. */
export function isQuotaError(err: unknown): boolean {
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    return (
      err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED"
    );
  }
  if (err instanceof ClassVfsQuotaError) return true;
  return err instanceof Error && /quota/i.test(err.message);
}

/**
 * Run a VFS write body, translating a quota-exceeded rejection into a
 * {@link ClassVfsQuotaError}. Any other error propagates unchanged so genuine
 * I/O failures are still surfaced to the caller.
 */
export async function withQuotaMapping<T>(
  path: string,
  body: () => Promise<T>
): Promise<T> {
  try {
    return await body();
  } catch (err) {
    if (isQuotaError(err)) {
      throw new ClassVfsQuotaError(
        `Storage quota exceeded writing class "${path}".`,
        { cause: err, path }
      );
    }
    throw err;
  }
}
