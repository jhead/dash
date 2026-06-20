// ---------------------------------------------------------------------------
// autosaveController — the framework-free, debounced autosave engine.
//
// It owns NO React state and NO real timers: timers and the clock are injected
// so the debounce + supersession logic is fully node-unit-testable (mirrors
// preview/livePreviewController.ts). The React adapter (useAutosave.ts) wires it
// to the live document store and the live ProjectStore.
//
// Behaviour:
//   - schedule(doc) is called on every document mutation. It (re)arms a single
//     debounce timer; only the LATEST doc is captured. After `delayMs` of quiet,
//     it serializes that doc once and persists it under the active project name
//     AND the reserved current-working slot (so F5 restores in-progress work even
//     for an unnamed project).
//   - A monotonic generation counter is the supersession authority: if a newer
//     schedule() lands while a serialize/persist is in flight, the stale result
//     is dropped (it never overwrites newer bytes).
//   - flush() forces an immediate save of the pending doc (used on Save / before
//     unload). cancel() drops the pending timer.
//   - Quota / serialize errors are reported via onError and do NOT throw into the
//     editor — the in-memory document is the source of truth; only persistence
//     degrades.
// ---------------------------------------------------------------------------

import type { FlashDocument } from "@flash/core";

export interface AutosaveTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface AutosaveDeps {
  /** Serialize a document to `.fla` bytes (saveFla). Injected for testability. */
  readonly serialize: (doc: FlashDocument) => Uint8Array;
  /**
   * Persist serialized bytes. Resolves on success; rejects on quota/IO failure.
   * The controller calls this once per fired debounce (or flush).
   */
  readonly persist: (bytes: Uint8Array) => Promise<void>;
  /** Debounce quiet period in ms (default 1500). */
  readonly delayMs?: number;
  /** Timer/clock injection. Defaults to the global timers. */
  readonly timers?: AutosaveTimers;
  /** Called after a successful persist (e.g. to refresh "saved" UI state). */
  readonly onSaved?: (bytes: Uint8Array) => void;
  /** Called when a persist fails (quota / IO). Non-fatal. */
  readonly onError?: (err: unknown) => void;
}

const DEFAULT_DELAY_MS = 1500;

const defaultTimers: AutosaveTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class AutosaveController {
  private readonly serialize: (doc: FlashDocument) => Uint8Array;
  private readonly persist: (bytes: Uint8Array) => Promise<void>;
  private readonly delayMs: number;
  private readonly timers: AutosaveTimers;
  private readonly onSaved?: (bytes: Uint8Array) => void;
  private readonly onError?: (err: unknown) => void;

  private timer: unknown = null;
  private pendingDoc: FlashDocument | null = null;
  /** Bumped on every schedule()/flush() so an in-flight stale persist is dropped. */
  private generation = 0;
  /** Generation whose bytes were last successfully persisted. */
  private savedGeneration = -1;

  constructor(deps: AutosaveDeps) {
    this.serialize = deps.serialize;
    this.persist = deps.persist;
    this.delayMs = deps.delayMs ?? DEFAULT_DELAY_MS;
    this.timers = deps.timers ?? defaultTimers;
    this.onSaved = deps.onSaved;
    this.onError = deps.onError;
  }

  /** True if there is unsaved pending work (a scheduled-but-not-yet-saved doc). */
  get hasPending(): boolean {
    return this.pendingDoc !== null && this.savedGeneration < this.generation;
  }

  /**
   * Arm (or re-arm) the debounce with the latest document. Only the most recent
   * doc passed before the quiet period elapses is persisted.
   */
  schedule(doc: FlashDocument): void {
    this.pendingDoc = doc;
    this.generation++;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.fire();
    }, this.delayMs);
  }

  /**
   * Force an immediate save of the pending document (bypassing the debounce).
   * No-op if nothing is pending. Returns once the persist settles.
   */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingDoc === null) return;
    await this.fire();
  }

  /** Drop any pending timer + doc without saving (e.g. on New / unmount). */
  cancel(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingDoc = null;
  }

  /** Serialize + persist the pending doc, honouring supersession. */
  private async fire(): Promise<void> {
    const doc = this.pendingDoc;
    if (doc === null) return;
    const gen = this.generation;
    let bytes: Uint8Array;
    try {
      bytes = this.serialize(doc);
    } catch (err) {
      this.onError?.(err);
      return;
    }
    try {
      await this.persist(bytes);
    } catch (err) {
      this.onError?.(err);
      return;
    }
    // Drop a stale result: a newer schedule() bumped the generation while we
    // were persisting, so a fresher save is already (or will be) on its way.
    if (gen < this.generation && gen <= this.savedGeneration) return;
    this.savedGeneration = Math.max(this.savedGeneration, gen);
    this.onSaved?.(bytes);
  }
}
