/**
 * Live Preview trace() → Output panel oracle (task 1312).
 *
 * USER-REPORTED BUG: trace() (and Ruffle runtime errors/warnings) emitted by the
 * SWF running in the LIVE PREVIEW tab did NOT appear in the Output panel, even
 * though the Test Movie flow DOES surface trace there (see trace-output.spec.ts).
 *
 * ROOT CAUSE: `LivePreviewPanel` rendered its embedded `<RufflePlayer>` WITHOUT
 * an `onTrace` prop, so the preview's Ruffle instance — though it registers
 * Ruffle's dedicated trace observer internally — had nowhere to deliver the
 * captured trace lines. Test Movie wires `onTrace={handleTrace}`, which appends
 * to `outputMessages`; the preview did not.
 *
 * FIX: `LivePreviewPanel` now takes an `onTrace` prop wired in Shell to the SAME
 * `handleTrace` Test Movie uses, so both routes feed the one Output store. The
 * preview wraps it so a hot-reload emits a subtle "─── reload ───" separator on
 * the first trace of each new compiled SWF (no listener leak / no duplicate
 * delivery — RufflePlayer registers exactly one traceObserver per load and
 * restores it on reload/unmount).
 *
 * This oracle mirrors trace-output.spec.ts but via the Live Preview tab:
 *   1. Load a doc whose frame 1 calls trace("..."), open Live Preview.
 *   2. Open the Output bottom tab; assert the trace line appears there.
 *   3. Hot-reload (edit the script) and assert there are NO duplicate copies of
 *      a line within a single run (the no-duplicate-listener guarantee).
 *
 * Run locally with:
 *   cd apps/desktop && npx playwright test e2e/live-preview-trace.spec.ts --reporter=line
 */

import { test, expect, Page } from '@playwright/test';

const STATUS = '[data-testid="preview-status-pill"]';
const OUTPUT = '[data-testid="output-panel-messages"]';

/** A minimal single-frame document whose frame 1 script calls trace(message). */
function makeTraceDoc(message: string) {
  const docId = 'lp-trace-doc';
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
        layers: [{
          id: `${docId}-layer`,
          name: 'Layer 1',
          type: 'normal',
          visible: true,
          locked: false,
          outlineMode: false,
          outlineColor: '#ff0000',
          height: 20,
          parentFolderId: null,
          frameCount: 1,
          frames: [{
            index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name',
            script: `trace("${message}");`,
            sound: null,
            motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [],
          }],
        }],
      },
    }],
    library: { items: [], folders: [] },
  };
}

/** Replace the frame-1 script of scene 0 / layer 0 and load it via the bridge. */
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

/** Open the Output bottom-dock tab (its button is labelled "Output"). */
async function openOutputTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Output' }).click();
  await expect(page.locator(OUTPUT)).toBeVisible({ timeout: 10000 });
}

test.describe('Live Preview trace() reaches the Output panel (task 1312)', () => {
  test.skip(!!process.env.CI, 'runtime oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForFunction(() => typeof (window as any).__flashTest !== 'undefined');
  });

  test('trace() from the Live Preview tab appears in the Output panel', async ({ page }) => {
    const message = 'hello from live preview';

    // Load a doc whose frame 1 traces, then open the Live Preview tab.
    await page.evaluate((d) => {
      (window as any).__flashTest.loadDocument(d);
    }, makeTraceDoc(message));
    await page.waitForTimeout(200);

    await page.locator('[data-testid="top-tab-preview"]').click();
    await expect(page.locator('[data-testid="live-preview-panel"]')).toBeVisible();

    // Preview compiles + embeds Ruffle.
    await expect.poll(() => statusText(page), { timeout: 20000 }).toBe('up-to-date');
    await expect(
      page.locator('[data-testid="live-preview-panel"] ruffle-player')
    ).toHaveCount(1, { timeout: 15000 });

    // The crux: the preview's running SWF must surface its trace() in the SAME
    // Output panel store the Test Movie flow uses. Open the Output tab and look.
    await openOutputTab(page);
    await expect(page.locator(OUTPUT)).toContainText(message, { timeout: 15000 });
  });

  test('a hot-reload does not duplicate trace lines within a run', async ({ page }) => {
    const first = 'reload-run-one';
    const second = 'reload-run-two';

    await page.evaluate((d) => {
      (window as any).__flashTest.loadDocument(d);
    }, makeTraceDoc(first));
    await page.waitForTimeout(200);

    await page.locator('[data-testid="top-tab-preview"]').click();
    await expect(page.locator('[data-testid="live-preview-panel"]')).toBeVisible();
    await expect.poll(() => statusText(page), { timeout: 20000 }).toBe('up-to-date');

    await openOutputTab(page);
    await expect(page.locator(OUTPUT)).toContainText(first, { timeout: 15000 });

    // No duplicate listeners: the first run's line must appear exactly once even
    // after the player has been mounted (a duplicate traceObserver would deliver
    // every trace twice → two identical lines for one frame-1 trace() call).
    await expect
      .poll(
        async () =>
          (await page.locator(`${OUTPUT} >> text="${first}"`).count()),
        { timeout: 15000 }
      )
      .toBe(1);

    // Hot-reload with a new script → a new SWF compiles and the preview reloads.
    await setFrameScript(page, `trace("${second}");`);
    await expect.poll(() => statusText(page), { timeout: 20000 }).toBe('up-to-date');

    // The second run's line shows up (appended, not replacing the first run)...
    await expect(page.locator(OUTPUT)).toContainText(second, { timeout: 15000 });
    // ...and likewise appears exactly once (no duplicate delivery after reload).
    await expect
      .poll(
        async () =>
          (await page.locator(`${OUTPUT} >> text="${second}"`).count()),
        { timeout: 15000 }
      )
      .toBe(1);

    // A subtle reload separator marks the boundary between the two runs.
    await expect(page.locator(OUTPUT)).toContainText('reload', { timeout: 5000 });
  });
});
