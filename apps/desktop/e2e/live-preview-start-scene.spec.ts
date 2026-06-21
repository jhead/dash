/**
 * Live Preview — start scene / start frame override oracle (task 1339).
 *
 * Bug: selecting a non-default start SCENE (and start FRAME) in the Live Preview
 * control bar did NOT change the previewed SWF — it played from the default
 * start. Root cause: startAt.ts emitted `gotoAndPlay("SceneName", frame)`, but
 * the AS2 compiler only supports the single-arg NUMERIC form: it pushed the
 * scene NAME as a frame label (scenes are not frame labels) and dropped the
 * frame arg, so ActionGotoFrame2 found nothing and stayed on frame 1. Fix:
 * startAt now emits an ABSOLUTE frame number (cumulative scene offsets + frame).
 *
 * This is the Ruffle acceptance oracle (CLAUDE.md Verification: byte tests are
 * necessary but Ruffle is the truth for any goto/seek). We build a doc where
 * scene 0 is fully RED and scene 1 is fully BLUE, then:
 *   - default start (scene 0)  → preview renders RED
 *   - start scene = 1 override → preview renders BLUE (the goto took effect)
 *
 * Run locally with:
 *   cd apps/desktop && npx playwright test e2e/live-preview-start-scene.spec.ts --reporter=line
 */

import { test, expect, Page } from '@playwright/test';
import { PNG } from 'pngjs';

const PANEL = '[data-testid="live-preview-panel"]';
const STATUS = '[data-testid="preview-status-pill"]';
const PLAYER = `${PANEL} ruffle-player`;

async function statusText(page: Page): Promise<string> {
  return (await page.locator(STATUS).getAttribute('data-status')) ?? '';
}

/**
 * Build a 2-scene doc via the bridge: scene 0 = a RED rect filling the stage on
 * every frame; scene 1 ("Blue Scene") = a BLUE rect filling the stage on every
 * frame. Both scenes are several frames long so a mid-scene seek still lands in
 * the right scene. A `stop()` on each scene's frame 1 keeps the playhead put so
 * the screenshot is deterministic regardless of timing.
 */
async function loadTwoSceneDoc(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ft = (window as any).__flashTest;
    const doc = ft.getDocument();
    const W = doc.properties?.width ?? doc.width ?? 550;
    const H = doc.properties?.height ?? doc.height ?? 400;

    // A CCW closed-rect ShapePath with a solid fill (origin-relative geometry),
    // matching the model used by merge-drawing-oracle.spec.ts.
    const rectShape = (id: string, fill: any) => ({
      id,
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: 'line', to: { x: 0, y: H } },
            { type: 'line', to: { x: W, y: H } },
            { type: 'line', to: { x: W, y: 0 } },
            { type: 'line', to: { x: 0, y: 0 } },
          ],
          fill,
          closed: true,
        },
      ],
    });

    const makeScene = (template: any, name: string, fill: any, nFrames: number) => {
      const layer0 = template.timeline.layers[0];
      const shapeObj = {
        id: `rect-${name}`,
        type: 'shape',
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        shape: rectShape(`shape-${name}`, fill),
      };
      const frames = [];
      for (let i = 0; i < nFrames; i++) {
        frames.push(
          i === 0
            ? {
                ...layer0.frames[0],
                index: 0,
                isKeyframe: true,
                isEmpty: false,
                displayObjects: [shapeObj],
                script: 'stop();',
              }
            : {
                ...layer0.frames[0],
                index: i,
                isKeyframe: false,
                isEmpty: false,
                displayObjects: [shapeObj],
              }
        );
      }
      return {
        ...template,
        name,
        timeline: {
          ...template.timeline,
          layers: [{ ...layer0, frames, frameCount: nFrames }, ...template.timeline.layers.slice(1)],
        },
      };
    };

    const RED = { type: 'solid', color: { r: 255, g: 0, b: 0, a: 255 } };
    const BLUE = { type: 'solid', color: { r: 0, g: 0, b: 255, a: 255 } };
    const scene0 = makeScene(doc.scenes[0], 'Red Scene', RED, 5);
    // Reuse scene 0's structure as the template for scene 1.
    const scene1 = makeScene(doc.scenes[0], 'Blue Scene', BLUE, 5);

    ft.loadDocument({ ...doc, scenes: [scene0, scene1] });
  });
}

/** Hide Ruffle overlay chrome inside the panel's player so the screenshot is clean. */
async function hidePanelOverlays(page: Page): Promise<void> {
  await page.evaluate((sel) => {
    const root = document.querySelector(sel) as (HTMLElement & { shadowRoot?: ShadowRoot }) | null;
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
  }, PLAYER);
}

interface Stats {
  red: number;
  blue: number;
}

/** Count dominant-red vs dominant-blue pixels in the player screenshot. */
function analyse(buf: Buffer): Stats {
  const img = PNG.sync.read(buf);
  let red = 0;
  let blue = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const a = img.data[i + 3];
    if (a < 128) continue;
    if (r > 150 && b < 80 && g < 80) red++;
    else if (b > 150 && r < 80 && g < 80) blue++;
  }
  return { red, blue };
}

async function screenshotPlayer(page: Page): Promise<Stats> {
  await hidePanelOverlays(page);
  // Give Ruffle a beat to render the seeked frame.
  await page.waitForTimeout(800);
  await hidePanelOverlays(page);
  const buf = await page.locator(PLAYER).screenshot();
  return analyse(buf);
}

test('Live Preview start-scene override actually seeks the previewed SWF (task 1339)', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).__flashTest !== 'undefined');

  await loadTwoSceneDoc(page);

  // Open the Live Preview tab and let the first compile settle.
  await page.locator('[data-testid="top-tab-preview"]').click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect.poll(() => statusText(page), { timeout: 25000 }).toBe('up-to-date');
  await expect(page.locator(PLAYER)).toHaveCount(1, { timeout: 15000 });

  // ---- Default start (scene 0) → preview is RED. --------------------------
  // Verified empirically (task 1339): default stats are { red: ~146300, blue: 0 }.
  const def = await screenshotPlayer(page);
  expect(def.red).toBeGreaterThan(1000);
  expect(def.red).toBeGreaterThan(def.blue); // RED dominates at the default start

  // ---- Override start scene = 1 → preview must seek to BLUE scene. ---------
  await page.locator('[data-testid="preview-start-scene"]').selectOption('1');
  // Recompile + reseek settles back to up-to-date.
  await expect.poll(() => statusText(page), { timeout: 25000 }).toBe('up-to-date');
  await expect(page.locator(PLAYER)).toHaveCount(1);

  const overridden = await screenshotPlayer(page);
  // The fix: BLUE now appears and dominates (scene 1 reached). Before the fix
  // the goto no-oped and the preview stayed RED (scene 0 / frame 1) with blue=0
  // — exactly the reported bug, which this oracle was verified to catch.
  expect(overridden.blue).toBeGreaterThan(1000);
  expect(overridden.blue).toBeGreaterThan(overridden.red); // BLUE now dominates
});
