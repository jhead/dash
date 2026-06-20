/**
 * Task 1275 verification: stage interactions driven by Pointer Events.
 *
 * Commit b3a4bc4 migrated the stage work-area from mouse events
 * (onMouseDown/Move/Up) to pointer events (onPointerDown/Move/Up) so that
 * touch input works, and added touchAction:'none'. This spec is a behavioural
 * gate that:
 *   (1) DESKTOP REGRESSION — the same interactions that were recently fixed
 *       (draw, brush 1260, selection drag-move 1264, eraser 1263) still work
 *       when driven by real pointer input.
 *   (2) TOUCH — drawing now works when the pointer source is a finger
 *       (pointerType:'touch'), which previously did nothing.
 *
 * Input is dispatched as native PointerEvent on the stage work-area element so
 * that pointerType can be controlled. React 17+ attaches native pointer
 * listeners for onPointer*, so dispatched events drive the real handlers.
 */
import { test, expect, type Page } from '@playwright/test';

// Count all shape display objects across every scene/layer/frame in the doc.
async function countShapes(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc: any = (window as any).__flashTest.getDocument();
    let n = 0;
    for (const scene of doc.scenes ?? []) {
      for (const layer of scene.timeline?.layers ?? []) {
        for (const frame of layer.frames ?? []) {
          for (const obj of frame.displayObjects ?? []) {
            if (obj.type === 'shape') n++;
          }
        }
      }
    }
    return n;
  });
}

// Find the first shape's stage position (x,y) so we can drag it.
async function firstShapePos(page: Page): Promise<{ id: string; x: number; y: number } | null> {
  return page.evaluate(() => {
    const doc: any = (window as any).__flashTest.getDocument();
    for (const scene of doc.scenes ?? []) {
      for (const layer of scene.timeline?.layers ?? []) {
        for (const frame of layer.frames ?? []) {
          for (const obj of frame.displayObjects ?? []) {
            if (obj.type === 'shape') return { id: obj.id, x: obj.x, y: obj.y };
          }
        }
      }
    }
    return null;
  });
}

// Stage-space centroid of the first shape's geometry (object offset + the mean of
// its path anchor points). In MERGE mode (the default model) a selection drag of a
// whole filled region extracts + translates the geometry rather than moving the
// display-object (x,y), so a move must be observed in the geometry, not obj.x/y.
async function firstShapeStageCenter(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const doc: any = (window as any).__flashTest.getDocument();
    for (const scene of doc.scenes ?? []) {
      for (const layer of scene.timeline?.layers ?? []) {
        for (const frame of layer.frames ?? []) {
          for (const obj of frame.displayObjects ?? []) {
            if (obj.type !== 'shape') continue;
            let sx = 0, sy = 0, n = 0;
            for (const p of obj.shape?.paths ?? []) {
              if (p.start) { sx += p.start.x; sy += p.start.y; n++; }
              for (const seg of p.segments ?? []) {
                if (seg.to) { sx += seg.to.x; sy += seg.to.y; n++; }
              }
            }
            if (n === 0) return { x: obj.x ?? 0, y: obj.y ?? 0 };
            return { x: (obj.x ?? 0) + sx / n, y: (obj.y ?? 0) + sy / n };
          }
        }
      }
    }
    return null;
  });
}

// Dispatch a single PointerEvent on the stage work-area element.
async function dispatchPointer(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
  buttons: number,
  pointerType: 'mouse' | 'touch',
): Promise<void> {
  await page.evaluate(
    ({ type, x, y, buttons, pointerType }) => {
      // The work-area is the interaction surface that owns the pointer
      // handlers; it is the touchAction:none ancestor of [data-testid=stage-canvas].
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
          pointerType,
          isPrimary: true,
        }),
      );
    },
    { type, x, y, buttons, pointerType },
  );
}

// Press-drag-release as PointerEvents. Each event is a separate evaluate with a
// small wait so React flushes state (e.g. drawPreview) between move and up,
// matching the cadence of real human input. from/to are CLIENT coordinates.
async function pointerDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerType: 'mouse' | 'touch',
  steps = 8,
): Promise<void> {
  await dispatchPointer(page, 'pointerdown', from.x, from.y, 1, pointerType);
  await page.waitForTimeout(20);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    await dispatchPointer(page, 'pointermove', x, y, 1, pointerType);
    await page.waitForTimeout(15);
  }
  await dispatchPointer(page, 'pointerup', to.x, to.y, 0, pointerType);
  await page.waitForTimeout(20);
}

// Center client coordinate of the stage canvas, for relative offsets.
async function canvasRect(page: Page): Promise<{ left: number; top: number; width: number; height: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="stage-canvas"]') as HTMLElement;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('[data-testid="stage-canvas"]', { timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).__flashTest !== 'undefined', { timeout: 15000 });
}

async function selectTool(page: Page, tool: string): Promise<void> {
  await page.evaluate((t) => (window as any).__flashTest.selectTool(t), tool);
  await expect.poll(() => page.evaluate(() => (window as any).__flashTest.getActiveTool())).toBe(tool);
}

test.describe('task 1275 — pointer-driven stage interactions', () => {
  test('static guard: work-area binds touchAction:none', async ({ page }) => {
    await boot(page);
    const ta = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="stage-canvas"]');
      let el: HTMLElement | null = canvas as HTMLElement | null;
      while (el) {
        if (getComputedStyle(el).touchAction === 'none') return 'none';
        el = el.parentElement;
      }
      return 'missing';
    });
    expect(ta).toBe('none');
  });

  test('DESKTOP: rectangle tool draws a shape via mouse pointer', async ({ page }) => {
    await boot(page);
    const before = await countShapes(page);
    await selectTool(page, 'rect');
    const r = await canvasRect(page);
    await pointerDrag(
      page,
      { x: r.left + r.width * 0.35, y: r.top + r.height * 0.35 },
      { x: r.left + r.width * 0.6, y: r.top + r.height * 0.6 },
      'mouse',
    );
    await expect.poll(() => countShapes(page)).toBeGreaterThan(before);
  });

  test('DESKTOP: brush draws a stroke via mouse pointer (1260)', async ({ page }) => {
    await boot(page);
    const before = await countShapes(page);
    await selectTool(page, 'brush');
    const r = await canvasRect(page);
    await pointerDrag(
      page,
      { x: r.left + r.width * 0.3, y: r.top + r.height * 0.5 },
      { x: r.left + r.width * 0.7, y: r.top + r.height * 0.5 },
      'mouse',
      12,
    );
    await expect.poll(() => countShapes(page)).toBeGreaterThan(before);
  });

  test('DESKTOP: selection drag-move persists, no snap-back (1264)', async ({ page }) => {
    await boot(page);
    // First draw a rectangle to move.
    await selectTool(page, 'rect');
    const r = await canvasRect(page);
    await pointerDrag(
      page,
      { x: r.left + r.width * 0.3, y: r.top + r.height * 0.3 },
      { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 },
      'mouse',
    );
    await expect.poll(() => countShapes(page)).toBeGreaterThan(0);
    // In MERGE mode (the default vector model) a drawn rect commits as a single
    // merged shape at (0,0) with the geometry in stage space; dragging the whole
    // filled region extracts + translates the GEOMETRY (the artwork moves), not
    // the display-object offset. So track the stage-space centroid of the artwork.
    const start = await firstShapeStageCenter(page);
    expect(start).not.toBeNull();

    // Switch to selection tool, click on the shape and drag it right+down.
    await selectTool(page, 'selection');
    // Press at the shape centre area, drag by +80,+60 client px.
    const grabX = r.left + r.width * 0.4;
    const grabY = r.top + r.height * 0.4;
    await pointerDrag(page, { x: grabX, y: grabY }, { x: grabX + 80, y: grabY + 60 }, 'mouse');

    // Allow commit, then re-read; the artwork must have moved AND stayed moved.
    await page.waitForTimeout(150);
    const moved = await firstShapeStageCenter(page);
    expect(moved).not.toBeNull();
    const dx = Math.abs((moved!.x ?? 0) - (start!.x ?? 0));
    const dy = Math.abs((moved!.y ?? 0) - (start!.y ?? 0));
    // Should have moved by roughly the drag delta (in stage px) and not reverted.
    expect(dx + dy).toBeGreaterThan(20);
  });

  test('DESKTOP: eraser stroke modifies geometry (1263)', async ({ page }) => {
    await boot(page);
    // Draw a big filled rect first.
    await selectTool(page, 'rect');
    const r = await canvasRect(page);
    await pointerDrag(
      page,
      { x: r.left + r.width * 0.25, y: r.top + r.height * 0.25 },
      { x: r.left + r.width * 0.75, y: r.top + r.height * 0.75 },
      'mouse',
    );
    await expect.poll(() => countShapes(page)).toBeGreaterThan(0);
    // Snapshot the shape geometry signature before erasing.
    const sigBefore = await page.evaluate(() => {
      const doc: any = (window as any).__flashTest.getDocument();
      for (const scene of doc.scenes ?? [])
        for (const layer of scene.timeline?.layers ?? [])
          for (const frame of layer.frames ?? [])
            for (const obj of frame.displayObjects ?? [])
              if (obj.type === 'shape') return JSON.stringify(obj.shape).length;
      return 0;
    });

    await selectTool(page, 'eraser');
    // Erase a stroke through the interior of the rect.
    await pointerDrag(
      page,
      { x: r.left + r.width * 0.35, y: r.top + r.height * 0.5 },
      { x: r.left + r.width * 0.65, y: r.top + r.height * 0.5 },
      'mouse',
      12,
    );
    await page.waitForTimeout(150);
    const sigAfter = await page.evaluate(() => {
      const doc: any = (window as any).__flashTest.getDocument();
      for (const scene of doc.scenes ?? [])
        for (const layer of scene.timeline?.layers ?? [])
          for (const frame of layer.frames ?? [])
            for (const obj of frame.displayObjects ?? [])
              if (obj.type === 'shape') return JSON.stringify(obj.shape).length;
      return 0;
    });
    // Eraser interior subtraction changes the shape geometry (adds hole / path).
    expect(sigAfter).not.toBe(sigBefore);
  });

  test('TOUCH: drawing a rectangle via touch pointer creates a shape (the 1275 fix)', async ({ page }) => {
    await boot(page);
    const before = await countShapes(page);
    await selectTool(page, 'rect');
    const r = await canvasRect(page);
    await pointerDrag(
      page,
      { x: r.left + r.width * 0.35, y: r.top + r.height * 0.35 },
      { x: r.left + r.width * 0.6, y: r.top + r.height * 0.6 },
      'touch',
    );
    await expect.poll(() => countShapes(page)).toBeGreaterThan(before);
  });

  test('TOUCH: brush draw via touch pointer creates a stroke', async ({ page }) => {
    await boot(page);
    const before = await countShapes(page);
    await selectTool(page, 'brush');
    const r = await canvasRect(page);
    await pointerDrag(
      page,
      { x: r.left + r.width * 0.3, y: r.top + r.height * 0.5 },
      { x: r.left + r.width * 0.7, y: r.top + r.height * 0.55 },
      'touch',
      12,
    );
    await expect.poll(() => countShapes(page)).toBeGreaterThan(before);
  });
});
