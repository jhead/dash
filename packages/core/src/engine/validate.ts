import { compileAS2 } from "../as2/compiler.js";

export interface ValidationResult {
  readonly valid: boolean;
  readonly error?: {
    readonly line?: number;
    readonly col?: number;
    readonly message: string;
  };
}

/**
 * Validate an AS2 frame script by attempting to parse and compile it.
 * Returns { valid: true } for empty/whitespace-only scripts.
 * On parse or compile error, returns { valid: false, error: { line?, col?, message } }.
 */
export function validateFrameScript(script: string | null | undefined): ValidationResult {
  if (!script || script.trim() === "") return { valid: true };
  try {
    compileAS2(script);
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Try to extract line/col from error message (e.g. "Parse error at line 3: ...")
    const lineMatch = /line (\d+)/i.exec(message);
    const colMatch = /col(?:umn)? (\d+)/i.exec(message);
    return {
      valid: false,
      error: {
        line: lineMatch ? parseInt(lineMatch[1], 10) : undefined,
        col: colMatch ? parseInt(colMatch[1], 10) : undefined,
        message,
      },
    };
  }
}
