/**
 * Frame-level script / control-tag helpers.
 *
 * (The full frame DoAction synthesis — frame scripts, letterSpacing, restrict,
 * tab order, _quality, loop-mode/clip-action synthesis — is threaded through
 * CompileContext by the orchestrator; this module currently owns the standalone
 * RemoveObject2 encoder used by the per-frame loop.)
 */
import { BitWriter } from "../bits.js";

/** RemoveObject2 (tag 28) — body is just the UI16 depth. */
export function encodeRemoveObject2(depth: number): Uint8Array {
  const bw = new BitWriter();
  bw.writeUI16LE(depth);
  return bw.getBytes();
}
