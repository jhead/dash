// ---------------------------------------------------------------------------
// Agent Chat tool bridge (Phase 2).
//
// Builds the AI SDK v6 tool set that lets the in-browser LLM drive Dash through
// the SAME transport-agnostic layer the MCP server uses: every tool's `execute`
// calls `dispatchAgentCommand(name, args)` from `../agent/registry`, which
// applies the command to the live document via the Shell-wired callbacks.
//
// The tool set is GENERATED, not hand-coded: it iterates the agent-protocol
// command registry (`COMMAND_SCHEMAS` + `COMMAND_DESCRIPTIONS`), so it always
// covers exactly ALL_COMMANDS with no per-tool boilerplate. Each tool uses the
// command's own Zod params schema as its `inputSchema`, so the model sees the
// same field-level validation/descriptions the rest of the system enforces.
//
// Robustness contract:
//   - `execute` NEVER throws past the agent loop. Any dispatch error (including
//     the "editor not ready" guard, when the Shell hasn't wired callbacks yet)
//     is caught and returned as a structured { error, ... } object so the model
//     can read it and react rather than the loop crashing.
//   - Results are returned as the (JSON-serializable) command result.
// ---------------------------------------------------------------------------

import { tool, type Tool } from "ai";
import {
  ALL_COMMANDS,
  COMMAND_SCHEMAS,
  COMMAND_DESCRIPTIONS,
  type AgentCommand,
} from "@flash/agent-protocol";
import { dispatchAgentCommand } from "../agent/registry.js";

/**
 * A structured error returned from a tool's `execute` instead of throwing.
 * `editorNotReady` is set when the failure is specifically the editor-not-wired
 * guard, so the model (and the UI) can give an actionable hint.
 */
export interface AgentToolError {
  error: string;
  command: AgentCommand;
  /** True when the Shell has not yet wired the agent callbacks. */
  editorNotReady?: boolean;
}

/** The error message thrown by `requireCallbacks()` in the registry. */
const EDITOR_NOT_READY_MARKER = "agent callbacks not wired";

/** How a command result/error is dispatched. Injectable for tests. */
export type Dispatch = (
  command: string,
  params: Record<string, unknown>
) => Promise<unknown>;

export interface BuildAgentToolsOptions {
  /**
   * Override the dispatcher (defaults to `dispatchAgentCommand`). Tests mock
   * this to assert a tool calls dispatch with the right name/args.
   */
  dispatch?: Dispatch;
}

/**
 * The generated tool set, keyed by command name. This is the value P3 passes to
 * the AI SDK agent loop as `{ tools }`.
 */
export type AgentToolSet = Record<AgentCommand, Tool>;

/**
 * Build the AI SDK v6 tool set covering every agent-protocol command.
 *
 * For each command in `ALL_COMMANDS`:
 *   tool({
 *     description: COMMAND_DESCRIPTIONS[name],
 *     inputSchema: COMMAND_SCHEMAS[name],   // the command's Zod params schema
 *     execute:    (args) => dispatch(name, args)  // -> dispatchAgentCommand
 *   })
 *
 * Errors are caught and returned as an `AgentToolError`.
 */
export function buildAgentTools(options: BuildAgentToolsOptions = {}): AgentToolSet {
  const dispatch = options.dispatch ?? dispatchAgentCommand;
  const tools = {} as Record<AgentCommand, Tool>;

  for (const name of ALL_COMMANDS) {
    const inputSchema = COMMAND_SCHEMAS[name];
    const description = COMMAND_DESCRIPTIONS[name];

    tools[name] = tool({
      description,
      inputSchema,
      execute: async (args: unknown): Promise<unknown> => {
        try {
          // The model always produces an object for an object schema; coerce a
          // missing/undefined arg (paramless tools) to an empty object.
          const params = (args ?? {}) as Record<string, unknown>;
          const result = await dispatch(name, params);
          // Return the command result directly so the model can react to it.
          // It is already JSON-serializable (the registry returns plain data).
          return result;
        } catch (err) {
          return toToolError(name, err);
        }
      },
    });
  }

  return tools;
}

/**
 * Normalize a thrown error into a structured tool-result object. Flags the
 * editor-not-ready case so callers can surface an actionable hint instead of an
 * opaque crash.
 */
function toToolError(command: AgentCommand, err: unknown): AgentToolError {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes(EDITOR_NOT_READY_MARKER)) {
    return {
      error:
        "editor not ready: the Dash editor has not finished loading (agent callbacks not wired yet). Wait for the editor to mount, then retry.",
      command,
      editorNotReady: true,
    };
  }
  return { error: message, command };
}
