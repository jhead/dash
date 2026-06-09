import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Existing tests
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Task 0616 — expanded JSFL API
// ---------------------------------------------------------------------------

test('JSFL: document property setters (width, height, frameRate, backgroundColor)', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      var doc = fl.getDocumentDOM();
      doc.width = 800;
      doc.height = 600;
      doc.frameRate = 24;
      doc.backgroundColor = "#336699";
      fl.trace(doc.width);
      fl.trace(doc.height);
      fl.trace(doc.frameRate);
      fl.trace(doc.backgroundColor);
    `);
  });
  expect(result.error).toBeUndefined();
  expect(result.traces).toContain('800');
  expect(result.traces).toContain('600');
  expect(result.traces).toContain('24');
  expect(result.traces).toContain('#336699');
});

test('JSFL: timeline.layers[] access and layer property setters', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      var tl = fl.getDocumentDOM().getTimeline();
      fl.trace(tl.layers.length);
      tl.layers[0].name = "Actions";
      fl.trace(tl.layers[0].name);
      tl.layers[0].locked = true;
      fl.trace(tl.layers[0].locked);
    `);
  });
  expect(result.error).toBeUndefined();
  expect(result.traces).toContain('Actions');
  expect(result.traces).toContain('true');
});

test('JSFL: timeline.addNewLayer and deleteLayer', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      var tl = fl.getDocumentDOM().getTimeline();
      var before = tl.layers.length;
      tl.addNewLayer("MyLayer");
      var after = tl.layers.length;
      tl.deleteLayer(0);
      var final = tl.layers.length;
      fl.trace(before + "," + after + "," + final);
    `);
  });
  expect(result.error).toBeUndefined();
  // before=1, after=2, final=1
  expect(result.traces).toContain('1,2,1');
});

test('JSFL: timeline.insertFrames and removeFrames', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      var tl = fl.getDocumentDOM().getTimeline();
      tl.insertFrames(4, 0);
      fl.trace(tl.frameCount >= 4 ? "ok" : "fail");
      tl.removeFrames(2, 0);
      fl.trace(tl.frameCount >= 2 ? "ok2" : "fail2");
    `);
  });
  expect(result.error).toBeUndefined();
  expect(result.traces).toContain('ok');
  expect(result.traces).toContain('ok2');
});

test('JSFL: frame.actionScript get/set', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      var tl = fl.getDocumentDOM().getTimeline();
      fl.trace(tl.layers[0].frames[0].actionScript === "" ? "empty" : "nonempty");
      tl.layers[0].frames[0].actionScript = "stop();";
      fl.trace(tl.layers[0].frames[0].actionScript);
    `);
  });
  expect(result.error).toBeUndefined();
  expect(result.traces).toContain('empty');
  expect(result.traces).toContain('stop();');
});

test('JSFL: frame.labelName get/set', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      var tl = fl.getDocumentDOM().getTimeline();
      tl.layers[0].frames[0].labelName = "intro";
      fl.trace(tl.layers[0].frames[0].labelName);
    `);
  });
  expect(result.error).toBeUndefined();
  expect(result.traces).toContain('intro');
});

test('JSFL: timeline.createMotionTween and setFrameProperty', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      var tl = fl.getDocumentDOM().getTimeline();
      tl.createMotionTween(0);
      fl.trace(tl.layers[0].frames[0].tweenType);
      tl.setFrameProperty("tweenType", "none", 0);
      fl.trace(tl.layers[0].frames[0].tweenType);
    `);
  });
  expect(result.error).toBeUndefined();
  expect(result.traces).toContain('motion');
  expect(result.traces).toContain('none');
});

test('JSFL: doc.library — addNewItem, deleteItem, renameItem', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      var lib = fl.getDocumentDOM().library;
      fl.trace(lib.items.length);
      lib.addNewItem("movie clip", "Ball");
      fl.trace(lib.items.length);
      fl.trace(lib.items[0].name);
      lib.renameItem("Ball", "Sphere");
      fl.trace(lib.items[0].name);
      lib.deleteItem("Sphere");
      fl.trace(lib.items.length);
    `);
  });
  expect(result.error).toBeUndefined();
  expect(result.traces[1]).toBe('1');
  expect(result.traces[2]).toBe('Ball');
  expect(result.traces[3]).toBe('Sphere');
  expect(result.traces[4]).toBe('0');
});

test('JSFL: doc.convertToSymbol converts selection to a library symbol', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      var doc = fl.getDocumentDOM();
      doc.addNewRectangle({left:10,top:10,right:60,bottom:60},0);
      doc.selectAll();
      doc.convertToSymbol("movie clip", "MyClip", "center");
      fl.trace(doc.library.items.length);
      fl.trace(doc.library.items[0].name);
    `);
  });
  expect(result.error).toBeUndefined();
  expect(result.traces).toContain('1');
  expect(result.traces).toContain('MyClip');
});

test('JSFL: doc.deleteSelection removes selected objects', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 10000 });

  const result = await page.evaluate(() => {
    return (window as any).__flashTest.runJSFL(`
      var doc = fl.getDocumentDOM();
      doc.addNewRectangle({left:0,top:0,right:50,bottom:50},0);
      doc.selectAll();
      doc.deleteSelection();
      var tl = doc.getTimeline();
      fl.trace(tl.layers[0].frames[0].elements.length);
    `);
  });
  expect(result.error).toBeUndefined();
  expect(result.traces).toContain('0');
});
