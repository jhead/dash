/**
 * Live Preview tab oracle (task 1308).
 *
 * Proves the hot-reload loop end-to-end in the real app + bundled Ruffle:
 *   1. Switching to the Live Preview tab compiles the document and embeds a
 *      <ruffle-player> showing the SWF; the status pill reads "up-to-date".
 *   2. Editing the document re-compiles (debounced) and swaps the SWF in;
 *      the status pill cycles to "up-to-date" again.
 *   3. Introducing a COMPILE ERROR (a malformed AS2 frame script) does NOT
 *      blank the preview: the last-good <ruffle-player> stays mounted, the
 *      status pill reads "error", and a non-blocking error overlay shows the
 *      compiler message.
 *   4. Fixing the script recovers: the overlay clears and status returns to
 *      "up-to-date".
 *
 * Run locally with:
 *   cd apps/desktop && npx playwright test e2e/live-preview.spec.ts --reporter=line
 */

import { test, expect, Page } from '@playwright/test';

const STATUS = '[data-testid="preview-status-pill"]';
const OVERLAY = '[data-testid="preview-error-overlay"]';

/** Set the frame-1 script of scene 0 / layer 0 and load it via the bridge. */
async function setFrameScript(page: Page, script: string): Promise<void> {
  await page.evaluate((s) => {
    const ft = (window as any).__flashTest;
    const doc = ft.getDocument();
    const scene0 = doc.scenes[0];
    const layer0 = scene0.timeline.layers[0];
    const frames = layer0.frames.map((f: any) =>
      f.isKeyframe && f.index === 0 ? { ...f, script: s } : f
    );
    const next = {
      ...doc,
      scenes: [
        {
          ...scene0,
          timeline: {
            ...scene0.timeline,
            layers: [{ ...layer0, frames }, ...scene0.timeline.layers.slice(1)],
          },
        },
        ...doc.scenes.slice(1),
      ],
    };
    ft.loadDocument(next);
  }, script);
}

async function statusText(page: Page): Promise<string> {
  return (await page.locator(STATUS).getAttribute('data-status')) ?? '';
}

test('Live Preview hot-reloads on edit and stays on last-good across compile errors', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).__flashTest !== 'undefined');

  // Open the Live Preview tab.
  await page.locator('[data-testid="top-tab-preview"]').click();
  await expect(page.locator('[data-testid="live-preview-panel"]')).toBeVisible();

  // First compile settles to up-to-date and embeds a Ruffle player.
  await expect
    .poll(() => statusText(page), { timeout: 20000 })
    .toBe('up-to-date');
  await expect(page.locator('[data-testid="live-preview-panel"] ruffle-player')).toHaveCount(1, {
    timeout: 15000,
  });

  // ---- 2. Edit the document → re-compile (good script). -------------------
  await setFrameScript(page, 'trace("frame one");');
  await expect
    .poll(() => statusText(page), { timeout: 20000 })
    .toBe('up-to-date');
  // Player still present after the swap.
  await expect(page.locator('[data-testid="live-preview-panel"] ruffle-player')).toHaveCount(1);
  // No error overlay on a good compile.
  await expect(page.locator(OVERLAY)).toHaveCount(0);

  // ---- 3. Introduce a COMPILE ERROR → keep last-good preview. -------------
  await setFrameScript(page, 'this is not valid AS2 ){{{');
  await expect
    .poll(() => statusText(page), { timeout: 20000 })
    .toBe('error');
  // The error overlay is shown with the compiler message...
  await expect(page.locator(OVERLAY)).toBeVisible();
  await expect(page.locator(OVERLAY)).toContainText(/error/i);
  // ...AND the last-good Ruffle player is STILL mounted (preview not blanked).
  await expect(page.locator('[data-testid="live-preview-panel"] ruffle-player')).toHaveCount(1);

  // ---- 4. Fix the script → recover. ---------------------------------------
  await setFrameScript(page, 'trace("fixed");');
  await expect
    .poll(() => statusText(page), { timeout: 20000 })
    .toBe('up-to-date');
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await expect(page.locator('[data-testid="live-preview-panel"] ruffle-player')).toHaveCount(1);
});
