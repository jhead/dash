/**
 * E2E tests for the Flash MCP agent server.
 *
 * These tests connect a real MCP client to the Vite dev server's /mcp endpoint
 * (after the editor page is loaded and the /__agent bridge is established),
 * then call tools and assert the returned document state.
 *
 * Stack:
 *   Playwright → loads http://localhost:1420 in a browser
 *   MCP Client (Node) → HTTP POST to http://localhost:1420/mcp
 *   Vite plugin → forwards via /__agent WS to the browser page
 *   Editor registry → reads live React state and returns JSON
 */

import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = new URL("http://localhost:1420/mcp");

/**
 * Create and connect a fresh MCP client for each test.
 * The client uses stateless Streamable HTTP (no session ID).
 */
async function createMcpClient(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(MCP_URL);
  const client = new Client(
    { name: "test-client", version: "0.0.1" },
    { capabilities: {} }
  );
  await client.connect(transport);
  return client;
}

/**
 * Wait until the /__agent bridge is connected (i.e. editor_status returns ok)
 * or until the timeout expires. This avoids flakiness when the Vite dev server
 * just started and the WebSocket bridge has not yet been established.
 */
async function waitForBridge(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const client = await createMcpClient();
      try {
        const result = await client.callTool({ name: "editor_status" });
        if (!result.isError) return;
      } finally {
        await client.close();
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Timed out waiting for /__agent bridge to connect");
}

test.describe("MCP agent server", () => {
  test.beforeEach(async ({ page }) => {
    // Load the editor page so the /__agent bridge registers.
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 15_000 });
    // Wait until the bridge is connected and tools are ready.
    await waitForBridge(10_000);
  });

  test("editor_status returns a valid response", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.callTool({ name: "editor_status" });
      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const content = result.content[0];
      expect(content.type).toBe("text");
      if (content.type !== "text") throw new Error("unexpected content type");

      const status = JSON.parse(content.text) as Record<string, unknown>;
      expect(status["alive"]).toBe(true);
      expect(typeof status["width"]).toBe("number");
      expect(typeof status["height"]).toBe("number");
      expect(typeof status["frameRate"]).toBe("number");
      expect(typeof status["rev"]).toBe("number");
      expect(typeof status["activeTool"]).toBe("string");
      expect(
        (status["editContext"] as Record<string, unknown>)["mode"]
      ).toBe("document");
    } finally {
      await client.close();
    }
  });

  test("doc_summary returns document structure", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.callTool({ name: "doc_summary" });
      expect(result.isError).toBeFalsy();
      const content = result.content[0];
      if (content.type !== "text") throw new Error("unexpected content type");

      const summary = JSON.parse(content.text) as Record<string, unknown>;
      expect(typeof summary["docId"]).toBe("string");
      expect(typeof summary["sceneCount"]).toBe("number");
      expect((summary["sceneCount"] as number)).toBeGreaterThan(0);
      expect(Array.isArray(summary["scenes"])).toBe(true);
      const scenes = summary["scenes"] as Array<Record<string, unknown>>;
      expect(scenes.length).toBeGreaterThan(0);

      // Each scene has layers
      const scene = scenes[0];
      expect(Array.isArray(scene["layers"])).toBe(true);
      const layers = scene["layers"] as Array<Record<string, unknown>>;
      expect(layers.length).toBeGreaterThan(0);

      const layer = layers[0];
      expect(typeof layer["id"]).toBe("string");
      expect(typeof layer["name"]).toBe("string");
      expect(typeof layer["frameCount"]).toBe("number");
    } finally {
      await client.close();
    }
  });

  test("doc_get returns the full document when path is omitted", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.callTool({
        name: "doc_get",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const content = result.content[0];
      if (content.type !== "text") throw new Error("unexpected content type");

      const docResult = JSON.parse(content.text) as Record<string, unknown>;
      expect(typeof docResult["rev"]).toBe("number");
      expect(docResult["path"]).toBe("");
      const value = docResult["value"] as Record<string, unknown>;
      expect(typeof value["id"]).toBe("string");
      expect(Array.isArray(value["scenes"])).toBe(true);
    } finally {
      await client.close();
    }
  });

  test("doc_get returns a subtree at a JSON pointer path", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.callTool({
        name: "doc_get",
        arguments: { path: "/properties" },
      });
      expect(result.isError).toBeFalsy();
      const content = result.content[0];
      if (content.type !== "text") throw new Error("unexpected content type");

      const docResult = JSON.parse(content.text) as Record<string, unknown>;
      expect(docResult["path"]).toBe("/properties");
      const value = docResult["value"] as Record<string, unknown>;
      expect(typeof value["width"]).toBe("number");
      expect(typeof value["height"]).toBe("number");
      expect(typeof value["frameRate"]).toBe("number");
    } finally {
      await client.close();
    }
  });

  test("doc_get returns an error for a bad JSON pointer", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.callTool({
        name: "doc_get",
        arguments: { path: "/nonexistent/path" },
      });
      // Should return an MCP isError result (not throw)
      expect(result.isError).toBe(true);
      const content = result.content[0];
      if (content.type !== "text") throw new Error("unexpected content type");
      expect(content.text).toContain("nonexistent");
    } finally {
      await client.close();
    }
  });

  test("flash://document/summary resource is readable", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.readResource({
        uri: "flash://document/summary",
      });
      expect(result.contents).toHaveLength(1);
      const content = result.contents[0];
      expect(content.mimeType).toBe("application/json");
      if (!("text" in content)) throw new Error("Expected text content");
      const summary = JSON.parse(content.text as string) as Record<string, unknown>;
      expect(typeof summary["docId"]).toBe("string");
      expect(typeof summary["sceneCount"]).toBe("number");
    } finally {
      await client.close();
    }
  });

  test("tool list includes all MVP tools", async () => {
    const client = await createMcpClient();
    try {
      const toolList = await client.listTools();
      const names = toolList.tools.map((t) => t.name);
      expect(names).toContain("editor_status");
      expect(names).toContain("doc_get");
      expect(names).toContain("doc_summary");
    } finally {
      await client.close();
    }
  });
});
