import { test, expect } from '@playwright/test';

test('runJSFL can add a rectangle via JSFL', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      var doc = fl.getDocumentDOM();
      fl.trace("doc size: " + doc.width + "x" + doc.height);
      doc.addNewRectangle({left:10, top:10, right:110, bottom:110}, 0);
    `);
  });
  expect(result.traces).toContain('doc size: 550x400');
  expect(result.finalDocument).toBeDefined();
});

test('runJSFL traces are captured', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      fl.trace("hello from JSFL");
      fl.trace("fl version: " + fl.version);
    `);
  });
  expect(result.traces).toContain('hello from JSFL');
  expect(result.traces).toContain('fl version: 8,0,0,0');
});

test('runJSFL script errors are returned in error field', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      throw new Error("intentional test error");
    `);
  });
  expect(result.error).toBeDefined();
  expect(result.error).toContain('intentional test error');
});
