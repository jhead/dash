/**
 * Mask layer visual oracle E2E (task 0787): prove that a SWF with mask/masked
 * layer pairs renders correctly in Ruffle.
 *
 * Per CLAUDE.md: "byte-presence unit tests are not runtime proof." The existing
 * masklayer.test.ts confirms HasClipDepth is emitted with correct byte layout.
 * mask-renderer.test.ts confirms the CanvasRenderer clip path logic. This suite
 * adds the runtime gate: a Ruffle player must load the SWF, clip the masked
 * content to the mask shape, and produce visible pixels ONLY inside the mask
 * region.
 *
 * Two tests:
 *
 *   1. Basic mask — a blue filled rectangle (masked) revealed only through a
 *      rectangular mask in the left half of the stage. Pixels inside the mask
 *      area should be blue; pixels in the right half should be white.
 *
 *   2. Mask bounds check — mask is in the top-left quadrant. Asserts blue pixels
 *      in the top-left and no blue pixels in the bottom-right.
 *
 * Layer ordering for the fixture (per masklayer.test.ts comment, confirmed by
 * compile.ts prepass logic):
 *   layers[0] = type:'mask'   (mask shape — clipping region)
 *   layers[1] = type:'masked' (content to be clipped — blue rect covering stage)
 *
 * SWF depth rule: mask layer (li=0) gets the lower depth number; masked layer
 * (li=1) gets the higher depth number. The PlaceObject2 with HasClipDepth uses
 * clipDepth = max depth of masked layer objects. A PlaceObject2 at depth D with
 * clipDepth C clips all objects at depths D+1..C.
 *
 * Run locally:
 *   pnpm --filter @flash/desktop e2e --grep "mask"
 *   cd apps/desktop && npx playwright test e2e/mask-layer.spec.ts
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Helpers (mirrors sound-roundtrip.spec.ts)
// ---------------------------------------------------------------------------

type Page = Parameters<Parameters<typeof test>[1]>[0];

/** Ensure ruffle.js is loaded in the page (idempotent). */
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

/** Inject a Ruffle player element, load the SWF bytes, and wait for first render. */
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
    // Must be on-screen (top:0; left:0) for Chromium to composite correctly.
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;z-index:99999;';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    // autoplay:'on' forces play() without a user-gesture audio context.
    // unmuteOverlay:'hidden' suppresses the audio unmute overlay dimming backdrop.
    void player.ruffle().load({
      data: bytes,
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
    });
  }, { b64: swfBase64, id: playerId });
}

/** Recursively hide Ruffle's overlay chrome (hardware-accel warning, panic overlay etc.). */
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

/** Check if a "panic" overlay is visible inside the Ruffle player's shadow DOM. */
async function hasRufflePanic(page: Page, playerId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const root = document.getElementById(id) as (HTMLElement & { shadowRoot?: ShadowRoot }) | null;
    const sr = root?.shadowRoot;
    if (!sr) return false;
    let found = false;
    const walk = (node: ParentNode) => {
      node.querySelectorAll('*').forEach((elem) => {
        const e = elem as HTMLElement & { shadowRoot?: ShadowRoot };
        const sig = `${e.id} ${e.className}`.toLowerCase();
        if (/panic/.test(sig)) {
          const style = getComputedStyle(e);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            found = true;
          }
        }
        if (e.shadowRoot) walk(e.shadowRoot);
      });
    };
    walk(sr);
    return found;
  }, playerId);
}

/** Remove the Ruffle player from the DOM. */
async function removeRufflePlayer(page: Page, playerId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, playerId);
}

// ---------------------------------------------------------------------------
// Pixel analysis helpers
// ---------------------------------------------------------------------------

/** Count non-white pixels (any channel < 240). Skips transparent pixels. */
function countNonWhitePixels(buf: Buffer): number {
  const img = PNG.sync.read(buf);
  let count = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    const a = img.data[i + 3]!;
    if (a < 10) continue;
    if (r < 240 || g < 240 || b < 240) count++;
  }
  return count;
}

/**
 * Count blue pixels: high blue channel, low red and green.
 * Threshold chosen to match a pure #0000ff fill through Ruffle rendering.
 */
function countBluePixels(buf: Buffer): number {
  const img = PNG.sync.read(buf);
  let count = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    const a = img.data[i + 3]!;
    if (a < 10) continue;
    if (b > 150 && r < 100 && g < 100) count++;
  }
  return count;
}

/**
 * Count blue pixels in a specific rectangular region of the image.
 * Coordinates are in CSS pixels (0-based, top-left origin).
 */
function countBluePixelsInRegion(
  buf: Buffer,
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number
): number {
  const img = PNG.sync.read(buf);
  let count = 0;
  for (let py = regionY; py < regionY + regionH && py < img.height; py++) {
    for (let px = regionX; px < regionX + regionW && px < img.width; px++) {
      const i = (py * img.width + px) * 4;
      const r = img.data[i]!;
      const g = img.data[i + 1]!;
      const b = img.data[i + 2]!;
      const a = img.data[i + 3]!;
      if (a < 10) continue;
      if (b > 150 && r < 100 && g < 100) count++;
    }
  }
  return count;
}

/**
 * Count white pixels (all channels >= 230) in a specific rectangular region.
 */
function countWhitePixelsInRegion(
  buf: Buffer,
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number
): number {
  const img = PNG.sync.read(buf);
  let count = 0;
  for (let py = regionY; py < regionY + regionH && py < img.height; py++) {
    for (let px = regionX; px < regionX + regionW && px < img.width; px++) {
      const i = (py * img.width + px) * 4;
      const r = img.data[i]!;
      const g = img.data[i + 1]!;
      const b = img.data[i + 2]!;
      const a = img.data[i + 3]!;
      if (a < 10) continue;
      if (r >= 230 && g >= 230 && b >= 230) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Fixture document builders
// ---------------------------------------------------------------------------

/**
 * Common document properties (550×400, white background, 12fps).
 */
const BASE_PROPS = {
  width: 550, height: 400, frameRate: 12,
  backgroundColor: '#ffffff', rulerUnits: 'px',
  grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
  guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
};

/**
 * Build a shape display object (filled rectangle at the given coordinates).
 */
function makeRectShape(
  objId: string,
  x1: number, y1: number,
  x2: number, y2: number,
  r: number, g: number, b: number
) {
  return {
    id: objId, type: 'shape',
    shape: {
      id: `shape-${objId}`,
      paths: [{
        start: { x: x1, y: y1 },
        segments: [
          { type: 'line', to: { x: x2, y: y1 } },
          { type: 'line', to: { x: x2, y: y2 } },
          { type: 'line', to: { x: x1, y: y2 } },
        ],
        closed: true,
        fill: { type: 'solid', color: { r, g, b, a: 255 } },
      }],
    },
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  };
}

/**
 * Build a minimal 1-frame FlashDocument with:
 *   - Layer 0 (type:'mask')   — a rectangular clip shape
 *   - Layer 1 (type:'masked') — a blue rectangle covering the full stage
 *
 * The mask shape only covers part of the stage, so only pixels within the mask
 * region should be blue; everything outside should be white (background).
 *
 * Layer ordering: layers[0]=mask, layers[1]=masked. This matches the convention
 * documented in masklayer.test.ts and required by compile.ts's depth pre-pass:
 * the mask layer (li=0) gets a lower depth; masked (li=1) gets a higher depth.
 * The PlaceObject2 HasClipDepth at the mask's depth clips up to the masked depth.
 */
function makeMaskDoc(opts: {
  docId: string;
  // Mask shape bounds (the clip window)
  maskX1: number; maskY1: number; maskX2: number; maskY2: number;
  // Masked content bounds (the blue rect to be clipped)
  contentX1: number; contentY1: number; contentX2: number; contentY2: number;
}): unknown {
  const {
    docId,
    maskX1, maskY1, maskX2, maskY2,
    contentX1, contentY1, contentX2, contentY2,
  } = opts;

  return {
    id: docId,
    properties: BASE_PROPS,
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: {
        layers: [
          // Layer 0: mask layer — clip shape (white rect, fill color is irrelevant for masking)
          {
            id: `${docId}-mask-layer`,
            name: 'Mask',
            type: 'mask',
            visible: true, locked: false, outlineMode: false,
            outlineColor: '#ff0000', height: 20, parentFolderId: null,
            frameCount: 1,
            frames: [{
              index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
              label: '', labelType: 'name', script: '', sound: null,
              motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
              motionOrientToPath: false, motionSync: false, motionScale: false,
              shapeEase: 0, shapeBlend: 'distributive',
              displayObjects: [
                makeRectShape(`${docId}-mask-rect`, maskX1, maskY1, maskX2, maskY2, 255, 0, 0),
              ],
            }],
          },
          // Layer 1: masked layer — blue rectangle (clipped content)
          {
            id: `${docId}-masked-layer`,
            name: 'Masked',
            type: 'masked',
            visible: true, locked: false, outlineMode: false,
            outlineColor: '#0000ff', height: 20, parentFolderId: null,
            frameCount: 1,
            frames: [{
              index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
              label: '', labelType: 'name', script: '', sound: null,
              motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
              motionOrientToPath: false, motionSync: false, motionScale: false,
              shapeEase: 0, shapeBlend: 'distributive',
              displayObjects: [
                makeRectShape(`${docId}-blue-rect`, contentX1, contentY1, contentX2, contentY2, 0, 0, 255),
              ],
            }],
          },
        ],
      },
    }],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Mask layer visual oracle: clip mask verified in Ruffle (task 0787)', () => {
  test.skip(!!process.env.CI, 'visual oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 1: Basic mask — left-half mask window
  //
  // Setup:
  //   - Mask layer:   rect covering left half of stage (0,0)→(275,400)
  //   - Masked layer: blue rect covering full stage (0,0)→(550,400)
  //
  // Expected result in Ruffle:
  //   - Left half:  blue (mask window is open → blue content shows through)
  //   - Right half: white (mask closed → background shows, no blue)
  // -------------------------------------------------------------------------
  test('basic mask — left-half mask reveals blue content, right half is white', async ({ page }, testInfo: TestInfo) => {
    const doc = makeMaskDoc({
      docId: 'mask-basic-doc',
      // Mask covers left half of stage
      maskX1: 0, maskY1: 0, maskX2: 275, maskY2: 400,
      // Masked content: blue rect covering entire stage
      contentX1: 0, contentY1: 0, contentX2: 550, contentY2: 400,
    });

    await page.evaluate((d) => {
      (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
    }, doc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    expect(typeof swfBase64).toBe('string');
    expect(swfBase64.length).toBeGreaterThan(0);

    const playerId = '__ruffle_mask_basic__';
    await ensureRuffleLoaded(page);
    await injectRufflePlayer(page, swfBase64, playerId);

    // Wait for Ruffle to render the first frame
    await page.waitForTimeout(2000);

    // Check panic BEFORE hiding overlays
    const panic = await hasRufflePanic(page, playerId);
    console.log(`[0787] basic-mask: panic=${panic}`);

    await hideRuffleOverlays(page, playerId);

    const shot = await page.locator(`#${playerId}`).screenshot();
    await testInfo.attach('basic-mask-screenshot', { body: shot, contentType: 'image/png' });

    await removeRufflePlayer(page, playerId);

    // Assert 1: no Ruffle panic
    expect(panic, 'basic-mask: Ruffle must not show a panic overlay').toBe(false);

    // Assert 2: stage is non-blank
    const nonWhite = countNonWhitePixels(shot);
    console.log(`[0787] basic-mask: nonWhitePixels=${nonWhite}`);
    expect(nonWhite, 'basic-mask: stage must be non-blank').toBeGreaterThan(500);

    // Assert 3: blue pixels exist in the left half (mask is open there)
    // Ruffle player renders at 550×400 CSS pixels; sample the left-center column.
    const blueInLeft = countBluePixelsInRegion(shot, 50, 100, 150, 200);
    console.log(`[0787] basic-mask: bluePixelsInLeft=${blueInLeft}`);
    expect(blueInLeft, 'basic-mask: left half (inside mask) must have blue pixels').toBeGreaterThan(100);

    // Assert 4: no blue pixels in the right half (mask is closed there)
    // Sample the right-center area — well away from the mask edge.
    const blueInRight = countBluePixelsInRegion(shot, 350, 100, 150, 200);
    console.log(`[0787] basic-mask: bluePixelsInRight=${blueInRight}`);
    expect(blueInRight, 'basic-mask: right half (outside mask) must have no blue pixels').toBeLessThan(50);

    // Assert 5: white pixels exist in the right half (background is visible outside mask)
    const whiteInRight = countWhitePixelsInRegion(shot, 350, 100, 150, 200);
    console.log(`[0787] basic-mask: whitePixelsInRight=${whiteInRight}`);
    expect(whiteInRight, 'basic-mask: right half (outside mask) must show white background').toBeGreaterThan(100);
  });

  // -------------------------------------------------------------------------
  // Test 2: Mask bounds check — top-left quadrant mask
  //
  // Setup:
  //   - Mask layer:   rect covering only the top-left quadrant (0,0)→(200,150)
  //   - Masked layer: blue rect covering full stage (0,0)→(550,400)
  //
  // Expected result in Ruffle:
  //   - Top-left area (inside mask): blue pixels present
  //   - Bottom-right area (outside mask): white — no blue pixels
  //
  // This tests that masking is precisely bounded and doesn't bleed to other
  // quadrants, confirming that ClipDepth is encoded correctly and Ruffle
  // honours the HasClipDepth flag.
  // -------------------------------------------------------------------------
  test('mask bounds check — top-left quadrant mask clips blue to that region only', async ({ page }, testInfo: TestInfo) => {
    const doc = makeMaskDoc({
      docId: 'mask-bounds-doc',
      // Mask covers only the top-left quadrant
      maskX1: 0, maskY1: 0, maskX2: 200, maskY2: 150,
      // Masked content: blue rect covering the entire stage
      contentX1: 0, contentY1: 0, contentX2: 550, contentY2: 400,
    });

    await page.evaluate((d) => {
      (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
    }, doc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    expect(typeof swfBase64).toBe('string');
    expect(swfBase64.length).toBeGreaterThan(0);

    const playerId = '__ruffle_mask_bounds__';
    await ensureRuffleLoaded(page);
    await injectRufflePlayer(page, swfBase64, playerId);

    await page.waitForTimeout(2000);

    const panic = await hasRufflePanic(page, playerId);
    console.log(`[0787] mask-bounds: panic=${panic}`);

    await hideRuffleOverlays(page, playerId);

    const shot = await page.locator(`#${playerId}`).screenshot();
    await testInfo.attach('mask-bounds-screenshot', { body: shot, contentType: 'image/png' });

    await removeRufflePlayer(page, playerId);

    // Assert 1: no Ruffle panic
    expect(panic, 'mask-bounds: Ruffle must not show a panic overlay').toBe(false);

    // Assert 2: stage is non-blank
    const nonWhite = countNonWhitePixels(shot);
    console.log(`[0787] mask-bounds: nonWhitePixels=${nonWhite}`);
    expect(nonWhite, 'mask-bounds: stage must be non-blank').toBeGreaterThan(100);

    // Assert 3: blue pixels in the top-left quadrant (inside the mask)
    // Sample a sub-region well within the top-left quadrant to avoid edge effects.
    const blueInTopLeft = countBluePixelsInRegion(shot, 30, 30, 100, 80);
    console.log(`[0787] mask-bounds: bluePixelsInTopLeft=${blueInTopLeft}`);
    expect(blueInTopLeft, 'mask-bounds: top-left quadrant (inside mask) must have blue pixels').toBeGreaterThan(50);

    // Assert 4: no blue pixels in the bottom-right quadrant (outside the mask)
    const blueInBottomRight = countBluePixelsInRegion(shot, 350, 250, 150, 100);
    console.log(`[0787] mask-bounds: bluePixelsInBottomRight=${blueInBottomRight}`);
    expect(blueInBottomRight, 'mask-bounds: bottom-right quadrant (outside mask) must have no blue pixels').toBeLessThan(20);

    // Assert 5: white pixels exist in the bottom-right (background is visible outside mask)
    const whiteInBottomRight = countWhitePixelsInRegion(shot, 350, 250, 150, 100);
    console.log(`[0787] mask-bounds: whitePixelsInBottomRight=${whiteInBottomRight}`);
    expect(whiteInBottomRight, 'mask-bounds: bottom-right quadrant (outside mask) must show white background').toBeGreaterThan(50);
  });
});
