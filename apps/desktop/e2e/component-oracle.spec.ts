/**
 * Component runtime oracle (task 1231, Part 2.1).
 *
 * Resolves the KEY UNKNOWN of the v2-component publishing effort: does Ruffle
 * bind a DoInitAction-defined AS2 class (via Object.registerClass) to the
 * EXPORTED placeholder sprite at runtime?
 *
 * The compiler (packages/swf/src/compiler/components.ts) now emits, per placed
 * component:
 *   - a self-authored AS2 class at `_global.mx.controls.Button` (DefineFunction2,
 *     wrapped in a DoInitAction ordered BEFORE the registerClass DoInitAction),
 *   - a real skin DefineSprite (DefineShape4 rounded-rect face + named
 *     DefineEditText `label_txt`), with the author's label statically seeded.
 *
 * Two Ruffle oracles:
 *   1. RENDER — the published SWF shows non-blank, button-shaped pixels (the skin
 *      renders; not the Part-1 empty placeholder).
 *   2. BINDING (the critical one) — a root onEnterFrame checks
 *      `_root.myButton instanceof mx.controls.Button` and advances RED→BLUE only
 *      when true. The frame change is the runtime proof that registerClass bound
 *      the DoInitAction class to the exported sprite. A negative-control doc with
 *      no component must NOT advance. Uses onEnterFrame (NOT headless mouseDown),
 *      per the headless-Ruffle clip-event constraint.
 *
 * Run locally:
 *   cd apps/desktop && npx playwright test e2e/component-oracle.spec.ts --reporter=line
 */

import { test, expect, Page, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Ruffle helpers (mirror interactivity.spec.ts / button-roundtrip.spec.ts)
// ---------------------------------------------------------------------------

async function ensureRuffleLoaded(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) { resolve(); return; }
      const existing = document.querySelector<HTMLScriptElement>('script[data-ruffle]');
      if (existing) {
        if ((window as Window & typeof globalThis).RufflePlayer) { resolve(); return; }
        existing.addEventListener('load', () => resolve(), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = '/ruffle/ruffle.js';
      script.dataset['ruffle'] = '1';
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Failed to load /ruffle/ruffle.js')), { once: true });
      document.head.appendChild(script);
    });
  });
}

async function injectRufflePlayer(page: Page, swfBase64: string, playerId: string): Promise<void> {
  await page.evaluate(({ b64, id }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      ruffle(): { load(opts: {
        data?: Uint8Array; allowScriptAccess?: boolean; autoplay?: string; unmuteOverlay?: string;
      }): Promise<void> }
    };
    const api = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = api.createPlayer() as RufflePlayerEl;
    player.id = id;
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;z-index:99999;';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({ data: bytes, allowScriptAccess: true, autoplay: 'on', unmuteOverlay: 'hidden' });
  }, { b64: swfBase64, id: playerId });
}

async function hideRuffleOverlays(page: Page, playerId: string): Promise<void> {
  await page.evaluate((id) => {
    const root = document.getElementById(id) as (HTMLElement & { shadowRoot?: ShadowRoot }) | null;
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
  }, playerId);
}

async function removeRufflePlayer(page: Page, playerId: string): Promise<void> {
  await page.evaluate((id) => { const el = document.getElementById(id); if (el) el.remove(); }, playerId);
}

/** Count non-white pixels in a PNG screenshot (the "button renders" signal). */
function nonWhitePixels(buf: Buffer): number {
  const img = PNG.sync.read(buf);
  let count = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2], a = img.data[i + 3];
    if (a > 10 && (r < 245 || g < 245 || b < 245)) count++;
  }
  return count;
}

/** Count red vs blue pixels (the RED→BLUE frame-advance binding signal). */
function colorCounts(buf: Buffer): { red: number; blue: number } {
  const img = PNG.sync.read(buf);
  let red = 0, blue = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    if (r > 150 && g < 100 && b < 100) red++;
    if (b > 150 && r < 100 && g < 100) blue++;
  }
  return { red, blue };
}

// ---------------------------------------------------------------------------
// Document fixtures
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550, height: 400, frameRate: 12, backgroundColor: '#ffffff', rulerUnits: 'px',
  grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
  guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
};

function frame(opts: { index: number; script?: string; displayObjects: unknown[] }) {
  return {
    index: opts.index, isKeyframe: true, isEmpty: false, tweenType: 'none',
    label: '', labelType: 'name', script: opts.script ?? '',
    sound: null, motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
    motionOrientToPath: false, motionSync: false, motionScale: false,
    shapeEase: 0, shapeBlend: 'distributive',
    displayObjects: opts.displayObjects,
  };
}

function centeredRect(id: string, r: number, g: number, b: number) {
  return {
    type: 'shape', id, x: 0, y: 0,
    shape: {
      id: `${id}-s`,
      paths: [{
        start: { x: 175, y: 150 },
        segments: [
          { type: 'line', to: { x: 375, y: 150 } },
          { type: 'line', to: { x: 375, y: 250 } },
          { type: 'line', to: { x: 175, y: 250 } },
          { type: 'line', to: { x: 175, y: 150 } },
        ],
        closed: true,
        fill: { type: 'solid', color: { r, g, b, a: 255 } },
      }],
    },
  };
}

const componentItem = {
  id: 'comp-button', name: 'PLAY', itemType: 'component',
  componentName: 'Button', packageName: 'mx.controls',
};

/** A component instance carrying authored componentParameters (task 1232, Part 2.2). */
function componentInstanceWithParams(name: string, params: Record<string, string>) {
  return {
    type: 'instance', id: 'inst-button', symbolId: 'comp-button',
    x: 225, y: 30, scaleX: 1, scaleY: 1, rotation: 0, instanceName: name,
    componentParameters: params,
  };
}

function componentInstance(name: string) {
  return {
    type: 'instance', id: 'inst-button', symbolId: 'comp-button',
    x: 225, y: 30, scaleX: 1, scaleY: 1, rotation: 0, instanceName: name,
  };
}

/** A doc that simply PLACES the component (single frame) — the render oracle. */
function makeRenderDoc() {
  return {
    id: 'comp-render-doc', properties: BASE_PROPS,
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: { layers: [{
        id: 'l1', name: 'L1', type: 'normal', visible: true, locked: false,
        outlineMode: false, outlineColor: '#0000ff', height: 20, parentFolderId: null,
        frameCount: 1, frames: [frame({ index: 0, script: 'stop();', displayObjects: [componentInstance('myButton')] })],
      }] },
    }],
    library: { items: [componentItem], folders: [] },
  };
}

/**
 * A 2-frame doc whose frame-0 root script advances RED→BLUE ONLY when
 * `_root.myButton instanceof mx.controls.Button`. If registerClass bound the
 * DoInitAction class to the exported sprite, the instanceof is true and the
 * background flips to blue. Otherwise it stays red.
 *
 * `withComponent=false` builds the negative control (no component placed, so the
 * instanceof can never be true and the frame stays red).
 */
function makeBindingDoc(withComponent: boolean) {
  const bgLayerFrames = [
    frame({
      index: 0,
      // onEnterFrame is a clip-event style loop (NOT headless mouseDown). It polls
      // the instanceof test each tick and advances once the class is bound.
      script: `stop();
_root.onEnterFrame = function() {
  if (_root.myButton instanceof mx.controls.Button) {
    _root.gotoAndStop(2);
    delete _root.onEnterFrame;
  }
};`,
      displayObjects: [centeredRect('bg-red', 255, 0, 0)],
    }),
    frame({ index: 1, script: 'stop();', displayObjects: [centeredRect('bg-blue', 0, 0, 255)] }),
  ];

  const compLayerFrames = withComponent
    ? [
        frame({ index: 0, displayObjects: [componentInstance('myButton')] }),
        frame({ index: 1, displayObjects: [componentInstance('myButton')] }),
      ]
    : [
        frame({ index: 0, displayObjects: [] }),
        frame({ index: 1, displayObjects: [] }),
      ];

  return {
    id: withComponent ? 'comp-bind-doc' : 'comp-nobind-doc', properties: BASE_PROPS,
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: { layers: [
        {
          id: 'comp-layer', name: 'Component', type: 'normal', visible: true, locked: false,
          outlineMode: false, outlineColor: '#00ff00', height: 20, parentFolderId: null,
          frameCount: 2, frames: compLayerFrames,
        },
        {
          id: 'bg-layer', name: 'Background', type: 'normal', visible: true, locked: false,
          outlineMode: false, outlineColor: '#0000ff', height: 20, parentFolderId: null,
          frameCount: 2, frames: bgLayerFrames,
        },
      ] },
    }],
    library: withComponent ? { items: [componentItem], folders: [] } : { items: [], folders: [] },
  };
}

/** The author's NON-DEFAULT label, distinct from the catalog default "Button". */
const AUTHOR_LABEL = 'PLAY NOW';

/**
 * A 2-frame doc whose frame-0 root script advances RED→BLUE ONLY when the LIVE
 * component instance reports the AUTHOR'S label (not the catalog default). This is
 * the Part-2.2 acceptance oracle: the per-instance param DoAction must have reached
 * the registerClass-bound runtime instance and applied `setComponentParam("label",
 * "PLAY NOW")` (which mirrors into both `this.label` and `label_txt.text`).
 *
 * The poll checks `getLabel() == AUTHOR_LABEL` — a default-labelled instance ("Button")
 * can never satisfy it, so a blue end-state proves the author param was delivered live.
 */
function makeParamDoc() {
  const bgLayerFrames = [
    frame({
      index: 0,
      script: `stop();
_root.onEnterFrame = function() {
  var inst = _root.myButton;
  if (inst != undefined && inst.getLabel() == "${AUTHOR_LABEL}") {
    _root.gotoAndStop(2);
    delete _root.onEnterFrame;
  }
};`,
      displayObjects: [centeredRect('bg-red', 255, 0, 0)],
    }),
    frame({ index: 1, script: 'stop();', displayObjects: [centeredRect('bg-blue', 0, 0, 255)] }),
  ];

  const inst = componentInstanceWithParams('myButton', { label: AUTHOR_LABEL });
  const compLayerFrames = [
    frame({ index: 0, displayObjects: [inst] }),
    frame({ index: 1, displayObjects: [inst] }),
  ];

  return {
    id: 'comp-param-doc', properties: BASE_PROPS,
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: { layers: [
        {
          id: 'comp-layer', name: 'Component', type: 'normal', visible: true, locked: false,
          outlineMode: false, outlineColor: '#00ff00', height: 20, parentFolderId: null,
          frameCount: 2, frames: compLayerFrames,
        },
        {
          id: 'bg-layer', name: 'Background', type: 'normal', visible: true, locked: false,
          outlineMode: false, outlineColor: '#0000ff', height: 20, parentFolderId: null,
          frameCount: 2, frames: bgLayerFrames,
        },
      ] },
    }],
    library: { items: [componentItem], folders: [] },
  };
}

async function publish(page: Page, doc: unknown): Promise<string> {
  await page.evaluate((d) => {
    (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } }).__flashTest.loadDocument(d);
  }, doc);
  await page.waitForTimeout(300);
  return page.evaluate(async () => {
    return (window as unknown as { __flashTest: { publish: () => string | Promise<string> } }).__flashTest.publish();
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('v2 component runtime oracle (task 1231, Part 2.1)', () => {
  test.skip(!!process.env.CI, 'Ruffle WASM infra not set up in CI yet');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const ready = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(ready).toBe(true);
  });

  test('skin renders non-blank, button-shaped pixels in Ruffle', async ({ page }, testInfo: TestInfo) => {
    const swf = await publish(page, makeRenderDoc());
    await ensureRuffleLoaded(page);
    const id = '__ruffle_comp_render__';
    await injectRufflePlayer(page, swf, id);
    await page.waitForTimeout(2000);
    await hideRuffleOverlays(page, id);

    const shot = await page.locator(`#${id}`).screenshot();
    await testInfo.attach('component-render', { body: shot, contentType: 'image/png' });
    await removeRufflePlayer(page, id);

    const nonWhite = nonWhitePixels(shot);
    console.log(`[1231] render non-white pixels=${nonWhite}`);
    // The 100x22 skin (face + border + label) covers ~2200 px; require a healthy
    // fraction so a blank-white player load fails the gate.
    expect(nonWhite, 'the component skin must render visible pixels').toBeGreaterThan(500);
  });

  test('Ruffle BINDS the registerClass DoInitAction class: instanceof advances RED→BLUE', async ({ page }, testInfo: TestInfo) => {
    const swf = await publish(page, makeBindingDoc(true));
    await ensureRuffleLoaded(page);
    const id = '__ruffle_comp_bind__';
    await injectRufflePlayer(page, swf, id);

    // Give the onEnterFrame loop time to observe the bound class and advance.
    // (The instanceof binds and advances within a tick or two — see the negative
    // control test, which proves the loop never advances WITHOUT a component, so
    // a blue end-state here can only come from the class actually binding.)
    await page.waitForTimeout(2500);
    await hideRuffleOverlays(page, id);
    const after = await page.locator(`#${id}`).screenshot();
    await testInfo.attach('binding-after', { body: after, contentType: 'image/png' });
    const afterC = colorCounts(after);
    await removeRufflePlayer(page, id);

    console.log(`[1231] binding after red=${afterC.red} blue=${afterC.blue}`);

    // registerClass bound the DoInitAction-defined class to the exported sprite:
    // `_root.myButton instanceof mx.controls.Button` was true, so onEnterFrame
    // advanced the background from RED to BLUE. The negative-control test below
    // proves this advance is impossible without the bound class.
    expect(afterC.blue, 'frame must advance to blue once the class is bound').toBeGreaterThan(500);
    expect(afterC.red, 'red must be gone after the advance').toBeLessThan(200);
  });

  test('negative control: with NO component placed, instanceof never advances (stays RED)', async ({ page }, testInfo: TestInfo) => {
    const swf = await publish(page, makeBindingDoc(false));
    await ensureRuffleLoaded(page);
    const id = '__ruffle_comp_nobind__';
    await injectRufflePlayer(page, swf, id);
    await page.waitForTimeout(500);
    await hideRuffleOverlays(page, id);

    const before = await page.locator(`#${id}`).screenshot();
    await page.waitForTimeout(2500);
    await hideRuffleOverlays(page, id);
    const after = await page.locator(`#${id}`).screenshot();
    await testInfo.attach('nobind-after', { body: after, contentType: 'image/png' });
    const afterC = colorCounts(after);
    await removeRufflePlayer(page, id);

    console.log(`[1231] nobind after red=${afterC.red} blue=${afterC.blue}`);
    // No component → instanceof never true → background stays RED, never blue.
    expect(afterC.red, 'no-component control must stay red').toBeGreaterThan(500);
    expect(afterC.blue, 'no-component control must NOT advance to blue').toBeLessThan(200);
  });
});

test.describe('v2 component LIVE parameter delivery (task 1232, Part 2.2)', () => {
  test.skip(!!process.env.CI, 'Ruffle WASM infra not set up in CI yet');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const ready = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(ready).toBe(true);
  });

  test("the author's NON-DEFAULT label reaches the LIVE instance: getLabel()==author advances RED→BLUE", async ({ page }, testInfo: TestInfo) => {
    const swf = await publish(page, makeParamDoc());
    await ensureRuffleLoaded(page);
    const id = '__ruffle_comp_param__';
    await injectRufflePlayer(page, swf, id);

    // The onEnterFrame poll advances once the live instance reports the AUTHOR's
    // label (not the catalog default). Give the param DoAction a few ticks to run.
    await page.waitForTimeout(2500);
    await hideRuffleOverlays(page, id);
    const after = await page.locator(`#${id}`).screenshot();
    await testInfo.attach('param-after', { body: after, contentType: 'image/png' });
    const afterC = colorCounts(after);
    await removeRufflePlayer(page, id);

    console.log(`[1232] param after red=${afterC.red} blue=${afterC.blue}`);
    // setComponentParam("label","PLAY NOW") applied to the live instance → getLabel()
    // returns the author's value → onEnterFrame advanced RED→BLUE. A default-labelled
    // ("Button") instance can never satisfy the poll, so blue == author param delivered.
    expect(afterC.blue, 'frame must advance to blue once the author label is delivered live').toBeGreaterThan(500);
    expect(afterC.red, 'red must be gone after the advance').toBeLessThan(200);
  });
});
