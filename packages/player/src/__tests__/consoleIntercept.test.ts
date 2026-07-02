import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consoleSinkCount,
  installConsoleSink,
} from "../consoleIntercept.js";

/**
 * Regression coverage for the global console monkeypatch leak that occurred
 * with two concurrent RufflePlayer instances (task 1402). The old per-instance
 * swap let instance B capture A's wrapper as its "original", so interleaved
 * unmounts left console.log permanently pointing at a stale wrapper.
 */
describe("consoleIntercept", () => {
  // Snapshot the real console methods before each test and hard-restore after,
  // so a failing assertion can never corrupt the shared console for later tests.
  let realLog: typeof console.log;
  let realWarn: typeof console.warn;
  beforeEach(() => {
    realLog = console.log;
    realWarn = console.warn;
  });
  afterEach(() => {
    console.log = realLog;
    console.warn = realWarn;
    expect(consoleSinkCount()).toBe(0);
  });

  it("captures the pristine console methods once and restores on last removal", () => {
    const remove = installConsoleSink(() => {});
    expect(console.log).not.toBe(realLog);
    expect(console.warn).not.toBe(realWarn);
    expect(consoleSinkCount()).toBe(1);

    remove();
    expect(console.log).toBe(realLog);
    expect(console.warn).toBe(realWarn);
    expect(consoleSinkCount()).toBe(0);
  });

  it("forwards log and warn calls to the sink with the method label", () => {
    const seen: Array<[string, unknown[]]> = [];
    const remove = installConsoleSink((method, args) => {
      seen.push([method, args]);
    });

    console.log("hello", 1);
    console.warn("world");

    expect(seen).toEqual([
      ["log", ["hello", 1]],
      ["warn", ["world"]],
    ]);
    remove();
  });

  it("still calls the pristine console method (output is not swallowed)", () => {
    const calls: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      calls.push(args);
    };
    const remove = installConsoleSink(() => {});
    console.log("passthrough");
    expect(calls).toEqual([["passthrough"]]);
    remove();
    // After removal, our restore returns the wrapper we captured on install —
    // i.e. the custom console.log set above, not the vitest default.
    expect(calls).toEqual([["passthrough"]]);
  });

  it("does NOT leak when two instances unmount in interleaved order (the 1402 bug)", () => {
    const aSeen: unknown[][] = [];
    const bSeen: unknown[][] = [];

    // A mounts, then B mounts (both patch the shared console).
    const removeA = installConsoleSink((_m, args) => aSeen.push(args));
    const removeB = installConsoleSink((_m, args) => bSeen.push(args));
    expect(consoleSinkCount()).toBe(2);

    // A unmounts FIRST — the interleave that used to corrupt the global.
    removeA();
    expect(consoleSinkCount()).toBe(1);
    // Console is still patched (B is live) — B must still receive output.
    expect(console.log).not.toBe(realLog);

    console.log("after-A-unmount");
    expect(bSeen).toEqual([["after-A-unmount"]]);
    expect(aSeen).toEqual([]); // A must no longer receive anything.

    // B unmounts — console is fully restored to the PRISTINE method, not a
    // stale wrapper (the crux of the leak).
    removeB();
    expect(console.log).toBe(realLog);
    expect(console.warn).toBe(realWarn);
    expect(consoleSinkCount()).toBe(0);
  });

  it("fans out a single console call to all live sinks", () => {
    const a: unknown[][] = [];
    const b: unknown[][] = [];
    const removeA = installConsoleSink((_m, args) => a.push(args));
    const removeB = installConsoleSink((_m, args) => b.push(args));

    console.log("shared");
    expect(a).toEqual([["shared"]]);
    expect(b).toEqual([["shared"]]);

    removeA();
    removeB();
  });

  it("isolates a throwing sink so other sinks and console output survive", () => {
    const good: unknown[][] = [];
    const removeBad = installConsoleSink(() => {
      throw new Error("boom");
    });
    const removeGood = installConsoleSink((_m, args) => good.push(args));

    expect(() => console.log("resilient")).not.toThrow();
    expect(good).toEqual([["resilient"]]);

    removeBad();
    removeGood();
  });

  it("unregister is idempotent", () => {
    const remove = installConsoleSink(() => {});
    remove();
    remove(); // second call is a no-op, must not re-restore or throw
    expect(console.log).toBe(realLog);
    expect(consoleSinkCount()).toBe(0);
  });

  it("does not clobber a foreign patch installed after us on restore", () => {
    const remove = installConsoleSink(() => {});
    const ourWrapper = console.log;
    // A third party patches console.log AFTER our wrapper is installed.
    const foreign = (...args: unknown[]) => void args;
    console.log = foreign;

    remove(); // last sink removed, but we no longer own console.log.
    // We must leave the foreign patch in place, not force our pristine back.
    expect(console.log).toBe(foreign);
    expect(console.log).not.toBe(ourWrapper);
    // afterEach hard-restores console.log to the real method.
  });
});
