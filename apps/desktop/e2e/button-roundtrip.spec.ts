/**
 * Button authoring round-trip oracle (task 0763): prove that a button symbol
 * with `buttonActions` fires correctly in Ruffle after publish.
 *
 * This suite exercises the COMPLETE button authoring → SWF compile → runtime
 * pipeline. Prior acceptance for button symbols (task 0740) and the ActionsPanel
 * button mode (task 0753) was byte-level only. Like the SetMember/DefineFunction2
 * bugs uncovered in tasks 0519/0706, byte tests prove encoding but NOT runtime
 * execution. This oracle confirms Ruffle actually dispatches the BUTTONCONDACTION.
 *
 * Two test variants:
 *
 *   1. __flashTest bridge (same pattern as interactivity.spec.ts):
 *      loadDocument() → publish() → inject into Ruffle → click → pixel diff.
 *      Fast, self-contained, no MCP server required.
 *
 *   2. MCP doc_load + publish_swf (same pattern as capstone-0519.spec.ts):
 *      Connects to the live MCP bridge at http://localhost:1420/mcp, loads the
 *      same fixture via doc_load, publishes via publish_swf, then asserts in
 *      Ruffle. Proves the MCP authoring path end-to-end.
 *
 * Test design:
 *   - Main timeline has 2 frames:
 *       Frame 0: red 100×100 rect at stage center + stop()
 *       Frame 1: blue 100×100 rect at stage center + stop()
 *   - A full-stage button symbol (Up/Over/Down/Hit) has:
 *       buttonActions: [{ event: 'release', script: 'nextFrame();' }]
 *   - The button is placed on frame 0 of a top layer.
 *   - Clicking the Ruffle player fires on(release) → nextFrame() → blue rect appears.
 *   - Assert: pixelDiff(before, after) > 1000 AND blue pixel count increases.
 *
 * Failure mode check (acceptance criterion 3):
 *   A variant with buttonActions: [] (empty) is also tested; it must NOT change
 *   the frame, proving the oracle is a real runtime gate, not an accidental pass.
 *
 * Run locally:
 *   pnpm --filter @flash/desktop e2e --grep "button"
 *   cd apps/desktop && npx playwright test e2e/button-roundtrip.spec.ts --reporter=line
 */

import { test, expect, TestInfo } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Ruffle helpers (proven patterns from keyboard.spec.ts / task 0703)
// ---------------------------------------------------------------------------

type Page = Parameters<Parameters<typeof test>[1]>[0];

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
    // Must be on-screen (top:0;left:0) for Chromium to composite the frame
    // buffer correctly — see CLAUDE.md "Visual oracle — Ruffle must be on-screen".
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;z-index:99999;';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    // autoplay:'on' forces play() without a user-gesture audio context.
    // unmuteOverlay:'hidden' removes the dimming overlay that otherwise covers the stage.
    void player.ruffle().load({
      data: bytes,
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
    });
  }, { b64: swfBase64, id: playerId });
}

/** Recursively hide Ruffle's overlay chrome (hardware-accel warning etc.). */
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

async function removeRufflePlayer(page: Page, playerId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, playerId);
}

// ---------------------------------------------------------------------------
// Pixel analysis helpers
// ---------------------------------------------------------------------------

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
        resized[dstIdx]     = imgB.data[srcIdx]!;
        resized[dstIdx + 1] = imgB.data[srcIdx + 1]!;
        resized[dstIdx + 2] = imgB.data[srcIdx + 2]!;
        resized[dstIdx + 3] = imgB.data[srcIdx + 3]!;
      }
    }
    bData = resized;
  }
  const diff = new PNG({ width, height });
  return pixelmatch(imgA.data, bData, diff.data, width, height, { threshold: 0.1 });
}

function colorCounts(buf: Buffer): { red: number; blue: number } {
  const img = PNG.sync.read(buf);
  let red = 0, blue = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!, g = img.data[i + 1]!, b = img.data[i + 2]!, a = img.data[i + 3]!;
    if (a < 10) continue;
    if (r > 180 && g < 80 && b < 80) red++;
    else if (b > 180 && r < 80 && g < 80) blue++;
  }
  return { red, blue };
}

// ---------------------------------------------------------------------------
// Document fixture builders
// ---------------------------------------------------------------------------

/** A solid 100×100 rectangle at stage center (225,150)→(325,250). */
function makeCenteredRect(id: string, r: number, g: number, b: number) {
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

/** A full-stage (550×400) invisible rectangle (used for button Up/Over/Down states). */
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

/** A full-stage opaque rectangle (used for button Hit state — defines click area). */
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

/**
 * Build a DefineButton2 symbol with the given buttonActions.
 *
 * States:
 *   Frame 0 (Up):   invisible full-stage rect
 *   Frame 1 (Over): invisible full-stage rect
 *   Frame 2 (Down): invisible full-stage rect
 *   Frame 3 (Hit):  opaque full-stage rect (defines the click area)
 *
 * The invisible Up/Over/Down states ensure the button visually disappears so
 * screenshots only show the background rect layer, making color change analysis
 * unambiguous.
 */
function makeFullStageButtonSymbol(
  symbolId: string,
  name: string,
  buttonActions: Array<{ event: string; script: string }>,
) {
  return {
    id: symbolId,
    name,
    itemType: 'symbol',
    symbolType: 'button',
    linkage: {
      exportForActionScript: false, exportInFirstFrame: false,
      linkageIdentifier: '', className: '',
      exportForRuntimeSharing: false, importForRuntimeSharing: false, sharedUrl: '',
    },
    scale9Grid: null,
    buttonActions,
    timeline: {
      layers: [{
        id: `${symbolId}-layer`, name: 'Layer 1', type: 'normal',
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
            displayObjects: [makeInvisibleFullStageRect(`${symbolId}-up`)],
          },
          {
            index: 1, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '',
            sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [makeInvisibleFullStageRect(`${symbolId}-over`)],
          },
          {
            index: 2, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '',
            sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [makeInvisibleFullStageRect(`${symbolId}-down`)],
          },
          {
            index: 3, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '',
            sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [makeOpaqueFullStageRect(`${symbolId}-hit`)],
          },
        ],
      }],
    },
  };
}

/**
 * Build a complete 2-frame test document.
 *
 * Layer 0 (top): button instance on frame 0, button instance on frame 1.
 * Layer 1 (bottom): red rect + stop() on frame 0; blue rect + stop() on frame 1.
 *
 * Clicking the button on frame 0 fires on(release) → nextFrame() → blue appears.
 */
function makeButtonDoc(opts: {
  docId: string;
  symbolId: string;
  buttonActions: Array<{ event: string; script: string }>;
}) {
  const { docId, symbolId, buttonActions } = opts;
  const buttonSymbol = makeFullStageButtonSymbol(symbolId, 'ClickButton', buttonActions);

  return {
    id: docId,
    properties: {
      width: 550, height: 400, frameRate: 12,
      backgroundColor: '#ffffff', rulerUnits: 'px',
      grid: {
        showGrid: false, snapToGrid: false,
        gridColor: '#999999', gridWidth: 18, gridHeight: 18,
      },
      guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
    },
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: {
        layers: [
          // Button layer (top)
          {
            id: `${docId}-btn-layer`, name: 'Buttons', type: 'normal',
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
                  id: `${docId}-btn-inst-0`,
                  type: 'instance',
                  symbolId,
                  x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
                }],
              },
              {
                index: 1, isKeyframe: true, isEmpty: false, tweenType: 'none',
                label: '', labelType: 'name', script: '',
                sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                motionOrientToPath: false, motionSync: false, motionScale: false,
                shapeEase: 0, shapeBlend: 'distributive',
                displayObjects: [{
                  id: `${docId}-btn-inst-1`,
                  type: 'instance',
                  symbolId,
                  x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
                }],
              },
            ],
          },
          // Background layer (bottom)
          {
            id: `${docId}-bg-layer`, name: 'Background', type: 'normal',
            visible: true, locked: false, outlineMode: false,
            outlineColor: '#0000ff', height: 20, parentFolderId: null,
            frameCount: 2,
            frames: [
              {
                // Frame 0: RED background + stop()
                index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
                label: '', labelType: 'name', script: 'stop();',
                sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                motionOrientToPath: false, motionSync: false, motionScale: false,
                shapeEase: 0, shapeBlend: 'distributive',
                displayObjects: [makeCenteredRect(`${docId}-red`, 255, 0, 0)],
              },
              {
                // Frame 1: BLUE background + stop()
                index: 1, isKeyframe: true, isEmpty: false, tweenType: 'none',
                label: '', labelType: 'name', script: 'stop();',
                sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                motionOrientToPath: false, motionSync: false, motionScale: false,
                shapeEase: 0, shapeBlend: 'distributive',
                displayObjects: [makeCenteredRect(`${docId}-blue`, 0, 0, 255)],
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
// Shared test runner: publish → inject Ruffle → click → assert pixel change
//
// Accepts the SWF as base64 (already compiled by the caller) so both the
// __flashTest bridge variant and the MCP variant can share the same Ruffle
// interaction + assertion logic.
// ---------------------------------------------------------------------------

async function runButtonRuffleOracle(opts: {
  page: Page;
  testInfo: TestInfo;
  swfBase64: string;
  playerId: string;
  expectChange: boolean;
  label: string;
}) {
  const { page, testInfo, swfBase64, playerId, expectChange, label } = opts;

  await ensureRuffleLoaded(page);
  await injectRufflePlayer(page, swfBase64, playerId);

  // Wait for Ruffle to start up and render the first frame
  await page.waitForTimeout(2000);
  await hideRuffleOverlays(page, playerId);

  // Screenshot BEFORE click: should show RED background on frame 0
  const shotBefore = await page.locator(`#${playerId}`).screenshot();
  await testInfo.attach(`${label}-before`, { body: shotBefore, contentType: 'image/png' });
  const before = colorCounts(shotBefore);
  console.log(`[0763] ${label} before: red=${before.red} blue=${before.blue}`);

  // The button spans the full stage; click near the center.
  // No need to pre-focus since the click itself provides focus.
  await page.locator(`#${playerId}`).click({ position: { x: 275, y: 200 } });
  // Wait for AVM1 to process the BUTTONCONDACTION → nextFrame() → re-render
  await page.waitForTimeout(1500);
  await hideRuffleOverlays(page, playerId);

  // Screenshot AFTER click
  const shotAfter = await page.locator(`#${playerId}`).screenshot();
  await testInfo.attach(`${label}-after`, { body: shotAfter, contentType: 'image/png' });
  const after = colorCounts(shotAfter);
  console.log(`[0763] ${label} after:  red=${after.red} blue=${after.blue}`);

  const diffPixels = countDifferentPixels(shotBefore, shotAfter);
  console.log(`[0763] ${label} pixelDiff=${diffPixels}`);

  if (expectChange && (diffPixels < 1000 || after.blue < 500)) {
    await testInfo.attach(`${label}-FAIL-before`, { body: shotBefore, contentType: 'image/png' });
    await testInfo.attach(`${label}-FAIL-after`, { body: shotAfter, contentType: 'image/png' });
  }

  await removeRufflePlayer(page, playerId);

  if (expectChange) {
    // Frame 0 had a red rect; after click the BUTTONCONDACTION fires nextFrame(),
    // advancing to frame 1 which has a blue rect.
    expect(before.red, `${label}: frame 0 should have red pixels`).toBeGreaterThan(500);
    expect(before.blue, `${label}: frame 0 should have no blue pixels`).toBeLessThan(200);
    expect(after.blue, `${label}: frame 1 should have blue pixels`).toBeGreaterThan(500);
    expect(after.red, `${label}: frame 1 should have no red pixels`).toBeLessThan(200);
    expect(diffPixels, `${label}: pixel diff must exceed 1000`).toBeGreaterThan(1000);
  } else {
    // No buttonActions: frame should NOT change after the click.
    expect(diffPixels, `${label}: no-action button should NOT change frame`).toBeLessThan(500);
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Button authoring round-trip: on(release) fires in Ruffle after publish', () => {
  test.skip(!!process.env.CI, 'Skip Ruffle-based button oracle in CI until Ruffle CI setup complete');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 1: on(release) button action fires and advances frame red→blue
  //
  // Proves: BUTTONCONDACTION with ConditionBits=0x0001 (release) is compiled
  // into the SWF and Ruffle dispatches it on a mouse click.
  //
  // Steps:
  //   1. Build fixture doc with button symbol: buttonActions=[{event:'release',
  //      script:'nextFrame();'}]
  //   2. Load into the editor via __flashTest.loadDocument()
  //   3. Compile via __flashTest.publish() → SWF base64
  //   4. Inject into Ruffle (autoplay:'on', unmuteOverlay:'hidden')
  //   5. Screenshot → RED background on frame 0
  //   6. Click Ruffle player → on(release) fires → nextFrame() → frame 1
  //   7. Screenshot → BLUE background on frame 1
  //   8. Assert: blue pixels appear, red pixels vanish, pixelDiff > 1000
  // -------------------------------------------------------------------------
  test('button on(release) action fires in Ruffle: click advances frame red→blue', async ({ page }, testInfo: TestInfo) => {
    const doc = makeButtonDoc({
      docId: 'btn-release-doc',
      symbolId: 'sym-btn-release',
      buttonActions: [{ event: 'release', script: 'nextFrame();' }],
    });

    // Load doc and compile via the __flashTest bridge
    await page.evaluate((d) => {
      (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
    }, doc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    await runButtonRuffleOracle({
      page, testInfo,
      swfBase64,
      playerId: '__ruffle_btn_release__',
      expectChange: true,
      label: 'release',
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: on(press) button action fires in Ruffle: mousedown advances frame
  //
  // Proves: BUTTONCONDACTION with ConditionBits=0x0002 (press) fires on
  // mousedown — earlier in the click sequence than on(release).
  //
  // NOTE: This test is inlined (not using runButtonRuffleOracle) because calling
  // hideRuffleOverlays before the click modifies Ruffle's shadow DOM in a way that
  // disrupts internal mouse hit-testing. The interactivity.spec.ts on(press) test
  // uses the same inline pattern and passes reliably.
  // -------------------------------------------------------------------------
  test('button on(press) action fires in Ruffle: mousedown advances frame red→blue', async ({ page }, testInfo: TestInfo) => {
    const doc = makeButtonDoc({
      docId: 'btn-press-doc',
      symbolId: 'sym-btn-press',
      buttonActions: [{ event: 'press', script: 'nextFrame();' }],
    });

    await page.evaluate((d) => {
      (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
    }, doc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    const PLAYER_ID = '__ruffle_btn_press__';
    await ensureRuffleLoaded(page);
    await injectRufflePlayer(page, swfBase64, PLAYER_ID);
    await page.waitForTimeout(2000);

    const shotBefore = await page.locator(`#${PLAYER_ID}`).screenshot();
    await testInfo.attach('press-before', { body: shotBefore, contentType: 'image/png' });
    const before = colorCounts(shotBefore);
    console.log(`[0763] press before: red=${before.red} blue=${before.blue}`);

    // on(press) fires on mousedown. Click: hover → mousedown → mouseup triggers it.
    await page.locator(`#${PLAYER_ID}`).click({ position: { x: 275, y: 200 } });
    await page.waitForTimeout(1500);

    const shotAfter = await page.locator(`#${PLAYER_ID}`).screenshot();
    await testInfo.attach('press-after', { body: shotAfter, contentType: 'image/png' });
    const after = colorCounts(shotAfter);
    console.log(`[0763] press after:  red=${after.red} blue=${after.blue}`);

    await removeRufflePlayer(page, PLAYER_ID);

    const diffPixels = countDifferentPixels(shotBefore, shotAfter);
    console.log(`[0763] press pixelDiff=${diffPixels}`);

    if (diffPixels < 1000 || after.blue < 500) {
      await testInfo.attach('press-FAIL-before', { body: shotBefore, contentType: 'image/png' });
      await testInfo.attach('press-FAIL-after', { body: shotAfter, contentType: 'image/png' });
    }

    expect(before.red, 'press: frame 0 should have red pixels').toBeGreaterThan(500);
    expect(before.blue, 'press: frame 0 should have no blue pixels').toBeLessThan(200);
    expect(after.blue, 'press: frame 1 should have blue pixels').toBeGreaterThan(500);
    expect(after.red, 'press: frame 1 should have no red pixels').toBeLessThan(200);
    expect(diffPixels, 'press: pixel diff must exceed 1000').toBeGreaterThan(1000);
  });

  // -------------------------------------------------------------------------
  // Test 3: empty buttonActions — frame must NOT change (oracle integrity check)
  //
  // Acceptance criterion 3 from the task: removing the buttonActions array must
  // cause the test to fail (or in this case the no-change assertion must pass),
  // proving the oracle is a real runtime gate and not an accidental pass.
  // -------------------------------------------------------------------------
  test('button with empty buttonActions: click does NOT change frame (oracle integrity)', async ({ page }, testInfo: TestInfo) => {
    const doc = makeButtonDoc({
      docId: 'btn-noaction-doc',
      symbolId: 'sym-btn-noaction',
      buttonActions: [], // deliberately empty — no BUTTONCONDACTION should be emitted
    });

    await page.evaluate((d) => {
      (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
    }, doc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    await runButtonRuffleOracle({
      page, testInfo,
      swfBase64,
      playerId: '__ruffle_btn_noaction__',
      expectChange: false,   // clicking should NOT advance the frame
      label: 'noaction',
    });
  });

  // -------------------------------------------------------------------------
  // Test 4 (MCP variant): doc_load via MCP bridge + publish_swf
  //
  // Same fixture as test 1 but routed through the MCP server at
  // http://localhost:1420/mcp. Proves the full MCP authoring pipeline:
  //   doc_load → mutates editor doc → publish_swf → SWF bytes → Ruffle fires
  //
  // This is the "author a button via the MCP bridge" path referenced in the
  // task description.
  // -------------------------------------------------------------------------
  test('MCP doc_load + publish_swf: on(release) fires in Ruffle', async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(60_000);

    const MCP_URL = new URL('http://localhost:1420/mcp');

    // Wait for the MCP bridge to be available
    const transport = new StreamableHTTPClientTransport(MCP_URL);
    const client = new Client({ name: 'btn-roundtrip-0763', version: '0.0.1' }, { capabilities: {} });
    await client.connect(transport);

    try {
      // Verify the bridge is alive
      const statusResult = await client.callTool({ name: 'editor_status' });
      if (statusResult.isError) {
        throw new Error('editor_status returned error: ' + JSON.stringify(statusResult.content));
      }

      // Load the button fixture document via MCP doc_load
      const doc = makeButtonDoc({
        docId: 'btn-mcp-doc',
        symbolId: 'sym-btn-mcp',
        buttonActions: [{ event: 'release', script: 'nextFrame();' }],
      });

      const loadResult = await client.callTool({
        name: 'doc_load',
        arguments: { document: doc },
      });
      if (loadResult.isError) {
        throw new Error('doc_load failed: ' + JSON.stringify(loadResult.content));
      }

      // Compile via publish_swf
      const publishResult = await client.callTool({ name: 'publish_swf' });
      if (publishResult.isError) {
        throw new Error('publish_swf failed: ' + JSON.stringify(publishResult.content));
      }

      const publishData = JSON.parse(
        (publishResult.content as Array<{ type: string; text?: string }>)[0]!.text!
      ) as { swfBase64: string };
      const swfBase64 = publishData.swfBase64;
      expect(typeof swfBase64).toBe('string');
      expect(swfBase64.length).toBeGreaterThan(0);

      await runButtonRuffleOracle({
        page, testInfo,
        swfBase64,
        playerId: '__ruffle_btn_mcp__',
        expectChange: true,
        label: 'mcp-release',
      });
    } finally {
      await client.close();
    }
  });
});
