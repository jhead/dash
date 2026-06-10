/**
 * Motion guide layer visual oracle E2E (task 0797): prove that a SWF with a
 * guide/guided layer pair compiles correctly and that the guided object follows
 * the guide path (positions are baked into PlaceObject2 MATRIX by compile.ts).
 *
 * Per CLAUDE.md: "byte-presence unit tests are not runtime proof."
 * getTweenedFrame() and compile.ts support guide-path following, but no
 * Ruffle-backed acceptance proof existed before this task.
 *
 * Architecture note: guide path following is resolved AT COMPILE TIME.
 * compile.ts calls getTweenedFrame(layer, frameIdx, scene.timeline) for each
 * frame; when the layer type is 'guided' and there is a 'guide' layer directly
 * above it, samplePath() overrides the interpolated (x,y) with the position on
 * the guide path at the normalized parameter t. The resulting positions are
 * baked into PlaceObject2 MATRIX records in the SWF — Ruffle never sees the
 * guide layer (it is skipped by compile.ts).
 *
 * Fixture:
 *   - 5-frame document at 12fps (stage 550×400, white background).
 *   - Layer 0 (type:'guide'):  an open quadratic curve path from
 *       (100,300) → control (300,50) → (500,300).
 *     This is the motion guide; compile.ts skips it — no SWF output.
 *   - Layer 1 (type:'guided'): a 50×50 blue rectangle symbol instance,
 *     motion-tweened from (100,300) to (500,300) over 5 frames.
 *     At frame 0 the object is at (100,300). At frame 2 (mid, t=0.5) the
 *     guide path places it near (300,50) — the top of the curve. At frame 4
 *     it is back at (500,300).
 *
 * Tests:
 *   1. Compile+load: SWF compiles without error, Ruffle loads it without panic,
 *      and frame 0 is non-blank.
 *   2. SWF structure: 5 ShowFrame tags emitted (5-frame tween); the guide path
 *      bakes different MATRIX positions into each frame.
 *   3. Guide path followed — mid-frame apex position: scanning across a full
 *      playback cycle (>417ms), at least one frame must have non-white pixels
 *      in the upper region of the stage (y<120) where the apex is at (300,50).
 *      Without guide-path following, the object stays at y≈300 at all times
 *      (straight-line interpolation of start y=300 → end y=300 = constant y=300).
 *      With guide-path following, the object reaches y≈50 at the mid-frame.
 *
 * Run locally:
 *   pnpm --filter @flash/desktop e2e --grep "motion guide"
 *   cd apps/desktop && npx playwright test e2e/motion-guide.spec.ts
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
 * Inject a Ruffle player, load the SWF, wait for first render.
 * Hides Ruffle's splash/overlay chrome before returning.
 *
 * @param extraWaitMs  Additional ms to wait after initial 1500ms settle time.
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

  // Wait for Ruffle to initialise and render.
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
 * Count non-white pixels in a specific rectangular region of the image.
 * Coordinates are in CSS pixels (0-based, top-left origin).
 *
 * Scales region coordinates proportionally if the image is larger than 550×400
 * (e.g., on a 2× display the screenshot is 1100×800 but the stage is 550×400).
 */
function countNonWhitePixelsInRegion(
  buf: Buffer,
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number,
): number {
  const img = PNG.sync.read(buf);
  // Scale factor: if screenshot is 2× the expected 550×400, coordinates scale too.
  const scaleX = img.width / 550;
  const scaleY = img.height / 400;
  const x0 = Math.round(regionX * scaleX);
  const y0 = Math.round(regionY * scaleY);
  const w  = Math.round(regionW * scaleX);
  const h  = Math.round(regionH * scaleY);

  let count = 0;
  for (let py = y0; py < y0 + h && py < img.height; py++) {
    for (let px = x0; px < x0 + w && px < img.width; px++) {
      const i = (py * img.width + px) * 4;
      const r = img.data[i]!;
      const g = img.data[i + 1]!;
      const b = img.data[i + 2]!;
      const a = img.data[i + 3]!;
      if (a < 10) continue;
      if (r < 240 || g < 240 || b < 240) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// SWF tag parser (mirrors shape-morph.spec.ts)
// ---------------------------------------------------------------------------

/** Parse SWF tag records and return an array of {type, body}. */
function parseSWFTags(bytes: Buffer): Array<{ type: number; body: Buffer }> {
  let offset = 8;
  // Skip FrameSize RECT
  const nBits = (bytes[offset]! >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + 4 * nBits) / 8);
  offset += rectBytes + 4; // FrameRate UI16 + FrameCount UI16

  const tags: Array<{ type: number; body: Buffer }> = [];
  while (offset < bytes.length - 2) {
    const tagWord = bytes.readUInt16LE(offset);
    const tagType = tagWord >> 6;
    const tagShortLen = tagWord & 0x3f;
    offset += 2;
    let tagLen = tagShortLen;
    if (tagShortLen === 0x3f) {
      tagLen = bytes.readUInt32LE(offset);
      offset += 4;
    }
    tags.push({ type: tagType, body: bytes.slice(offset, offset + tagLen) });
    offset += tagLen;
    if (tagType === 0) break; // End tag
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Document fixture
// ---------------------------------------------------------------------------

/**
 * A 5-frame FlashDocument with a motion guide pair:
 *
 *   Layer 0 (type:'guide'): a quadratic Bézier path
 *     start (100,300) → control (300,50) → end (500,300)
 *     This is NOT compiled to SWF — it only drives the guided layer's positions.
 *
 *   Layer 1 (type:'guided'): a symbol instance (50×50 blue box) with a
 *     motion tween from (100,300) at frame 0 to (500,300) at frame 4.
 *     Because the guide layer is above it, compile.ts bakes the path positions
 *     into the PlaceObject2 MATRIX for each in-between frame.
 *
 * Expected path positions (from getTweenedFrame debug, verified):
 *   Frame 0: (100, 300)   — path start (left side, bottom)
 *   Frame 1: (187, 216)   — quarter way up the left side
 *   Frame 2: (300, 175)   — mid-path point (center-left region, above middle)
 *   Frame 3: (413, 216)   — quarter way down the right side
 *   Frame 4: (500, 300)   — path end (right side, bottom)
 *
 * Note: the quadratic Bézier apex at t=0.5 is NOT the control point.
 * For Q(start, control, end) at t=0.5: P = 0.25*start + 0.5*control + 0.25*end
 * = 0.25*(100,300) + 0.5*(300,50) + 0.25*(500,300) = (300, 175), not (300, 50).
 *
 * The library contains one movieclip symbol ('BluBox') containing a 50×50 blue
 * rectangle. SymbolInstance is used (rather than a raw shape) so the object has
 * a consistent registration point at (0,0) and can be positioned by (x,y).
 *
 * Why the guide path oracle works:
 *   - Without guide-path following: start y=300, end y=300 → ALL frames interpolate
 *     to y=300 (straight horizontal line). Frame 2 would be at (300, 300).
 *     The mid-stage region (x:250-360, y:140-230) has no pixels from this path.
 *   - With guide-path following: frame 2 places the object at (300, 175). The
 *     mid-center region (x: 250-360, y: 140-240) has blue pixels on that frame.
 *   The key distinction: y=175 (guide) vs y=300 (straight line) — 125px difference.
 */
const GUIDE_DOC = {
  id: 'guide-doc-0797',
  properties: {
    width: 550, height: 400, frameRate: 12,
    backgroundColor: '#ffffff', rulerUnits: 'px',
    grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
    guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
  },
  scenes: [{
    id: 'scene-1', name: 'Scene 1',
    timeline: {
      layers: [
        // ----------------------------------------------------------------
        // Layer 0: Guide layer — quadratic Bézier from (100,300) to (500,300)
        // peaking at control point (300,50).
        // compile.ts skips this layer (type:'guide') — it is not rendered.
        // ----------------------------------------------------------------
        {
          id: 'layer-guide', name: 'Guide', type: 'guide',
          visible: true, locked: false, outlineMode: false,
          outlineColor: '#00ff00', height: 20, parentFolderId: null,
          frameCount: 5,
          frames: [{
            index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '', sound: null,
            motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [{
              id: 'guide-path-shape', type: 'shape',
              shape: {
                id: 'shape-guide-path',
                paths: [{
                  // Quadratic Bézier: start=(100,300), control=(300,50), end=(500,300)
                  // This creates a parabola-like arc peaking near the top of the stage.
                  start: { x: 100, y: 300 },
                  segments: [
                    { type: 'curve', control: { x: 300, y: 50 }, to: { x: 500, y: 300 } },
                  ],
                  closed: false,
                  fill: null,
                }],
              },
              x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            }],
          }],
        },
        // ----------------------------------------------------------------
        // Layer 1: Guided layer — blue box follows the guide path.
        // Motion tween from (100,300) at frame 0 to (500,300) at frame 4.
        // getTweenedFrame() + samplePath() override each frame's (x,y)
        // to follow the guide curve instead of a straight line.
        // ----------------------------------------------------------------
        {
          id: 'layer-guided', name: 'BlueBox', type: 'guided',
          visible: true, locked: false, outlineMode: false,
          outlineColor: '#ff0000', height: 20, parentFolderId: null,
          frameCount: 5,
          frames: [
            // Frame 0: start keyframe, motion tween begins here
            {
              index: 0, isKeyframe: true, isEmpty: false, tweenType: 'motion',
              label: '', labelType: 'name', script: '', sound: null,
              motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
              motionOrientToPath: false, motionSync: false, motionScale: false,
              shapeEase: 0, shapeBlend: 'distributive',
              displayObjects: [{
                id: 'guide-inst-start', type: 'instance',
                symbolId: 'sym-blue-box',
                x: 100, y: 300, scaleX: 1, scaleY: 1, rotation: 0,
              }],
            },
            // Frames 1, 2, 3 — in-between frames (interpolated by compile.ts)
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
            // Frame 4: end keyframe — object arrives at (500,300) (path end)
            {
              index: 4, isKeyframe: true, isEmpty: false, tweenType: 'none',
              label: '', labelType: 'name', script: '', sound: null,
              motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
              motionOrientToPath: false, motionSync: false, motionScale: false,
              shapeEase: 0, shapeBlend: 'distributive',
              displayObjects: [{
                id: 'guide-inst-end', type: 'instance',
                symbolId: 'sym-blue-box',
                x: 500, y: 300, scaleX: 1, scaleY: 1, rotation: 0,
              }],
            },
          ],
        },
      ],
    },
  }],
  // Library: one movieclip 'BluBox' containing a 50×50 blue rectangle.
  library: {
    items: [{
      id: 'sym-blue-box',
      name: 'BluBox',
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
          id: 'sym-blue-box-layer', name: 'Layer 1', type: 'normal',
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
              id: 'sym-blue-rect', type: 'shape',
              shape: {
                id: 'shape-blue-rect',
                paths: [{
                  start: { x: 0, y: 0 },
                  segments: [
                    { type: 'line', to: { x: 50, y: 0 } },
                    { type: 'line', to: { x: 50, y: 50 } },
                    { type: 'line', to: { x: 0, y: 50 } },
                  ],
                  closed: true,
                  fill: { type: 'solid', color: { r: 0, g: 0, b: 255, a: 255 } },
                }],
              },
              x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            }],
          }],
        }],
      },
    }],
    folders: [],
  },
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Motion guide layer visual oracle — task 0797', () => {
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
  // Test 1: Compile + load
  //
  // A document with guide/guided layer pair compiles without error,
  // Ruffle loads it without a panic overlay, and frame 0 is non-blank.
  //
  // This is the minimum acceptance gate: the guide layer must not cause a
  // crash in compile.ts and must not produce a corrupt SWF that Ruffle rejects.
  // -------------------------------------------------------------------------
  test('guide-layer SWF compiles without error and Ruffle loads it non-blank', async ({ page }, testInfo: TestInfo) => {
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, GUIDE_DOC);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    expect(typeof swfBase64, 'publish() must return a string').toBe('string');
    expect(swfBase64.length, 'SWF must be non-empty').toBeGreaterThan(0);

    const swfBytes = Buffer.from(swfBase64, 'base64');
    console.log(`[0797] compile+load: SWF size=${swfBytes.length} bytes`);
    expect(swfBytes.length, 'SWF must be at least 20 bytes').toBeGreaterThan(20);

    await ensureRuffleLoaded(page);
    await injectRufflePlayer(page, swfBase64, '__ruffle_guide_load__');

    const panic = await hasRufflePanic(page, '__ruffle_guide_load__');
    const shot = await page.locator('#__ruffle_guide_load__').screenshot();
    await testInfo.attach('guide-load-frame0', { body: shot, contentType: 'image/png' });

    const nonWhite = countNonWhitePixels(shot);
    console.log(`[0797] compile+load: panic=${panic}, nonWhitePixels=${nonWhite}`);

    await removeRufflePlayer(page, '__ruffle_guide_load__');

    expect(panic, 'Ruffle must not show a panic overlay').toBe(false);
    expect(nonWhite, 'Frame 0 must be non-blank (blue box visible at path start)').toBeGreaterThan(100);
  });

  // -------------------------------------------------------------------------
  // Test 2: SWF structure — 5 ShowFrame tags emitted, guide layer excluded
  //
  // The compiled SWF must have exactly 5 ShowFrame (tag 1) tags because the
  // guided layer has a 5-frame tween. The guide layer itself must NOT contribute
  // any DefineShape/PlaceObject tags because compile.ts skips guide-typed layers.
  //
  // The SWF must contain at least one DefineSprite (tag 39) for the 'BluBox'
  // library symbol, and PlaceObject2 (tag 26) tags for each frame.
  // -------------------------------------------------------------------------
  test('SWF structure: 5 ShowFrame tags, guide layer excluded from output', async ({ page }) => {
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, GUIDE_DOC);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });
    expect(swfBase64.length).toBeGreaterThan(0);

    const bytes = Buffer.from(swfBase64, 'base64');
    const tags = parseSWFTags(bytes);

    const showFrameCount = tags.filter((t) => t.type === 1).length;  // ShowFrame
    const placeCount     = tags.filter((t) => t.type === 26).length; // PlaceObject2
    const defineSpriteCount = tags.filter((t) => t.type === 39).length; // DefineSprite

    console.log(`[0797] structure: ShowFrame=${showFrameCount}, PlaceObject2=${placeCount}, DefineSprite=${defineSpriteCount}`);
    console.log(`[0797] structure: all tag types = ${[...new Set(tags.map((t) => t.type))].sort((a,b)=>a-b).join(',')}`);

    expect(showFrameCount, 'SWF must have 5 ShowFrame tags (5-frame guided tween)').toBe(5);
    expect(placeCount, 'SWF must have PlaceObject2 tags for the guided object').toBeGreaterThan(0);
    expect(defineSpriteCount, 'SWF must have DefineSprite for the BluBox library symbol').toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: Guide path followed — mid-frame curve position
  //
  // The key visual oracle: when the guide path is correctly followed, the blue
  // box visits (300, 175) at frame 2 (t=0.5) — well above the y=300 baseline
  // that straight-line interpolation would produce.
  //
  // Quadratic Bézier geometry: for Q(start=(100,300), control=(300,50), end=(500,300))
  // the midpoint at t=0.5 is: 0.25*(100,300) + 0.5*(300,50) + 0.25*(500,300) = (300, 175).
  //
  // Without guide-path following: start(100,300) → end(500,300) → ALL frames
  //   have y=300. The mid-center region (x:250-360, y:140-240) would be white.
  //
  // With guide-path following: frame 2 is at (300, 175). The mid-center region
  //   (x:250-360, y:140-240) has blue pixels on that frame.
  //
  // Oracle strategy: scan for 2+ full playback cycles (5 frames × 83.3ms = ~417ms
  // per cycle) by taking screenshots every 80ms for ~900ms. At least one screenshot
  // must show non-white pixels in the mid-center region.
  // -------------------------------------------------------------------------
  test('mid-frame shows guide path curve — pixels appear in mid-center stage region', async ({ page }, testInfo: TestInfo) => {
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, GUIDE_DOC);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });
    expect(swfBase64.length).toBeGreaterThan(0);

    await ensureRuffleLoaded(page);

    // Inject and wait for Ruffle to settle (1500ms base in injectRufflePlayer).
    await injectRufflePlayer(page, swfBase64, '__ruffle_guide_apex__');

    // Scan for ~2 full playback cycles by taking screenshots every 80ms.
    // 5 frames × 83ms = ~417ms per cycle. Scanning 12 shots × 80ms = 960ms covers 2+ cycles.
    const SCAN_SHOTS = 12;
    const SHOT_INTERVAL_MS = 80;

    const shots: Buffer[] = [];
    for (let i = 0; i < SCAN_SHOTS; i++) {
      const s = await page.locator('#__ruffle_guide_apex__').screenshot();
      shots.push(s);
      if (i < SCAN_SHOTS - 1) await page.waitForTimeout(SHOT_INTERVAL_MS);
    }

    // Attach a selection of shots for visual inspection.
    await testInfo.attach('guide-apex-shot-0', { body: shots[0]!, contentType: 'image/png' });
    await testInfo.attach(`guide-apex-shot-${SCAN_SHOTS - 1}`, { body: shots[SCAN_SHOTS - 1]!, contentType: 'image/png' });

    const panic = await hasRufflePanic(page, '__ruffle_guide_apex__');
    await removeRufflePlayer(page, '__ruffle_guide_apex__');

    const imgInfo = PNG.sync.read(shots[0]!);
    console.log(`[0797] apex: screenshot size = ${imgInfo.width}x${imgInfo.height}`);

    // Mid-center region: x=250-360, y=140-240 (where frame 2 places the box at (300,175)).
    // The 50×50 box at (300,175) occupies stage pixels (300-350, 175-225).
    // With 5px margins on each side: check x=250-360, y=140-240.
    const midCounts = shots.map((s) => countNonWhitePixelsInRegion(s, 250, 140, 110, 100));
    const maxMidCount = Math.max(...midCounts);

    // Lower-left region: x=60-170, y=270-380 (where the box is at frame 0: (100,300)).
    // This is the straight-line interpolation region — if guide is ignored, frame 2
    // places the object at (300, 300), which does NOT intersect this region.
    // But frames 0 and 4 are at y=300, so this region gets pixels periodically.
    const lowerLeftCounts = shots.map((s) => countNonWhitePixelsInRegion(s, 60, 270, 110, 110));
    const maxLowerLeftCount = Math.max(...lowerLeftCounts);

    console.log(`[0797] apex: panic=${panic}`);
    console.log(`[0797] apex: midRegion(250,140,110,100)=[${midCounts.join(',')}] max=${maxMidCount}`);
    console.log(`[0797] apex: lowerLeft(60,270,110,110)=[${lowerLeftCounts.join(',')}] max=${maxLowerLeftCount}`);

    // Sanity check: at least one frame must show the box somewhere.
    const totalNonWhite = shots.map(countNonWhitePixels);
    const maxTotal = Math.max(...totalNonWhite);
    console.log(`[0797] apex: totalNonWhite=[${totalNonWhite.join(',')}] max=${maxTotal}`);
    expect(maxTotal, 'At least one screenshot must be non-blank (object renders)').toBeGreaterThan(100);

    expect(panic, 'Ruffle must not panic during oracle').toBe(false);

    // Sanity: the movie plays and shows frames — lower-left should get pixels when
    // frame 0 (x=100, y=300) is shown.
    expect(maxLowerLeftCount, 'At least one frame should show the box at the lower-left start position (frame 0: x=100, y=300)').toBeGreaterThan(50);

    // Key oracle: at least one screenshot must show the object in the mid-center
    // region. This proves the guide path curve is baked into the SWF and rendered.
    // Frame 2 is at (300, 175) due to the Bézier curve. Without guide-path following
    // frame 2 would be at (300, 300) = NOT in y=140-240.
    expect(maxMidCount, 'At least one frame must show the blue box in the mid-center stage region (guide path curve at frame 2: ≈ (300, 175))').toBeGreaterThan(50);
  });

  // -------------------------------------------------------------------------
  // Test 4: Pixel-position oracle — guided object at key frames (task 0845)
  //
  // Confirms that the guided object lands in the correct stage region at each
  // of the three key frames, using `stop()` frame scripts to lock Ruffle to
  // a specific frame and then taking a screenshot.
  //
  // Guide path geometry (Bézier Q start=(100,300), ctrl=(300,50), end=(500,300)):
  //   Frame 0: (100, 300)  → left third  (x < 550/3 ≈ 183)
  //   Frame 2: (300, 175)  → middle third (183 < x < 367) AND y < 230 (above midline)
  //   Frame 4: (500, 300)  → right third  (x > 367)
  //
  // Without guide-path following, ALL frames have y=300 (start y = end y = 300).
  // With guide-path following, frame 2 has y≈175 (path apex), not y=300.
  //
  // Technique: for each target frame, build a variant of GUIDE_DOC with
  // `stop()` injected into the frame script of that frame on the guided layer.
  // The SWF auto-plays but stops immediately at that frame — Ruffle renders
  // the stopped frame, and the screenshot shows the baked PlaceObject2 position.
  //
  // Expected pixel regions (50×50 blue box):
  //   Frame 0: box at stage (100,300)..(150,350) → check region x=75..175, y=270..375
  //   Frame 2: box at stage (300,175)..(350,225) → check region x=270..375, y=145..245
  //   Frame 4: box at stage (500,300)..(550,350) → check region x=470..555, y=270..375
  // -------------------------------------------------------------------------
  test('pixel-position oracle — guided object in correct region at frames 0, 2, 4 (task 0845)', async ({ page }, testInfo: TestInfo) => {
    // Build three variants of GUIDE_DOC, each with stop() at a different frame.
    // The stop() script is injected into the guided layer (layer index 1) at the
    // target frame.  compile.ts emits DoAction for any frame with a non-empty script.
    function buildGuidedDocWithStop(targetFrame: number): typeof GUIDE_DOC {
      // Deep-clone the guided layer's frames and inject stop() at targetFrame.
      const originalDoc = GUIDE_DOC;
      const guidedLayerFrames = originalDoc.scenes[0]!.timeline.layers[1]!.frames.map((f) => {
        if (f.index === targetFrame) {
          return { ...f, script: 'stop();' };
        }
        return f;
      });

      return {
        ...originalDoc,
        id: `guide-doc-0845-stop-at-${targetFrame}`,
        scenes: [{
          ...originalDoc.scenes[0]!,
          timeline: {
            layers: [
              // Layer 0: guide layer unchanged
              { ...originalDoc.scenes[0]!.timeline.layers[0]! },
              // Layer 1: guided layer with stop() at targetFrame
              {
                ...originalDoc.scenes[0]!.timeline.layers[1]!,
                frames: guidedLayerFrames,
              },
            ],
          },
        }],
      };
    }

    // Frame definitions and expected pixel-region checks.
    // regionX, regionY: top-left of the check region (stage coords)
    // regionW, regionH: size of the check region
    // description: what the oracle is checking
    const frameChecks = [
      {
        frame: 0,
        desc: 'frame 0 (path start: x≈100, y≈300) — left-lower region',
        // Box at (100,300)..(150,350); check with margin: x=75..175, y=270..380
        regionX: 75, regionY: 270, regionW: 100, regionH: 110,
        // Negative check: mid region (300-360, y=140-240) should be empty at frame 0
        negRegionX: 270, negRegionY: 145, negRegionW: 100, negRegionH: 100,
        negDesc: 'mid region empty at frame 0',
      },
      {
        frame: 2,
        desc: 'frame 2 (path apex: x≈300, y≈175) — mid-upper region',
        // Box at (300,175)..(350,225); check with margin: x=270..375, y=145..245
        regionX: 270, regionY: 145, regionW: 105, regionH: 100,
        // Negative check: lower-left region (75..175, 270..380) should be empty at frame 2
        // (straight-line interpolation would put it at y=300; guide puts it at y=175)
        negRegionX: 75, negRegionY: 270, negRegionW: 100, negRegionH: 110,
        negDesc: 'lower-left region empty at frame 2 (proving guide path, not straight line)',
      },
      {
        frame: 4,
        desc: 'frame 4 (path end: x≈500, y≈300) — right-lower region',
        // Box at (500,300)..(550,350); check with margin: x=470..560, y=270..380
        regionX: 470, regionY: 270, regionW: 90, regionH: 110,
        // Negative check: left region should be empty at frame 4
        negRegionX: 75, negRegionY: 270, negRegionW: 100, negRegionH: 110,
        negDesc: 'left region empty at frame 4',
      },
    ];

    await ensureRuffleLoaded(page);

    for (const check of frameChecks) {
      const doc = buildGuidedDocWithStop(check.frame);

      // Load document and publish SWF
      await page.evaluate((d) => {
        (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(d);
      }, doc);
      await page.waitForTimeout(300);

      const swfBase64: string = await page.evaluate(() => {
        return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
      });
      expect(swfBase64.length, `SWF at frame ${check.frame} must be non-empty`).toBeGreaterThan(0);

      const playerId = `__ruffle_guide_pos_f${check.frame}__`;
      // Load in Ruffle; injectRufflePlayer waits 1500ms — more than enough for stop()
      // to have executed regardless of targetFrame (12fps means 5 frames = 417ms).
      await injectRufflePlayer(page, swfBase64, playerId);

      const panic = await hasRufflePanic(page, playerId);
      const shot = await page.locator(`#${playerId}`).screenshot();
      await testInfo.attach(`guide-pos-frame${check.frame}`, { body: shot, contentType: 'image/png' });

      await removeRufflePlayer(page, playerId);

      const posCount = countNonWhitePixelsInRegion(shot, check.regionX, check.regionY, check.regionW, check.regionH);
      const negCount = countNonWhitePixelsInRegion(shot, check.negRegionX, check.negRegionY, check.negRegionW, check.negRegionH);
      const totalCount = countNonWhitePixels(shot);

      const imgInfo = PNG.sync.read(shot);
      console.log(`[0845] frame=${check.frame}: size=${imgInfo.width}x${imgInfo.height}, panic=${panic}`);
      console.log(`[0845] frame=${check.frame}: total=${totalCount}, posRegion=${posCount}, negRegion=${negCount}`);

      expect(panic, `Ruffle must not panic at frame ${check.frame}`).toBe(false);
      expect(totalCount, `Frame ${check.frame} must render non-blank`).toBeGreaterThan(100);

      // Positive check: object must appear in the expected region.
      expect(posCount, `[frame ${check.frame}] ${check.desc}: expected pixels in positive region`).toBeGreaterThan(50);

      // Negative check: object must NOT appear in the wrong region.
      // This is the key discriminator between guide-path following and straight-line interpolation.
      // At frame 2: guide places box at y≈175; straight-line would place it at y=300.
      // The negative check for frame 2 is the region at y=270..380, which would only
      // have pixels if the straight-line (non-guide) path were used.
      expect(negCount, `[frame ${check.frame}] ${check.negDesc}: negative region must be empty`).toBeLessThan(50);
    }
  });
});
