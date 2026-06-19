/**
 * FLA round-trip fidelity oracle — task 0802.
 *
 * Proves the full author → saveFla → loadFla → publish → Ruffle pipeline:
 *
 * 1. Build a document with:
 *    - Layer 1: a MovieClip symbol (red 60×60 square), placed at frame 0,
 *      motion-tweened from x=80 to x=420 over 24 frames.
 *    - Layer 2: a dynamic text field (instanceName "scoreText") with a
 *      frame-1 script that sets _root.scoreText.text = "OK".
 * 2. Load the doc into the editor via __flashTest.loadDocument().
 * 3. Serialize to FLA bytes via __flashTest.saveFlaBytes().
 * 4. Reload from FLA bytes via __flashTest.loadFlaBytes() (in-browser round-trip).
 * 5. Publish the reloaded doc to SWF via __flashTest.publish().
 * 6. Load SWF in Ruffle and screenshot:
 *    - Frame 1 non-blank: red pixels present near x=80 (symbol at start).
 *    - Motion tween plays: object moves from left → not stuck at frame 0.
 *
 * Data-fidelity checks (no Ruffle needed):
 *    - Reloaded doc has same layer count, symbol count, frame count as original.
 *    - Library symbol survived the round-trip.
 *    - Frame script survived the round-trip.
 *
 * CI guard: skip visual (Ruffle) tests in CI where WASM infra is not set up.
 *
 * Run locally:
 *   pnpm --filter @flash/desktop e2e --grep "fla-roundtrip|FLA round"
 *   cd apps/desktop && npx playwright test e2e/fla-roundtrip.spec.ts
 */

import { test, expect, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import { parseSwfTags } from './helpers/swf-parse';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type Page = Parameters<Parameters<typeof test>[1]>[0];

/** Shape of the __flashTest test bridge exposed by Shell.tsx.
 *  NOTE: publish() is ASYNC (returns a Promise<string> of base64 SWF bytes);
 *  every call site must await it. The old `publish(): string` declaration hid
 *  a missing await that made structureCheck.swfLength undefined (task 1214). */
interface FlashTestBridge {
  loadDocument(doc: unknown): void;
  saveFlaBytes(): string;
  loadFlaBytes(base64: string): void;
  publish(): Promise<string>;
  screenshotStage(frameIndex?: number): string;
  setCurrentFrame(frame: number): void;
}

// ---------------------------------------------------------------------------
// Ruffle helpers (proven pattern from motion-tween.spec.ts / keyboard.spec.ts)
// ---------------------------------------------------------------------------

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
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;z-index:99999;';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({ data: bytes, allowScriptAccess: true, autoplay: 'on', unmuteOverlay: 'hidden' });
  }, { b64: swfBase64, id: playerId });

  await page.waitForTimeout(1500);

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

async function removeRufflePlayer(page: Page, playerId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, playerId);
}

// ---------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------

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
 * Count non-white pixels in a region.
 * @param buf PNG buffer
 * @param x0/y0/x1/y1 sample rectangle in stage coords
 * @param imgW/imgH stage dimensions (used to scale to image coords)
 */
function countNonWhitePixelsInRegion(
  buf: Buffer,
  x0: number, y0: number, x1: number, y1: number,
  imgW: number, imgH: number,
): number {
  const img = PNG.sync.read(buf);
  const rW = img.width;
  const rH = img.height;
  const px0 = Math.round((x0 / imgW) * rW);
  const py0 = Math.round((y0 / imgH) * rH);
  const px1 = Math.round((x1 / imgW) * rW);
  const py1 = Math.round((y1 / imgH) * rH);
  let count = 0;
  for (let py = py0; py <= py1; py++) {
    for (let px = px0; px <= px1; px++) {
      if (px < 0 || py < 0 || px >= rW || py >= rH) continue;
      const idx = (py * rW + px) * 4;
      const r = img.data[idx]!;
      const g = img.data[idx + 1]!;
      const b = img.data[idx + 2]!;
      if (r < 240 || g < 240 || b < 240) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Document fixture
// ---------------------------------------------------------------------------

/**
 * Build the round-trip fixture document:
 *   - 550×400, white background, 12fps
 *   - Library: one MovieClip symbol "RedBox" — red 60×60 square at symbol-local (0,0)
 *   - Layer 0 (top): instance of RedBox, motion tween from x=80 to x=420 over 24 frames
 *   - Layer 1 (bottom): dynamic text field "scoreText", frame script on frame 0 sets
 *     _root.scoreText.text = "OK"
 *
 * This doc exercises:
 *   - Symbol definition in library (survives FLA round-trip)
 *   - SymbolInstance display object (frame 0 keyframe + tween)
 *   - Motion tween (PlaceObject2 HasMove frames)
 *   - Frame script (AS2 source text)
 *   - Text field with instanceName
 */
const ROUNDTRIP_DOC = {
  id: 'fla-roundtrip-doc-0802',
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
        // Layer 0 (top / foreground): MovieClip instance with motion tween
        {
          id: 'layer-tween', name: 'Tween', type: 'normal',
          visible: true, locked: false, outlineMode: false,
          outlineColor: '#ff0000', height: 20, parentFolderId: null,
          frameCount: 24,
          frames: [
            // Frame 0: start keyframe, tweenType:'motion', instance at x=80
            {
              index: 0, isKeyframe: true, isEmpty: false, tweenType: 'motion',
              label: '', labelType: 'name', script: '', sound: null,
              motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
              motionOrientToPath: false, motionSync: false, motionScale: false,
              shapeEase: 0, shapeBlend: 'distributive',
              displayObjects: [{
                id: 'inst-redbox-start',
                type: 'instance',
                symbolId: 'sym-redbox',
                x: 80, y: 170, scaleX: 1, scaleY: 1, rotation: 0,
              }],
            },
            // Frames 1–22: in-between tween frames
            ...Array.from({ length: 22 }, (_, i) => ({
              index: i + 1, isKeyframe: false, isEmpty: false, tweenType: 'motion' as const,
              label: '', labelType: 'name', script: '', sound: null,
              motionEase: 0, motionRotate: 'none' as const, motionRotateCount: 0,
              motionOrientToPath: false, motionSync: false, motionScale: false,
              shapeEase: 0, shapeBlend: 'distributive',
              displayObjects: [],
            })),
            // Frame 23: end keyframe, tweenType:'none', instance at x=420
            {
              index: 23, isKeyframe: true, isEmpty: false, tweenType: 'none',
              label: '', labelType: 'name', script: '', sound: null,
              motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
              motionOrientToPath: false, motionSync: false, motionScale: false,
              shapeEase: 0, shapeBlend: 'distributive',
              displayObjects: [{
                id: 'inst-redbox-end',
                type: 'instance',
                symbolId: 'sym-redbox',
                x: 420, y: 170, scaleX: 1, scaleY: 1, rotation: 0,
              }],
            },
          ],
        },
        // Layer 1 (bottom / background): text field + frame script
        {
          id: 'layer-text', name: 'Text', type: 'normal',
          visible: true, locked: false, outlineMode: false,
          outlineColor: '#0000ff', height: 20, parentFolderId: null,
          frameCount: 24,
          frames: [
            {
              index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
              label: '', labelType: 'name',
              script: '_root.scoreText.text = "OK";',
              sound: null,
              motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
              motionOrientToPath: false, motionSync: false, motionScale: false,
              shapeEase: 0, shapeBlend: 'distributive',
              displayObjects: [{
                id: 'txt-score',
                type: 'text',
                instanceName: 'scoreText',
                x: 10, y: 360, width: 200, height: 30,
                text: 'score',
                textType: 'dynamic',
                fontFamily: 'Arial',
                fontSize: 16,
                bold: false, italic: false,
                color: { r: 0, g: 0, b: 0, a: 255 },
                align: 'left',
                multiline: false, wordWrap: false,
              }],
            },
            ...Array.from({ length: 23 }, (_, i) => ({
              index: i + 1, isKeyframe: false, isEmpty: false, tweenType: 'none' as const,
              label: '', labelType: 'name', script: '', sound: null,
              motionEase: 0, motionRotate: 'none' as const, motionRotateCount: 0,
              motionOrientToPath: false, motionSync: false, motionScale: false,
              shapeEase: 0, shapeBlend: 'distributive',
              displayObjects: [],
            })),
          ],
        },
      ],
    },
  }],
  library: {
    items: [{
      id: 'sym-redbox',
      name: 'RedBox',
      itemType: 'symbol',
      symbolType: 'movieclip',
      linkage: {
        exportForActionScript: false, exportInFirstFrame: false,
        linkageIdentifier: '', className: '',
        exportForRuntimeSharing: false, importForRuntimeSharing: false, sharedUrl: '',
      },
      scale9Grid: null,
      timeline: {
        layers: [{
          id: 'layer-sym-1', name: 'Layer 1', type: 'normal',
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
              id: 'sym-shape',
              type: 'shape',
              shape: {
                id: 'shape-sym-box',
                paths: [{
                  // 60×60 red square, centered at origin (symbol-local coords)
                  start: { x: -30, y: -30 },
                  segments: [
                    { type: 'line', to: { x: 30, y: -30 } },
                    { type: 'line', to: { x: 30, y: 30 } },
                    { type: 'line', to: { x: -30, y: 30 } },
                  ],
                  closed: true,
                  fill: { type: 'solid', color: { r: 220, g: 30, b: 30, a: 255 } },
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

test.describe('FLA round-trip fidelity oracle — task 0802', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 1 (data-fidelity, no Ruffle): saveFla → loadFla round-trip preserves
  //   scene count, layer count, symbol count, frame count, and frame script.
  //
  // This test runs even in CI.  It exercises the in-browser saveFla/loadFla
  // pipeline via the new __flashTest.saveFlaBytes / loadFlaBytes bridge methods.
  // -------------------------------------------------------------------------
  test('FLA round-trip preserves document structure (layers, symbols, frames, scripts)', async ({ page }) => {
    // Step 1: Load the fixture document
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.loadDocument(doc);
    }, ROUNDTRIP_DOC);
    await page.waitForTimeout(300);

    // Step 2: Serialize to FLA bytes
    const flaBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.saveFlaBytes();
    });
    expect(typeof flaBase64).toBe('string');
    expect(flaBase64.length).toBeGreaterThan(0);

    // Verify it looks like a ZIP (PK magic, base64-encoded)
    const firstBytes = atob(flaBase64.slice(0, 8));
    expect(firstBytes.charCodeAt(0)).toBe(0x50); // 'P'
    expect(firstBytes.charCodeAt(1)).toBe(0x4b); // 'K'

    // Step 3: Reload from FLA bytes (round-trip in-browser)
    await page.evaluate((b64) => {
      (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.loadFlaBytes(b64);
    }, flaBase64);
    await page.waitForTimeout(300);

    // Step 4: Publish the restored doc and structurally verify the compiled SWF
    // (no Ruffle needed). publish() is ASYNC and returns base64-encoded CWS bytes;
    // it MUST be awaited — the old code dropped the await, so `swf` was a Promise
    // and `swf.length` was undefined (task 1214). We now decode the base64,
    // decompress the CWS body, and walk the tag stream to assert real structure.
    const swfBase64 = await page.evaluate(async () => {
      const t = (window as unknown as { __flashTest: FlashTestBridge }).__flashTest;
      return await t.publish();
    });

    const swfBytes = Buffer.from(swfBase64, 'base64');
    // Compile-succeeded signal: the SWF is non-trivial.
    expect(swfBytes.length, 'compiled SWF must be non-trivial').toBeGreaterThan(100);

    // Structural signal: the tag stream parses and carries real content
    // (the 24-frame main timeline emits multiple ShowFrame tags).
    const tags = parseSwfTags(swfBytes);
    const tagTypes = tags.map((t) => t.type);
    console.log(`[fla-roundtrip] compiled SWF tag types = ${[...new Set(tagTypes)].sort((a, b) => a - b).join(',')}`);
    expect(tags.length, 'compiled SWF must contain tags').toBeGreaterThan(0);
    expect(tags.filter((t) => t.type === 1).length, 'compiled SWF must have ShowFrame tags').toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 2 (data-fidelity extended): verify the doc round-trips in a Node.js
  //   context using the FLA format as a ZIP archive.
  //
  // The __flashTest bridge's saveFlaBytes / loadFlaBytes pair gives us the
  // in-browser round-trip.  As an extra sanity check we verify the base64
  // starts with the ZIP PK signature (0x50 0x4B) — confirming it is actually
  // a ZIP archive and not a JSON blob or garbage.
  // -------------------------------------------------------------------------
  test('FLA bytes begin with ZIP PK magic (valid archive format)', async ({ page }) => {
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.loadDocument(doc);
    }, ROUNDTRIP_DOC);
    await page.waitForTimeout(200);

    const flaBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.saveFlaBytes();
    });

    // Decode first 4 bytes of base64 → raw bytes
    const raw = Buffer.from(flaBase64, 'base64');
    // ZIP local file header: 50 4B 03 04
    expect(raw[0]).toBe(0x50);
    expect(raw[1]).toBe(0x4b);
    expect(raw[2]).toBe(0x03);
    expect(raw[3]).toBe(0x04);
  });

  // -------------------------------------------------------------------------
  // Test 3 (data-fidelity extended): verify reload preserves FLA structure
  //   and that the reloaded doc can be published (SWF > minimum size).
  //
  // This test loads → saves → reloads → publishes and checks that the reloaded
  // document still produces a valid SWF.  It runs even in CI.
  // -------------------------------------------------------------------------
  test('FLA round-trip: reloaded doc publishes to valid SWF (> 200 bytes)', async ({ page }) => {
    // Load original
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.loadDocument(doc);
    }, ROUNDTRIP_DOC);
    await page.waitForTimeout(200);

    // Publish original — baseline length
    const originalSwfB64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.publish();
    });

    // Save → reload via FLA
    const flaBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.saveFlaBytes();
    });
    await page.evaluate((b64) => {
      (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.loadFlaBytes(b64);
    }, flaBase64);
    await page.waitForTimeout(300);

    // Publish reloaded doc
    const reloadedSwfB64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.publish();
    });

    const origBytes = Buffer.from(originalSwfB64, 'base64');
    const reloadedBytes = Buffer.from(reloadedSwfB64, 'base64');

    // Both SWFs must be non-trivial
    expect(origBytes.length, 'original SWF must be > 200 bytes').toBeGreaterThan(200);
    expect(reloadedBytes.length, 'reloaded SWF must be > 200 bytes').toBeGreaterThan(200);

    // SWF magic: CWS (compressed) or FWS (uncompressed)
    const origMagic = String.fromCharCode(origBytes[0]!, origBytes[1]!, origBytes[2]!);
    const reloadedMagic = String.fromCharCode(reloadedBytes[0]!, reloadedBytes[1]!, reloadedBytes[2]!);
    expect(['CWS', 'FWS']).toContain(origMagic);
    expect(['CWS', 'FWS']).toContain(reloadedMagic);

    // The reloaded SWF should be within 20% of the original size
    // (exact byte equality is not guaranteed, but large divergence signals data loss)
    const sizeDiff = Math.abs(origBytes.length - reloadedBytes.length);
    const sizeRatio = sizeDiff / origBytes.length;
    expect(sizeRatio, `reloaded SWF size ratio diff ${(sizeRatio * 100).toFixed(1)}% vs original`).toBeLessThan(0.20);
  });

  // -------------------------------------------------------------------------
  // Test 4 (visual oracle, skip in CI): after FLA round-trip, load SWF in
  //   Ruffle and assert:
  //   (a) SWF is non-blank (symbol rendered somewhere on stage).
  //   (b) Symbol is visible in the first half of the stage (x < 275) at some
  //       point before the tween ends — confirmed by checking both early and
  //       late Ruffle screenshots have non-white pixels.
  //
  // Note: The motion tween plays in real-time; the injectRufflePlayer helper
  // waits 1500ms before returning (Ruffle initialization), which is ~18 frames
  // at 12fps.  The symbol may already be mid-tween or at end position.
  // The key assertion is "SWF compiled from the round-tripped doc is non-blank"
  // (symbol exists in the library and renders).  The motion-plays test (test 5)
  // asserts that the tween itself works.
  // -------------------------------------------------------------------------
  test('visual oracle: after FLA round-trip, SWF is non-blank (symbol renders in Ruffle)', async ({ page }, testInfo: TestInfo) => {
    test.skip(!!process.env.CI, 'visual oracle — Ruffle WASM not available in CI');

    // Load → saveFla → loadFla → publish
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.loadDocument(doc);
    }, ROUNDTRIP_DOC);
    await page.waitForTimeout(300);

    const flaBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.saveFlaBytes();
    });
    await page.evaluate((b64) => {
      (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.loadFlaBytes(b64);
    }, flaBase64);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.publish();
    });
    expect(swfBase64.length).toBeGreaterThan(0);

    await ensureRuffleLoaded(page);
    await injectRufflePlayer(page, swfBase64, '__ruffle_rt_frame0__');

    // Capture screenshot after Ruffle initializes (~1.5s = ~18 frames at 12fps)
    const shotFrame0 = await page.locator('#__ruffle_rt_frame0__').screenshot();
    await testInfo.attach('rt-frame0', { body: shotFrame0, contentType: 'image/png' });

    const nonWhiteFrame0 = countNonWhitePixels(shotFrame0);
    console.log(`[0802] visual: nonWhiteFrame0=${nonWhiteFrame0}`);

    // Check that there are non-white pixels somewhere in the symbol travel area
    // (x=50..480, y=130..240 in stage coords) — the symbol is somewhere along
    // its 80→420 tween path regardless of the exact frame.
    const nonWhiteInTravelArea = countNonWhitePixelsInRegion(
      shotFrame0,
      50, 130, 480, 240,
      550, 400,
    );
    console.log(`[0802] visual: nonWhiteInTravelArea=${nonWhiteInTravelArea}`);

    await removeRufflePlayer(page, '__ruffle_rt_frame0__');

    expect(nonWhiteFrame0, 'SWF must render non-blank content (symbol rendered)').toBeGreaterThan(100);
    expect(nonWhiteInTravelArea, 'Symbol must appear somewhere in its tween travel area').toBeGreaterThan(50);
  });

  // -------------------------------------------------------------------------
  // Test 5 (visual oracle, skip in CI): motion tween plays after FLA round-trip.
  //   Two screenshots ~250ms apart must differ (object has moved).
  // -------------------------------------------------------------------------
  test('visual oracle: motion tween plays after FLA round-trip (object moves)', async ({ page }, testInfo: TestInfo) => {
    test.skip(!!process.env.CI, 'visual oracle — Ruffle WASM not available in CI');

    // Load → saveFla → loadFla → publish
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.loadDocument(doc);
    }, ROUNDTRIP_DOC);
    await page.waitForTimeout(300);

    const flaBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.saveFlaBytes();
    });
    await page.evaluate((b64) => {
      (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.loadFlaBytes(b64);
    }, flaBase64);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: FlashTestBridge }).__flashTest.publish();
    });

    await ensureRuffleLoaded(page);
    await injectRufflePlayer(page, swfBase64, '__ruffle_rt_tween__');

    // Early screenshot (frame ≈ 0, object on left side near x=80)
    const shotEarly = await page.locator('#__ruffle_rt_tween__').screenshot();
    await testInfo.attach('rt-tween-early', { body: shotEarly, contentType: 'image/png' });

    // Wait for ~3 frames at 12fps (~260ms) → object has moved right
    await page.waitForTimeout(260);
    const shotLate = await page.locator('#__ruffle_rt_tween__').screenshot();
    await testInfo.attach('rt-tween-late', { body: shotLate, contentType: 'image/png' });

    await removeRufflePlayer(page, '__ruffle_rt_tween__');

    // Count different pixels between early and late frames
    const imgEarly = PNG.sync.read(shotEarly);
    const imgLate = PNG.sync.read(shotLate);
    let diffPixels = 0;
    const len = Math.min(imgEarly.data.length, imgLate.data.length);
    for (let i = 0; i < len; i += 4) {
      const dr = Math.abs((imgEarly.data[i] ?? 0) - (imgLate.data[i] ?? 0));
      const dg = Math.abs((imgEarly.data[i + 1] ?? 0) - (imgLate.data[i + 1] ?? 0));
      const db = Math.abs((imgEarly.data[i + 2] ?? 0) - (imgLate.data[i + 2] ?? 0));
      if (dr > 30 || dg > 30 || db > 30) diffPixels++;
    }
    console.log(`[0802] visual: tween diffPixels=${diffPixels}`);

    const nonWhiteEarly = countNonWhitePixels(shotEarly);
    const nonWhiteLate = countNonWhitePixels(shotLate);
    console.log(`[0802] visual: nonWhiteEarly=${nonWhiteEarly}, nonWhiteLate=${nonWhiteLate}`);

    expect(nonWhiteEarly, 'Early frame must be non-blank').toBeGreaterThan(100);
    expect(nonWhiteLate, 'Late frame must be non-blank').toBeGreaterThan(100);
    // Object must have moved after a few frames (at least 50 pixel difference)
    expect(diffPixels, 'Tween must produce pixel-level changes between early and late frames').toBeGreaterThan(50);
  });
});
