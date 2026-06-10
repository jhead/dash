/**
 * Bitmap rendering oracle (task 0723).
 *
 * Verifies that a bitmap imported into the library (as a dataUri PNG) renders as
 * visible pixels in Ruffle after the SWF is published.
 *
 * Strategy:
 *   1. Build a FlashDocument with a BitmapItem whose dataUri is a solid-red 20×20 PNG.
 *   2. Place a BitmapDisplayObject referencing that library item on the stage.
 *   3. Publish to SWF via the __flashTest bridge (calls compileDocument(doc)).
 *      This path emits DefineBitsJPEG2 (tag 21) + DefineShape4 bitmap fill + PlaceObject2.
 *   4. Load the SWF in a Ruffle player injected into the page.
 *   5. Screenshot the player and count red pixels.
 *
 * Acceptance criterion: the Ruffle screenshot contains a meaningful number of red
 * pixels — proving that DefineBitsJPEG2 + bitmap fill + PlaceObject2 round-trips
 * correctly and Ruffle renders the bitmap as visible colour.
 *
 * Requires the Vite dev server (port 1420) and Ruffle served at /ruffle/.
 * Skipped in CI until Ruffle CI infrastructure is in place.
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Solid red 20×20 PNG encoded as a data URI.
//
// Generated once offline with Node's built-in zlib; included inline so the
// test has no file-system dependency.  The image is exactly 20×20 RGB pixels
// all set to #ff0000.
// ---------------------------------------------------------------------------
const RED_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAG0lEQVR4nGP4z8BANiJf' +
  '56jmUc2jmkc1U0UzADHNjoAymaoJAAAAAElFTkSuQmCC';

const RED_PNG_DATA_URI = `data:image/png;base64,${RED_PNG_BASE64}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count pixels that are distinctly red (high R, low G, low B, opaque).
 * Returns { red, total }.
 */
function countRedPixels(buf: Buffer): { red: number; total: number } {
  const img = PNG.sync.read(buf);
  let red = 0;
  const total = img.width * img.height;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const a = img.data[i + 3];
    // Pixel is "red" if R is high, G and B are low, and pixel is mostly opaque.
    if (a > 128 && r > 180 && g < 80 && b < 80) red++;
  }
  return { red, total };
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
 * player.  Mirrors the structure from text-rendering.spec.ts.
 */
async function captureRuffleScreenshot(
  page: Parameters<Parameters<typeof test>[1]>[0]
): Promise<Buffer> {
  const swfBase64: string = await page.evaluate(() => {
    return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
  });

  // Ensure ruffle.js is loaded
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

  // Inject a Ruffle player, load the SWF, and wait for first render.
  await page.evaluate((b64) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & { ruffle(): { load(opts: { data?: Uint8Array }): Promise<void> } };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = '__ruffle_bitmap_player__';
    player.style.cssText =
      'position:fixed;top:0;left:0;width:550px;height:400px;pointer-events:none;z-index:99999';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({ data: bytes });
  }, swfBase64);

  await page.waitForTimeout(2000);

  const shot = await page.locator('#__ruffle_bitmap_player__').screenshot();

  await page.evaluate(() => {
    const el = document.getElementById('__ruffle_bitmap_player__');
    if (el) el.remove();
  });

  return shot;
}

/**
 * Build a single-frame FlashDocument with one BitmapDisplayObject referencing a
 * BitmapItem whose dataUri is the provided PNG data URI.
 *
 * The bitmap is placed at (100, 100) at its natural 20×20 size, well within the
 * 550×400 stage so it is clearly visible.
 */
function makeBitmapDoc(pngDataUri: string): unknown {
  return {
    id: 'bitmap-render-doc',
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
              id: 'bmp-obj-1',
              type: 'bitmap',
              libraryItemId: 'bitmap-item-1',
              x: 100,
              y: 100,
              width: 20,
              height: 20,
            }],
          }],
        }],
      },
    }],
    library: {
      items: [{
        id: 'bitmap-item-1',
        name: 'test-bitmap.png',
        itemType: 'bitmap',
        dataUri: pngDataUri,
        originalWidth: 20,
        originalHeight: 20,
        allowSmoothing: false,
        compressionType: 'lossless',
        quality: 100,
      }],
      folders: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Bitmap rendering oracle (Ruffle)', () => {
  test.skip(!!process.env.CI, 'Skip Ruffle oracle in CI until Ruffle CI setup complete');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  test('bitmap imported to library renders as visible pixels in Ruffle', async ({ page }, testInfo: TestInfo) => {
    // 1. Load a document with a solid-red PNG bitmap in the library
    await loadDoc(page, makeBitmapDoc(RED_PNG_DATA_URI));

    // 2. Publish and render in Ruffle
    const shot = await captureRuffleScreenshot(page);
    const { red, total } = countRedPixels(shot);

    testInfo.attach('ruffle-bitmap', { body: shot, contentType: 'image/png' });

    // 3. The 20×20 bitmap placed at 100,100 must produce red pixels in the screenshot.
    //    At 550×400 stage size, the 20×20 bitmap covers 400 pixels; require at least
    //    50 to account for JPEG compression rounding and any Ruffle scaling.
    //    An absent / broken bitmap renders as nothing (red=0 against white background).
    expect(red).toBeGreaterThan(50);

    // Sanity: less than half the stage should be red (the bitmap is small)
    expect(red / total).toBeLessThan(0.5);
  });
});
