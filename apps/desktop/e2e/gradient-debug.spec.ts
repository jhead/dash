/**
 * Diagnostic test: capture and save gradient screenshots for visual inspection.
 */
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

async function captureStageScreenshot(
  page: Parameters<Parameters<typeof test>[1]>[0],
  fixtureDoc: unknown
): Promise<Buffer> {
  await page.evaluate((doc) => {
    (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
  }, fixtureDoc);
  await page.waitForTimeout(300);
  const pngBase64: string = await page.evaluate(() => {
    return (window as unknown as { __flashTest: { screenshotStage: () => string } }).__flashTest.screenshotStage();
  });
  return Buffer.from(pngBase64, 'base64');
}

async function captureRuffleScreenshot(
  page: Parameters<Parameters<typeof test>[1]>[0]
): Promise<Buffer> {
  const swfBase64: string = await page.evaluate(() => {
    return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
  });

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
    type RufflePlayerEl = HTMLElement & { ruffle(): { load(opts: { data?: Uint8Array; url?: string }): Promise<void> } };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = '__ruffle_oracle_player__';
    player.style.cssText =
      'position:fixed;top:0;left:0;width:550px;height:400px;pointer-events:none;z-index:99999';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({ data: bytes });
  }, swfBase64);

  await page.waitForTimeout(1500);
  const ruffleScreenshot = await page.locator('#__ruffle_oracle_player__').screenshot();
  await page.evaluate(() => {
    const el = document.getElementById('__ruffle_oracle_player__');
    if (el) el.remove();
  });
  return ruffleScreenshot;
}

test.describe('Gradient debug', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
  });

  test('save gradient screenshots to disk', async ({ page }) => {
    const fixtureDoc = {
      id: 'visual-gradient-doc',
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
                id: 'gradient-rect', type: 'shape',
                shape: {
                  id: 'shape-gradient-rect',
                  paths: [{
                    start: { x: 100, y: 100 },
                    segments: [
                      { type: 'line', to: { x: 400, y: 100 } },
                      { type: 'line', to: { x: 400, y: 300 } },
                      { type: 'line', to: { x: 100, y: 300 } },
                    ],
                    closed: true,
                    fill: {
                      type: 'linear-gradient',
                      angle: 0,
                      stops: [
                        { ratio: 0,   color: { r: 255, g: 0,   b: 0,   a: 255 } },
                        { ratio: 255, color: { r: 0,   g: 0,   b: 255, a: 255 } },
                      ],
                    },
                  }],
                },
                x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
              }],
            }],
          }],
        },
      }],
      library: { items: [], folders: [] },
    };

    const stageShot = await captureStageScreenshot(page, fixtureDoc);
    const ruffleShot = await captureRuffleScreenshot(page);

    const outDir = '/tmp/gradient-debug';
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'stage.png'), stageShot);
    fs.writeFileSync(path.join(outDir, 'ruffle.png'), ruffleShot);

    // Also generate a diff image
    const imgA = PNG.sync.read(stageShot);
    const imgB = PNG.sync.read(ruffleShot);
    const { width, height } = imgA;
    const diff = new PNG({ width, height });
    let bData = imgB.data;
    if (imgB.width !== width || imgB.height !== height) {
      const resized = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcX = Math.round((x / width) * imgB.width);
          const srcY = Math.round((y / height) * imgB.height);
          const srcIdx = (srcY * imgB.width + srcX) * 4;
          const dstIdx = (y * width + x) * 4;
          resized[dstIdx] = imgB.data[srcIdx];
          resized[dstIdx + 1] = imgB.data[srcIdx + 1];
          resized[dstIdx + 2] = imgB.data[srcIdx + 2];
          resized[dstIdx + 3] = imgB.data[srcIdx + 3];
        }
      }
      bData = resized;
    }
    const mismatch = pixelmatch(imgA.data, bData, diff.data, width, height, { threshold: 0.15 });
    fs.writeFileSync(path.join(outDir, 'diff.png'), PNG.sync.write(diff));

    console.log(`Stage size: ${imgA.width}x${imgA.height}`);
    console.log(`Ruffle size: ${imgB.width}x${imgB.height}`);
    console.log(`Mismatch pixels: ${mismatch} / ${width * height} = ${(mismatch / (width * height)).toFixed(4)}`);
    console.log(`Screenshots saved to ${outDir}`);

    // Sample some key pixel values to understand what's being rendered
    // Stage: check gradient rect center (275, 200) and corners (100,100), (400,300)
    // Check pixel at (100, 100) - should be red start of gradient
    const stageCheck = (x: number, y: number, data: Buffer, w: number) => {
      const idx = (y * w + x) * 4;
      return `rgba(${data[idx]},${data[idx+1]},${data[idx+2]},${data[idx+3]})`;
    };

    console.log('Stage pixels:');
    console.log('  (100,100) left edge (red):', stageCheck(100, 200, imgA.data, imgA.width));
    console.log('  (250,200) center (purple?):', stageCheck(250, 200, imgA.data, imgA.width));
    console.log('  (399,200) right edge (blue):', stageCheck(399, 200, imgA.data, imgA.width));
    console.log('  (10,10) outside rect (white?):', stageCheck(10, 10, imgA.data, imgA.width));

    console.log('Ruffle pixels (before resize):');
    console.log('  (100,100) left edge:', stageCheck(100, 200, imgB.data, imgB.width));
    console.log('  (250,200) center:', stageCheck(250, 200, imgB.data, imgB.width));
    console.log('  (399,200) right edge:', stageCheck(399, 200, imgB.data, imgB.width));
    console.log('  (10,10) outside rect:', stageCheck(10, 10, imgB.data, imgB.width));
  });
});
