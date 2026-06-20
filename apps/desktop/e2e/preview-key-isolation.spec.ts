/**
 * Keyboard-isolation oracle (task 1324).
 *
 * BUG: keypresses inside a running Ruffle player (Test Movie modal OR the Live
 * Preview tab) leaked to the authoring app — arrow keys nudged selected stage
 * shapes, letter keys switched the active tool, and keys could trigger preview
 * reloads. The SWF should receive the keys; the authoring global shortcuts must
 * NOT fire while the player is focused.
 *
 * This spec proves the fix in the real app: with the Live Preview tab's
 * <ruffle-player> FOCUSED, a tool-shortcut letter key does NOT change the active
 * authoring tool. A control assertion first proves the same key DOES switch the
 * tool when the stage (not the player) is focused — so the negative result is
 * meaningful (the key is genuinely delivered, just ignored by the editor while
 * the player owns input).
 *
 * Run locally with:
 *   cd apps/desktop && npx playwright test e2e/preview-key-isolation.spec.ts --reporter=line
 */

import { test, expect, Page } from '@playwright/test';

const STATUS = '[data-testid="preview-status-pill"]';
const PLAYER = '[data-testid="live-preview-panel"] ruffle-player';

async function statusText(page: Page): Promise<string> {
  return (await page.locator(STATUS).getAttribute('data-status')) ?? '';
}

async function activeTool(page: Page): Promise<string> {
  return await page.evaluate(() => (window as any).__flashTest.getActiveTool());
}

test('keys inside the focused Live Preview player do NOT switch the authoring tool', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).__flashTest !== 'undefined');

  // Start on a known tool.
  await page.evaluate(() => (window as any).__flashTest.selectTool('selection'));
  expect(await activeTool(page)).toBe('selection');

  // ---- CONTROL: with focus on the editor (the timeline panel, NOT a player), -
  // "t" DOES switch to the Text tool. Proves the keypress is genuinely delivered
  // to the editor's global tool-shortcut handler (so the negative assertion below
  // is meaningful). Click a neutral editor chrome region to give the page focus
  // without opening a menu/overlay.
  await page.locator('[data-testid="timeline-panel"]').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('t');
  await expect.poll(() => activeTool(page), { timeout: 5000 }).toBe('text');

  // Reset to selection before the real test.
  await page.evaluate(() => (window as any).__flashTest.selectTool('selection'));
  expect(await activeTool(page)).toBe('selection');

  // ---- Open Live Preview and let it compile + embed a Ruffle player. -------
  await page.locator('[data-testid="top-tab-preview"]').click();
  await expect(page.locator('[data-testid="live-preview-panel"]')).toBeVisible();
  await expect.poll(() => statusText(page), { timeout: 20000 }).toBe('up-to-date');
  await expect(page.locator(PLAYER)).toHaveCount(1, { timeout: 15000 });

  // Focus the player (a real click — focus is load-bearing for Ruffle's keys).
  await page.locator(PLAYER).click();

  // ---- The key event now targets the player; the editor must IGNORE it. ----
  // Press the same "t" tool shortcut, plus an arrow key and the F8 / "p" shapes.
  await page.keyboard.press('t');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('p');
  await page.keyboard.press('ArrowLeft');

  // The active tool MUST still be "selection" — the leak is fixed.
  expect(await activeTool(page)).toBe('selection');
});
