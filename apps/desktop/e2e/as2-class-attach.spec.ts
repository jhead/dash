/**
 * AS2 user-class → library-symbol linkage RUNTIME oracle (task 1299).
 *
 * This is the ACCEPTANCE GATE for the AS2 class compilation pass. Per CLAUDE.md,
 * byte-presence unit tests on the emitted DoInitAction are necessary but NOT
 * sufficient — only a real Ruffle run proves the class actually registers,
 * instantiates via attachMovie, and runs its methods.
 *
 * It publishes a real SWF whose document carries:
 *   - an external `.as` class (`com.example.Ball`) whose `speak()` method
 *     trace()s a known string, attached via doc.asClasses (the P0 model field);
 *   - a library MovieClip symbol linked to that class
 *     (exportForActionScript + linkageIdentifier "BallLinkage" + className
 *     "com.example.Ball");
 *   - a frame-1 script that does `attachMovie("BallLinkage", ...)` and calls
 *     `.speak()` on the attached instance.
 *
 * It then loads the SWF in the actual bundled Ruffle player, registers Ruffle's
 * dedicated trace observer (the same channel the editor Output panel uses — see
 * the task-1259 learning), and asserts the method's trace() line arrives. That
 * proves the WHOLE pipeline: class-definition DoInitAction runs → registerClass
 * binds the linkage → attachMovie instantiates the user class → its method runs.
 *
 * The class name is FULLY QUALIFIED (`com.example.Ball`) so this also exercises
 * the dotted-name registration path (`_global.com.example.Ball`) at runtime.
 *
 * Run locally with:
 *   cd apps/desktop && npx playwright test e2e/as2-class-attach.spec.ts --reporter=line
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers (mirror trace-output.spec.ts — the trace-observer template)
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
// Fixture document: linked MovieClip symbol + external class + attach script
// ---------------------------------------------------------------------------

const SPEAK_MESSAGE = 'ball speaks via attachMovie';

/** The `.as` source for com.example.Ball, whose speak() traces SPEAK_MESSAGE. */
const BALL_CLASS_SOURCE =
  'class com.example.Ball extends MovieClip {\n' +
  '  function Ball() {}\n' +
  `  function speak():Void { trace("${SPEAK_MESSAGE}"); }\n` +
  '}\n';

function emptyTimeline(idPrefix: string, isEmpty: boolean, script: string) {
  return {
    layers: [{
      id: `${idPrefix}-layer`,
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
        index: 0, isKeyframe: true, isEmpty, tweenType: 'none',
        label: '', labelType: 'name',
        script,
        sound: null,
        motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
        motionOrientToPath: false, motionSync: false, motionScale: false,
        shapeEase: 0, shapeBlend: 'distributive',
        displayObjects: [],
      }],
    }],
  };
}

function makeAttachDoc() {
  // Frame 1 attaches the linked class by its linkage identifier and calls a
  // method on it. attachMovie resolves "BallLinkage" → the registered class
  // com.example.Ball; the new instance's speak() then trace()s.
  const frameScript =
    '_root.attachMovie("BallLinkage", "myBall", 1);\n' +
    '_root.myBall.speak();';

  return {
    id: 'as2-class-attach-doc',
    properties: {
      width: 550, height: 400, frameRate: 12,
      backgroundColor: '#ffffff', rulerUnits: 'px',
      grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
      guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
    },
    scenes: [{
      id: 'scene-1', name: 'Scene 1',
      timeline: emptyTimeline('scene', false, frameScript),
    }],
    library: {
      items: [{
        id: 'sym-ball',
        name: 'Ball',
        itemType: 'symbol',
        symbolType: 'movieclip',
        timeline: emptyTimeline('sym-ball', true, ''),
        linkage: {
          exportForActionScript: true,
          exportForRuntimeSharing: false,
          linkageIdentifier: 'BallLinkage',
          className: 'com.example.Ball',
          importForRuntimeSharing: false,
          sharedUrl: '',
          exportInFirstFrame: true,
        },
        scale9Grid: null,
      }],
      folders: [],
    },
    asClasses: [{ path: 'com/example/Ball.as', source: BALL_CLASS_SOURCE }],
    classpaths: ['.'],
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('AS2 class linked to a library symbol runs at runtime (task 1299)', () => {
  test.skip(!!process.env.CI, 'runtime oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  test('attachMovie instantiates the linked class and its method trace()s', async ({ page }) => {
    const doc = makeAttachDoc();

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
    const traces = await collectTracesViaObserver(page, swfBase64, 'as2-class-player', 3000);

    // The crux: the linked class's method ran via attachMovie at runtime. This
    // can only happen if (1) the class-definition DoInitAction registered
    // com.example.Ball in _global at its dotted path, (2) registerClass bound
    // "BallLinkage" → com.example.Ball, and (3) attachMovie instantiated it.
    expect(traces, `expected trace ${JSON.stringify(SPEAK_MESSAGE)}, got ${JSON.stringify(traces)}`)
      .toContain(SPEAK_MESSAGE);
  });
});
