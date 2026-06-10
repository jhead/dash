/**
 * Acceptance oracle for task 0707 — library_convert_to_symbol coordinate
 * normalization.
 *
 * Criterion (from the task):
 *   "e2e proving stage_add_shape → library_convert_to_symbol → publish renders
 *    identically (pixel diff under threshold) to the unconverted original"
 *
 * Strategy:
 *   1. Drive the live editor via the MCP agent bridge:
 *        doc_load (clean doc) → stage_add_shape → publish_swf  (BASELINE bytes)
 *   2. Then on the SAME shape: library_convert_to_symbol → publish_swf
 *        (CONVERTED bytes)
 *   3. Render BOTH SWFs through Ruffle and compare with pixelmatch. If the
 *      coordinate normalization is correct the two renders are pixel-identical
 *      (the converted symbol instance lands at exactly the same stage position
 *      as the original raw shape).
 *
 * This is a Ruffle-backed oracle (the acceptance truth per CLAUDE.md — byte
 * presence in unit tests is necessary but not sufficient for placement). It is
 * skipped in CI until the Ruffle WASM infra is wired, matching visual-oracle.
 */

import { test, expect, TestInfo } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const MCP_URL = new URL("http://localhost:1420/mcp");

// ---------------------------------------------------------------------------
// MCP helpers
// ---------------------------------------------------------------------------

async function createMcpClient(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(MCP_URL);
  const client = new Client({ name: "convert-identity", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

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

function parseToolResult(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  if (result.isError) throw new Error("Tool returned isError: " + JSON.stringify(result.content));
  const content = result.content[0];
  if (content.type !== "text") throw new Error("Expected text content, got " + content.type);
  return JSON.parse(content.text) as Record<string, unknown>;
}

// A minimal clean document with one white-background frame and one normal layer.
function cleanDoc() {
  return {
    id: "convert-identity-doc",
    properties: {
      width: 550, height: 400, frameRate: 12,
      backgroundColor: "#ffffff", rulerUnits: "px",
      grid: { showGrid: false, snapToGrid: false, gridColor: "#999999", gridWidth: 18, gridHeight: 18 },
      guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
    },
    scenes: [{
      id: "scene-1", name: "Scene 1",
      timeline: {
        layers: [{
          id: "layer-Layer 1", name: "Layer 1", type: "normal",
          visible: true, locked: false, outlineMode: false,
          outlineColor: "#ff0000", height: 20, parentFolderId: null,
          frameCount: 1,
          frames: [{
            index: 0, isKeyframe: true, isEmpty: true, tweenType: "none",
            label: "", labelType: "name", script: "", sound: null,
            motionEase: 0, motionRotate: "none", motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: "distributive",
            displayObjects: [],
          }],
        }],
      },
    }],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Ruffle render + compare helpers (adapted from visual-oracle.spec.ts)
// ---------------------------------------------------------------------------

async function ensureRuffleLoaded(page: Parameters<Parameters<typeof test>[1]>[0]): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) { resolve(); return; }
      const existing = document.querySelector<HTMLScriptElement>("script[data-ruffle]");
      if (existing) {
        if ((window as Window & typeof globalThis).RufflePlayer) { resolve(); return; }
        existing.addEventListener("load", () => resolve(), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "/ruffle/ruffle.js";
      script.dataset["ruffle"] = "1";
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => reject(new Error("Failed to load /ruffle/ruffle.js")), { once: true });
      document.head.appendChild(script);
    });
  });
}

async function ruffleScreenshotOfSwf(
  page: Parameters<Parameters<typeof test>[1]>[0],
  swfBase64: string
): Promise<Buffer> {
  await ensureRuffleLoaded(page);
  await page.evaluate((b64) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & { ruffle(): { load(opts: { data?: Uint8Array }): Promise<void> } };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = "__ruffle_convert_player__";
    player.style.cssText = "position:fixed;top:0;left:0;width:550px;height:400px;pointer-events:none;z-index:99999";
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({ data: bytes });
  }, swfBase64);

  await page.waitForTimeout(1500);
  const shot = await page.locator("#__ruffle_convert_player__").screenshot();
  await page.evaluate(() => {
    const el = document.getElementById("__ruffle_convert_player__");
    if (el) el.remove();
  });
  return shot;
}

function mismatchRatio(a: Buffer, b: Buffer): number {
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);
  const { width, height } = imgA;
  const diff = new PNG({ width, height });
  let bData = imgB.data;
  if (imgB.width !== width || imgB.height !== height) {
    const resized = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcX = Math.round((x / width) * imgB.width);
        const srcY = Math.round((y / height) * imgB.height);
        const srcIdx = (srcY * imgB.width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;
        resized[dstIdx] = imgB.data[srcIdx];
        resized[dstIdx + 1] = imgB.data[srcIdx + 1];
        resized[dstIdx + 2] = imgB.data[srcIdx + 2];
        resized[dstIdx + 3] = imgB.data[srcIdx + 3];
      }
    }
    bData = resized;
  }
  const mm = pixelmatch(imgA.data, bData, diff.data, width, height, { threshold: 0.15 });
  return mm / (width * height);
}

/** Fraction of pixels that are NOT (near-)white — a blank/empty render is ~0. */
function nonWhiteFraction(buf: Buffer): number {
  const img = PNG.sync.read(buf);
  let count = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    if (r < 245 || g < 245 || b < 245) count++;
  }
  return count / (img.width * img.height);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("convert-to-symbol render identity (task 0707)", () => {
  test.skip(!!process.env.CI, "Skip Ruffle oracle in CI until Ruffle CI setup complete");

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 15_000 });
    await waitForBridge(10_000);
  });

  test("stage_add_shape → convert_to_symbol → publish renders identically to the unconverted original", async ({ page }, testInfo: TestInfo) => {
    const client = await createMcpClient();
    let baselineSwf: string;
    let convertedSwf: string;
    try {
      // 1. Clean doc + a single rect at a non-trivial stage position (200..300, 150..230).
      parseToolResult(await client.callTool({ name: "doc_load", arguments: { document: cleanDoc() } }));
      const add = parseToolResult(await client.callTool({
        name: "stage_add_shape",
        arguments: {
          kind: "rect", x1: 200, y1: 150, x2: 300, y2: 230,
          fill: "#1e90ff", layerId: "layer-Layer 1", frameIndex: 0,
        },
      })) as { id: string };
      expect(typeof add.id).toBe("string");

      // BASELINE publish (raw shape, un-converted).
      baselineSwf = (parseToolResult(await client.callTool({ name: "publish_swf" })) as { swfBase64: string }).swfBase64;

      // 2. Convert that shape into a movieclip symbol.
      parseToolResult(await client.callTool({
        name: "library_convert_to_symbol",
        arguments: {
          ids: [add.id], name: "ConvertedRect", symbolType: "movieclip",
          layerId: "layer-Layer 1", frameIndex: 0,
        },
      }));

      // CONVERTED publish (instance of the new symbol).
      convertedSwf = (parseToolResult(await client.callTool({ name: "publish_swf" })) as { swfBase64: string }).swfBase64;
    } finally {
      await client.close();
    }

    // 3. Render both through Ruffle and compare.
    const baselineShot = await ruffleScreenshotOfSwf(page, baselineSwf);
    const convertedShot = await ruffleScreenshotOfSwf(page, convertedSwf);

    const ratio = mismatchRatio(baselineShot, convertedShot);
    const baselineInk = nonWhiteFraction(baselineShot);
    const convertedInk = nonWhiteFraction(convertedShot);

    if (ratio >= 0.02 || convertedInk < 0.01) {
      await testInfo.attach("baseline", { body: baselineShot, contentType: "image/png" });
      await testInfo.attach("converted", { body: convertedShot, contentType: "image/png" });
    }

    // Sanity: the baseline actually drew the rectangle (guards against a blank
    // oracle that would make the identity comparison meaningless).
    expect(baselineInk).toBeGreaterThan(0.01);

    // The symbol must not render empty after conversion (a coordinate bug that
    // pushed the content off-stage, or an unpopulated symbol frame, would blank
    // it out).
    expect(convertedInk).toBeGreaterThan(0.01);

    // The converted output must be essentially identical to the original — only
    // anti-aliasing jitter is tolerated. A coordinate double-offset would shift
    // the rectangle and push this far above threshold.
    expect(ratio).toBeLessThan(0.02);
  });
});
