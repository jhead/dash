import { test } from '@playwright/test';
import * as fs from 'fs';

test.describe('Solid SWF dump', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
  });

  test('dump solid-fill SWF to /tmp', async ({ page }) => {
    const fixtureDoc = {
      id: 'visual-solid-doc',
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
                id: 'rect-1', type: 'shape',
                shape: {
                  id: 'shape-rect-1',
                  paths: [{
                    start: { x: 50, y: 50 },
                    segments: [
                      { type: 'line', to: { x: 250, y: 50 } },
                      { type: 'line', to: { x: 250, y: 200 } },
                      { type: 'line', to: { x: 50, y: 200 } },
                    ],
                    closed: true,
                    fill: { type: 'solid', color: { r: 255, g: 0, b: 0, a: 255 } },
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

    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, fixtureDoc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    const bytes = Buffer.from(swfBase64, 'base64');
    fs.mkdirSync('/tmp/gradient-debug', { recursive: true });
    fs.writeFileSync('/tmp/gradient-debug/solid.swf', bytes);

    console.log(`Solid SWF size: ${bytes.length} bytes`);
    console.log(`Hex: ${bytes.toString('hex')}`);

    // Find tags
    let offset = 8;
    const nBits = bytes[offset] >> 3;
    const rectBytes = Math.ceil((5 + 4 * nBits) / 8);
    offset += rectBytes + 4;

    const hex = (b: Buffer, s: number, l: number) =>
      Array.from(b.subarray(s, s + l)).map(x => x.toString(16).padStart(2, '0')).join(' ');

    while (offset < bytes.length - 2) {
      const tagWord = bytes.readUInt16LE(offset);
      const tagType = tagWord >> 6;
      const tagShortLen = tagWord & 0x3f;
      offset += 2;
      let tagLen = tagShortLen;
      if (tagShortLen === 0x3f) { tagLen = bytes.readUInt32LE(offset); offset += 4; }
      if (tagType === 83) {
        console.log(`DefineShape4 body (${tagLen} bytes): ${hex(bytes, offset, tagLen)}`);
      }
      offset += tagLen;
      if (tagType === 0) break;
    }
  });
});
