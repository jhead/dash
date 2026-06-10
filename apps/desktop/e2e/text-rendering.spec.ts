/**
 * Text-rendering oracle (task 0702).
 *
 * Verifies that published SWFs contain REAL glyph outlines so embedded text
 * actually renders as visible pixels in Ruffle. Before this fix, DefineFont
 * emitted empty placeholder glyphs and every text field rendered as nothing.
 *
 * The acceptance criterion is purely runtime: build a SWF with a text field,
 * load it in Ruffle, screenshot, and assert that a meaningful number of dark
 * (text-colour) pixels appear over the white background.
 *
 * Requires the Vite dev server (port 1420) and Ruffle served at /ruffle/.
 * Skipped in CI until Ruffle CI infrastructure is in place (same as the visual
 * oracle).
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count "dark" pixels (text ink) in a screenshot. A pixel is considered ink if
 * it is noticeably darker than the white background and reasonably opaque.
 */
function countDarkPixels(buf: Buffer): { dark: number; total: number } {
  const img = PNG.sync.read(buf);
  let dark = 0;
  const total = img.width * img.height;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const a = img.data[i + 3];
    if (a > 128 && r < 120 && g < 120 && b < 120) dark++;
  }
  return { dark, total };
}

/** Load a document into the app via the test bridge. */
async function loadDoc(
  page: Parameters<Parameters<typeof test>[1]>[0],
  doc: unknown
): Promise<void> {
  await page.evaluate((d) => {
    (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
  }, doc);
  await page.waitForTimeout(300);
}

/**
 * Publish the current document and render it in Ruffle, then screenshot the
 * player. Mirrors the visual-oracle bootstrap.
 */
async function captureRuffleScreenshot(
  page: Parameters<Parameters<typeof test>[1]>[0]
): Promise<Buffer> {
  const swfBase64: string = await page.evaluate(() => {
    return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
  });

  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) {
        resolve();
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

  await page.evaluate((b64) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & { ruffle(): { load(opts: { data?: Uint8Array }): Promise<void> } };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = '__ruffle_text_player__';
    player.style.cssText =
      'position:fixed;top:0;left:0;width:550px;height:400px;pointer-events:none;z-index:99999';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({ data: bytes });
  }, swfBase64);

  await page.waitForTimeout(2000);

  const shot = await page.locator('#__ruffle_text_player__').screenshot();

  await page.evaluate(() => {
    const el = document.getElementById('__ruffle_text_player__');
    if (el) el.remove();
  });

  return shot;
}

/** Build a single-frame document containing one text field. */
function makeTextDoc(textType: 'static' | 'dynamic', text: string): unknown {
  return {
    id: 'text-render-doc',
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
              x: 60, y: 160,
              width: 420, height: 80,
              text,
              textType,
              fontFamily: 'Arial',
              fontSize: 48,
              bold: false, italic: false,
              color: { r: 0, g: 0, b: 0, a: 255 },
              align: 'left',
              multiline: false, wordWrap: false,
            }],
          }],
        }],
      },
    }],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Text rendering oracle (Ruffle)', () => {
  test.skip(!!process.env.CI, 'Skip Ruffle oracle in CI until Ruffle CI setup complete');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  test('static text renders as visible pixels in Ruffle', async ({ page }, testInfo: TestInfo) => {
    await loadDoc(page, makeTextDoc('static', 'HELLO'));
    const shot = await captureRuffleScreenshot(page);
    const { dark, total } = countDarkPixels(shot);
    testInfo.attach('ruffle-text', { body: shot, contentType: 'image/png' });

    // Text must produce a meaningful number of ink pixels. "HELLO" at 48px is
    // hundreds–thousands of dark pixels; require a comfortable floor that an
    // empty/placeholder font (0 dark pixels) can never reach.
    expect(dark).toBeGreaterThan(200);
    // Sanity: it should not paint the whole stage black either.
    expect(dark / total).toBeLessThan(0.5);
  });

  test('dynamic text renders as visible pixels in Ruffle', async ({ page }, testInfo: TestInfo) => {
    await loadDoc(page, makeTextDoc('dynamic', 'Flash 8'));
    const shot = await captureRuffleScreenshot(page);
    const { dark } = countDarkPixels(shot);
    testInfo.attach('ruffle-text', { body: shot, contentType: 'image/png' });
    expect(dark).toBeGreaterThan(150);
  });
});
