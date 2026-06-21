/**
 * Runtime oracle for task 1349 — a named, scripted MovieClip on a MASK layer
 * keeps its instance name AND its onClipEvent clipActions.
 *
 * USER-REPORTED BUG: Magnet.fla Scene 5 stayed frozen — the level-select menu
 * could never be exited. Root cause: the `ballmask` MovieClip (instanceName
 * "ballmask", onClipEvent(load){ tgt=-1; gotoAndPlay("mid") }) sits on Scene 5's
 * MASK layer, and the SWF compiler emitted it as a PlaceObject2 with ONLY
 * HasClipDepth — its HasName + HasClipActions were dropped. So `_root.ballmask`
 * was undefined and the load handler never ran, killing the scene-transition
 * mechanism the menu's buttons drive through `_root.ballmask`.
 *
 * FIX: the mask-layer symbol-instance emit path now carries the instance name +
 * clip actions ALONGSIDE the clip depth (SWF allows HasName | HasClipDepth |
 * HasClipActions together).
 *
 * This oracle proves the RUNTIME half a byte test cannot (CLAUDE.md Verification
 * learning: byte presence is necessary but not sufficient — e.g. task 0663 had
 * plausible CLIPACTIONS bytes yet Ruffle dispatched nothing). It publishes a
 * faithful Scene-5 repro (a named MovieClip with an onClipEvent(load) handler on
 * a mask layer that has a masked child), runs it in the actual bundled Ruffle,
 * and asserts via Ruffle's trace observer that:
 *   (a) the onClipEvent(load) handler FIRES, and
 *   (b) inside it, the clip's own _name is "ballmask" AND _root.ballmask
 *       resolves to a defined movieclip (the name took effect on the root).
 *
 * Run locally with:
 *   cd apps/desktop && npx playwright test e2e/mask-named-clip-1349.spec.ts --reporter=line
 */

import { test, expect, Page } from '@playwright/test';

const MASK_NAME = 'ballmask';
// The load handler traces a single sentinel line we can parse. It reports both
// the clip's own _name (proves HasName landed on this instance) and whether
// _root.<name> resolves (proves the name is addressable from the root).
const LOAD_TRACE_PREFIX = 'MASK1349';

async function ensureRuffleLoaded(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) {
        resolve();
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

async function collectTracesViaObserver(
  page: Page,
  swfBase64: string,
  playerId: string,
  settleMs: number
): Promise<string[]> {
  return page.evaluate(async ({ b64, id, settle }) => {
    type RuffleHandle = { createPlayer(): RufflePlayerEl };
    type RufflePlayerEl = HTMLElement & {
      traceObserver?: ((message: string) => void) | null;
      ruffle(): {
        load(opts: {
          data?: Uint8Array;
          allowScriptAccess?: boolean;
          autoplay?: string;
          unmuteOverlay?: string;
          logLevel?: string;
        }): Promise<void>;
      };
    };

    const ruffleApi = (window as unknown as {
      RufflePlayer: { newest(): RuffleHandle };
    }).RufflePlayer.newest();
    const player = ruffleApi.createPlayer();
    player.id = id;
    player.style.cssText = 'position:fixed;top:0;left:0;width:550px;height:400px;';
    document.body.appendChild(player);

    const traces: string[] = [];
    const observer = (message: string) => { traces.push(message); };

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const loadPromise = player.ruffle().load({
      data: bytes,
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
      logLevel: 'info',
    });
    player.traceObserver = observer;
    await loadPromise;
    player.traceObserver = observer;

    await new Promise<void>((r) => setTimeout(r, settle));
    player.remove();
    return traces;
  }, { b64: swfBase64, id: playerId, settle: settleMs });
}

/**
 * A faithful Scene-5-in-miniature document:
 *   - library: a movieclip symbol used as the mask clip
 *   - scene "Scene 5": a MASK layer holding the named instance `ballmask` whose
 *     onClipEvent(load) traces a sentinel, directly above a MASKED layer (a
 *     consecutive masked run is what makes the compiler take the clipDepth path).
 */
function makeMaskedClipDoc() {
  const baseProps = {
    width: 550, height: 400, frameRate: 12,
    backgroundColor: '#ffffff', rulerUnits: 'px',
    grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
    guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
  };
  const linkage = {
    exportForActionScript: false, exportInFirstFrame: false,
    exportForRuntimeSharing: false, importForRuntimeSharing: false,
    linkageIdentifier: '', sharedUrl: '', className: '',
  };

  const emptyFrame = (displayObjects: unknown[]) => ({
    index: 0, isKeyframe: true, isEmpty: displayObjects.length === 0,
    tweenType: 'none', label: '', labelType: 'name', script: '', sound: null,
    motionEase: 0, motionEaseType: 'none', motionRotate: 'none', motionRotateCount: 0,
    motionOrientToPath: false, motionSync: false, motionSnap: false, motionScale: false,
    shapeEase: 0, shapeEaseType: 'none', shapeBlend: 'distributive',
    displayObjects,
  });

  const layer = (id: string, name: string, type: string, frames: unknown[]) => ({
    id, name, type, visible: true, locked: false, outlineMode: false,
    outlineColor: '#ff0000', height: 20, parentFolderId: null,
    frames, frameCount: frames.length,
  });

  // A small filled square so the mask clip has visible geometry to clip with.
  const square = (color: { r: number; g: number; b: number; a: number }) => ({
    id: `shape-${color.r}-${color.g}-${color.b}`,
    paths: [{
      start: { x: 0, y: 0 },
      segments: [
        { type: 'line', to: { x: 120, y: 0 } },
        { type: 'line', to: { x: 120, y: 120 } },
        { type: 'line', to: { x: 0, y: 120 } },
      ],
      closed: true,
      fill: { type: 'solid', color },
    }],
  });

  const clipSym = {
    id: 'sym-ballmask',
    name: 'BallMask',
    itemType: 'symbol',
    symbolType: 'movieclip',
    timeline: {
      layers: [layer('ml', 'Layer 1', 'normal', [
        emptyFrame([{
          id: 'mc-fill', type: 'shape', shape: square({ r: 0, g: 0, b: 0, a: 255 }),
          x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
        }]),
      ])],
    },
    linkage,
    scale9Grid: null,
  };

  const maskInstance = {
    id: 'inst-ballmask', type: 'instance', symbolId: clipSym.id,
    instanceName: MASK_NAME,
    x: 60, y: 60, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0,
    visible: true, alpha: 1, blendMode: 'normal', cacheAsBitmap: false,
    filters: [], colorEffect: { type: 'none' }, loopMode: 'loop', firstFrame: 0,
    clipActions: [{
      event: 'load',
      // Trace a single sentinel: own name + whether _root.<name> resolves.
      script:
        `trace("${LOAD_TRACE_PREFIX} name=" + this._name + ` +
        `" root=" + (typeof _root.${MASK_NAME}));`,
    }],
  };

  const maskLayer = layer('layer-mask', 'Layer 5', 'mask', [emptyFrame([maskInstance])]);
  const maskedLayer = layer('layer-masked', 'Masked', 'masked', [emptyFrame([{
    id: 'obj-masked', type: 'shape', shape: square({ r: 255, g: 0, b: 0, a: 255 }),
    x: 60, y: 60, scaleX: 1, scaleY: 1, rotation: 0,
  }])]);

  return {
    id: 'doc-1349',
    properties: baseProps,
    scenes: [{ id: 'scene-5', name: 'Scene 5', timeline: { layers: [maskLayer, maskedLayer] } }],
    library: { items: [clipSym], folders: [] },
  };
}

test.describe('task 1349: named/scripted MovieClip on a mask layer (runtime)', () => {
  test.skip(!!process.env.CI, 'runtime oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  test('the mask clip onClipEvent(load) fires AND _root.<name> resolves', async ({ page }) => {
    const doc = makeMaskedClipDoc();

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

    await ensureRuffleLoaded(page);
    const traces = await collectTracesViaObserver(page, swfBase64, 'mask1349-player', 2500);

    // (a) The load handler fired at all (its trace appeared).
    const sentinel = traces.find((t) => t.startsWith(LOAD_TRACE_PREFIX));
    expect(sentinel, `expected a "${LOAD_TRACE_PREFIX}" trace; got: ${JSON.stringify(traces)}`)
      .toBeDefined();

    // (b) The instance name landed on the clip (this._name) AND _root.ballmask
    //     resolves (not "undefined"). Before the fix: no trace at all (handler
    //     stripped) AND _root.ballmask would have been undefined (name stripped).
    expect(sentinel).toContain(`name=${MASK_NAME}`);
    expect(sentinel).toContain('root=movieclip');
    expect(sentinel).not.toContain('root=undefined');
  });
});
