/**
 * Agent chat-panel regression guard (tasks 1292 + 1291 + 1294).
 *
 * Permanent regression oracle for the surface unit tests missed: the chat panel
 * must MOUNT (guards the 1294 render-loop class, fixed via useShallow) and its
 * thread persistence (1291) must hold end-to-end through a real reload.
 *
 * JOB 1 (1292): the InstancePanel root fills the Properties pane width (no ~40px
 *   gap from a hardcoded width:200px). Create + select a MovieClip instance so
 *   the Instance panel mounts, then compare the InstancePanel root computed
 *   width to its containing PanelGroup content wrapper (the pane inner width).
 *
 * JOB 2 (1291): chat history persists across a full page reload, multiple threads
 *   keep ISOLATED histories, and a follow-up turn continues the ACTIVE thread's
 *   conversation (the loop uses the active thread's history). Driven through the
 *   real AgentChatPanel + persisted threadStore via the offline test stub.
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = new URL("http://localhost:1420/mcp");

async function createMcpClient(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(MCP_URL);
  const client = new Client({ name: "qa-1292-1291", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function parseToolResult(
  result: Awaited<ReturnType<Client["callTool"]>>
): Record<string, unknown> {
  if (result.isError) throw new Error("Tool returned isError: " + JSON.stringify(result.content));
  const content = (result.content as Array<{ type: string; text?: string }>)[0];
  if (content.type !== "text") throw new Error("Expected text content, got " + content.type);
  return JSON.parse(content.text as string) as Record<string, unknown>;
}

async function waitForBridge(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== "undefined",
    undefined,
    { timeout: timeoutMs }
  );
}

// ===========================================================================
// JOB 1 — InstancePanel fills the Properties pane width (task 1292)
// ===========================================================================

test.describe("1292 — InstancePanel fills the Properties pane", () => {
  test("InstancePanel root width matches its pane content wrapper", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="stage-canvas"]', { timeout: 15_000 });
    await waitForBridge(page);

    // Create a MovieClip instance: add a shape, convert to a movieclip symbol
    // (which replaces the shape with an instance of the new symbol), then select
    // that instance so the Instance properties mount in the right pane.
    const client = await createMcpClient();
    let instanceId: string;
    try {
      const add = parseToolResult(
        await client.callTool({
          name: "stage_add_shape",
          arguments: {
            kind: "rect",
            x1: 80,
            y1: 80,
            x2: 220,
            y2: 180,
            fill: "#1e90ff",
            frameIndex: 0,
          },
        })
      ) as { id: string };

      const conv = parseToolResult(
        await client.callTool({
          name: "library_convert_to_symbol",
          arguments: {
            ids: [add.id],
            name: "Mc1",
            symbolType: "movieclip",
            frameIndex: 0,
          },
        })
      ) as { instanceId: string };
      instanceId = conv.instanceId;
      expect(typeof instanceId).toBe("string");
      expect(instanceId).not.toBe("");

      parseToolResult(
        await client.callTool({
          name: "selection_set",
          arguments: { ids: [instanceId] },
        })
      );
    } finally {
      await client.close();
    }

    // Open the Properties tab so the InstancePanel renders. The right-pane tab
    // sits next to the Agent tab; "Properties" also titles a disabled toolbar
    // button, so scope to the right-panel tab bar (sibling of right-tab-agent).
    // The right-pane tab bar holds the Library/Properties/Agent tab buttons; the
    // Properties tab is the sibling of right-tab-agent. The other "Properties"
    // match is a disabled toolbar button (title="Properties") — exclude it.
    const tabBar = page.locator('[data-testid="right-tab-agent"]').locator("..");
    await tabBar.getByRole("button", { name: "Properties", exact: true }).click();

    // Locate the InstancePanel root: the div that contains the "Instance" section
    // header span. Its immediate parent is the PanelGroup content wrapper, whose
    // width is the pane inner width the panel must fill.
    const widths = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll("span")).filter(
        (s) => s.textContent === "Instance"
      );
      // The InstancePanel root is the flex-column div whose first child is the
      // sectionHeader containing this "Instance" span.
      for (const span of headers) {
        const sectionHeader = span.parentElement; // styles.sectionHeader
        const panelRoot = sectionHeader?.parentElement; // styles.panel (InstancePanel root)
        if (!panelRoot) continue;
        const cs = getComputedStyle(panelRoot);
        // Confirm this is the InstancePanel root (flex column with overflowY auto).
        if (cs.flexDirection !== "column") continue;
        const paneWrapper = panelRoot.parentElement; // PanelGroup content div
        if (!paneWrapper) continue;
        return {
          panelWidth: panelRoot.getBoundingClientRect().width,
          paneWidth: paneWrapper.getBoundingClientRect().width,
          panelClient: (panelRoot as HTMLElement).clientWidth,
          paneClient: (paneWrapper as HTMLElement).clientWidth,
        };
      }
      return null;
    });

    expect(widths, "InstancePanel root not found in Properties pane").not.toBeNull();
    const w = widths!;
    // The panel must fill the pane content wrapper: allow <=2px for sub-pixel
    // rounding. Before 1292 it was a fixed 200px in a ~240px pane (~40px short).
    expect(Math.abs(w.panelWidth - w.paneWidth)).toBeLessThanOrEqual(2);
    // Sanity: the pane is meaningfully wider than the old 200px hardcode.
    expect(w.paneWidth).toBeGreaterThan(205);

    // eslint-disable-next-line no-console
    console.log(`[1292] InstancePanel width=${w.panelWidth} pane width=${w.paneWidth}`);

    expect(errors, "console errors during JOB 1: " + errors.join(" | ")).toHaveLength(0);
  });
});

// ===========================================================================
// JOB 2 — chat history persistence + multi-thread isolation + active loop (1291)
// ===========================================================================

/** Install an offline stub runTurn that echoes a deterministic reply per turn. */
async function installEchoStub(page: Page): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { __agentChatTestStub?: unknown }).__agentChatTestStub !== "undefined",
    undefined,
    { timeout: 15_000 }
  );
  await page.evaluate(() => {
    const stub = (window as unknown as { __agentChatTestStub: { makeStubRunTurn: (calls: unknown[]) => unknown } }).__agentChatTestStub;
    // The stub's final-step text "Done." only renders when the turn runs a tool
    // round first: step 0 emits a tool call (finishReason 'tool-calls' → the AI
    // SDK loops), step 1 then emits the plain "Done." reply and stops. An EMPTY
    // tool-call array makes step 0 report 'tool-calls' with no pending results,
    // so the loop never reaches step 1 and no assistant text is ever produced
    // (the turn ends with only a step divider). Emit one harmless read-only tool
    // call so the assistant reply exists to render + persist.
    (window as unknown as { __agentChatTestHook: unknown }).__agentChatTestHook = {
      runTurn: stub.makeStubRunTurn([{ toolName: "selection_get", args: {}, text: "" }]),
    };
  });
}

async function openAgentTab(page: Page): Promise<void> {
  await page.click('[data-testid="right-tab-agent"]');
  await page.waitForSelector('[data-testid="agent-chat-panel"]');
}

async function fillKey(page: Page): Promise<void> {
  const keyInput = page.locator('[data-testid="agent-api-key-input"]');
  if (!(await keyInput.isVisible().catch(() => false))) {
    await page.click('[data-testid="agent-settings-toggle"]');
  }
  await keyInput.waitFor({ timeout: 5_000 });
  if ((await keyInput.inputValue()) === "") {
    await keyInput.fill("sk-or-test-stub-key");
    await keyInput.blur();
  }
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-testid="agent-input"]');
  await input.fill(text);
  // Wait until Send is enabled (key gate + text).
  await expect(page.locator('[data-testid="agent-send"]')).toBeEnabled();
  await page.click('[data-testid="agent-send"]');
  // Turn settles: Stop disappears, Send returns.
  await expect(page.locator('[data-testid="agent-stop"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('[data-testid="agent-send"]')).toBeVisible();
}

function userMessages(page: Page) {
  return page.locator('[data-testid="agent-user-message"]');
}

test.describe("1291 — chat history persistence + multi-thread", () => {
  test.beforeEach(async ({ page }) => {
    // Start from a clean persisted store so prior runs don't leak threads.
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("flash8.agentThreads"));
  });

  test("history persists across a full page reload", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="stage-canvas"]', { timeout: 15_000 });
    await waitForBridge(page);
    await installEchoStub(page);
    await openAgentTab(page);
    await fillKey(page);

    await sendMessage(page, "Hello thread one");
    await expect(userMessages(page)).toHaveCount(1);
    await expect(userMessages(page).first()).toHaveText("Hello thread one");

    // RELOAD the page entirely.
    await page.reload();
    await page.waitForSelector('[data-testid="stage-canvas"]', { timeout: 15_000 });
    await waitForBridge(page);
    await openAgentTab(page);

    // The transcript must be RESTORED, not blank.
    await expect(userMessages(page)).toHaveCount(1);
    await expect(userMessages(page).first()).toHaveText("Hello thread one");
    // The assistant reply ("Done." from the stub) is also restored.
    await expect(page.locator('[data-testid="agent-text"]').first()).toContainText("Done");

    expect(errors, "console errors: " + errors.join(" | ")).toHaveLength(0);
  });

  test("multiple threads keep isolated histories; active-thread loop continues the right thread", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="stage-canvas"]', { timeout: 15_000 });
    await waitForBridge(page);
    await installEchoStub(page);
    await openAgentTab(page);
    await fillKey(page);

    // Thread A: two turns (active-thread loop should accumulate both).
    await sendMessage(page, "A-first");
    await sendMessage(page, "A-second");
    await expect(userMessages(page)).toHaveCount(2);

    // The active thread's HISTORY (ModelMessage[]) must contain BOTH user turns —
    // proving the follow-up turn continued the ACTIVE thread (1284 historyRef).
    const historyAfterA = await page.evaluate(() => {
      const raw = localStorage.getItem("flash8.agentThreads");
      const parsed = JSON.parse(raw!) as { threads: Array<{ id: string; history: Array<{ role: string; content: unknown }> }>; activeThreadId: string };
      const active = parsed.threads.find((t) => t.id === parsed.activeThreadId)!;
      const userContents = active.history
        .filter((m) => m.role === "user")
        .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
      return userContents;
    });
    expect(historyAfterA).toEqual(["A-first", "A-second"]);

    // Create a NEW thread (thread B).
    await page.click('[data-testid="agent-new-thread"]');
    // New thread is empty: no user messages shown.
    await expect(userMessages(page)).toHaveCount(0);

    // Thread B: one turn.
    await sendMessage(page, "B-only");
    await expect(userMessages(page)).toHaveCount(1);
    await expect(userMessages(page).first()).toHaveText("B-only");

    // Thread B's history must NOT contain thread A's messages (isolation).
    const historyB = await page.evaluate(() => {
      const raw = localStorage.getItem("flash8.agentThreads");
      const parsed = JSON.parse(raw!) as { threads: Array<{ id: string; history: Array<{ role: string; content: unknown }> }>; activeThreadId: string };
      const active = parsed.threads.find((t) => t.id === parsed.activeThreadId)!;
      return active.history
        .filter((m) => m.role === "user")
        .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    });
    expect(historyB).toEqual(["B-only"]);
    expect(historyB).not.toContain("A-first");
    expect(historyB).not.toContain("A-second");

    // Switch BACK to thread A via the switcher and confirm A's transcript is
    // intact (its two messages), with no B message bleeding in.
    await page.click('[data-testid="agent-thread-switcher"]');
    await page.waitForSelector('[data-testid="agent-thread-menu"]');
    const items = page.locator('[data-testid="agent-thread-item"]');
    // Two threads exist. Find thread A by its derived title "A-first".
    const threadA = items.filter({ hasText: "A-first" });
    await threadA.locator('[data-testid="agent-thread-select"]').click();

    await expect(userMessages(page)).toHaveCount(2);
    const aTexts = await userMessages(page).allTextContents();
    expect(aTexts).toEqual(["A-first", "A-second"]);
    expect(aTexts).not.toContain("B-only");

    // ACTIVE-THREAD LOOP: a follow-up turn on (now-active) thread A continues
    // THREAD A's conversation, not B's. After this turn A has 3 user turns and
    // A's history includes all three.
    await sendMessage(page, "A-third");
    await expect(userMessages(page)).toHaveCount(3);

    const historyAFinal = await page.evaluate(() => {
      const raw = localStorage.getItem("flash8.agentThreads");
      const parsed = JSON.parse(raw!) as { threads: Array<{ id: string; title: string; history: Array<{ role: string; content: unknown }> }>; activeThreadId: string };
      const active = parsed.threads.find((t) => t.id === parsed.activeThreadId)!;
      return {
        title: active.title,
        users: active.history
          .filter((m) => m.role === "user")
          .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))),
      };
    });
    expect(historyAFinal.title).toBe("A-first");
    expect(historyAFinal.users).toEqual(["A-first", "A-second", "A-third"]);

    // eslint-disable-next-line no-console
    console.log(`[1291] thread A history=${JSON.stringify(historyAFinal.users)} thread B history=${JSON.stringify(historyB)}`);

    expect(errors, "console errors: " + errors.join(" | ")).toHaveLength(0);
  });

  test("regression: markdown renders + transcript text is selectable with thread layer", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="stage-canvas"]', { timeout: 15_000 });
    await waitForBridge(page);

    // Stub a reply containing markdown (bold + a list) so AgentMarkdown (1290) runs.
    await page.waitForFunction(
      () => typeof (window as unknown as { __agentChatTestStub?: unknown }).__agentChatTestStub !== "undefined",
      undefined,
      { timeout: 15_000 }
    );
    await page.evaluate(() => {
      const stub = (window as unknown as { __agentChatTestStub: { makeStubRunTurn: (calls: unknown[]) => unknown } }).__agentChatTestStub;
      // makeStubRunTurn's first-step text is taken from the tool call's `text`;
      // with no tool call the final reply is the fixed "Done." — so to exercise
      // markdown we emit a tool call whose `text` is markdown, then it stops.
      (window as unknown as { __agentChatTestHook: unknown }).__agentChatTestHook = {
        runTurn: stub.makeStubRunTurn([
          { toolName: "selection_get", args: {}, text: "**bold reply** and a `code` span" },
        ]),
      };
    });

    await openAgentTab(page);
    await fillKey(page);

    const input = page.locator('[data-testid="agent-input"]');
    await input.fill("render markdown please");
    await expect(page.locator('[data-testid="agent-send"]')).toBeEnabled();
    await page.click('[data-testid="agent-send"]');
    await expect(page.locator('[data-testid="agent-stop"]')).toHaveCount(0, { timeout: 15_000 });

    // Markdown (1290): the assistant text contains a rendered <strong> element.
    const md = page.locator('[data-testid="agent-text"]').first();
    await expect(md.locator("strong")).toHaveText("bold reply");
    await expect(md.locator("code")).toHaveText("code");

    // Text-selection (1285): the transcript opts back into selectable text.
    const userSelect = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="agent-transcript"]') as HTMLElement | null;
      if (!el) return "";
      const cs = getComputedStyle(el);
      return cs.userSelect || cs.webkitUserSelect || "";
    });
    expect(userSelect).toBe("text");
  });
});
