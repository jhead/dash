// Unit tests for the Agent Chat tool bridge (Phase 2, task 1277).
//
// Verifies:
//   1. The generated tool set covers ALL_COMMANDS exactly (count + names).
//   2. A sample tool's execute calls dispatchAgentCommand with the right
//      name/args (registry mocked) and returns the command result.
//   3. Each tool's inputSchema is the command's agent-protocol Zod schema.
//   4. The editor-ready guard + generic errors are returned, not thrown.

import { describe, it, expect, vi } from "vitest";
import {
  ALL_COMMANDS,
  COMMAND_SCHEMAS,
  type AgentCommand,
} from "@flash/agent-protocol";

// Mock the registry so we can assert the bridge dispatches by name/args without
// a live editor. The default `buildAgentTools()` (no injected dispatch) uses
// this mocked `dispatchAgentCommand`.
const dispatchMock = vi.fn();
vi.mock("../../agent/registry.js", () => ({
  dispatchAgentCommand: (command: string, params: Record<string, unknown>) =>
    dispatchMock(command, params),
}));

import { buildAgentTools, type AgentToolError } from "../tools.js";

describe("buildAgentTools — coverage", () => {
  it("produces exactly one tool per command in ALL_COMMANDS", () => {
    const tools = buildAgentTools();
    const toolNames = Object.keys(tools).sort();
    const commandNames = [...ALL_COMMANDS].sort();

    expect(toolNames.length).toBe(ALL_COMMANDS.length);
    expect(toolNames).toEqual(commandNames);
  });

  it("gives every tool a non-empty description and an inputSchema", () => {
    const tools = buildAgentTools();
    for (const name of ALL_COMMANDS) {
      const t = tools[name];
      expect(t, name).toBeDefined();
      expect(typeof t.description, name).toBe("string");
      expect((t.description as string).length, name).toBeGreaterThan(0);
      expect(t.inputSchema, name).toBeDefined();
    }
  });

  it("uses the command's own agent-protocol Zod schema as inputSchema", () => {
    const tools = buildAgentTools();
    for (const name of ALL_COMMANDS) {
      // Identity check: the tool's inputSchema must be the SAME schema object
      // exported for that command in the protocol registry.
      expect(tools[name].inputSchema, name).toBe(COMMAND_SCHEMAS[name]);
    }
  });
});

describe("buildAgentTools — execute dispatches via the registry", () => {
  it("calls dispatchAgentCommand with the tool's command name and args", async () => {
    dispatchMock.mockReset();
    dispatchMock.mockResolvedValue({ id: "obj-1", rev: 7 });

    const tools = buildAgentTools();
    const args = {
      shapeType: "rect",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      fillColor: "#ff0000",
    };

    // AI SDK tool.execute(args, options) — options is unused by our bridge.
    const result = await tools.stage_add_shape.execute!(args, {} as never);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith("stage_add_shape", args);
    expect(result).toEqual({ id: "obj-1", rev: 7 });
  });

  it("coerces a missing arg to an empty object for paramless tools", async () => {
    dispatchMock.mockReset();
    dispatchMock.mockResolvedValue({ ok: true });

    const tools = buildAgentTools();
    await tools.playback_play.execute!(undefined as never, {} as never);

    expect(dispatchMock).toHaveBeenCalledWith("playback_play", {});
  });
});

describe("buildAgentTools — error handling (never throws past the loop)", () => {
  it("returns a structured editor-not-ready error from the guard", async () => {
    dispatchMock.mockReset();
    dispatchMock.mockRejectedValue(
      new Error("Editor not ready: agent callbacks not wired")
    );

    const tools = buildAgentTools();
    const result = (await tools.editor_status.execute!(
      {},
      {} as never
    )) as AgentToolError;

    expect(result.editorNotReady).toBe(true);
    expect(result.command).toBe("editor_status");
    expect(result.error).toMatch(/editor not ready/i);
  });

  it("returns a structured error (not a throw) for any dispatch failure", async () => {
    dispatchMock.mockReset();
    dispatchMock.mockRejectedValue(new Error('Unknown layerId "nope"'));

    const tools = buildAgentTools();
    const result = (await tools.timeline_remove_layer.execute!(
      { layerId: "nope" },
      {} as never
    )) as AgentToolError;

    expect(result.command).toBe("timeline_remove_layer");
    expect(result.error).toContain("nope");
    expect(result.editorNotReady).toBeUndefined();
  });
});

describe("buildAgentTools — injectable dispatch", () => {
  it("uses the provided dispatch override instead of the registry", async () => {
    const injected = vi.fn(
      async (command: string, params: Record<string, unknown>) => ({
        echoed: { command, params },
      })
    );

    const tools = buildAgentTools({ dispatch: injected });
    const seen: AgentCommand[] = [];
    // Smoke-call a couple of tools through the injected dispatcher.
    for (const name of ["doc_summary", "history_undo"] as AgentCommand[]) {
      await tools[name].execute!({}, {} as never);
      seen.push(name);
    }

    expect(injected).toHaveBeenCalledTimes(2);
    expect(injected).toHaveBeenNthCalledWith(1, "doc_summary", {});
    expect(injected).toHaveBeenNthCalledWith(2, "history_undo", {});
    expect(seen).toEqual(["doc_summary", "history_undo"]);
  });
});
