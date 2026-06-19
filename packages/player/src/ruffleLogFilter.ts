/**
 * Utilities for routing Ruffle output to the editor Output panel.
 *
 * Two distinct channels reach the panel:
 *  1. AS2/AVM `trace()` — delivered via Ruffle's DEDICATED trace observer
 *     (`<ruffle-player>.traceObserver`). Use `makeTraceObserver` for this; it
 *     applies NO filtering (the observer only ever carries real trace output).
 *  2. Ruffle's own diagnostics — scraped from console.log/console.warn, which
 *     Ruffle emits as styled %c CSS messages:
 *       console.warn('%cERROR%c core/src/foo.rs:123 message', style1, style2)
 *     Only ERROR/WARN are forwarded; DEBUG/INFO (which is also how avm_trace
 *     surfaces on the console) are suppressed by `shouldSuppressRuffleLog`.
 */

/**
 * Build the callback to register on Ruffle's dedicated trace observer
 * (`<ruffle-player>.traceObserver` -> `set_trace_observer`).
 *
 * The observer fires once per real AVM `trace()` call with the plain message
 * string. We forward it straight to the Output-panel sink with NO log-level
 * filtering — unlike the console scrape, this channel only ever carries real
 * trace output, so the INFO/avm suppression in `shouldSuppressRuffleLog` must
 * never apply here. `getOnTrace` is read lazily so a ref-held callback whose
 * identity changes between renders is always the current one.
 */
export function makeTraceObserver(
  getOnTrace: () => ((line: string) => void) | undefined
): (message: string) => void {
  return (message: string) => {
    getOnTrace()?.(message);
  };
}

/** Low-severity Ruffle diagnostics that should NOT appear in the Output panel. */
const RUFFLE_SUPPRESSED_PREFIXES = [
  "debug",
  "[ruffle",
  "ruffle:",
  "info",
  "avm", // e.g. "AVM1:"
];

/**
 * Strip console CSS format tokens from a Ruffle log message.
 *
 * The first argument contains `%c` markers and the remaining arguments are CSS
 * strings that should be dropped. Returns plain text like
 * "ERROR core/src/library.rs:559 message".
 */
export function stripConsoleCssFormat(args: unknown[]): unknown[] {
  if (args.length === 0) return args;
  const first = String(args[0]);
  if (!first.includes("%c")) return args;
  const stripped = first.replace(/%c/g, "").replace(/\s+/g, " ").trim();
  return [stripped];
}

function isRuffleErrorOrWarnSeverity(text: string): boolean {
  const lower = text.trimStart().toLowerCase();
  return (
    lower.startsWith("error") ||
    lower.startsWith("warn") ||
    lower.startsWith("warning")
  );
}

/** Detect ERROR/WARN from the raw %c format string before CSS args are stripped. */
function hasErrorOrWarnCssToken(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const first = String(args[0]);
  return /%c\s*(error|warn|warning)\s*%c/i.test(first);
}

/**
 * Return true when a console call should be suppressed (not forwarded to Output).
 *
 * ERROR and WARN severity Ruffle messages are always forwarded; DEBUG/INFO spam
 * and other low-severity internal diagnostics are suppressed. Plain trace() lines
 * (no Ruffle severity prefix) are forwarded.
 */
export function shouldSuppressRuffleLog(args: unknown[]): boolean {
  if (args.length === 0) return true;

  // Always forward styled ERROR/WARN tokens even before stripping.
  if (hasErrorOrWarnCssToken(args)) return false;

  const cleaned = stripConsoleCssFormat(args);
  const first = String(cleaned[0]);

  // Forward ERROR/WARN severity diagnostics to the Output panel.
  if (isRuffleErrorOrWarnSeverity(first)) return false;

  const firstLower = first.trimStart().toLowerCase();
  return RUFFLE_SUPPRESSED_PREFIXES.some((prefix) => firstLower.startsWith(prefix));
}
