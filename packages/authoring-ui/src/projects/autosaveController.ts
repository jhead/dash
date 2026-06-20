// ---------------------------------------------------------------------------
// autosaveController — the framework-free, debounced autosave engine.
//
// It owns NO React state and NO real timers: timers and the clock are injected
// so the debounce + supersession logic is fully node-unit-testable (mirrors
// preview/livePreviewController.ts). The React adapter (useProjectActions.ts)
// wires it to the live document store and the live ProjectStore.
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
//   - The TARGET of a save (which named slot to write) is captured TOGETHER with
//     the doc at the moment the controller serializes/fires — NOT read at persist
//     resolve time. This closes a Save-As race (BUG 2, task 1316): a stale
//     in-flight autosave can no longer write its old bytes into a slot that an
//     explicit Save As renamed/created while the autosave was debouncing or in
//     flight. The React adapter snapshots the active name into the doc payload at
//     schedule time, and calls supersede() on Save/Save As so any pending/in-flight
//     autosave is invalidated.
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

/**
 * The persist payload handed to {@link AutosaveDeps.persist}. It bundles the
 * serialized bytes with the TARGET slot captured at fire time (not at persist
 * resolve time), so a stale autosave always knows exactly which slot its bytes
 * belong to and cannot bleed into a slot a later Save As switched to.
 */
export interface AutosavePayload {
  /** Serialized `.fla` bytes for the pending doc. */
  readonly bytes: Uint8Array;
  /**
   * The active named slot at the moment this save was decided, or undefined for
   * an unnamed doc (current-working slot only). Snapshotted into the schedule()
   * call by the React adapter; read here at fire time, never at await-resolution.
   */
  readonly targetName: string | undefined;
  /**
   * The controller generation that produced this payload. The persist callback
   * can use {@link AutosaveController.isCurrent} to skip a stale write as a final
   * defense-in-depth guard (the controller already drops stale onSaved bookkeeping).
   */
  readonly generation: number;
}

export interface AutosaveDeps {
  /** Serialize a document to `.fla` bytes (saveFla). Injected for testability. */
  readonly serialize: (doc: FlashDocument) => Uint8Array;
  /**
   * Persist a serialized payload. Resolves on success; rejects on quota/IO
   * failure. The controller calls this once per fired debounce (or flush) with
   * the {@link AutosavePayload} captured at fire time.
   */
  readonly persist: (payload: AutosavePayload) => Promise<void>;
  /** Debounce quiet period in ms (default 1500). */
  readonly delayMs?: number;
  /** Timer/clock injection. Defaults to the global timers. */
  readonly timers?: AutosaveTimers;
  /** Called after a successful, non-superseded persist (e.g. to refresh UI). */
  readonly onSaved?: (payload: AutosavePayload) => void;
  /** Called when a persist fails (quota / IO). Non-fatal. */
  readonly onError?: (err: unknown) => void;
}

/** What schedule() captures: the doc plus the target slot at schedule time. */
interface PendingEntry {
  readonly doc: FlashDocument;
  readonly targetName: string | undefined;
}

const DEFAULT_DELAY_MS = 1500;

const defaultTimers: AutosaveTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class AutosaveController {
  private readonly serialize: (doc: FlashDocument) => Uint8Array;
  private readonly persist: (payload: AutosavePayload) => Promise<void>;
  private readonly delayMs: number;
  private readonly timers: AutosaveTimers;
  private readonly onSaved?: (payload: AutosavePayload) => void;
  private readonly onError?: (err: unknown) => void;

  private timer: unknown = null;
  private pending: PendingEntry | null = null;
  /** Bumped on every schedule()/flush()/supersede() so a stale persist is dropped. */
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
    return this.pending !== null && this.savedGeneration < this.generation;
  }

  /** The current generation — the supersession authority (exposed for tests). */
  get currentGeneration(): number {
    return this.generation;
  }

  /**
   * True if `generation` is still the live generation (no newer schedule /
   * flush / supersede has landed). A persist callback may consult this as a
   * last-line guard before writing a named slot.
   */
  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  /**
   * Arm (or re-arm) the debounce with the latest document and the target named
   * slot AT THIS MOMENT. Only the most recent (doc, target) pair passed before
   * the quiet period elapses is persisted. Capturing the target here (rather than
   * reading a live ref at persist time) is what closes the Save-As race.
   */
  schedule(doc: FlashDocument, targetName?: string): void {
    this.pending = { doc, targetName };
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
    if (this.pending === null) return;
    await this.fire();
  }

  /**
   * Serialize the pending doc to a payload WITHOUT persisting it — used by the
   * unload path, which must START the IndexedDB write itself (synchronously, in
   * the lifecycle handler) rather than awaiting the controller's async persist.
   * Returns null if nothing is pending. Bumps savedGeneration so the controller
   * does not also re-fire the same bytes through its own persist path.
   */
  takePendingPayload(): AutosavePayload | null {
    if (this.pending === null) return null;
    const gen = this.generation;
    let bytes: Uint8Array;
    try {
      bytes = this.serialize(this.pending.doc);
    } catch (err) {
      this.onError?.(err);
      return null;
    }
    const payload: AutosavePayload = {
      bytes,
      targetName: this.pending.targetName,
      generation: gen,
    };
    // Mark this generation as taken so a still-armed timer's fire() is a no-op.
    this.savedGeneration = Math.max(this.savedGeneration, gen);
    return payload;
  }

  /** Drop any pending timer + doc without saving (e.g. on New / unmount). */
  cancel(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  /**
   * Invalidate any pending/in-flight autosave so a stale result can never write.
   * Called when an explicit Save / Save As runs: the named slot is now owned by
   * the explicit save, and a debounced autosave that captured OLDER bytes (or an
   * older target) must not overwrite it. Bumps the generation (so an in-flight
   * fire() is detected as stale) and drops the pending timer/doc. This is the
   * supersession half of the BUG-2 fix.
   */
  supersede(): void {
    this.generation++;
    this.savedGeneration = this.generation;
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  /** Serialize + persist the pending doc, honouring supersession. */
  private async fire(): Promise<void> {
    const entry = this.pending;
    if (entry === null) return;
    const gen = this.generation;
    // A supersede()/takePendingPayload() may already have claimed this generation
    // (e.g. an explicit Save ran after the timer was set but before it fired).
    if (gen <= this.savedGeneration) return;
    let bytes: Uint8Array;
    try {
      bytes = this.serialize(entry.doc);
    } catch (err) {
      this.onError?.(err);
      return;
    }
    const payload: AutosavePayload = {
      bytes,
      targetName: entry.targetName,
      generation: gen,
    };
    try {
      await this.persist(payload);
    } catch (err) {
      this.onError?.(err);
      return;
    }
    // Drop a stale result: a newer schedule()/supersede() bumped the generation
    // while we were persisting, so a fresher save is already (or will be) on its
    // way and this onSaved bookkeeping must not advance savedGeneration.
    if (gen < this.generation && gen <= this.savedGeneration) return;
    this.savedGeneration = Math.max(this.savedGeneration, gen);
    this.onSaved?.(payload);
  }
}
