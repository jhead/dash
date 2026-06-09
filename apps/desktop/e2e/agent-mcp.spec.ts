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

/** Parse text content from an MCP tool result. */
function parseToolResult(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  if (result.isError) throw new Error("Tool returned isError: " + JSON.stringify(result.content));
  const content = result.content[0];
  if (content.type !== "text") throw new Error("Expected text content, got " + content.type);
  return JSON.parse(content.text) as Record<string, unknown>;
}

test.describe("MCP agent server", () => {
  test.beforeEach(async ({ page }) => {
    // Load the editor page so the /__agent bridge registers.
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 15_000 });
    // Wait until the bridge is connected and tools are ready.
    await waitForBridge(10_000);
  });

  // ===========================================================================
  // Original MVP tests
  // ===========================================================================

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
      // New full surface tools
      expect(names).toContain("doc_set_properties");
      expect(names).toContain("history_undo");
      expect(names).toContain("history_redo");
      expect(names).toContain("history_depth");
      expect(names).toContain("stage_add_shape");
      expect(names).toContain("stage_add_text");
      expect(names).toContain("stage_place_instance");
      expect(names).toContain("stage_update");
      expect(names).toContain("stage_remove");
      expect(names).toContain("stage_arrange");
      expect(names).toContain("stage_group");
      expect(names).toContain("stage_ungroup");
      expect(names).toContain("selection_get");
      expect(names).toContain("selection_set");
      expect(names).toContain("view_set");
      expect(names).toContain("tool_select");
      expect(names).toContain("timeline_add_layer");
      expect(names).toContain("timeline_remove_layer");
      expect(names).toContain("timeline_update_layer");
      expect(names).toContain("timeline_insert_frame");
      expect(names).toContain("timeline_insert_keyframe");
      expect(names).toContain("timeline_insert_blank_keyframe");
      expect(names).toContain("timeline_remove_frame");
      expect(names).toContain("timeline_set_frame_label");
      expect(names).toContain("timeline_set_tween");
      expect(names).toContain("timeline_goto_frame");
      expect(names).toContain("playback_play");
      expect(names).toContain("playback_stop");
      expect(names).toContain("script_get");
      expect(names).toContain("script_set");
      expect(names).toContain("script_check");
      expect(names).toContain("script_list");
      expect(names).toContain("library_list");
      expect(names).toContain("library_create_symbol");
      expect(names).toContain("library_convert_to_symbol");
      expect(names).toContain("library_rename");
      expect(names).toContain("library_remove");
      expect(names).toContain("jsfl_run");
      expect(names).toContain("stage_screenshot");
      expect(names).toContain("publish_swf");
      expect(names).toContain("file_save_fla");
      expect(names).toContain("file_load_fla");
    } finally {
      await client.close();
    }
  });

  // ===========================================================================
  // Full surface: one mutate → doc_get assert round-trip per domain
  // ===========================================================================

  test("document domain: doc_set_properties mutate → editor_status assert", async () => {
    const client = await createMcpClient();
    try {
      // Mutate: set frame rate to 24
      const setResult = await client.callTool({
        name: "doc_set_properties",
        arguments: { frameRate: 24, backgroundColor: "#001122" },
      });
      expect(setResult.isError).toBeFalsy();
      const setData = parseToolResult(setResult);
      expect(setData["ok"]).toBe(true);
      const revAfterSet = setData["rev"] as number;

      // Assert via editor_status
      const statusResult = await client.callTool({ name: "editor_status" });
      const status = parseToolResult(statusResult);
      expect(status["frameRate"]).toBe(24);
      expect(status["backgroundColor"]).toBe("#001122");
      expect(status["rev"]).toBe(revAfterSet);

      // Undo should revert
      const undoResult = await client.callTool({ name: "history_undo" });
      expect(undoResult.isError).toBeFalsy();

      const statusAfterUndo = parseToolResult(await client.callTool({ name: "editor_status" }));
      expect(statusAfterUndo["frameRate"]).not.toBe(24);
    } finally {
      await client.close();
    }
  });

  test("document domain: history_depth returns undo/redo counts", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.callTool({ name: "history_depth" });
      const data = parseToolResult(result);
      expect(typeof data["undo"]).toBe("number");
      expect(typeof data["redo"]).toBe("number");
    } finally {
      await client.close();
    }
  });

  test("stage domain: stage_add_shape → doc_get assert round-trip", async () => {
    const client = await createMcpClient();
    try {
      // Get active layer id
      const summaryResult = await client.callTool({ name: "doc_summary" });
      const summary = parseToolResult(summaryResult);
      const scenes = summary["scenes"] as Array<Record<string, unknown>>;
      const layers = scenes[0]["layers"] as Array<Record<string, unknown>>;
      const layerId = layers[0]["id"] as string;

      // Mutate: add a rectangle
      const addResult = await client.callTool({
        name: "stage_add_shape",
        arguments: {
          kind: "rect",
          x1: 50,
          y1: 50,
          x2: 150,
          y2: 100,
          fill: "#ff0000",
          layerId,
          frameIndex: 0,
        },
      });
      expect(addResult.isError).toBeFalsy();
      const addData = parseToolResult(addResult);
      const objId = addData["id"] as string;
      expect(typeof objId).toBe("string");

      // Assert via doc_get: the object appears in the frame's displayObjects
      const docResult = await client.callTool({
        name: "doc_get",
        arguments: { path: "/scenes/0/timeline/layers/0/frames/0/displayObjects" },
      });
      const docData = parseToolResult(docResult);
      const objects = docData["value"] as Array<Record<string, unknown>>;
      const added = objects.find((o) => o["id"] === objId);
      expect(added).toBeTruthy();
      expect(added!["type"]).toBe("shape");

      // Clean up: remove the shape
      await client.callTool({
        name: "stage_remove",
        arguments: { ids: [objId], layerId, frameIndex: 0 },
      });
    } finally {
      await client.close();
    }
  });

  test("stage domain: stage_add_text → doc_get assert round-trip", async () => {
    const client = await createMcpClient();
    try {
      const summaryResult = await client.callTool({ name: "doc_summary" });
      const summary = parseToolResult(summaryResult);
      const scenes = summary["scenes"] as Array<Record<string, unknown>>;
      const layers = scenes[0]["layers"] as Array<Record<string, unknown>>;
      const layerId = layers[0]["id"] as string;

      const addResult = await client.callTool({
        name: "stage_add_text",
        arguments: {
          x: 10, y: 10, width: 200, height: 30,
          text: "Hello MCP",
          layerId,
          frameIndex: 0,
        },
      });
      expect(addResult.isError).toBeFalsy();
      const addData = parseToolResult(addResult);
      const objId = addData["id"] as string;

      const docResult = await client.callTool({
        name: "doc_get",
        arguments: { path: "/scenes/0/timeline/layers/0/frames/0/displayObjects" },
      });
      const docData = parseToolResult(docResult);
      const objects = docData["value"] as Array<Record<string, unknown>>;
      const textObj = objects.find((o) => o["id"] === objId);
      expect(textObj).toBeTruthy();
      expect(textObj!["type"]).toBe("text");
      expect(textObj!["text"]).toBe("Hello MCP");

      // Clean up
      await client.callTool({
        name: "stage_remove",
        arguments: { ids: [objId], layerId, frameIndex: 0 },
      });
    } finally {
      await client.close();
    }
  });

  test("timeline domain: add layer → timeline_update_layer → doc_get assert round-trip", async () => {
    const client = await createMcpClient();
    try {
      // Add layer
      const addResult = await client.callTool({
        name: "timeline_add_layer",
        arguments: { name: "TestLayer" },
      });
      expect(addResult.isError).toBeFalsy();
      const addData = parseToolResult(addResult);
      const layerId = addData["layerId"] as string;
      expect(typeof layerId).toBe("string");

      // Update layer
      await client.callTool({
        name: "timeline_update_layer",
        arguments: { layerId, name: "RenamedLayer", locked: true },
      });

      // Assert via doc_summary
      const summaryResult = await client.callTool({ name: "doc_summary" });
      const summary = parseToolResult(summaryResult);
      const scenes = summary["scenes"] as Array<Record<string, unknown>>;
      const layers = scenes[0]["layers"] as Array<Record<string, unknown>>;
      const updatedLayer = layers.find((l) => l["id"] === layerId);
      expect(updatedLayer).toBeTruthy();
      expect(updatedLayer!["name"]).toBe("RenamedLayer");
      expect(updatedLayer!["locked"]).toBe(true);

      // Clean up: remove the layer
      await client.callTool({
        name: "timeline_remove_layer",
        arguments: { layerId },
      });
    } finally {
      await client.close();
    }
  });

  test("timeline domain: insert keyframe → script_set → doc_get assert round-trip", async () => {
    const client = await createMcpClient();
    try {
      const summaryResult = await client.callTool({ name: "doc_summary" });
      const summary = parseToolResult(summaryResult);
      const scenes = summary["scenes"] as Array<Record<string, unknown>>;
      const layers = scenes[0]["layers"] as Array<Record<string, unknown>>;
      const layerId = layers[0]["id"] as string;

      // Insert blank keyframe at frame 4
      await client.callTool({
        name: "timeline_insert_blank_keyframe",
        arguments: { layerId, frameIndex: 4 },
      });

      // Set script on frame 4
      const setScriptResult = await client.callTool({
        name: "script_set",
        arguments: { layerId, frameIndex: 4, script: "stop();" },
      });
      const scriptData = parseToolResult(setScriptResult);
      expect(scriptData["ok"]).toBe(true);
      expect((scriptData["diagnostics"] as unknown[]).length).toBe(0);

      // Assert via script_get
      const getResult = await client.callTool({
        name: "script_get",
        arguments: { layerId, frameIndex: 4 },
      });
      const scriptResult = parseToolResult(getResult);
      expect(scriptResult["script"]).toBe("stop();");
    } finally {
      await client.close();
    }
  });

  test("code domain: script_check returns diagnostics without mutating", async () => {
    const client = await createMcpClient();
    try {
      // Get current rev
      const status1 = parseToolResult(await client.callTool({ name: "editor_status" }));
      const revBefore = status1["rev"] as number;

      // Check broken script
      const checkResult = await client.callTool({
        name: "script_check",
        arguments: { script: "function broken( {" },
      });
      const checkData = parseToolResult(checkResult);
      const diag = checkData["diagnostics"] as unknown[];
      expect(diag.length).toBeGreaterThan(0);

      // Rev should be unchanged (no mutation)
      const status2 = parseToolResult(await client.callTool({ name: "editor_status" }));
      expect(status2["rev"]).toBe(revBefore);
    } finally {
      await client.close();
    }
  });

  test("library domain: create symbol → library_rename → doc_get assert round-trip", async () => {
    const client = await createMcpClient();
    try {
      // Create symbol
      const createResult = await client.callTool({
        name: "library_create_symbol",
        arguments: { name: "TestBall", symbolType: "movieclip" },
      });
      const createData = parseToolResult(createResult);
      const symbolId = createData["symbolId"] as string;

      // Rename
      const renameResult = await client.callTool({
        name: "library_rename",
        arguments: { itemId: symbolId, name: "RenamedBall" },
      });
      expect(renameResult.isError).toBeFalsy();
      const renameData = parseToolResult(renameResult);
      expect(renameData["ok"]).toBe(true);

      // Assert via library_list
      const listResult = await client.callTool({ name: "library_list" });
      const listData = parseToolResult(listResult);
      const items = listData["items"] as Array<Record<string, unknown>>;
      const sym = items.find((i) => i["id"] === symbolId);
      expect(sym).toBeTruthy();
      expect(sym!["name"]).toBe("RenamedBall");

      // Clean up
      await client.callTool({ name: "library_remove", arguments: { itemId: symbolId } });
    } finally {
      await client.close();
    }
  });

  test("library domain: flash://library resource is readable", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.readResource({ uri: "flash://library" });
      expect(result.contents).toHaveLength(1);
      const content = result.contents[0];
      if (!("text" in content)) throw new Error("Expected text content");
      const data = JSON.parse(content.text as string) as Record<string, unknown>;
      expect(Array.isArray(data["items"])).toBe(true);
    } finally {
      await client.close();
    }
  });

  test("output domain: publish_swf returns base64 SWF", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.callTool({ name: "publish_swf" });
      expect(result.isError).toBeFalsy();
      const data = parseToolResult(result);
      expect(typeof data["swfBase64"]).toBe("string");
      expect((data["swfBase64"] as string).length).toBeGreaterThan(0);
      expect(typeof data["byteLength"]).toBe("number");
      expect((data["byteLength"] as number)).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });

  test("output domain: file_save_fla / file_load_fla round-trip", async () => {
    const client = await createMcpClient();
    try {
      // Set a distinctive property first
      await client.callTool({
        name: "doc_set_properties",
        arguments: { frameRate: 30 },
      });

      // Save FLA
      const saveResult = await client.callTool({ name: "file_save_fla" });
      const saveData = parseToolResult(saveResult);
      const flaBase64 = saveData["flaBase64"] as string;
      expect(typeof flaBase64).toBe("string");
      expect((saveData["byteLength"] as number)).toBeGreaterThan(0);

      // Change document
      await client.callTool({
        name: "doc_set_properties",
        arguments: { frameRate: 12 },
      });

      // Load FLA back
      const loadResult = await client.callTool({
        name: "file_load_fla",
        arguments: { flaBase64 },
      });
      expect(loadResult.isError).toBeFalsy();
      const loadData = parseToolResult(loadResult);
      expect(loadData["ok"]).toBe(true);

      // Assert restored state
      const status = parseToolResult(await client.callTool({ name: "editor_status" }));
      expect(status["frameRate"]).toBe(30);
    } finally {
      await client.close();
    }
  });

  test("output domain: jsfl_run executes and returns traces", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.callTool({
        name: "jsfl_run",
        arguments: { source: "fl.trace('jsfl_run_test');" },
      });
      expect(result.isError).toBeFalsy();
      const data = parseToolResult(result);
      expect(Array.isArray(data["traces"])).toBe(true);
      const traces = data["traces"] as string[];
      expect(traces).toContain("jsfl_run_test");
    } finally {
      await client.close();
    }
  });

  test("flash://scripts resource is readable", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.readResource({ uri: "flash://scripts" });
      expect(result.contents).toHaveLength(1);
      const content = result.contents[0];
      if (!("text" in content)) throw new Error("Expected text content");
      const data = JSON.parse(content.text as string) as Record<string, unknown>;
      expect(Array.isArray(data["scripts"])).toBe(true);
    } finally {
      await client.close();
    }
  });

  test("flash://document resource is readable", async () => {
    const client = await createMcpClient();
    try {
      const result = await client.readResource({ uri: "flash://document" });
      expect(result.contents).toHaveLength(1);
      const content = result.contents[0];
      if (!("text" in content)) throw new Error("Expected text content");
      const data = JSON.parse(content.text as string) as Record<string, unknown>;
      // The doc_get result has path/value/rev
      expect(typeof data["rev"]).toBe("number");
    } finally {
      await client.close();
    }
  });

  test("selection_get and selection_set round-trip", async () => {
    const client = await createMcpClient();
    try {
      // Set selection to empty
      await client.callTool({
        name: "selection_set",
        arguments: { ids: [] },
      });

      const getResult = await client.callTool({ name: "selection_get" });
      const data = parseToolResult(getResult);
      expect(Array.isArray(data["ids"])).toBe(true);
    } finally {
      await client.close();
    }
  });
});
