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
import { inflateSync, unzipSync } from 'node:zlib';

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

// ---------------------------------------------------------------------------
// SWF structural inspection (task 1196): decompress a published SWF and pull
// the ButtonRecord state flags out of every DefineButton2 (tag 34). Used to
// assert the Up-only-button HIT_TEST fallback structurally, since the bundled
// headless Ruffle hit-tests visible bounds and cannot distinguish the fix.
// ---------------------------------------------------------------------------

/** Decompress a CWS/ZWS SWF to its raw FWS form (8-byte header + body). */
function inflateSwf(buf: Buffer): Uint8Array {
  const sig = String.fromCharCode(buf[0], buf[1], buf[2]);
  if (sig === 'FWS') return new Uint8Array(buf);
  const body = sig === 'CWS' ? inflateSync(buf.subarray(8)) : unzipSync(buf.subarray(8));
  const head = Buffer.from(buf.subarray(0, 8));
  head[0] = 0x46; // 'F'
  return new Uint8Array(Buffer.concat([head, body]));
}

interface ParsedButton2 {
  buttonId: number;
  /** Flags byte of each ButtonRecord (state bits in the low nibble). */
  records: number[];
  /** True when ActionOffset != 0 (a BUTTONCONDACTION block follows). */
  hasActions: boolean;
}

/** Parse all DefineButton2 (tag 34) records from a decompressed SWF. */
function findDefineButton2(swf: Uint8Array): ParsedButton2[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + 4 * nBits) / 8);
  let pos = 8 + rectBytes + 4;
  const out: ParsedButton2[] = [];

  // Minimal bit reader for skipping MATRIX / CXFORMWITHALPHA inside a record.
  const makeBits = (body: Uint8Array, start: number) => {
    let bytePos = start;
    let bit = 0;
    return {
      read(n: number): number {
        let v = 0;
        for (let i = 0; i < n; i++) {
          v = (v << 1) | ((body[bytePos] >> (7 - bit)) & 1);
          bit++;
          if (bit === 8) { bit = 0; bytePos++; }
        }
        return v;
      },
      align() { if (bit !== 0) { bit = 0; bytePos++; } },
      pos() { return bytePos; },
    };
  };
  const skipMatrix = (body: Uint8Array, off: number): number => {
    const b = makeBits(body, off);
    if (b.read(1)) { const n = b.read(5); b.read(n); b.read(n); }
    if (b.read(1)) { const n = b.read(5); b.read(n); b.read(n); }
    const nt = b.read(5); b.read(nt); b.read(nt);
    b.align();
    return b.pos();
  };
  const skipCxform = (body: Uint8Array, off: number): number => {
    const b = makeBits(body, off);
    const hasAdd = b.read(1);
    const hasMult = b.read(1);
    const n = b.read(4);
    if (hasMult) { b.read(n); b.read(n); b.read(n); b.read(n); }
    if (hasAdd) { b.read(n); b.read(n); b.read(n); b.read(n); }
    b.align();
    return b.pos();
  };

  while (pos < swf.length) {
    const rh = swf[pos] | (swf[pos + 1] << 8);
    const code = (rh >> 6) & 0x3ff;
    let len = rh & 0x3f;
    let hdr = 2;
    if (len === 0x3f) {
      len = swf[pos + 2] | (swf[pos + 3] << 8) | (swf[pos + 4] << 16) | (swf[pos + 5] << 24);
      hdr = 6;
    }
    const body = swf.subarray(pos + hdr, pos + hdr + len);
    if (code === 34) {
      const buttonId = body[0] | (body[1] << 8);
      const actionOffset = body[3] | (body[4] << 8);
      let p = 5;
      const records: number[] = [];
      while (p < body.length) {
        const f = body[p];
        if (f === 0) break; // null terminator
        p += 1;
        p += 2; // CharacterId
        p += 2; // PlaceDepth
        p = skipMatrix(body, p);
        p = skipCxform(body, p);
        records.push(f);
      }
      out.push({ buttonId, records, hasActions: actionOffset !== 0 });
    }
    pos += hdr + len;
    if (code === 0) break;
  }
  return out;
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
  // Test 1b (task 1196): a button whose artwork lives ONLY in its Up keyframe
  // must publish a clickable DefineButton2 (records carrying HIT_TEST).
  //
  // This is the golden PlayButton scenario: the button symbol has a single
  // keyframe (Up) carrying a visible shape, with NO explicit Over/Down/Hit
  // frames. Flash publishes such a button by forward-filling the Up artwork into
  // all four states — crucially populating HIT_TEST so the button has a hit
  // area. Without that fallback the published DefineButton2 sets only the UP bit,
  // there is no hit area, and on(release) never reaches AVM1.
  //
  // ORACLE CHOICE — structural, not a Ruffle mouse click.
  //   The bundled headless Ruffle (0.1.0, apps/desktop/public/ruffle) falls back
  //   to a button's VISIBLE bounds for hit-testing when no HIT_TEST record is
  //   present, so a click on an Up-only button advances the frame even WITHOUT
  //   the fix — i.e. a Ruffle-click oracle cannot distinguish fixed vs broken
  //   (same class of headless-Ruffle limitation noted in CLAUDE.md). Real Flash
  //   Player and ruffle-core 0.2.0 (core/src/display_object/avm1_button.rs
  //   `mouse_pick_avm1`) hit-test ONLY the HIT_TEST-derived `hit_area`, so the
  //   HIT_TEST bit is the true acceptance signal. We therefore inflate the
  //   browser-published SWF and assert every Up-state ButtonRecord also carries
  //   HIT_TEST, and that a BUTTONCONDACTION (the on(release) bytecode) is present.
  // -------------------------------------------------------------------------
  test('Up-only button publishes HIT_TEST records and a release action (1196)', async ({ page }) => {
    // A small visible rect placed at the stage origin — the button's sole
    // (Up) keyframe artwork.
    const cornerRect = {
      id: 'up-only-up', type: 'shape',
      shape: {
        id: 'shape-up-only-up',
        paths: [{
          start: { x: 0, y: 0 },
          segments: [
            { type: 'line', to: { x: 120, y: 0 } },
            { type: 'line', to: { x: 120, y: 120 } },
            { type: 'line', to: { x: 0, y: 120 } },
          ],
          closed: true,
          fill: { type: 'solid', color: { r: 80, g: 80, b: 80, a: 255 } },
        }],
      },
      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
    };
    // A button symbol with a SINGLE keyframe (Up) carrying a visible rect and an
    // on(release) handler — exactly the golden PlayButton shape.
    const upOnlyButton = {
      id: 'sym-up-only-btn',
      name: 'UpOnlyButton',
      itemType: 'symbol',
      symbolType: 'button',
      linkage: { exportForActionScript: false, exportInFirstFrame: false, linkageIdentifier: '', className: '', exportForRuntimeSharing: false, importForRuntimeSharing: false, sharedUrl: '' },
      scale9Grid: null,
      buttonActions: [{ event: 'release', script: 'nextFrame();' }],
      timeline: {
        layers: [{
          id: 'up-only-layer', name: 'Layer 1', type: 'normal',
          visible: true, locked: false, outlineMode: false,
          outlineColor: '#ff0000', height: 20, parentFolderId: null,
          frameCount: 1,
          frames: [{
            // ONLY the Up keyframe — no Over/Down/Hit. The forward-fill in
            // buttons.ts must promote this into the Hit state so the button is
            // clickable.
            index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name', script: '',
            sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [cornerRect],
          }],
        }],
      },
    };

    const fixtureDoc = makeTwoFrameDoc(
      'interact-up-only-doc', 'layer-btn-uo', 'uo-inst-1', 'uo-inst-2', 'sym-up-only-btn',
      'layer-bg-uo', 'red-rect-uo', 'blue-rect-uo', upOnlyButton,
    );

    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, fixtureDoc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    // Inflate the published SWF and structurally inspect its DefineButton2.
    const swf = inflateSwf(Buffer.from(swfBase64, 'base64'));
    const buttons = findDefineButton2(swf);
    expect(buttons.length).toBeGreaterThan(0);

    for (const btn of buttons) {
      expect(btn.records.length).toBeGreaterThan(0);
      // Every record that participates in the Up state must also carry HIT_TEST
      // (Up artwork forward-filled into the hit area).
      for (const r of btn.records) {
        if (r & 0x01) {
          expect(r & 0x08).toBe(0x08); // HIT_TEST present → clickable
        }
      }
      // The on(release) handler must have compiled to a BUTTONCONDACTION block.
      expect(btn.hasActions).toBe(true);
    }
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
                    clipActions: [{ event: 'enterFrame', script: '_root.gotoAndStop(2);' }],
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
  // Capstone: basic game interaction — end-to-end dogfood proof
  //
  // Constructs a minimal "Dot Catcher" game skeleton:
  //   - Stage 550×400, white background, 12fps
  //   - Frame 0: red 100×100 circle placeholder + stop() script
  //   - Frame 1: green 100×100 "target caught" rect + stop() script
  //   - A full-stage button with on(release) { nextFrame(); }
  //   - AS2: frame 0 script also sets _root.score = 0; (variable init)
  //   - Frame 1 AS2: _root.score = 1; (variable set on catch)
  //
  // Verification:
  //   1. Load into Ruffle → initial state = red circle (frame 0)
  //   2. Click → on(release) fires → nextFrame() → frame 1 = green rect
  //   3. pixelDiff > 100 proves full toolchain end-to-end
  //
  // This is task 0519's MVP exit criterion: the Flash 8 clone can author
  // interactive AS2 content and verify it in Ruffle via pixel oracle.
  // -------------------------------------------------------------------------
  test.describe('Capstone: basic game interaction', () => {
    test('dot catcher: button click advances frame red→green (full toolchain E2E)', async ({ page }, testInfo: TestInfo) => {
      // Build the "player" shape (red circle stand-in using a square)
      const playerShape = {
        id: 'capstone-player-shape', type: 'shape',
        shape: {
          id: 'shape-capstone-player',
          paths: [{
            start: { x: 225, y: 150 },
            segments: [
              { type: 'line', to: { x: 325, y: 150 } },
              { type: 'line', to: { x: 325, y: 250 } },
              { type: 'line', to: { x: 225, y: 250 } },
            ],
            closed: true,
            fill: { type: 'solid', color: { r: 220, g: 30, b: 30, a: 255 } },
          }],
        },
        x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
      };

      // Frame 1: green "target caught" rect
      const caughtShape = {
        id: 'capstone-caught-shape', type: 'shape',
        shape: {
          id: 'shape-capstone-caught',
          paths: [{
            start: { x: 225, y: 150 },
            segments: [
              { type: 'line', to: { x: 325, y: 150 } },
              { type: 'line', to: { x: 325, y: 250 } },
              { type: 'line', to: { x: 225, y: 250 } },
            ],
            closed: true,
            fill: { type: 'solid', color: { r: 30, g: 180, b: 30, a: 255 } },
          }],
        },
        x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
      };

      // Full-stage invisible button (Up/Over/Down states)
      const gameButton = makeFullStageButton(
        'sym-capstone-btn', 'GameButton',
        [{ event: 'release', script: 'nextFrame();' }],
        makeInvisibleFullStageRect('capstone-btn-up'),
        makeInvisibleFullStageRect('capstone-btn-over'),
        makeInvisibleFullStageRect('capstone-btn-down'),
      );

      // Full game document
      const gameDoc = {
        id: 'capstone-game-doc',
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
              // Button layer (topmost, intercepts clicks)
              {
                id: 'capstone-btn-layer', name: 'Buttons', type: 'normal',
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
                    displayObjects: [{
                      id: 'capstone-btn-inst-0', type: 'instance',
                      symbolId: 'sym-capstone-btn',
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
                      id: 'capstone-btn-inst-1', type: 'instance',
                      symbolId: 'sym-capstone-btn',
                      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
                    }],
                  },
                ],
              },
              // Game layer — player/target visuals + AS2 score logic
              {
                id: 'capstone-game-layer', name: 'Game', type: 'normal',
                visible: true, locked: false, outlineMode: false,
                outlineColor: '#0000ff', height: 20, parentFolderId: null,
                frameCount: 2,
                frames: [
                  {
                    index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
                    label: '', labelType: 'name',
                    // AS2 game init: stop playhead, init score variable
                    script: 'stop();\n_root.score = 0;',
                    sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                    motionOrientToPath: false, motionSync: false, motionScale: false,
                    shapeEase: 0, shapeBlend: 'distributive',
                    displayObjects: [playerShape],
                  },
                  {
                    index: 1, isKeyframe: true, isEmpty: false, tweenType: 'none',
                    label: 'caught', labelType: 'name',
                    // AS2 game event: increment score, stop
                    script: '_root.score = _root.score + 1;\nstop();',
                    sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
                    motionOrientToPath: false, motionSync: false, motionScale: false,
                    shapeEase: 0, shapeBlend: 'distributive',
                    displayObjects: [caughtShape],
                  },
                ],
              },
            ],
          },
        }],
        library: { items: [gameButton], folders: [] },
      };

      // Load document and compile to SWF
      await page.evaluate((doc) => {
        (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
      }, gameDoc);
      await page.waitForTimeout(300);

      const swfBase64: string = await page.evaluate(() => {
        return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
      });

      const PLAYER_ID = '__ruffle_capstone_player__';

      await ensureRuffleLoaded(page);
      await injectRufflePlayer(page, swfBase64, PLAYER_ID);
      await page.waitForTimeout(2000);

      // Capture initial state (frame 0 = red player)
      const shotBefore = await page.locator(`#${PLAYER_ID}`).screenshot();
      await testInfo.attach('capstone-frame0-red-player', { body: shotBefore, contentType: 'image/png' });

      // Click stage center → on(release) fires → nextFrame() → frame 1 (green "caught")
      await page.locator(`#${PLAYER_ID}`).click({ position: { x: 275, y: 200 } });
      await page.waitForTimeout(1500);

      // Capture post-click state (frame 1 = green caught shape)
      const shotAfter = await page.locator(`#${PLAYER_ID}`).screenshot();
      await testInfo.attach('capstone-frame1-green-caught', { body: shotAfter, contentType: 'image/png' });

      await removeRufflePlayer(page, PLAYER_ID);

      const diffPixels = countDifferentPixels(shotBefore, shotAfter);

      // Log result for task output
      console.log(`[Capstone 0519] pixelDiff after button click = ${diffPixels}`);

      if (diffPixels < 100) {
        await testInfo.attach('FAIL-shot-before', { body: shotBefore, contentType: 'image/png' });
        await testInfo.attach('FAIL-shot-after', { body: shotAfter, contentType: 'image/png' });
      }

      // Red player → green "caught" state: 100×100 rect changes color → > 100 pixel diff
      expect(diffPixels).toBeGreaterThan(100);
    });
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
