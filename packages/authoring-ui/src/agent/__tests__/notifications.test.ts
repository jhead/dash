/**
 * Unit tests for the doc-changed notification mechanism (task 0617).
 *
 * Verifies that:
 *  1. bumpRev() increments the counter.
 *  2. The doc-changed callback fires after bumpRev().
 *  3. The callback can be cleared (e.g. on WS disconnect).
 *  4. Errors thrown in the callback do not propagate.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  bumpRev,
  getRev,
  setDocChangedCallback,
} from "../registry.js";

// Reset rev and callback before each test to avoid cross-test pollution.
beforeEach(() => {
  setDocChangedCallback(null);
});

afterEach(() => {
  setDocChangedCallback(null);
});

describe("bumpRev + doc-changed callback", () => {
  it("bumps the revision counter on each call", () => {
    const before = getRev();
    bumpRev();
    expect(getRev()).toBe(before + 1);
    bumpRev();
    expect(getRev()).toBe(before + 2);
  });

  it("fires the registered callback with the new rev", () => {
    const received: number[] = [];
    setDocChangedCallback((rev) => received.push(rev));

    const before = getRev();
    bumpRev();
    bumpRev();

    expect(received).toHaveLength(2);
    expect(received[0]).toBe(before + 1);
    expect(received[1]).toBe(before + 2);
  });

  it("does not fire after the callback is cleared", () => {
    const received: number[] = [];
    setDocChangedCallback((rev) => received.push(rev));

    bumpRev();
    expect(received).toHaveLength(1);

    setDocChangedCallback(null);
    bumpRev();
    // No new notification after clearing
    expect(received).toHaveLength(1);
  });

  it("replaces the previous callback when set twice", () => {
    const first: number[] = [];
    const second: number[] = [];

    setDocChangedCallback((rev) => first.push(rev));
    bumpRev();
    expect(first).toHaveLength(1);

    setDocChangedCallback((rev) => second.push(rev));
    bumpRev();
    // first gets no more calls; second gets the new call
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it("swallows errors thrown in the callback without propagating", () => {
    setDocChangedCallback(() => {
      throw new Error("notification failure");
    });

    // Should not throw
    expect(() => bumpRev()).not.toThrow();
  });

  it("callback receives the exact rev after bump", () => {
    let capturedRev: number | null = null;
    setDocChangedCallback((rev) => { capturedRev = rev; });

    bumpRev();
    expect(capturedRev).toBe(getRev());
  });
});
