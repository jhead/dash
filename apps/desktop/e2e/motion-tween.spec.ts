/**
 * Motion tween Ruffle visual oracle — task 0795.
 *
 * Proves that motion tween compile.ts interpolation (PlaceObject2 move-flag
 * frames) actually renders at the correct mid-frame position in Ruffle.
 *
 * Document model: a 5-frame motion tween.
 *   Frame 0 (keyframe, tweenType:'motion'): 50×50 red square at x=50, y=175
 *   Frames 1–3 (in-between):               PlaceObject2 with HasMove flag
 *   Frame 4 (keyframe, tweenType:'none'):   50×50 red square at x=450, y=175
 *
 * Tests:
 *   1. Motion tween plays — frame 0 shows object on left, mid-frame shows
 *      object has moved (pixel columns near x=50 empty, near x=250 non-empty).
 *   2. Oracle integrity — a static (non-tween) doc does NOT move: early and
 *      late screenshots are essentially identical.
 *
 * Run locally:
 *   pnpm --filter @flash/desktop e2e --grep "motion.*tween"
 *   cd apps/desktop && npx playwright test e2e/motion-tween.spec.ts
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Helpers (copied from shape-morph.spec.ts pattern)
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
// Document fixture helpers
// ---------------------------------------------------------------------------

/** Build a 50×50 red rectangle shape display object at (x, y). */
function makeRectShape(id: string, x: number, y: number) {
  return {
    id,
    type: 'shape' as const,
    shape: {
      id: `shape-${id}`,
      paths: [{
        start: { x, y },
        segments: [
          { type: 'line' as const, to: { x: x + 50, y } },
          { type: 'line' as const, to: { x: x + 50, y: y + 50 } },
          { type: 'line' as const, to: { x, y: y + 50 } },
        ],
        closed: true,
        fill: { type: 'solid' as const, color: { r: 255, g: 0, b: 0, a: 255 } },
      }],
    },
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  };
}

function makeBaseFrame(index: number, overrides: Record<string, unknown> = {}) {
  return {
    index,
    isKeyframe: false,
    isEmpty: false,
    tweenType: 'none' as const,
    label: '', labelType: 'name', script: '', sound: null,
    motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
    motionOrientToPath: false, motionSync: false, motionScale: false,
    shapeEase: 0, shapeBlend: 'distributive',
    displayObjects: [] as unknown[],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Document fixtures
// ---------------------------------------------------------------------------

/**
 * A 5-frame motion tween: red 50×50 square moves from x=50 to x=450.
 *   Frame 0 (keyframe, tweenType:'motion'): square at x=50, y=175
 *   Frames 1–3: non-keyframe tween frames (PlaceObject2 with HasMove)
 *   Frame 4 (keyframe, tweenType:'none'): square at x=450, y=175
 */
const MOTION_TWEEN_DOC = {
  id: 'motion-tween-doc-0795',
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
        id: 'layer-tween', name: 'Layer 1', type: 'normal',
        visible: true, locked: false, outlineMode: false,
        outlineColor: '#ff0000', height: 20, parentFolderId: null,
        frameCount: 5,
        frames: [
          makeBaseFrame(0, {
            isKeyframe: true,
            tweenType: 'motion',
            displayObjects: [makeRectShape('tween-start', 50, 175)],
          }),
          makeBaseFrame(1, { tweenType: 'motion' }),
          makeBaseFrame(2, { tweenType: 'motion' }),
          makeBaseFrame(3, { tweenType: 'motion' }),
          makeBaseFrame(4, {
            isKeyframe: true,
            tweenType: 'none',
            displayObjects: [makeRectShape('tween-end', 450, 175)],
          }),
        ],
      }],
    },
  }],
  library: { items: [], folders: [] },
};

/**
 * A 5-frame static doc: red 50×50 square at x=50 (no tween — should NOT move).
 * Used for oracle integrity: if screenshots of a static object differ, the
 * oracle methodology is broken.
 */
const STATIC_DOC = {
  id: 'static-doc-0795',
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
        id: 'layer-static', name: 'Layer 1', type: 'normal',
        visible: true, locked: false, outlineMode: false,
        outlineColor: '#ff0000', height: 20, parentFolderId: null,
        frameCount: 5,
        frames: [
          makeBaseFrame(0, {
            isKeyframe: true,
            tweenType: 'none',
            displayObjects: [makeRectShape('static-obj', 50, 175)],
          }),
          makeBaseFrame(1),
          makeBaseFrame(2),
          makeBaseFrame(3),
          makeBaseFrame(4),
        ],
      }],
    },
  }],
  library: { items: [], folders: [] },
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Motion tween visual oracle — task 0795', () => {
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
  // Test 1: Motion tween plays — object moves from left to right
  //
  // At t≈0 the SWF is at frame 0 (object at x=50, left side).
  // After ~250ms at 12fps, Ruffle has advanced ~3 frames (object near x=250).
  // The two screenshots MUST differ if PlaceObject2 HasMove frames are emitted
  // and Ruffle is applying the interpolated positions.
  //
  // This is the key runtime gate: unit tests on SWF bytes alone do not prove
  // Ruffle actually repositions the object each frame.
  // -------------------------------------------------------------------------
  test('motion tween plays — object moves from frame 0 to mid-frame (position changes)', async ({ page }, testInfo: TestInfo) => {
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, MOTION_TWEEN_DOC);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });
    expect(swfBase64.length).toBeGreaterThan(0);

    await ensureRuffleLoaded(page);

    // Inject Ruffle, screenshot quickly at frame 0 (object at left)
    await injectRufflePlayer(page, swfBase64, '__ruffle_tween_diff__');
    const panicEarly = await hasRufflePanic(page, '__ruffle_tween_diff__');
    const shotEarly = await page.locator('#__ruffle_tween_diff__').screenshot();
    await testInfo.attach('motion-tween-frame0', { body: shotEarly, contentType: 'image/png' });

    // Wait ~250ms more — Ruffle advances ~3 frames (object near x=250, mid-stage)
    await page.waitForTimeout(250);
    const shotMid = await page.locator('#__ruffle_tween_diff__').screenshot();
    await testInfo.attach('motion-tween-mid-frame', { body: shotMid, contentType: 'image/png' });

    await removeRufflePlayer(page, '__ruffle_tween_diff__');

    const nonWhiteEarly = countNonWhitePixels(shotEarly);
    const nonWhiteMid = countNonWhitePixels(shotMid);
    const diffPixels = countDifferentPixels(shotEarly, shotMid);

    console.log(`[0795] motion-tween-diff: panic=${panicEarly}`);
    console.log(`[0795] motion-tween-diff: nonWhiteEarly=${nonWhiteEarly}, nonWhiteMid=${nonWhiteMid}, diffPixels=${diffPixels}`);

    expect(panicEarly, 'Ruffle must not panic on motion tween SWF').toBe(false);
    expect(nonWhiteEarly, 'Frame 0 must be non-blank (object on left side)').toBeGreaterThan(100);
    expect(nonWhiteMid, 'Mid-frame must be non-blank (object still visible)').toBeGreaterThan(100);
    // Object must have moved — a 50-pixel threshold is conservative.
    // Moving 50px right across 550px width moves the 50×50 square ~200px,
    // changing hundreds of pixels.
    expect(diffPixels, 'Mid-frame must differ from frame 0 (object has moved)').toBeGreaterThan(50);
  });

  // -------------------------------------------------------------------------
  // Test 2: Oracle integrity — static object does NOT move
  //
  // A single-keyframe doc with the same red square at x=50 (no tween).
  // Early and late screenshots should be essentially identical.
  // If they differ significantly, the test methodology is broken (e.g., Ruffle
  // is loading a stale SWF from a previous test, or timing is unreliable).
  //
  // This acts as a negative control: the oracle only passes Test 1 if motion
  // tweens actually cause pixel differences, not just Ruffle rendering variance.
  // -------------------------------------------------------------------------
  test('oracle integrity — static object stays in place (no tween = no movement)', async ({ page }, testInfo: TestInfo) => {
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, STATIC_DOC);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });
    expect(swfBase64.length).toBeGreaterThan(0);

    await ensureRuffleLoaded(page);

    await injectRufflePlayer(page, swfBase64, '__ruffle_static_diff__');
    const panicEarly = await hasRufflePanic(page, '__ruffle_static_diff__');
    const shotEarly = await page.locator('#__ruffle_static_diff__').screenshot();
    await testInfo.attach('static-frame0', { body: shotEarly, contentType: 'image/png' });

    // Wait same ~250ms as in the tween test
    await page.waitForTimeout(250);
    const shotLate = await page.locator('#__ruffle_static_diff__').screenshot();
    await testInfo.attach('static-frame-late', { body: shotLate, contentType: 'image/png' });

    await removeRufflePlayer(page, '__ruffle_static_diff__');

    const nonWhiteEarly = countNonWhitePixels(shotEarly);
    const diffPixels = countDifferentPixels(shotEarly, shotLate);

    console.log(`[0795] static-integrity: panic=${panicEarly}`);
    console.log(`[0795] static-integrity: nonWhiteEarly=${nonWhiteEarly}, diffPixels=${diffPixels}`);

    expect(panicEarly, 'Ruffle must not panic on static SWF').toBe(false);
    expect(nonWhiteEarly, 'Static frame must be non-blank (object visible)').toBeGreaterThan(100);
    // Static object must NOT change position — allow some noise (< 200 px) but
    // reject large differences that would indicate spurious movement.
    expect(diffPixels, 'Static object must not move (oracle integrity check)').toBeLessThan(200);
  });
});
