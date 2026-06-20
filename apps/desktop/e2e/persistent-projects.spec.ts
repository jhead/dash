/**
 * Browser-persistent projects oracle (task 1310).
 *
 * Proves end-to-end, in the real web app, that:
 *   1. AUTOSAVE + RESTORE-ON-LOAD: an in-progress edit survives a full page
 *      reload (F5) via the IndexedDB current-working slot — no Save needed.
 *   2. SAVE AS + REOPEN-NAMED: Save As <name> stores the project under that name,
 *      reflects it in the title bar, and a reload reopens the SAME named project
 *      (active name restored).
 *   3. OPEN RECENT: the named project appears in the recent list.
 *
 * The app runs in DEV (non-Tauri), so the IndexedDB autosave path is active.
 * We drive it through the `window.__flashTest` bridge (DEV-only).
 *
 * Run locally with:
 *   cd apps/desktop && npx playwright test e2e/persistent-projects.spec.ts --reporter=line
 */

import { test, expect, Page } from '@playwright/test';

/** Wait for the app + DEV bridge to be ready. */
async function bootApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).__flashTest !== 'undefined', {
    timeout: 15000,
  });
  // Restore-on-load runs once on mount; let it settle.
  await page.waitForTimeout(300);
}

/** Set the document background color (a stable, easy-to-read property) + load it. */
async function setBackgroundColor(page: Page, color: string): Promise<void> {
  await page.evaluate((c) => {
    const ft = (window as any).__flashTest;
    const doc = ft.getDocument();
    const next = {
      ...doc,
      properties: { ...doc.properties, backgroundColor: c },
    };
    ft.loadDocument(next);
  }, color);
}

async function getBackgroundColor(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__flashTest.getDocument().properties.backgroundColor);
}

// Each test gets a clean IndexedDB so the slots don't bleed across cases.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('dash-projects');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    try { localStorage.removeItem('flash8.recentProjects'); } catch { /* ignore */ }
  });
});

test('autosave + reload restores the in-progress (unnamed) document', async ({ page }) => {
  await bootApp(page);

  // Edit: change the background to a recognizable color.
  await setBackgroundColor(page, '#123456');
  expect(await getBackgroundColor(page)).toBe('#123456');

  // Force-flush the debounced autosave (so the reload definitely sees it).
  await page.evaluate(() => (window as any).__flashTest.flushAutosave());

  // F5.
  await bootApp(page);

  // The in-progress edit survived.
  expect(await getBackgroundColor(page)).toBe('#123456');
});

test('Save As names the project, reflects it in the title bar, and reload reopens it', async ({ page }) => {
  await bootApp(page);

  await setBackgroundColor(page, '#abcdef');

  // Save As "MyGame".
  const saved = await page.evaluate(() => (window as any).__flashTest.saveProjectAs('MyGame'));
  expect(saved).toBe(true);

  // Title bar reflects the active project name.
  await expect(page.getByText('MyGame', { exact: false }).first()).toBeVisible();
  const activeName = await page.evaluate(() => (window as any).__flashTest.getActiveProjectName());
  expect(activeName).toBe('MyGame');

  // It appears in the recent list.
  const recent = await page.evaluate(() => (window as any).__flashTest.getRecentProjects());
  expect(recent.map((e: any) => e.id)).toContain('MyGame');

  // F5 → reopens the named project with its content + active name.
  await bootApp(page);
  expect(await page.evaluate(() => (window as any).__flashTest.getActiveProjectName())).toBe('MyGame');
  expect(await getBackgroundColor(page)).toBe('#abcdef');
});

test('plain Save updates the active named slot', async ({ page }) => {
  await bootApp(page);
  await setBackgroundColor(page, '#111111');
  await page.evaluate(() => (window as any).__flashTest.saveProjectAs('Proj'));

  // Change again, then plain Save into the active slot.
  await setBackgroundColor(page, '#222222');
  const ok = await page.evaluate(() => (window as any).__flashTest.saveProject());
  expect(ok).toBe(true);

  await bootApp(page);
  expect(await page.evaluate(() => (window as any).__flashTest.getActiveProjectName())).toBe('Proj');
  expect(await getBackgroundColor(page)).toBe('#222222');
});
