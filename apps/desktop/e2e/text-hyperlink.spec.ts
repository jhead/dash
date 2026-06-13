/**
 * Text hyperlink oracle (task 1179).
 *
 * The Flash 8 text "Link" URL field + "Target:" dropdown attach an HTML anchor
 * (<a href="URL" target="TARGET">) to a text field. On publish the SWF compiler
 * wraps the field's content in that anchor and sets the DefineEditText HTML flag
 * (bit 9) so the player renders a clickable link.
 *
 * Runtime acceptance: publish a dynamic text field carrying linkUrl +
 * linkTarget="_blank", load it in Ruffle, override window.open, click the link's
 * ink, and assert Ruffle called window.open with our URL and target. This is the
 * strongest observable proof that the anchor is live: Ruffle's web navigator
 * (navigator.rs navigate_to_url) calls window.open_with_url_and_target(url,
 * target) for non-empty targets, which surfaces in JS as window.open(url,
 * target). Target "_blank" is required because Ruffle blocks current-tab
 * navigation (_self/_parent/_top/empty) unless allowScriptAccess permits it, and
 * a real location.assign would tear down the test page.
 *
 * Requires the Vite dev server (port 1420) and Ruffle served at /ruffle/.
 * Skipped in CI until Ruffle CI infrastructure is in place (same as the visual,
 * text-rendering and text-kerning oracles).
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

type Page = Parameters<Parameters<typeof test>[1]>[0];

const LINK_URL = 'http://example.com/clicked';
const PLAYER_ID = '__ruffle_link_player__';

/** Count dark (ink) pixels so we can confirm the linked text actually rendered. */
function darkPixelCount(buf: Buffer): number {
  const img = PNG.sync.read(buf);
  let dark = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const a = img.data[i + 3];
    if (a > 128 && r < 120 && g < 120 && b < 120) dark++;
  }
  return dark;
}

/** Find the vertical band containing ink, returning a representative midpoint y. */
function findInkRows(buf: Buffer): { minY: number; maxY: number; midY: number } {
  const img = PNG.sync.read(buf);
  let minY = img.height;
  let maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] > 128 && img.data[i] < 120 && img.data[i + 1] < 120 && img.data[i + 2] < 120) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        break;
      }
    }
  }
  const midY = maxY >= 0 ? Math.round((minY + maxY) / 2) : 160;
  return { minY, maxY, midY };
}

async function loadDoc(page: Page, doc: unknown): Promise<void> {
  await page.evaluate((d) => {
    (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
  }, doc);
  await page.waitForTimeout(300);
}

async function ensureRuffle(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) { resolve(); return; }
      const script = document.createElement('script');
      script.src = '/ruffle/ruffle.js';
      script.dataset['ruffle'] = '1';
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Failed to load /ruffle/ruffle.js')), { once: true });
      document.head.appendChild(script);
    });
  });
}

/** Inject the player + install a window.open spy that records calls on window. */
async function injectPlayer(page: Page, swfBase64: string): Promise<void> {
  await page.evaluate((b64) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      ruffle(): { load(opts: { data?: Uint8Array; allowScriptAccess?: boolean; autoplay?: string; unmuteOverlay?: string }): Promise<void> }
    };
    const w = window as unknown as { __openCalls: Array<{ url: string; target: string }>; open: typeof window.open };
    w.__openCalls = [];
    const realOpen = window.open.bind(window);
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      w.__openCalls.push({ url: String(url ?? ''), target: String(target ?? '') });
      // Do NOT actually open a tab in headless Chromium; just record the call.
      void realOpen; void features;
      return null;
    }) as typeof window.open;

    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer();
    player.id = '__ruffle_link_player__';
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;z-index:99999;';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({ data: bytes, allowScriptAccess: true, autoplay: 'on', unmuteOverlay: 'hidden' });
  }, swfBase64);
}

async function publish(page: Page): Promise<string> {
  return page.evaluate(() => {
    return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
  });
}

async function screenshotPlayer(page: Page): Promise<Buffer> {
  return page.locator(`#${PLAYER_ID}`).screenshot();
}

async function getOpenCalls(page: Page): Promise<Array<{ url: string; target: string }>> {
  return page.evaluate(() => (window as unknown as { __openCalls: Array<{ url: string; target: string }> }).__openCalls ?? []);
}

/** A dynamic text field carrying a hyperlink (linkUrl + linkTarget). */
function makeLinkDoc(): unknown {
  return {
    id: 'link-doc',
    properties: {
      width: 550, height: 400, frameRate: 12,
      backgroundColor: '#ffffff', rulerUnits: 'px',
      grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
      guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
    },
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: {
        layers: [{
          id: 'layer-Layer 1', name: 'Layer 1', type: 'normal',
          visible: true, locked: false, outlineMode: false,
          outlineColor: '#ff0000', height: 20, parentFolderId: null,
          frameCount: 1,
          frames: [{
            index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '', sound: null,
            motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [{
              id: 'text-1', type: 'text',
              x: 40, y: 160,
              width: 470, height: 80,
              text: 'CLICK THIS LINK NOW',
              textType: 'dynamic',
              fontFamily: 'Arial',
              fontSize: 40,
              bold: true, italic: false,
              color: { r: 0, g: 0, b: 0, a: 255 },
              align: 'left',
              multiline: false, wordWrap: false,
              linkUrl: 'http://example.com/clicked',
              linkTarget: '_blank',
            }],
          }],
        }],
      },
    }],
    library: { items: [], folders: [] },
  };
}

test.describe('Text hyperlink oracle (Ruffle)', () => {
  test.skip(!!process.env.CI, 'Skip Ruffle oracle in CI until Ruffle CI setup complete');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const ready = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(ready).toBe(true);
  });

  test('clicking a linked text field navigates via window.open(url, target)', async ({ page }, testInfo: TestInfo) => {
    await loadDoc(page, makeLinkDoc());
    const swf = await publish(page);

    await ensureRuffle(page);
    await injectPlayer(page, swf);
    await page.waitForTimeout(2000);

    // The linked text must actually render (not blank) before we trust the click.
    const shot = await screenshotPlayer(page);
    testInfo.attach('linked-text', { body: shot, contentType: 'image/png' });
    const inkRows = findInkRows(shot);
    expect(darkPixelCount(shot)).toBeGreaterThan(200);

    // Focus the player (required for input to reach AVM1 / hit-testing), then
    // click squarely on the link ink. Drive clicks across a grid of positions
    // spanning the rendered glyph band to be robust to font metrics.
    const player = page.locator(`#${PLAYER_ID}`);
    await player.click({ position: { x: 80, y: inkRows.midY } });
    await page.waitForTimeout(300);
    let calls = await getOpenCalls(page);
    if (calls.length === 0) {
      for (const y of [inkRows.midY - 8, inkRows.midY, inkRows.midY + 8]) {
        for (const x of [60, 100, 140, 180, 220, 260, 300]) {
          await player.click({ position: { x, y } });
          await page.waitForTimeout(80);
          calls = await getOpenCalls(page);
          if (calls.length > 0) break;
        }
        if (calls.length > 0) break;
      }
    }

    testInfo.attach('open-calls', { body: JSON.stringify(calls, null, 2), contentType: 'application/json' });

    expect(calls.length).toBeGreaterThan(0);
    const hit = calls.find((c) => c.url.includes('example.com/clicked'));
    expect(hit, `window.open was called but not with our URL: ${JSON.stringify(calls)}`).toBeTruthy();
    expect(hit!.target).toBe('_blank');
  });
});
