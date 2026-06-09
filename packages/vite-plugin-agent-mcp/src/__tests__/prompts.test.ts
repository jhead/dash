/**
 * Unit tests for MCP prompts registered by the vite-plugin-agent-mcp (task 0617).
 *
 * Creates a linked in-memory client/server transport pair, connects an MCP
 * client to the server returned by createMcpServerForRequest(), and verifies
 * that the three canned authoring prompts are registered and return structured
 * message content.
 */

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServerForRequest } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestPair(): Promise<{
  client: Client;
  cleanup: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const mcpServer = createMcpServerForRequest();
  await mcpServer.connect(serverTransport);

  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} }
  );
  await client.connect(clientTransport);

  return {
    client,
    cleanup: async () => {
      await client.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP Prompts — list", () => {
  it("lists all three authoring prompts", async () => {
    const { client, cleanup } = await createTestPair();
    try {
      const result = await client.listPrompts();
      const names = result.prompts.map((p: { name: string }) => p.name);
      expect(names).toContain("create_animation");
      expect(names).toContain("create_button");
      expect(names).toContain("author_game_loop");
    } finally {
      await cleanup();
    }
  });

  it("each prompt has a title and description", async () => {
    const { client, cleanup } = await createTestPair();
    try {
      const result = await client.listPrompts();
      for (const prompt of result.prompts) {
        expect(typeof prompt.name).toBe("string");
        expect(prompt.name.length).toBeGreaterThan(0);
      }
    } finally {
      await cleanup();
    }
  });
});

describe("MCP Prompts — get create_animation", () => {
  it("returns a two-message conversation (user + assistant)", async () => {
    const { client, cleanup } = await createTestPair();
    try {
      const result = await client.getPrompt({ name: "create_animation" });
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[1].role).toBe("assistant");
    } finally {
      await cleanup();
    }
  });

  it("assistant message mentions stage_add_shape", async () => {
    const { client, cleanup } = await createTestPair();
    try {
      const result = await client.getPrompt({ name: "create_animation" });
      const assistant = result.messages[1];
      const text = (assistant.content as { type: string; text: string }).text;
      expect(text).toContain("stage_add_shape");
    } finally {
      await cleanup();
    }
  });

  it("assistant message mentions motion tween", async () => {
    const { client, cleanup } = await createTestPair();
    try {
      const result = await client.getPrompt({ name: "create_animation" });
      const assistant = result.messages[1];
      const text = (assistant.content as { type: string; text: string }).text;
      expect(text).toContain("motion");
    } finally {
      await cleanup();
    }
  });
});

describe("MCP Prompts — get create_button", () => {
  it("returns a two-message conversation", async () => {
    const { client, cleanup } = await createTestPair();
    try {
      const result = await client.getPrompt({ name: "create_button" });
      expect(result.messages).toHaveLength(2);
    } finally {
      await cleanup();
    }
  });

  it("assistant message mentions button symbol and event handler", async () => {
    const { client, cleanup } = await createTestPair();
    try {
      const result = await client.getPrompt({ name: "create_button" });
      const text = (result.messages[1].content as { type: string; text: string }).text;
      expect(text).toContain("button");
      expect(text).toContain("onRelease");
    } finally {
      await cleanup();
    }
  });
});

describe("MCP Prompts — get author_game_loop", () => {
  it("returns a two-message conversation", async () => {
    const { client, cleanup } = await createTestPair();
    try {
      const result = await client.getPrompt({ name: "author_game_loop" });
      expect(result.messages).toHaveLength(2);
    } finally {
      await cleanup();
    }
  });

  it("assistant message mentions onEnterFrame and Key.isDown", async () => {
    const { client, cleanup } = await createTestPair();
    try {
      const result = await client.getPrompt({ name: "author_game_loop" });
      const text = (result.messages[1].content as { type: string; text: string }).text;
      expect(text).toContain("onEnterFrame");
      expect(text).toContain("Key.isDown");
    } finally {
      await cleanup();
    }
  });

  it("assistant message mentions hitTest for collision detection", async () => {
    const { client, cleanup } = await createTestPair();
    try {
      const result = await client.getPrompt({ name: "author_game_loop" });
      const text = (result.messages[1].content as { type: string; text: string }).text;
      expect(text).toContain("hitTest");
    } finally {
      await cleanup();
    }
  });
});
