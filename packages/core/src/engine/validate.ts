import { compileAS2 } from "../as2/compiler.js";
import type { DocumentProperties } from "../model/types.js";

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

export interface PropertyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validate document properties (width, height, frameRate, backgroundColor).
 * Returns { valid: true, errors: [] } when all properties are in range.
 */
export function validateDocumentProperties(props: DocumentProperties): PropertyValidationResult {
  const errors: string[] = [];

  if (!Number.isFinite(props.width) || props.width < 1 || props.width > 2880)
    errors.push(`width must be 1-2880, got ${props.width}`);

  if (!Number.isFinite(props.height) || props.height < 1 || props.height > 2880)
    errors.push(`height must be 1-2880, got ${props.height}`);

  if (!Number.isFinite(props.frameRate) || props.frameRate < 0.01 || props.frameRate > 120)
    errors.push(`frameRate must be 0.01-120, got ${props.frameRate}`);

  if (!/^#[0-9a-fA-F]{6}$/.test(props.backgroundColor))
    errors.push(`backgroundColor must be CSS hex #rrggbb, got "${props.backgroundColor}"`);

  return { valid: errors.length === 0, errors };
}
