/**
 * Peer-count realism (task 1348 P5): the pure advice mapping that drives the
 * high-peer-count warning. No artificial cap — only an expectation-setting
 * message past the soft threshold.
 */
import { describe, it, expect } from "vitest";
import { PEER_COUNT_WARN_THRESHOLD, peerCountAdvice } from "../peerCount.js";

describe("peerCountAdvice", () => {
  it("is OK for a small session (no warning)", () => {
    for (const peers of [0, 1, 2, 5]) {
      const a = peerCountAdvice(peers);
      expect(a.warn).toBe(false);
      expect(a.severity).toBe("ok");
      expect(a.message).toBe("");
      expect(a.participants).toBe(peers + 1);
    }
  });

  it("does NOT warn exactly AT the threshold (participants == threshold)", () => {
    // threshold-1 OTHER peers => participants == threshold, still OK.
    const a = peerCountAdvice(PEER_COUNT_WARN_THRESHOLD - 1);
    expect(a.participants).toBe(PEER_COUNT_WARN_THRESHOLD);
    expect(a.warn).toBe(false);
  });

  it("warns once participants EXCEED the threshold", () => {
    const a = peerCountAdvice(PEER_COUNT_WARN_THRESHOLD);
    expect(a.participants).toBe(PEER_COUNT_WARN_THRESHOLD + 1);
    expect(a.warn).toBe(true);
    expect(a.severity).toBe("high");
    expect(a.message).toContain(String(PEER_COUNT_WARN_THRESHOLD));
    expect(a.message).toContain(String(PEER_COUNT_WARN_THRESHOLD + 1));
  });

  it("clamps non-finite / negative inputs to zero peers", () => {
    for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const a = peerCountAdvice(bad);
      expect(a.participants).toBe(1);
      expect(a.warn).toBe(false);
    }
  });
});
