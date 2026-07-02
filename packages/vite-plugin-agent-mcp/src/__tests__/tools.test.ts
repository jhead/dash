/**
 * Unit tests for the GENERATED MCP tool surface (task 1393).
 *
 * The plugin used to hand-code its tool schemas, which drifted from the
 * agent-protocol single source of truth: ~7 commands were unreachable, the
 * filter_add type enum was narrow, and stage_update advertised an untyped
 * free-form `updates` bag. These tests connect an in-memory MCP client to the
 * server returned by createMcpServerForRequest() and assert the exposed tool
 * surface exactly matches ALL_COMMANDS / COMMAND_SCHEMAS.
 */

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ALL_COMMANDS,
  COMMAND_DESCRIPTIONS,
} from "@flash/agent-protocol";
import { createMcpServerForRequest, humanizeCommand } from "../index.js";

type JsonSchema = Record<string, unknown>;
interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

async function listTools(): Promise<ToolInfo[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServerForRequest();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    const result = await client.listTools();
    return result.tools as unknown as ToolInfo[];
  } finally {
    await client.close();
  }
}

function props(tool: ToolInfo): Record<string, JsonSchema> {
  return (tool.inputSchema.properties ?? {}) as Record<string, JsonSchema>;
}

describe("MCP tool surface — no drift from the protocol", () => {
  it("exposes exactly one tool per ALL_COMMANDS entry", async () => {
    const tools = await listTools();
    const names = new Set(tools.map((t) => t.name));
    // Every protocol command is reachable.
    for (const command of ALL_COMMANDS) {
      expect(names.has(command)).toBe(true);
    }
    // No extra/renamed tools, and no duplicates.
    expect(tools).toHaveLength(ALL_COMMANDS.length);
    expect(names.size).toBe(ALL_COMMANDS.length);
  });

  it("exposes the 7 commands the hand-coded surface was missing", async () => {
    const tools = await listTools();
    const names = new Set(tools.map((t) => t.name));
    for (const command of [
      "class_list",
      "class_get",
      "class_set",
      "class_remove",
      "class_check",
      "selection_pick_at",
      "stage_set_instance_name",
    ]) {
      expect(names.has(command)).toBe(true);
    }
  });

  it("uses the protocol description for every tool", async () => {
    const tools = await listTools();
    for (const tool of tools) {
      expect(tool.description).toBe(COMMAND_DESCRIPTIONS[tool.name as keyof typeof COMMAND_DESCRIPTIONS]);
    }
  });

  it("filter_add advertises the full type enum (gradient + colorMatrix)", async () => {
    const tools = await listTools();
    const filterAdd = tools.find((t) => t.name === "filter_add");
    expect(filterAdd).toBeDefined();
    const typeProp = props(filterAdd!).type as { enum?: string[] };
    expect(typeProp.enum).toBeDefined();
    for (const t of [
      "dropShadow",
      "blur",
      "glow",
      "bevel",
      "gradientGlow",
      "gradientBevel",
      "colorMatrix",
    ]) {
      expect(typeProp.enum).toContain(t);
    }
  });

  it("stage_update exposes a TYPED updates bag (enumerated, not a free record)", async () => {
    const tools = await listTools();
    const stageUpdate = tools.find((t) => t.name === "stage_update");
    expect(stageUpdate).toBeDefined();
    const updates = props(stageUpdate!).updates as JsonSchema;
    expect(updates).toBeDefined();
    // Enumerated fields (typed bag) — a free z.record() would have no `properties`.
    const updatesProps = (updates.properties ?? {}) as Record<string, JsonSchema>;
    expect(updatesProps.x).toBeDefined();
    expect(updatesProps.alpha).toBeDefined();
    expect(updatesProps.instanceName).toBeDefined();
    // The corruption-vector structural keys are intentionally absent.
    expect("shape" in updatesProps).toBe(false);
    expect("filters" in updatesProps).toBe(false);
  });

  it("stage_add_shape accepts a solid string OR a gradient descriptor for fill", async () => {
    const tools = await listTools();
    const addShape = tools.find((t) => t.name === "stage_add_shape");
    const fill = props(addShape!).fill as { anyOf?: JsonSchema[] };
    // union(string, gradientObject) → anyOf in JSON schema
    expect(Array.isArray(fill.anyOf)).toBe(true);
    const hasObject = fill.anyOf!.some((s) => s.type === "object");
    const hasString = fill.anyOf!.some((s) => s.type === "string");
    expect(hasObject).toBe(true);
    expect(hasString).toBe(true);
  });

  it("stage_place_instance advertises the honored transform params", async () => {
    const tools = await listTools();
    const place = tools.find((t) => t.name === "stage_place_instance");
    const p = props(place!);
    expect(p.scaleX).toBeDefined();
    expect(p.scaleY).toBeDefined();
    expect(p.rotation).toBeDefined();
    expect(p.blendMode).toBeDefined();
    expect(p.colorEffect).toBeDefined();
    expect(p.loopMode).toBeDefined();
  });

  it("stage_add_text advertises the honored text-field params", async () => {
    const tools = await listTools();
    const addText = tools.find((t) => t.name === "stage_add_text");
    const p = props(addText!);
    for (const field of ["multiline", "wordWrap", "instanceName", "maxChars", "hasBorder"]) {
      expect(p[field]).toBeDefined();
    }
  });
});

describe("humanizeCommand", () => {
  it("title-cases a snake_case command", () => {
    expect(humanizeCommand("stage_add_shape")).toBe("Stage Add Shape");
    expect(humanizeCommand("class_list")).toBe("Class List");
  });
});
