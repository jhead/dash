/**
 * Filter PIXEL oracle: prove filters actually render in Ruffle.
 *
 * REGRESSION GUARD for the CRITICAL defect task 1238 (commit 14243fc): the
 * PlaceObject3 `HasFilterList` bit was emitted at the wrong position, so Ruffle
 * decoded the filter list as None and SILENTLY DROPPED every filter at runtime.
 * The object still rendered (unfiltered), so it was non-blank — and the
 * pre-existing filter oracles in visual-oracle.spec.ts assert only
 * `nonWhitePixels > 100` / a loose 20% editor diff, which a plain unfiltered
 * rect ALSO satisfies. Those oracles passed for the entire project history while
 * filters were silently dropped. This is exactly the failure mode CLAUDE.md
 * warns about: "byte-presence is not runtime proof" and "blank-white screenshots
 * are ambiguous".
 *
 * The technique here (proven during the 1238 verification — a yellow Glow
 * produced ~4792 lit halo pixels OUTSIDE the shape vs 0 for a no-filter control)
 * is an OUTSIDE-BOUNDS DELTA:
 *
 *   1. Publish two SWFs from byte-identical documents that differ ONLY in the
 *      filter list: one WITH the filter, one identical CONTROL with no filters.
 *   2. Screenshot both in real Ruffle.
 *   3. Count "filter pixels" in a region strictly OUTSIDE the source shape's
 *      bounding box — where ONLY a halo / shadow / blurred edge can appear.
 *   4. Assert the filtered render has materially MORE such pixels than the
 *      control (which must have ~0 there).
 *
 * KEY PROPERTY: if the filter is silently dropped (the 1238 failure mode), the
 * filtered render becomes pixel-identical to the control, the outside-bounds
 * delta collapses to ~0, and EVERY test in this file FAILS. That is the proof
 * the old oracles could not provide.
 *
 * These tests require a running Vite dev server (port 1420) and the Ruffle build
 * served from public/ruffle. Like visual-oracle.spec.ts they are CI-skipped until
 * Ruffle WASM CI infra is wired. Run locally with:
 *   pnpm --filter @flash/desktop e2e filter-pixel-oracle
 */

import { test, expect, TestInfo, Page } from '@playwright/test';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Document fixture builder
// ---------------------------------------------------------------------------

interface RGBA { r: number; g: number; b: number; a: number }

/**
 * Build a single-frame document containing one solid-fill rectangle shape with
 * the supplied filter list. The shape occupies a fixed bounding box on stage;
 * the oracle counts filter pixels OUTSIDE that box.
 *
 * The rectangle bounds (in stage px) are returned as `shapeBox` so the oracle
 * can mask out the interior. `bgColor` is the stage background.
 *
 * Passing `filters: []` produces the no-filter CONTROL render.
 */
function makeFilteredRectDoc(opts: {
  id: string;
  bgColor: string;
  fill: RGBA;
  // shape bounds in stage px
  x0: number; y0: number; x1: number; y1: number;
  filters: unknown[];
}) {
  const { id, bgColor, fill, x0, y0, x1, y1, filters } = opts;
  return {
    id,
    properties: {
      width: 550, height: 400, frameRate: 12,
      backgroundColor: bgColor, rulerUnits: 'px',
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
              id: 'filter-rect', type: 'shape',
              shape: {
                id: 'shape-filter-rect',
                paths: [{
                  start: { x: x0, y: y0 },
                  segments: [
                    { type: 'line', to: { x: x1, y: y0 } },
                    { type: 'line', to: { x: x1, y: y1 } },
                    { type: 'line', to: { x: x0, y: y1 } },
                  ],
                  closed: true,
                  fill: { type: 'solid', color: fill },
                }],
              },
              x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
              filters,
            }],
          }],
        }],
      },
    }],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Ruffle render helper
// ---------------------------------------------------------------------------

/**
 * Load a document into the app, publish it to SWF, render that SWF in a real
 * Ruffle player, and return the 550×400 screenshot buffer.
 *
 * Mirrors captureRuffleScreenshot in visual-oracle.spec.ts (same overlay-visible
 * placement and 1.5s settle the CLAUDE.md learnings require for WebGL capture),
 * but takes the document to load so we can render the filtered and control docs
 * back-to-back in one test.
 */
async function renderDocInRuffle(page: Page, fixtureDoc: unknown): Promise<Buffer> {
  await page.evaluate((doc) => {
    (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
  }, fixtureDoc);
  await page.waitForTimeout(300);

  const swfBase64: string = await page.evaluate(() => {
    return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
  });

  // Ensure ruffle.js is loaded (served at /ruffle/ruffle.js).
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

  await page.evaluate((b64) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & { ruffle(): { load(opts: { data?: Uint8Array }): Promise<void> } };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = '__ruffle_filter_player__';
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;pointer-events:none;z-index:99999';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({ data: bytes });
  }, swfBase64);

  await page.waitForTimeout(1500);
  const shot = await page.locator('#__ruffle_filter_player__').screenshot();
  await page.evaluate(() => {
    const el = document.getElementById('__ruffle_filter_player__');
    if (el) el.remove();
  });
  return shot;
}

// ---------------------------------------------------------------------------
// Pixel analysis
// ---------------------------------------------------------------------------

interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * Count pixels in `img` that are OUTSIDE `box` (plus a margin so the crisp shape
 * edge itself is never counted) and that differ from the background `bg` by more
 * than `threshold` (sum of |dr|+|dg|+|db|).
 *
 * Ruffle screenshots may be a different internal resolution than 550×400, so the
 * box (given in stage px on a 550×400 stage) is scaled to the image dimensions.
 */
function countFilterPixelsOutsideBox(
  img: PNG,
  box: Box,
  bg: { r: number; g: number; b: number },
  threshold: number,
  marginPx = 6,
): number {
  const STAGE_W = 550, STAGE_H = 400;
  const sx = img.width / STAGE_W;
  const sy = img.height / STAGE_H;
  // Inflate the exclusion box by margin so the shape's own anti-aliased edge is
  // not counted as a "filter" pixel.
  const ex0 = (box.x0 - marginPx) * sx;
  const ey0 = (box.y0 - marginPx) * sy;
  const ex1 = (box.x1 + marginPx) * sx;
  const ey1 = (box.y1 + marginPx) * sy;

  let count = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (x >= ex0 && x <= ex1 && y >= ey0 && y <= ey1) continue; // inside shape box
      const idx = (y * img.width + x) * 4;
      const dr = Math.abs(img.data[idx] - bg.r);
      const dg = Math.abs(img.data[idx + 1] - bg.g);
      const db = Math.abs(img.data[idx + 2] - bg.b);
      if (dr + dg + db > threshold) count++;
    }
  }
  return count;
}

/** Parse a #rrggbb string into an {r,g,b}. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Filter pixel oracle: filters must change rendered pixels in Ruffle', () => {
  test.skip(!!process.env.CI, 'Skip filter pixel oracle in CI until Ruffle CI setup complete');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined',
    );
    expect(bridgeReady).toBe(true);
  });

  // The shape box is the same for every test so the exclusion math is shared.
  // Centred-ish on the 550×400 stage with room for halos/shadows on all sides.
  const SHAPE = { x0: 200, y0: 150, x1: 350, y1: 250 } as const;

  // -------------------------------------------------------------------------
  // GLOW: a coloured halo must appear OUTSIDE the shape. The control has none.
  // -------------------------------------------------------------------------
  test('glow filter adds a coloured halo outside the shape (vs no-filter control)', async ({ page }, testInfo: TestInfo) => {
    const bg = '#cccccc';
    const bgRgb = hexToRgb(bg);
    const fill: RGBA = { r: 255, g: 0, b: 0, a: 255 };

    const glowDoc = makeFilteredRectDoc({
      id: 'glow-filtered', bgColor: bg, fill, ...SHAPE,
      filters: [{
        type: 'glow',
        color: { r: 255, g: 255, b: 0, a: 255 }, // yellow — easily distinguished from red fill & grey bg
        alpha: 1, blurX: 12, blurY: 12, strength: 3, quality: 3,
        inner: false, knockout: false, enabled: true,
      }],
    });
    const controlDoc = makeFilteredRectDoc({
      id: 'glow-control', bgColor: bg, fill, ...SHAPE, filters: [],
    });

    const glowShot = await renderDocInRuffle(page, glowDoc);
    const controlShot = await renderDocInRuffle(page, controlDoc);

    const glowImg = PNG.sync.read(glowShot);
    const controlImg = PNG.sync.read(controlShot);

    // Threshold high enough to ignore faint AA, low enough to catch a real halo.
    const THRESH = 50;
    const glowOutside = countFilterPixelsOutsideBox(glowImg, SHAPE, bgRgb, THRESH);
    const controlOutside = countFilterPixelsOutsideBox(controlImg, SHAPE, bgRgb, THRESH);

    testInfo.annotations.push({
      type: 'measurement',
      description: `glow outside-box pixels=${glowOutside}, control=${controlOutside}`,
    });
    if (glowOutside <= controlOutside + 300) {
      await testInfo.attach('glow-filtered', { body: glowShot, contentType: 'image/png' });
      await testInfo.attach('glow-control', { body: controlShot, contentType: 'image/png' });
    }

    // Control: a crisp rect inside the box → ~0 lit pixels outside (margin excludes AA).
    expect(controlOutside, 'no-filter control should be ~empty outside the shape box').toBeLessThan(300);
    // Glow: a real halo spills well beyond the box.
    expect(glowOutside, 'glow halo must light up many pixels outside the shape box').toBeGreaterThan(800);
    // And it must MATERIALLY exceed the control — if the filter were dropped
    // (task 1238 failure mode) glowOutside would collapse to ~controlOutside.
    expect(glowOutside - controlOutside, 'glow vs control outside-box delta proves the filter rendered').toBeGreaterThan(800);
  });

  // -------------------------------------------------------------------------
  // DROP SHADOW: an offset shadow must appear OUTSIDE the shape, biased toward
  // the offset direction (angle 45°, distance 10 → shadow toward bottom-right).
  // -------------------------------------------------------------------------
  test('drop-shadow filter adds an offset shadow outside the shape (vs no-filter control)', async ({ page }, testInfo: TestInfo) => {
    const bg = '#ffffff';
    const bgRgb = hexToRgb(bg);
    const fill: RGBA = { r: 255, g: 255, b: 255, a: 255 }; // white shape on white bg → only the shadow is visible outside

    const shadowDoc = makeFilteredRectDoc({
      id: 'dropshadow-filtered', bgColor: bg, fill, ...SHAPE,
      filters: [{
        type: 'drop-shadow',
        distance: 10, angle: 45,
        color: { r: 0, g: 0, b: 0, a: 255 }, alpha: 1,
        blurX: 8, blurY: 8, strength: 3, quality: 3,
        inner: false, knockout: false, hideObject: false, enabled: true,
      }],
    });
    const controlDoc = makeFilteredRectDoc({
      id: 'dropshadow-control', bgColor: bg, fill, ...SHAPE, filters: [],
    });

    const shadowShot = await renderDocInRuffle(page, shadowDoc);
    const controlShot = await renderDocInRuffle(page, controlDoc);

    const shadowImg = PNG.sync.read(shadowShot);
    const controlImg = PNG.sync.read(controlShot);

    const THRESH = 50;
    const shadowOutside = countFilterPixelsOutsideBox(shadowImg, SHAPE, bgRgb, THRESH);
    const controlOutside = countFilterPixelsOutsideBox(controlImg, SHAPE, bgRgb, THRESH);

    // Directional check: a drop shadow offset at angle 45° (distance 10) lands
    // toward the bottom-right, so the CENTROID of the lit pixels OUTSIDE the box
    // must be biased below-and-right of the box centre. (Quadrant/corner counts
    // are too sparse — most shadow pixels sit in the bands directly below/right
    // of the box, not its corner — so we use the centroid of the spill instead.)
    const sx = shadowImg.width / 550, sy = shadowImg.height / 400;
    const exMargin = 6;
    const ex0 = (SHAPE.x0 - exMargin) * sx, ey0 = (SHAPE.y0 - exMargin) * sy;
    const ex1 = (SHAPE.x1 + exMargin) * sx, ey1 = (SHAPE.y1 + exMargin) * sy;
    const boxCx = (SHAPE.x0 + SHAPE.x1) / 2 * sx;
    const boxCy = (SHAPE.y0 + SHAPE.y1) / 2 * sy;
    let sumX = 0, sumY = 0, n = 0;
    for (let y = 0; y < shadowImg.height; y++) {
      for (let x = 0; x < shadowImg.width; x++) {
        if (x >= ex0 && x <= ex1 && y >= ey0 && y <= ey1) continue; // inside box
        const idx = (y * shadowImg.width + x) * 4;
        const d = Math.abs(shadowImg.data[idx] - bgRgb.r)
          + Math.abs(shadowImg.data[idx + 1] - bgRgb.g)
          + Math.abs(shadowImg.data[idx + 2] - bgRgb.b);
        if (d <= THRESH) continue;
        sumX += x; sumY += y; n++;
      }
    }
    const centroidX = n > 0 ? sumX / n : boxCx;
    const centroidY = n > 0 ? sumY / n : boxCy;

    testInfo.annotations.push({
      type: 'measurement',
      description: `shadow outside=${shadowOutside}, control=${controlOutside}, centroid=(${centroidX.toFixed(1)},${centroidY.toFixed(1)}) vs boxCenter=(${boxCx.toFixed(1)},${boxCy.toFixed(1)})`,
    });
    if (shadowOutside <= controlOutside + 300) {
      await testInfo.attach('dropshadow-filtered', { body: shadowShot, contentType: 'image/png' });
      await testInfo.attach('dropshadow-control', { body: controlShot, contentType: 'image/png' });
    }

    expect(controlOutside, 'no-filter control should be ~empty outside the shape box').toBeLessThan(300);
    expect(shadowOutside, 'drop shadow must light up many pixels outside the shape box').toBeGreaterThan(800);
    expect(shadowOutside - controlOutside, 'shadow vs control outside-box delta proves the filter rendered').toBeGreaterThan(800);
    // Shadow is offset bottom-right: the spill centroid must sit below-and-right
    // of the box centre, NOT centred (which is what an evenly-spread glow, or a
    // dropped filter, would produce).
    expect(centroidX, 'drop-shadow spill centroid must be right of box centre (angle 45° → +x)').toBeGreaterThan(boxCx + 5 * sx);
    expect(centroidY, 'drop-shadow spill centroid must be below box centre (angle 45° → +y)').toBeGreaterThan(boxCy + 5 * sy);
  });

  // -------------------------------------------------------------------------
  // BLUR: softens/spreads the edge so coloured pixels appear just OUTSIDE the
  // crisp control silhouette. The control's edge is sharp → ~0 outside.
  // -------------------------------------------------------------------------
  test('blur filter spreads the edge beyond the crisp control silhouette', async ({ page }, testInfo: TestInfo) => {
    const bg = '#ffffff';
    const bgRgb = hexToRgb(bg);
    const fill: RGBA = { r: 0, g: 0, b: 0, a: 255 }; // black rect on white → blur smears grey beyond the edge

    const blurDoc = makeFilteredRectDoc({
      id: 'blur-filtered', bgColor: bg, fill, ...SHAPE,
      filters: [{ type: 'blur', blurX: 16, blurY: 16, quality: 3, enabled: true }],
    });
    const controlDoc = makeFilteredRectDoc({
      id: 'blur-control', bgColor: bg, fill, ...SHAPE, filters: [],
    });

    const blurShot = await renderDocInRuffle(page, blurDoc);
    const controlShot = await renderDocInRuffle(page, controlDoc);

    const blurImg = PNG.sync.read(blurShot);
    const controlImg = PNG.sync.read(controlShot);

    // Use a SMALL margin so the spread-just-outside-the-edge blur is captured,
    // and a low threshold (blur produces faint grey, not full-strength colour).
    const THRESH = 30;
    const MARGIN = 3;
    const blurOutside = countFilterPixelsOutsideBox(blurImg, SHAPE, bgRgb, THRESH, MARGIN);
    const controlOutside = countFilterPixelsOutsideBox(controlImg, SHAPE, bgRgb, THRESH, MARGIN);

    testInfo.annotations.push({
      type: 'measurement',
      description: `blur outside-box pixels=${blurOutside}, control=${controlOutside}`,
    });
    if (blurOutside <= controlOutside + 300) {
      await testInfo.attach('blur-filtered', { body: blurShot, contentType: 'image/png' });
      await testInfo.attach('blur-control', { body: controlShot, contentType: 'image/png' });
    }

    // Crisp control rect: even at margin=3 the edge is sharp → few pixels outside.
    expect(controlOutside, 'no-filter control edge is crisp → ~empty just outside').toBeLessThan(400);
    // Blur smears the edge well beyond the box.
    expect(blurOutside, 'blur must spread edge pixels beyond the shape box').toBeGreaterThan(1000);
    expect(blurOutside - controlOutside, 'blur vs control outside-box delta proves the filter rendered').toBeGreaterThan(800);
  });
});
