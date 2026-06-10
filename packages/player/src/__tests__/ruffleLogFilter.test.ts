import { describe, expect, it } from "vitest";
import { shouldSuppressRuffleLog, stripConsoleCssFormat } from "../ruffleLogFilter.js";

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

  it("forwards plain AS2 trace() output", () => {
    expect(shouldSuppressRuffleLog(["hello from trace()"])).toBe(false);
  });

  it("forwards non-Ruffle messages like instance creation", () => {
    expect(
      shouldSuppressRuffleLog([
        "New Ruffle instance created (Version: 0.2.0 | WebAssembly extensions: ON)",
      ]),
    ).toBe(false);
  });
});
