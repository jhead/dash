/**
 * Utilities for filtering Ruffle console output before forwarding to the
 * editor Output panel.
 *
 * Ruffle emits styled diagnostics via console.log/warn with %c CSS tokens:
 *   console.warn('%cERROR%c core/src/foo.rs:123 message', style1, style2)
 *
 * AS2 trace() output is plain console.log with no severity prefix.
 */

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
