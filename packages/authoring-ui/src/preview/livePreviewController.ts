// ---------------------------------------------------------------------------
// Live Preview controller (task 1308).
//
// The pure, framework-agnostic heart of the Live Preview tab's hot-reload loop:
// debounced background re-compile with in-flight supersession and last-good
// retention. Deliberately free of React/DOM so it unit-tests in the node env
// (vitest) and so the React hook (useLivePreview) is a thin adapter over it.
//
// Behaviour contract:
//   - request() schedules a compile after `debounceMs`; rapid requests coalesce
//     (only the trailing edge fires) — this is the "debounce" half.
//   - When a compile is already running and a newer request lands, the running
//     compile's result is DISCARDED on completion (it is "superseded"); only the
//     newest compile may publish bytes — this is the "supersede" half. A
//     monotonic generation counter is the supersession authority, so an
//     out-of-order resolution of an older compile can never overwrite a newer
//     one's result.
//   - On a SUCCESSFUL compile, the fresh bytes are emitted (swap into Ruffle)
//     and status becomes "up-to-date".
//   - On a FAILED compile (compileFn throws / rejects), the LAST-GOOD bytes are
//     retained (never cleared) and status becomes "error" carrying the message;
//     the preview keeps showing the last good SWF.
//   - status is "compiling" from the moment a (non-superseded) compile starts
//     until it settles.
// ---------------------------------------------------------------------------

export type LivePreviewStatus = "idle" | "compiling" | "up-to-date" | "error";

export interface LivePreviewSnapshot {
  status: LivePreviewStatus;
  /** Last successfully-compiled SWF bytes (the "last good" preview). */
  swfBytes: Uint8Array | null;
  /** Compile error message when status === "error"; null otherwise. */
  error: string | null;
  /** Size of the last good SWF in bytes (0 until first success). */
  swfSize: number;
  /** Wall-clock ms the last successful compile took (0 until first success). */
  compileMs: number;
  /** True while a (non-superseded) compile is in flight. */
  inFlight: boolean;
}

export interface LivePreviewControllerOptions {
  /** Async compile; resolves to SWF bytes or throws/rejects on a compile error. */
  compileFn: () => Promise<Uint8Array>;
  /** Notified on every snapshot change so an adapter can re-render. */
  onChange: (snap: LivePreviewSnapshot) => void;
  /** Debounce window in ms (default 350; spec asks ~300–500). */
  debounceMs?: number;
  /** Injectable timers + clock for deterministic tests. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  now?: () => number;
}

export class LivePreviewController {
  private readonly compileFn: () => Promise<Uint8Array>;
  private readonly onChange: (snap: LivePreviewSnapshot) => void;
  private readonly debounceMs: number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private readonly now: () => number;

  private timer: unknown = null;
  /** Monotonic compile id; only the latest may publish (supersession authority). */
  private generation = 0;
  private disposed = false;

  private snap: LivePreviewSnapshot = {
    status: "idle",
    swfBytes: null,
    error: null,
    swfSize: 0,
    compileMs: 0,
    inFlight: false,
  };

  constructor(opts: LivePreviewControllerOptions) {
    this.compileFn = opts.compileFn;
    this.onChange = opts.onChange;
    this.debounceMs = opts.debounceMs ?? 350;
    this.setTimeoutFn =
      opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.clearTimeoutFn =
      opts.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.now = opts.now ?? (() => Date.now());
  }

  getSnapshot(): LivePreviewSnapshot {
    return this.snap;
  }

  private emit(patch: Partial<LivePreviewSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.onChange(this.snap);
  }

  /**
   * Schedule a debounced compile. Rapid calls coalesce to a single trailing
   * compile. Pass `immediate: true` to skip the debounce (manual Reload).
   */
  request(opts?: { immediate?: boolean }): void {
    if (this.disposed) return;
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
    if (opts?.immediate) {
      void this.runCompile();
      return;
    }
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      void this.runCompile();
    }, this.debounceMs);
  }

  private async runCompile(): Promise<void> {
    if (this.disposed) return;
    const myGen = ++this.generation;
    const startedAt = this.now();
    // status -> compiling; keep last-good bytes/size visible meanwhile.
    this.emit({ status: "compiling", inFlight: true });
    try {
      const bytes = await this.compileFn();
      if (this.disposed || myGen !== this.generation) {
        // Superseded by a newer compile (or disposed): discard this result.
        return;
      }
      this.emit({
        status: "up-to-date",
        swfBytes: bytes,
        swfSize: bytes.byteLength,
        compileMs: Math.max(0, this.now() - startedAt),
        error: null,
        inFlight: false,
      });
    } catch (err) {
      if (this.disposed || myGen !== this.generation) return;
      const msg = err instanceof Error ? err.message : String(err);
      // KEEP last-good bytes — only surface the error. The preview stays on the
      // last successful SWF; the banner shows the message.
      this.emit({ status: "error", error: msg, inFlight: false });
    }
  }

  /** Cancel any pending/in-flight compile and stop emitting. */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
    // Bump generation so any in-flight compile's resolution is discarded.
    this.generation++;
  }
}
