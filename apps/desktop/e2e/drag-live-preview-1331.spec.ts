/**
 * Task 1331 verification: live drag-preview for vector shapes (merge model).
 *
 * BUG: dragging a plain vector shape (tool rect/oval OR brush stroke) with the
 * Selection tool showed NO live preview — the artwork stayed at its original
 * position during the drag and only jumped to the final position on mouse-UP
 * (the split-on-move committed only on pointerup; no per-move render).
 *
 * FIX (StageArea.tsx): while a split-on-move drag is in flight, the extracted
 * piece is rendered following the cursor every pointermove WITHOUT mutating the
 * doc; the authoritative split commits once on pointerup (one undo step).
 *
 * This spec drives a real press-drag and screenshots the LIVE stage canvas
 * (page.screenshot clipped to the canvas — composites the actual render,
 * including the transient preview) BETWEEN the last move and the up:
 *   - MID-DRAG: drawn pixels appear at the DRAGGED-target region (preview
 *     follows cursor) and the ORIGIN region is largely vacated.
 *   - A click WITHOUT a drag (below threshold) only selects — the artwork does
 *     not move, mid-"drag" the origin still has the artwork.
 *
 * It runs for a tool-drawn rect and a curve-based oval (a brush stroke commits
 * the same kind of `shape` display object and takes the identical drag path).
 */
import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('[data-testid="stage-canvas"]', { timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).__flashTest !== 'undefined', { timeout: 15000 });
}

async function selectTool(page: Page, tool: string): Promise<void> {
  await page.evaluate((t) => (window as any).__flashTest.selectTool(t), tool);
  await expect
    .poll(() => page.evaluate(() => (window as any).__flashTest.getActiveTool()))
    .toBe(tool);
}

async function dispatchPointer(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
  buttons: number,
): Promise<void> {
  await page.evaluate(
    ({ type, x, y, buttons }) => {
      const canvas = document.querySelector('[data-testid="stage-canvas"]');
      let el: HTMLElement | null = canvas as HTMLElement | null;
      while (el && getComputedStyle(el).touchAction !== 'none') el = el.parentElement;
      const target = (el ?? canvas) as HTMLElement;
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        }),
      );
    },
    { type, x, y, buttons },
  );
}

async function canvasRect(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLElement;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

/**
 * Count "drawn" (non-near-white) pixels inside an axis-aligned client-space box
 * by screenshotting the page clipped to that box. Captures the LIVE on-screen
 * canvas render (the transient preview included), unlike __flashTest.screenshotStage.
 */
// The fill we draw with — a near-black distinct from the grey pasteboard (~#666)
// and the white stage, so a colour-match cleanly isolates OUR artwork.
const FILL_RGB = { r: 0x10, g: 0x10, b: 0x10 };
function isFillPixel(r: number, g: number, b: number): boolean {
  return (
    Math.abs(r - FILL_RGB.r) < 45 &&
    Math.abs(g - FILL_RGB.g) < 45 &&
    Math.abs(b - FILL_RGB.b) < 45
  );
}

async function drawnPixelsInBox(
  page: Page,
  box: { x: number; y: number; w: number; h: number },
): Promise<number> {
  const buf = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.w, height: box.h },
  });
  const img = PNG.sync.read(buf);
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (isFillPixel(img.data[i], img.data[i + 1], img.data[i + 2])) n++;
  }
  return n;
}

// Drive a press + a series of moves, then (without releasing) take the mid-drag
// measurement via `onMidDrag`, THEN release.
async function pressDragHoldThenUp(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  onMidDrag: () => Promise<void>,
  steps = 8,
): Promise<void> {
  await dispatchPointer(page, 'pointerdown', from.x, from.y, 1);
  await page.waitForTimeout(20);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await dispatchPointer(
      page,
      'pointermove',
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
      1,
    );
    await page.waitForTimeout(15);
  }
  // Pointer is still DOWN here — observe the live preview.
  await onMidDrag();
  await dispatchPointer(page, 'pointerup', to.x, to.y, 0);
  await page.waitForTimeout(20);
}

// The default fill is WHITE; set a dark fill so drawn artwork is distinguishable
// from the white stage when counting "drawn" pixels in a screenshot. Also drop
// the stroke so a curved shape commits as a single clean fill loop (a stroked
// ellipse fragments into many merge loops whose centre face is hard to pick —
// orthogonal to this test).
async function setDarkFillNoStroke(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__flashTest.setFillColor('#101010');
    (window as any).__flashTest.setStrokeNone();
  });
}

// Find the centroid (in CLIENT/page coords) of dark "drawn" pixels within a
// search box, by screenshotting that box and averaging dark-pixel positions.
// Returns null if no drawn pixels are found.
async function darkCentroidInBox(
  page: Page,
  box: { x: number; y: number; w: number; h: number },
): Promise<{ x: number; y: number; count: number } | null> {
  const buf = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.w, height: box.h },
  });
  const img = PNG.sync.read(buf);
  // page.screenshot honours devicePixelRatio; map PNG px → client px.
  const sx = img.width / box.w;
  const sy = img.height / box.h;
  let sumX = 0, sumY = 0, n = 0;
  for (let py = 0; py < img.height; py++) {
    for (let px = 0; px < img.width; px++) {
      const i = (py * img.width + px) * 4;
      if (isFillPixel(img.data[i], img.data[i + 1], img.data[i + 2])) {
        sumX += px;
        sumY += py;
        n++;
      }
    }
  }
  if (n === 0) return null;
  return { x: box.x + sumX / n / sx, y: box.y + sumY / n / sy, count: n };
}

async function drawAndDragLivePreview(page: Page, tool: 'rect' | 'oval'): Promise<void> {
  await boot(page);
  await setDarkFillNoStroke(page);
  await selectTool(page, tool);
  const r = await canvasRect(page);

  // Draw a shape near the centre of the (white) stage. Both rect and oval are a
  // simple press-drag-release that commits a filled `shape` display object — the
  // same kind a brush stroke produces, and all take the identical Selection-tool
  // split-on-move drag path being exercised here.
  const drawFrom = { x: r.left + r.width * 0.42, y: r.top + r.height * 0.4 };
  const drawTo = { x: r.left + r.width * 0.52, y: r.top + r.height * 0.5 };
  await dispatchPointer(page, 'pointerdown', drawFrom.x, drawFrom.y, 1);
  await page.waitForTimeout(15);
  await dispatchPointer(page, 'pointermove', drawTo.x, drawTo.y, 1);
  await page.waitForTimeout(15);
  await dispatchPointer(page, 'pointerup', drawTo.x, drawTo.y, 0);
  await page.waitForTimeout(40);

  // Locate the drawn artwork's render centroid empirically (works regardless of
  // the exact committed geometry / zoom): scan a wide region around the draw box.
  const searchBox = {
    x: Math.min(drawFrom.x, drawTo.x) - 40,
    y: Math.min(drawFrom.y, drawTo.y) - 40,
    w: Math.abs(drawTo.x - drawFrom.x) + 80,
    h: Math.abs(drawTo.y - drawFrom.y) + 80,
  };
  const centroid = await darkCentroidInBox(page, searchBox);
  expect(centroid, 'drawn artwork should be visible before drag').not.toBeNull();
  const center = { x: centroid!.x, y: centroid!.y };
  const half = 26;
  const originBox = { x: center.x - half, y: center.y - half, w: half * 2, h: half * 2 };

  // Drag target: +200 client px to the right.
  const dragDX = 200;
  const targetBox = { x: originBox.x + dragDX, y: originBox.y, w: originBox.w, h: originBox.h };

  // Baseline: artwork drawn at origin, nothing at the target yet.
  const originBefore = await drawnPixelsInBox(page, originBox);
  const targetBefore = await drawnPixelsInBox(page, targetBox);
  expect(originBefore).toBeGreaterThan(50);

  await selectTool(page, 'selection');

  let midOrigin = -1;
  let midTarget = -1;
  await pressDragHoldThenUp(
    page,
    center,
    { x: center.x + dragDX, y: center.y },
    async () => {
      midTarget = await drawnPixelsInBox(page, targetBox);
      midOrigin = await drawnPixelsInBox(page, originBox);
    },
  );

  // CORE ASSERTION (the bug): MID-DRAG the artwork follows the cursor — the
  // dragged-target region is populated and the origin region is largely vacated.
  expect(midTarget).toBeGreaterThan(targetBefore + 50);
  expect(midTarget).toBeGreaterThan(midOrigin);
}

test.describe('task 1331 — live drag preview for vector shapes', () => {
  test('rect: split-on-move drag shows a live preview at the cursor mid-drag', async ({ page }) => {
    await drawAndDragLivePreview(page, 'rect');
  });

  // The oval covers CURVE-based filled geometry (like a brush blob); a brush
  // stroke is the same `shape` display object and takes the identical drag path.
  test('oval: split-on-move drag shows a live preview at the cursor mid-drag', async ({ page }) => {
    await drawAndDragLivePreview(page, 'oval');
  });

  test('a click WITHOUT a drag only selects — artwork does not move', async ({ page }) => {
    await boot(page);
    await setDarkFillNoStroke(page);
    await selectTool(page, 'rect');
    const r = await canvasRect(page);
    const drawFrom = { x: r.left + r.width * 0.4, y: r.top + r.height * 0.4 };
    const drawTo = { x: r.left + r.width * 0.55, y: r.top + r.height * 0.55 };
    await dispatchPointer(page, 'pointerdown', drawFrom.x, drawFrom.y, 1);
    await page.waitForTimeout(15);
    await dispatchPointer(page, 'pointermove', drawTo.x, drawTo.y, 1);
    await page.waitForTimeout(15);
    await dispatchPointer(page, 'pointerup', drawTo.x, drawTo.y, 0);
    await page.waitForTimeout(40);

    const center = { x: (drawFrom.x + drawTo.x) / 2, y: (drawFrom.y + drawTo.y) / 2 };
    const half = 28;
    const originBox = { x: center.x - half, y: center.y - half, w: half * 2, h: half * 2 };
    const originBefore = await drawnPixelsInBox(page, originBox);
    expect(originBefore).toBeGreaterThan(50);

    await selectTool(page, 'selection');
    // Press, move only 2px (below the 3px threshold), then release: a plain click.
    await dispatchPointer(page, 'pointerdown', center.x, center.y, 1);
    await page.waitForTimeout(15);
    await dispatchPointer(page, 'pointermove', center.x + 2, center.y, 1);
    await page.waitForTimeout(15);
    const midOrigin = await drawnPixelsInBox(page, originBox);
    await dispatchPointer(page, 'pointerup', center.x + 2, center.y, 0);
    await page.waitForTimeout(40);

    // The artwork stayed put during the sub-threshold "click".
    expect(midOrigin).toBeGreaterThan(originBefore - 50);
    // And after release it is still at the origin (no move committed).
    const afterOrigin = await drawnPixelsInBox(page, originBox);
    expect(afterOrigin).toBeGreaterThan(originBefore - 50);
  });
});
