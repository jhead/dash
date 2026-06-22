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
 * Commands the Agent Chat loop is NOT allowed to call. These are EXCLUDED from
 * the generated tool set entirely, so the chat LLM never sees them and cannot
 * invoke them in the autonomous multi-step loop.
 *
 * Per the explicit user decision on task 1282 (SAFETY follow-up): the agent
 * chat does NOT need the two full-document-REPLACE loaders, so we simply DROP
 * them rather than building a confirmation/allowlist layer. The destructive
 * *_remove commands (stage_remove, library_remove, timeline_remove_layer/frame,
 * scene_remove) and file_save_fla / publish_swf were explicitly APPROVED to keep
 * auto-running and are intentionally NOT in this list.
 *
 *   - doc_load:       replaces the whole document with caller-provided JSON.
 *   - file_load_fla:  replaces the whole document by loading a .fla.
 *
 * To amend the agent-chat tool surface, edit this constant — it is the single
 * source of truth for what the chat loop may not call. NOTE: this is the AGENT
 * CHAT path only; the programmatic/external MCP+JSFL registry
 * (../agent/registry.ts) is unaffected and still serves these commands.
 */
export const AGENT_CHAT_EXCLUDED_COMMANDS: ReadonlySet<AgentCommand> =
  new Set<AgentCommand>(["doc_load", "file_load_fla"]);

/**
 * Commands whose result carries a rendered image as base64 PNG, so the tool
 * must deliver it to the model as a real image content part (not text base64).
 * Today only `stage_screenshot` qualifies; the per-tool override below is keyed
 * on this set so any future image-producing command can opt in by name.
 */
const IMAGE_RESULT_COMMANDS = new Set<AgentCommand>(["stage_screenshot"]);

/**
 * Commands whose result carries a large raw-bytes blob (base64) that the model
 * cannot use and that would bloat the context window. For these the tool's
 * `toModelOutput` returns ONLY a compact summary; the bytes stay on the app/UI
 * side (download/preview) via the raw `execute` result the chip receives. Today
 * only `publish_swf` qualifies — it returns the ENTIRE compiled SWF as
 * `swfBase64` (a tiny golden movie is ~7.6K base64 chars; real movies with
 * embedded fonts/bitmaps are 100K+ chars, easily blowing the context in one
 * call). Same class of fix as `IMAGE_RESULT_COMMANDS` / task 1295 — "tool output
 * must be model-useful, not raw bytes" (task 1306).
 */
const SUMMARY_RESULT_COMMANDS = new Set<AgentCommand>(["publish_swf"]);

/**
 * The (subset of the) shape a tool that returns a base64 image produces. The
 * registry's `stage_screenshot` handler returns exactly this. Narrowed via a
 * runtime guard so the `toModelOutput` mapping is total/safe even if dispatch
 * returns a structured error instead of a screenshot.
 */
interface ImageToolResult {
  pngBase64: string;
  width: number;
  height: number;
}

function isImageToolResult(value: unknown): value is ImageToolResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.pngBase64 === "string" &&
    typeof v.width === "number" &&
    typeof v.height === "number"
  );
}

/**
 * The model-facing summary of a `publish_swf` result. Deliberately OMITS
 * `swfBase64`: the model gets only compile-ok + size/dimensions, never the SWF
 * bytes. Built from the raw registry result by `summarizePublishSwf`.
 */
interface PublishSwfModelSummary {
  ok: boolean;
  byteLength: number;
  width: number;
  height: number;
}

/**
 * The shape the registry's `publish_swf` handler returns. The runtime guard
 * keeps the `toModelOutput` mapping total/safe even if dispatch returns a
 * structured error instead of a publish result.
 */
interface PublishSwfToolResult extends PublishSwfModelSummary {
  swfBase64: string;
}

function isPublishSwfToolResult(value: unknown): value is PublishSwfToolResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.swfBase64 === "string" &&
    typeof v.byteLength === "number" &&
    typeof v.width === "number" &&
    typeof v.height === "number"
  );
}

/**
 * Reduce a raw `publish_swf` result to the model-facing summary, dropping
 * `swfBase64` (and never serializing it into the model's text channel). If the
 * `ok` flag is absent (older/partial result) we infer it from the presence of
 * bytes. Exported for the unit test that pins "no base64 in the model output".
 */
export function summarizePublishSwf(
  result: PublishSwfToolResult
): PublishSwfModelSummary {
  return {
    ok: typeof result.ok === "boolean" ? result.ok : result.byteLength > 0,
    byteLength: result.byteLength,
    width: result.width,
    height: result.height,
  };
}

/**
 * The generated tool set, keyed by command name. This is the value P3 passes to
 * the AI SDK agent loop as `{ tools }`. `Partial` because the commands in
 * {@link AGENT_CHAT_EXCLUDED_COMMANDS} are intentionally omitted (the chat loop
 * may not call them).
 */
export type AgentToolSet = Partial<Record<AgentCommand, Tool>>;

/**
 * Build the AI SDK v6 tool set covering every agent-protocol command EXCEPT the
 * ones in {@link AGENT_CHAT_EXCLUDED_COMMANDS} (the chat loop is not allowed to
 * call those, so they are never registered as tools the model can see).
 *
 * For each non-excluded command in `ALL_COMMANDS`:
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
    // SAFETY (task 1282): never register an excluded command as a tool, so the
    // chat LLM cannot call it in the autonomous loop.
    if (AGENT_CHAT_EXCLUDED_COMMANDS.has(name)) continue;

    const inputSchema = COMMAND_SCHEMAS[name];
    const description = COMMAND_DESCRIPTIONS[name];

    const execute = async (args: unknown): Promise<unknown> => {
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
    };

    if (IMAGE_RESULT_COMMANDS.has(name)) {
      // Image-producing tools (stage_screenshot): the raw `execute` result
      // still carries `pngBase64` (so `toModelOutput` has the data and the UI
      // can summarize it), but WITHOUT `toModelOutput` the AI SDK would
      // serialize that object as a `type:'json'` tool-result — the model would
      // receive the base64 as undecodable TEXT (vision unusable + a huge blob
      // wasting context). `toModelOutput` instead maps the result to a proper
      // image content part so multimodal models actually SEE the screenshot.
      tools[name] = tool({
        description,
        inputSchema,
        execute,
        toModelOutput: ({ output }) => {
          if (!isImageToolResult(output)) {
            // Dispatch returned a structured error (e.g. editor not ready) —
            // pass it through as JSON so the model can read and react to it.
            return { type: "json", value: (output ?? null) as never };
          }
          // AI SDK v6 multimodal tool-result API: a `type:'content'` output
          // with an `image-data` part (base64 + IANA media type) is the part a
          // multimodal model decodes as an image. A short text note carries the
          // dimensions so text-only models still get something useful, and the
          // base64 itself never lands in the plain-text channel.
          return {
            type: "content",
            value: [
              {
                type: "text",
                text: `Rendered stage screenshot (${output.width}x${output.height}).`,
              },
              {
                type: "image-data",
                data: output.pngBase64,
                mediaType: "image/png",
              },
            ],
          };
        },
      });
    } else if (SUMMARY_RESULT_COMMANDS.has(name)) {
      // Byte-blob tools (publish_swf): the raw `execute` result still carries
      // `swfBase64` (so the UI chip / app can offer download/preview), but
      // WITHOUT `toModelOutput` the AI SDK would serialize that whole object —
      // including the entire base64 SWF — as a `type:'json'` tool-result,
      // dumping a huge undecodable blob into the model's text context. The
      // `toModelOutput` below maps the result to a COMPACT JSON summary
      // ({ ok, byteLength, width, height }) so the base64 never reaches the
      // model (task 1306).
      tools[name] = tool({
        description,
        inputSchema,
        execute,
        toModelOutput: ({ output }) => {
          if (!isPublishSwfToolResult(output)) {
            // Dispatch returned a structured error (e.g. editor not ready) —
            // pass it through as JSON so the model can read and react to it.
            return { type: "json", value: (output ?? null) as never };
          }
          return {
            type: "json",
            value: summarizePublishSwf(output) as never,
          };
        },
      });
    } else {
      tools[name] = tool({ description, inputSchema, execute });
    }
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
