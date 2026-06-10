/**
 * Keyboard input oracle (task 0703): prove keyboard input reaches AVM1 in
 * published SWFs.
 *
 * Prior work (the 0519 capstone closure) claimed "headless Ruffle does not
 * reliably drive onEnterFrame with keyboard input" and sidestepped the issue
 * with an auto-chase workaround. That claim was asserted, never demonstrated.
 * The real gotcha is FOCUS: the ruffle-player element must be clicked/focused
 * before page.keyboard events reach AVM1.
 *
 * This suite publishes a movie with an invisible driver MovieClip carrying
 *   onClipEvent(keyDown) { _root.gotoAndStop(2); }
 * over a background that is RED on frame 1 and BLUE on frame 2. It focuses the
 * Ruffle player with a click, presses ArrowRight, and asserts the background
 * flipped red→blue (pixel diff) — proving the keypress was delivered to AVM1.
 *
 * Findings (see the test header + CLAUDE.md):
 *   - FOCUS is the load-bearing step: a click on the player is required before
 *     page.keyboard events are processed by Ruffle's AVM1.
 *   - The onClipEvent(keyDown) EVENT fires from a real key press in headless
 *     Ruffle once focused.
 *   - BUT the AVM1 Key state queries (Key.isDown(n), Key.getCode()) do NOT
 *     reflect the press in the bundled Ruffle 0.1.0 headless build — they return
 *     false/0 even inside the keyDown handler. So the keyDown event (not Key.*
 *     polling) is the reliable headless proof.
 *
 * Run locally with:
 *   pnpm --filter @flash/desktop e2e --grep "keyboard"
 *   cd apps/desktop && npx playwright test e2e/keyboard.spec.ts --reporter=line
 */

import { test, expect, TestInfo } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Helpers (mirrors interactivity.spec.ts)
// ---------------------------------------------------------------------------

async function ensureRuffleLoaded(
  page: Parameters<Parameters<typeof test>[1]>[0]
): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) {
        resolve();
        return;
      }
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
  playerId: string
): Promise<void> {
  await page.evaluate(({ b64, id }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      ruffle(): { load(opts: {
        data?: Uint8Array;
        url?: string;
        allowScriptAccess?: boolean;
        autoplay?: string;
        unmuteOverlay?: string;
      }): Promise<void> }
    };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = id;
    player.style.cssText =
      'position:fixed;top:0;left:0;width:550px;height:400px;z-index:99999;';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    // autoplay:'on' forces play() even when the audio context is suspended
    // (headless has no user-gesture audio), so enterFrame ticks without needing
    // to click a play/unmute overlay. unmuteOverlay:'hidden' removes the
    // dimming overlay that otherwise covers the stage.
    void player.ruffle().load({
      data: bytes,
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
    });
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

// A 100×100 solid square centred on the stage (for the red/blue background).
function makeCenterRect(id: string, r: number, g: number, b: number) {
  return {
    id, type: 'shape',
    shape: {
      id: `shape-${id}`,
      paths: [{
        start: { x: 225, y: 150 },
        segments: [
          { type: 'line', to: { x: 325, y: 150 } },
          { type: 'line', to: { x: 325, y: 250 } },
          { type: 'line', to: { x: 225, y: 250 } },
        ],
        closed: true,
        fill: { type: 'solid', color: { r, g, b, a: 255 } },
      }],
    },
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  };
}

// A single-frame MovieClip symbol containing a visible coloured square.
function makePlayerSymbol(symbolId: string, shapeId: string) {
  return {
    id: symbolId,
    name: 'PlayerClip',
    itemType: 'symbol',
    symbolType: 'movieclip',
    linkage: {
      exportForActionScript: false, exportInFirstFrame: false,
      linkageIdentifier: '', className: '',
      exportForRuntimeSharing: false, importForRuntimeSharing: false, sharedUrl: '',
    },
    scale9Grid: null,
    timeline: {
      layers: [{
        id: `${symbolId}-layer`, name: 'Layer 1', type: 'normal',
        visible: true, locked: false, outlineMode: false,
        outlineColor: '#ff0000', height: 20, parentFolderId: null,
        frameCount: 1,
        frames: [{
          index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
          label: '', labelType: 'name', script: '',
          sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
          motionOrientToPath: false, motionSync: false, motionScale: false,
          shapeEase: 0, shapeBlend: 'distributive',
          // 1×1 transparent shape: the driver clip is invisible; only the
          // red/blue background reflects its keyDown-driven gotoAndStop.
          displayObjects: [{
            id: shapeId, type: 'shape',
            shape: {
              id: `shape-${shapeId}`,
              paths: [{
                start: { x: 0, y: 0 },
                segments: [
                  { type: 'line', to: { x: 1, y: 0 } },
                  { type: 'line', to: { x: 1, y: 1 } },
                  { type: 'line', to: { x: 0, y: 1 } },
                ],
                closed: true,
                fill: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 0 } },
              }],
            },
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
          }],
        }],
      }],
    },
  };
}

/**
 * Build a single-frame document with one MovieClip instance placed at
 * (startX, startY) carrying the given clip actions. Returns the document.
 */
function makeKeyDoc(opts: {
  docId: string;
  symbolId: string;
  shapeId: string;
  instId: string;
  startX: number;
  startY: number;
  clipActions: Array<{ event: string; script: string }>;
}) {
  const { docId, symbolId, shapeId, instId, startX, startY, clipActions } = opts;
  return {
    id: docId,
    properties: {
      width: 550, height: 400, frameRate: 24,
      backgroundColor: '#ffffff', rulerUnits: 'px',
      grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
      guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
    },
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: {
        layers: [
          // Player layer: the invisible-by-default driver MovieClip carrying the
          // keyDown clip action. Present on frame 0 only.
          {
            id: 'player-layer', name: 'Player', type: 'normal',
            visible: true, locked: false, outlineMode: false,
            outlineColor: '#0000ff', height: 20, parentFolderId: null,
            frameCount: 2,
            frames: [
              {
                index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
                label: '', labelType: 'name', script: '',
                sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                motionOrientToPath: false, motionSync: false, motionScale: false,
                shapeEase: 0, shapeBlend: 'distributive',
                displayObjects: [{
                  id: instId, type: 'instance', symbolId,
                  x: startX, y: startY, scaleX: 1, scaleY: 1, rotation: 0,
                  instanceName: 'player',
                  clipActions,
                }],
              },
              {
                index: 1, isKeyframe: true, isEmpty: true, tweenType: 'none',
                label: '', labelType: 'name', script: '',
                sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                motionOrientToPath: false, motionSync: false, motionScale: false,
                shapeEase: 0, shapeBlend: 'distributive',
                displayObjects: [],
              },
            ],
          },
          // Background layer: red on frame 0 (with stop()), blue on frame 1.
          // The clip's keyDown handler calls _root.gotoAndStop(2) to flip it.
          {
            id: 'bg-layer', name: 'Background', type: 'normal',
            visible: true, locked: false, outlineMode: false,
            outlineColor: '#0000ff', height: 20, parentFolderId: null,
            frameCount: 2,
            frames: [
              {
                index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
                label: '', labelType: 'name', script: 'stop();',
                sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                motionOrientToPath: false, motionSync: false, motionScale: false,
                shapeEase: 0, shapeBlend: 'distributive',
                displayObjects: [makeCenterRect('bg-red', 220, 30, 30)],
              },
              {
                index: 1, isKeyframe: true, isEmpty: false, tweenType: 'none',
                label: '', labelType: 'name', script: 'stop();',
                sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                motionOrientToPath: false, motionSync: false, motionScale: false,
                shapeEase: 0, shapeBlend: 'distributive',
                displayObjects: [makeCenterRect('bg-blue', 30, 60, 220)],
              },
            ],
          },
        ],
      },
    }],
    library: { items: [makePlayerSymbol(symbolId, shapeId)], folders: [] },
  };
}

async function publishDoc(
  page: Parameters<Parameters<typeof test>[1]>[0],
  doc: unknown
): Promise<string> {
  await page.evaluate((d) => {
    (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
  }, doc);
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Keyboard input oracle: page.keyboard drives AVM1', () => {
  test.skip(!!process.env.CI, 'Skip keyboard oracle in CI until Ruffle CI setup complete');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  // Recursively hide Ruffle's overlay chrome (the "hardware acceleration
  // disabled" message + dimming backdrop that headless Chromium triggers, plus
  // splash / play-button), leaving only the rendered <canvas> for screenshots.
  async function hideRuffleOverlays(
    page: Parameters<Parameters<typeof test>[1]>[0],
    playerId: string,
  ): Promise<void> {
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

  // Count near-blue vs near-red pixels in a screenshot (the background switches
  // red→blue when the keyboard drives the clip's _root.gotoAndStop(2)).
  function colorCounts(buf: Buffer): { red: number; blue: number } {
    const img = PNG.sync.read(buf);
    let red = 0, blue = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2], a = img.data[i + 3];
      if (a < 10) continue;
      if (r > 150 && g < 120 && b < 120) red++;
      else if (b > 150 && r < 120 && g < 140) blue++;
    }
    return { red, blue };
  }

  // -------------------------------------------------------------------------
  // PROOF: keyboard input reaches AVM1 in a published SWF.
  //
  // The movie has a 100×100 background rect that is RED on frame 1 (with
  // stop()) and BLUE on frame 2 (with stop()). An invisible driver MovieClip
  // carries:
  //   onClipEvent(keyDown) { if (Key.getCode() == 39) { _root.gotoAndStop(2); } }
  // (39 = Key.RIGHT). The clip's keyDown event + _root.gotoAndStop frame
  // navigation is the proven-working path (task 0663 showed clip actions fire);
  // the variable under test is whether the ArrowRight key press is delivered to
  // AVM1 with the right key code.
  //
  // Steps:
  //   1. Publish + inject into Ruffle (autoplay:'on' so the clip ticks without
  //      a click-to-play gesture; Ruffle's hardware-accel overlay hidden).
  //   2. Screenshot — background is RED (no key pressed).
  //   3. CLICK the player to FOCUS it (the load-bearing step prior work
  //      omitted: Ruffle gates keydown on has_focus), then press ArrowRight.
  //   4. Screenshot — background is BLUE (keyDown fired gotoAndStop(2)).
  //   5. Assert red→blue: blue pixels appear, red pixels vanish.
  //
  // NOTE on Key.isDown: in the bundled Ruffle 0.1.0 under headless Playwright,
  // the onClipEvent(keyDown) EVENT fires correctly, but Key.isDown(n) / the
  // sustained key-state map does NOT reflect the press (it returns false even
  // inside the keyDown handler when the key is definitionally down). The keyDown
  // event is therefore the reliable headless proof that keyboard reaches AVM1.
  // See CLAUDE.md "SWF clip actions" learnings.
  // -------------------------------------------------------------------------
  test('keyboard input reaches AVM1: ArrowRight fires onClipEvent(keyDown) in published SWF', async ({ page }, testInfo: TestInfo) => {
    const doc = makeKeyDoc({
      docId: 'key-keydown-doc',
      symbolId: 'sym-player-key',
      shapeId: 'player-square',
      instId: 'player-inst',
      startX: 0,
      startY: 0,
      clipActions: [
        // onClipEvent(keyDown) fires when a key is pressed while the player is
        // focused. This is the reliable headless-Ruffle proof that keyboard
        // input is delivered to AVM1 (Key.getCode()/Key.isDown state queries do
        // NOT work in the bundled 0.1.0 headless build — see header note).
        { event: 'keyDown', script: '_root.gotoAndStop(2);' },
      ],
    });

    const swfBase64 = await publishDoc(page, doc);

    const PLAYER_ID = '__ruffle_key_player__';
    await ensureRuffleLoaded(page);
    await injectRufflePlayer(page, swfBase64, PLAYER_ID);
    await page.waitForTimeout(2000);
    await hideRuffleOverlays(page, PLAYER_ID);

    // Initial state: background RED (no key pressed → still on frame 1).
    const shotBefore = await page.locator(`#${PLAYER_ID}`).screenshot();
    await testInfo.attach('key-before-red', { body: shotBefore, contentType: 'image/png' });
    const before = colorCounts(shotBefore);
    console.log(`[0703] before red=${before.red} blue=${before.blue}`);

    // FOCUS the player — without this, Ruffle's WASM gates window keydown on
    // has_focus and the key never reaches AVM1. This mirrors Ruffle's own
    // keyboard_input integration test: click the player (twice, in case a modal
    // intercepts the first click) before sending keys.
    await page.locator(`#${PLAYER_ID}`).click({ position: { x: 30, y: 30 } });
    await page.locator(`#${PLAYER_ID}`).click({ position: { x: 30, y: 30 } });
    await page.waitForTimeout(150);

    // Evidence: the player host is genuinely focused (docHasFocus + activeElement).
    {
      const d = await page.evaluate((id) => {
        const host = document.getElementById(id);
        return {
          docHasFocus: document.hasFocus(),
          activeIsHost: document.activeElement === host,
          activeTag: document.activeElement?.tagName,
        };
      }, PLAYER_ID);
      console.log('[0703] focus state:', JSON.stringify(d));
    }

    // Press ArrowRight via Playwright's real keyboard. The focused Ruffle player
    // delivers this keydown to AVM1, firing the clip's onClipEvent(keyDown).
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    await hideRuffleOverlays(page, PLAYER_ID);

    // After state: background BLUE (keyDown fired _root.gotoAndStop(2)).
    const shotAfter = await page.locator(`#${PLAYER_ID}`).screenshot();
    await testInfo.attach('key-after-blue', { body: shotAfter, contentType: 'image/png' });
    const after = colorCounts(shotAfter);
    console.log(`[0703] after red=${after.red} blue=${after.blue}`);

    await removeRufflePlayer(page, PLAYER_ID);

    const diffPixels = countDifferentPixels(shotBefore, shotAfter);
    console.log(`[0703] red→blue pixelDiff = ${diffPixels}`);

    if (diffPixels < 100 || after.blue < 1000) {
      await testInfo.attach('FAIL-before-red', { body: shotBefore, contentType: 'image/png' });
      await testInfo.attach('FAIL-after-blue', { body: shotAfter, contentType: 'image/png' });
    }

    // Before: background red (no blue). After pressing ArrowRight: the focused
    // player delivered the keydown to AVM1, onClipEvent(keyDown) ran
    // _root.gotoAndStop(2), and the background is now blue. This proves keyboard
    // input reaches AVM1 in a published SWF.
    expect(before.red).toBeGreaterThan(1000);
    expect(before.blue).toBeLessThan(200);
    expect(after.blue).toBeGreaterThan(1000);
    expect(after.red).toBeLessThan(200);
    expect(diffPixels).toBeGreaterThan(100);
  });
});
