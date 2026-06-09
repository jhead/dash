/**
 * Unit tests for snapshotFrame.
 *
 * In a Node.js / Vitest environment OffscreenCanvas is undefined, so all
 * rendering paths that require it should return null gracefully.
 */

import { describe, it, expect } from "vitest";
import { snapshotFrame } from "../snapshot.js";
import { createDocument } from "../../model/document.js";
import type { FlashDocument } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(): FlashDocument {
  return createDocument();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("snapshotFrame", () => {
  it("is a function", () => {
    expect(typeof snapshotFrame).toBe("function");
  });

  it("returns a Promise", () => {
    const result = snapshotFrame(makeDoc(), 0, 0);
    expect(result).toBeInstanceOf(Promise);
    // Do not await — OffscreenCanvas is unavailable in Node
  });

  it("returns null when OffscreenCanvas unavailable", async () => {
    // In the Node test environment, OffscreenCanvas is undefined
    const result = await snapshotFrame(makeDoc(), 0, 0);
    expect(result).toBeNull();
  });

  it("accepts optional width and height", () => {
    // Should not throw synchronously
    expect(() => snapshotFrame(makeDoc(), 0, 0, 100, 100)).not.toThrow();
  });

  it("handles out-of-range sceneIndex gracefully", async () => {
    const result = await snapshotFrame(makeDoc(), 999, 0);
    expect(result).toBeNull();
  });

  it("handles out-of-range frameIndex gracefully", async () => {
    // Frame 999 does not exist, but getTweenedFrame returns null gracefully.
    // OffscreenCanvas is unavailable in Node so still returns null.
    const result = await snapshotFrame(makeDoc(), 0, 999);
    expect(result).toBeNull();
  });
});
