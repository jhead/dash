/**
 * Magnet.fla Ruffle rendering oracle (task 0899).
 *
 * Verifies that Magnet.fla compiles to a SWF that renders recognisable content
 * in Ruffle — not a blank/black stage. This validates that the fixes from tasks
 * 0889 (CS2 class tags), 0890 (DefineShape4 degenerate paths), and 0891 (JPEG
 * EOI marker) together produce a renderable SWF from this complex Flash CS2 FLA.
 *
 * Key finding: locator().screenshot() returns black for Ruffle wgpu-webgl rendered
 * content in headless Chromium. Must use page.screenshot({ clip: ... }) instead.
 *
 * Skipped in CI (Ruffle WASM not set up there).
 */

import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFileSync } from 'fs';

function countContentPixels(buf: Buffer): { dark: number; colored: number; white: number; total: number } {
  const img = PNG.sync.read(buf);
  const total = img.width * img.height;
  let dark = 0;
  let colored = 0;
  let white = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const a = img.data[i + 3];
    if (a < 128) continue;
    if (r > 240 && g > 240 && b > 240) white++;
    else if (r < 30 && g < 30 && b < 30) dark++;
    else colored++;
  }
  return { dark, colored, white, total };
}

test.describe('Magnet.fla Ruffle rendering oracle (task 0899)', () => {
  test.skip(!!process.env.CI, 'Skip Ruffle oracle in CI until Ruffle CI setup complete');

  test('Magnet.fla SWF renders non-blank content in Ruffle', async ({ page }, testInfo) => {
    const consoleMsgs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('ERROR') || text.includes('WARN') || text.includes('Loaded')) {
        consoleMsgs.push(`[${msg.type()}] ${text.substring(0, 200)}`);
      }
    });

    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);

    // Load Ruffle
    await page.evaluate(() => {
      return new Promise<void>((resolve, reject) => {
        if ((window as Window & typeof globalThis & { RufflePlayer?: unknown }).RufflePlayer) {
          resolve(); return;
        }
        const script = document.createElement('script');
        script.src = '/ruffle/ruffle.js';
        script.dataset['ruffle'] = '1';
        script.addEventListener('load', () => resolve(), { once: true });
        script.addEventListener('error', () => reject(new Error('Failed to load /ruffle/ruffle.js')), { once: true });
        document.head.appendChild(script);
      });
    });

    // Load Magnet.fla via the __flashTest bridge
    const flaBase64 = readFileSync('/Users/jhead/dev/flash/fixtures/Magnet.fla').toString('base64');
    await page.evaluate((b64) => {
      (window as unknown as { __flashTest: { loadFlaBytes: (b: string) => void } }).__flashTest.loadFlaBytes(b64);
    }, flaBase64);
    await page.waitForTimeout(2000);

    // Publish to SWF
    const swfBase64: string = await page.evaluate(() => {
      return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
    });
    console.log(`Published SWF: ${Math.round(swfBase64.length * 3 / 4 / 1024)} KB`);

    // Inject Ruffle player at top-left (position:absolute so it composites correctly)
    await page.evaluate((b64) => {
      const ruffleApi = (window as unknown as { RufflePlayer: { newest(): unknown } }).RufflePlayer.newest() as {
        createPlayer(): HTMLElement & { ruffle(): { load(o: unknown): Promise<void> } }
      };
      const player = ruffleApi.createPlayer();
      player.id = '__ruffle_magnet__';
      // Use position:absolute (not fixed) so page.screenshot({clip}) captures it correctly
      // Do NOT use z-index as it can affect WebGL compositing in headless Chromium
      player.style.cssText = 'position:absolute;top:0;left:0;width:550px;height:400px;';
      document.body.prepend(player);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      void player.ruffle().load({ data: bytes, autoplay: 'on', unmuteOverlay: 'hidden', logLevel: 'info' });
    }, swfBase64);

    await page.waitForTimeout(4000);

    // Hide shadow DOM overlays (hardware-accel warning etc.)
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
    }, '__ruffle_magnet__');

    // Use page.screenshot with clip to capture the Ruffle canvas area.
    // NOTE: locator().screenshot() returns black for wgpu-webgl rendered content
    // in headless Chromium. page.screenshot({clip:...}) correctly composites the
    // WebGL surface.
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 550, height: 400 } });

    await page.evaluate(() => {
      document.getElementById('__ruffle_magnet__')?.remove();
    });

    testInfo.attach('ruffle-magnet', { body: shot, contentType: 'image/png' });

    const { dark, colored, white, total } = countContentPixels(shot);
    console.log(`Magnet.fla Ruffle screenshot: ${shot.length} bytes, ${total} pixels`);
    console.log(`  white: ${white} (${(white/total*100).toFixed(1)}%)`);
    console.log(`  dark: ${dark} (${(dark/total*100).toFixed(1)}%)`);
    console.log(`  colored: ${colored} (${(colored/total*100).toFixed(1)}%)`);
    consoleMsgs.forEach(m => console.log(' ', m));

    // Stage should have meaningful content (not blank white, not entirely black)
    // Accept: > 1% colored pixels (actual content with color) OR
    //         > 1% dark pixels combined with colored pixels
    const contentPixels = colored + dark;
    expect(contentPixels, 'Stage appears blank (no content)').toBeGreaterThan(total * 0.01);
    // Should NOT be entirely black (all dark, no colored = rendering failure)
    expect(colored, 'Stage has no colored pixels — rendering failure').toBeGreaterThan(0);
  });
});
