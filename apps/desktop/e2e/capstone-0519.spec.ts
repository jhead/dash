/**
 * Capstone 0519 — author a basic Flash game end-to-end via the GRANULAR MCP
 * authoring tools and verify real gameplay in Ruffle.
 *
 * Authoring (all through real MCP callTool round-trips, no doc_load fixture):
 *   doc_set_properties → stage_add_shape → library_convert_to_symbol →
 *   stage_update (position + instanceName + clipActions) → stage_add_text →
 *   timeline_insert_blank_keyframe → script_set → publish_swf
 *
 * Game: "Coin Dash". A blue player square starts at x=100; a yellow coin sits
 * at x=390. Each key press moves the player +60px (onClipEvent(keyDown) — the
 * proven keyboard path in headless Ruffle; Key.isDown polling is broken in the
 * bundled Ruffle 0.1.0, see CLAUDE.md). A _root.onEnterFrame game loop checks
 * MovieClip.hitTest(player, coin); on collision the score increments, the
 * score TextField text is updated, and the player resets to x=100. At score
 * >= 3 the game calls gotoAndStop(2) — the GAME OVER frame (red panel + text).
 *
 * Required mechanics, all present and exercised at runtime:
 *   - _root.onEnterFrame game loop          (frame script)
 *   - Key input                             (onClipEvent(keyDown) clip action)
 *   - MovieClip.hitTest collision           (game loop)
 *   - score in a dynamic TextField          (visibly increments)
 *   - gotoAndStop game-over                 (reached via GAMEPLAY, score >= 3)
 *
 * Runtime proof in Ruffle (Playwright):
 *   1. Initial frame renders player (blue), coin (yellow), score text (ink).
 *   2. With no input the player does NOT move (no auto-chase).
 *   3. page.keyboard ArrowRight moves the player right (input attribution).
 *   4. 5 presses → collision → score text pixels change ("Score: 0" → "1"),
 *      player resets left.
 *   5. 15 presses total → score 3 → game-over frame: red panel appears,
 *      player/coin disappear.
 *
 * Run: cd apps/desktop && npx playwright test e2e/capstone-0519.spec.ts
 */

import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PNG } from 'pngjs';

const MCP_URL = new URL('http://localhost:1420/mcp');

type Page = Parameters<Parameters<typeof test>[1]>[0];

// ---------------------------------------------------------------------------
// MCP helpers
// ---------------------------------------------------------------------------

async function createMcpClient(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(MCP_URL);
  const client = new Client({ name: 'capstone-0519', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function waitForBridge(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const client = await createMcpClient();
      try {
        const result = await client.callTool({ name: 'editor_status' });
        if (!result.isError) return;
      } finally {
        await client.close();
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Timed out waiting for /__agent bridge');
}

function parseToolResult(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  if (result.isError) {
    throw new Error('Tool returned isError: ' + JSON.stringify(result.content));
  }
  const content = (result.content as Array<{ type: string; text?: string }>)[0];
  if (!content || content.type !== 'text') {
    throw new Error('Expected text content, got ' + JSON.stringify(content));
  }
  return JSON.parse(content.text!) as Record<string, unknown>;
}

/** call an MCP tool and parse the JSON result, failing the test on isError. */
async function call(
  client: Client,
  name: string,
  args?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args ?? {} });
  return parseToolResult(result);
}

// ---------------------------------------------------------------------------
// Ruffle helpers (proven patterns from keyboard.spec.ts / task 0703)
// ---------------------------------------------------------------------------

async function ensureRuffleLoaded(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) { resolve(); return; }
      const existing = document.querySelector<HTMLScriptElement>('script[data-ruffle]');
      if (existing) {
        if ((window as Window & typeof globalThis).RufflePlayer) { resolve(); return; }
        existing.addEventListener('load', () => resolve(), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = '/ruffle/ruffle.js';
      script.dataset['ruffle'] = '1';
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Failed to load /ruffle/ruffle.js')), { once: true });
      document.head.appendChild(script);
    });
  });
}

async function injectRufflePlayer(page: Page, swfBase64: string, playerId: string): Promise<void> {
  await page.evaluate(({ b64, id }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      ruffle(): { load(opts: {
        data?: Uint8Array;
        allowScriptAccess?: boolean;
        autoplay?: string;
        unmuteOverlay?: string;
      }): Promise<void> };
    };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = id;
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;z-index:99999;';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    // autoplay:'on' + unmuteOverlay:'hidden': tick frames without a
    // user-gesture audio context and without the dimming unmute overlay.
    void player.ruffle().load({
      data: bytes,
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
    });
  }, { b64: swfBase64, id: playerId });
}

/** Hide Ruffle's overlay chrome (hardware-accel warning etc.) in the shadow DOM. */
async function hideRuffleOverlays(page: Page, playerId: string): Promise<void> {
  await page.evaluate((id) => {
    const root = document.getElementById(id) as (HTMLElement & { shadowRoot?: ShadowRoot }) | null;
    const sr = root?.shadowRoot;
    if (!sr) return;
    const walk = (node: ParentNode) => {
      node.querySelectorAll('*').forEach((elem) => {
        const e = elem as HTMLElement & { shadowRoot?: ShadowRoot };
        const sig = `${e.id} ${e.className}`.toLowerCase();
        if (/modal|overlay|message|splash|play-button|panic/.test(sig)) {
          e.style.setProperty('display', 'none', 'important');
        }
        if (e.shadowRoot) walk(e.shadowRoot);
      });
    };
    walk(sr);
  }, playerId);
}

async function removeRufflePlayer(page: Page, playerId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, playerId);
}

// ---------------------------------------------------------------------------
// Pixel analysis
// ---------------------------------------------------------------------------

interface ColorStats {
  blue: number;
  yellow: number;
  red: number;
  /** Bounding box of blue (player) pixels, in image coordinates. */
  blueBox: { minX: number; maxX: number; minY: number; maxY: number } | null;
  width: number;
  height: number;
}

function analyze(buf: Buffer): ColorStats {
  const img = PNG.sync.read(buf);
  let blue = 0, yellow = 0, red = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i]!, g = img.data[i + 1]!, b = img.data[i + 2]!, a = img.data[i + 3]!;
      if (a < 10) continue;
      if (b > 150 && r < 120 && g < 140) {
        blue++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else if (r > 180 && g > 140 && b < 110) {
        yellow++;
      } else if (r > 150 && g < 110 && b < 110) {
        red++;
      }
    }
  }
  return {
    blue, yellow, red,
    blueBox: blue > 0 ? { minX, maxX, minY, maxY } : null,
    width: img.width,
    height: img.height,
  };
}

/** Count dark (text ink) pixels inside a stage-coordinate region. */
function countInkInRegion(
  buf: Buffer,
  region: { x: number; y: number; w: number; h: number }
): number {
  const img = PNG.sync.read(buf);
  const sx = img.width / 550;
  const sy = img.height / 400;
  const x0 = Math.floor(region.x * sx), x1 = Math.ceil((region.x + region.w) * sx);
  const y0 = Math.floor(region.y * sy), y1 = Math.ceil((region.y + region.h) * sy);
  let ink = 0;
  for (let y = y0; y < Math.min(y1, img.height); y++) {
    for (let x = x0; x < Math.min(x1, img.width); x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i]!, g = img.data[i + 1]!, b = img.data[i + 2]!, a = img.data[i + 3]!;
      if (a > 128 && r < 120 && g < 120 && b < 120) ink++;
    }
  }
  return ink;
}

/** Pixel diff between the same stage-coordinate region of two screenshots. */
function regionDiff(
  bufA: Buffer,
  bufB: Buffer,
  region: { x: number; y: number; w: number; h: number }
): number {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`screenshot size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const sx = a.width / 550;
  const sy = a.height / 400;
  const x0 = Math.floor(region.x * sx), x1 = Math.ceil((region.x + region.w) * sx);
  const y0 = Math.floor(region.y * sy), y1 = Math.ceil((region.y + region.h) * sy);
  let diff = 0;
  for (let y = y0; y < Math.min(y1, a.height); y++) {
    for (let x = x0; x < Math.min(x1, a.width); x++) {
      const i = (y * a.width + x) * 4;
      const dr = Math.abs(a.data[i]! - b.data[i]!);
      const dg = Math.abs(a.data[i + 1]! - b.data[i + 1]!);
      const db = Math.abs(a.data[i + 2]! - b.data[i + 2]!);
      if (dr + dg + db > 60) diff++;
    }
  }
  return diff;
}

// ---------------------------------------------------------------------------
// Game scripts
// ---------------------------------------------------------------------------

// Player movement: onClipEvent(keyDown) is the keyboard path that provably
// fires in headless Ruffle (task 0703). Key.isDown()/Key.getCode() state
// queries are broken in the bundled Ruffle 0.1.0 headless build, so movement
// is keypress-driven without direction branching. this._x += N exercises the
// member compound assignment fixed in task 0706.
const PLAYER_KEYDOWN_SCRIPT = 'this._x += 60;';

// The _root.onEnterFrame game loop: hitTest collision, score TextField update,
// player reset, gotoAndStop(2) game-over at score >= 3.
const GAME_SCRIPT = `stop();
_root.score = 0;
_root.onEnterFrame = function() {
  if (_root.player.hitTest(_root.coin)) {
    _root.score++;
    _root.scoreText.text = "Score: " + _root.score;
    _root.player._x = 100;
    if (_root.score >= 3) {
      _root.gotoAndStop(2);
    }
  }
};`;

// Stage-coordinate region of the score TextField (with margin).
const SCORE_REGION = { x: 195, y: 2, w: 215, h: 42 };

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('capstone 0519 — author game via granular MCP tools, play it in Ruffle', () => {
  test.skip(!!process.env.CI, 'Skip Ruffle-based capstone oracle in CI until Ruffle CI setup complete');

  test('coin-dash game: MCP-authored, keyboard-driven, score to game-over', async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    // -- Step 0: open editor, wait for the agent bridge ----------------------
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15_000 });
    await waitForBridge(20_000);

    const client = await createMcpClient();
    try {
      // -- Step 1: author the game via granular MCP tools --------------------
      const status = await call(client, 'editor_status');
      expect(status['alive']).toBe(true);

      await call(client, 'doc_set_properties', {
        width: 550, height: 400, frameRate: 24, backgroundColor: '#ffffff',
      });

      // Orient: find the default layer id.
      const summary0 = await call(client, 'doc_summary');
      const scenes = summary0['scenes'] as Array<{ layers: Array<{ id: string }> }>;
      const layerId = scenes[0]!.layers[0]!.id;
      expect(layerId).toBeTruthy();

      // Player: draw a 20x20 blue square at the symbol-local origin, convert
      // to a MovieClip, then position the instance and attach the keyboard
      // clip action + instance name.
      const playerShape = await call(client, 'stage_add_shape', {
        kind: 'rect', x1: 0, y1: 0, x2: 20, y2: 20, fill: '#0033ff', layerId, frameIndex: 0,
      });
      const playerConv = await call(client, 'library_convert_to_symbol', {
        ids: [playerShape['id']], name: 'Player', symbolType: 'movieclip', layerId, frameIndex: 0,
      });
      await call(client, 'stage_update', {
        id: playerConv['instanceId'], layerId, frameIndex: 0,
        updates: {
          x: 100, y: 190,
          instanceName: 'player',
          clipActions: [{ event: 'keyDown', script: PLAYER_KEYDOWN_SCRIPT }],
        },
      });

      // Coin: 40x40 yellow square MovieClip at x=390.
      const coinShape = await call(client, 'stage_add_shape', {
        kind: 'rect', x1: 0, y1: 0, x2: 40, y2: 40, fill: '#ffcc00', layerId, frameIndex: 0,
      });
      const coinConv = await call(client, 'library_convert_to_symbol', {
        ids: [coinShape['id']], name: 'Coin', symbolType: 'movieclip', layerId, frameIndex: 0,
      });
      await call(client, 'stage_update', {
        id: coinConv['instanceId'], layerId, frameIndex: 0,
        updates: { x: 390, y: 180, instanceName: 'coin' },
      });

      // Score TextField (dynamic, named so AS2 can update it).
      const scoreText = await call(client, 'stage_add_text', {
        x: 200, y: 8, width: 200, height: 30,
        text: 'Score: 0', textType: 'dynamic',
        fontFamily: 'Arial', fontSize: 20, color: '#000000', align: 'left',
        layerId, frameIndex: 0,
      });
      await call(client, 'stage_update', {
        id: scoreText['id'], layerId, frameIndex: 0,
        updates: { instanceName: 'scoreText' },
      });

      // Game-over frame: blank keyframe at index 1 with a red panel + text.
      await call(client, 'timeline_insert_blank_keyframe', { layerId, frameIndex: 1 });
      await call(client, 'stage_add_shape', {
        kind: 'rect', x1: 150, y1: 160, x2: 400, y2: 240, fill: '#cc0000', layerId, frameIndex: 1,
      });
      await call(client, 'stage_add_text', {
        x: 160, y: 178, width: 230, height: 44,
        text: 'GAME OVER', textType: 'static',
        fontFamily: 'Arial', fontSize: 32, color: '#ffffff', align: 'center', bold: true,
        layerId, frameIndex: 1,
      });

      // Frame scripts.
      const set1 = await call(client, 'script_set', { layerId, frameIndex: 0, script: GAME_SCRIPT });
      expect(set1['diagnostics']).toEqual([]);
      const set2 = await call(client, 'script_set', { layerId, frameIndex: 1, script: 'stop();' });
      expect(set2['diagnostics']).toEqual([]);

      // -- Step 2: assert authored structure (text-first verification) -------
      const summary = await call(client, 'doc_summary');
      const lib = summary['library'] as Array<{ name: string; type: string }>;
      expect(lib.map((i) => i.name).sort()).toEqual(['Coin', 'Player']);
      const layer = (summary['scenes'] as Array<{ layers: Array<{ id: string; keyframes: Array<{ index: number; objectCount: number; hasScript: boolean }> }> }>)[0]!.layers[0]!;
      const kf0 = layer.keyframes.find((k) => k.index === 0)!;
      const kf1 = layer.keyframes.find((k) => k.index === 1)!;
      expect(kf0.objectCount).toBe(3); // player, coin, scoreText
      expect(kf0.hasScript).toBe(true);
      expect(kf1.objectCount).toBe(2); // game-over panel + text
      expect(kf1.hasScript).toBe(true);

      const scripts = await call(client, 'script_list');
      expect((scripts['scripts'] as unknown[]).length).toBe(2);

      // -- Step 3: publish through the bridge ---------------------------------
      const pub = await call(client, 'publish_swf');
      const swfBase64 = pub['swfBase64'] as string;
      expect((pub['byteLength'] as number)).toBeGreaterThan(500);
      testInfo.annotations.push({ type: 'info', description: `published SWF: ${pub['byteLength']} bytes` });

      // -- Step 4: load in Ruffle ---------------------------------------------
      const PLAYER_ID = '__capstone_game__';
      await ensureRuffleLoaded(page);
      await injectRufflePlayer(page, swfBase64, PLAYER_ID);
      await page.waitForTimeout(2_000);
      await hideRuffleOverlays(page, PLAYER_ID);
      const playerEl = page.locator(`#${PLAYER_ID}`);

      // Initial frame: blue player, yellow coin, score text ink.
      const shot0 = await playerEl.screenshot();
      await testInfo.attach('shot0-initial.png', { body: shot0, contentType: 'image/png' });
      const s0 = analyze(shot0);
      testInfo.annotations.push({ type: 'info', description: `shot0 blue=${s0.blue} yellow=${s0.yellow} red=${s0.red} blueBox=${JSON.stringify(s0.blueBox)}` });
      expect(s0.blue).toBeGreaterThan(150);    // 20x20 player visible
      expect(s0.yellow).toBeGreaterThan(800);  // 40x40 coin visible
      expect(s0.red).toBeLessThan(100);        // no game-over panel yet
      const ink0 = countInkInRegion(shot0, SCORE_REGION);
      testInfo.annotations.push({ type: 'info', description: `score region ink (frame 1): ${ink0}` });
      expect(ink0).toBeGreaterThan(40);        // "Score: 0" renders (task 0702)

      // No input → no movement (no auto-chase): player x is stable.
      await page.waitForTimeout(800);
      const shotIdle = await playerEl.screenshot();
      const sIdle = analyze(shotIdle);
      expect(sIdle.blueBox).not.toBeNull();
      expect(Math.abs(sIdle.blueBox!.minX - s0.blueBox!.minX)).toBeLessThanOrEqual(2);

      // -- Step 5: focus the player and play with the keyboard ----------------
      // Focus is the load-bearing step (task 0703): click the player twice.
      await playerEl.click({ position: { x: 275, y: 350 } });
      await playerEl.click({ position: { x: 275, y: 350 } });
      await page.waitForTimeout(200);

      // One press: the player moves +60 (input attribution).
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(350);
      const shot1 = await playerEl.screenshot();
      await testInfo.attach('shot1-one-press.png', { body: shot1, contentType: 'image/png' });
      const s1 = analyze(shot1);
      testInfo.annotations.push({ type: 'info', description: `after 1 press blueBox=${JSON.stringify(s1.blueBox)}` });
      expect(s1.blueBox).not.toBeNull();
      const movedBy = s1.blueBox!.minX - s0.blueBox!.minX;
      const pxPerStage = s1.width / 550;
      expect(movedBy).toBeGreaterThan(30 * pxPerStage); // ~60 stage px right
      expect(s1.red).toBeLessThan(100);                 // still in play

      // Four more presses → x=400 → hitTest(coin) → score 1, player resets.
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(500);
      const shot2 = await playerEl.screenshot();
      await testInfo.attach('shot2-first-coin.png', { body: shot2, contentType: 'image/png' });
      const s2 = analyze(shot2);
      testInfo.annotations.push({ type: 'info', description: `after 5 presses blueBox=${JSON.stringify(s2.blueBox)} red=${s2.red}` });
      // Player reset to the left (back near start) — proves hitTest fired.
      expect(s2.blueBox).not.toBeNull();
      expect(Math.abs(s2.blueBox!.minX - s0.blueBox!.minX)).toBeLessThanOrEqual(3 * pxPerStage);
      // Score TextField visibly changed ("Score: 0" → "Score: 1").
      const scoreDiff01 = regionDiff(shot0, shot2, SCORE_REGION);
      testInfo.annotations.push({ type: 'info', description: `score region diff after 1st coin: ${scoreDiff01}` });
      expect(scoreDiff01).toBeGreaterThan(15);
      expect(s2.red).toBeLessThan(100); // not game over yet (score 1 < 3)

      // -- Step 6: play to game-over (score 3 via gameplay) -------------------
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(800);
      await hideRuffleOverlays(page, PLAYER_ID);
      const shot3 = await playerEl.screenshot();
      await testInfo.attach('shot3-game-over.png', { body: shot3, contentType: 'image/png' });
      const s3 = analyze(shot3);
      testInfo.annotations.push({ type: 'info', description: `game over: blue=${s3.blue} yellow=${s3.yellow} red=${s3.red}` });

      // gotoAndStop(2) reached via gameplay: red GAME OVER panel visible,
      // player and coin gone.
      expect(s3.red).toBeGreaterThan(5_000);   // 250x80 red panel
      expect(s3.blue).toBeLessThan(50);        // player no longer on stage
      expect(s3.yellow).toBeLessThan(50);      // coin no longer on stage

      await removeRufflePlayer(page, PLAYER_ID);
    } finally {
      await client.close();
    }
  });
});
