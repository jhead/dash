/**
 * Trace → Output panel oracle (task 1259).
 *
 * USER-REPORTED BUG: adding `trace("message")` to a frame script and running
 * Test Movie left the Output pane empty. Root cause: the editor captured trace
 * by scraping console.log and suppressing any line that started with
 * "INFO"/"avm". But Ruffle emits AS2 `trace()` as a tracing INFO event on the
 * `avm_trace` target, which the WASMLayer renders to the console as a styled
 * "%cINFO%c ... avm_trace ... <msg>" line — so every trace() line matched the
 * "info" suppression prefix and was dropped before reaching the Output panel.
 *
 * FIX: `RufflePlayer.tsx` now registers Ruffle's DEDICATED trace observer
 * (`<ruffle-player>.traceObserver` → `set_trace_observer`), which fires once per
 * real avm_trace with the plain message string and is never routed through the
 * INFO-suppressing console filter. `useExportHandlers.handleTrace` appends each
 * line to `outputMessages`, which `OutputPanel` renders
 * (data-testid="output-panel-messages").
 *
 * This oracle proves the runtime half a unit test cannot: it publishes a real
 * SWF whose frame 1 calls `trace("hello from trace")`, loads it in the actual
 * bundled Ruffle player, registers the SAME `traceObserver` channel the app
 * uses, and asserts the trace line arrives. It thereby demonstrates that AS2
 * trace() output flows through the observer (not the dropped console route).
 *
 * Run locally with:
 *   pnpm --filter @flash/desktop e2e --grep "trace"
 *   cd apps/desktop && npx playwright test e2e/trace-output.spec.ts --reporter=line
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureRuffleLoaded(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      if ((window as Window & typeof globalThis).RufflePlayer) {
        resolve();
        return;
      }
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

/**
 * Inject a real <ruffle-player>, register Ruffle's dedicated trace observer
 * (the exact channel the app's RufflePlayer.tsx uses), load the SWF, and return
 * the trace lines the observer delivers.
 */
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
    const observer = (message: string) => {
      traces.push(message);
    };

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const loadPromise = player.ruffle().load({
      data: bytes,
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
      logLevel: 'info',
    });
    // The <ruffle-player> `traceObserver` setter forwards to the WASM
    // instance's `set_trace_observer`, which only exists once load() has
    // created the instance. Register it both before and after load resolves so
    // the observer is attached as early as the instance allows (a pre-load set
    // is a no-op; the post-load set is the one that takes effect).
    player.traceObserver = observer;
    await loadPromise;
    player.traceObserver = observer;

    // Give the AVM a moment to run frame 1's DoAction and fire the observer.
    await new Promise<void>((r) => setTimeout(r, settle));

    player.remove();
    return traces;
  }, { b64: swfBase64, id: playerId, settle: settleMs });
}

/** A minimal single-frame document whose frame 1 script calls trace(message). */
function makeTraceDoc(message: string) {
  const docId = 'trace-doc';
  return {
    id: docId,
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
          id: `${docId}-layer`,
          name: 'Layer 1',
          type: 'normal',
          visible: true,
          locked: false,
          outlineMode: false,
          outlineColor: '#ff0000',
          height: 20,
          parentFolderId: null,
          frameCount: 1,
          frames: [{
            index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
            label: '', labelType: 'name',
            script: `trace("${message}");`,
            sound: null,
            motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
            motionOrientToPath: false, motionSync: false, motionScale: false,
            shapeEase: 0, shapeBlend: 'distributive',
            displayObjects: [],
          }],
        }],
      },
    }],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('AS2 trace() reaches the Output panel (task 1259)', () => {
  test.skip(!!process.env.CI, 'runtime oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  test('trace() output is delivered via Ruffle\'s trace observer', async ({ page }) => {
    const message = 'hello from trace';
    const doc = makeTraceDoc(message);

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
    const traces = await collectTracesViaObserver(page, swfBase64, 'trace-player', 2500);

    // The crux: the published trace() line must surface through the observer
    // channel. Before the fix this channel was never wired and the only path
    // (console scrape) suppressed the styled INFO avm_trace line.
    expect(traces).toContain(message);
  });

  test('in-app Test Movie surfaces trace() in the Output panel', async ({ page }) => {
    // The full user repro path: load a doc with trace() on frame 1, trigger
    // Control > Test Movie (Ctrl+Enter), and assert the line appears in the
    // Output panel (data-testid="output-panel-messages"). This mounts the real
    // in-app RufflePlayer (PlayerWindow), which registers the trace observer and
    // feeds handleTrace → outputMessages → OutputPanel.
    const message = 'trace into output panel';
    const doc = makeTraceDoc(message);

    await page.evaluate((d) => {
      (window as unknown as { __flashTest: { loadDocument: (x: unknown) => void } })
        .__flashTest.loadDocument(d);
    }, doc);
    await page.waitForTimeout(300);

    // Make sure Ruffle's script is available before triggering Test Movie so the
    // in-app player can initialise promptly in headless Chromium.
    await ensureRuffleLoaded(page);

    // Trigger Control > Test Movie. The handler is a global window keydown
    // listener (Shell.tsx), so dispatch the Ctrl+Enter keydown on window to
    // drive the real handleTestMovie → mounts the in-app RufflePlayer, switches
    // the dock to the Output tab, and feeds trace lines via the observer.
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
      );
    });

    // The dock auto-switches to the Output tab; the trace line should arrive
    // through the observer within a couple of frames.
    const panel = page.locator('[data-testid="output-panel-messages"]');
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel).toContainText(message, { timeout: 15000 });
  });
});
