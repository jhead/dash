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
        "Every read result includes `rev`; re-read if it jumps unexpectedly (another agent or human is editing).",
    }
  );

  // -----------------------------------------------------------------------
  // editor_status
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // doc_get
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // doc_summary
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // Resources
  // -----------------------------------------------------------------------
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

export default agentMcpPlugin;
