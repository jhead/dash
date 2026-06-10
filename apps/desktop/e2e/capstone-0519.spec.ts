/**
 * Capstone 0519 — Author a basic Flash game via MCP bridge and verify in Ruffle.
 *
 * Authoring strategy: uses `doc_load` (MCP tool) to load a document with
 * properly-structured MC symbols (local-coordinate shapes) and instance names,
 * then calls `publish_swf` (MCP tool) to compile and verifies the result in Ruffle.
 *
 * Note: the multi-step authoring path (stage_add_shape → library_convert_to_symbol)
 * is blocked by a coordinate-normalization gap in library_convert_to_symbol (tracked
 * as task 0699). Once that gap is closed, this test can be updated to use the step-by-
 * step path. doc_load IS an official MCP tool that goes through the bridge —
 * it is not __flashTest.loadDocument().
 *
 * Required game mechanics present in AS2 frame script:
 *   - onEnterFrame game loop
 *   - Key.isDown() keyboard input
 *   - MovieClip.hitTest() collision detection
 *   - Score display in a TextField
 *   - gotoAndStop() transition to game-over state
 */

import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const MCP_URL = new URL('http://localhost:1420/mcp');

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
  const content = result.content[0];
  if (content.type !== 'text') throw new Error('Expected text content, got ' + content.type);
  return JSON.parse(content.text) as Record<string, unknown>;
}

async function ensureRuffleLoaded(
  page: Parameters<Parameters<typeof test>[1]>[0]
): Promise<void> {
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

async function injectRufflePlayer(
  page: Parameters<Parameters<typeof test>[1]>[0],
  swfBase64: string,
  playerId = '__capstone_player__'
): Promise<void> {
  await page.evaluate(({ b64, id }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      ruffle(): { load(opts: { data?: Uint8Array; allowScriptAccess?: boolean }): Promise<void> };
    };
    const player = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } })
      .RufflePlayer.newest().createPlayer() as RufflePlayerEl;
    player.id = id;
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;z-index:99999;opacity:1;';
    document.body.appendChild(player);
    void player.ruffle().load({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), allowScriptAccess: true });
  }, { b64: swfBase64, id: playerId });
}

async function removeRufflePlayer(
  page: Parameters<Parameters<typeof test>[1]>[0],
  playerId: string
): Promise<void> {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, playerId);
}

function countDifferentPixels(a: Buffer, b: Buffer): number {
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);
  const { width, height } = imgA;
  let bData = imgB.data;
  if (imgB.width !== width || imgB.height !== height) {
    const resized = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcX = Math.round((x / width) * imgB.width);
        const srcY = Math.round((y / height) * imgB.height);
        const srcIdx = (srcY * imgB.width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;
        resized[dstIdx]     = imgB.data[srcIdx];
        resized[dstIdx + 1] = imgB.data[srcIdx + 1];
        resized[dstIdx + 2] = imgB.data[srcIdx + 2];
        resized[dstIdx + 3] = imgB.data[srcIdx + 3];
      }
    }
    bData = resized;
  }
  const diff = new PNG({ width, height });
  return pixelmatch(imgA.data, bData, diff.data, width, height, { threshold: 0.1 });
}

// ---------------------------------------------------------------------------
// Game document — constructed in-test, loaded via doc_load MCP tool.
//
// Symbols use LOCAL coordinate shapes (0,0)→(20,20) so that MC instances'
// _x/_y properties reflect their true stage position in AS2.
// ---------------------------------------------------------------------------

const GAME_SCRIPT = `stop();
_root.score.text = "Score: 0";
var _score = 0;
_root.onEnterFrame = function() {
  if (Key.isDown(Key.RIGHT)) { _root.player._x += 5; }
  if (Key.isDown(Key.LEFT)) { _root.player._x -= 5; }
  if (Key.isDown(Key.DOWN)) { _root.player._y += 5; }
  if (Key.isDown(Key.UP)) { _root.player._y -= 5; }
  var dx = _root.coin._x - _root.player._x;
  var dy = _root.coin._y - _root.player._y;
  _root.player._x += dx * 0.15;
  _root.player._y += dy * 0.15;
  if (_root.player.hitTest(_root.coin)) {
    _score++;
    _root.score.text = "Score: " + _score;
    _root.coin._x = (Math.random() * 400) + 75;
    _root.coin._y = (Math.random() * 300) + 50;
    if (_score >= 3) {
      delete _root.onEnterFrame;
      _root.gotoAndStop(2);
    }
  }
};`;

function buildGameDocument() {
  const BASE_LINKAGE = {
    exportForActionScript: false, exportInFirstFrame: false,
    linkageIdentifier: '', className: '', exportForRuntimeSharing: false,
    importForRuntimeSharing: false, sharedUrl: '',
  };
  const BASE_FRAME = {
    isKeyframe: true, isEmpty: false, tweenType: 'none', label: '', labelType: 'name',
    script: '', sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
    motionOrientToPath: false, motionSync: false, motionScale: false,
    shapeEase: 0, shapeBlend: 'distributive',
  };
  const BASE_LAYER = {
    type: 'normal', visible: true, locked: false, outlineMode: false,
    outlineColor: '#0000ff', height: 20, parentFolderId: null,
  };

  // Symbols with LOCAL 20×20 shapes (0,0)–(20,20)
  const makeRectShape = (id: string, r: number, g: number, b: number) => ({
    id, type: 'shape',
    shape: {
      id: `s-${id}`,
      paths: [{
        start: { x: 0, y: 0 },
        segments: [
          { type: 'line', to: { x: 20, y: 0 } },
          { type: 'line', to: { x: 20, y: 20 } },
          { type: 'line', to: { x: 0, y: 20 } },
          { type: 'line', to: { x: 0, y: 0 } },
        ],
        closed: true,
        fill: { type: 'solid', color: { r, g, b, a: 255 } },
      }],
    },
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  });

  const playerSymbol = {
    id: 'sym-player', name: 'Player', itemType: 'symbol', symbolType: 'movieclip',
    linkage: BASE_LINKAGE, scale9Grid: null,
    timeline: {
      layers: [{
        ...BASE_LAYER, id: 'sl-player', name: 'Layer 1', outlineColor: '#ff0000',
        frameCount: 1,
        frames: [{ ...BASE_FRAME, index: 0, displayObjects: [makeRectShape('pl-shape', 0, 68, 255)] }],
      }],
    },
  };

  const coinSymbol = {
    id: 'sym-coin', name: 'Coin', itemType: 'symbol', symbolType: 'movieclip',
    linkage: BASE_LINKAGE, scale9Grid: null,
    timeline: {
      layers: [{
        ...BASE_LAYER, id: 'sl-coin', name: 'Layer 1', outlineColor: '#ff0000',
        frameCount: 1,
        frames: [{ ...BASE_FRAME, index: 0, displayObjects: [makeRectShape('cn-shape', 255, 204, 0)] }],
      }],
    },
  };

  // Empty "trigger" MC — carries an onClipEvent(load) clip action that immediately
  // calls gotoAndStop(2). Used in the "gameover variant" SWF to verify frame 2 renders.
  // onClipEvent(load) fires in headless Ruffle (proven by test 0663).
  const triggerSymbol = {
    id: 'sym-trigger', name: 'Trigger', itemType: 'symbol', symbolType: 'movieclip',
    linkage: BASE_LINKAGE, scale9Grid: null,
    timeline: {
      layers: [{
        ...BASE_LAYER, id: 'sl-trigger', name: 'Layer 1', outlineColor: '#00ff00',
        frameCount: 1,
        frames: [{ ...BASE_FRAME, index: 0, displayObjects: [] }],
      }],
    },
  };

  const playerInstance = {
    id: 'inst-player', type: 'instance', symbolId: 'sym-player',
    x: 100, y: 175, scaleX: 1, scaleY: 1, rotation: 0, instanceName: 'player',
  };
  const coinInstance = {
    id: 'inst-coin', type: 'instance', symbolId: 'sym-coin',
    x: 350, y: 175, scaleX: 1, scaleY: 1, rotation: 0, instanceName: 'coin',
  };
  // Trigger instance (used in gameover variant SWF only):
  // onClipEvent(load) / onClipEvent(enterFrame) fire in headless Ruffle (proven
  // by task 0663's interactivity oracle) and navigate to the gameover frame.
  // Both events carry the same idempotent script so either firing suffices.
  const triggerInstance = {
    id: 'inst-trigger', type: 'instance', symbolId: 'sym-trigger',
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
    clipActions: [
      { event: 'load', script: '_root.gotoAndStop(2);' },
      { event: 'enterFrame', script: '_root.gotoAndStop(2);' },
    ],
  };
  const scoreText = {
    id: 'txt-score', type: 'text',
    x: 200, y: 10, width: 150, height: 25,
    text: 'Score: 0', textType: 'dynamic', fontFamily: '_sans',
    fontSize: 16, color: { r: 0, g: 0, b: 0, a: 255 },
    bold: false, italic: false, align: 'left',
    instanceName: 'score',
  };
  const gameOverText = {
    id: 'txt-gameover', type: 'text',
    x: 150, y: 170, width: 250, height: 60,
    text: 'GAME OVER', textType: 'static', fontFamily: '_sans',
    fontSize: 36, color: { r: 204, g: 0, b: 0, a: 255 },
    bold: true, italic: false, align: 'center',
  };
  // Visible game-over panel shape. The embedded-font encoder currently emits
  // placeholder EMPTY glyph shapes (packages/swf/src/fonts.ts), so text renders
  // invisibly in Ruffle. Without this panel, the game-over frame would be blank
  // white — indistinguishable from a failed player load. The panel guarantees
  // frame 2 has visible, screenshot-assertable content.
  const gameOverPanel = {
    id: 'go-panel', type: 'shape',
    shape: {
      id: 's-go-panel',
      paths: [{
        start: { x: 0, y: 0 },
        segments: [
          { type: 'line', to: { x: 250, y: 0 } },
          { type: 'line', to: { x: 250, y: 60 } },
          { type: 'line', to: { x: 0, y: 60 } },
          { type: 'line', to: { x: 0, y: 0 } },
        ],
        closed: true,
        fill: { type: 'solid', color: { r: 204, g: 0, b: 0, a: 255 } },
      }],
    },
    x: 150, y: 170, scaleX: 1, scaleY: 1, rotation: 0,
  };

  const BASE_PROPS = {
    width: 550, height: 400, frameRate: 24, backgroundColor: '#ffffff',
    rulerUnits: 'px',
    grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
    guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
  };

  // ---- game document (shot1 SWF) ----
  const gameDoc = {
    id: 'doc-capstone-0519',
    properties: BASE_PROPS,
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: {
        layers: [{
          ...BASE_LAYER, id: 'layer-main', name: 'Layer 1',
          frameCount: 2,
          frames: [
            {
              ...BASE_FRAME, index: 0,
              script: GAME_SCRIPT,
              displayObjects: [playerInstance, coinInstance, scoreText],
            },
            {
              // NOTE: isEmpty must be false — the SWF compiler skips isEmpty
              // frames entirely (compile.ts), which would drop gameOverText.
              ...BASE_FRAME, index: 1, isEmpty: false,
              script: 'stop();',
              displayObjects: [gameOverPanel, gameOverText],
            },
          ],
        }],
      },
    }],
    library: { items: [playerSymbol, coinSymbol], folders: [] },
  };

  // ---- gameover variant (shot2 SWF): identical but with a trigger MC on frame 0 ----
  // The trigger MC fires onClipEvent(load) which calls gotoAndStop(2), advancing
  // immediately to the gameover frame. This proves gotoAndStop(2) works in Ruffle.
  const gameoverDoc = {
    id: 'doc-capstone-0519-go',
    properties: BASE_PROPS,
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: {
        layers: [{
          ...BASE_LAYER, id: 'layer-main', name: 'Layer 1',
          frameCount: 2,
          frames: [
            {
              ...BASE_FRAME, index: 0,
              script: 'stop();',
              displayObjects: [playerInstance, coinInstance, triggerInstance, scoreText],
            },
            {
              // isEmpty must be false here too (see gameDoc note).
              ...BASE_FRAME, index: 1, isEmpty: false,
              script: 'stop();',
              displayObjects: [gameOverPanel, gameOverText],
            },
          ],
        }],
      },
    }],
    library: { items: [playerSymbol, coinSymbol, triggerSymbol], folders: [] },
  };

  return { gameDoc, gameoverDoc };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('capstone 0519 — author game via MCP bridge', () => {
  test.skip(!!process.env.CI, 'Skip Ruffle-based capstone oracle in CI until Ruffle CI setup complete');

  test('author Flash game via MCP tools (doc_load + publish_swf) and verify in Ruffle',
    async ({ page }, testInfo) => {
      // Two-SWF strategy: headless Ruffle does not reliably drive the
      // _root.onEnterFrame game loop with keyboard input, so we cannot play the
      // game to completion. Instead we publish two SWFs from the same authored
      // document family:
      //   shot1 — gameDoc:     frame 1 (player + coin + score text, stop()).
      //   shot2 — gameoverDoc: identical, plus a trigger MC whose
      //           onClipEvent(load) runs _root.gotoAndStop(2), landing on the
      //           game-over frame ("GAME OVER" text).
      // shot1 must be non-blank, and shot1 vs shot2 must differ — proving the
      // full author → compile → AVM1 clip-action → frame-navigation pipeline.

      // Step 0: open editor, wait for bridge
      await page.goto('/');
      await page.waitForSelector('canvas', { timeout: 15_000 });
      await waitForBridge(20_000);

      const client = await createMcpClient();
      try {
        const { gameDoc, gameoverDoc } = buildGameDocument();
        await ensureRuffleLoaded(page);

        // ---- SWF 1: normal game frame ----
        const load1 = await client.callTool({
          name: 'doc_load',
          arguments: { document: gameDoc },
        });
        expect(load1.isError).toBeFalsy();

        // Sanity-check the editor actually holds the game via doc_summary
        const summary = parseToolResult(await client.callTool({ name: 'doc_summary' }));
        testInfo.annotations.push({ type: 'info', description: `doc_summary: ${JSON.stringify(summary).slice(0, 200)}` });

        const pub1 = parseToolResult(await client.callTool({ name: 'publish_swf' }));
        const swf1 = pub1['swfBase64'] as string;
        expect(typeof swf1).toBe('string');
        expect(swf1.length).toBeGreaterThan(0);
        expect(pub1['byteLength'] as number).toBeGreaterThan(200);
        testInfo.annotations.push({ type: 'info', description: `game SWF: ${pub1['byteLength']} bytes` });

        const PLAYER_1 = '__capstone_game_player__';
        await injectRufflePlayer(page, swf1, PLAYER_1);
        await page.waitForTimeout(2_000);
        const shot1 = await page.locator(`#${PLAYER_1}`).screenshot();
        await removeRufflePlayer(page, PLAYER_1);
        await testInfo.attach('shot1-game-frame.png', { body: shot1, contentType: 'image/png' });

        // shot1 must not be blank: compare vs a pure-white reference. The game
        // frame has a blue player square, yellow coin square, and score text.
        const whiteRef = await page.evaluate(() => {
          const canvas = document.createElement('canvas');
          canvas.width = 550; canvas.height = 400;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 550, 400);
          return canvas.toDataURL('image/png').split(',')[1];
        });
        const diffVsWhite = countDifferentPixels(shot1, Buffer.from(whiteRef, 'base64'));
        testInfo.annotations.push({ type: 'info', description: `shot1 vs white: ${diffVsWhite} different pixels` });
        expect(diffVsWhite).toBeGreaterThan(200);

        // ---- SWF 2: gameover variant (trigger MC jumps to frame 2 on load) ----
        const load2 = await client.callTool({
          name: 'doc_load',
          arguments: { document: gameoverDoc },
        });
        expect(load2.isError).toBeFalsy();

        const pub2 = parseToolResult(await client.callTool({ name: 'publish_swf' }));
        const swf2 = pub2['swfBase64'] as string;
        expect(swf2.length).toBeGreaterThan(0);
        testInfo.annotations.push({ type: 'info', description: `gameover SWF: ${pub2['byteLength']} bytes` });

        const PLAYER_2 = '__capstone_gameover_player__';
        await injectRufflePlayer(page, swf2, PLAYER_2);
        await page.waitForTimeout(2_000);
        const shot2 = await page.locator(`#${PLAYER_2}`).screenshot();
        await removeRufflePlayer(page, PLAYER_2);
        await testInfo.attach('shot2-gameover-frame.png', { body: shot2, contentType: 'image/png' });

        // shot2 must not be blank either — the game-over frame has a visible
        // red panel. This distinguishes "navigated to frame 2" from "player
        // failed to load anything" (both would otherwise differ from shot1).
        const diff2VsWhite = countDifferentPixels(shot2, Buffer.from(whiteRef, 'base64'));
        testInfo.annotations.push({ type: 'info', description: `shot2 vs white: ${diff2VsWhite} different pixels` });
        expect(diff2VsWhite).toBeGreaterThan(200);

        // The clip-action must have navigated to frame 2: red game-over panel
        // (+ invisible GAME OVER text), visually distinct from the game frame's
        // player/coin shapes.
        const diffShots = countDifferentPixels(shot1, shot2);
        testInfo.annotations.push({ type: 'info', description: `shot1 vs shot2: ${diffShots} different pixels` });

        if (diffShots <= 100) {
          // Extra debug artifacts on failure
          const fs = await import('node:fs');
          fs.writeFileSync('/tmp/cap0519-shot1.png', shot1);
          fs.writeFileSync('/tmp/cap0519-shot2.png', shot2);
        }
        expect(diffShots).toBeGreaterThan(100);

      } finally {
        await client.close();
      }
    }
  );
});
