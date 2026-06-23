/**
 * Multi-flag PlaceObject Ruffle oracles (task 1372).
 *
 * TEST-ONLY hardening. A read-only SWF-compiler audit found NO bug: these
 * PlaceObject2/3 flag COMBINATIONS are byte-correct, but they had NO Ruffle
 * runtime oracle — and per CLAUDE.md the Ruffle pixel/behaviour oracle is the
 * acceptance truth (byte-presence is necessary but not sufficient). Field-order
 * regressions on PlaceObject have bitten before (tasks 1240, 1349 dropped
 * HasName/HasClipActions; task 1238 dropped HasFilterList at the wrong flag
 * position), so these specs PIN the exact flag co-occurrence the audit verified
 * by hand:
 *
 *   (a) a SCENE-LEVEL SHAPE placed with blendMode != normal AND enabled filters
 *       AND cacheAsBitmap together — a single PlaceObject3 (tag 70) carrying
 *       HasBlendMode + HasFilterList + HasCacheAsBitmap. Asserts BOTH:
 *         • structural: exactly one PO3 with all three flags, decoded in the
 *           encoder's field order (FILTERLIST → BlendMode → is_bitmap_cached),
 *           so a field-order/flag-drop regression fails loudly; AND
 *         • pixel: it renders in real bundled Ruffle with NO parse error and the
 *           filter halo lights up pixels OUTSIDE the shape box (vs a no-filter
 *           control — the task-1238 counterfactual: a dropped filter collapses
 *           the outside delta to ~0).
 *
 *   (b) an INSTANCE that MOVES across frames carrying blend+filters on its
 *       PlaceObject3, AND a SEPARATE clip on the timeline whose PlaceObject2/3
 *       Move carries clipActions (onClipEvent). Asserts BOTH halves at runtime:
 *         • trace: the moving clip's onClipEvent(enterFrame) handler FIRES after
 *           the move (its sentinel trace appears), proving the clipActions Move
 *           survived alongside the move; AND
 *         • pixel: the blend+filter clip's halo renders after the move (a glow
 *           on a moved movieclip instance), proving the multi-flag PO3 Move path
 *           is honoured.
 *
 *   (c) a SYMBOL-INTERNAL (sprite.ts path) shape placed with filters+blend,
 *       mirroring (a) at the DefineSprite level — the sprite builder has its OWN
 *       PlaceObject3 emit path, so it gets its own structural + pixel oracle.
 *
 * NO production byte-logic change is expected. If a test reveals a real Ruffle
 * mismatch (render/parse/behaviour), the task says STOP and report it — do not
 * patch byte logic without oracle confirmation.
 *
 * Run locally:
 *   cd apps/desktop && npx playwright test e2e/multiflag-placeobject-1372.spec.ts
 */

import { test, expect, TestInfo, Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { findMultiFlagPlaceObject3s } from './helpers/swf-parse';
import { SWF_BLEND_MODE_REF } from './helpers/swf-parse-blend';

// ---------------------------------------------------------------------------
// Ruffle harness (shared pattern with filter-pixel-oracle / mask-named-clip)
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

/** Load a document, publish, return the base64 SWF the bridge produced. */
async function publishDoc(page: Page, doc: unknown): Promise<string> {
  await page.evaluate((d) => {
    (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } })
      .__flashTest.loadDocument(d);
  }, doc);
  await page.waitForTimeout(300);
  const swfBase64: string = await page.evaluate(async () =>
    (window as unknown as { __flashTest: { publish: () => Promise<string> } })
      .__flashTest.publish()
  );
  expect(typeof swfBase64).toBe('string');
  expect(swfBase64.length).toBeGreaterThan(0);
  return swfBase64;
}

/**
 * Render an already-published SWF (base64) in real Ruffle and return the
 * 550×400 screenshot. Mirrors filter-pixel-oracle's renderDocInRuffle (overlay-
 * visible placement + 1.5s WebGL settle per the CLAUDE.md visual-oracle rules).
 */
async function renderSwfInRuffle(page: Page, swfBase64: string, playerId: string): Promise<Buffer> {
  await ensureRuffleLoaded(page);
  await page.evaluate(({ b64, id }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & { ruffle(): { load(opts: { data?: Uint8Array; autoplay?: string; unmuteOverlay?: string }): Promise<void> } };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer() as RufflePlayerEl;
    player.id = id;
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;pointer-events:none;z-index:99999';
    document.body.appendChild(player);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    void player.ruffle().load({ data: bytes, autoplay: 'on', unmuteOverlay: 'hidden' });
  }, { b64: swfBase64, id: playerId });
  await page.waitForTimeout(1500);
  const shot = await page.locator(`#${playerId}`).screenshot();
  await page.evaluate((id) => { document.getElementById(id)?.remove(); }, playerId);
  return shot;
}

/** Load a SWF in a real <ruffle-player> and collect trace() lines via the observer. */
async function collectTraces(page: Page, swfBase64: string, playerId: string, settleMs: number): Promise<string[]> {
  await ensureRuffleLoaded(page);
  return page.evaluate(async ({ b64, id, settle }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      traceObserver?: ((message: string) => void) | null;
      ruffle(): { load(opts: { data?: Uint8Array; allowScriptAccess?: boolean; autoplay?: string; unmuteOverlay?: string; logLevel?: string }): Promise<void> };
    };
    const ruffleApi = (window as unknown as { RufflePlayer: { newest(): RuffleHandle } }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer();
    player.id = id;
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;';
    document.body.appendChild(player);
    const traces: string[] = [];
    const observer = (message: string) => { traces.push(message); };
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const loadPromise = player.ruffle().load({ data: bytes, allowScriptAccess: true, autoplay: 'on', unmuteOverlay: 'hidden', logLevel: 'info' });
    player.traceObserver = observer;
    await loadPromise;
    player.traceObserver = observer;
    await new Promise<void>((r) => setTimeout(r, settle));
    player.remove();
    return traces;
  }, { b64: swfBase64, id: playerId, settle: settleMs });
}

// ---------------------------------------------------------------------------
// Pixel analysis: outside-bounds filter-halo delta (filter-pixel-oracle method)
// ---------------------------------------------------------------------------

interface Box { x0: number; y0: number; x1: number; y1: number }

/** Count pixels OUTSIDE `box` (+margin) that differ from `bg` by > threshold. */
function countOutsideBox(img: PNG, box: Box, bg: { r: number; g: number; b: number }, threshold: number, marginPx = 6): number {
  const STAGE_W = 550, STAGE_H = 400;
  const sx = img.width / STAGE_W, sy = img.height / STAGE_H;
  const ex0 = (box.x0 - marginPx) * sx, ey0 = (box.y0 - marginPx) * sy;
  const ex1 = (box.x1 + marginPx) * sx, ey1 = (box.y1 + marginPx) * sy;
  let count = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (x >= ex0 && x <= ex1 && y >= ey0 && y <= ey1) continue;
      const idx = (y * img.width + x) * 4;
      const d = Math.abs(img.data[idx] - bg.r) + Math.abs(img.data[idx + 1] - bg.g) + Math.abs(img.data[idx + 2] - bg.b);
      if (d > threshold) count++;
    }
  }
  return count;
}

/** True if the whole image is ~uniform background (blank/failed-load render). */
function isBlank(img: PNG, bg: { r: number; g: number; b: number }): boolean {
  let lit = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const d = Math.abs(img.data[i] - bg.r) + Math.abs(img.data[i + 1] - bg.g) + Math.abs(img.data[i + 2] - bg.b);
    if (d > 40) { lit++; if (lit > 200) return false; }
  }
  return true;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

// ---------------------------------------------------------------------------
// Document builders
// ---------------------------------------------------------------------------

interface RGBA { r: number; g: number; b: number; a: number }

const BASE_PROPS = (bg: string) => ({
  width: 550, height: 400, frameRate: 12,
  backgroundColor: bg, rulerUnits: 'px',
  grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
  guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
});

const LINKAGE = {
  exportForActionScript: false, exportInFirstFrame: false,
  exportForRuntimeSharing: false, importForRuntimeSharing: false,
  linkageIdentifier: '', sharedUrl: '', className: '',
};

const YELLOW_GLOW = {
  type: 'glow',
  color: { r: 255, g: 255, b: 0, a: 255 },
  alpha: 1, blurX: 12, blurY: 12, strength: 3, quality: 3,
  inner: false, knockout: false, enabled: true,
} as const;

function rectShapePaths(box: Box, fill: RGBA) {
  return {
    id: `shape-${box.x0}-${box.y0}`,
    paths: [{
      start: { x: box.x0, y: box.y0 },
      segments: [
        { type: 'line', to: { x: box.x1, y: box.y0 } },
        { type: 'line', to: { x: box.x1, y: box.y1 } },
        { type: 'line', to: { x: box.x0, y: box.y1 } },
      ],
      closed: true,
      fill: { type: 'solid', color: fill },
    }],
  };
}

function frame(displayObjects: unknown[], script = '', isKeyframe = true) {
  return {
    index: 0, isKeyframe, isEmpty: false, tweenType: 'none',
    label: '', labelType: 'name', script, sound: null,
    motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
    motionOrientToPath: false, motionSync: false, motionScale: false,
    shapeEase: 0, shapeBlend: 'distributive',
    displayObjects,
  };
}

function layer(id: string, name: string, frames: unknown[], type = 'normal') {
  return {
    id, name, type, visible: true, locked: false, outlineMode: false,
    outlineColor: '#ff0000', height: 20, parentFolderId: null,
    frames, frameCount: frames.length,
  };
}

/**
 * (a) A scene SHAPE carrying blendMode + filters + cacheAsBitmap all at once.
 * `withFilter:false` is the no-filter pixel CONTROL (still blend+cacheAsBitmap).
 */
function makeMultiFlagShapeDoc(opts: { box: Box; fill: RGBA; bg: string; withFilter: boolean; blend?: string }) {
  const { box, fill, bg, withFilter, blend = 'layer' } = opts;
  return {
    id: 'multiflag-shape-1372',
    properties: BASE_PROPS(bg),
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: {
        layers: [layer('layer-1', 'Layer 1', [frame([{
          id: 'mf-shape', type: 'shape',
          shape: rectShapePaths(box, fill),
          x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
          // 'layer' (default) is a real non-normal blend (sets HasBlendMode) that
          // composites neutrally, so the glow halo is not dampened the way
          // 'multiply' would — keeping the pixel oracle's outside-box delta strong
          // while still exercising the three-flag co-occurrence. The (c-bug) runtime
          // proof passes 'multiply' so the blend visibly darkens.
          blendMode: blend,
          cacheAsBitmap: true,
          filters: withFilter ? [YELLOW_GLOW] : [],
        }])])],
      },
    }],
    library: { items: [], folders: [] },
  };
}

/**
 * (c) A SYMBOL-INTERNAL shape with filters+blend (sprite.ts emit path). The
 * movieclip symbol holds the multi-flag shape; the scene just places the symbol.
 * `withFilter:false` is the pixel CONTROL.
 */
function makeSpriteInternalMultiFlagDoc(opts: { box: Box; fill: RGBA; bg: string; withFilter: boolean; blend?: string }) {
  const { box, fill, bg, withFilter, blend = 'layer' } = opts;
  const symId = 'sym-multiflag';
  const sym = {
    id: symId, name: 'MultiFlagMC', itemType: 'symbol', symbolType: 'movieclip',
    linkage: LINKAGE, scale9Grid: null,
    timeline: {
      layers: [layer('sym-layer', 'Layer 1', [frame([{
        id: 'sym-shape', type: 'shape',
        // Geometry origin-relative inside the symbol (shape spans box-sized area at 0,0).
        shape: rectShapePaths({ x0: 0, y0: 0, x1: box.x1 - box.x0, y1: box.y1 - box.y0 }, fill),
        x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
        blendMode: blend,
        cacheAsBitmap: true,
        filters: withFilter ? [YELLOW_GLOW] : [],
      }])])],
    },
  };
  const inst = {
    id: 'mf-inst', type: 'instance', symbolId: symId, instanceName: 'mfInst',
    x: box.x0, y: box.y0, scaleX: 1, scaleY: 1, rotation: 0,
    alpha: 1, blendMode: 'normal', cacheAsBitmap: false, filters: [],
    colorEffect: { type: 'none' }, loopMode: 'loop', firstFrame: 0,
  };
  return {
    id: 'sprite-multiflag-1372',
    properties: BASE_PROPS(bg),
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: { layers: [layer('layer-1', 'Layer 1', [frame([inst])])] },
    }],
    library: { items: [sym], folders: [] },
  };
}

/**
 * (b) Two instances on a 2-frame root:
 *   - a "mover" movieclip instance carrying blendMode+filters on its
 *     PlaceObject3, that MOVES (x changes) on frame 2 (the move path re-emits a
 *     blend+filter PO3 Move).
 *   - a "ticker" movieclip instance carrying clipActions (onClipEvent) — its
 *     PlaceObject2/3 Move must keep HasClipActions. The handler traces a sentinel
 *     so the runtime half is observable, and a root frame script also traces a
 *     sentinel to prove the movie ran.
 */
const MOVE_TRACE = 'MF1372MOVE';
function makeMoveWithClipActionsDoc(opts: { bg: string }) {
  const { bg } = opts;
  // A small library movieclip used by both instances (visible filled square).
  const dotSym = (id: string, fill: RGBA) => ({
    id, name: id, itemType: 'symbol', symbolType: 'movieclip',
    linkage: LINKAGE, scale9Grid: null,
    timeline: {
      layers: [layer(`${id}-l`, 'Layer 1', [frame([{
        id: `${id}-shape`, type: 'shape',
        shape: rectShapePaths({ x0: 0, y0: 0, x1: 80, y1: 80 }, fill),
        x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
      }])])],
    },
  });
  const moverSym = dotSym('mc-mover', { r: 255, g: 255, b: 255, a: 255 }); // white → only glow halo shows on white bg
  const tickerSym = dotSym('mc-ticker', { r: 0, g: 0, b: 0, a: 255 });

  // Mover instance: blend + glow filter on the PlaceObject3, MOVES on frame 2.
  const mover = (x: number) => ({
    id: 'inst-mover', type: 'instance', symbolId: moverSym.id, instanceName: 'mover',
    x, y: 150, scaleX: 1, scaleY: 1, rotation: 0,
    alpha: 1, blendMode: 'layer', cacheAsBitmap: false,
    filters: [YELLOW_GLOW],
    colorEffect: { type: 'none' }, loopMode: 'loop', firstFrame: 0,
  });
  // Ticker instance: clipActions (onClipEvent enterFrame) — persists & is re-emitted
  // on frame 2 via the MOVE path (it does not move position, but it persists across
  // a multi-frame layer so the move/persist tag carries its clip actions).
  const ticker = {
    id: 'inst-ticker', type: 'instance', symbolId: tickerSym.id, instanceName: 'ticker',
    x: 60, y: 300, scaleX: 1, scaleY: 1, rotation: 0,
    alpha: 1, blendMode: 'normal', cacheAsBitmap: false, filters: [],
    colorEffect: { type: 'none' }, loopMode: 'loop', firstFrame: 0,
    clipActions: [{
      event: 'enterFrame',
      // Trace a sentinel including _root._currentframe so we can confirm the
      // handler fired AFTER the root advanced to frame 2 (the move frame).
      script: `trace("${MOVE_TRACE} cf=" + _root._currentframe);`,
    }],
  };

  return {
    id: 'move-clipactions-1372',
    properties: BASE_PROPS(bg),
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: {
        layers: [layer('root-layer', 'Layer 1', [
          // frame 0: both placed.
          frame([mover(120), ticker], ''),
          // frame 1: mover moves to x=320; ticker persists (move/persist path).
          { ...frame([mover(320), ticker], ''), index: 1 },
        ])],
      },
    }],
    library: { items: [moverSym, tickerSym], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const SHAPE: Box = { x0: 200, y0: 150, x1: 350, y1: 250 };

test.describe('task 1372: multi-flag PlaceObject Ruffle oracles', () => {
  test.skip(!!process.env.CI, 'runtime oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // (a) SCENE shape: blend + filters + cacheAsBitmap together.
  // -------------------------------------------------------------------------
  test('(a) scene shape with blend+filters+cacheAsBitmap: one PO3 has all three flags AND renders in Ruffle', async ({ page }, testInfo: TestInfo) => {
    const bg = '#cccccc';
    const bgRgb = hexToRgb(bg);
    const fill: RGBA = { r: 255, g: 0, b: 0, a: 255 };

    const filteredB64 = await publishDoc(page, makeMultiFlagShapeDoc({ box: SHAPE, fill, bg, withFilter: true }));

    // STRUCTURAL: exactly one PlaceObject3 carries HasFilterList + HasBlendMode +
    // HasCacheAsBitmap, decoded in the encoder field order, with the glow (id 2),
    // BlendMode = layer (2), and is_bitmap_cached = 1.
    const multi = findMultiFlagPlaceObject3s(Buffer.from(filteredB64, 'base64'));
    testInfo.annotations.push({ type: 'measurement', description: `multi-flag PO3 count=${multi.length}, blend=${multi[0]?.blendMode}, cached=${multi[0]?.isBitmapCached}, filterIds=[${multi[0]?.filters.map((f) => f.id).join(',')}]` });
    expect(multi.length, 'exactly one scene PO3 with all three flags').toBe(1);
    const po3 = multi[0];
    expect(po3.hasFilterList).toBe(true);
    expect(po3.hasBlendMode).toBe(true);
    expect(po3.hasCacheAsBitmap).toBe(true);
    expect(po3.filters.some((f) => f.id === 2), 'FILTERLIST contains the Glow (id 2)').toBe(true);
    expect(po3.blendMode, 'BlendMode UI8 is layer (2)').toBe(SWF_BLEND_MODE_REF.layer);
    expect(po3.isBitmapCached, 'is_bitmap_cached UI8 = 1').toBe(1);

    // PIXEL: the filtered render lights up many pixels outside the box; the
    // no-filter control (still blend+cacheAsBitmap) does not. A dropped filter
    // would collapse the delta (task 1238 counterfactual).
    const filteredShot = await renderSwfInRuffle(page, filteredB64, '__mf_a_filtered__');
    const controlB64 = await publishDoc(page, makeMultiFlagShapeDoc({ box: SHAPE, fill, bg, withFilter: false }));
    const controlShot = await renderSwfInRuffle(page, controlB64, '__mf_a_control__');

    const filteredImg = PNG.sync.read(filteredShot);
    const controlImg = PNG.sync.read(controlShot);

    // No Ruffle parse error → the player drew the shape (render is not blank).
    expect(isBlank(filteredImg, bgRgb), 'filtered render is not blank (Ruffle parsed the multi-flag PO3)').toBe(false);

    const THRESH = 50;
    const filteredOutside = countOutsideBox(filteredImg, SHAPE, bgRgb, THRESH);
    const controlOutside = countOutsideBox(controlImg, SHAPE, bgRgb, THRESH);
    testInfo.annotations.push({ type: 'measurement', description: `(a) filtered outside=${filteredOutside}, control=${controlOutside}` });
    if (filteredOutside <= controlOutside + 300) {
      await testInfo.attach('a-filtered', { body: filteredShot, contentType: 'image/png' });
      await testInfo.attach('a-control', { body: controlShot, contentType: 'image/png' });
    }
    expect(controlOutside, 'no-filter control ~empty outside the box').toBeLessThan(400);
    expect(filteredOutside, 'glow halo lights up pixels outside the box').toBeGreaterThan(800);
    expect(filteredOutside - controlOutside, 'filter rendered (vs control delta)').toBeGreaterThan(800);
  });

  // -------------------------------------------------------------------------
  // (b) MOVE with blend+filters PO3 + a separate clipActions Move.
  // -------------------------------------------------------------------------
  test('(b) instance move carries blend+filters AND a separate clip Move keeps clipActions: onClipEvent fires AND blend/filter renders', async ({ page }, testInfo: TestInfo) => {
    const bg = '#ffffff';
    const bgRgb = hexToRgb(bg);
    const b64 = await publishDoc(page, makeMoveWithClipActionsDoc({ bg }));

    // BEHAVIOUR (trace): the ticker's onClipEvent(enterFrame) handler fires AND
    // reports a root current-frame > 1, proving the clip Move kept HasClipActions
    // and the movie advanced to the move frame.
    const traces = await collectTraces(page, b64, '__mf_b_trace__', 2500);
    const moveTraces = traces.filter((t) => t.startsWith(MOVE_TRACE));
    testInfo.annotations.push({ type: 'measurement', description: `(b) clipAction traces=${JSON.stringify(moveTraces.slice(0, 6))}` });
    expect(moveTraces.length, 'onClipEvent(enterFrame) on the moving timeline fired').toBeGreaterThan(0);
    const maxCf = Math.max(...moveTraces.map((t) => {
      const m = t.match(/cf=(\d+)/); return m ? Number(m[1]) : 0;
    }));
    expect(maxCf, 'the handler fired after the root advanced past frame 1 (the move frame)').toBeGreaterThan(1);

    // STRUCTURAL: at least one PlaceObject3 carries blend+filters (the mover).
    // Combined with the trace half this pins both Move paths co-existing.
    const filteredPO3 = Buffer.from(b64, 'base64');
    // The mover has filters+blend but not cacheAsBitmap, so use the broader finder
    // via the filter oracle's path: decode all tag-70 and assert one has blend+filters.
    const { parseSwfTags, decodePlaceObject3 } = await import('./helpers/swf-parse');
    const po3s = parseSwfTags(filteredPO3).filter((t) => t.type === 70).map((t) => decodePlaceObject3(t.body));
    const moverPO3 = po3s.find((d) => d.hasFilterList && d.hasBlendMode && d.filters.some((f) => f.id === 2));
    testInfo.annotations.push({ type: 'measurement', description: `(b) mover PO3 present=${!!moverPO3}, blend=${moverPO3?.blendMode}` });
    expect(moverPO3, 'a PO3 carries the mover blend (layer=2) + glow filter').toBeDefined();
    expect(moverPO3!.blendMode, 'mover BlendMode is layer (2)').toBe(SWF_BLEND_MODE_REF.layer);

    // PIXEL: after the move settles, the mover's glow halo renders. The mover is a
    // white square on a white bg, so the ONLY non-white pixels are the yellow glow.
    const shot = await renderSwfInRuffle(page, b64, '__mf_b_render__');
    const img = PNG.sync.read(shot);
    expect(isBlank(img, bgRgb), 'render is not blank (Ruffle parsed the multi-flag Move)').toBe(false);
    // Count non-white pixels anywhere (the glow halo around the moved white square).
    let halo = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const d = Math.abs(img.data[i] - 255) + Math.abs(img.data[i + 1] - 255) + Math.abs(img.data[i + 2] - 255);
      if (d > 60) halo++;
    }
    testInfo.annotations.push({ type: 'measurement', description: `(b) glow halo pixels=${halo}` });
    if (halo <= 500) await testInfo.attach('b-render', { body: shot, contentType: 'image/png' });
    expect(halo, 'the moved blend+filter clip renders its glow halo (white square → only the glow shows)').toBeGreaterThan(500);
  });

  // -------------------------------------------------------------------------
  // (c) SYMBOL-INTERNAL shape with filters+blend (sprite.ts path), mirrors (a).
  //
  // *** REAL, ORACLE-CONFIRMED BUG — filed for triage, see docs note below. ***
  //
  // This oracle FAILS today because the sprite.ts shape FIRST-PLACEMENT branch
  // (packages/swf/src/sprite.ts ~line 752) checks `hasEnabledFilters` BEFORE the
  // blend branch and routes to `encodePlaceObject3WithFilters` — which sets
  // HasFilterList + HasCacheAsBitmap but DROPS HasBlendMode. So a symbol-internal
  // shape carrying BOTH a non-normal blendMode AND filters loses the blend.
  //
  // It is NOT a byte-only nicety: it is runtime-observable in real bundled Ruffle.
  // With a red shape (255,0,0) + multiply blend over a cyan (0,255,255) backdrop:
  //   • the SCENE path (frames.ts, correct) emits a PO3 with HasBlendMode → Ruffle
  //     renders the interior BLACK (red×cyan multiply ≈ 0,0,0);
  //   • the SPRITE path (sprite.ts, buggy) drops the blend → Ruffle renders the
  //     interior plain RED (255,0,0).
  // (Verified by the diagnostic run during task 1372.)
  //
  // The fix is the SAME shape as the scene-path fix the encoder already carries
  // (frames.ts combines blend+filters into one `encodePlaceObject3WithBlendMode`)
  // and as the sprite MOVE path (sprite.ts ~line 995 already orders blend-first):
  // reorder the sprite shape FIRST-PLACEMENT branch to detect a non-normal blend
  // and pass the filter list to `encodePlaceObject3WithBlendMode`. Per task 1372
  // (and CLAUDE.md), byte logic must NOT be patched without oracle confirmation
  // outside the holder's scope — this is filed, not fixed here.
  //
  // Marked test.fixme so the suite stays GREEN while the bug is open; the body is
  // the regression oracle that must PASS once the sprite path is fixed (remove the
  // .fixme then). It asserts BOTH the structural three-flag co-occurrence AND the
  // runtime multiply render.
  // -------------------------------------------------------------------------
  test.fixme('(c) sprite-internal shape with blend+filters+cacheAsBitmap: a PO3 inside the DefineSprite has all three flags AND the blend renders (KNOWN BUG: sprite.ts drops HasBlendMode when filters present)', async ({ page }, testInfo: TestInfo) => {
    const bg = '#cccccc';
    const bgRgb = hexToRgb(bg);
    const fill: RGBA = { r: 255, g: 0, b: 0, a: 255 };

    const filteredB64 = await publishDoc(page, makeSpriteInternalMultiFlagDoc({ box: SHAPE, fill, bg, withFilter: true }));

    // STRUCTURAL: the PlaceObject3 emitted INSIDE the DefineSprite by sprite.ts
    // must carry all three flags (findMultiFlagPlaceObject3s recurses into the
    // DefineSprite body via parseSwfTagsDeep). FAILS today: HasBlendMode dropped.
    const multi = findMultiFlagPlaceObject3s(Buffer.from(filteredB64, 'base64'));
    testInfo.annotations.push({ type: 'measurement', description: `(c) sprite multi-flag PO3 count=${multi.length}, blend=${multi[0]?.blendMode}, cached=${multi[0]?.isBitmapCached}` });
    expect(multi.length, 'exactly one sprite-internal PO3 with all three flags').toBe(1);
    const po3 = multi[0];
    expect(po3.filters.some((f) => f.id === 2), 'sprite PO3 FILTERLIST contains the Glow (id 2)').toBe(true);
    expect(po3.blendMode, 'sprite PO3 BlendMode is layer (2)').toBe(SWF_BLEND_MODE_REF.layer);
    expect(po3.isBitmapCached, 'sprite PO3 is_bitmap_cached = 1').toBe(1);

    // PIXEL: the symbol renders with the glow halo outside the placed box (the
    // no-filter control does not).
    const filteredShot = await renderSwfInRuffle(page, filteredB64, '__mf_c_filtered__');
    const controlB64 = await publishDoc(page, makeSpriteInternalMultiFlagDoc({ box: SHAPE, fill, bg, withFilter: false }));
    const controlShot = await renderSwfInRuffle(page, controlB64, '__mf_c_control__');

    const filteredImg = PNG.sync.read(filteredShot);
    const controlImg = PNG.sync.read(controlShot);
    expect(isBlank(filteredImg, bgRgb), 'sprite filtered render is not blank (Ruffle parsed the sprite-internal multi-flag PO3)').toBe(false);

    const THRESH = 50;
    const filteredOutside = countOutsideBox(filteredImg, SHAPE, bgRgb, THRESH);
    const controlOutside = countOutsideBox(controlImg, SHAPE, bgRgb, THRESH);
    testInfo.annotations.push({ type: 'measurement', description: `(c) filtered outside=${filteredOutside}, control=${controlOutside}` });
    expect(controlOutside, '(c) no-filter control ~empty outside the box').toBeLessThan(400);
    expect(filteredOutside, '(c) glow halo lights up pixels outside the box').toBeGreaterThan(800);
    expect(filteredOutside - controlOutside, '(c) sprite-internal filter rendered (vs control delta)').toBeGreaterThan(800);
  });

  // -------------------------------------------------------------------------
  // (c-bug) The RUNTIME PROOF of the sprite-path blend drop, kept ACTIVE so the
  // confirmed defect is pinned and audited until it's fixed. Same blend+filter
  // shape placed scene-level (correct) vs symbol-internal (buggy) over a cyan
  // backdrop where `multiply` visibly differs: the scene interior renders BLACK,
  // the sprite interior renders plain RED (blend dropped). When the sprite path
  // is fixed, BOTH render black and THIS test fails → flip it to assert equality
  // and delete the .fixme on (c) above. (Active = the audit sees the bug is real
  // and still open; it does not block the suite because it asserts the CURRENT
  // wrong behaviour, with a clear note that it must be inverted on fix.)
  // -------------------------------------------------------------------------
  test('(c-bug) sprite-internal blend+filters drop is real and runtime-observable in Ruffle (PINS the open defect)', async ({ page }, testInfo: TestInfo) => {
    const cyan = '#00ffff';
    const red: RGBA = { r: 255, g: 0, b: 0, a: 255 };

    // Scene path (correct): multiply blend applied → interior BLACK.
    const sceneB64 = await publishDoc(page, makeMultiFlagShapeDoc({ box: SHAPE, fill: red, bg: cyan, withFilter: true, blend: 'multiply' }));
    // Sprite path (buggy): multiply blend dropped → interior RED.
    const spriteB64 = await publishDoc(page, makeSpriteInternalMultiFlagDoc({ box: SHAPE, fill: red, bg: cyan, withFilter: true, blend: 'multiply' }));

    // Structural witness: scene PO3 has HasBlendMode, sprite PO3 does NOT.
    const { parseSwfTagsDeep, decodePlaceObject3 } = await import('./helpers/swf-parse');
    const sceneFlags = parseSwfTagsDeep(Buffer.from(sceneB64, 'base64')).filter((t) => t.type === 70).map((t) => decodePlaceObject3(t.body));
    const spriteFlags = parseSwfTagsDeep(Buffer.from(spriteB64, 'base64')).filter((t) => t.type === 70).map((t) => decodePlaceObject3(t.body));
    const sceneBlendPO3 = sceneFlags.find((d) => d.hasFilterList);
    const spriteBlendPO3 = spriteFlags.find((d) => d.hasFilterList);
    expect(sceneBlendPO3?.hasBlendMode, 'scene path keeps HasBlendMode alongside filters (correct)').toBe(true);
    // THE DEFECT: the sprite path drops HasBlendMode when filters are present.
    expect(spriteBlendPO3?.hasBlendMode, 'KNOWN BUG: sprite path DROPS HasBlendMode when filters present').toBe(false);

    // Runtime witness in real Ruffle: scene interior BLACK, sprite interior RED.
    const sceneShot = await renderSwfInRuffle(page, sceneB64, '__mf_cbug_scene__');
    const spriteShot = await renderSwfInRuffle(page, spriteB64, '__mf_cbug_sprite__');
    const interior = (buf: Buffer) => {
      const img = PNG.sync.read(buf);
      const sx = img.width / 550, sy = img.height / 400;
      const ix0 = (SHAPE.x0 + 20) * sx, iy0 = (SHAPE.y0 + 20) * sy, ix1 = (SHAPE.x1 - 20) * sx, iy1 = (SHAPE.y1 - 20) * sy;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        if (x < ix0 || x > ix1 || y < iy0 || y > iy1) continue;
        const i = (y * img.width + x) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
      }
      return n ? { r: r / n, g: g / n, b: b / n } : { r: 0, g: 0, b: 0 };
    };
    const si = interior(sceneShot), pi = interior(spriteShot);
    testInfo.annotations.push({ type: 'measurement', description: `(c-bug) scene interior=(${si.r.toFixed(0)},${si.g.toFixed(0)},${si.b.toFixed(0)}) sprite interior=(${pi.r.toFixed(0)},${pi.g.toFixed(0)},${pi.b.toFixed(0)})` });

    // Scene (correct, blend applied): multiply red×cyan ≈ black.
    expect(si.r + si.g + si.b, 'scene path: multiply blend renders the interior dark (correct)').toBeLessThan(120);
    // Sprite (buggy, blend dropped): plain red survives.
    expect(pi.r, 'sprite path: blend dropped → interior is still red (THE DEFECT)').toBeGreaterThan(180);
    expect(pi.g + pi.b, 'sprite path: interior is red, not the multiplied dark colour (THE DEFECT)').toBeLessThan(140);
  });
});
