/**
 * Agent Chat e2e oracle (task 1279, Phase 4): the chat drives authoring.
 *
 * This proves the headline property of the client-side Agent Chat WITHOUT a real
 * OpenRouter key or any network call:
 *
 *     model tool-call → buildAgentTools execute → dispatchAgentCommand → document
 *     mutation
 *
 * HOW THE STUB WORKS (and why it's the right seam)
 * ------------------------------------------------
 * The real chat path is:  AgentChatPanel → runAgentTurn (AI SDK v6 `streamText`,
 * the multi-step tool loop) → tools from `buildAgentTools()` whose `execute`
 * calls `dispatchAgentCommand` → the live document store.
 *
 * The ONLY thing we replace is the language model. The Shell, in test mode,
 * exposes `window.__agentChatTestStub.makeStubRunTurn([...])`, which builds a
 * `runTurn` that calls the REAL `runAgentTurn` against a `MockLanguageModelV3`
 * (from `ai/test`) whose stream emits a single `stage_add_shape` (rect) tool
 * call. We install that `runTurn` on `window.__agentChatTestHook`, which
 * `AgentChatPanel` reads. The panel still builds and passes the REAL tool set,
 * so `streamText` auto-executes the stubbed model's tool call, which dispatches
 * `stage_add_shape` into the live editor — exactly the production path, minus the
 * network round-trip to the model.
 *
 * This is the cleanest available seam: a full browser e2e through the real loop
 * and real tool bridge, with a deterministic, offline model. We assert the
 * resulting shape appears in the live document (state changed) AND that the
 * tool-call chip rendered in the transcript.
 */
import { test, expect, type Page } from "@playwright/test";

/** Count shape display objects across every scene/layer/frame. */
async function countShapes(page: Page): Promise<number> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (window as any).__flashTest.getDocument();
    let n = 0;
    for (const scene of doc.scenes) {
      for (const layer of scene.timeline.layers) {
        for (const frame of layer.frames) {
          for (const obj of frame.displayObjects ?? []) {
            if (obj.type === "shape") n++;
          }
        }
      }
    }
    return n;
  });
}

test.describe("Agent Chat drives the stage", () => {
  test("a model tool-call adds a rect to the live document", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="stage-canvas"]', {
      timeout: 15_000,
    });

    // Wait for both the doc bridge and the chat test-stub factory.
    await page.waitForFunction(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeof (window as any).__flashTest !== "undefined" &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeof (window as any).__agentChatTestStub !== "undefined",
      undefined,
      { timeout: 15_000 }
    );

    const before = await countShapes(page);

    // Install the stubbed runTurn: emit a stage_add_shape (rect) tool call.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stub = (window as any).__agentChatTestStub;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__agentChatTestHook = {
        runTurn: stub.makeStubRunTurn([
          {
            text: "Sure — drawing a red rectangle.",
            toolName: "stage_add_shape",
            args: {
              kind: "rect",
              x1: 60,
              y1: 70,
              x2: 200,
              y2: 160,
              fill: "#ff0000",
            },
          },
        ]),
      };
    });

    // Open the Agent tab.
    await page.click('[data-testid="right-tab-agent"]');
    await page.waitForSelector('[data-testid="agent-chat-panel"]');

    // Satisfy the key gate WITHOUT any network: type a key into Settings (the
    // stub ignores it — no real provider call is made). Settings auto-opens when
    // no key is set; open it only if the body isn't already visible.
    const keyInput = page.locator('[data-testid="agent-api-key-input"]');
    if (!(await keyInput.isVisible().catch(() => false))) {
      await page.click('[data-testid="agent-settings-toggle"]');
    }
    await keyInput.waitFor({ timeout: 5_000 });
    await keyInput.fill("sk-or-test-stub-key");
    await keyInput.blur();

    // Send a prompt. The stubbed model ignores the text and emits the tool call.
    const input = page.locator('[data-testid="agent-input"]');
    await input.fill("Draw a red rectangle on the stage");
    await page.click('[data-testid="agent-send"]');

    // The turn finishes (status done) and a tool chip appears.
    await page.waitForSelector('[data-testid="agent-tool-chip"]', {
      timeout: 15_000,
    });
    await expect(
      page.locator('[data-testid="agent-tool-name"]').first()
    ).toHaveText("stage_add_shape");

    // Wait for the turn to fully settle. While the agent is `running` the
    // composer shows a Stop button; once the model loop reaches its terminal
    // `stop` the Send button comes back. Waiting for that swap is the correct
    // deterministic settle point — by here the shape count is FINAL, not a
    // mid-flight snapshot. (A polling-only assertion can pass by catching a
    // transient count of 1 during a multi-dispatch storm; we want the settled
    // count so a regression to per-step re-emit would FAIL here.)
    await expect(page.locator('[data-testid="agent-stop"]')).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="agent-send"]')).toBeVisible();

    // THE ORACLE: the live document gained EXACTLY ONE shape — the chat drove
    // authoring with a single tool call. A correct single-action turn calls
    // stage_add_shape ONCE; if the stubbed model re-emitted the tool call on
    // every step (the bug this spec guards against), the count would be N
    // (== the stepCount cap), not before+1. Asserting the exact settled count
    // (not just >before) is what proves one-and-only-one dispatch.
    expect(await countShapes(page)).toBe(before + 1);

    // And exactly one tool-call chip rendered — one model tool round, one chip.
    await expect(
      page.locator('[data-testid="agent-tool-chip"]')
    ).toHaveCount(1);

    // Sanity: the tool chip resolved successfully (no error state).
    await expect(
      page.locator('[data-testid="agent-status-error"]')
    ).toHaveCount(0);

    // Per-thread usage footer (task 1337): the turn's token total is captured
    // from the real `streamText` result and folded into the active thread, so a
    // compact "N tokens …" line appears. The mock model reports 2 tokens/step ×
    // 2 steps (tool round + final answer) = 4 tokens; cost is unknown offline
    // (no catalog/pricing fetch), so the line is tokens-only. Proves the usage
    // capture wires end-to-end through the production loop.
    const usage = page.locator('[data-testid="agent-usage"]');
    await expect(usage).toBeVisible();
    await expect(usage).toContainText("tokens");
  });
});
