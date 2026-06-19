/**
 * TEMP QA oracle (task 1299) — covers the runtime cases NOT in as2-class-attach.spec.ts:
 *   1. plain (non-FQ) class instantiated via `new Greeter()` + method return used.
 *   2. user-class `extends` user-class: subclass method + inherited method at runtime.
 * Deleted after the QA cycle.
 */
import { test, expect, Page } from '@playwright/test';

async function ensureRuffleLoaded(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) { resolve(); return; }
      const script = document.createElement('script');
      script.src = '/ruffle/ruffle.js';
      script.dataset['ruffle'] = '1';
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Failed to load /ruffle/ruffle.js')), { once: true });
      document.head.appendChild(script);
    });
  });
}

async function collectTraces(page: Page, swfBase64: string, playerId: string, settleMs: number): Promise<string[]> {
  return page.evaluate(async ({ b64, id, settle }) => {
    const ruffleApi = (window as any).RufflePlayer.newest();
    const player = ruffleApi.createPlayer();
    player.id = id;
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;';
    document.body.appendChild(player);
    const traces: string[] = [];
    player.traceObserver = (m: string) => { traces.push(m); };
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const loadPromise = player.ruffle().load({ data: bytes, allowScriptAccess: true, autoplay: 'on', unmuteOverlay: 'hidden', logLevel: 'info' });
    player.traceObserver = (m: string) => { traces.push(m); };
    await loadPromise;
    player.traceObserver = (m: string) => { traces.push(m); };
    await new Promise<void>((r) => setTimeout(r, settle));
    player.remove();
    return traces;
  }, { b64: swfBase64, id: playerId, settle: settleMs });
}

function emptyTimeline(idPrefix: string, isEmpty: boolean, script: string) {
  return {
    layers: [{
      id: `${idPrefix}-layer`, name: 'Layer 1', type: 'normal', visible: true, locked: false,
      outlineMode: false, outlineColor: '#ff0000', height: 20, parentFolderId: null, frameCount: 1,
      frames: [{
        index: 0, isKeyframe: true, isEmpty, tweenType: 'none', label: '', labelType: 'name',
        script, sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
        motionOrientToPath: false, motionSync: false, motionScale: false,
        shapeEase: 0, shapeBlend: 'distributive', displayObjects: [],
      }],
    }],
  };
}

function makeDoc(asClasses: { path: string; source: string }[], frameScript: string) {
  return {
    id: 'tmp-doc',
    properties: {
      width: 550, height: 400, frameRate: 12, backgroundColor: '#ffffff', rulerUnits: 'px',
      grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
      guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
    },
    scenes: [{ id: 'scene-1', name: 'Scene 1', timeline: emptyTimeline('scene', false, frameScript) }],
    library: { items: [], folders: [] },
    asClasses,
    classpaths: ['.'],
  };
}

async function publishAndTrace(page: Page, doc: any, id: string): Promise<string[]> {
  await page.evaluate((d) => { (window as any).__flashTest.loadDocument(d); }, doc);
  await page.waitForTimeout(300);
  const swfBase64: string = await page.evaluate(async () => (window as any).__flashTest.publish());
  expect(swfBase64.length).toBeGreaterThan(0);
  await ensureRuffleLoaded(page);
  return collectTraces(page, swfBase64, id, 2500);
}

test.describe('AS2 user-class runtime extras (task 1299)', () => {
  test.skip(!!process.env.CI, 'runtime oracle — Ruffle WASM not available in CI');
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    expect(await page.evaluate(() => typeof (window as any).__flashTest !== 'undefined')).toBe(true);
  });

  test('plain class: new Greeter() + method return value', async ({ page }) => {
    const src =
      'class Greeter {\n' +
      '  function Greeter() {}\n' +
      '  function greet():String { return "hello-class"; }\n' +
      '}\n';
    const frame = 'var g = new Greeter();\ntrace(g.greet());\n';
    const traces = await publishAndTrace(page, makeDoc([{ path: 'Greeter.as', source: src }], frame), 'p-greeter');
    expect(traces, JSON.stringify(traces)).toContain('hello-class');
  });

  test('extends: subclass + inherited method both run', async ({ page }) => {
    const animal =
      'class Animal {\n' +
      '  function Animal() {}\n' +
      '  function kind():String { return "animal"; }\n' +
      '  function noise():String { return "..."; }\n' +
      '}\n';
    const dog =
      'class Dog extends Animal {\n' +
      '  function Dog() {}\n' +
      '  function noise():String { return "woof"; }\n' +
      '}\n';
    const frame =
      'var d = new Dog();\n' +
      'trace("noise=" + d.noise());\n' +   // overridden in subclass
      'trace("kind=" + d.kind());\n';      // inherited from Animal
    const traces = await publishAndTrace(page,
      makeDoc([{ path: 'Animal.as', source: animal }, { path: 'Dog.as', source: dog }], frame), 'p-dog');
    expect(traces, JSON.stringify(traces)).toContain('noise=woof');
    expect(traces, JSON.stringify(traces)).toContain('kind=animal');
  });

  test('FQ plain class: new com.example.Greeter()', async ({ page }) => {
    const src =
      'class com.example.Greeter {\n' +
      '  function Greeter() {}\n' +
      '  function greet():String { return "fq-hello"; }\n' +
      '}\n';
    const frame = 'var g = new com.example.Greeter();\ntrace(g.greet());\n';
    const traces = await publishAndTrace(page,
      makeDoc([{ path: 'com/example/Greeter.as', source: src }], frame), 'p-fq');
    expect(traces, JSON.stringify(traces)).toContain('fq-hello');
  });
});
