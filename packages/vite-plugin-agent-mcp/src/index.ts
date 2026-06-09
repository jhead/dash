/**
 * vite-plugin-agent-mcp
 *
 * Vite dev-server plugin that:
 *  1. Hosts an MCP Streamable HTTP endpoint at /mcp
 *  2. Hosts a private WebSocket bridge at /__agent for the editor page
 *
 * When an MCP tool call arrives it is forwarded over the /__agent WebSocket to
 * the connected editor page, waits for a reply, and returns it as the MCP tool
 * result. If no editor page is connected the tool call fails with an actionable
 * error message.
 *
 * Security (dev-tool posture):
 *  - Validates Origin/Host against localhost to block DNS-rebinding.
 *  - Optional FLASH_AGENT_TOKEN bearer check (set env var to enable).
 */

import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type {
  BridgeRequest,
  BridgeResponse,
  EditorStatusResult,
  DocGetResult,
  DocSummaryResult,
} from "@flash/agent-protocol";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Plugin state (module-level so it persists across HMR)
// ---------------------------------------------------------------------------

let _editorSocket: WebSocket | null = null;
const _pending = new Map<string, PendingCall>();

/** Forward a command to the editor page over the private WS bridge. */
function forwardToEditor(
  command: BridgeRequest["command"],
  params?: Record<string, unknown>
): Promise<unknown> {
  if (!_editorSocket || _editorSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(
      new Error(
        "Editor page not connected. Open http://localhost:1420 or run: pnpm --filter @flash/desktop dev"
      )
    );
  }
  const id = randomUUID();
  const req: BridgeRequest = { id, command, params };

  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      _pending.delete(id);
      reject(new Error(`Agent bridge timeout: command "${command}" (id=${id})`));
    }, 10_000);

    _pending.set(id, { resolve, reject, timer });
    _editorSocket!.send(JSON.stringify(req));
  });
}

// ---------------------------------------------------------------------------
// DNS-rebinding guard
// ---------------------------------------------------------------------------

function isLocalhost(value: string | undefined): boolean {
  if (!value) return false;
  // Strip port
  const host = value.split(":")[0];
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
}

function checkOrigin(req: IncomingMessage): boolean {
  const origin = req.headers["origin"];
  const host = req.headers["host"];
  if (origin) {
    try {
      const url = new URL(origin);
      return isLocalhost(url.hostname);
    } catch {
      return false;
    }
  }
  // No Origin header (e.g. MCP CLI client) — fall through to Host check
  return isLocalhost(host);
}

function checkBearerToken(req: IncomingMessage): boolean {
  const token = process.env["FLASH_AGENT_TOKEN"];
  if (!token) return true; // not configured — skip auth
  const auth = req.headers["authorization"];
  if (!auth) return false;
  const parts = auth.split(" ");
  return parts.length === 2 && parts[0] === "Bearer" && parts[1] === token;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap a forwarded command result as a text MCP content block. */
async function callTool(
  command: BridgeRequest["command"],
  params?: Record<string, unknown>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const result = await forwardToEditor(command, params);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

/** Wrap a forwarded command result as an isError MCP content block. */
function errorContent(message: string): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

// ---------------------------------------------------------------------------
// Create a fresh McpServer for each stateless HTTP request.
//
// We cannot reuse a single McpServer across requests because
// McpServer.connect() is not idempotent — it binds to exactly one transport
// and throws if called again while already connected. For the stateless
// Streamable HTTP pattern each request gets its own Server instance.
// ---------------------------------------------------------------------------

function createMcpServerForRequest(): McpServer {
  const server = new McpServer(
    { name: "flash-editor", version: "0.1.0" },
    {
      instructions:
        "Flash 8 editor agent interface. " +
        "Call doc_summary (or read flash://document/summary) to orient before mutating. " +
        "Prefer structured tools over jsfl_run where available. " +
        "Every read result includes `rev`; re-read if it jumps unexpectedly (another agent or human is editing). " +
        "All tool results are JSON. Colors are #RRGGBB or #RRGGBBAA strings. Frame indices are 0-based.",
    }
  );

  // =========================================================================
  // Session & Document
  // =========================================================================

  server.registerTool(
    "editor_status",
    {
      title: "Editor Status",
      description:
        "Returns the current editor status: alive flag, document name/size/fps/bg-color, scene/layer/frame counts, active tool, edit context, and the document revision (`rev`).",
      inputSchema: undefined,
    },
    async () => {
      const result = (await forwardToEditor("editor_status")) as EditorStatusResult;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "doc_get",
    {
      title: "Get Document (or subtree)",
      description:
        "Returns the document or a subtree at the given JSON Pointer path (e.g. '/scenes/0/timeline/layers/1'). " +
        "Omit `path` for the full document. Use `doc_summary` first — the full document can be very large.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe(
            "JSON Pointer (RFC 6901). Empty string or omit for the full document."
          ),
      }),
    },
    async ({ path }) => {
      const result = (await forwardToEditor("doc_get", { path })) as DocGetResult;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "doc_summary",
    {
      title: "Document Summary",
      description:
        "Token-light outline of the document: scenes → layers (id, name, type, frameCount) → keyframes (index, objectCount, hasScript, tween) plus library list. " +
        "This is the recommended first call before any authoring operation.",
      inputSchema: undefined,
    },
    async () => {
      const result = (await forwardToEditor("doc_summary")) as DocSummaryResult;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "doc_load",
    {
      title: "Load Document",
      description: "Replace the current document with the provided document JSON (pushes to history).",
      inputSchema: z.object({
        document: z.unknown().describe("FlashDocument JSON to load"),
      }),
    },
    async ({ document }) => callTool("doc_load", { document })
  );

  server.registerTool(
    "doc_set_properties",
    {
      title: "Set Document Properties",
      description: "Update document properties: width, height, frameRate, backgroundColor (#RRGGBB).",
      inputSchema: z.object({
        width: z.number().positive().optional().describe("Stage width in px"),
        height: z.number().positive().optional().describe("Stage height in px"),
        frameRate: z.number().positive().optional().describe("Frames per second"),
        backgroundColor: z.string().optional().describe("Background color as #RRGGBB"),
      }),
    },
    async (params) => callTool("doc_set_properties", params as Record<string, unknown>)
  );

  server.registerTool(
    "history_undo",
    {
      title: "Undo",
      description: "Undo the last document mutation.",
      inputSchema: undefined,
    },
    async () => callTool("history_undo")
  );

  server.registerTool(
    "history_redo",
    {
      title: "Redo",
      description: "Redo the last undone mutation.",
      inputSchema: undefined,
    },
    async () => callTool("history_redo")
  );

  server.registerTool(
    "history_depth",
    {
      title: "History Depth",
      description: "Returns the number of available undo and redo steps.",
      inputSchema: undefined,
    },
    async () => callTool("history_depth")
  );

  // =========================================================================
  // Stage & selection
  // =========================================================================

  server.registerTool(
    "stage_add_shape",
    {
      title: "Add Shape",
      description:
        "Add a rectangle, oval, or line to the stage. " +
        "x1/y1 = top-left, x2/y2 = bottom-right (or end point for line). " +
        "Colors are #RRGGBB strings. Returns the new object id and rev.",
      inputSchema: z.object({
        kind: z.enum(["rect", "oval", "line"]).describe("Shape kind"),
        x1: z.number().describe("Left/start x"),
        y1: z.number().describe("Top/start y"),
        x2: z.number().describe("Right/end x"),
        y2: z.number().describe("Bottom/end y"),
        fill: z.string().optional().describe("Fill color #RRGGBB (omit for no fill)"),
        stroke: z.string().optional().describe("Stroke color #RRGGBB"),
        strokeWidth: z.number().optional().describe("Stroke width in px"),
        layerId: z.string().optional().describe("Target layer id (default: active layer)"),
        frameIndex: z.number().int().nonnegative().optional().describe("Target frame (default: current)"),
      }),
    },
    async (params) => callTool("stage_add_shape", params as Record<string, unknown>)
  );

  server.registerTool(
    "stage_add_text",
    {
      title: "Add Text",
      description: "Add a text object to the stage. Returns the new object id and rev.",
      inputSchema: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
        text: z.string(),
        textType: z.enum(["static", "dynamic", "input"]).optional(),
        fontFamily: z.string().optional(),
        fontSize: z.number().positive().optional(),
        color: z.string().optional().describe("Color as #RRGGBB"),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        align: z.enum(["left", "center", "right", "justify"]).optional(),
        layerId: z.string().optional(),
        frameIndex: z.number().int().nonnegative().optional(),
      }),
    },
    async (params) => callTool("stage_add_text", params as Record<string, unknown>)
  );

  server.registerTool(
    "stage_place_instance",
    {
      title: "Place Symbol Instance",
      description: "Place a symbol from the library on the stage. Returns the new instance id and rev.",
      inputSchema: z.object({
        symbolId: z.string().describe("Library symbol id"),
        x: z.number(),
        y: z.number(),
        name: z.string().optional().describe("AS2 instance name"),
        layerId: z.string().optional(),
        frameIndex: z.number().int().nonnegative().optional(),
      }),
    },
    async (params) => callTool("stage_place_instance", params as Record<string, unknown>)
  );

  server.registerTool(
    "stage_update",
    {
      title: "Update Stage Object",
      description:
        "Update properties of a display object (x, y, scaleX, scaleY, rotation, alpha, text, etc.). Returns ok and rev.",
      inputSchema: z.object({
        id: z.string().describe("Object id"),
        layerId: z.string().optional(),
        frameIndex: z.number().int().nonnegative().optional(),
        updates: z.record(z.string(), z.unknown()).describe("Property updates to apply"),
      }),
    },
    async (params) => callTool("stage_update", params as Record<string, unknown>)
  );

  server.registerTool(
    "stage_remove",
    {
      title: "Remove Stage Objects",
      description: "Remove display objects by id. Returns ok and rev.",
      inputSchema: z.object({
        ids: z.array(z.string()).describe("Object ids to remove"),
        layerId: z.string().optional(),
        frameIndex: z.number().int().nonnegative().optional(),
      }),
    },
    async (params) => callTool("stage_remove", params as Record<string, unknown>)
  );

  server.registerTool(
    "stage_arrange",
    {
      title: "Arrange Stage Objects",
      description: "Change z-order of display objects: front/back/forward/backward.",
      inputSchema: z.object({
        ids: z.array(z.string()),
        op: z.enum(["front", "back", "forward", "backward"]),
        layerId: z.string().optional(),
        frameIndex: z.number().int().nonnegative().optional(),
      }),
    },
    async (params) => callTool("stage_arrange", params as Record<string, unknown>)
  );

  server.registerTool(
    "stage_group",
    {
      title: "Group Objects",
      description: "Group display objects into a group. Returns ok and rev.",
      inputSchema: z.object({
        ids: z.array(z.string()),
        layerId: z.string().optional(),
        frameIndex: z.number().int().nonnegative().optional(),
      }),
    },
    async (params) => callTool("stage_group", params as Record<string, unknown>)
  );

  server.registerTool(
    "stage_ungroup",
    {
      title: "Ungroup Object",
      description: "Ungroup a group display object, returning its children to the frame. Returns ok and rev.",
      inputSchema: z.object({
        id: z.string().describe("Group object id"),
        layerId: z.string().optional(),
        frameIndex: z.number().int().nonnegative().optional(),
      }),
    },
    async (params) => callTool("stage_ungroup", params as Record<string, unknown>)
  );

  server.registerTool(
    "selection_get",
    {
      title: "Get Selection",
      description: "Returns the currently selected object ids and their data.",
      inputSchema: undefined,
    },
    async () => callTool("selection_get")
  );

  server.registerTool(
    "selection_set",
    {
      title: "Set Selection",
      description: "Set the stage selection by id list, or pass all:true to select everything.",
      inputSchema: z.object({
        ids: z.array(z.string()).optional(),
        all: z.boolean().optional(),
      }),
    },
    async (params) => callTool("selection_set", params as Record<string, unknown>)
  );

  server.registerTool(
    "view_set",
    {
      title: "Set View",
      description: "Update viewport zoom, pan, current frame, or active layer.",
      inputSchema: z.object({
        zoom: z.number().positive().optional().describe("Zoom factor (1.0 = 100%)"),
        panX: z.number().optional(),
        panY: z.number().optional(),
        currentFrame: z.number().int().nonnegative().optional(),
        activeLayerId: z.string().optional(),
      }),
    },
    async (params) => callTool("view_set", params as Record<string, unknown>)
  );

  server.registerTool(
    "tool_select",
    {
      title: "Select Tool",
      description: "Select the active drawing/editing tool by id (e.g. 'selection', 'pen', 'rectangle', 'text').",
      inputSchema: z.object({
        toolId: z.string(),
      }),
    },
    async (params) => callTool("tool_select", params as Record<string, unknown>)
  );

  // =========================================================================
  // Timeline
  // =========================================================================

  server.registerTool(
    "timeline_add_layer",
    {
      title: "Add Layer",
      description: "Add a new layer to the active timeline. Returns the new layerId and rev.",
      inputSchema: z.object({
        name: z.string().optional(),
        type: z.enum(["normal", "guide", "guided", "mask", "masked", "folder"]).optional(),
      }),
    },
    async (params) => callTool("timeline_add_layer", params as Record<string, unknown>)
  );

  server.registerTool(
    "timeline_remove_layer",
    {
      title: "Remove Layer",
      description: "Remove a layer by id. Returns ok and rev.",
      inputSchema: z.object({
        layerId: z.string(),
      }),
    },
    async (params) => callTool("timeline_remove_layer", params as Record<string, unknown>)
  );

  server.registerTool(
    "timeline_update_layer",
    {
      title: "Update Layer",
      description: "Rename, lock, hide, or change the type of a layer. Returns ok and rev.",
      inputSchema: z.object({
        layerId: z.string(),
        name: z.string().optional(),
        locked: z.boolean().optional(),
        visible: z.boolean().optional(),
        type: z.enum(["normal", "guide", "guided", "mask", "masked", "folder"]).optional(),
      }),
    },
    async (params) => callTool("timeline_update_layer", params as Record<string, unknown>)
  );

  server.registerTool(
    "timeline_insert_frame",
    {
      title: "Insert Frame (F5)",
      description: "Insert a regular frame at frameIndex, shifting later keyframes right. Returns ok and rev.",
      inputSchema: z.object({
        layerId: z.string(),
        frameIndex: z.number().int().nonnegative(),
      }),
    },
    async (params) => callTool("timeline_insert_frame", params as Record<string, unknown>)
  );

  server.registerTool(
    "timeline_insert_keyframe",
    {
      title: "Insert Keyframe (F6)",
      description: "Insert a keyframe at frameIndex, copying content from the governing keyframe. Returns ok and rev.",
      inputSchema: z.object({
        layerId: z.string(),
        frameIndex: z.number().int().nonnegative(),
      }),
    },
    async (params) => callTool("timeline_insert_keyframe", params as Record<string, unknown>)
  );

  server.registerTool(
    "timeline_insert_blank_keyframe",
    {
      title: "Insert Blank Keyframe (F7)",
      description: "Insert an empty keyframe at frameIndex. Returns ok and rev.",
      inputSchema: z.object({
        layerId: z.string(),
        frameIndex: z.number().int().nonnegative(),
      }),
    },
    async (params) => callTool("timeline_insert_blank_keyframe", params as Record<string, unknown>)
  );

  server.registerTool(
    "timeline_remove_frame",
    {
      title: "Remove Frame (Shift+F5)",
      description: "Remove the frame at frameIndex. Returns ok and rev.",
      inputSchema: z.object({
        layerId: z.string(),
        frameIndex: z.number().int().nonnegative(),
      }),
    },
    async (params) => callTool("timeline_remove_frame", params as Record<string, unknown>)
  );

  server.registerTool(
    "timeline_set_frame_label",
    {
      title: "Set Frame Label",
      description: "Set the label (and optional labelType: name/comment/anchor) on a keyframe. Returns ok and rev.",
      inputSchema: z.object({
        layerId: z.string(),
        frameIndex: z.number().int().nonnegative(),
        label: z.string(),
        labelType: z.enum(["name", "comment", "anchor"]).optional(),
      }),
    },
    async (params) => callTool("timeline_set_frame_label", params as Record<string, unknown>)
  );

  server.registerTool(
    "timeline_set_tween",
    {
      title: "Set Tween",
      description: "Set or clear a motion/shape tween on a keyframe. kind=null clears any tween. Returns ok and rev.",
      inputSchema: z.object({
        layerId: z.string(),
        frameIndex: z.number().int().nonnegative(),
        kind: z.enum(["motion", "shape"]).nullable(),
        props: z.record(z.string(), z.unknown()).optional().describe("Tween options (ease, blend, etc.)"),
      }),
    },
    async (params) => callTool("timeline_set_tween", params as Record<string, unknown>)
  );

  server.registerTool(
    "timeline_goto_frame",
    {
      title: "Go to Frame",
      description: "Move the playhead to the given 0-based frame index.",
      inputSchema: z.object({
        frameIndex: z.number().int().nonnegative(),
      }),
    },
    async (params) => callTool("timeline_goto_frame", params as Record<string, unknown>)
  );

  server.registerTool(
    "playback_play",
    {
      title: "Play",
      description: "Start playback.",
      inputSchema: undefined,
    },
    async () => callTool("playback_play")
  );

  server.registerTool(
    "playback_stop",
    {
      title: "Stop",
      description: "Stop playback.",
      inputSchema: undefined,
    },
    async () => callTool("playback_stop")
  );

  // =========================================================================
  // Code (AS2)
  // =========================================================================

  server.registerTool(
    "script_get",
    {
      title: "Get Script",
      description: "Get the AS2 script attached to the governing keyframe at or before frameIndex.",
      inputSchema: z.object({
        layerId: z.string(),
        frameIndex: z.number().int().nonnegative(),
      }),
    },
    async (params) => callTool("script_get", params as Record<string, unknown>)
  );

  server.registerTool(
    "script_set",
    {
      title: "Set Script",
      description:
        "Set the AS2 script on the governing keyframe. Runs a compile check and returns diagnostics " +
        "WITHOUT blocking the write (Flash 8 lets you save broken scripts). Returns ok, rev, diagnostics.",
      inputSchema: z.object({
        layerId: z.string(),
        frameIndex: z.number().int().nonnegative(),
        script: z.string(),
      }),
    },
    async (params) => callTool("script_set", params as Record<string, unknown>)
  );

  server.registerTool(
    "script_check",
    {
      title: "Check Script",
      description: "Compile-check an AS2 script and return diagnostics WITHOUT mutating the document.",
      inputSchema: z.object({
        script: z.string(),
      }),
    },
    async (params) => callTool("script_check", params as Record<string, unknown>)
  );

  server.registerTool(
    "script_list",
    {
      title: "List Scripts",
      description: "List all keyframes that carry AS2 scripts, with first-line previews.",
      inputSchema: undefined,
    },
    async () => callTool("script_list")
  );

  // =========================================================================
  // Library
  // =========================================================================

  server.registerTool(
    "library_list",
    {
      title: "List Library",
      description: "List all items in the document library (symbols, bitmaps, sounds, etc.).",
      inputSchema: undefined,
    },
    async () => callTool("library_list")
  );

  server.registerTool(
    "library_create_symbol",
    {
      title: "Create Symbol",
      description: "Create a new empty symbol in the library. Returns symbolId and rev.",
      inputSchema: z.object({
        name: z.string(),
        symbolType: z.enum(["movieclip", "button", "graphic"]),
      }),
    },
    async (params) => callTool("library_create_symbol", params as Record<string, unknown>)
  );

  server.registerTool(
    "library_convert_to_symbol",
    {
      title: "Convert to Symbol",
      description:
        "Convert display objects (by id) into a new library symbol, replacing them with an instance. " +
        "Returns symbolId, instanceId, and rev.",
      inputSchema: z.object({
        ids: z.array(z.string()),
        name: z.string(),
        symbolType: z.enum(["movieclip", "button", "graphic"]),
        layerId: z.string().optional(),
        frameIndex: z.number().int().nonnegative().optional(),
      }),
    },
    async (params) => callTool("library_convert_to_symbol", params as Record<string, unknown>)
  );

  server.registerTool(
    "library_rename",
    {
      title: "Rename Library Item",
      description: "Rename a library item by id. Returns ok and rev.",
      inputSchema: z.object({
        itemId: z.string(),
        name: z.string(),
      }),
    },
    async (params) => callTool("library_rename", params as Record<string, unknown>)
  );

  server.registerTool(
    "library_remove",
    {
      title: "Remove Library Item",
      description: "Remove a library item by id. Returns ok and rev.",
      inputSchema: z.object({
        itemId: z.string(),
      }),
    },
    async (params) => callTool("library_remove", params as Record<string, unknown>)
  );

  // =========================================================================
  // Output & escape hatches
  // =========================================================================

  server.registerTool(
    "jsfl_run",
    {
      title: "Run JSFL Script",
      description:
        "Execute a JSFL (JavaScript Flash Language) script. Mutations land in history. " +
        "Returns traces, returnValue, error, and rev.",
      inputSchema: z.object({
        source: z.string().describe("JSFL source code to execute"),
      }),
    },
    async (params) => callTool("jsfl_run", params as Record<string, unknown>)
  );

  server.registerTool(
    "stage_screenshot",
    {
      title: "Stage Screenshot",
      description:
        "Render the current stage to a PNG and return it as an MCP image content block. " +
        "Uses 1:1 DPR with background compositing. Use sparingly — prefer doc_get for structure.",
      inputSchema: z.object({
        frameIndex: z.number().int().nonnegative().optional().describe("Frame to render (default: current)"),
      }),
    },
    async (params) => {
      const result = await forwardToEditor("stage_screenshot", params as Record<string, unknown>) as {
        pngBase64: string;
        width: number;
        height: number;
      };
      return {
        content: [
          {
            type: "image" as const,
            data: result.pngBase64,
            mimeType: "image/png" as const,
          },
          {
            type: "text" as const,
            text: JSON.stringify({ width: result.width, height: result.height }),
          },
        ],
      };
    }
  );

  server.registerTool(
    "publish_swf",
    {
      title: "Publish SWF",
      description: "Compile the current document to SWF. Returns swfBase64 and byteLength.",
      inputSchema: undefined,
    },
    async () => callTool("publish_swf")
  );

  server.registerTool(
    "file_save_fla",
    {
      title: "Save FLA",
      description: "Serialize the current document to the FLA format and return it as base64.",
      inputSchema: undefined,
    },
    async () => callTool("file_save_fla")
  );

  server.registerTool(
    "file_load_fla",
    {
      title: "Load FLA",
      description: "Load a previously saved FLA (as base64) into the editor, replacing the current document.",
      inputSchema: z.object({
        flaBase64: z.string().describe("Base64-encoded FLA bytes"),
      }),
    },
    async (params) => callTool("file_load_fla", params as Record<string, unknown>)
  );

  // =========================================================================
  // Resources
  // =========================================================================

  server.registerResource(
    "document-summary",
    "flash://document/summary",
    {
      description:
        "Token-light outline of the current document: same as doc_summary tool.",
      mimeType: "application/json",
    },
    async () => {
      let text: string;
      try {
        const result = (await forwardToEditor("doc_summary")) as DocSummaryResult;
        text = JSON.stringify(result, null, 2);
      } catch (err) {
        text = JSON.stringify({ error: String(err) });
      }
      return {
        contents: [
          {
            uri: "flash://document/summary",
            mimeType: "application/json",
            text,
          },
        ],
      };
    }
  );

  server.registerResource(
    "document",
    "flash://document",
    {
      description: "Full document JSON — use doc_summary first; this can be very large.",
      mimeType: "application/json",
    },
    async () => {
      let text: string;
      try {
        const result = await forwardToEditor("doc_get", { path: "" });
        text = JSON.stringify(result, null, 2);
      } catch (err) {
        text = JSON.stringify({ error: String(err) });
      }
      return {
        contents: [{ uri: "flash://document", mimeType: "application/json", text }],
      };
    }
  );

  server.registerResource(
    "library",
    "flash://library",
    {
      description: "Library item list for the current document.",
      mimeType: "application/json",
    },
    async () => {
      let text: string;
      try {
        const result = await forwardToEditor("library_list");
        text = JSON.stringify(result, null, 2);
      } catch (err) {
        text = JSON.stringify({ error: String(err) });
      }
      return {
        contents: [{ uri: "flash://library", mimeType: "application/json", text }],
      };
    }
  );

  server.registerResource(
    "scripts",
    "flash://scripts",
    {
      description: "Index of all AS2 scripts in the document, with first-line previews.",
      mimeType: "application/json",
    },
    async () => {
      let text: string;
      try {
        const result = await forwardToEditor("script_list");
        text = JSON.stringify(result, null, 2);
      } catch (err) {
        text = JSON.stringify({ error: String(err) });
      }
      return {
        contents: [{ uri: "flash://scripts", mimeType: "application/json", text }],
      };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// Handle a single MCP HTTP request
// ---------------------------------------------------------------------------

async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (!checkOrigin(req)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden: non-localhost origin");
    return;
  }
  if (!checkBearerToken(req)) {
    res.writeHead(401, {
      "Content-Type": "text/plain",
      "WWW-Authenticate": 'Bearer realm="flash-editor"',
    });
    res.end("Unauthorized: missing or invalid FLASH_AGENT_TOKEN");
    return;
  }

  // Stateless transport — new transport and server per request
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  const mcpServer = createMcpServerForRequest();
  await mcpServer.connect(transport);

  // Parse body for POST
  let body: unknown;
  if (req.method === "POST") {
    body = await new Promise<unknown>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : undefined);
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }

  await transport.handleRequest(req, res, body);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function agentMcpPlugin(): Plugin {
  return {
    name: "vite-plugin-agent-mcp",

    configureServer(server: ViteDevServer) {
      // -------------------------------------------------------------------
      // /__agent WebSocket bridge (editor page → plugin)
      // -------------------------------------------------------------------
      const wss = new WebSocketServer({ noServer: true });

      // Attach to the Vite HTTP server's upgrade event
      server.httpServer?.on(
        "upgrade",
        (req: IncomingMessage, socket: import("net").Socket, head: Buffer) => {
          if (req.url !== "/__agent") return;

          if (!checkOrigin(req)) {
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }

          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        }
      );

      wss.on("connection", (ws: WebSocket) => {
        console.log("[agent-mcp] Editor page connected on /__agent");
        _editorSocket = ws;

        ws.on("message", (data: Buffer) => {
          let response: BridgeResponse;
          try {
            response = JSON.parse(data.toString()) as BridgeResponse;
          } catch {
            return;
          }
          const pending = _pending.get(response.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          _pending.delete(response.id);

          if (response.ok) {
            pending.resolve(response.result);
          } else {
            pending.reject(new Error(response.error));
          }
        });

        ws.on("close", () => {
          console.log("[agent-mcp] Editor page disconnected from /__agent");
          if (_editorSocket === ws) _editorSocket = null;
          // Reject any in-flight calls
          for (const [id, pending] of _pending) {
            clearTimeout(pending.timer);
            pending.reject(
              new Error(
                "Editor page disconnected before responding (id=" + id + ")"
              )
            );
          }
          _pending.clear();
        });

        ws.on("error", (err: Error) => {
          console.error("[agent-mcp] /__agent WS error:", err.message);
        });
      });

      // -------------------------------------------------------------------
      // /mcp HTTP endpoint (MCP Streamable HTTP)
      // -------------------------------------------------------------------
      server.middlewares.use(
        "/mcp",
        (
          req: IncomingMessage,
          res: ServerResponse,
          next: () => void
        ) => {
          if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
            next();
            return;
          }
          handleMcpRequest(req, res).catch((err: Error) => {
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end("Internal server error: " + err.message);
            }
          });
        }
      );

      console.log(
        "[agent-mcp] MCP server ready at http://localhost:1420/mcp"
      );
      console.log(
        "[agent-mcp] Editor bridge ready at ws://localhost:1420/__agent"
      );
    },
  };
}

// Re-export errorContent for potential external use in tests
export { errorContent };

export default agentMcpPlugin;
