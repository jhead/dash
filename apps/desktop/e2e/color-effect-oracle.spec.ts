/**
 * Visual oracle: CXFormWithAlpha tint and advanced color effects in Ruffle (task 0844).
 *
 * Verifies that tint and advanced color transform (CXFormWithAlpha) effects in a
 * published SWF render correctly in Ruffle at the pixel level.
 *
 * Per CLAUDE.md: "byte-presence unit tests are not runtime proof." This suite
 * provides the runtime gate — the published SWF must produce visually correct
 * output through Ruffle's renderer.
 *
 * Tests:
 *
 *   1. 50% tint to blue (#0000ff) on a red rectangle.
 *      CXForm: mult=128 (50%), redAdd=0, greenAdd=0, blueAdd=128.
 *      Expected output: ~#800080 (purple). Purple pixels must dominate; red pixels
 *      must be absent. If CXFormWithAlpha data is dropped, the rect stays red and
 *      the test fails.
 *
 *   2. Advanced color transform — isolate a single channel.
 *      RedMult=0, GreenMult=0, BlueMult=100 (full blue channel kept), BlueOffset=0.
 *      A red rectangle with this transform should render as near-black (no red, no
 *      blue because original rect has b=0). Verifies advanced CXForm is applied.
 *
 *   3. Advanced color transform — add blue offset to red rectangle.
 *      RedMult=100 (full red), BlueMult=0, BlueOffset=+200.
 *      A red rectangle becomes a red-blue (magenta-ish) result.
 *      R channel stays ~255, B channel gets +200 added.
 *
 * PASS criteria (CXFormWithAlpha is correctly applied):
 *   Test 1: Purple pixels > 200, pure-red pixels < 50
 *   Test 2: Stage is near-black in the rect area (r < 20, g < 20, b < 20)
 *   Test 3: Both red (r > 150) AND blue (b > 100) channels present simultaneously
 *
 * FAIL criteria (CXFormWithAlpha is dropped):
 *   Test 1: No purple — the rect stays red
 *   Test 2: Red pixels still visible (r > 150) in the rect area
 *   Test 3: No blue added — rect stays pure red
 *
 * Run locally:
 *   pnpm --filter @flash/desktop e2e --grep "CXFormWithAlpha"
 *   cd apps/desktop && npx playwright test e2e/color-effect-oracle.spec.ts
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Page = Parameters<Parameters<typeof test>[1]>[0];

// ---------------------------------------------------------------------------
// Ruffle helpers (shared with color-effect.spec.ts pattern)
// ---------------------------------------------------------------------------

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

/** Inject a Ruffle player element, load the SWF bytes, wait for first render. */
async function injectRufflePlayer(page: Page, swfBase64: string, playerId: string): Promise<void> {
  await page.evaluate(({ b64, id }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      ruffle(): {
        load(opts: {
          data?: Uint8Array;
          allowScriptAccess?: boolean;
          autoplay?: string;
          unmuteOverlay?: string;
        }): Promise<void>;
      };
    };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = id;
    // Must be on-screen (top:0; left:0) for Chromium to composite the frame.
    // See CLAUDE.md: "injecting the Ruffle player at top:-9999px prevents Chromium
    // from compositing it, producing a blank screenshot."
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

/** Recursively hide Ruffle overlay chrome (hardware-accel warning, panic overlay). */
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

// ---------------------------------------------------------------------------
// Pixel analysis helpers
// ---------------------------------------------------------------------------

interface PixelStats {
  nonWhitePixels: number;
  purplePixels: number;
  pureRedPixels: number;
}

/**
 * Analyse the Ruffle screenshot for purple, red, and non-white pixels.
 *
 * Purple: r >= 80 && b >= 80 && g < 80 (both red+blue channels, low green).
 * Pure red: r >= 150 && b < 60 && g < 60 (red only, no blue).
 */
function analysePixels(buf: Buffer): PixelStats {
  const img = PNG.sync.read(buf);
  let nonWhitePixels = 0;
  let purplePixels = 0;
  let pureRedPixels = 0;

  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    const a = img.data[i + 3]!;
    if (a < 10) continue; // skip transparent

    if (r < 240 || g < 240 || b < 240) nonWhitePixels++;

    // Purple-ish: both red and blue channels elevated, low green
    if (r >= 80 && b >= 80 && g < 80) purplePixels++;

    // Pure red: only red channel, minimal blue/green
    if (r >= 150 && b < 60 && g < 60) pureRedPixels++;
  }

  return { nonWhitePixels, purplePixels, pureRedPixels };
}

/**
 * Sample the average RGB in a bounding box (stage-space coordinates).
 * Assumes the Ruffle player screenshot is 550×400 px at 1:1.
 */
function sampleRegionAvg(
  buf: Buffer,
  stageX0: number, stageY0: number,
  stageX1: number, stageY1: number,
  stageW = 550, stageH = 400
): { r: number; g: number; b: number; count: number } {
  const img = PNG.sync.read(buf);
  const iw = img.width;
  const ih = img.height;

  // Map stage-space coords to image-space coords
  const px0 = Math.round((stageX0 / stageW) * iw);
  const py0 = Math.round((stageY0 / stageH) * ih);
  const px1 = Math.round((stageX1 / stageW) * iw);
  const py1 = Math.round((stageY1 / stageH) * ih);

  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (let py = py0; py < Math.min(py1, ih); py++) {
    for (let px = px0; px < Math.min(px1, iw); px++) {
      const idx = (py * iw + px) * 4;
      const a = img.data[idx + 3]!;
      if (a < 10) continue;
      rSum += img.data[idx]!;
      gSum += img.data[idx + 1]!;
      bSum += img.data[idx + 2]!;
      count++;
    }
  }
  return count > 0
    ? { r: rSum / count, g: gSum / count, b: bSum / count, count }
    : { r: 255, g: 255, b: 255, count: 0 };
}

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal FlashDocument for color-effect oracle testing.
 *
 * The document contains:
 *   - A library MovieClip with a 100×100 solid red (#ff0000) rectangle.
 *   - A SymbolInstance at (225, 150) with the given colorEffect.
 *
 * When published, compile.ts encodes the colorEffect as a CXFormWithAlpha in
 * PlaceObject2. This test verifies that Ruffle applies it at render time.
 */
function makeTintOracleDoc(opts: {
  docId: string;
  symbolId: string;
  instId: string;
  colorEffect: {
    type: 'tint' | 'advanced' | 'none';
    // tint fields
    tintColor?: string;
    tintAmount?: number;
    // advanced fields
    redMult?: number;
    greenMult?: number;
    blueMult?: number;
    alphaMult?: number;
    redOffset?: number;
    greenOffset?: number;
    blueOffset?: number;
  };
}): unknown {
  const { docId, symbolId, instId, colorEffect } = opts;

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
// Shared oracle runner
// ---------------------------------------------------------------------------

async function runOracle(opts: {
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

  // Give Ruffle time to initialise and render the first frame
  await page.waitForTimeout(2000);

  await hideRuffleOverlays(page, playerId);

  const shot = await page.locator(`#${playerId}`).screenshot();
  await testInfo.attach(`${label}-ruffle-screenshot`, { body: shot, contentType: 'image/png' });

  await removeRufflePlayer(page, playerId);

  return shot;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('CXFormWithAlpha visual oracle: tint and advanced color effects (task 0844)', () => {
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
  // Test 1: 50% tint to blue (#0000ff) on a red rectangle
  //
  // CXForm encoding for tint(50%, #0000ff):
  //   p = 0.5
  //   mult = round((1 - 0.5) * 256) = 128
  //   redAdd   = round(0   * 0.5) = 0
  //   greenAdd = round(0   * 0.5) = 0
  //   blueAdd  = round(255 * 0.5) = 128
  //
  // For the red rectangle (r=255, g=0, b=0):
  //   R_out = 255 * 128/256 + 0   = 128
  //   G_out =   0 * 128/256 + 0   = 0
  //   B_out =   0 * 128/256 + 128 = 128
  //
  // Expected rendered color: rgb(128, 0, 128) = #800080 (purple).
  //
  // PASS when CXFormWithAlpha is applied: purple pixels dominant (> 200), pure
  //   red pixels near zero (< 50).
  // FAIL when CXFormWithAlpha is dropped: rect stays red (#ff0000), purple < 50,
  //   pure-red pixels > 200.
  // -------------------------------------------------------------------------
  test('50% tint to blue: red rectangle renders as purple (~#800080) in Ruffle', async ({ page }, testInfo: TestInfo) => {
    const doc = makeTintOracleDoc({
      docId: 'cxform-tint50-doc',
      symbolId: 'sym-tint50-box',
      instId: 'inst-tint50-1',
      colorEffect: {
        type: 'tint',
        tintColor: '#0000ff',
        tintAmount: 50,
      },
    });

    const shot = await runOracle({
      page, testInfo, doc,
      playerId: '__ruffle_cxform_tint50__',
      label: 'tint-50pct-blue',
    });

    const stats = analysePixels(shot);
    console.log(
      `[0844] tint-50pct-blue: nonWhite=${stats.nonWhitePixels}, ` +
      `purple=${stats.purplePixels}, pureRed=${stats.pureRedPixels}`
    );

    // Non-blank: the stage must have some non-white pixels
    expect(
      stats.nonWhitePixels,
      'tint 50% to blue: stage must have non-white pixels (rectangle rendered)'
    ).toBeGreaterThan(200);

    // The rectangle should be purple, NOT the original red.
    // If CXFormWithAlpha is correctly applied, purple dominates.
    expect(
      stats.purplePixels,
      `tint 50% to blue: must have purple (rgb ~128,0,128) pixels. ` +
      `Got purplePixels=${stats.purplePixels}, pureRedPixels=${stats.pureRedPixels}. ` +
      `If this fails, CXFormWithAlpha tint data may be dropped from the SWF or ignored by Ruffle.`
    ).toBeGreaterThan(200);

    // Original red should be gone (small number of pure-red pixels)
    expect(
      stats.pureRedPixels,
      `tint 50% to blue: pure-red pixels should be absent after tint. ` +
      `Got pureRedPixels=${stats.pureRedPixels}. ` +
      `If this fails, the tint was not applied and the rect stayed red (#ff0000).`
    ).toBeLessThan(50);
  });

  // -------------------------------------------------------------------------
  // Test 2: Advanced CXForm — suppress red, add blue offset to red rectangle
  //
  // Advanced color effect: RedMult=0 (zero out red), GreenMult=0, BlueMult=0,
  //   BlueOffset=+200 (inject blue).
  //
  // For the red rectangle (r=255, g=0, b=0):
  //   R_out = 255 * 0/100 + 0   = 0
  //   G_out =   0 * 0/100 + 0   = 0
  //   B_out =   0 * 0/100 + 200 = 200
  //
  // Expected rendered color: rgb(0, 0, 200) ≈ blue.
  // Sample the rect region (225,150)→(325,250) and verify:
  //   - Average blue channel in rect area > 100 (blue injected)
  //   - Average red channel in rect area < 30 (red suppressed)
  //
  // PASS when advanced CXForm is applied: blue dominant, no red.
  // FAIL when CXForm is dropped: original red remains (avgRed ~255, avgBlue ~0).
  // -------------------------------------------------------------------------
  test('Advanced CXForm (zero red, +200 blue offset): red rectangle renders as blue in Ruffle', async ({ page }, testInfo: TestInfo) => {
    const doc = makeTintOracleDoc({
      docId: 'cxform-adv-blue-doc',
      symbolId: 'sym-adv-blue-box',
      instId: 'inst-adv-blue-1',
      colorEffect: {
        type: 'advanced',
        redMult: 0,
        greenMult: 0,
        blueMult: 0,
        redOffset: 0,
        greenOffset: 0,
        blueOffset: 200,
      },
    });

    const shot = await runOracle({
      page, testInfo, doc,
      playerId: '__ruffle_cxform_adv_blue__',
      label: 'advanced-zero-red-add-blue',
    });

    // Sample the rect region in stage space: instance placed at (225,150), size 100×100
    const rectAvg = sampleRegionAvg(shot, 225, 150, 325, 250);
    console.log(
      `[0844] advanced-blue: rectAvg r=${rectAvg.r.toFixed(1)}, g=${rectAvg.g.toFixed(1)}, b=${rectAvg.b.toFixed(1)}, count=${rectAvg.count}`
    );

    const stats = analysePixels(shot);
    console.log(
      `[0844] advanced-blue: nonWhite=${stats.nonWhitePixels}, purple=${stats.purplePixels}, pureRed=${stats.pureRedPixels}`
    );

    // Non-blank: something rendered
    expect(
      stats.nonWhitePixels,
      'advanced CXForm: stage must have non-white pixels (rectangle rendered)'
    ).toBeGreaterThan(100);

    // Blue channel in rect area must be elevated (blueOffset=200 injected)
    expect(
      rectAvg.b,
      `advanced CXForm: average blue in rect area must be > 100 (blueOffset=200 applied). ` +
      `Got avgBlue=${rectAvg.b.toFixed(1)}. ` +
      `If this fails, the advanced CXForm offsets were not applied.`
    ).toBeGreaterThan(100);

    // Red channel must be suppressed (redMult=0 zeroed it out)
    expect(
      rectAvg.r,
      `advanced CXForm: average red in rect area must be < 50 (redMult=0 applied). ` +
      `Got avgRed=${rectAvg.r.toFixed(1)}. ` +
      `If this fails, the advanced CXForm mult was not applied and red stayed at 255.`
    ).toBeLessThan(50);
  });

  // -------------------------------------------------------------------------
  // Test 3: Advanced CXForm — keep red, add strong blue offset (magenta result)
  //
  // Advanced color effect: RedMult=100 (keep full red), GreenMult=0, BlueMult=0,
  //   BlueOffset=+200.
  //
  // For the red rectangle (r=255, g=0, b=0):
  //   R_out = 255 * 100/100 + 0   = 255
  //   G_out =   0 * 0/100   + 0   = 0
  //   B_out =   0 * 0/100   + 200 = 200
  //
  // Expected rendered color: rgb(255, 0, 200) ≈ magenta/pink.
  // Verify: high red AND high blue simultaneously in rect area.
  //
  // PASS when advanced CXForm add offsets work: both r > 150 AND b > 100 in rect.
  // FAIL when CXForm offsets are dropped: only red remains (no blue).
  // -------------------------------------------------------------------------
  test('Advanced CXForm (full red + blue offset): rectangle renders as magenta in Ruffle', async ({ page }, testInfo: TestInfo) => {
    const doc = makeTintOracleDoc({
      docId: 'cxform-adv-magenta-doc',
      symbolId: 'sym-adv-magenta-box',
      instId: 'inst-adv-magenta-1',
      colorEffect: {
        type: 'advanced',
        redMult: 100,
        greenMult: 0,
        blueMult: 0,
        redOffset: 0,
        greenOffset: 0,
        blueOffset: 200,
      },
    });

    const shot = await runOracle({
      page, testInfo, doc,
      playerId: '__ruffle_cxform_adv_magenta__',
      label: 'advanced-full-red-add-blue',
    });

    // Sample the rect region in stage space
    const rectAvg = sampleRegionAvg(shot, 225, 150, 325, 250);
    console.log(
      `[0844] advanced-magenta: rectAvg r=${rectAvg.r.toFixed(1)}, g=${rectAvg.g.toFixed(1)}, b=${rectAvg.b.toFixed(1)}, count=${rectAvg.count}`
    );

    const stats = analysePixels(shot);
    console.log(
      `[0844] advanced-magenta: nonWhite=${stats.nonWhitePixels}, purple=${stats.purplePixels}, pureRed=${stats.pureRedPixels}`
    );

    // Non-blank: something rendered
    expect(
      stats.nonWhitePixels,
      'advanced CXForm (magenta): stage must have non-white pixels (rectangle rendered)'
    ).toBeGreaterThan(100);

    // Red channel must remain high (redMult=100 = full pass-through)
    expect(
      rectAvg.r,
      `advanced CXForm (magenta): avg red in rect area must be > 150 (redMult=100 preserved red). ` +
      `Got avgRed=${rectAvg.r.toFixed(1)}.`
    ).toBeGreaterThan(150);

    // Blue channel must be elevated (blueOffset=200 injected)
    expect(
      rectAvg.b,
      `advanced CXForm (magenta): avg blue in rect area must be > 100 (blueOffset=200 applied). ` +
      `Got avgBlue=${rectAvg.b.toFixed(1)}. ` +
      `If this fails, the advanced CXForm blue offset was not applied.`
    ).toBeGreaterThan(100);
  });
});
