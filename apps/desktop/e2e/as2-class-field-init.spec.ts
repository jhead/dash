/**
 * AS2 class FIELD-INITIALIZER runtime oracle (task 1314).
 *
 * Regression gate for the constructor-hoist fix: a class instance field with an
 * initializer (e.g. `var n:Number = 7;`) MUST run for instances created when a
 * library MovieClip symbol is linked to the class via className linkage and
 * instantiated (here via attachMovie). Before the fix the initializer was
 * emitted as a PROTOTYPE assignment, which did not take effect for such
 * className-linked instances — the field read `undefined` (cascading to NaN).
 * Real Flash 8 hoists member initializers into the class constructor so they
 * always run; this spec asserts the INITIALIZED value (7, not undefined/NaN)
 * traces at runtime in the real bundled Ruffle player.
 *
 * Two cases, per the task's acceptance criteria:
 *   (a) class with NO explicit constructor — the compiler synthesizes one
 *       containing the field initializers.
 *   (b) class WITH an explicit constructor — BOTH the field initializers AND
 *       the user constructor body take effect (initializers run first, then the
 *       constructor body sees the initialized value).
 *
 * Mirrors as2-class-attach.spec.ts (the trace-observer template, task 1299).
 *
 * Run locally with:
 *   cd apps/desktop && npx playwright test e2e/as2-class-field-init.spec.ts --reporter=line
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers (mirror as2-class-attach.spec.ts)
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
// Fixture document factory: a linked MovieClip + external class + attach script
// ---------------------------------------------------------------------------

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

/**
 * Build a document whose library MovieClip is linked (className) to a user AS2
 * class with a field initializer, and whose frame-1 script attaches the symbol
 * then trace()s the field value read off the attached instance.
 */
function makeFieldInitDoc(opts: {
  docId: string;
  className: string;
  linkageId: string;
  classSource: string;
  /** AS2 expression that reads the field off the attached instance, e.g. ".n". */
  fieldRead: string;
}) {
  const frameScript =
    `_root.attachMovie("${opts.linkageId}", "inst", 1);\n` +
    `trace("FIELD=" + _root.inst${opts.fieldRead});`;

  return {
    id: opts.docId,
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
        id: 'sym-linked',
        name: 'Linked',
        itemType: 'symbol',
        symbolType: 'movieclip',
        timeline: emptyTimeline('sym-linked', true, ''),
        linkage: {
          exportForActionScript: true,
          exportForRuntimeSharing: false,
          linkageIdentifier: opts.linkageId,
          className: opts.className,
          importForRuntimeSharing: false,
          sharedUrl: '',
          exportInFirstFrame: true,
        },
        scale9Grid: null,
      }],
      folders: [],
    },
    asClasses: [{ path: opts.className.replace(/\./g, '/') + '.as', source: opts.classSource }],
    classpaths: ['.'],
  };
}

async function publishAndTrace(page: Page, doc: unknown, playerId: string): Promise<string[]> {
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
  return collectTracesViaObserver(page, swfBase64, playerId, 3000);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('AS2 class field initializers run for className-linked instances (task 1314)', () => {
  test.skip(!!process.env.CI, 'runtime oracle — Ruffle WASM not available in CI');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const bridgeReady = await page.evaluate(
      () => typeof (window as unknown as { __flashTest?: unknown }).__flashTest !== 'undefined'
    );
    expect(bridgeReady).toBe(true);
  });

  // ---- Case (a): NO explicit constructor -----------------------------------
  test('(a) field initializer runs with NO explicit constructor', async ({ page }) => {
    // The class has a single field with an initializer and no constructor; the
    // compiler must synthesize a constructor that runs `this.n = 7`.
    const classSource =
      'class com.example.NoCtor extends MovieClip {\n' +
      '  var n:Number = 7;\n' +
      '}\n';

    const doc = makeFieldInitDoc({
      docId: 'as2-fieldinit-noctor-doc',
      className: 'com.example.NoCtor',
      linkageId: 'NoCtorLinkage',
      classSource,
      fieldRead: '.n',
    });

    const traces = await publishAndTrace(page, doc, 'as2-fieldinit-noctor-player');

    // The crux: the instance's field is the INITIALIZED 7, not undefined/NaN.
    expect(traces, `expected "FIELD=7", got ${JSON.stringify(traces)}`)
      .toContain('FIELD=7');
    expect(traces).not.toContain('FIELD=undefined');
    expect(traces).not.toContain('FIELD=NaN');
  });

  // ---- Case (b): WITH an explicit constructor ------------------------------
  test('(b) field initializer AND constructor body both take effect', async ({ page }) => {
    // The field initializes to 5; the explicit constructor then adds 10 to it.
    // If the initializer were dropped (the bug), `this.n` would be undefined
    // inside the ctor and `undefined + 10` → NaN. The correct result is 15,
    // proving (1) the initializer ran BEFORE the ctor body and (2) the ctor
    // body also ran.
    const classSource =
      'class com.example.WithCtor extends MovieClip {\n' +
      '  var n:Number = 5;\n' +
      '  function WithCtor() {\n' +
      '    this.n = this.n + 10;\n' +
      '  }\n' +
      '}\n';

    const doc = makeFieldInitDoc({
      docId: 'as2-fieldinit-withctor-doc',
      className: 'com.example.WithCtor',
      linkageId: 'WithCtorLinkage',
      classSource,
      fieldRead: '.n',
    });

    const traces = await publishAndTrace(page, doc, 'as2-fieldinit-withctor-player');

    expect(traces, `expected "FIELD=15", got ${JSON.stringify(traces)}`)
      .toContain('FIELD=15');
    expect(traces).not.toContain('FIELD=NaN');
    expect(traces).not.toContain('FIELD=undefined');
    // 5 alone would mean the ctor body never ran; 10 would mean the initializer
    // never ran. Neither is acceptable.
    expect(traces).not.toContain('FIELD=5');
    expect(traces).not.toContain('FIELD=10');
  });
});
