/**
 * Color effect visual oracle (task 0786): prove that SWFs with CXFormWithAlpha
 * color effects (alpha, tint, brightness) render correctly in Ruffle.
 *
 * Per CLAUDE.md: "byte-presence unit tests are not runtime proof." The existing
 * cxform unit tests confirm CXFormWithAlpha bytes are encoded correctly, but
 * this suite adds the runtime gate: Ruffle must actually apply the color transform
 * and render visually distinguishable pixels.
 *
 * Three tests:
 *
 *   1. Alpha effect (50%) — a red symbol at 50% alpha; the screenshot must have
 *      some non-white pixels (rect is partially visible through transparency).
 *
 *   2. Tint effect (100% blue) — a red symbol with 100% blue tint; the
 *      screenshot must have blue-ish pixels (not the original red).
 *
 *   3. Brightness effect (50%) — a red symbol with 50% brightness; the result
 *      must be darker than the original red (lower red channel average).
 *
 * Each test:
 *   - Builds a FlashDocument with a movieclip symbol containing a red rectangle.
 *   - Places a SymbolInstance on the main timeline with a colorEffect field.
 *   - Publishes via the __flashTest bridge.
 *   - Loads the SWF in a Ruffle player injected into the page.
 *   - Screenshots and asserts pixel colours match expectations.
 *
 * Run locally:
 *   pnpm --filter @flash/desktop e2e --grep "color effect"
 *   cd apps/desktop && npx playwright test e2e/color-effect.spec.ts
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Helpers
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

/** Remove the Ruffle player from the DOM. */
async function removeRufflePlayer(page: Page, playerId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, playerId);
}

/**
 * Count pixels that differ significantly from pure white (255, 255, 255).
 */
function countNonWhitePixels(buf: Buffer): number {
  const img = PNG.sync.read(buf);
  let nonWhite = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    const a = img.data[i + 3]!;
    if (a < 10) continue; // skip transparent
    if (r < 240 || g < 240 || b < 240) nonWhite++;
  }
  return nonWhite;
}

/** Count blue-ish pixels (high B, low R+G). */
function countBluishPixels(buf: Buffer): number {
  const img = PNG.sync.read(buf);
  let blue = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    const a = img.data[i + 3]!;
    if (a < 10) continue;
    // Blue-ish: high B channel, lower R and G
    if (b > 150 && r < 150 && g < 150) blue++;
  }
  return blue;
}

/**
 * Compute average red channel value over non-white, non-transparent pixels
 * in a region of the image. Used to compare brightness levels.
 */
function averageRedInRegion(buf: Buffer, x0: number, y0: number, x1: number, y1: number): number {
  const img = PNG.sync.read(buf);
  let sum = 0;
  let count = 0;
  for (let py = y0; py < Math.min(y1, img.height); py++) {
    for (let px = x0; px < Math.min(x1, img.width); px++) {
      const i = (py * img.width + px) * 4;
      const r = img.data[i]!;
      const g = img.data[i + 1]!;
      const b = img.data[i + 2]!;
      const a = img.data[i + 3]!;
      if (a < 10) continue;
      // Only include pixels that have some colour (not near-white background)
      if (r > 100 || g > 100 || b > 100) {
        sum += r;
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 255;
}

// ---------------------------------------------------------------------------
// Document fixture builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal FlashDocument containing:
 *  - A library MovieClip symbol with a 100×100 red filled rectangle at (0,0).
 *  - A SymbolInstance placed at (225, 150) on the main timeline with the given
 *    colorEffect applied to it.
 *
 * The colorEffect is the core of what we're testing: it gets encoded as a
 * CXFormWithAlpha record in PlaceObject2 by compile.ts.
 */
function makeColorEffectDoc(opts: {
  docId: string;
  symbolId: string;
  instId: string;
  colorEffect: {
    type: 'alpha' | 'tint' | 'brightness' | 'none';
    alpha?: number;
    tintColor?: string;
    tintAmount?: number;
    brightness?: number;
  };
}): unknown {
  const { docId, symbolId, instId, colorEffect } = opts;

  // The symbol's own shape: a 100×100 solid red rectangle.
  const symbolShape = {
    id: `${docId}-sym-shape`,
    type: 'shape',
    shape: {
      id: `shape-${docId}-sym`,
      paths: [{
        start: { x: 0, y: 0 },
        segments: [
          { type: 'line', to: { x: 100, y: 0 } },
          { type: 'line', to: { x: 100, y: 100 } },
          { type: 'line', to: { x: 0, y: 100 } },
        ],
        closed: true,
        fill: { type: 'solid', color: { r: 255, g: 0, b: 0, a: 255 } },
      }],
    },
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  };

  // The library symbol (movieclip) containing the red rectangle.
  const librarySymbol = {
    id: symbolId,
    name: 'RedBox',
    itemType: 'symbol',
    symbolType: 'movieclip',
    linkage: {
      exportForActionScript: false,
      exportInFirstFrame: false,
      linkageIdentifier: '',
      className: '',
      exportForRuntimeSharing: false,
      importForRuntimeSharing: false,
      sharedUrl: '',
    },
    scale9Grid: null,
    timeline: {
      layers: [{
        id: `${symbolId}-layer`,
        name: 'Layer 1',
        type: 'normal',
        visible: true,
        locked: false,
        outlineMode: false,
        outlineColor: '#ff0000',
        height: 20,
        parentFolderId: null,
        frameCount: 1,
        frames: [{
          index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
          label: '', labelType: 'name', script: '', sound: null,
          motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
          motionOrientToPath: false, motionSync: false, motionScale: false,
          shapeEase: 0, shapeBlend: 'distributive',
          displayObjects: [symbolShape],
        }],
      }],
    },
  };

  // The SymbolInstance on the main timeline referencing our movieclip.
  // The colorEffect here is what gets encoded as CXFormWithAlpha in compile.ts.
  const instance = {
    id: instId,
    type: 'instance',
    symbolId,
    x: 225,
    y: 150,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    colorEffect,
  };

  return {
    id: docId,
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
          id: `${docId}-layer`,
          name: 'Layer 1',
          type: 'normal',
          visible: true,
          locked: false,
          outlineMode: false,
          outlineColor: '#ff0000',
          height: 20,
          parentFolderId: null,
          frameCount: 1,
          frames: [{
            index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '', sound: null,
            motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [instance],
          }],
        }],
      },
    }],
    library: {
      items: [librarySymbol],
      folders: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Oracle runner
// ---------------------------------------------------------------------------

/**
 * Shared Ruffle loading + screenshot oracle for color effect tests.
 * Returns the screenshot buffer so each test can run its specific pixel checks.
 */
async function runColorEffectOracle(opts: {
  page: Page;
  testInfo: TestInfo;
  doc: unknown;
  playerId: string;
  label: string;
}): Promise<Buffer> {
  const { page, testInfo, doc, playerId, label } = opts;

  await page.evaluate((d) => {
    (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
  }, doc);
  await page.waitForTimeout(300);

  const swfBase64: string = await page.evaluate(() => {
    return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
  });

  expect(typeof swfBase64, `${label}: publish() must return a string`).toBe('string');
  expect(swfBase64.length, `${label}: publish() must return non-empty SWF`).toBeGreaterThan(0);

  await ensureRuffleLoaded(page);
  await injectRufflePlayer(page, swfBase64, playerId);

  // Wait for Ruffle to render the first frame
  await page.waitForTimeout(2000);

  await hideRuffleOverlays(page, playerId);

  const shot = await page.locator(`#${playerId}`).screenshot();
  await testInfo.attach(`${label}-screenshot`, { body: shot, contentType: 'image/png' });

  await removeRufflePlayer(page, playerId);

  return shot;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Color effect visual oracle: CXFormWithAlpha renders in Ruffle (task 0786)', () => {
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
  // Test 1: Alpha effect (50%)
  //
  // A red rectangle inside a movieclip with 50% alpha (alpha: 50).
  // The CXFormWithAlpha encodes alphaMult = 128 (50% of 256).
  // The stage has a white background, so a 50%-transparent red rect will render
  // as a pinkish colour — NOT pure white and NOT full red.
  //
  // Assert: the screenshot contains non-white pixels (rect is partially visible).
  // -------------------------------------------------------------------------
  test('Alpha effect (50%) — symbol is partially visible, stage is non-blank', async ({ page }, testInfo: TestInfo) => {
    const doc = makeColorEffectDoc({
      docId: 'ce-alpha-doc',
      symbolId: 'sym-alpha-box',
      instId: 'inst-alpha-1',
      colorEffect: { type: 'alpha', alpha: 50 },
    });

    const shot = await runColorEffectOracle({
      page, testInfo, doc,
      playerId: '__ruffle_ce_alpha__',
      label: 'alpha-50pct',
    });

    const nonWhite = countNonWhitePixels(shot);
    console.log(`[0786] alpha-50pct: nonWhitePixels=${nonWhite}`);

    // A 100×100 rect placed at (225,150) in a 550×400 stage. Even accounting for
    // Ruffle scaling the player to fill 550×400, there should be many non-white
    // pixels from the partially transparent (pinkish) rectangle.
    expect(nonWhite, 'alpha effect: stage must have non-white pixels (partially visible rect)').toBeGreaterThan(500);
  });

  // -------------------------------------------------------------------------
  // Test 2: Tint effect (100% blue)
  //
  // A red rectangle inside a movieclip with 100% blue tint (#0000ff, tintAmount: 100).
  // The CXFormWithAlpha encodes: redMult=0, greenMult=0, blueMult=0 (suppress
  // original colour) + redAdd=0, greenAdd=0, blueAdd=255 (inject full blue).
  // The rendered pixels should be blue, NOT the original red.
  //
  // Assert: the screenshot contains blue-ish pixels.
  // -------------------------------------------------------------------------
  test('Tint effect (100% blue) — symbol renders as blue, not original red', async ({ page }, testInfo: TestInfo) => {
    const doc = makeColorEffectDoc({
      docId: 'ce-tint-doc',
      symbolId: 'sym-tint-box',
      instId: 'inst-tint-1',
      colorEffect: { type: 'tint', tintColor: '#0000ff', tintAmount: 100 },
    });

    const shot = await runColorEffectOracle({
      page, testInfo, doc,
      playerId: '__ruffle_ce_tint__',
      label: 'tint-100pct-blue',
    });

    const blue = countBluishPixels(shot);
    console.log(`[0786] tint-100pct-blue: bluishPixels=${blue}`);

    // With 100% blue tint the entire 100×100 rect should render solid blue.
    // In Ruffle's 550×400 viewport that area may be scaled, but there should
    // be many distinctly blue pixels.
    expect(blue, 'tint effect: stage must have blue pixels (100% blue tint applied)').toBeGreaterThan(200);
  });

  // -------------------------------------------------------------------------
  // Test 3: Brightness effect (-50%, i.e. darkening)
  //
  // A red rectangle inside a movieclip with -50% brightness (darkened).
  //
  // Flash brightness formula from cxform.ts:
  //   b = -0.5 (negative = darken)
  //   mult = round((1 - |-0.5|) * 256) = round(0.5 * 256) = 128
  //   add  = round(max(0, -0.5) * 255) = 0   (no add for negative brightness)
  //
  // For the red channel: 255 * 128/256 + 0 = 128 → dark red (~128).
  // The stage is white (#ffffff). Dark red is clearly non-white and distinctly
  // darker than full red (255). Sample the whole stage: many non-white pixels
  // and average red in the rect region should be well below 200.
  //
  // Assert: avg red in the rect area is < 200 (rect is darkened, not full red).
  // -------------------------------------------------------------------------
  test('Brightness effect (-50%) — symbol renders darker than full red', async ({ page }, testInfo: TestInfo) => {
    const doc = makeColorEffectDoc({
      docId: 'ce-brightness-doc',
      symbolId: 'sym-brightness-box',
      instId: 'inst-brightness-1',
      colorEffect: { type: 'brightness', brightness: -50 },
    });

    const shot = await runColorEffectOracle({
      page, testInfo, doc,
      playerId: '__ruffle_ce_brightness__',
      label: 'brightness-neg50pct',
    });

    // The rect is placed at (225, 150) in a 550×400 stage.
    // Ruffle fills the 550×400 player at 1:1, so sample the rect region.
    // With -50% brightness: R channel = ~128, G = ~0, B = ~0 (dark red).
    const avgRed = averageRedInRegion(shot, 225, 150, 325, 250);
    const nonWhite = countNonWhitePixels(shot);
    console.log(`[0786] brightness-neg50pct: nonWhitePixels=${nonWhite} avgRedInRect=${avgRed.toFixed(1)}`);

    // Stage must have non-white pixels (rect is visible as dark red)
    expect(nonWhite, 'brightness effect: stage must have non-white pixels').toBeGreaterThan(500);

    // The average red in the rect area must be well below 220.
    // -50% brightness on red = mult=128 → result ≈ 128 (dark red).
    // We allow a generous range (< 200) to account for Ruffle anti-aliasing.
    expect(avgRed, 'brightness effect: avg red in rect region must be < 200 (darker than full red 255)').toBeLessThan(200);
  });
});
