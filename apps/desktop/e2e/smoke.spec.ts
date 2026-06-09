import { test, expect } from '@playwright/test';

test('app loads and bridge is available', async ({ page }) => {
  await page.goto('/');  // baseURL from playwright.config.ts
  await page.waitForSelector('canvas', { timeout: 10000 });

  const bridgeAvailable = await page.evaluate(() => {
    return typeof (window as any).__flashTest !== 'undefined';
  });
  expect(bridgeAvailable).toBe(true);
});

test('getDocument returns valid FlashDocument', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const doc = await page.evaluate(() => (window as any).__flashTest.getDocument());
  expect(doc).toBeDefined();
  expect(doc.scenes).toBeDefined();
  expect(Array.isArray(doc.scenes)).toBe(true);
});

test('getCurrentFrame returns a number', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const frame = await page.evaluate(() => (window as any).__flashTest.getCurrentFrame());
  expect(typeof frame).toBe('number');
  expect(frame).toBeGreaterThanOrEqual(0);
});
