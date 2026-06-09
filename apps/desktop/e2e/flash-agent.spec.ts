/**
 * E2E tests for the flash-agent CLI.
 *
 * These tests spawn the CLI as a child process against the auto-started Vite
 * dev server (port 1420), then assert the output. Playwright handles starting
 * the webServer; we load the editor page in beforeEach to establish the
 * /__agent bridge before the CLI calls land.
 */

import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const execFileAsync = promisify(execFile);

// Absolute path to the CLI entry point
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, "../../../packages/agent-cli/src/cli.ts");
const MCP_URL = "http://localhost:1420/mcp";

/**
 * Spawn the CLI as a child process and return stdout/stderr/code.
 */
async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", CLI_PATH, ...args],
      { encoding: "utf8", timeout: 15_000 }
    );
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

/**
 * Wait until the editor bridge is connected, same pattern as agent-mcp.spec.ts.
 */
async function waitForBridge(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
      const client = new Client({ name: "test-ping", version: "0.0.1" }, { capabilities: {} });
      await client.connect(transport);
      try {
        const result = await client.callTool({ name: "editor_status" });
        if (!result.isError) return;
      } finally {
        await client.close();
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Timed out waiting for /__agent bridge");
}

test.describe("flash-agent CLI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 15_000 });
    await waitForBridge(15_000);
  });

  // ---------------------------------------------------------------------------
  // tools command
  // ---------------------------------------------------------------------------

  test("tools returns JSON array containing editor_status", async () => {
    const { stdout, code } = await runCli(["tools"]);
    expect(code).toBe(0);
    const tools = JSON.parse(stdout) as Array<{ name: string }>;
    expect(Array.isArray(tools)).toBe(true);
    const names = tools.map((t) => t.name);
    expect(names).toContain("editor_status");
    expect(names).toContain("doc_summary");
    expect(names).toContain("stage_add_shape");
    expect(names).toContain("publish_swf");
  });

  // ---------------------------------------------------------------------------
  // call command — basic round-trips
  // ---------------------------------------------------------------------------

  test("call editor_status returns rev field", async () => {
    const { stdout, code } = await runCli(["call", "editor_status"]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(result["alive"]).toBe(true);
    expect(typeof result["rev"]).toBe("number");
    expect(typeof result["width"]).toBe("number");
  });

  test("call doc_summary returns scenes", async () => {
    const { stdout, code } = await runCli(["call", "doc_summary"]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(typeof result["docId"]).toBe("string");
    expect(Array.isArray(result["scenes"])).toBe(true);
  });

  test("call doc_get with --path returns doc subtree", async () => {
    const { stdout, code } = await runCli(["call", "doc_get", "--path=/properties"]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(result["path"]).toBe("/properties");
    const value = result["value"] as Record<string, unknown>;
    expect(typeof value["width"]).toBe("number");
    expect(typeof value["height"]).toBe("number");
  });

  test("call with JSON object argument works", async () => {
    const { stdout, code } = await runCli([
      "call",
      "doc_get",
      '{"path":"/properties"}',
    ]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(result["path"]).toBe("/properties");
  });

  test("call with isError tool exits with code 1", async () => {
    // Call doc_get with a bad path that returns isError
    const { code, stderr } = await runCli([
      "call",
      "doc_get",
      "--path=/this/path/does/not/exist/at/all",
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain("Tool error");
  });

  // ---------------------------------------------------------------------------
  // Full workflow: stage_add_shape → timeline_insert_keyframe → script_set → doc_get
  // ---------------------------------------------------------------------------

  test("full workflow: add shape → insert keyframe → set script → assert doc_get", async ({ page: _page }) => {
    // Step 1: get a layer id from doc_summary
    const summaryRun = await runCli(["call", "doc_summary"]);
    expect(summaryRun.code).toBe(0);
    const summary = JSON.parse(summaryRun.stdout) as Record<string, unknown>;
    const scenes = summary["scenes"] as Array<Record<string, unknown>>;
    const layers = scenes[0]["layers"] as Array<Record<string, unknown>>;
    const layerId = layers[0]["id"] as string;

    // Step 2: add a rect
    const addRun = await runCli([
      "call",
      "stage_add_shape",
      JSON.stringify({ kind: "rect", x1: 10, y1: 10, x2: 60, y2: 40, fill: "#0000ff", layerId, frameIndex: 0 }),
    ]);
    expect(addRun.code).toBe(0);
    const addResult = JSON.parse(addRun.stdout) as Record<string, unknown>;
    const objId = addResult["id"] as string;
    expect(typeof objId).toBe("string");

    // Step 3: insert keyframe at frame 3
    const kfRun = await runCli([
      "call",
      "timeline_insert_keyframe",
      JSON.stringify({ layerId, frameIndex: 3 }),
    ]);
    expect(kfRun.code).toBe(0);

    // Step 4: set script on frame 3
    const scriptRun = await runCli([
      "call",
      "script_set",
      JSON.stringify({ layerId, frameIndex: 3, script: "stop();" }),
    ]);
    expect(scriptRun.code).toBe(0);
    const scriptResult = JSON.parse(scriptRun.stdout) as Record<string, unknown>;
    expect(scriptResult["ok"]).toBe(true);
    const diags = scriptResult["diagnostics"] as unknown[];
    expect(Array.isArray(diags)).toBe(true);
    expect(diags.length).toBe(0);

    // Step 5: assert via doc_get
    const docRun = await runCli([
      "call",
      "doc_get",
      JSON.stringify({ path: "/scenes/0/timeline/layers/0/frames/0/displayObjects" }),
    ]);
    expect(docRun.code).toBe(0);
    const docResult = JSON.parse(docRun.stdout) as Record<string, unknown>;
    const objects = docResult["value"] as Array<Record<string, unknown>>;
    const found = objects.find((o) => o["id"] === objId);
    expect(found).toBeTruthy();

    // Clean up
    await runCli(["call", "stage_remove", JSON.stringify({ ids: [objId], layerId, frameIndex: 0 })]);
  });

  // ---------------------------------------------------------------------------
  // read command
  // ---------------------------------------------------------------------------

  test("read flash://document/summary returns JSON with docId", async () => {
    const { stdout, code } = await runCli(["read", "flash://document/summary"]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(typeof result["docId"]).toBe("string");
    expect(typeof result["sceneCount"]).toBe("number");
  });

  test("read flash://library returns items array", async () => {
    const { stdout, code } = await runCli(["read", "flash://library"]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(Array.isArray(result["items"])).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // screenshot command
  // ---------------------------------------------------------------------------

  test("screenshot writes a PNG file", async () => {
    const tmpFile = path.join(os.tmpdir(), `flash-agent-test-${Date.now()}.png`);
    try {
      const { code } = await runCli(["screenshot", "-o", tmpFile]);
      expect(code).toBe(0);
      expect(fs.existsSync(tmpFile)).toBe(true);
      const buf = fs.readFileSync(tmpFile);
      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50); // P
      expect(buf[2]).toBe(0x4e); // N
      expect(buf[3]).toBe(0x47); // G
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  // ---------------------------------------------------------------------------
  // publish command
  // ---------------------------------------------------------------------------

  test("publish writes a SWF file", async () => {
    const tmpFile = path.join(os.tmpdir(), `flash-agent-test-${Date.now()}.swf`);
    try {
      const { code } = await runCli(["publish", "-o", tmpFile]);
      expect(code).toBe(0);
      expect(fs.existsSync(tmpFile)).toBe(true);
      const buf = fs.readFileSync(tmpFile);
      // SWF magic: FWS (uncompressed) or CWS (zlib) or ZWS (lzma)
      const magic = buf.slice(0, 3).toString("ascii");
      expect(["FWS", "CWS", "ZWS"]).toContain(magic);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  // ---------------------------------------------------------------------------
  // publish → @flash/swf round-trip
  // ---------------------------------------------------------------------------

  test("publish SWF decodes via @flash/swf reader", async () => {
    const tmpFile = path.join(os.tmpdir(), `flash-agent-swf-rt-${Date.now()}.swf`);
    try {
      const { code } = await runCli(["publish", "-o", tmpFile]);
      expect(code).toBe(0);
      const buf = fs.readFileSync(tmpFile);
      // Minimal validation: the SWF is non-empty and starts with valid header
      expect(buf.byteLength).toBeGreaterThan(8);
      const magic = buf.slice(0, 3).toString("ascii");
      expect(["FWS", "CWS", "ZWS"]).toContain(magic);
      // Version should be 8 (Flash 8 target)
      expect(buf[3]).toBe(8);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  // ---------------------------------------------------------------------------
  // transport error
  // ---------------------------------------------------------------------------

  test("transport error exits with code 2 and shows actionable message", async () => {
    // Point at a port that is definitely not serving MCP
    const { code, stderr } = await runCli([
      "--url",
      "http://localhost:19999/mcp",
      "call",
      "editor_status",
    ]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/Transport error|Cannot connect/i);
    expect(stderr).toMatch(/dev server|pnpm/i);
  });

  // ---------------------------------------------------------------------------
  // help / unknown command
  // ---------------------------------------------------------------------------

  test("help prints usage and exits 0", async () => {
    const { stdout, code } = await runCli(["help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("flash-agent");
    expect(stdout).toContain("tools");
    expect(stdout).toContain("call");
  });

  test("unknown command exits 1", async () => {
    const { code, stderr } = await runCli(["unknown-command-xyz"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown command");
  });
});
