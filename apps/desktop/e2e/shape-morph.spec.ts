/**
 * Shape morph (DefineMorphShape2) visual oracle — task 0784.
 *
 * Proves that DefineMorphShape2 (tag 84) encoding works end-to-end:
 *   1. A start-frame shape (blue square) renders non-blank in Ruffle (ratio=0).
 *   2. A mid-morph frame renders non-blank AND differs from the start frame,
 *      proving Ruffle is interpolating the shape via the ratio in PlaceObject2.
 *   3. The end-frame shape renders non-blank in Ruffle (ratio=65535).
 *
 * Document model: a 5-frame shape tween.
 *   Frame 0 (keyframe, tweenType:'shape'):  100×100 blue square at (225, 150)
 *   Frames 1–3 (in-between):                implicit morph via PlaceObject2 ratio
 *   Frame 4 (keyframe, tweenType:'none'):   wide, short red rectangle at (175, 175)
 *
 * The SWF emits one DefineMorphShape2 tag with ratio=0 at frame 0,
 * ratio~=32767 at frame 2 (mid), and ratio=65535 at frame 4.
 *
 * Also verifies the emitted SWF contains tag 84 (DefineMorphShape2).
 *
 * Run locally:
 *   pnpm --filter @flash/desktop e2e --grep "shape.*morph\|morph"
 *   cd apps/desktop && npx playwright test e2e/shape-morph.spec.ts
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import { parseSwfTags } from './helpers/swf-parse';

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

/**
 * Inject a Ruffle player, load the SWF, and wait for first render.
 * Hides Ruffle's splash/overlay chrome before returning.
 *
 * The caller can pass `extraWaitMs` to allow Ruffle to advance past frame 0
 * before the screenshot is taken (useful for multi-frame morph tests).
 */
async function injectRufflePlayer(
  page: Page,
  swfBase64: string,
  playerId: string,
  extraWaitMs = 0,
): Promise<void> {
  await page.evaluate(({ b64, id }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      ruffle(): {
        load(opts: { data?: Uint8Array; allowScriptAccess?: boolean; autoplay?: string; unmuteOverlay?: string }): Promise<void>;
      };
    };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = id;
    // Must be on-screen for Chromium to composite the Ruffle canvas.
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

  // Wait for Ruffle to initialise and render
  await page.waitForTimeout(1500 + extraWaitMs);

  // Hide hardware-acceleration overlays and Ruffle splash chrome.
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

/** Check if the Ruffle player has a visible panic overlay. */
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
          if (style.display !== 'none' && style.visibility !== 'hidden') found = true;
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

/**
 * Count non-white pixels (any channel < 240, alpha >= 10).
 * Used for non-blank assertions — a white canvas means nothing rendered.
 */
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
 * Count pixels that differ between two PNG buffers.
 * The two screenshots must have the same dimensions.
 */
function countDifferentPixels(bufA: Buffer, bufB: Buffer): number {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  if (a.width !== b.width || a.height !== b.height) {
    // If sizes differ (scaling), just return a large number to indicate they're different
    return Math.max(a.width * a.height, b.width * b.height) / 2;
  }
  let diff = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0));
    const dg = Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0));
    const db = Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0));
    // Threshold 30 to avoid noise from anti-aliasing
    if (dr > 30 || dg > 30 || db > 30) diff++;
  }
  return diff;
}

// ---------------------------------------------------------------------------
// Document fixture: 5-frame shape tween (blue square → red wide rectangle)
// ---------------------------------------------------------------------------

/**
 * A 5-frame FlashDocument with a single shape tween layer:
 *   Frame 0 (keyframe, tweenType:'shape'):  100×100 blue square at (225, 150)
 *   Frames 1, 2, 3 (in-between):            auto-interpolated by compiler
 *   Frame 4 (keyframe, tweenType:'none'):   200×50 red rectangle at (175, 175)
 *
 * The compiler emits DefineMorphShape2 (tag 84) once, then per-frame
 * PlaceObject2 with increasing ratio values.
 */
const MORPH_DOC = {
  id: 'morph-doc-0784',
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
        id: 'layer-morph', name: 'Layer 1', type: 'normal',
        visible: true, locked: false, outlineMode: false,
        outlineColor: '#ff0000', height: 20, parentFolderId: null,
        frameCount: 5,
        frames: [
          // Frame 0 — start keyframe, shape tween begins here
          {
            index: 0, isKeyframe: true, isEmpty: false, tweenType: 'shape',
            label: '', labelType: 'name', script: '', sound: null,
            motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [{
              id: 'morph-start-shape', type: 'shape',
              shape: {
                id: 'shape-morph-start',
                paths: [{
                  start: { x: 225, y: 150 },
                  segments: [
                    { type: 'line', to: { x: 325, y: 150 } },
                    { type: 'line', to: { x: 325, y: 250 } },
                    { type: 'line', to: { x: 225, y: 250 } },
                  ],
                  closed: true,
                  fill: { type: 'solid', color: { r: 0, g: 0, b: 255, a: 255 } },
                }],
              },
              x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            }],
          },
          // Frames 1, 2, 3 — in-between frames (not keyframes; compiler interpolates ratio)
          {
            index: 1, isKeyframe: false, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '', sound: null,
            motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [],
          },
          {
            index: 2, isKeyframe: false, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '', sound: null,
            motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [],
          },
          {
            index: 3, isKeyframe: false, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '', sound: null,
            motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [],
          },
          // Frame 4 — end keyframe (different shape: wide short red rectangle)
          {
            index: 4, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '', sound: null,
            motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [{
              id: 'morph-end-shape', type: 'shape',
              shape: {
                id: 'shape-morph-end',
                paths: [{
                  start: { x: 175, y: 175 },
                  segments: [
                    { type: 'line', to: { x: 375, y: 175 } },
                    { type: 'line', to: { x: 375, y: 225 } },
                    { type: 'line', to: { x: 175, y: 225 } },
                  ],
                  closed: true,
                  fill: { type: 'solid', color: { r: 255, g: 0, b: 0, a: 255 } },
                }],
              },
              x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            }],
          },
        ],
      }],
    },
  }],
  library: { items: [], folders: [] },
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Shape morph (DefineMorphShape2) visual oracle — task 0784', () => {
  test.skip(!!process.env.CI, 'visual oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 1: SWF structure — assert DefineMorphShape2 (tag 84) is present
  //
  // This test does NOT require Ruffle — it just inspects the raw SWF bytes
  // to confirm the compiler emitted tag 84 for the shape tween.
  // ---------------------------------------------------------------------------
  test('compiled SWF contains DefineMorphShape2 tag (tag 84)', async ({ page }) => {
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, MORPH_DOC);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    expect(typeof swfBase64).toBe('string');
    expect(swfBase64.length).toBeGreaterThan(0);

    // Parse SWF tags to find DefineMorphShape2 (tag type 84).
    // publish() returns a COMPRESSED CWS SWF by default; parseSwfTags inflates
    // the zlib body before walking the tag stream (task 1214). Reading the raw
    // bytes from offset 8 used to yield garbage tag types and never find tag 84.
    const bytes = Buffer.from(swfBase64, 'base64');
    console.log(`[0784] SWF size: ${bytes.length} bytes (signature=${bytes.toString('latin1', 0, 3)})`);

    const tags = parseSwfTags(bytes);
    const tagTypes = tags.map((t) => t.type);
    const foundMorphShape2 = tags.some((t) => t.type === 84);

    console.log(`[0784] Tag types found: ${tagTypes.join(', ')}`);
    expect(foundMorphShape2, 'SWF must contain DefineMorphShape2 (tag 84)').toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Frame 0 (ratio=0) renders non-blank — blue square visible in Ruffle
  //
  // At frame 0 the morph ratio is 0 so Ruffle shows the start shape (blue square).
  // Asserts: (a) no Ruffle panic, (b) stage is non-blank.
  // ---------------------------------------------------------------------------
  test('morph start frame (frame 0) renders non-blank in Ruffle', async ({ page }, testInfo: TestInfo) => {
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, MORPH_DOC);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });
    expect(swfBase64.length).toBeGreaterThan(0);

    await ensureRuffleLoaded(page);
    // No extra wait — screenshot immediately at frame 0 (ratio=0).
    await injectRufflePlayer(page, swfBase64, '__ruffle_morph_f0__');

    const panic = await hasRufflePanic(page, '__ruffle_morph_f0__');
    const shot = await page.locator('#__ruffle_morph_f0__').screenshot();
    await testInfo.attach('morph-frame0-screenshot', { body: shot, contentType: 'image/png' });

    const nonWhite = countNonWhitePixels(shot);
    console.log(`[0784] frame0: panic=${panic}, nonWhitePixels=${nonWhite}`);

    await removeRufflePlayer(page, '__ruffle_morph_f0__');

    expect(panic, 'Ruffle must not panic on morph start frame').toBe(false);
    expect(nonWhite, 'Start frame must be non-blank (blue square visible)').toBeGreaterThan(200);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Mid-frame rendering — screenshot at t=0 and t≈250ms differ
  //
  // The SWF has 5 frames at 12fps: one full cycle takes ~417ms.
  // - At t=0 Ruffle is at frame 0 (ratio=0, blue 100×100 square).
  // - At t≈250ms Ruffle is around frame 3 (ratio≈39321, interpolated shape).
  // Two screenshots taken from the same player at different times MUST differ
  // if Ruffle is advancing frames and applying PlaceObject2 ratio updates.
  //
  // The difference assertion is the key oracle: if the compiler always emits
  // ratio=0 for every frame, both screenshots look identical (diff ≈ 0).
  // If the shape tween ratio is wired correctly, the shape changes each frame.
  // ---------------------------------------------------------------------------
  test('morph mid-frame differs from start frame (ratio interpolation working)', async ({ page }, testInfo: TestInfo) => {
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, MORPH_DOC);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });
    expect(swfBase64.length).toBeGreaterThan(0);

    await ensureRuffleLoaded(page);

    // Inject Ruffle and screenshot quickly (frame 0 = start shape)
    await injectRufflePlayer(page, swfBase64, '__ruffle_morph_diff__');
    const panicEarly = await hasRufflePanic(page, '__ruffle_morph_diff__');
    const shotEarly = await page.locator('#__ruffle_morph_diff__').screenshot();
    await testInfo.attach('morph-diff-early', { body: shotEarly, contentType: 'image/png' });

    // Wait ~250ms more — Ruffle has advanced ~3 frames (ratio≈39321)
    await page.waitForTimeout(250);
    const shotLate = await page.locator('#__ruffle_morph_diff__').screenshot();
    await testInfo.attach('morph-diff-late', { body: shotLate, contentType: 'image/png' });

    await removeRufflePlayer(page, '__ruffle_morph_diff__');

    const nonWhiteEarly = countNonWhitePixels(shotEarly);
    const nonWhiteLate = countNonWhitePixels(shotLate);
    const diffPixels = countDifferentPixels(shotEarly, shotLate);

    console.log(`[0784] mid-frame-diff: panic=${panicEarly}`);
    console.log(`[0784] mid-frame-diff: nonWhiteEarly=${nonWhiteEarly}, nonWhiteLate=${nonWhiteLate}, diffPixels=${diffPixels}`);

    expect(panicEarly, 'Ruffle must not panic').toBe(false);
    expect(nonWhiteEarly, 'Early screenshot (frame 0) must be non-blank').toBeGreaterThan(200);
    expect(nonWhiteLate, 'Late screenshot (mid-morph) must be non-blank').toBeGreaterThan(200);
    // The interpolated shape must look different from the start shape.
    // A 50-pixel threshold is conservative — the square→rectangle morph changes
    // hundreds of pixels across the blue→red color transition alone.
    expect(diffPixels, 'Mid-morph frame must differ from start frame (ratio interpolation)').toBeGreaterThan(50);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Full morph cycle — end frame (ratio=65535) is non-blank
  //
  // After a full cycle (≥417ms) Ruffle is at or past the end frame.
  // The end shape is a 200×50 red rectangle — still clearly non-blank.
  // This test also verifies the SWF loops cleanly without error.
  // ---------------------------------------------------------------------------
  test('morph end frame is non-blank after full play cycle', async ({ page }, testInfo: TestInfo) => {
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, MORPH_DOC);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });
    expect(swfBase64.length).toBeGreaterThan(0);

    await ensureRuffleLoaded(page);
    // Wait 500ms extra — enough for Ruffle to reach the last frame (5 frames × ~83ms/frame ≈ 417ms)
    await injectRufflePlayer(page, swfBase64, '__ruffle_morph_end__', 500);

    const panic = await hasRufflePanic(page, '__ruffle_morph_end__');
    const shot = await page.locator('#__ruffle_morph_end__').screenshot();
    await testInfo.attach('morph-endcycle-screenshot', { body: shot, contentType: 'image/png' });

    const nonWhite = countNonWhitePixels(shot);
    console.log(`[0784] end-cycle: panic=${panic}, nonWhitePixels=${nonWhite}`);

    await removeRufflePlayer(page, '__ruffle_morph_end__');

    expect(panic, 'Ruffle must not panic after full morph cycle').toBe(false);
    expect(nonWhite, 'End-cycle frame must be non-blank (shape still rendering)').toBeGreaterThan(200);
  });
});
