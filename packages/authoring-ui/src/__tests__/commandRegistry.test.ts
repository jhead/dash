import { describe, it, expect } from "vitest";
import { createDocument } from "@flash/core";
import { createCommandRegistry } from "../commands/registry.js";
import type { CommandContext, EditorCommand } from "../commands/types.js";
import { createDocumentStore } from "../store/documentStore.js";
import { createUiStore } from "../store/uiStore.js";

function makeCtx(): CommandContext {
  return {
    doc: createDocumentStore(createDocument()),
    ui: createUiStore(),
    services: {},
  };
}

describe("command registry", () => {
  it("registers and dispatches a command", () => {
    const reg = createCommandRegistry();
    let ran = 0;
    const cmd: EditorCommand = { id: "test.run", label: "Run", run: () => { ran++; } };
    reg.register(cmd);
    expect(reg.has("test.run")).toBe(true);
    reg.dispatch("test.run", makeCtx());
    expect(ran).toBe(1);
  });

  it("rejects duplicate ids", () => {
    const reg = createCommandRegistry();
    reg.register({ id: "dup", label: "A", run: () => {} });
    expect(() => reg.register({ id: "dup", label: "B", run: () => {} })).toThrow(/Duplicate/);
  });

  it("throws on unknown dispatch", () => {
    const reg = createCommandRegistry();
    expect(() => reg.dispatch("nope", makeCtx())).toThrow(/Unknown command/);
  });

  it("disabled commands are skipped (no-op) and report isEnabled=false", () => {
    const reg = createCommandRegistry();
    let ran = 0;
    reg.register({ id: "gated", label: "Gated", isEnabled: () => false, run: () => { ran++; } });
    const ctx = makeCtx();
    expect(reg.isEnabled("gated", ctx)).toBe(false);
    reg.dispatch("gated", ctx);
    expect(ran).toBe(0);
  });

  it("passes args and context through to run", () => {
    const reg = createCommandRegistry();
    let received: number | null = null;
    const cmd: EditorCommand<number> = {
      id: "with.args",
      label: "Args",
      run: (_ctx, n) => { received = n; },
    };
    reg.register(cmd);
    reg.dispatch("with.args", makeCtx(), 42);
    expect(received).toBe(42);
  });
});
