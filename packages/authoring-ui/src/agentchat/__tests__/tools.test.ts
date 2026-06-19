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

  it("exposes the AS2 class authoring tools to the chat bridge", () => {
    const tools = buildAgentTools();
    const classCommands: AgentCommand[] = [
      "class_list",
      "class_get",
      "class_set",
      "class_remove",
      "class_check",
    ];
    for (const name of classCommands) {
      expect(tools[name], name).toBeDefined();
      expect(typeof tools[name].description, name).toBe("string");
    }
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

describe("buildAgentTools — stage_screenshot delivers an image, not base64 text", () => {
  const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

  it("maps the screenshot result to an image-data content part (round-trips base64)", async () => {
    const dispatch = vi.fn(async () => ({
      pngBase64: PNG_BASE64,
      width: 550,
      height: 400,
    }));

    const tools = buildAgentTools({ dispatch });
    const screenshot = tools.stage_screenshot;

    // The tool must define a toModelOutput override (without it the AI SDK
    // serializes the result as JSON text — base64 the model can't decode).
    expect(typeof screenshot.toModelOutput).toBe("function");

    const output = await screenshot.execute!({}, {} as never);

    const modelOutput = await screenshot.toModelOutput!({
      toolCallId: "call-1",
      input: {},
      output,
    });

    // Model-facing output is a content array, NOT a text/json base64 blob.
    expect(modelOutput.type).toBe("content");
    if (modelOutput.type !== "content") throw new Error("expected content");

    const imagePart = modelOutput.value.find((p) => p.type === "image-data");
    expect(imagePart, "an image-data content part must be present").toBeDefined();
    if (!imagePart || imagePart.type !== "image-data")
      throw new Error("expected image-data part");
    // The base64 round-trips through to the image part with the PNG media type.
    expect(imagePart.data).toBe(PNG_BASE64);
    expect(imagePart.mediaType).toBe("image/png");

    // A short text note carries the dimensions (helps text-only models), but
    // the base64 string must NOT appear anywhere in the text channel.
    const textParts = modelOutput.value.filter((p) => p.type === "text");
    for (const p of textParts) {
      if (p.type !== "text") continue;
      expect(p.text).not.toContain(PNG_BASE64);
      expect(p.text).toMatch(/550.*400/);
    }
  });

  it("passes a structured dispatch error through as JSON (not as an image)", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("Editor not ready: agent callbacks not wired");
    });

    const tools = buildAgentTools({ dispatch });
    const output = await tools.stage_screenshot.execute!({}, {} as never);

    const modelOutput = await tools.stage_screenshot.toModelOutput!({
      toolCallId: "call-2",
      input: {},
      output,
    });

    expect(modelOutput.type).toBe("json");
  });

  it("does NOT add toModelOutput to non-image tools (they stay JSON text)", () => {
    const tools = buildAgentTools();
    expect(tools.stage_add_shape.toModelOutput).toBeUndefined();
    expect(tools.doc_summary.toModelOutput).toBeUndefined();
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
