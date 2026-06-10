/**
 * Interactivity oracle: drive compiled SWF in Ruffle with synthesized mouse input.
 *
 * This suite compiles SWFs that contain interactive elements (buttons, frame scripts),
 * loads them into the Ruffle player, dispatches synthesized events, and asserts that
 * the resulting screen state changed as expected.
 *
 * Builds on the same infrastructure as the visual oracle (port 1420, Ruffle on-screen,
 * deviceScaleFactor:1). Unlike the visual oracle, we assert on *change* caused by
 * synthesized input — the interactivity oracle.
 *
 * Run locally with:
 *   pnpm --filter @flash/desktop e2e --reporter=line
 *   cd apps/desktop && npx playwright test e2e/interactivity.spec.ts --reporter=line
 */

import { test, expect, TestInfo } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Bootstrap the Ruffle WASM runtime if not already loaded.
 */
async function ensureRuffleLoaded(
  page: Parameters<Parameters<typeof test>[1]>[0]
): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) {
        resolve();
        return;
      }
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
 * Inject a Ruffle player that loads the given SWF bytes (base64 encoded).
 * Must be on-screen (top:0;left:0) for Chromium to composite screenshots correctly.
 */
async function injectRufflePlayer(
  page: Parameters<Parameters<typeof test>[1]>[0],
  swfBase64: string,
  playerId = '__ruffle_interact_player__'
): Promise<void> {
  await page.evaluate(({ b64, id }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      ruffle(): { load(opts: {
        data?: Uint8Array;
        url?: string;
        allowScriptAccess?: boolean;
      }): Promise<void> }
    };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = id;
    player.style.cssText =
      'position:fixed;top:0;left:0;width:550px;height:400px;z-index:99999;';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({ data: bytes, allowScriptAccess: true });
  }, { b64: swfBase64, id: playerId });
}

/** Remove the injected Ruffle player element. */
async function removeRufflePlayer(
  page: Parameters<Parameters<typeof test>[1]>[0],
  playerId = '__ruffle_interact_player__'
): Promise<void> {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, playerId);
}

/** Capture a screenshot of the Ruffle player element. */
async function screenshotPlayer(
  page: Parameters<Parameters<typeof test>[1]>[0],
  playerId = '__ruffle_interact_player__'
): Promise<Buffer> {
  return page.locator(`#${playerId}`).screenshot();
}

/**
 * Count how many pixels differ between two PNG screenshot buffers.
 */
function countDifferentPixels(a: Buffer, b: Buffer): number {
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);
  const { width, height } = imgA;

  let bData = imgB.data;
  if (imgB.width !== width || imgB.height !== height) {
    const resized = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcX = Math.round((x / width) * imgB.width);
        const srcY = Math.round((y / height) * imgB.height);
        const srcIdx = (srcY * imgB.width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;
        resized[dstIdx]     = imgB.data[srcIdx];
        resized[dstIdx + 1] = imgB.data[srcIdx + 1];
        resized[dstIdx + 2] = imgB.data[srcIdx + 2];
        resized[dstIdx + 3] = imgB.data[srcIdx + 3];
      }
    }
    bData = resized;
  }

  const diff = new PNG({ width, height });
  return pixelmatch(imgA.data, bData, diff.data, width, height, { threshold: 0.1 });
}

// Helper to build a full-stage invisible rectangle shape display object
function makeInvisibleFullStageRect(id: string) {
  return {
    id, type: 'shape',
    shape: {
      id: `shape-${id}`,
      paths: [{
        start: { x: 0, y: 0 },
        segments: [
          { type: 'line', to: { x: 550, y: 0 } },
          { type: 'line', to: { x: 550, y: 400 } },
          { type: 'line', to: { x: 0, y: 400 } },
        ],
        closed: true,
        fill: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 0 } },
      }],
    },
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  };
}

// Helper to build a full-stage opaque rectangle (for button hit states)
function makeOpaqueFullStageRect(id: string) {
  return {
    id, type: 'shape',
    shape: {
      id: `shape-${id}`,
      paths: [{
        start: { x: 0, y: 0 },
        segments: [
          { type: 'line', to: { x: 550, y: 0 } },
          { type: 'line', to: { x: 550, y: 400 } },
          { type: 'line', to: { x: 0, y: 400 } },
        ],
        closed: true,
        fill: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 255 } },
      }],
    },
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  };
}

// Helper to build a 100x100 color rectangle at stage center
function makeColorRect(id: string, r: number, g: number, b: number) {
  return {
    id, type: 'shape',
    shape: {
      id: `shape-${id}`,
      paths: [{
        start: { x: 225, y: 150 },
        segments: [
          { type: 'line', to: { x: 325, y: 150 } },
          { type: 'line', to: { x: 325, y: 250 } },
          { type: 'line', to: { x: 225, y: 250 } },
        ],
        closed: true,
        fill: { type: 'solid', color: { r, g, b, a: 255 } },
      }],
    },
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  };
}

// Helper to build a full button symbol with 4 states (Up/Over/Down/Hit)
function makeFullStageButton(
  id: string,
  name: string,
  buttonActions: Array<{ event: string; script: string }>,
  upShape: object,
  overShape: object,
  downShape: object,
) {
  return {
    id, name,
    itemType: 'symbol',
    symbolType: 'button',
    linkage: { exportForActionScript: false, exportInFirstFrame: false, linkageIdentifier: '', className: '', exportForRuntimeSharing: false, importForRuntimeSharing: false, sharedUrl: '' },
    scale9Grid: null,
    buttonActions,
    timeline: {
      layers: [{
        id: `${id}-layer`, name: 'Layer 1', type: 'normal',
        visible: true, locked: false, outlineMode: false,
        outlineColor: '#ff0000', height: 20, parentFolderId: null,
        frameCount: 4,
        frames: [
          {
            index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '',
            sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [upShape],
          },
          {
            index: 1, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '',
            sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [overShape],
          },
          {
            index: 2, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '',
            sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [downShape],
          },
          {
            index: 3, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '',
            sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [makeOpaqueFullStageRect(`${id}-hit`)],
          },
        ],
      }],
    },
  };
}

// Helper to build a simple two-frame document (red on frame 0, blue on frame 1)
// with a button layer on top.
function makeTwoFrameDoc(
  docId: string,
  buttonLayerId: string,
  btnInst1Id: string,
  btnInst2Id: string,
  symbolId: string,
  bgLayerId: string,
  redId: string,
  blueId: string,
  buttonSymbol: object,
  frame0Script = 'stop();',
) {
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
        layers: [
          {
            id: buttonLayerId, name: 'Buttons', type: 'normal',
            visible: true, locked: false, outlineMode: false,
            outlineColor: '#ff0000', height: 20, parentFolderId: null,
            frameCount: 2,
            frames: [
              {
                index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
                label: '', labelType: 'name', script: '',
                sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                motionOrientToPath: false, motionSync: false, motionScale: false,
                shapeEase: 0, shapeBlend: 'distributive',
                displayObjects: [{ id: btnInst1Id, type: 'instance', symbolId, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }],
              },
              {
                index: 1, isKeyframe: true, isEmpty: false, tweenType: 'none',
                label: '', labelType: 'name', script: '',
                sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                motionOrientToPath: false, motionSync: false, motionScale: false,
                shapeEase: 0, shapeBlend: 'distributive',
                displayObjects: [{ id: btnInst2Id, type: 'instance', symbolId, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }],
              },
            ],
          },
          {
            id: bgLayerId, name: 'Background', type: 'normal',
            visible: true, locked: false, outlineMode: false,
            outlineColor: '#0000ff', height: 20, parentFolderId: null,
            frameCount: 2,
            frames: [
              {
                index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
                label: '', labelType: 'name', script: frame0Script,
                sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                motionOrientToPath: false, motionSync: false, motionScale: false,
                shapeEase: 0, shapeBlend: 'distributive',
                displayObjects: [makeColorRect(redId, 255, 0, 0)],
              },
              {
                index: 1, isKeyframe: true, isEmpty: false, tweenType: 'none',
                label: '', labelType: 'name', script: 'stop();',
                sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                motionOrientToPath: false, motionSync: false, motionScale: false,
                shapeEase: 0, shapeBlend: 'distributive',
                displayObjects: [makeColorRect(blueId, 0, 0, 255)],
              },
            ],
          },
        ],
      },
    }],
    library: { items: [buttonSymbol], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Interactivity oracle: synthesized input drives SWF state', () => {
  test.skip(!!process.env.CI, 'Skip interactivity oracle in CI until Ruffle CI setup complete');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 1: button on(release) — click advances frame red→blue
  //
  // SWF: 2-frame timeline. Frame 0: red rect + stop(). Frame 1: blue rect.
  // Button spans full stage. on(release) { nextFrame(); }
  //
  // Expected: click → on(release) fires → nextFrame() → blue rectangle.
  // -------------------------------------------------------------------------
  test('button release event: click advances frame and changes visible color', async ({ page }, testInfo: TestInfo) => {
    const btnSym = makeFullStageButton(
      'sym-btn-1', 'ClickButton',
      [{ event: 'release', script: 'nextFrame();' }],
      makeInvisibleFullStageRect('btn1-up'),
      makeInvisibleFullStageRect('btn1-over'),
      makeInvisibleFullStageRect('btn1-down'),
    );
    const fixtureDoc = makeTwoFrameDoc(
      'interact-btn-doc', 'layer-btn', 'btn-inst-1', 'btn-inst-2', 'sym-btn-1',
      'layer-bg', 'red-rect', 'blue-rect', btnSym,
    );

    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, fixtureDoc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    await ensureRuffleLoaded(page);
    await injectRufflePlayer(page, swfBase64);
    await page.waitForTimeout(2000);

    const shotBefore = await screenshotPlayer(page);
    if (testInfo.retry > 0) {
      await testInfo.attach('shot-before', { body: shotBefore, contentType: 'image/png' });
    }

    await page.locator('#__ruffle_interact_player__').click({ position: { x: 275, y: 200 } });
    await page.waitForTimeout(1500);

    const shotAfter = await screenshotPlayer(page);
    if (testInfo.retry > 0) {
      await testInfo.attach('shot-after', { body: shotAfter, contentType: 'image/png' });
    }

    await removeRufflePlayer(page);

    const diffPixels = countDifferentPixels(shotBefore, shotAfter);

    if (diffPixels < 100) {
      await testInfo.attach('shot-before-fail', { body: shotBefore, contentType: 'image/png' });
      await testInfo.attach('shot-after-fail', { body: shotAfter, contentType: 'image/png' });
    }

    expect(diffPixels).toBeGreaterThan(100);
  });

  // -------------------------------------------------------------------------
  // Test 2: button on(press) — mouseDown advances frame red→blue
  //
  // Same structure as test 1 but uses on(press) { nextFrame(); } instead of
  // on(release). Tests the BUTTONCONDACTION bit for press (0x0002 vs 0x0001
  // for release). The on(press) event fires when the mouse button is first
  // pressed down — earlier in the click sequence than on(release).
  // -------------------------------------------------------------------------
  test('button press event: mousedown advances frame and changes visible color', async ({ page }, testInfo: TestInfo) => {
    const btnSym = makeFullStageButton(
      'sym-press-btn', 'PressButton',
      [{ event: 'press', script: 'nextFrame();' }],
      makeInvisibleFullStageRect('press-btn-up'),
      makeInvisibleFullStageRect('press-btn-over'),
      makeInvisibleFullStageRect('press-btn-down'),
    );
    const fixtureDoc = makeTwoFrameDoc(
      'interact-press-doc', 'layer-btn-p', 'press-inst-1', 'press-inst-2', 'sym-press-btn',
      'layer-bg-p', 'red-rect-p', 'blue-rect-p', btnSym,
    );

    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, fixtureDoc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    const PLAYER_ID = '__ruffle_press_player__';

    await ensureRuffleLoaded(page);
    await injectRufflePlayer(page, swfBase64, PLAYER_ID);
    await page.waitForTimeout(2000);

    const shotBefore = await page.locator(`#${PLAYER_ID}`).screenshot();

    // Click: on(press) fires on mouseDown → nextFrame() → blue rectangle
    await page.locator(`#${PLAYER_ID}`).click({ position: { x: 275, y: 200 } });
    await page.waitForTimeout(1500);

    const shotAfter = await page.locator(`#${PLAYER_ID}`).screenshot();

    await removeRufflePlayer(page, PLAYER_ID);

    const diffPixels = countDifferentPixels(shotBefore, shotAfter);

    if (diffPixels < 100) {
      await testInfo.attach('shot-before-fail', { body: shotBefore, contentType: 'image/png' });
      await testInfo.attach('shot-after-fail', { body: shotAfter, contentType: 'image/png' });
    }

    // Red→blue = at least 100 pixels changed
    expect(diffPixels).toBeGreaterThan(100);
  });

  // -------------------------------------------------------------------------
  // Test 3b: onClipEvent(load) clip action fires in Ruffle (task 0663)
  //
  // SWF: 2-frame timeline. Frame 0: red rect + stop(). Frame 1: blue rect + stop().
  // A MovieClip instance on frame 0 has: onClipEvent(load) { _root.gotoAndStop(2); }
  //
  // When Ruffle loads the SWF the MovieClip's load event fires immediately and
  // calls _root.gotoAndStop(2), which advances the root timeline to frame 1.
  // After a short wait the stage should show BLUE (not red), proving clip
  // actions were encoded and dispatched correctly.
  // -------------------------------------------------------------------------
  test('onClipEvent(load) clip action fires and advances root frame (0663)', async ({ page }, testInfo: TestInfo) => {
    // A tiny 1-frame MovieClip symbol with no visible content — it only carries
    // the onClipEvent(load) clip action on its instance.
    const mcSymbol = {
      id: 'sym-mc-0663',
      name: 'TriggerMC',
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
          id: 'mc-layer-0663', name: 'Layer 1', type: 'normal',
          visible: true, locked: false, outlineMode: false,
          outlineColor: '#ff0000', height: 20, parentFolderId: null,
          frameCount: 1,
          frames: [{
            index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '',
            sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [],
          }],
        }],
      },
    };

    // Root timeline: 2 frames.
    // Frame 0: red rect + stop() + the MC instance with onClipEvent(load).
    // Frame 1: blue rect + stop().
    const fixtureDoc = {
      id: 'clipaction-load-doc',
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
            // MC layer — instance present only on frame 0
            {
              id: 'layer-mc-0663', name: 'MC', type: 'normal',
              visible: true, locked: false, outlineMode: false,
              outlineColor: '#00ff00', height: 20, parentFolderId: null,
              frameCount: 2,
              frames: [
                {
                  index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
                  label: '', labelType: 'name', script: '',
                  sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                  motionOrientToPath: false, motionSync: false, motionScale: false,
                  shapeEase: 0, shapeBlend: 'distributive',
                  displayObjects: [{
                    id: 'mc-inst-0663',
                    type: 'instance',
                    symbolId: 'sym-mc-0663',
                    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
                    clipActions: [{ event: 'load', script: '_root.gotoAndStop(2);' }],
                  }],
                },
                {
                  index: 1, isKeyframe: true, isEmpty: true, tweenType: 'none',
                  label: '', labelType: 'name', script: '',
                  sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                  motionOrientToPath: false, motionSync: false, motionScale: false,
                  shapeEase: 0, shapeBlend: 'distributive',
                  displayObjects: [],
                },
              ],
            },
            // Background layer — red on frame 0, blue on frame 1
            {
              id: 'layer-bg-0663', name: 'Background', type: 'normal',
              visible: true, locked: false, outlineMode: false,
              outlineColor: '#0000ff', height: 20, parentFolderId: null,
              frameCount: 2,
              frames: [
                {
                  index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
                  label: '', labelType: 'name', script: 'stop();',
                  sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                  motionOrientToPath: false, motionSync: false, motionScale: false,
                  shapeEase: 0, shapeBlend: 'distributive',
                  displayObjects: [makeColorRect('red-rect-0663', 255, 0, 0)],
                },
                {
                  index: 1, isKeyframe: true, isEmpty: false, tweenType: 'none',
                  label: '', labelType: 'name', script: 'stop();',
                  sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                  motionOrientToPath: false, motionSync: false, motionScale: false,
                  shapeEase: 0, shapeBlend: 'distributive',
                  displayObjects: [makeColorRect('blue-rect-0663', 0, 0, 255)],
                },
              ],
            },
          ],
        },
      }],
      library: { items: [mcSymbol], folders: [] },
    };

    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, fixtureDoc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    const PLAYER_ID = '__ruffle_clipaction_player__';

    await ensureRuffleLoaded(page);
    await injectRufflePlayer(page, swfBase64, PLAYER_ID);

    // Wait for Ruffle to fully initialize and run the first frame (load event fires)
    await page.waitForTimeout(2500);

    const shotAfterLoad = await page.locator(`#${PLAYER_ID}`).screenshot();

    await removeRufflePlayer(page, PLAYER_ID);

    // Build a reference "red" screenshot to compare against: load a second
    // instance WITHOUT clip actions so it stays on frame 0 (red).
    const fixtureDocNoClip = {
      ...fixtureDoc,
      id: 'clipaction-noclip-doc',
      scenes: [{
        ...fixtureDoc.scenes[0],
        timeline: {
          layers: [
            {
              ...fixtureDoc.scenes[0].timeline.layers[0],
              frames: [
                {
                  ...fixtureDoc.scenes[0].timeline.layers[0].frames[0],
                  displayObjects: [{
                    id: 'mc-inst-noclip',
                    type: 'instance',
                    symbolId: 'sym-mc-0663',
                    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
                    // No clipActions — should stay on frame 0 (red)
                  }],
                },
                fixtureDoc.scenes[0].timeline.layers[0].frames[1],
              ],
            },
            fixtureDoc.scenes[0].timeline.layers[1],
          ],
        },
      }],
    };

    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, fixtureDocNoClip);
    await page.waitForTimeout(300);

    const swfBase64NoClip: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    const PLAYER_NO_CLIP_ID = '__ruffle_clipaction_noclip_player__';
    await injectRufflePlayer(page, swfBase64NoClip, PLAYER_NO_CLIP_ID);
    await page.waitForTimeout(2500);

    const shotNoClip = await page.locator(`#${PLAYER_NO_CLIP_ID}`).screenshot();
    await removeRufflePlayer(page, PLAYER_NO_CLIP_ID);

    const diffPixels = countDifferentPixels(shotNoClip, shotAfterLoad);

    // Always attach screenshots for visibility
    await testInfo.attach('shot-no-clip-action-red', { body: shotNoClip, contentType: 'image/png' });
    await testInfo.attach('shot-with-clip-action-should-be-blue', { body: shotAfterLoad, contentType: 'image/png' });

    if (diffPixels < 100) {
      // Extra debug info on failure
      await testInfo.attach('FAIL-shot-no-clip', { body: shotNoClip, contentType: 'image/png' });
      await testInfo.attach('FAIL-shot-with-clip', { body: shotAfterLoad, contentType: 'image/png' });
    }

    // onClipEvent(load) advanced root to frame 1 (blue), while no-clip stayed on
    // frame 0 (red). The 100x100 center rect is different => > 100 pixel diff.
    expect(diffPixels).toBeGreaterThan(100);
  });

  // -------------------------------------------------------------------------
  // Test 3: button Over state — hovering changes visible color (red→blue)
  //
  // SWF: single-frame timeline with a button spanning the whole stage.
  // Button Up state: red 100x100 rect. Over state: blue 100x100 rect.
  //
  // Expected: mouse not over button → Up state (red).
  //   Hover over button → Over state (blue).
  // Tests the button rollOver pathway via Playwright hover(), which goes through
  // Ruffle's native pointer event pipeline (same as clicks, which work in test 1).
  // -------------------------------------------------------------------------
  test('button Over state: hover changes visible color from red to blue', async ({ page }, testInfo: TestInfo) => {
    const fixtureDoc = {
      id: 'interact-hover-doc',
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
            id: 'layer-btn-h', name: 'Layer 1', type: 'normal',
            visible: true, locked: false, outlineMode: false,
            outlineColor: '#ff0000', height: 20, parentFolderId: null,
            frameCount: 1,
            frames: [{
              index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
              label: '', labelType: 'name', script: '',
              sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
              motionOrientToPath: false, motionSync: false, motionScale: false,
              shapeEase: 0, shapeBlend: 'distributive',
              displayObjects: [{
                id: 'hover-btn-inst', type: 'instance',
                symbolId: 'sym-hover-btn',
                x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
              }],
            }],
          }],
        },
      }],
      library: {
        items: [makeFullStageButton(
          'sym-hover-btn', 'HoverButton',
          [],  // no button actions — hover-only test
          makeColorRect('up-rect', 255, 0, 0),     // Up state: red
          makeColorRect('over-rect', 0, 0, 255),   // Over state: blue
          makeColorRect('down-rect', 0, 0, 255),   // Down state: blue
        )],
        folders: [],
      },
    };

    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, fixtureDoc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    const PLAYER_ID = '__ruffle_hover_player__';

    await ensureRuffleLoaded(page);
    await injectRufflePlayer(page, swfBase64, PLAYER_ID);
    await page.waitForTimeout(2000);

    // Screenshot with mouse NOT over the button (Up state = red)
    // Move mouse to safe off-stage position first
    await page.mouse.move(0, 450);
    await page.waitForTimeout(300);
    const shotBefore = await page.locator(`#${PLAYER_ID}`).screenshot();

    // Hover over center of button → triggers Over state (blue)
    await page.locator(`#${PLAYER_ID}`).hover({ position: { x: 275, y: 200 } });
    await page.waitForTimeout(1000);

    const shotAfter = await page.locator(`#${PLAYER_ID}`).screenshot();

    await removeRufflePlayer(page, PLAYER_ID);

    const diffPixels = countDifferentPixels(shotBefore, shotAfter);

    if (diffPixels < 100) {
      await testInfo.attach('shot-before-fail', { body: shotBefore, contentType: 'image/png' });
      await testInfo.attach('shot-after-fail', { body: shotAfter, contentType: 'image/png' });
    }

    // Up state (red) → Over state (blue): 100x100 rect changes color
    expect(diffPixels).toBeGreaterThan(100);
  });
});
