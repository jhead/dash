/**
 * Auto-kern oracle (task 1178).
 *
 * The "Auto kern" text property makes a field apply the embedded font's kerning
 * pairs (e.g. "AV", "To" tighten). This must be VISIBLE in Ruffle: when autoKern
 * is on, the rendered string is horizontally tighter than when it is off.
 *
 * The acceptance criterion is purely runtime: publish two SWFs that differ only
 * in the autoKern flag, render each in Ruffle, and compare the horizontal extent
 * of the rendered ink. The kerned variant must end measurably further left.
 *
 * Requires the Vite dev server (port 1420) and Ruffle served at /ruffle/.
 * Skipped in CI until Ruffle CI infrastructure is in place (same as the visual
 * and text-rendering oracles).
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

/** Rightmost x of any dark (ink) pixel, or -1 if none. Also returns dark count. */
function inkExtent(buf: Buffer): { maxX: number; minX: number; dark: number } {
  const img = PNG.sync.read(buf);
  let maxX = -1;
  let minX = img.width;
  let dark = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i];
      const g = img.data[i + 1];
      const b = img.data[i + 2];
      const a = img.data[i + 3];
      if (a > 128 && r < 120 && g < 120 && b < 120) {
        dark++;
        if (x > maxX) maxX = x;
        if (x < minX) minX = x;
      }
    }
  }
  return { maxX, minX, dark };
}

async function loadDoc(
  page: Parameters<Parameters<typeof test>[1]>[0],
  doc: unknown
): Promise<void> {
  await page.evaluate((d) => {
    (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
  }, doc);
  await page.waitForTimeout(300);
}

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
    player.id = '__ruffle_kern_player__';
    player.style.cssText =
      'position:fixed;top:0;left:0;width:550px;height:400px;pointer-events:none;z-index:99999';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({ data: bytes });
  }, swfBase64);

  await page.waitForTimeout(2000);

  const shot = await page.locator('#__ruffle_kern_player__').screenshot();

  await page.evaluate(() => {
    const el = document.getElementById('__ruffle_kern_player__');
    if (el) el.remove();
  });

  return shot;
}

/** A single dynamic text field full of heavily-kerned pairs. */
function makeKernDoc(autoKern: boolean): unknown {
  // Repeated kerning pairs maximise the cumulative spacing difference so the
  // on/off comparison is unambiguous in a screenshot.
  const text = 'AVAVAVToToToWaWaYoYo';
  return {
    id: 'kern-doc',
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
              x: 20, y: 160,
              width: 510, height: 80,
              text,
              textType: 'dynamic',
              fontFamily: 'Arial',
              fontSize: 40,
              bold: false, italic: false,
              color: { r: 0, g: 0, b: 0, a: 255 },
              align: 'left',
              multiline: false, wordWrap: false,
              ...(autoKern ? { autoKern: true } : {}),
            }],
          }],
        }],
      },
    }],
    library: { items: [], folders: [] },
  };
}

test.describe('Auto-kern oracle (Ruffle)', () => {
  test.skip(!!process.env.CI, 'Skip Ruffle oracle in CI until Ruffle CI setup complete');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  test('autoKern tightens glyph pairs vs. no kerning', async ({ page }, testInfo: TestInfo) => {
    await loadDoc(page, makeKernDoc(false));
    const offShot = await captureRuffleScreenshot(page);
    const off = inkExtent(offShot);
    testInfo.attach('kern-off', { body: offShot, contentType: 'image/png' });

    await loadDoc(page, makeKernDoc(true));
    const onShot = await captureRuffleScreenshot(page);
    const on = inkExtent(onShot);
    testInfo.attach('kern-on', { body: onShot, contentType: 'image/png' });

    // Both must render real ink.
    expect(off.dark).toBeGreaterThan(200);
    expect(on.dark).toBeGreaterThan(200);

    // Kerning pulls glyphs together: the kerned string ends measurably further
    // left than the unkerned one. Left edges (first glyph) should match closely.
    expect(on.maxX).toBeLessThan(off.maxX - 8);
  });
});
