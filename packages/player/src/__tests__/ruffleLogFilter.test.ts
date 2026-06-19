import { describe, expect, it, vi } from "vitest";
import {
  makeTraceObserver,
  shouldSuppressRuffleLog,
  stripConsoleCssFormat,
} from "../ruffleLogFilter.js";

describe("stripConsoleCssFormat", () => {
  it("strips %c tokens and drops CSS style arguments", () => {
    const cleaned = stripConsoleCssFormat([
      "%cERROR%c core/src/library.rs:559%c Error running definition tag: ScriptLimits",
      "color:red",
      "color:default",
      "color:default",
    ]);
    expect(cleaned).toEqual([
      "ERROR core/src/library.rs:559 Error running definition tag: ScriptLimits",
    ]);
  });
});

describe("shouldSuppressRuffleLog", () => {
  it("forwards Ruffle ERROR messages (styled console.log)", () => {
    const args = [
      "%cERROR%c Error running definition tag: ScriptLimits, got Couldn't read SWF",
      "color:red",
      "color:default",
    ];
    expect(shouldSuppressRuffleLog(args)).toBe(false);
  });

  it("forwards Ruffle WARN messages", () => {
    const args = [
      "%cWARN%c core/src/library.rs:559 Unknown device font: _sans",
      "color:orange",
      "color:default",
    ];
    expect(shouldSuppressRuffleLog(args)).toBe(false);
  });

  it("suppresses Ruffle INFO diagnostics", () => {
    const args = ["%cINFO%c Loading SWF file blob:...", "color:blue", "color:default"];
    expect(shouldSuppressRuffleLog(args)).toBe(true);
  });

  it("suppresses Ruffle DEBUG diagnostics", () => {
    expect(shouldSuppressRuffleLog(["debug: some internal detail"])).toBe(true);
  });

  it("forwards a plain message with no Ruffle severity prefix", () => {
    expect(shouldSuppressRuffleLog(["hello from somewhere"])).toBe(false);
  });

  // AS2 trace() does NOT arrive as a plain console.log line. Ruffle emits it as
  // a tracing INFO event on the `avm_trace` target, which the WASMLayer renders
  // to the console as a styled "%cINFO%c ... avm_trace ... <msg>" line. After
  // CSS stripping it starts with "INFO", so the console filter suppresses it —
  // which is correct now that trace() is delivered via the dedicated
  // `traceObserver` channel (RufflePlayer.tsx) and must not also be scraped
  // here. This test pins that the styled-INFO avm_trace line stays suppressed so
  // we never double-deliver a trace to the Output panel.
  it("suppresses the styled INFO avm_trace console line (trace uses the observer)", () => {
    const args = [
      "%cINFO%c ruffle_web::log_adapter%c [avm_trace] hello from trace()",
      "color:blue",
      "color:gray",
      "color:default",
    ];
    expect(shouldSuppressRuffleLog(args)).toBe(true);
  });

  it("forwards non-Ruffle messages like instance creation", () => {
    expect(
      shouldSuppressRuffleLog([
        "New Ruffle instance created (Version: 0.2.0 | WebAssembly extensions: ON)",
      ]),
    ).toBe(false);
  });
});

describe("makeTraceObserver", () => {
  it("forwards a trace() message straight to onTrace with NO filtering", () => {
    const onTrace = vi.fn();
    const observer = makeTraceObserver(() => onTrace);
    // This is the exact text the INFO console filter would suppress; the
    // observer must deliver it regardless.
    observer("hello from trace()");
    expect(onTrace).toHaveBeenCalledTimes(1);
    expect(onTrace).toHaveBeenCalledWith("hello from trace()");
  });

  it("reads the current callback lazily (ref identity may change per render)", () => {
    let current: ((line: string) => void) | undefined;
    const observer = makeTraceObserver(() => current);

    const first = vi.fn();
    current = first;
    observer("a");

    const second = vi.fn();
    current = second; // simulate a ref being updated on re-render
    observer("b");

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith("a");
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith("b");
  });

  it("is a no-op when no onTrace sink is registered", () => {
    const observer = makeTraceObserver(() => undefined);
    expect(() => observer("dropped")).not.toThrow();
  });

  // End-to-end of the observer wiring: a fake <ruffle-player> element exposes a
  // `traceObserver` setter (as the real bundled build does); registering the
  // observer and firing it must push the line to the Output sink, proving the
  // trace path is fed by the observer rather than the INFO-filtered console.
  it("delivers via the player element's traceObserver setter to the Output sink", () => {
    const output: string[] = [];
    const onTrace = (line: string) => output.push(line);

    let registered: ((message: string) => void) | null = null;
    const fakePlayer = {
      set traceObserver(cb: ((message: string) => void) | null) {
        registered = cb;
      },
    };

    fakePlayer.traceObserver = makeTraceObserver(() => onTrace);
    expect(registered).toBeTypeOf("function");

    // Ruffle invokes the observer for each real avm_trace.
    registered!("hello");
    registered!("world");

    expect(output).toEqual(["hello", "world"]);
  });
});
