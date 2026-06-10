#!/usr/bin/env node --experimental-strip-types
/**
 * flash-agent — thin MCP client CLI for the Flash editor agent interface.
 *
 * Usage:
 *   flash-agent [--url <url>] <command> [args...]
 *
 * Commands:
 *   tools                         list tools with schemas (JSON output)
 *   call <tool> [json|--k=v ...]  invoke any tool, print result JSON
 *   read <resource-uri>           read an MCP resource
 *   watch                         stream doc-changed events as JSON lines
 *   screenshot [-o stage.png]     sugar: call stage_screenshot, write PNG
 *   publish [-o out.swf]          sugar: call publish_swf, write bytes
 *   repl                          interactive REPL on a single connection
 *
 * Exit codes:
 *   0 — success
 *   1 — tool error (isError)
 *   2 — transport error
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, ResourceUpdatedNotification } from "@modelcontextprotocol/sdk/types.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_URL = "http://localhost:1420/mcp";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  url: string;
  command: string;
  args: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip 'node' and script path
  let url = DEFAULT_URL;
  let i = 0;

  while (i < args.length) {
    if (args[i] === "--url" && i + 1 < args.length) {
      url = args[i + 1];
      args.splice(i, 2);
    } else if (args[i].startsWith("--url=")) {
      url = args[i].slice("--url=".length);
      args.splice(i, 1);
    } else {
      i++;
    }
  }

  const command = args[0] ?? "help";
  const rest = args.slice(1);

  return { url, command, args: rest };
}

// ---------------------------------------------------------------------------
// MCP client creation
// ---------------------------------------------------------------------------

async function getClient(url: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client(
    { name: "flash-agent", version: "0.1.0" },
    { capabilities: {} }
  );
  try {
    await client.connect(transport);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Transport error: Cannot connect to ${url}`);
    console.error(`  ${msg}`);
    console.error(
      "Is the Flash dev server running? Start it with: pnpm --filter @flash/desktop dev"
    );
    console.error(
      "Is the editor page open in the browser? Open: http://localhost:1420"
    );
    process.exit(2);
  }
  return client;
}

// ---------------------------------------------------------------------------
// Argument parsing for `call` command: JSON blob or --key=value pairs
// ---------------------------------------------------------------------------

function parseToolArgs(args: string[]): Record<string, unknown> {
  if (args.length === 0) return {};

  // Single argument that looks like JSON object or array
  if (args.length === 1 && (args[0].startsWith("{") || args[0].startsWith("["))) {
    try {
      return JSON.parse(args[0]) as Record<string, unknown>;
    } catch (err) {
      console.error("Invalid JSON argument:", args[0]);
      process.exit(1);
    }
  }

  // --key=value or --key value pairs
  const result: Record<string, unknown> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const withoutDashes = arg.slice(2);
      const eqIdx = withoutDashes.indexOf("=");
      if (eqIdx !== -1) {
        const key = withoutDashes.slice(0, eqIdx);
        const rawValue = withoutDashes.slice(eqIdx + 1);
        result[key] = parseValue(rawValue);
        i++;
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        result[withoutDashes] = parseValue(args[i + 1]);
        i += 2;
      } else {
        result[withoutDashes] = true;
        i++;
      }
    } else {
      // Bare positional: try as JSON
      try {
        const parsed = JSON.parse(arg) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          Object.assign(result, parsed);
        }
      } catch {
        console.error(`Unexpected positional argument: ${arg}`);
        console.error("Use --key=value pairs or a JSON object string.");
        process.exit(1);
      }
      i++;
    }
  }
  return result;
}

function parseValue(raw: string): unknown {
  // Try JSON first (handles numbers, booleans, null, arrays, objects)
  try {
    return JSON.parse(raw);
  } catch {
    // Fall back to string
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Helper: print MCP tool result content
// ---------------------------------------------------------------------------

function printToolResult(result: CallToolResult): void {
  for (const item of result.content) {
    if (item.type === "text") {
      // Pretty-print if it looks like JSON
      try {
        const parsed = JSON.parse(item.text) as unknown;
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(item.text);
      }
    } else if (item.type === "image") {
      console.log(`[image: ${item.mimeType}, ${item.data.length} base64 chars]`);
    } else {
      console.log(JSON.stringify(item, null, 2));
    }
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdTools(url: string): Promise<void> {
  const client = await getClient(url);
  try {
    const result = await client.listTools();
    console.log(JSON.stringify(result.tools, null, 2));
  } finally {
    await client.close();
  }
}

async function cmdCall(url: string, args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error("Usage: flash-agent call <tool> [json|--k=v ...]");
    process.exit(1);
  }
  const toolName = args[0];
  const toolArgs = parseToolArgs(args.slice(1));

  const client = await getClient(url);
  try {
    const result = await client.callTool({
      name: toolName,
      arguments: toolArgs,
    }) as CallToolResult;

    if (result.isError) {
      console.error("Tool error:");
      printToolResult(result);
      process.exit(1);
    }

    printToolResult(result);
  } finally {
    await client.close();
  }
}

async function cmdRead(url: string, args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error("Usage: flash-agent read <resource-uri>");
    process.exit(1);
  }
  const uri = args[0];
  const client = await getClient(url);
  try {
    const result = await client.readResource({ uri });
    for (const content of result.contents) {
      if ("text" in content && content.text) {
        try {
          const parsed = JSON.parse(content.text as string) as unknown;
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log(content.text);
        }
      } else if ("blob" in content && content.blob) {
        console.log(`[binary: ${(content.blob as string).length} base64 chars]`);
      }
    }
  } finally {
    await client.close();
  }
}

async function cmdScreenshot(url: string, args: string[]): Promise<void> {
  // Parse -o / --output flag
  let outputFile = "stage.png";
  const filtered: string[] = [];
  let i = 0;
  while (i < args.length) {
    if ((args[i] === "-o" || args[i] === "--output") && i + 1 < args.length) {
      outputFile = args[i + 1];
      i += 2;
    } else if (args[i].startsWith("--output=")) {
      outputFile = args[i].slice("--output=".length);
      i++;
    } else {
      filtered.push(args[i]);
      i++;
    }
  }

  const toolArgs = filtered.length > 0 ? parseToolArgs(filtered) : {};

  const client = await getClient(url);
  try {
    const result = await client.callTool({
      name: "stage_screenshot",
      arguments: toolArgs,
    }) as CallToolResult;

    if (result.isError) {
      console.error("Tool error:");
      printToolResult(result);
      process.exit(1);
    }

    // Find image content
    let imageData: string | null = null;
    for (const item of result.content) {
      if (item.type === "image" && item.mimeType === "image/png") {
        imageData = item.data;
        break;
      }
      // Some implementations return the base64 data in text content
      if (item.type === "text") {
        try {
          const parsed = JSON.parse(item.text) as Record<string, unknown>;
          if (typeof parsed["pngBase64"] === "string") {
            imageData = parsed["pngBase64"];
            break;
          }
        } catch {
          // not JSON
        }
      }
    }

    if (!imageData) {
      console.error("No PNG image data in tool result");
      printToolResult(result);
      process.exit(1);
    }

    const buf = Buffer.from(imageData, "base64");
    const absPath = path.resolve(outputFile);
    fs.writeFileSync(absPath, buf);
    console.error(`Screenshot written to ${absPath} (${buf.byteLength} bytes)`);
  } finally {
    await client.close();
  }
}

async function cmdPublish(url: string, args: string[]): Promise<void> {
  // Parse -o / --output flag
  let outputFile = "out.swf";
  const filtered: string[] = [];
  let i = 0;
  while (i < args.length) {
    if ((args[i] === "-o" || args[i] === "--output") && i + 1 < args.length) {
      outputFile = args[i + 1];
      i += 2;
    } else if (args[i].startsWith("--output=")) {
      outputFile = args[i].slice("--output=".length);
      i++;
    } else {
      filtered.push(args[i]);
      i++;
    }
  }

  const client = await getClient(url);
  try {
    const result = await client.callTool({
      name: "publish_swf",
      arguments: {},
    }) as CallToolResult;

    if (result.isError) {
      console.error("Tool error:");
      printToolResult(result);
      process.exit(1);
    }

    let swfBase64: string | null = null;
    for (const item of result.content) {
      if (item.type === "text") {
        try {
          const parsed = JSON.parse(item.text) as Record<string, unknown>;
          if (typeof parsed["swfBase64"] === "string") {
            swfBase64 = parsed["swfBase64"];
            break;
          }
        } catch {
          // not JSON
        }
      }
    }

    if (!swfBase64) {
      console.error("No SWF base64 data in tool result");
      printToolResult(result);
      process.exit(1);
    }

    const buf = Buffer.from(swfBase64, "base64");
    const absPath = path.resolve(outputFile);
    fs.writeFileSync(absPath, buf);
    console.error(`SWF written to ${absPath} (${buf.byteLength} bytes)`);
  } finally {
    await client.close();
  }
}

async function cmdLoadFla(url: string, args: string[]): Promise<void> {
  // Parse positional file path and optional -o / --output flag for response
  let inputFile: string | null = null;
  const filtered: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i].startsWith("-")) {
      filtered.push(args[i]);
      i++;
    } else if (!inputFile) {
      inputFile = args[i];
      i++;
    } else {
      filtered.push(args[i]);
      i++;
    }
  }

  if (!inputFile) {
    console.error("Usage: flash-agent load-fla <file.fla>");
    process.exit(1);
  }

  const absPath = path.resolve(inputFile);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const flaBase64 = fs.readFileSync(absPath).toString("base64");
  console.error(`Loading ${absPath} (${Math.round(flaBase64.length * 0.75 / 1024)}KB)…`);

  const client = await getClient(url);
  try {
    const result = await client.callTool({
      name: "file_load_fla",
      arguments: { flaBase64 },
    }) as CallToolResult;

    if (result.isError) {
      console.error("Tool error:");
      printToolResult(result);
      process.exit(1);
    }

    printToolResult(result);
  } finally {
    await client.close();
  }
}

async function cmdWatch(url: string): Promise<void> {
  const client = await getClient(url);
  console.error(
    `[flash-agent watch] Connected to ${url}. Streaming events as JSON lines (Ctrl-C to stop).`
  );

  // Subscribe to resource updates by opening a long-lived session.
  // The MCP SDK's StreamableHTTPClientTransport manages SSE internally;
  // resource update notifications arrive as structured events.
  client.setNotificationHandler(
    ResourceUpdatedNotificationSchema,
    (notification: ResourceUpdatedNotification) => {
      const uri = notification.params.uri;
      // Only emit once per doc-change batch (skip summary duplicate)
      if (uri === "flash://document") {
        const event = { type: "doc-changed", uri, ts: new Date().toISOString() };
        process.stdout.write(JSON.stringify(event) + "\n");
      } else if (uri !== "flash://document/summary") {
        const event = { type: "resource-updated", uri, ts: new Date().toISOString() };
        process.stdout.write(JSON.stringify(event) + "\n");
      }
    }
  );

  // Keep the process alive until interrupted
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.error("\n[flash-agent watch] Stopped.");
      resolve();
    });
    process.on("SIGTERM", resolve);
  });

  await client.close();
}

async function cmdRepl(url: string): Promise<void> {
  const client = await getClient(url);
  console.error(`Connected to ${url}`);
  console.error('Type: tools | call <tool> [args] | read <uri> | exit');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: "flash-agent> ",
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      rl.prompt();
      return;
    }

    if (trimmed === "exit" || trimmed === "quit") {
      await client.close();
      rl.close();
      return;
    }

    const parts = splitShellLine(trimmed);
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);

    try {
      if (cmd === "tools") {
        const result = await client.listTools();
        console.log(JSON.stringify(result.tools.map((t: { name: string; description?: string }) => ({ name: t.name, description: t.description })), null, 2));
      } else if (cmd === "call") {
        if (cmdArgs.length === 0) {
          console.error("Usage: call <tool> [json|--k=v ...]");
        } else {
          const toolName = cmdArgs[0];
          const toolArgs = parseToolArgs(cmdArgs.slice(1));
          const result = await client.callTool({ name: toolName, arguments: toolArgs }) as CallToolResult;
          if (result.isError) {
            console.error("Tool error:");
          }
          printToolResult(result);
        }
      } else if (cmd === "read") {
        if (cmdArgs.length === 0) {
          console.error("Usage: read <resource-uri>");
        } else {
          const result = await client.readResource({ uri: cmdArgs[0] });
          for (const content of result.contents) {
            if ("text" in content && content.text) {
              try {
                const parsed = JSON.parse(content.text as string) as unknown;
                console.log(JSON.stringify(parsed, null, 2));
              } catch {
                console.log(content.text);
              }
            }
          }
        }
      } else if (cmd === "help") {
        console.log("Commands: tools | call <tool> [args] | read <uri> | exit");
      } else {
        console.error(`Unknown command: ${cmd}. Type 'help' for usage.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    client.close().catch(() => {});
    process.exit(0);
  });
}

// Simple shell-like line splitter (handles quoted strings)
function splitShellLine(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`flash-agent — Flash editor MCP client

Usage:
  flash-agent [--url <url>] <command> [args...]

Options:
  --url <url>    MCP server URL (default: ${DEFAULT_URL})

Commands:
  tools                          List all tools with schemas
  call <tool> [json|--k=v ...]   Invoke a tool, print result JSON
  read <resource-uri>            Read an MCP resource
  watch                          Stream doc-changed events as JSON lines
  screenshot [-o stage.png]      Take a screenshot (writes PNG)
  publish [-o out.swf]           Publish to SWF (writes binary)
  load-fla <file.fla>            Load a FLA file into the editor
  repl                           Interactive REPL session

Examples:
  flash-agent tools
  flash-agent call editor_status
  flash-agent call stage_add_shape '{"kind":"rect","x1":10,"y1":10,"x2":100,"y2":50}'
  flash-agent call doc_set_properties --frameRate=24
  flash-agent read flash://document/summary
  flash-agent watch
  flash-agent screenshot -o my-stage.png
  flash-agent publish -o movie.swf
  flash-agent load-fla ./fixtures/Magnet.fla
  flash-agent --url http://localhost:1420/mcp repl

Exit codes:
  0  success
  1  tool error (isError)
  2  transport error (dev server or editor page not running)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { url, command, args } = parseArgs(process.argv);

  switch (command) {
    case "tools":
      await cmdTools(url);
      break;

    case "call":
      await cmdCall(url, args);
      break;

    case "read":
      await cmdRead(url, args);
      break;

    case "watch":
      await cmdWatch(url);
      break;

    case "screenshot":
      await cmdScreenshot(url, args);
      break;

    case "publish":
      await cmdPublish(url, args);
      break;

    case "load-fla":
      await cmdLoadFla(url, args);
      break;

    case "repl":
      await cmdRepl(url);
      break;

    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'flash-agent help' for usage.");
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Unexpected error: ${msg}`);
  process.exit(2);
});
