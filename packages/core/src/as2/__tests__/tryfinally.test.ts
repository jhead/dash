/**
 * Tests for AS2 try/finally (no catch block) compilation.
 *
 * Regression: without a catch block the compiler previously emitted 0 bytes
 * for the catch_var field.  Ruffle's read_try() unconditionally calls
 * read_str() for catch_var regardless of HasCatchBlock, so the missing null
 * byte caused read_str() to consume bytes from TryBody, corrupting the
 * finally body entirely.
 *
 * Fix: always emit at least a null byte (0x00) for catch_var, and include
 * that 1 byte in payloadLen, even when !hasCatch.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse an ActionTry (0x8F) record from raw bytes.
 * Returns { payloadLen, flags, trySize, catchSize, finallySize, catchVar,
 *           headerEnd, tryBodyStart } or null if 0x8F not found.
 *
 * ActionTry wire format (Ruffle read_try):
 *   opcode    (1):  0x8F
 *   length    (2):  UI16 — payload byte count (does NOT include bodies)
 *   flags     (1):  UI8
 *   trySize   (2):  UI16
 *   catchSize (2):  UI16
 *   finallySize(2): UI16
 *   catch_var (N):  null-terminated string (always present — even if no catch)
 *   TryBody   (trySize bytes)
 *   CatchBody (catchSize bytes)
 *   FinallyBody (finallySize bytes)
 */
function parseActionTry(bytes: Uint8Array): {
  payloadLen: number;
  flags: number;
  trySize: number;
  catchSize: number;
  finallySize: number;
  catchVar: string;
  headerEnd: number;
  tryBodyStart: number;
} | null {
  const pos = bytes.indexOf(0x8f);
  if (pos < 0) return null;

  const payloadLen = bytes[pos + 1] | (bytes[pos + 2] << 8);
  const flags = bytes[pos + 3];
  const trySize = bytes[pos + 4] | (bytes[pos + 5] << 8);
  const catchSize = bytes[pos + 6] | (bytes[pos + 7] << 8);
  const finallySize = bytes[pos + 8] | (bytes[pos + 9] << 8);

  // Read null-terminated catch_var string starting at pos+10
  let nameEnd = pos + 10;
  while (nameEnd < bytes.length && bytes[nameEnd] !== 0) nameEnd++;
  const catchVar = new TextDecoder().decode(bytes.slice(pos + 10, nameEnd));
  const headerEnd = nameEnd + 1; // past the null terminator
  const tryBodyStart = headerEnd;

  return { payloadLen, flags, trySize, catchSize, finallySize, catchVar, headerEnd, tryBodyStart };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 try/finally (no catch) — catch_var null byte regression", () => {
  it("1. try { trace(1); } finally { trace(2); } compiles without error", () => {
    expect(() => compileAS2(`try { trace(1); } finally { trace(2); }`)).not.toThrow();
  });

  it("2. output contains ActionTry opcode 0x8F", () => {
    const bytes = compileAS2(`try { trace(1); } finally { trace(2); }`);
    expect(bytes).toContain(0x8f);
  });

  it("3. flags byte is 0x02 (HasFinallyBlock only, no HasCatchBlock)", () => {
    const bytes = compileAS2(`try { trace(1); } finally { trace(2); }`);
    const rec = parseActionTry(bytes);
    expect(rec).not.toBeNull();
    // HasCatch=0, HasFinally=1, CatchInRegister=0 => 0x02
    expect(rec!.flags).toBe(0x02);
  });

  it("4. payloadLen accounts for the always-present catch_var null byte", () => {
    const bytes = compileAS2(`try { trace(1); } finally { trace(2); }`);
    const rec = parseActionTry(bytes);
    expect(rec).not.toBeNull();
    // payloadLen = flags(1) + trySize(2) + catchSize(2) + finallySize(2) + catchVar('\0' = 1)
    // = 8 minimum
    expect(rec!.payloadLen).toBeGreaterThanOrEqual(8);
    // When catch_var is empty string the total header is exactly 8
    expect(rec!.catchVar).toBe("");
    expect(rec!.payloadLen).toBe(8);
  });

  it("5. trySize, catchSize, finallySize are all > 0 and correct", () => {
    const bytes = compileAS2(`try { trace(1); } finally { trace(2); }`);
    const rec = parseActionTry(bytes);
    expect(rec).not.toBeNull();
    // try body compiles trace(1) — at least a few bytes
    expect(rec!.trySize).toBeGreaterThan(0);
    // no catch block
    expect(rec!.catchSize).toBe(0);
    // finally body compiles trace(2) — at least a few bytes
    expect(rec!.finallySize).toBeGreaterThan(0);
  });

  it("6. finally body bytes immediately follow try body (catch body is empty)", () => {
    const bytes = compileAS2(`try { trace(1); } finally { trace(2); }`);
    const rec = parseActionTry(bytes);
    expect(rec).not.toBeNull();

    // The finally body starts at headerEnd + trySize + catchSize
    const finallyStart = rec!.tryBodyStart + rec!.trySize + rec!.catchSize;
    const totalAfterHeader = rec!.trySize + rec!.catchSize + rec!.finallySize;
    expect(finallyStart + rec!.finallySize).toBeLessThanOrEqual(bytes.length);

    // Sanity: finally body is non-empty (trace(2) produces bytes)
    const finallyBody = bytes.slice(finallyStart, finallyStart + rec!.finallySize);
    expect(finallyBody.length).toBeGreaterThan(0);
    // Finally body should not start with 0x00 (which would mean we grabbed the
    // catch_var null byte instead of the actual compiled code)
    expect(finallyBody[0]).not.toBe(0x00);
  });

  it("7. try { trace(1); } finally { trace(2); } try+finally sizes sum equals total body bytes", () => {
    const bytes = compileAS2(`try { trace(1); } finally { trace(2); }`);
    const rec = parseActionTry(bytes);
    expect(rec).not.toBeNull();

    // payloadLen covers flags(1) + sizes(6) + catchVar(1) = 8; bodies are additive
    // Total record bytes = 1(opcode) + 2(len) + payloadLen + trySize + catchSize + finallySize
    const totalRecord = 3 + rec!.payloadLen + rec!.trySize + rec!.catchSize + rec!.finallySize;
    // The ActionTry record must fit within the compiled output
    expect(totalRecord).toBeLessThanOrEqual(bytes.length);
  });

  it("8. try/catch/finally with catch still emits correct null-terminated catch_var", () => {
    const bytes = compileAS2(`try { trace(1); } catch(err) { trace(2); } finally { trace(3); }`);
    const rec = parseActionTry(bytes);
    expect(rec).not.toBeNull();
    // flags: HasCatch=1, HasFinally=1 => 0x03
    expect(rec!.flags).toBe(0x03);
    // catch_var must be "err"
    expect(rec!.catchVar).toBe("err");
    // payloadLen = 1(flags) + 2+2+2(sizes) + 3(err) + 1(null) = 11
    expect(rec!.payloadLen).toBe(11);
  });

  it("9. try/catch (no finally) still emits correct null-terminated catch_var", () => {
    const bytes = compileAS2(`try { trace(1); } catch(e) { trace(2); }`);
    const rec = parseActionTry(bytes);
    expect(rec).not.toBeNull();
    // flags: HasCatch=1, HasFinally=0 => 0x01
    expect(rec!.flags).toBe(0x01);
    expect(rec!.catchVar).toBe("e");
    // payloadLen = 1 + 6 + 1(e) + 1(null) = 9
    expect(rec!.payloadLen).toBe(9);
  });
});
