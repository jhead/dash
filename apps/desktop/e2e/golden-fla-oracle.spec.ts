/**
 * golden.fla Ruffle rendering oracle (task 1190).
 *
 * The blank-screen regression (task 1190): every display object imported with
 * visible=false (a mis-decoded CPicObjBase flag), so compile emitted zero-alpha
 * CXForms and the published SWF rendered a blank white stage. This oracle is the
 * acceptance truth that the published golden SWF now renders its content (title
 * text + play button on the menu frame) — non-blank — in Ruffle.
 *
 * Mirrors magnet-fla-oracle.spec.ts for the Ruffle-in-headless-Chromium specifics
 * (page.screenshot clip, no z-index, hide shadow-DOM overlays). Skipped in CI.
 */

import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'fs';

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

test.describe('golden.fla Ruffle rendering oracle (task 1190)', () => {
  test.skip(!!process.env.CI, 'Skip Ruffle oracle in CI until Ruffle CI setup complete');

  test('golden.fla SWF renders non-blank content in Ruffle', async ({ page }, testInfo) => {
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

    // Load golden.fla via the __flashTest bridge
    const flaBase64 = readFileSync('/Users/jhead/dev/flash/fixtures/golden/golden.fla').toString('base64');
    await page.evaluate((b64) => {
      (window as unknown as { __flashTest: { loadFlaBytes: (b: string) => void } }).__flashTest.loadFlaBytes(b64);
    }, flaBase64);
    await page.waitForTimeout(2000);

    // Publish to SWF — or, when GOLDEN_REF_SWF is set, render that reference SWF
    // instead (used to capture the canonical Flash 8 golden.swf for comparison).
    const swfBase64: string = process.env.GOLDEN_REF_SWF
      ? readFileSync(process.env.GOLDEN_REF_SWF).toString('base64')
      : await page.evaluate(() => {
          return (window as unknown as { __flashTest: { publish: () => string } }).__flashTest.publish();
        });
    console.log(`SWF to render: ${Math.round(swfBase64.length * 3 / 4 / 1024)} KB${process.env.GOLDEN_REF_SWF ? ' (reference)' : ' (ours)'}`);

    // Inject Ruffle player (position:absolute, no z-index — see magnet oracle notes)
    await page.evaluate((b64) => {
      const ruffleApi = (window as unknown as { RufflePlayer: { newest(): unknown } }).RufflePlayer.newest() as {
        createPlayer(): HTMLElement & { ruffle(): { load(o: unknown): Promise<void> } }
      };
      // Hide the editor app so only the Ruffle player is captured (the editor's
      // gray stage was previously showing through, with the SWF only peeking out).
      Array.from(document.body.children).forEach((c) => {
        (c as HTMLElement).style.setProperty('display', 'none', 'important');
      });
      document.body.style.background = '#ffffff';
      const player = ruffleApi.createPlayer();
      player.id = '__ruffle_golden__';
      // Append (painted last → on top) and pin to the viewport corner.
      player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;background:#fff;';
      document.body.appendChild(player);
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
    }, '__ruffle_golden__');

    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 550, height: 400 } });

    await page.evaluate(() => {
      document.getElementById('__ruffle_golden__')?.remove();
    });

    testInfo.attach('ruffle-golden', { body: shot, contentType: 'image/png' });
    if (process.env.GOLDEN_SHOT_OUT) writeFileSync(process.env.GOLDEN_SHOT_OUT, shot);

    const { dark, colored, white, total } = countContentPixels(shot);
    console.log(`golden.fla Ruffle screenshot: ${shot.length} bytes, ${total} pixels`);
    console.log(`  white: ${white} (${(white / total * 100).toFixed(1)}%)`);
    console.log(`  dark: ${dark} (${(dark / total * 100).toFixed(1)}%)`);
    console.log(`  colored: ${colored} (${(colored / total * 100).toFixed(1)}%)`);
    consoleMsgs.forEach(m => console.log(' ', m));

    // Menu frame shows title/score text + the gradient play button. Must be non-blank.
    const contentPixels = colored + dark;
    expect(contentPixels, 'Stage appears blank (task 1190 regression — objects hidden)').toBeGreaterThan(total * 0.01);
    expect(colored, 'Stage has no colored pixels — rendering failure').toBeGreaterThan(0);
    // And it must NOT be the all-white blank that the visible-flag bug produced.
    expect(white / total, 'Stage is essentially all white — content not rendering').toBeLessThan(0.99);
  });
});
