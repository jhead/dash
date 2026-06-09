/**
 * Diagnostic: dump the SWF bytes for the gradient fixture to /tmp for offline analysis.
 */
import { test } from '@playwright/test';
import * as fs from 'fs';

test.describe('Gradient SWF dump', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
  });

  test('dump gradient SWF to /tmp', async ({ page }) => {
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

    // Load document and publish
    await page.evaluate((doc) => {
      (window as unknown as { __flashTest: { loadDocument: (d: unknown) => void } }).__flashTest.loadDocument(doc);
    }, fixtureDoc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });

    const bytes = Buffer.from(swfBase64, 'base64');
    fs.writeFileSync('/tmp/gradient-debug/gradient.swf', bytes);

    // Print a hex dump of first 256 bytes + some analysis
    const hex = (b: Buffer, start: number, len: number) =>
      Array.from(b.subarray(start, start + len))
        .map(x => x.toString(16).padStart(2, '0'))
        .join(' ');

    console.log(`SWF size: ${bytes.length} bytes`);
    console.log(`Header (8 bytes): ${hex(bytes, 0, 8)}`);
    // SWF signature + version
    console.log(`Signature: ${String.fromCharCode(bytes[0], bytes[1], bytes[2])}`);
    console.log(`Version: ${bytes[3]}`);
    console.log(`File length: ${bytes.readUInt32LE(4)}`);

    // After header there's stage dimensions (RECT), frame rate, frame count
    // Find the DefineShape4 tag (tag code 83 = 0x53)
    // Tag format: UInt16 with bits 6-15 = tag type, bits 0-5 = length (or 0x3f for long)
    let offset = 0;
    // Skip compression header - 'FWS' means uncompressed
    const isCompressed = bytes[0] === 0x43; // 'C' = CWS (zlib)
    console.log(`Compressed: ${isCompressed}`);

    if (!isCompressed) {
      // After the 8-byte header, there's a RECT (stage bounds), then frame rate, frame count
      // Skip to after the header (8 bytes) and parse RECT to find where tags start
      offset = 8;
      // RECT: first 5 bits = Nbits, then 4 fields of Nbits bits each
      const nBits = bytes[offset] >> 3;
      const rectBits = 5 + 4 * nBits;
      const rectBytes = Math.ceil(rectBits / 8);
      offset += rectBytes;
      // Frame rate (UI16) + frame count (UI16)
      offset += 4;

      console.log(`Tags start at offset: ${offset}`);

      // Parse tags
      let tagCount = 0;
      while (offset < bytes.length - 2 && tagCount < 30) {
        const tagWord = bytes.readUInt16LE(offset);
        const tagType = tagWord >> 6;
        const tagShortLen = tagWord & 0x3f;
        offset += 2;
        let tagLen: number;
        if (tagShortLen === 0x3f) {
          tagLen = bytes.readUInt32LE(offset);
          offset += 4;
        } else {
          tagLen = tagShortLen;
        }
        const tagName = tagType === 0 ? 'End' :
                       tagType === 9 ? 'SetBackgroundColor' :
                       tagType === 10 ? 'DefineFont' :
                       tagType === 11 ? 'DefineText' :
                       tagType === 13 ? 'DefineFontInfo' :
                       tagType === 26 ? 'PlaceObject2' :
                       tagType === 28 ? 'RemoveObject2' :
                       tagType === 37 ? 'DefineEditText' :
                       tagType === 39 ? 'DefineSprite' :
                       tagType === 43 ? 'FrameLabel' :
                       tagType === 45 ? 'SoundStreamHead2' :
                       tagType === 69 ? 'FileAttributes' :
                       tagType === 70 ? 'PlaceObject3' :
                       tagType === 75 ? 'DefineFont3' :
                       tagType === 77 ? 'MetaData' :
                       tagType === 78 ? 'DefineScalingGrid' :
                       tagType === 83 ? 'DefineShape4' :
                       tagType === 86 ? 'DefineSceneAndFrameLabelData' :
                       tagType === 88 ? 'DefineFontAlignZones' :
                       tagType === 1 ? 'ShowFrame' :
                       `Unknown(${tagType})`;
        console.log(`Tag ${tagCount}: type=${tagType} (${tagName}), len=${tagLen}, offset=${offset}`);

        if (tagType === 83) { // DefineShape4
          console.log(`  DefineShape4 body hex (first 80 bytes): ${hex(bytes, offset, Math.min(80, tagLen))}`);
        }
        if (tagType === 26 || tagType === 70) { // PlaceObject2/3
          console.log(`  PlaceObject body hex: ${hex(bytes, offset, Math.min(30, tagLen))}`);
        }

        offset += tagLen;
        tagCount++;
        if (tagType === 0) break; // End tag
      }
    }
  });
});
