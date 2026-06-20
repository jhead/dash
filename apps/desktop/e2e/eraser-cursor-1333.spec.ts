/**
 * Task 1333 verification: the Eraser tool shows the round eraser-disk cursor
 * during a drag, NOT a rectangular selection-style marquee.
 *
 * Bug (USER-REPORTED): with the Eraser tool active, dragging on the stage drew
 * an orange dashed RECTANGLE with a translucent orange fill bounding the entire
 * drag path — it looked like a selection marquee. Flash 8's eraser only ever
 * shows a round eraser-tip cursor; it never draws a bounding rectangle.
 *
 * Root cause was a spurious leftover `eraserPreview` bounding-rect that the
 * mouse-move handler set on every eraser move and rendered as an orange dashed
 * `<div>` (border 1px dashed #ff6600, background rgba(255,100,0,0.1)). The fix
 * removed that preview state + its overlay entirely; the disk-cursor overlay
 * (borderRadius:50%) + the real-time vector erase already give correct feedback.
 *
 * This spec drags the eraser across the stage and asserts MID-DRAG that:
 *   (1) NO overlay div with a dashed orange border (the marquee) exists, and
 *   (2) the round eraser-disk cursor overlay (borderRadius:50%) IS present.
 */
import { test, expect, type Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('[data-testid="stage-canvas"]', { timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).__flashTest !== 'undefined', { timeout: 15000 });
}

async function selectTool(page: Page, tool: string): Promise<void> {
  await page.evaluate((t) => (window as any).__flashTest.selectTool(t), tool);
  await expect.poll(() => page.evaluate(() => (window as any).__flashTest.getActiveTool())).toBe(tool);
}

// Dispatch a single PointerEvent on the stage work-area element (the
// touchAction:none ancestor of the stage canvas that owns the pointer handlers).
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
      while (el && getComputedStyle(el).touchAction !== 'none') {
        el = el.parentElement;
      }
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

async function canvasRect(page: Page): Promise<{ left: number; top: number; width: number; height: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLElement;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

// Count overlay divs that look like the dashed-orange selection rectangle:
// a dashed border whose colour is the marquee orange rgb(255,102,0)/#ff6600.
async function countDashedOrangeRects(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    for (const el of Array.from(document.querySelectorAll('div'))) {
      const cs = getComputedStyle(el);
      const dashed = cs.borderStyle.includes('dashed');
      const col = (cs.borderColor + ' ' + cs.borderTopColor).toLowerCase();
      const isOrange = col.includes('255, 102, 0') || col.includes('rgb(255,102,0)');
      // Exclude a zero-size element (the round cursor has 50% radius, not dashed).
      const r = el.getBoundingClientRect();
      if (dashed && isOrange && r.width > 1 && r.height > 1) n++;
    }
    return n;
  });
}

// Count round eraser-disk cursor overlays: a div with borderRadius 50%.
async function countRoundCursors(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    for (const el of Array.from(document.querySelectorAll('div'))) {
      const cs = getComputedStyle(el);
      // 50% on a sized box resolves to half its pixel width, so just check the
      // raw inline style for the circular marker.
      const radius = (el as HTMLElement).style.borderRadius;
      if (radius === '50%') n++;
    }
    return n;
  });
}

test.describe('task 1333 — eraser shows disk cursor, not a selection rectangle', () => {
  test('dragging the eraser shows NO dashed-orange marquee, only the round disk cursor', async ({ page }) => {
    await boot(page);
    await selectTool(page, 'eraser');

    const rect = await canvasRect(page);
    const from = { x: rect.left + rect.width * 0.3, y: rect.top + rect.height * 0.3 };
    const to = { x: rect.left + rect.width * 0.7, y: rect.top + rect.height * 0.7 };

    // Begin the drag and move partway so any per-move preview would be live.
    await dispatchPointer(page, 'pointerdown', from.x, from.y, 1);
    await page.waitForTimeout(20);

    let sawRoundCursorMidDrag = false;
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      await dispatchPointer(page, 'pointermove', x, y, 1);
      await page.waitForTimeout(15);

      // MID-DRAG: the rectangular marquee must NOT appear.
      const rects = await countDashedOrangeRects(page);
      expect(rects, 'no dashed-orange selection rectangle during eraser drag').toBe(0);

      if ((await countRoundCursors(page)) > 0) sawRoundCursorMidDrag = true;
    }

    // The authentic Flash 8 eraser disk cursor is shown during the drag.
    expect(sawRoundCursorMidDrag, 'round eraser-disk cursor shown during drag').toBe(true);

    await dispatchPointer(page, 'pointerup', to.x, to.y, 0);
    await page.waitForTimeout(20);

    // And no marquee lingers after release either.
    expect(await countDashedOrangeRects(page)).toBe(0);
  });
});
