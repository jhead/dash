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
import {
  ALL_COMMANDS,
  COMMAND_SCHEMAS,
  COMMAND_DESCRIPTIONS,
} from "@flash/agent-protocol";
import type {
  AgentCommand,
  BridgeRequest,
  BridgeResponse,
  BridgeNotification,
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
        "Editor page not connected. Open the dev server URL in a browser or run: pnpm --filter @flash/desktop dev"
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
// Generated tool surface
//
// The MCP tool set is BUILT from the agent-protocol command registry rather
// than hand-coded, so it can never drift from ALL_COMMANDS / COMMAND_SCHEMAS /
// COMMAND_DESCRIPTIONS (the documented single source of truth) — the same
// registry the in-browser Agent Chat tool bridge iterates. Adding a command to
// the protocol automatically exposes it here; a schema/enum fix in the protocol
// (e.g. filter_add's type enum, the typed stage_update bag) flows through with
// no per-tool edit. Every command's Zod params schema becomes the tool's
// inputSchema, so an MCP client sees the exact field-level validation the rest
// of the system enforces.
// ---------------------------------------------------------------------------

/** Human-readable tool title derived from the snake_case command name. */
function humanizeCommand(name: string): string {
  return name
    .split("_")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Loosely-typed view of `McpServer.registerTool`. The generated loop registers
 * one tool per command with the command's own Zod schema as `inputSchema`; the
 * SDK's per-call generic inference cannot follow the ALL_COMMANDS union, so we
 * bind through this structural type (inputSchema is a real Zod schema at runtime
 * and the handler returns a CallToolResult-shaped object).
 */
type LooseRegisterTool = (
  name: string,
  config: { title?: string; description?: string; inputSchema?: unknown },
  handler: (args: Record<string, unknown>) => Promise<unknown>
) => unknown;

/**
 * Commands whose result carries a rendered image (base64 PNG) that must be
 * returned as a real MCP image content block, not a JSON text dump. Mirrors the
 * Agent Chat bridge's IMAGE_RESULT_COMMANDS.
 */
const IMAGE_RESULT_COMMANDS = new Set<AgentCommand>(["stage_screenshot"]);

/** Register one MCP tool per agent-protocol command onto the given server. */
function registerAgentCommandTools(server: McpServer): void {
  const register = server.registerTool.bind(server) as unknown as LooseRegisterTool;

  for (const command of ALL_COMMANDS) {
    const inputSchema = COMMAND_SCHEMAS[command];
    const description = COMMAND_DESCRIPTIONS[command];
    const config = { title: humanizeCommand(command), description, inputSchema };

    if (IMAGE_RESULT_COMMANDS.has(command)) {
      register(command, config, async (args) => {
        const result = (await forwardToEditor(command, args)) as {
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
      });
      continue;
    }

    register(command, config, async (args) => callTool(command, args));
  }
}

// ---------------------------------------------------------------------------
// Request-size bounds (DoS hardening)
// ---------------------------------------------------------------------------

/**
 * Maximum bytes accepted for a single MCP HTTP request body OR a single
 * `/__agent` WebSocket frame. The body accumulator and the WS server were
 * previously unbounded, so a hostile local peer could stream an arbitrarily
 * large payload and exhaust the dev-server's memory. The cap is deliberately
 * generous — doc_load / file_load_fla / library_import_* carry base64 blobs,
 * and full-document / SWF / FLA responses flow back over the same WS — but
 * finite. Override with FLASH_AGENT_MAX_BYTES (bytes).
 */
export const MAX_BODY_BYTES: number = (() => {
  const raw = process.env["FLASH_AGENT_MAX_BYTES"];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 64 * 1024 * 1024;
})();

/** Thrown by parseBody when the accumulated body exceeds MAX_BODY_BYTES. */
export class RequestBodyTooLargeError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`Request body exceeds the ${limit}-byte limit`);
    this.name = "RequestBodyTooLargeError";
    this.limit = limit;
  }
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
  // Tools — GENERATED from the agent-protocol command registry.
  //
  // Every MCP tool is built from ALL_COMMANDS / COMMAND_SCHEMAS /
  // COMMAND_DESCRIPTIONS (the documented single source of truth), so this
  // transport cannot drift from the protocol or the in-browser Agent Chat
  // tool bridge (authoring-ui/agentchat/tools.ts), which builds its tool set
  // the same way. See registerAgentCommandTools() below.
  // =========================================================================
  registerAgentCommandTools(server);

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

/**
 * Parse the request body for POST requests, aborting if it exceeds
 * `maxBytes` (default MAX_BODY_BYTES). The accumulator tracks the raw byte
 * length and rejects with a RequestBodyTooLargeError (→ HTTP 413) the moment
 * the cap is crossed, destroying the socket so no further data is buffered.
 */
async function parseBody(
  req: IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES
): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        reject(new RequestBodyTooLargeError(maxBytes));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      const data = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", (err) => {
      if (!aborted) reject(err);
    });
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
      // maxPayload bounds a single inbound WS frame (the previously-unbounded
      // /__agent bridge); a hostile peer streaming an oversized message now
      // trips ws's 1009 (Message Too Big) close instead of exhausting memory.
      const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES });

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
              if (err instanceof RequestBodyTooLargeError) {
                res.writeHead(413, { "Content-Type": "text/plain" });
                res.end("Payload too large: " + err.message);
                return;
              }
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end("Internal server error: " + err.message);
            }
          });
        }
      );

      const port = server.config.server.port ?? 1420;
      console.log(
        `[agent-mcp] MCP server ready at http://localhost:${port}/mcp`
      );
      console.log(
        `[agent-mcp] Editor bridge ready at ws://localhost:${port}/__agent`
      );
    },
  };
}

// Re-export for tests
export { errorContent, createMcpServerForRequest, parseBody, humanizeCommand };

export default agentMcpPlugin;
