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
  BridgeNotification,
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

/** A live MCP session (stateful Streamable HTTP). */
interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

// ---------------------------------------------------------------------------
// Plugin state (module-level so it persists across HMR)
// ---------------------------------------------------------------------------

let _editorSocket: WebSocket | null = null;
const _pending = new Map<string, PendingCall>();

/**
 * Active MCP sessions keyed by session ID.
 *
 * The plugin uses stateful Streamable HTTP transport so that the MCP server
 * can push resource update notifications to subscribed clients when the
 * document changes. Each client connection maintains a session; GET requests
 * open an SSE stream on which notifications are delivered.
 */
const _sessions = new Map<string, McpSession>();

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
// Handle bridge push notifications (editor → plugin → MCP clients)
// ---------------------------------------------------------------------------

/**
 * Called when the editor page sends a push notification over the /__agent WS.
 * Forwards the event to all active MCP sessions as resource update notifications.
 */
async function handleBridgeNotification(notification: BridgeNotification): Promise<void> {
  if (notification.type === "doc-changed") {
    // Notify all subscribed MCP clients that the document changed
    const promises: Promise<void>[] = [];
    for (const session of _sessions.values()) {
      promises.push(
        session.server.server
          .sendResourceUpdated({ uri: "flash://document" })
          .catch(() => {/* session may be closing */})
      );
      promises.push(
        session.server.server
          .sendResourceUpdated({ uri: "flash://document/summary" })
          .catch(() => {/* session may be closing */})
      );
    }
    await Promise.allSettled(promises);
  } else if (notification.type === "selection-changed") {
    // No dedicated MCP resource for selection yet; a future extension point
  } else if (notification.type === "playhead-moved") {
    // No dedicated MCP resource for playhead yet; a future extension point
  }
}

// ---------------------------------------------------------------------------
// Create a fresh McpServer for a session.
//
// In stateful mode each MCP client gets its own McpServer+transport pair that
// persists across multiple HTTP requests within the session. This allows the
// server to push resource update notifications to subscribed clients.
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
    "stage_add_video",
    {
      title: "Place Video On Stage",
      description:
        "Place a VideoItem from the library on the stage as a video display object. Defaults to the video's native dimensions when width/height are omitted. Returns the new object id and rev.",
      inputSchema: z.object({
        videoItemId: z.string().describe("Library VideoItem id"),
        x: z.number(),
        y: z.number(),
        width: z.number().positive().optional().describe("Display width (defaults to native)"),
        height: z.number().positive().optional().describe("Display height (defaults to native)"),
        layerId: z.string().optional(),
        frameIndex: z.number().int().nonnegative().optional(),
      }),
    },
    async (params) => callTool("stage_add_video", params as Record<string, unknown>)
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
        props: z.record(z.string(), z.unknown()).optional().describe("Tween options. Motion: ease (-100..100), rotate ('none'|'cw'|'ccw'|'auto'), rotateCount (number), scale (boolean), orientToPath (boolean), sync (boolean). Shape: ease (-100..100), blend ('distributive'|'angular')."),
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

  // =========================================================================
  // MCP Prompts — canned authoring recipes
  // =========================================================================

  server.registerPrompt(
    "create_animation",
    {
      title: "Create Animation",
      description:
        "Step-by-step guide to creating a simple motion animation: " +
        "add a shape to the stage, convert it to a MovieClip symbol, then animate it " +
        "by inserting keyframes and updating position/properties on each keyframe.",
    },
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "Walk me through creating a simple motion animation in the Flash 8 editor.",
          },
        },
        {
          role: "assistant" as const,
          content: {
            type: "text" as const,
            text: [
              "Here is the standard workflow for a motion animation:",
              "",
              "**Step 1 — Orient**",
              "Call `doc_summary` to confirm the document structure (scenes, layers, frame count).",
              "",
              "**Step 2 — Add a shape**",
              "Use `stage_add_shape` to place a shape on the stage at frame 0:",
              "```",
              'stage_add_shape { kind: "rect", x1: 50, y1: 100, x2: 150, y2: 200, fill: "#FF0000" }',
              "```",
              "Note the returned `id` — you will need it for subsequent steps.",
              "",
              "**Step 3 — Convert to a MovieClip symbol**",
              "Animations require a symbol instance. Convert the shape:",
              "```",
              'library_convert_to_symbol { ids: ["<id>"], name: "Ball", symbolType: "movieclip" }',
              "```",
              "",
              "**Step 4 — Set a motion tween**",
              "Insert a keyframe at the destination frame and set a motion tween on frame 0:",
              "```",
              'timeline_insert_keyframe { layerId: "<layerId>", frameIndex: 24 }',
              'timeline_set_tween    { layerId: "<layerId>", frameIndex: 0, kind: "motion" }',
              "```",
              "",
              "**Step 5 — Set the end-keyframe position**",
              "Move the playhead to frame 24 and update the instance position:",
              "```",
              'view_set    { currentFrame: 24 }',
              'stage_update { id: "<instanceId>", updates: { x: 400, y: 200 } }',
              "```",
              "",
              "**Step 6 — Verify**",
              "Call `doc_summary` to confirm the tween is set, then optionally `stage_screenshot` " +
                "to visually inspect the end frame.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "create_button",
    {
      title: "Create Button",
      description:
        "Step-by-step guide to creating an interactive button symbol: " +
        "add a shape, convert it to a Button symbol, then attach an AS2 event script.",
    },
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "How do I create an interactive button in the Flash 8 editor?",
          },
        },
        {
          role: "assistant" as const,
          content: {
            type: "text" as const,
            text: [
              "Here is the standard workflow for creating a button with an event handler:",
              "",
              "**Step 1 — Orient**",
              "Call `doc_summary` to note the active layer id.",
              "",
              "**Step 2 — Add a shape for the button face**",
              "```",
              'stage_add_shape { kind: "rect", x1: 200, y1: 150, x2: 350, y2: 210, fill: "#0066CC" }',
              "```",
              "",
              "**Step 3 — Add a label**",
              "```",
              'stage_add_text { x: 220, y: 165, width: 110, height: 30, text: "Click Me", color: "#FFFFFF" }',
              "```",
              "",
              "**Step 4 — Convert both objects to a Button symbol**",
              "Select both ids and convert:",
              "```",
              'library_convert_to_symbol { ids: ["<shapeId>", "<textId>"], name: "MyButton", symbolType: "button" }',
              "```",
              "",
              "**Step 5 — Give the instance an AS2 name**",
              "```",
              'stage_update { id: "<instanceId>", updates: { name: "myBtn" } }',
              "```",
              "",
              "**Step 6 — Attach a click handler on the main timeline frame 0**",
              "```",
              'script_set {',
              '  layerId: "<layerId>",',
              '  frameIndex: 0,',
              '  script: "myBtn.onRelease = function() { trace(\\"Button clicked!\\"); };"',
              '}',
              "```",
              "",
              "**Step 7 — Verify**",
              "Check `script_set` diagnostics (should be empty). " +
                "Use `stage_screenshot` to confirm the visual layout.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "author_game_loop",
    {
      title: "Author Game Loop (Avoider/Catcher)",
      description:
        "Guide to building a simple avoider/catcher game in Flash 8 AS2: " +
        "set up the stage, create player and enemy MovieClips, attach an onEnterFrame " +
        "game loop with keyboard controls and basic collision detection.",
    },
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Help me build a simple avoider game in the Flash 8 editor.",
          },
        },
        {
          role: "assistant" as const,
          content: {
            type: "text" as const,
            text: [
              "Here is the avoider/catcher game pattern for Flash 8 AS2:",
              "",
              "**Step 1 — Document setup**",
              "```",
              'doc_set_properties { width: 550, height: 400, frameRate: 24, backgroundColor: "#000022" }',
              "```",
              "",
              "**Step 2 — Create the player symbol**",
              "Add a shape, convert it to a MovieClip named `Player`:",
              "```",
              'stage_add_shape  { kind: "oval", x1: 255, y1: 355, x2: 295, y2: 395, fill: "#00FF88" }',
              'library_convert_to_symbol { ids: ["<shapeId>"], name: "Player", symbolType: "movieclip" }',
              'stage_update { id: "<instanceId>", updates: { name: "player" } }',
              "```",
              "",
              "**Step 3 — Create the enemy symbol**",
              "```",
              'stage_add_shape  { kind: "oval", x1: 255, y1: 5, x2: 285, y2: 35, fill: "#FF4444" }',
              'library_convert_to_symbol { ids: ["<shapeId>"], name: "Enemy", symbolType: "movieclip" }',
              'stage_update { id: "<instanceId>", updates: { name: "enemy" } }',
              "```",
              "",
              "**Step 4 — Add a score text field**",
              "```",
              'stage_add_text { x: 10, y: 10, width: 200, height: 24,',
              '  text: "Score: 0", textType: "dynamic", color: "#FFFFFF" }',
              'stage_update { id: "<textId>", updates: { name: "scoreField" } }',
              "```",
              "",
              "**Step 5 — Attach the game loop on frame 0**",
              "```",
              'script_set {',
              '  layerId: "<layerId>",',
              '  frameIndex: 0,',
              '  script: [',
              '    "var speed:Number = 5;",',
              '    "var score:Number = 0;",',
              '    "_root.onEnterFrame = function() {",',
              '    "  if (Key.isDown(Key.LEFT))  player._x -= speed;",',
              '    "  if (Key.isDown(Key.RIGHT)) player._x += speed;",',
              '    "  enemy._y += 3;",',
              '    "  if (enemy._y > 420) { enemy._y = -20; enemy._x = Math.random()*520; score++; scoreField.text = \\"Score: \\" + score; }",',
              '    "  if (player.hitTest(enemy)) { _root.gotoAndStop(\\"gameover\\"); }",',
              '    "};"',
              '  ].join("\\n")',
              '}',
              "```",
              "",
              "**Step 6 — Add a `gameover` frame label and stop script**",
              "```",
              'timeline_insert_blank_keyframe { layerId: "<layerId>", frameIndex: 1 }',
              'timeline_set_frame_label       { layerId: "<layerId>", frameIndex: 1, label: "gameover" }',
              'script_set { layerId: "<layerId>", frameIndex: 1, script: "stop();" }',
              "```",
              "",
              "**Step 7 — Verify**",
              "Call `doc_summary` to confirm labels, then `publish_swf` to compile and test in Ruffle.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  return server;
}

// ---------------------------------------------------------------------------
// Handle a single MCP HTTP request (stateful session management)
//
// Uses stateful Streamable HTTP transport so the server can push resource
// update notifications to subscribed clients. Each client gets a session ID
// on the first (initialize) request; subsequent requests include the session ID
// header to be routed to the correct server instance.
//
// Packaged-Tauri hosting note:
//   In a packaged Tauri build the Vite dev server is not available. The same
//   MCP server could be hosted by a Node sidecar process (spawned from
//   src-tauri/src/main.rs via tauri::api::process::Command) or by a Rust MCP
//   SDK implementation in src-tauri. The @flash/agent-protocol zod schemas and
//   the authoring-ui AgentCommandRegistry are transport-agnostic — only the
//   Vite plugin wrapper (this file) is Vite-specific. A follow-up task should
//   create packages/tauri-agent-sidecar that re-exports the same McpServer
//   factory against an stdio or TCP transport for packaged builds.
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

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Route to an existing session if the client provides a session ID
  if (sessionId && _sessions.has(sessionId)) {
    const session = _sessions.get(sessionId)!;
    const body = await parseBody(req);
    await session.transport.handleRequest(req, res, body);
    return;
  }

  // DELETE: close a session
  if (req.method === "DELETE" && sessionId) {
    const session = _sessions.get(sessionId);
    if (session) {
      await session.transport.close();
      _sessions.delete(sessionId);
    }
    res.writeHead(200);
    res.end();
    return;
  }

  // New session — must be an initialize request
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const mcpServer = createMcpServerForRequest();

  // Remove the session when the transport closes
  transport.onclose = () => {
    if (transport.sessionId) {
      _sessions.delete(transport.sessionId);
    }
  };

  await mcpServer.connect(transport);

  // Store the session after connect (sessionId is set after the first response)
  const body = await parseBody(req);
  await transport.handleRequest(req, res, body);

  // After handleRequest, transport.sessionId is set for initialize responses
  if (transport.sessionId && !_sessions.has(transport.sessionId)) {
    _sessions.set(transport.sessionId, { server: mcpServer, transport });
  }
}

/** Parse the request body for POST requests. */
async function parseBody(req: IncomingMessage): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  return new Promise<unknown>((resolve, reject) => {
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
          let msg: unknown;
          try {
            msg = JSON.parse(data.toString());
          } catch {
            return;
          }

          // Push notifications from the editor have a `type` discriminant
          // but no `id` field (they are not replies to pending calls).
          const asAny = msg as Record<string, unknown>;
          if (typeof asAny["type"] === "string" && typeof asAny["id"] === "undefined") {
            handleBridgeNotification(msg as BridgeNotification).catch((err: Error) => {
              console.warn("[agent-mcp] Notification handling error:", err.message);
            });
            return;
          }

          // Otherwise it's a BridgeResponse (reply to a pending command)
          const response = msg as BridgeResponse;
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

// Re-export for tests
export { errorContent, createMcpServerForRequest };

export default agentMcpPlugin;
