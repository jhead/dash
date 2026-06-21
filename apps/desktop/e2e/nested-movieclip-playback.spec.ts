/**
 * Nested MovieClip timeline playback — Ruffle runtime oracle (task 1340).
 *
 * Coverage gap closed: motion-tween.spec.ts only proves a ROOT-timeline tween
 * advances. NOTHING proved that a nested DefineSprite (a MovieClip symbol
 * instance placed on the root) advances its OWN internal playhead at runtime.
 *
 * Task 1340 reported "nested MovieClips are frozen on frame 1". Investigation
 * showed the compiler/runtime are CORRECT: a multi-frame movieclip with no
 * frame-1 stop() advances normally; the FLA symbol that appeared "frozen"
 * (Magnet.fla Symbol 27 / symbol-65) carries an AUTHORED `stop()` on its own
 * frame 0 and is designed to wait for game logic to call play() — that is the
 * .fla's intent, not a defect. This spec pins the real contract so a future
 * regression that actually freezes a nested sprite (e.g. a stray synthesized
 * gotoAndStop(1) on a movieclip placement, or a sprite emitted with FrameCount
 * 1) is caught.
 *
 * The oracle: place a 2-keyframe movieclip on a 2-frame root, run in bundled
 * Ruffle, and assert the nested MC's `_currentframe` advances past 1 (read via
 * a root frame script through player.traceObserver — the same channel
 * RufflePlayer.tsx uses).
 *
 * Run locally:
 *   cd apps/desktop && npx playwright test e2e/nested-movieclip-playback.spec.ts
 */

import { test, expect } from '@playwright/test';

type Page = Parameters<Parameters<typeof test>[1]>[0];

// ---------------------------------------------------------------------------
// Ruffle harness (trace-observer pattern, copied from trace-output.spec.ts)
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

/** Load a SWF in a real <ruffle-player> and collect trace() lines via the observer. */
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

// ---------------------------------------------------------------------------
// Document builder: 2-frame root placing a 2-keyframe movieclip
// ---------------------------------------------------------------------------

function frame(index: number, isKeyframe: boolean, displayObjects: unknown[], script = '') {
  return {
    index, isKeyframe, isEmpty: false, tweenType: 'none',
    label: '', labelType: 'name', script, sound: null,
    motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
    motionOrientToPath: false, motionSync: false, motionScale: false,
    shapeEase: 0, shapeBlend: 'distributive',
    displayObjects,
  };
}

function rectShapeObj(id: string, x: number) {
  const fill = { type: 'solid', color: { r: 255, g: 0, b: 0, a: 255 } };
  const shape = {
    id: `${id}-shape`,
    paths: [{
      start: { x: 0, y: 0 },
      segments: [
        { type: 'line', to: { x: 40, y: 0 } },
        { type: 'line', to: { x: 40, y: 40 } },
        { type: 'line', to: { x: 0, y: 40 } },
        { type: 'line', to: { x: 0, y: 0 } },
      ],
      closed: true,
      fill,
    }],
  };
  return { type: 'shape', id, shape, x, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
}

function makeNestedMcDoc() {
  const mcId = 'symbol-nested-mc';
  const mcSymbol = {
    id: mcId, name: 'NestedMC', itemType: 'symbol', symbolType: 'movieclip',
    linkage: { exportForActionScript: false, exportForRuntimeSharing: false,
      importForRuntimeSharing: false, exportInFirstFrame: true,
      identifier: '', url: '', className: '' },
    scale9Grid: null,
    timeline: {
      layers: [{
        id: `${mcId}-layer`, name: 'Layer 1', type: 'normal', visible: true,
        locked: false, outlineMode: false, outlineColor: '#0000ff', height: 20,
        parentFolderId: null, frameCount: 2,
        // Two keyframes that visibly differ: square at x=0, then x=200.
        // No stop() on frame 1 → the MC must auto-advance.
        frames: [
          frame(0, true, [rectShapeObj('mc-rect-a', 0)]),
          frame(1, true, [rectShapeObj('mc-rect-b', 200)]),
        ],
      }],
    },
  };

  const inst = {
    type: 'instance', id: 'mc-inst', symbolId: mcId, instanceName: 'mcInst',
    x: 50, y: 50, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, blendMode: 'normal',
  };

  return {
    id: 'nested-mc-doc',
    properties: {
      width: 550, height: 400, frameRate: 12,
      backgroundColor: '#ffffff', rulerUnits: 'px',
      grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
      guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
    },
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: {
        layers: [{
          id: 'root-layer', name: 'Layer 1', type: 'normal', visible: true,
          locked: false, outlineMode: false, outlineColor: '#ff0000', height: 20,
          parentFolderId: null, frameCount: 2,
          // Root has 2 frames (so it ticks). Each frame traces the nested MC's
          // own _currentframe. The MC is the same persistent instance.
          frames: [
            frame(0, true, [inst], 'trace("cf=" + mcInst._currentframe);'),
            frame(1, false, [inst], 'trace("cf=" + mcInst._currentframe);'),
          ],
        }],
      },
    }],
    library: { items: [mcSymbol], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Nested MovieClip advances its own timeline (task 1340)', () => {
  test.skip(!!process.env.CI, 'runtime oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  test('a multi-frame movieclip instance ticks past frame 1 in Ruffle', async ({ page }) => {
    const doc = makeNestedMcDoc();

    await page.evaluate((d) => {
      (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } })
        .__flashTest.loadDocument(d);
    }, doc);
    await page.waitForTimeout(300);

    const swfBase64: string = await page.evaluate(async () => {
      return (window as unknown as { __flashTest: { publish: () => Promise<string> } })
        .__flashTest.publish();
    });
    expect(typeof swfBase64).toBe('string');
    expect(swfBase64.length).toBeGreaterThan(0);

    await ensureRuffleLoaded(page);
    const traces = await collectTracesViaObserver(page, swfBase64, 'nested-mc-player', 2500);

    const currentFrames = traces
      .filter((t) => t.startsWith('cf='))
      .map((t) => Number(t.slice(3)))
      .filter((n) => Number.isFinite(n));

    // The crux: the nested MovieClip's own playhead must advance past 1. A
    // frozen sprite (the reported-but-not-real defect) would trace cf=1 forever.
    expect(currentFrames.length).toBeGreaterThan(0);
    expect(Math.max(...currentFrames)).toBeGreaterThan(1);
  });
});
