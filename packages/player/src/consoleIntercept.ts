/**
 * Ref-counted, module-scoped console.log/console.warn interceptor.
 *
 * Ruffle emits its own diagnostics (and the editor scrapes them) via
 * console.log/console.warn. Several `<ruffle-player>` instances can be mounted
 * at once — e.g. the Test Movie modal AND the Live Preview tab — so the console
 * patch MUST be shared, not installed per-instance.
 *
 * The old per-instance approach had each RufflePlayer replace `console.log`,
 * stashing whatever it found as "the original". With two concurrent instances
 * that nests: instance B captured A's wrapper as its "original", and if the
 * unmounts interleaved (A restores the real console, then B restores A's
 * wrapper) `console.log` was left permanently pointing at a stale wrapper — a
 * global-state leak.
 *
 * This module fixes that by capturing the PRISTINE console methods exactly once
 * (when the first sink registers) and restoring them exactly once (when the last
 * sink unregisters). Between those two points a single shared wrapper forwards
 * to the real console and then fans out to every registered sink. Registering
 * and unregistering are idempotent and order-independent, so any interleaving of
 * concurrent players is safe.
 */

/** A consumer of intercepted console output. */
export type ConsoleSink = (method: "log" | "warn", args: unknown[]) => void;

const sinks = new Set<ConsoleSink>();

// The pristine console methods captured when the first sink registered, and the
// exact wrapper functions we installed. We only restore the pristine methods if
// `console.log`/`console.warn` are still OUR wrappers, so we never clobber a
// patch installed by unrelated code after us.
let pristineLog: typeof console.log | null = null;
let pristineWarn: typeof console.warn | null = null;
let ourLogWrapper: typeof console.log | null = null;
let ourWarnWrapper: typeof console.warn | null = null;

function fanOut(method: "log" | "warn", args: unknown[]): void {
  // Snapshot so a sink that unregisters itself during dispatch can't mutate the
  // set mid-iteration.
  for (const sink of Array.from(sinks)) {
    try {
      sink(method, args);
    } catch {
      // A misbehaving sink must never break console output for everyone else.
    }
  }
}

function install(): void {
  pristineLog = console.log;
  pristineWarn = console.warn;
  ourLogWrapper = (...args: unknown[]) => {
    pristineLog?.(...args);
    fanOut("log", args);
  };
  ourWarnWrapper = (...args: unknown[]) => {
    pristineWarn?.(...args);
    fanOut("warn", args);
  };
  console.log = ourLogWrapper;
  console.warn = ourWarnWrapper;
}

function restore(): void {
  // Only un-patch if we still own the current binding; otherwise leave the
  // later owner's wrapper in place.
  if (pristineLog && console.log === ourLogWrapper) console.log = pristineLog;
  if (pristineWarn && console.warn === ourWarnWrapper) console.warn = pristineWarn;
  pristineLog = null;
  pristineWarn = null;
  ourLogWrapper = null;
  ourWarnWrapper = null;
}

/**
 * Register a sink to receive intercepted console.log/console.warn calls.
 *
 * The first registration captures the pristine console methods and installs the
 * shared wrapper; subsequent registrations just join the fan-out. Returns an
 * idempotent unregister function; when the last sink unregisters, the pristine
 * console methods are restored.
 */
export function installConsoleSink(sink: ConsoleSink): () => void {
  if (sinks.size === 0) install();
  sinks.add(sink);

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    sinks.delete(sink);
    if (sinks.size === 0) restore();
  };
}

/** Number of currently-registered sinks. Exposed for tests/diagnostics. */
export function consoleSinkCount(): number {
  return sinks.size;
}
